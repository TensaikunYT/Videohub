import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import nodePath from 'node:path';
import vm from 'node:vm';

// Windows paths and encoders on every OS (path.win32), so these run the same on a Mac; a Mac case at the end
const path = nodePath.win32, WIN_ENCODERS = ['auto', 'nvenc', 'amf', 'qsv', 'x264'];
// config.js with in-memory files: never writes data/config.json
function load(saved = { port: 7788, roots: [{ path: 'X:\\films', type: 'container', enabled: true }] }, env = { VIDEOHUB_BASE_DIR: 'X:\\base' }, mac = false) {
  const code = fs.readFileSync(new URL('./config.js', import.meta.url), 'utf8').replace(/^import .+;\r?$/gm, '').replace(/\bexport /g, '');
  const written = [];
  const os = mac ? { path: nodePath.posix, DATA_DIR: '/vh/data', DESKTOP: '/Users/x/Desktop', DOCUMENTS: '/Users/x/Documents', HOME: '/Users/x', ENCODERS: ['auto', 'vt', 'x264'] }
    : { path, DATA_DIR: 'X:\\data', DESKTOP: 'X:\\desk', DOCUMENTS: 'X:\\docs', HOME: 'X:\\home', ENCODERS: WIN_ENCODERS };
  const ctx = { fs: { existsSync: () => false, readdirSync: () => [], mkdirSync() { } }, ...os, IS_MAC: mac,
    process: { env }, readJson: () => saved && JSON.parse(JSON.stringify(saved)), writeJson: (f, d) => written.push(JSON.parse(JSON.stringify(d))) };
  vm.createContext(ctx); vm.runInContext(code + '\nglobalThis.api = { config, saveConfig, baseDir, defaultFilmsDir };', ctx);
  return { ...ctx.api, written };
}

test('a bad POST /api/config body cannot break the roots, thumbstudio or port', () => {
  const c = load();
  let r = c.saveConfig({ roots: 'oops', port: 'abc', thumbstudio: 5 });
  assert.equal(r.roots.length, 1); assert.equal(r.roots[0].path, 'X:\\films'); assert.equal(r.port, 7788); assert.equal(r.thumbstudio.templatesDir, path.join('X:\\base', 'thumbnail-templates'));
  r = c.saveConfig({ roots: [{ path: 'X:\\a', type: 'weird' }, { nope: 1 }, null, { path: 3 }, { path: 'X:\\b', type: 'media', enabled: false }], port: '7799', thumbstudio: { styleRefsDir: 'X:\\styles' } });
  assert.deepEqual(JSON.parse(JSON.stringify(r.roots)), [{ path: 'X:\\a', type: 'container', enabled: true }, { path: 'X:\\b', type: 'media', enabled: false }]);
  assert.equal(r.port, 7799); assert.equal(r.thumbstudio.styleRefsDir, 'X:\\styles'); assert.equal(r.thumbstudio.globalDir, path.join('X:\\base', 'thumbnails'));
  r = c.saveConfig(null); assert.equal(r.roots.length, 2); assert.equal(c.written.length, 3);
});

test('baseDir: VIDEOHUB_BASE_DIR, then config.baseDir, then Documents\\VideoHub; the folder defaults follow it', () => {
  let c = load({ baseDir: 'E:\\Work\\VH', roots: [] }, {}); c.config();
  assert.equal(c.baseDir(), 'E:\\Work\\VH'); assert.equal(c.config().outputsDir, path.join('E:\\Work\\VH', 'outputs'));
  assert.equal(c.config().thumbstudio.globalDir, path.join('E:\\Work\\VH', 'thumbnails')); assert.equal(c.defaultFilmsDir(), path.join('E:\\Work\\VH', 'films'));
  c = load({ baseDir: 'E:\\Work\\VH', roots: [] }, { VIDEOHUB_BASE_DIR: 'X:\\scratch' }); c.config(); assert.equal(c.baseDir(), 'X:\\scratch');
  c = load({ roots: [] }, {}); c.config(); assert.equal(c.baseDir(), path.join('X:\\docs', 'VideoHub'));
  c = load({ baseDir: 'relative\\bad', roots: [] }, {}); c.config(); assert.equal(c.baseDir(), path.join('X:\\docs', 'VideoHub'));
  // first run without setup: the same defaults, and the workspace is written down
  c = load(null, {}); const f = c.config();
  assert.equal(f.baseDir, path.join('X:\\docs', 'VideoHub')); assert.equal(f.roots[0].path, path.join('X:\\docs', 'VideoHub', 'films'));
  assert.equal(f.render.encoder, 'auto'); assert.equal(c.written.length, 1);
});

test('an existing config keeps its values: explicit folders win over the workspace, saveConfig cannot move the workspace', () => {
  const saved = { port: 7788, baseDir: 'E:\\VH', outputsDir: 'D:\\Old outputs', archiveDir: 'D:\\Arch', thumbstudio: { globalDir: 'D:\\Th' }, render: { encoder: 'x264' }, roots: [{ path: 'D:\\films', type: 'container', enabled: true }] };
  const c = load(saved, {}), r = c.config();
  assert.equal(r.outputsDir, 'D:\\Old outputs'); assert.equal(r.archiveDir, 'D:\\Arch'); assert.equal(r.thumbstudio.globalDir, 'D:\\Th');
  assert.equal(r.soundLibDir, path.join('E:\\VH', 'sounds')); assert.equal(r.render.encoder, 'x264'); assert.equal(r.roots.length, 1); assert.equal(c.written.length, 0);
  let s = c.saveConfig({ baseDir: 'Z:\\elsewhere', render: { encoder: 'amf' } });
  assert.equal(s.baseDir, 'E:\\VH'); assert.equal(s.render.encoder, 'amf'); assert.equal(s.outputsDir, 'D:\\Old outputs');
  s = c.saveConfig({ render: { encoder: 'warp9' } }); assert.equal(s.render.encoder, 'auto');
  // an install from before baseDir: no key is added, Documents\VideoHub as before
  const old = load({ port: 7788, outputsDir: 'D:\\o', roots: [] }, {}); assert.equal(old.config().baseDir, undefined); assert.equal(old.baseDir(), path.join('X:\\docs', 'VideoHub'));
});

test('a Mac: the workspace defaults to ~/Movies/VideoHub (not the iCloud-synced Documents); its encoders are auto, vt and x264', () => {
  const p = nodePath.posix, c = load(null, {}, true), f = c.config();
  assert.equal(c.baseDir(), '/Users/x/Movies/VideoHub'); assert.equal(f.baseDir, '/Users/x/Movies/VideoHub');
  assert.equal(f.roots[0].path, p.join('/Users/x/Movies/VideoHub', 'films')); assert.equal(f.outputsDir, '/Users/x/Movies/VideoHub/outputs');
  assert.equal(c.saveConfig({ render: { encoder: 'vt' } }).render.encoder, 'vt');
  assert.equal(c.saveConfig({ render: { encoder: 'nvenc' } }).render.encoder, 'auto');   // a Windows choice copied to a Mac
  const set = load({ baseDir: '/Volumes/Work/VH', roots: [] }, {}, true); set.config(); assert.equal(set.baseDir(), '/Volumes/Work/VH');
  const old = load({ roots: [] }, {}, true); old.config(); assert.equal(old.baseDir(), '/Users/x/Movies/VideoHub');
});
