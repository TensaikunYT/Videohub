import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { listFilmFiles, groupOf, bulkHint, changedRule, resolveInFilm } from './film-files.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '.test-tmp');
const DAY = 864e5, NOW = Date.now();
function put(file, bytes = 10, ageDays = 0) {
  fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, Buffer.alloc(bytes, 1));
  if (ageDays) { const t = new Date(NOW - ageDays * DAY); fs.utimesSync(file, t, t); }
}
function film() {
  const dir = path.join(root, 'filmfiles-' + crypto.randomUUID(), 'watch');
  put(path.join(dir, 'film.js'), 100, 3); put(path.join(dir, 'scenes', '01.js'), 50);   // changed today
  put(path.join(dir, 'facts.md'), 20, 3); put(path.join(dir, 'vo.mp3'), 1000, 3); put(path.join(dir, 'vo.words.json'), 30, 3);
  put(path.join(dir, 'models', 'watch.glb'), 500, 3); put(path.join(dir, 'textures', 'steel.png'), 400, 3);
  put(path.join(dir, 'watch_v1.mp4'), 2000, 2); put(path.join(dir, 'watch_v2.mp4'), 2100); put(path.join(dir, 'stray_part.mp4'), 5, 3);
  put(path.join(dir, 'weird.bin'), 7, 3);
  for (let i = 0; i < 30; i++) put(path.join(dir, 'render', 'chunks', `c_${i}.mp4`), 10, 3);
  for (let i = 0; i < 12; i++) put(path.join(dir, 'render', 'chunks_v1', `c_${i}.mp4`), 10, 3);
  for (let i = 0; i < 5; i++) put(path.join(dir, 'qa', `f${i}.png`), 100, 5);
  put(path.join(dir, 'qa', 'check.py'), 10, 5);
  for (let i = 0; i < 40; i++) put(path.join(dir, 'node_modules', 'pkg', `f${i}.js`), 1, 3);
  put(path.join(dir, '.git', 'HEAD'), 10); put(path.join(dir, '.git', 'objects', 'aa'), 10);
  for (let i = 0; i < 450; i++) put(path.join(dir, 'dump', `x${i}.txt`), 1, 3);   // an unknown folder with very many files
  put(path.join(dir, '.videohub', 'notes.json'), 10, 3);
  const outputs = [
    { path: path.join(dir, 'watch_v2.mp4'), rel: 'watch_v2.mp4', name: 'watch_v2.mp4', size: 2100, mtime: NOW, role: 'final', dur: 42 },
    { path: path.join(dir, 'watch_v1.mp4'), rel: 'watch_v1.mp4', name: 'watch_v1.mp4', size: 2000, mtime: NOW - 2 * DAY, role: 'final', dur: 41 },
    { path: path.join(dir, 'qa', 'clip.mp4'), rel: 'qa/clip.mp4', name: 'clip.mp4', size: 0, mtime: 0, role: 'clip' },   // listed by the scan, gone now
  ];
  const cand = [
    { id: 'c1', project: 'w', rule: 'oldChunks', preset: 'safe', checked: true, path: path.join(dir, 'render', 'chunks_v1'), dir: true, size: 120, action: 'recycle', reason: 'Old chunks.' },
    { id: 'c2', project: 'w', rule: 'qa', preset: 'safe', checked: true, path: path.join(dir, 'qa'), size: 500, files: Array.from({ length: 5 }, (_, i) => ({ path: path.join(dir, 'qa', `f${i}.png`), dir: false, size: 100 })), action: 'recycle', reason: 'QA frames.' },
    { id: 'c3', project: 'w', rule: 'oldVersion', preset: 'deep', checked: true, path: path.join(dir, 'watch_v1.mp4'), size: 2000, action: 'archive', reason: 'Old version.' },
  ];
  return { p: { id: 'w', path: dir, outputs, latest: 'watch_v2.mp4' }, cand, dir };
}
const G = (r, k) => r.groups.find(g => g.key === k);
const rels = (r, k) => G(r, k).rows.map(x => x.rel);

test('what a file is, and which folders are one row', () => {
  assert.equal(groupOf('scene.js'), 'source'); assert.equal(groupOf('vo.words.json'), 'voice'); assert.equal(groupOf('timings.json'), 'voice');
  assert.equal(groupOf('plan.json'), 'source'); assert.equal(groupOf('take.WAV'), 'voice'); assert.equal(groupOf('a.srt'), 'voice');
  assert.equal(groupOf('.codex_last_mug.png.txt'), 'other'); assert.equal(groupOf('.DS_Store'), 'other'); assert.equal(groupOf('.gitignore'), 'source');
  assert.equal(groupOf('m.GLB'), 'images'); assert.equal(groupOf('t.webp'), 'images'); assert.equal(groupOf('x.mp4'), 'renders'); assert.equal(groupOf('x.zip'), 'other');
  assert.equal(bulkHint('node_modules'), 'Installed packages'); assert.equal(bulkHint('chunks_prev'), 'Render chunks'); assert.equal(bulkHint('frames_hd'), 'Frame dumps');
  assert.equal(bulkHint('qa'), 'Check pictures and test clips'); assert.equal(bulkHint('scenes'), null);
});

