// "Finish film" (server/finish.js): synthetic film folders under .test-tmp, real files, hard links and junctions.
// Nothing here touches a Recycle Bin: the classifier only reads, and the one run test uses the archive action.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { classifyFilm, referencedBy, sameContent, createFinish, finishState, pick, summaryText } from './finish.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TMP = path.join(REPO, '.test-tmp');
function scratch(name) {
  const dir = path.join(TMP, `finish-${name}-${process.pid}-${Date.now().toString(36)}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}
function cleanup(dir) {
  if (!path.basename(dir).startsWith('finish-') || path.dirname(dir) !== TMP) throw new Error('unexpected test folder ' + dir);
  // links first, so nothing ever walks through one
  const unlinkLinks = d => { let es = []; try { es = fs.readdirSync(d, { withFileTypes: true }); } catch { return; } for (const e of es) { const f = path.join(d, e.name); if (e.isSymbolicLink()) fs.unlinkSync(f); else if (e.isDirectory()) unlinkLinks(f); } };
  unlinkLinks(dir); fs.rmSync(dir, { recursive: true, force: true });
}
const put = (root, rel, content = 'x') => { const f = path.join(root, ...rel.split('/')); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, content); return f; };
const bytes = (n, seed) => { const b = Buffer.alloc(n); for (let i = 0; i < n; i++) b[i] = (i * 31 + seed) & 255; return b; };
const junction = (target, at) => fs.symlinkSync(target, at, process.platform === 'win32' ? 'junction' : 'dir');
const out = (root, rel, role, extra = {}) => { const f = path.join(root, ...rel.split('/')); const st = fs.statSync(f); return { path: f, rel: rel.replaceAll('/', path.sep), name: path.basename(f), role, audio: role !== 'silent', size: st.size, mtime: st.mtimeMs, dur: 60, w: 1920, h: 1080, ...extra }; };
const byRel = (c, rel) => c.items.find(it => it.rel === rel);
const kindOf = (c, rel) => byRel(c, rel)?.kind;
const SMALL_SEQ = { seqMin: { bytes: 1, files: 5 } };

// the big-finished-film pattern: versions, a byte copy of the newest, render leftovers, referenced clips, stems,
// node_modules, check folders and a junction pointing outside the film
function saga() {
  const base = scratch('saga'), film = path.join(base, 'films', 'saga'), outside = path.join(base, 'outside');
  put(outside, 'precious.png', 'do not touch');
  const v4 = bytes(200000, 4);
  put(film, 'saga_v4.mp4', v4);
  put(film, 'film_final.mp4', v4);                                   // byte-for-byte copy under another name
  const near = Buffer.from(v4); near[100000] ^= 255; put(film, 'saga_final_mux.mp4', near);   // same size, other content
  put(film, 'saga_v3.mp4', bytes(190000, 3));
  put(film, 'saga_v2.mp4', bytes(180000, 2));
  put(film, 'render/video.mp4', bytes(150000, 9)); put(film, 'render/chunks/c_000.mp4', bytes(1000, 1)); put(film, 'render/chunks_v2/c_000.mp4', bytes(1000, 2));
  put(film, 'render/list.txt', "file 'chunks/c_000.mp4'"); put(film, 'render/manifest.json', '{"fps":60}'); put(film, 'render/videohub-x.log', 'log');
  for (let i = 1; i <= 8; i++) put(film, `clips/a2/${String(i).padStart(4, '0')}.jpg`, bytes(500, i));
  put(film, 'lib.js', "// clips: clips/<id>/0001.jpg\nfunction need(k, i) { return loadImg(`clips/${k}/${String(i).padStart(4, '0')}.jpg`); }\nconst holds = read('work/holds.json');");
  put(film, 'work/holds.json', '[]'); put(film, 'work/check.png', bytes(300, 5));
  put(film, 'index.html', '<link rel="stylesheet" href="style.css"><script src="lib.js"></script>');
  put(film, 'style.css', 'body { background: url(bg.png); }'); put(film, 'bg.png', bytes(400, 6));
  put(film, 'render.js', "fs.mkdirSync('snaps', { recursive: true });\n// node render.js snap → snaps/<t>.jpg\nconst out = path.join(__dirname, 'film_final.mp4');");
  put(film, 'snap.js', "const dir = path.join(__dirname, 'snaps'); for (const t of ts) shoot(`snaps/${t}.png`);");
  put(film, 'snaps/t1.png', bytes(700, 7)); put(film, 'snaps_v5/t2.png', bytes(700, 8));
  put(film, 'qa/look.png', bytes(600, 9)); put(film, 'qa/check_frames.py', 'print(1)');
  put(film, 'test_still.png', bytes(800, 10)); put(film, 'sheet3.jpg', bytes(800, 17)); put(film, '0042.png', bytes(800, 18)); put(film, 'zemin-secenekleri.jpg', bytes(800, 19)); put(film, 's1.jpg', bytes(800, 20)); put(film, 'thumbnail.png', bytes(800, 11)); put(film, '.codex_last.png.txt', 'tool');
  put(film, 'audio/mix.wav', bytes(5000, 12)); put(film, 'audio/vo.wav', bytes(4000, 13)); put(film, 'audio/music.wav', bytes(5000, 14));
  put(film, 'audio/stem_bed.npy', bytes(3000, 15)); put(film, 'audio/mix_old.wav', bytes(5000, 16)); put(film, 'words.json', JSON.stringify([[0, 1, 'thumbs'], [1, 2, 'snaps']]));
  put(film, 'package.json', '{}'); put(film, 'node_modules/three/index.js', 'export {}');
  put(film, '.videohub/notes.json', '[]'); put(film, 'fonts/a.woff2', 'f'); put(film, 'vendor/three.min.js', 'x');
  junction(outside, path.join(film, 'linked'));
  junction(outside, path.join(film, 'snaps', 'ext'));
  const p = { id: 'saga', name: 'saga', title: 'Saga', path: film, status: 'review', statusAuto: false, latest: 'saga_v4.mp4', meta: {}, updated: Date.now(),
    outputs: [out(film, 'saga_v4.mp4', 'final'), out(film, 'film_final.mp4', 'final', { mtime: Date.now() - 60e3 }), out(film, 'saga_final_mux.mp4', 'final', { mtime: Date.now() - 90e3 }),
      out(film, 'saga_v3.mp4', 'final', { mtime: Date.now() - 864e5 }), out(film, 'saga_v2.mp4', 'final', { mtime: Date.now() - 2 * 864e5 }),
      out(film, 'render/video.mp4', 'silent', { coveredBy: 'saga_v4.mp4' })] };
  return { base, film, outside, p };
}

test('finish: the big-finished-film pattern is classified as the owner expects', async () => {
  const { base, film, outside, p } = saga();
  try {
    const c = await classifyFilm(p, { roots: [path.dirname(film)], skillDirs: [], ...SMALL_SEQ });
    assert.equal(c.refused, null);
    // the newest version stays, once
    assert.equal(kindOf(c, 'saga_v4.mp4'), 'keep');
    // a byte copy goes to the Recycle Bin; a same-size file with other content is not a copy (archived as an older render)
    assert.equal(kindOf(c, 'film_final.mp4'), 'remove'); assert.match(byRel(c, 'film_final.mp4').reason, /Byte-for-byte copy of saga_v4\.mp4/);
    assert.equal(kindOf(c, 'saga_final_mux.mp4'), 'archive');
    assert.equal(kindOf(c, 'saga_v3.mp4'), 'archive'); assert.equal(kindOf(c, 'saga_v2.mp4'), 'archive');
    // render leftovers: silent intermediate, chunks, old chunks, concat list, log; the manifest stays
    for (const r of ['render/video.mp4', 'render/chunks', 'render/chunks_v2', 'render/list.txt', 'render/videohub-x.log']) assert.equal(kindOf(c, r), 'remove', r);
    assert.equal(kindOf(c, 'render'), 'keep');
    // referenced = keep: clips/ (a sequence the code reads) is optional, work/ (named in code) stays
    assert.equal(kindOf(c, 'clips'), 'optional'); assert.match(byRel(c, 'clips').reason, /lib\.js/);
    assert.equal(kindOf(c, 'work'), 'keep'); assert.match(byRel(c, 'work').reason, /Used by the film’s code \(lib\.js\)/);
    // check folders go even though snap.js and render.js name them (a check script, a write, a comment)
    assert.equal(kindOf(c, 'snaps_v5'), 'remove');
    const snaps = byRel(c, 'snaps'); assert.equal(snaps.kind, 'remove'); assert.equal(snaps.partial, true, 'a folder holding a link goes file by file');
    assert.deepEqual(snaps.files.map(f => path.basename(f.path)), ['t1.png']);
    const qa = byRel(c, 'qa'); assert.equal(qa.kind, 'remove'); assert.deepEqual(qa.files.map(f => path.basename(f.path)), ['look.png'], 'the check script stays');
    // loose stills: unused → remove; used by CSS or a thumbnail → keep; hidden tool files go
    assert.equal(kindOf(c, 'test_still.png'), 'remove'); assert.equal(kindOf(c, 'sheet3.jpg'), 'remove'); assert.equal(kindOf(c, '0042.png'), 'remove');
    // any other loose picture the code does not use (a style or option still) is optional
    for (const r of ['zemin-secenekleri.jpg', 's1.jpg']) { assert.equal(kindOf(c, r), 'optional', r); assert.match(byRel(c, r).reason, /^Loose picture, not used by the code/); } assert.equal(kindOf(c, 'bg.png'), 'keep'); assert.equal(kindOf(c, 'thumbnail.png'), 'keep');
    assert.equal(kindOf(c, '.codex_last.png.txt'), 'remove');
    // sound: the mix and the voice stay, stems and an old mix are optional
    assert.equal(kindOf(c, 'audio/music.wav'), 'optional'); assert.equal(kindOf(c, 'audio/stem_bed.npy'), 'optional'); assert.equal(kindOf(c, 'audio/mix_old.wav'), 'optional');
    assert.ok(!byRel(c, 'audio/mix.wav') && !byRel(c, 'audio/vo.wav'), 'mix and voice are part of the kept audio/ row');
    assert.equal(kindOf(c, 'audio'), 'keep');
    // node_modules beside a package.json: optional; code, fonts, vendor, .videohub, words.json stay
    assert.equal(kindOf(c, 'node_modules'), 'optional');
    for (const r of ['lib.js', 'index.html', 'fonts', 'vendor', '.videohub', 'words.json', 'package.json']) assert.equal(kindOf(c, r), 'keep', r);
    // the junction: kept, never followed (nothing outside the film is listed)
    assert.equal(kindOf(c, 'linked'), 'keep');
    assert.ok(c.items.every(it => !it.path.startsWith(outside) && !(it.files || []).some(f => f.path.startsWith(outside))));
    assert.ok(c.items.filter(it => it.kind !== 'keep').every(it => it.path.startsWith(film + path.sep)));
    // defaults: removals and archives ticked, optional not
    assert.ok(c.items.filter(it => it.kind === 'optional').every(it => !it.checked));
    assert.ok(c.items.filter(it => it.kind === 'remove' || it.kind === 'archive').every(it => it.checked));
    assert.match(summaryText('Saga', c, b => b + ' B'), /To the archive/);
    // the scan picked the unversioned copy as the newest: with equal links the copy named like a version stays
    const c3 = await classifyFilm({ ...p, latest: 'film_final.mp4' }, { roots: [], skillDirs: [], ...SMALL_SEQ });
    assert.equal(kindOf(c3, 'saga_v4.mp4'), 'keep'); assert.equal(kindOf(c3, 'film_final.mp4'), 'remove');
  } finally { cleanup(base); }
});

test('finish: space freed counts hard links honestly', async () => {
  const { base, film, p } = saga();
  try {
    const outputs = path.join(base, 'outputs'); fs.mkdirSync(outputs);
    fs.linkSync(path.join(film, 'saga_v2.mp4'), path.join(outputs, 'v2.mp4'));   // its outputs-folder link (follows it)
    fs.linkSync(path.join(film, 'saga_v3.mp4'), path.join(base, 'elsewhere.mp4'));   // a link nobody sends along
    const goes = new Set([path.join(film, 'saga_v2.mp4').toLowerCase()]);
    const c = await classifyFilm(p, { roots: [], skillDirs: [], linkGoes: f => goes.has(f.toLowerCase()), ...SMALL_SEQ });
    const v2 = byRel(c, 'saga_v2.mp4'), v3 = byRel(c, 'saga_v3.mp4'), copy = byRel(c, 'film_final.mp4');
    assert.equal(v2.freed, v2.size, 'the outputs link goes along: the space comes back');
    assert.equal(v3.freed, 0, 'another link keeps the data'); assert.match(v3.note, /frees no space/);
    assert.equal(copy.freed, copy.size);
    assert.equal(c.totals.archive.size - c.totals.archive.freed, v3.size);
    // a byte copy with an outputs-folder link of its own: the version (what versions.json points at) still stays; the
    // copy goes with its outputs link, so the space comes back
    fs.linkSync(path.join(film, 'film_final.mp4'), path.join(outputs, 'final.mp4'));
    const finalGoes = new Set([path.join(film, 'film_final.mp4').toLowerCase()]);
    const c2 = await classifyFilm(p, { roots: [], skillDirs: [], linkGoes: f => finalGoes.has(f.toLowerCase()), ...SMALL_SEQ });
    assert.equal(kindOf(c2, 'saga_v4.mp4'), 'keep'); assert.equal(kindOf(c2, 'film_final.mp4'), 'remove');
    assert.equal(byRel(c2, 'film_final.mp4').freed, byRel(c2, 'film_final.mp4').size);
    // even when the copy's extra link would stay (removing it frees nothing), the version keeps its name
    const c3 = await classifyFilm(p, { roots: [], skillDirs: [], ...SMALL_SEQ });
    assert.equal(kindOf(c3, 'saga_v4.mp4'), 'keep', 'the version name wins over link counts');
  } finally { cleanup(base); }
});

test('finish: copies are found by content, never by name', async () => {
  const base = scratch('copy');
  try {
    const a = put(base, 'a.mp4', bytes(9 << 20, 1)), b = put(base, 'b.mp4', bytes(9 << 20, 1));
    const d = Buffer.from(bytes(9 << 20, 1)); d[(9 << 20) >> 1] ^= 1; const c = put(base, 'film_final.mp4', d);   // differs only in the middle
    const st = f => ({ path: f, size: fs.statSync(f).size });
    assert.equal(await sameContent(st(a), st(b)), true);
    assert.equal(await sameContent(st(a), st(c)), false);
    put(base, 'short.mp4', bytes(100, 1));
    assert.equal(await sameContent(st(a), st(path.join(base, 'short.mp4'))), false);
  } finally { cleanup(base); }
});

test('finish: a mention counts only on a line that reads it', () => {
  const src = (rel, text) => ({ rel, text });
  assert.equal(referencedBy([src('lib.js', 'const x = loadImg(`clips/${k}/1.jpg`);')], 'clips', { dir: true }), 'lib.js');
  assert.equal(referencedBy([src('lib.js', '// frames: clips/<id>/0001.jpg')], 'clips', { dir: true }), null, 'a comment');
  assert.equal(referencedBy([src('render.js', "fs.mkdirSync('snaps', { recursive: true })")], 'snaps', { dir: true }), null, 'a write');
  assert.equal(referencedBy([src('render.js', "const OUT = path.join(__dirname, 'snaps')")], 'snaps', { dir: true }), null, 'an output folder');
  assert.equal(referencedBy([src('a.js', "const network = 'x'; get('network/')")], 'work', { dir: true }), null, 'part of another word');
  assert.equal(referencedBy([src('a.py', "data = open('work/holds.json').read()")], 'work', { dir: true }), 'a.py');
  assert.equal(referencedBy([src('s.js', "img.src = 'frame_' + i + '.png'")], 'frame_007.png'), 's.js', 'a numbered sequence');
  assert.equal(referencedBy([src('s.js', "img.src = `shot${i}.png`")], 'c7.jpg'), null);
  assert.equal(referencedBy([src('work/x.js', "read('work/a.json')")], 'work', { dir: true, inside: 'work' }), null, 'a folder does not keep itself');
});

test('finish: the never-list (studio engine, skills, scan root, busy film, links, media folders)', async () => {
  const base = scratch('never');
  try {
    // a studio engine with several scenes
    const studio = path.join(base, 'studio'); put(studio, 'make.mjs'); put(studio, 'scenes/a/scene.js'); put(studio, 'engine/index.html'); put(studio, 'snaps/x.png');
    let c = await classifyFilm({ id: 's', path: studio, outputs: [] }, {});
    assert.match(c.refused, /studio engine/); assert.equal(c.items.length, 0);
    c = await classifyFilm({ id: 's', path: path.join(studio, 'scenes', 'a'), studio, outputs: [] }, {});
    assert.match(c.refused, /scene of a studio/);
    // a film holding a studio engine: the engine stays as a whole
    const film = path.join(base, 'film'); put(film, 'index.html'); put(film, 'tmp/make.mjs'); put(film, 'tmp/scenes/a/scene.js'); put(film, 'tmp/engine/index.html');
    c = await classifyFilm({ id: 'f', path: film, outputs: [] }, {});
    assert.equal(kindOf(c, 'tmp'), 'keep');
    // skills: a film inside a skills folder is refused; a skills folder inside a film never moves, even named like a test folder
    const skills = path.join(base, 'home', '.claude', 'skills'); put(skills, 'demo/SKILL.md'); put(skills, 'demo/snaps/a.png');
    c = await classifyFilm({ id: 'k', path: path.join(skills, 'demo'), outputs: [] }, { skillDirs: [skills] });
    assert.match(c.refused, /skills/);
    const f2 = path.join(base, 'film2'); put(f2, 'test/skills/x/SKILL.md'); put(f2, 'test/a.png'); put(f2, 'snaps/a.png');
    c = await classifyFilm({ id: 'f2', path: f2, outputs: [] }, { skillDirs: [path.join(f2, 'test', 'skills')] });
    assert.notEqual(kindOf(c, 'test'), 'remove');
    assert.ok(c.items.filter(it => it.kind !== 'keep').every(it => !it.path.includes(path.join('test', 'skills'))));
    assert.equal(kindOf(c, 'snaps'), 'remove');
    // a scan root inside a film (even one named like a check folder) never moves; a watched folder itself is not a film
    c = await classifyFilm({ id: 'f2', path: f2, outputs: [] }, { roots: [path.join(f2, 'snaps')] });
    assert.equal(kindOf(c, 'snaps'), 'keep');
    c = await classifyFilm({ id: 'r', path: base, rootType: 'container', outputs: [] }, { roots: [base] });
    assert.match(c.refused, /watched folder/);
    // a film with a running or queued render
    c = await classifyFilm({ id: 'f2', path: f2, outputs: [] }, { busy: 'a render is in the VideoHub queue' });
    assert.match(c.refused, /render is in the VideoHub queue/);
    // a folder of finished videos, loose videos of a media folder, a film folder that is itself a link
    assert.match((await classifyFilm({ id: 'm', path: f2, rootType: 'media', outputs: [] }, {})).refused, /finished videos/);
    assert.match((await classifyFilm({ id: 'g', path: f2, group: 'x', outputs: [] }, {})).refused, /finished videos/);
    const ln = path.join(base, 'linkfilm'); junction(f2, ln);
    assert.match((await classifyFilm({ id: 'l', path: ln, outputs: [] }, {})).refused, /link/);
    // without a finished video, render files stay
    const f3 = path.join(base, 'film3'); put(f3, 'render/chunks/c_000.mp4'); put(f3, 'render/video.mp4');
    c = await classifyFilm({ id: 'f3', path: f3, outputs: [] }, {});
    assert.equal(kindOf(c, 'render'), 'keep'); assert.equal(c.totals.remove.count, 0);
  } finally { cleanup(base); }
});

test('finish: finished, looks finished, and what the user picks', () => {
  const now = Date.now(), fin = { rel: 'a.mp4', role: 'final' };
  assert.equal(finishState({ status: 'approved', statusAuto: false, outputs: [] }, now), 'finished');
  assert.equal(finishState({ status: 'done', statusAuto: true, latest: 'a.mp4', outputs: [fin], updated: now - 15 * 864e5 }, now), 'looks');
  assert.equal(finishState({ status: 'review', latest: 'a.mp4', outputs: [fin], updated: now - 8 * 864e5 }, now), 'looks', 'a final and 7 days without a change');
  assert.equal(finishState({ status: 'review', latest: 'a.mp4', outputs: [fin], updated: now - 3 * 864e5 }, now), null);
  assert.equal(finishState({ status: 'review', latest: null, outputs: [], updated: now - 30 * 864e5 }, now), null);
  assert.equal(finishState({ status: 'approved', studio: 'x', outputs: [] }, now), null);
  const c = { items: [{ id: 'r', kind: 'remove' }, { id: 'a', kind: 'archive' }, { id: 'o', kind: 'optional' }, { id: 'k', kind: 'keep' }] };
  assert.deepEqual(pick(c).map(i => i.id), ['r', 'a']);
  assert.deepEqual(pick(c, { optional: ['o'] }).map(i => i.id), ['r', 'a', 'o']);
  assert.deepEqual(pick(c, { ids: ['o', 'k'] }).map(i => i.id), ['o'], 'what stays can never be chosen');
});

test('finish: starting a run re-checks the film, maps actions, never moves links, and marks only tidied films approved', async () => {
  const { base, film, p } = saga();
  try {
    const started = [], status = [];
    const fin = createFinish({ projects: () => [p], project: id => id === p.id ? p : null, busyWhy: () => null, roots: () => [path.dirname(film)], skillDirs: () => [], linkGoes: () => false,
      startCleanItems: (items, opts) => { started.push({ items, opts }); return { id: 'c1', state: 'running' }; }, setStatus: async (id, s) => { status.push([id, s]); p.status = s; } });
    const c = await fin.classify(p.id);
    const ids = c.items.filter(it => it.kind === 'remove' || it.kind === 'archive').map(it => it.id);
    const opt = c.items.find(it => it.rel === 'node_modules').id;
    const r = await fin.start([{ id: p.id, ids: [...ids, opt, c.items.find(it => it.rel === 'linked').id] }]);
    assert.equal(r.id, 'c1');
    const { items, opts } = started[0];
    assert.deepEqual(opts, { kind: 'finish', films: ['saga'] });
    assert.ok(items.some(it => it.path.endsWith('node_modules') && it.action === 'recycle'));
    assert.ok(items.filter(it => /saga_v[23]\.mp4$/.test(it.path)).every(it => it.action === 'archive'));
    assert.ok(!items.some(it => it.path.endsWith('linked')), 'a kept link is never sent');
    assert.ok(items.every(it => it.project === 'saga' && it.projectName === 'Saga'));
    assert.deepEqual(status, [], 'nothing is marked before the run ends');
    // the run ended: only a film with something really tidied is marked approved
    assert.deepEqual(await fin.afterRun({ kind: 'finish', films: ['saga', 'other'], results: [{ projectId: 'saga', status: 'ok' }, { projectId: 'other', status: 'error' }] }), ['saga']);
    assert.deepEqual(status, [['saga', 'approved']]);
    assert.deepEqual(await fin.afterRun({ kind: 'cleanup', films: [], results: [{ projectId: 'saga', status: 'ok' }] }), [], 'an ordinary cleanup marks nothing');
    // a busy film is refused and nothing starts
    const busy = createFinish({ projects: () => [p], project: () => p, busyWhy: () => 'currently rendering', roots: () => [], skillDirs: () => [], linkGoes: () => false, startCleanItems: () => { throw new Error('must not start'); }, setStatus: async () => { } });
    await assert.rejects(busy.start([{ id: p.id }]), /currently rendering/);
    // "Films with leftovers" counts every film in the background, also one that is not finished
    p.status = 'review'; p.statusAuto = false; p.updated = Date.now();
    fin.invalidate();
    const l1 = fin.list(); assert.equal(l1.pending, true); assert.equal(l1.total, 1);
    await new Promise(r => setTimeout(r, 400));
    const l2 = fin.list(); assert.equal(l2.pending, false); assert.equal(l2.films.length, 1);
    assert.equal(l2.films[0].state, null); assert.ok(l2.films[0].frees > 0 && l2.films[0].totals.optional.size > 0);
  } finally { cleanup(base); }
});

test('finish: a run through the janitor archives a chosen old version (one run at a time)', async () => {
  const base = scratch('run');
  const { config } = await import('./config.js');
  const { index } = await import('./scan.js');
  const { startCleanItems, onClean } = await import('./janitor.js');
  const saved = { roots: config().roots, archiveDir: config().archiveDir };
  try {
    const film = path.join(base, 'films', 'f'); const old = put(film, 'f_v1.mp4', bytes(5000, 1)); put(film, 'f_v2.mp4', bytes(5000, 2));
    config().roots = [{ path: path.join(base, 'films'), type: 'container', enabled: true }];
    config().archiveDir = path.join(base, 'archive');
    index().projects = [{ id: 'f', path: film, name: 'f', outputs: [] }];
    const done = new Promise(res => { const off = onClean(st => { if (st.state === 'done') { off(); res(st); } }); });
    const st = startCleanItems([{ id: 'x', project: 'f', projectName: 'F', path: old, size: 5000, freed: 5000, action: 'archive', rule: 'oldVersion' }], { kind: 'finish', films: ['f'] });
    assert.equal(st.kind, 'finish'); assert.deepEqual(st.films, ['f']);
    assert.throws(() => startCleanItems([{ id: 'y', path: old, action: 'archive' }]), /already running/);
    const end = await done;
    assert.equal(end.ok, 1, JSON.stringify(end.results)); assert.equal(end.freed, 5000);
    assert.equal(fs.existsSync(old), false);
    const archived = end.results[0].to; assert.ok(archived.startsWith(config().archiveDir)); assert.equal(fs.statSync(archived).size, 5000);
  } finally { Object.assign(config(), saved); index().projects = []; cleanup(base); }
});
