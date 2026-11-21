import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('./hub.js', import.meta.url), 'utf8');
const DATA_DIR = path.resolve('.test-tmp', 'hub-paths', 'isolated-data');
const HUB_DIR = path.resolve('.test-tmp', 'hub-paths', 'program');

test('group metadata, live thumbnails and temporary guard state respect the data directory override', () => {
  const code = ['function projectMetaPath', 'const LIVE_THUMBS =', 'const TEMP_FILE ='].map(prefix => source.split(/\r?\n/).find(line => line.startsWith(prefix))).join('\n');
  const ctx = vm.createContext({ path, DATA_DIR, HUB_DIR });
  vm.runInContext(code + '\nglobalThis.paths = {projectMetaPath,LIVE_THUMBS,TEMP_FILE};', ctx);
  assert.equal(ctx.paths.projectMetaPath({ group: 'film', id: 'group-id' }), path.join(DATA_DIR, 'meta', 'group-id.json'));
  assert.equal(ctx.paths.projectMetaPath({ path: HUB_DIR }), path.join(HUB_DIR, '.videohub', 'project.json'));
  assert.equal(ctx.paths.LIVE_THUMBS, path.join(DATA_DIR, 'thumbs'));
  assert.equal(ctx.paths.TEMP_FILE, path.join(DATA_DIR, 'guard-temp.json'));
});

test('guard settings routes read and clear temporary overrides only in the configured data directory', async () => {
  const handlers = new Map(), reads = [], removed = [];
  const code = source.split(/\r?\n/).filter(line => /^route\('(GET|POST)', '\/api\/guard\/settings'/.test(line)).join('\n');
  vm.runInNewContext(code, { path, DATA_DIR, HUB_DIR, route: (method, route, fn) => handlers.set(method + route, fn),
    readJson: f => { reads.push(f); return { until: 'later' }; }, fs: { unlinkSync: f => removed.push(f) },
    os: { totalmem: () => 2 ** 30, cpus: () => [] }, guardSettings: async () => ({}), readBody: async b => b, saveGuardSettings: async b => b });
  await handlers.get('GET/api/guard/settings')();
  const patch = { CapActive: 75 }; assert.equal(await handlers.get('POST/api/guard/settings')(patch), patch);
  assert.deepEqual(reads, [path.join(DATA_DIR, 'guard-temp.json')]); assert.deepEqual(removed, reads);
});

test('integration status reports the selected browser override rather than a cached default', () => {
  const code = source.slice(source.indexOf('function integrations()'), source.indexOf('function projectMetaPath'));
  const ctx = vm.createContext({ path, config: () => ({}), fs: { existsSync: () => true }, TOOLS: { ffmpeg: 'ffmpeg', edge: '/default/edge' }, findBrowser: () => ({ path: '/selected/browser' }) });
  vm.runInContext(code, ctx); assert.equal(ctx.integrations().browser, '/selected/browser');
});

test('the Files tab shows a file in its folder only when the path from the page stays inside the film', async () => {
  const { resolveInFilm } = await import('./film-files.js');
  const { isInside } = await import('./util.js');
  const films = path.resolve('.test-tmp', 'hub-paths', 'films-' + process.pid + '-' + Date.now()), dir = path.join(films, 'watch'), other = path.join(films, 'other');
  fs.mkdirSync(path.join(dir, 'scenes'), { recursive: true }); fs.mkdirSync(other, { recursive: true });
  fs.writeFileSync(path.join(dir, 'scenes', 'a.js'), 'x'); fs.writeFileSync(path.join(other, 'b.js'), 'x');
  const start = source.indexOf("route('POST', '/api/project/:id/open-folder'"), code = source.slice(start, source.indexOf('\n});', start) + 4);
  const handlers = new Map(), shown = [];
  const p = { id: 'w', path: dir, outputs: [] };
  vm.runInNewContext(code, { route: (m, r, fn) => handlers.set(m + r, fn), project: () => p, readBody: async b => b, resolveInFilm, isInside, path, fs,
    allowedFile: f => isInside(f, films), process: { env: {} }, reveal: async (t, o) => { shown.push([t, o.select]); } });
  const open = async body => JSON.parse(JSON.stringify(await handlers.get('POST/api/project/:id/open-folder')(body, null, { id: 'w' })));   // (objects from the vm context)
  assert.deepEqual(await open({ rel: 'scenes/a.js' }), { ok: true, path: path.join(dir, 'scenes', 'a.js'), select: true });
  assert.deepEqual(await open({}), { ok: true, path: dir, select: false }, 'no path: the film folder itself');
  for (const rel of ['../other/b.js', 'scenes/../../other/b.js', path.join(other, 'b.js'), '']) await assert.rejects(open({ rel }), e => e.code === 403, rel);
  await assert.rejects(open({ rel: 'scenes/missing.js' }), e => e.code === 403);
  let junction = false; try { fs.symlinkSync(other, path.join(dir, 'leak'), 'junction'); junction = true; } catch { }
  if (junction) await assert.rejects(open({ rel: 'leak/b.js' }), e => e.code === 403, 'a junction leading out of the film');
  assert.equal(shown.length, 2);
});