test('a film folder grouped: renders from the scan, leftovers exactly as janitor lists them, big folders as one row', async () => {
  const { p, cand } = film();
  const r = await listFilmFiles(p, { candidates: cand, since: NOW - DAY, versions: [{ v: 1, file: 'watch_v1.mp4' }, { v: 2, file: 'watch_v2.mp4' }] });
  assert.deepEqual(rels(r, 'source'), ['facts.md', 'film.js', 'scenes/01.js']);
  assert.deepEqual(rels(r, 'voice'), ['vo.mp3', 'vo.words.json']);
  assert.deepEqual(rels(r, 'images'), ['models/watch.glb', 'textures/steel.png']);
  // the scan's videos (newest first, with version and role), a stray video, and a listed video that is gone
  assert.deepEqual(rels(r, 'renders'), ['watch_v2.mp4', 'stray_part.mp4', 'qa/clip.mp4']);
  const v2 = G(r, 'renders').rows[0]; assert.equal(v2.version, 2); assert.equal(v2.role, 'final'); assert.equal(v2.latest, true);
  // leftovers: one row per candidate, with janitor's reason and id; their files are nowhere else
  const L = G(r, 'leftovers');
  assert.deepEqual(L.rows.map(x => [x.rel, x.leftover.id, x.count]).sort(), [['qa', 'c2', 5], ['render/chunks_v1', 'c1', 12], ['watch_v1.mp4', 'c3', 1]]);
  assert.equal(L.rows.find(x => x.leftover.id === 'c3').leftover.action, 'archive');
  assert.equal(L.rows.find(x => x.leftover.id === 'c2').leftover.partial, true, 'scripts in the QA folder stay');
  // generated folders: one row each, counted; qa keeps only its script; .git is not looked at
  const gen = Object.fromEntries(G(r, 'generated').rows.map(x => [x.rel, x.count]));
  assert.deepEqual(gen, { 'render/chunks': 30, node_modules: 40, dump: 450, qa: 1, '.videohub': 1 });
  assert.equal(G(r, 'generated').rows.find(x => x.rel === 'dump').hint, 'Many files');
  assert.ok(!JSON.stringify(r).includes('.git'), '.git is skipped');
  assert.deepEqual(rels(r, 'other'), ['weird.bin']);
  // sizes and counts add up; changed recently
  assert.equal(r.total.size, r.groups.reduce((s, g) => s + g.size, 0));
  assert.equal(G(r, 'source').changed, 1); assert.equal(G(r, 'source').rows.find(x => x.rel === 'scenes/01.js').changed, true);
  assert.equal(G(r, 'renders').rows[0].changed, true); assert.equal(G(r, 'generated').changed, 0);
  assert.equal(r.leftoversPending, false); assert.equal(r.truncated, false);
});

test('janitor not ready yet; caps on rows and on the walk', async () => {
  const { p } = film();
  const pending = await listFilmFiles(p, { candidates: null, since: NOW - DAY });
  assert.equal(pending.leftoversPending, true); assert.equal(G(pending, 'leftovers').rows.length, 0);
  assert.ok(rels(pending, 'generated').includes('render/chunks_v1'), 'without janitor’s list the old chunks are just a generated folder');
  const capped = await listFilmFiles(p, { candidates: [], since: NOW - DAY, maxRows: 2 });
  const src = G(capped, 'source');
  assert.equal(src.rows.length, 2); assert.equal(src.more, 1); assert.equal(src.count, 3);
  assert.ok(src.rows.some(x => x.rel === 'scenes/01.js'), 'changed rows are kept first so the filter still finds them');
  const cut = await listFilmFiles(p, { candidates: [], maxEntries: 50 });
  assert.equal(cut.truncated, true);
});

test('a big film does not hold the event loop: the walk yields', async () => {
  const { p } = film();
  let yields = 0;
  await listFilmFiles(p, { candidates: [], breather: () => { yields++; return new Promise(r => setImmediate(r)); } });
  assert.ok(yields >= 3, 'yielded ' + yields + ' times for ~600 entries');
});

test('changed rule and paths from the page', () => {
  assert.deepEqual(changedRule(null, NOW), { kind: 'day', since: NOW - DAY });
  const s = changedRule({ startedAt: NOW - 3600e3, agentName: 'Codex', title: 'T', state: 'working' }, NOW);
  assert.equal(s.kind, 'session'); assert.equal(s.since, NOW - 3600e3); assert.equal(s.agent, 'Codex');
  assert.equal(changedRule({ startedAt: NOW - 30 * DAY }, NOW).kind, 'day', 'a session from weeks ago is not “current”');
  const p = { path: path.resolve('/films/watch'), outDir: path.resolve('/studio/out/watch') };
  assert.equal(resolveInFilm(p, 'scenes/01.js'), path.join(p.path, 'scenes', '01.js'));
  assert.equal(resolveInFilm(p, 'out/final.mp4'), path.join(p.outDir, 'final.mp4'));
  for (const bad of ['../x', 'a/../../x', '/etc/passwd', 'C:\\Windows', '\\\\srv\\x', '', '.', 'a\0b', null]) assert.equal(resolveInFilm(p, bad), null, JSON.stringify(bad));
});
