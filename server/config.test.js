import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { ENCODERS } from './encoders.js';
const fixture = (...parts) => path.resolve('.test-tmp', 'config-fixture', ...parts);

// config.js with in-memory files: never writes data/config.json
function load(saved = { port: 7788, roots: [{ path: fixture('films'), type: 'container', enabled: true }] }, env = { VIDEOHUB_BASE_DIR: fixture('base') }) {
  const code = fs.readFileSync(new URL('./config.js', import.meta.url), 'utf8').replace(/^import .+;\r?$/gm, '').replace(/\bexport /g, '');
  const written = [];
  const ctx = { fs: { existsSync: () => false, readdirSync: () => [], mkdirSync() { } }, path, norm: p => path.resolve(p), DATA_DIR: fixture('data'), DESKTOP: fixture('desk'), DOCUMENTS: fixture('docs'), ENCODERS,
    process: { env }, readJson: () => saved && JSON.parse(JSON.stringify(saved)), writeJson: (f, d) => written.push(JSON.parse(JSON.stringify(d))) };
  vm.createContext(ctx); vm.runInContext(code + '\nglobalThis.api = { config, saveConfig, baseDir, defaultFilmsDir };', ctx);
  return { ...ctx.api, written };
}

test('a bad POST /api/config body cannot break the roots or port', () => {
  const c = load();
  let r = c.saveConfig({ roots: 'oops', port: 'abc' });
  assert.equal(r.roots.length, 1); assert.equal(r.roots[0].path, fixture('films')); assert.equal(r.port, 7788);
  r = c.saveConfig({ roots: [{ path: fixture('a'), type: 'weird' }, { nope: 1 }, null, { path: 3 }, { path: fixture('b'), type: 'media', enabled: false }], port: '7799' });
  assert.deepEqual(JSON.parse(JSON.stringify(r.roots)), [{ path: fixture('a'), type: 'container', enabled: true }, { path: fixture('b'), type: 'media', enabled: false }]);
  assert.equal(r.port, 7799);
  r = c.saveConfig(null); assert.equal(r.roots.length, 2); assert.equal(c.written.length, 3);
});

test('baseDir: environment, then saved workspace, then Documents/VideoHub; folder defaults follow it', () => {
  let c = load({ baseDir: fixture('Work', 'VH'), roots: [] }, {}); c.config();
  assert.equal(c.baseDir(), fixture('Work', 'VH')); assert.equal(c.config().outputsDir, fixture('Work', 'VH', 'outputs'));
  assert.equal(c.config().thumbstudio, undefined); assert.equal(c.defaultFilmsDir(), fixture('Work', 'VH', 'films'));
  c = load({ baseDir: fixture('Work', 'VH'), roots: [] }, { VIDEOHUB_BASE_DIR: fixture('scratch') }); c.config(); assert.equal(c.baseDir(), fixture('scratch'));
  c = load({ roots: [] }, {}); c.config(); assert.equal(c.baseDir(), fixture('docs', 'VideoHub'));
  c = load({ baseDir: path.join('relative', 'bad'), roots: [] }, {}); c.config(); assert.equal(c.baseDir(), fixture('docs', 'VideoHub'));
  // first run without setup: the same defaults, and the workspace is written down
  c = load(null, {}); const f = c.config();
  assert.equal(f.baseDir, fixture('docs', 'VideoHub')); assert.equal(f.roots[0].path, fixture('docs', 'VideoHub', 'films'));
  assert.equal(f.render.encoder, 'auto'); assert.equal(c.written.length, 1);
});

test('an existing config keeps its values: explicit folders win over the workspace, saveConfig cannot move the workspace', () => {
  const saved = { port: 7788, baseDir: fixture('VH'), outputsDir: fixture('Old outputs'), archiveDir: fixture('Arch'), thumbstudio: { globalDir: fixture('Th') }, render: { encoder: 'x264' }, roots: [{ path: fixture('films'), type: 'container', enabled: true }] };
  const c = load(saved, {}), r = c.config();
  assert.equal(r.outputsDir, fixture('Old outputs')); assert.equal(r.archiveDir, fixture('Arch'));
  assert.equal(r.soundLibDir, fixture('VH', 'sounds')); assert.equal(r.render.encoder, 'x264'); assert.equal(r.roots.length, 1); assert.equal(c.written.length, 0);
  let s = c.saveConfig({ baseDir: fixture('elsewhere'), render: { encoder: 'amf' } });
  assert.equal(s.baseDir, fixture('VH')); assert.equal(s.render.encoder, 'amf'); assert.equal(s.outputsDir, fixture('Old outputs'));
  s = c.saveConfig({ render: { encoder: 'warp9' } }); assert.equal(s.render.encoder, 'auto');
  // an install from before baseDir: no key is added, Documents\VideoHub as before
  const old = load({ port: 7788, outputsDir: fixture('o'), roots: [] }, {}); assert.equal(old.config().baseDir, undefined); assert.equal(old.baseDir(), fixture('docs', 'VideoHub'));
});

test('agentActivity: on unless explicitly switched off', () => {
  const c = load({ port: 7788, roots: [] }, {});
  assert.equal(c.config().agentActivity, true);
  assert.equal(c.saveConfig({ agentActivity: false }).agentActivity, false);
  assert.equal(c.saveConfig({ agentName: 'X' }).agentActivity, false, 'other saves keep it');
  assert.equal(c.saveConfig({ agentActivity: 'yes' }).agentActivity, true);
  assert.equal(load({ port: 7788, roots: [], agentActivity: false }, {}).config().agentActivity, false);
});

test('an old thumbstudio key (Thumbnail Studio was removed) is kept on disk and ignored, whatever its shape', () => {
  for (const old of [{ globalDir: fixture('Th'), templatesDir: 5 }, 5, null, 'x', []]) {
    const c = load({ port: 7788, thumbstudio: old, roots: [{ path: fixture('films'), type: 'container', enabled: true }] }, {});
    const r = c.config(); assert.equal(r.roots.length, 1); assert.equal(r.port, 7788);
    const s = c.saveConfig({ port: 7799, thumbstudio: { globalDir: 3 } }); assert.equal(s.port, 7799); assert.equal(s.roots.length, 1);
  }
});
