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
