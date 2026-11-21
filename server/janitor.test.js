import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import test from 'node:test';
import path from 'node:path';
const norm = p => path.resolve(p).toLowerCase();

test('cleanup detects a recently updated render log with native path separators', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'videohub-cleanup-log-'));
  try {
    fs.mkdirSync(path.join(root, 'render'));
    fs.writeFileSync(path.join(root, 'render', 'log.txt'), 'render in progress');
    const { busyWhy } = await import('./janitor.js');
    assert.equal(busyWhy({ id: 'native-log-fixture', path: root }), 'render log updated in the last 10 minutes');
  } finally { fs.rmSync(root, { recursive: true }); }
});

test('cleanup preserves finals and review material and only releases approved chunks', async () => {
const root=fs.mkdtempSync(path.join(os.tmpdir(),'videohub-cleanup-test-'));
fs.mkdirSync(root,{recursive:true});
const {index}=await import('./scan.js');
const {findCandidates}=await import('./janitor.js');
const {config}=await import('./config.js');config().roots=[{path:root,type:'project',enabled:true}];
try {
const make=(name,bytes=1)=>{const f=path.join(root,name);fs.mkdirSync(path.dirname(f),{recursive:true});fs.writeFileSync(f,'x');if(bytes>1)fs.truncateSync(f,bytes);return f;};
const final=make('film_v2.mp4'),silent=make('render/video.mp4'),chunk=make('render/chunks/c_000.mp4',25*1024*1024);
const outsideFinal=make('out/film.mp4'),tempFinal=make('render/tmp/valuable.mp4'),backup=make('render/chunks_v1/c_000.mp4');
const now=Date.now();
const p={id:'cleanup-regression',path:root,name:'Fixture',title:'Fixture',status:'review',statusAuto:false,notesOpen:0,sizes:{chunk:25*1024*1024},latest:'film_v2.mp4',outputs:[
{path:final,rel:'film_v2.mp4',name:'film_v2.mp4',role:'final',mtime:now,audio:true},
{path:silent,rel:'render/video.mp4',name:'video.mp4',role:'silent',coveredBy:'film_v2.mp4',size:1},
{path:outsideFinal,rel:'out/film.mp4',name:'film.mp4',role:'final',mtime:now-1000,audio:true},
{path:tempFinal,rel:'render/tmp/valuable.mp4',name:'valuable.mp4',role:'final',mtime:now-1000,audio:true}
]};
index().projects=[p];
let c=await findCandidates(true);
assert(c.some(x=>x.path===silent));assert(c.some(x=>x.path.includes('chunks_v1')));
assert(!c.some(x=>x.rule==='chunks'));console.log('PASS review chunks preserved; silent duplicates and replaced chunks offered');
assert(!c.some(x=>x.path===path.join(root,'out')||x.path===path.join(root,'render','tmp')));console.log('PASS out and tmp folders containing final movies never offered');
p.status='done';p.statusAuto=true;c=await findCandidates(true);assert(!c.some(x=>x.rule==='chunks'));console.log('PASS automatic age-based status does not release chunks');
p.status='approved';p.statusAuto=false;c=await findCandidates(true);assert(c.some(x=>x.rule==='chunks'&&x.path===path.dirname(chunk)));console.log('PASS explicit approval releases only known chunk directories');
p.notesOpen=1;c=await findCandidates(true);assert(!c.some(x=>x.rule==='chunks'));console.log('PASS unresolved notes protect chunks');
p.notesOpen=0;fs.unlinkSync(final);c=await findCandidates(true);assert(!c.some(x=>x.path===silent));console.log('PASS missing voiced copy protects silent source');
console.log('NO cleanup executed; all assertions inspect candidate lists only.');
} finally { if(path.dirname(root)!==path.resolve(os.tmpdir()) || !path.basename(root).startsWith('videohub-cleanup-test-')) throw new Error('Unexpected test directory'); fs.rmSync(root,{recursive:true}); }
});

// render leftovers the banner asks about (server/leftovers.js): film_final copies, stale chunks; honest freed sizes
test('render leftovers: stale chunks after chunkDays, film_final copy of a version, hard links left alone, honest freed size', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'videohub-cleanup-test-'));
  const { index } = await import('./scan.js');
  const { findCandidates, configure } = await import('./janitor.js');
  const { config } = await import('./config.js'); config().roots = [{ path: root, type: 'project', enabled: true }]; config().chunkDays = 7;
  try {
    const make = (name, bytes = 1, fill = 'x') => { const f = path.join(root, name); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, Buffer.alloc(bytes, fill)); return f; };
    const v2 = make('film_v2.mp4', 2 << 20, 'a'), ff = make('film_final.mp4', 2 << 20, 'a'), v1 = make('film_v1.mp4', 2 << 20, 'b');
    const chunk = make('render/chunks/c_000.mp4'); fs.truncateSync(chunk, 25 << 20);
    const now = Date.now(), old = new Date(now - 8 * 864e5), older = new Date(now - 9 * 864e5);
    fs.utimesSync(chunk, old, old); fs.utimesSync(v1, older, older);
    const out = (f, mtime) => ({ path: f, rel: path.basename(f), name: path.basename(f), role: 'final', mtime, audio: true, size: fs.statSync(f).size });
    // film_final is older than film_v2 (the script wrote it, then the queue wrote the version): one film for baseName
    const p = { id: 'leftover-regression', path: root, rootType: 'project', name: 'Fixture', title: 'Fixture', status: 'review', statusAuto: false, notesOpen: 2, sizes: { chunk: 25 << 20 }, latest: 'film_v2.mp4',
      outputs: [out(v2, now), out(ff, now - 5000), out(v1, older.getTime())] };
    index().projects = [p]; index().dups = [{ size: 2 << 20, files: [{ path: ff, project: p.id, projectName: 'Fixture' }, { path: v2, project: p.id, projectName: 'Fixture' }] }];
    let c = await findCandidates(true);
    const stale = c.find(x => x.rule === 'staleChunks');
    assert(stale && stale.path === path.dirname(chunk) && stale.preset === 'deep' && stale.freed === 25 << 20, 'stale chunks offered even in review');
    const copy = c.filter(x => norm(x.path) === norm(ff));
    assert.equal(copy.length, 1); assert.equal(copy[0].rule, 'renderCopy'); assert.equal(copy[0].preset, 'safe'); assert.equal(norm(copy[0].copyOf), norm(v2)); assert.equal(copy[0].freed, 2 << 20);
    assert(!c.some(x => norm(x.path) === norm(v2)), 'the _vN version is never offered (not as old version, not as duplicate)');
    const oldV = c.find(x => norm(x.path) === norm(v1));
    assert(oldV && oldV.rule === 'oldVersion' && /film_v2\.mp4/.test(oldV.reason), 'an older version still goes to the archive, the latest being the version');
    // another hard link keeps the copy's data: it frees nothing, unless that link is the outputs-folder link that goes along
    const elsewhere = path.join(root, 'keep', 'other-link.mp4'); fs.mkdirSync(path.dirname(elsewhere)); fs.linkSync(ff, elsewhere);
    c = await findCandidates(true); assert.equal(c.find(x => x.rule === 'renderCopy').freed, 0);
    configure({ linkGoes: f => norm(f) === norm(ff) }); c = await findCandidates(true); assert.equal(c.find(x => x.rule === 'renderCopy').freed, 2 << 20);
    configure({ linkGoes: () => false }); fs.unlinkSync(elsewhere);
    // fresh chunks stay
    fs.utimesSync(chunk, new Date(), new Date()); c = await findCandidates(true); assert(!c.some(x => x.rule === 'staleChunks'), 'fresh chunks kept');
    // a hard link of the version is the same file: no copy
    fs.unlinkSync(ff); fs.linkSync(v2, ff); c = await findCandidates(true); assert(!c.some(x => x.rule === 'renderCopy'), 'hard link of the version is not a copy');
    // a film_final with other content is not a copy either
    fs.unlinkSync(ff); make('film_final.mp4', 2 << 20, 'c'); c = await findCandidates(true); assert(!c.some(x => x.rule === 'renderCopy'));
    // a busy film is left alone
    fs.unlinkSync(ff); make('film_final.mp4', 2 << 20, 'a'); fs.utimesSync(chunk, old, old); make('render/log.txt', 10);
    c = await findCandidates(true); assert(!c.some(x => x.rule === 'renderCopy' || x.rule === 'staleChunks'), 'busy film skipped');
  } finally {
    if (path.dirname(root) !== path.resolve(os.tmpdir()) || !path.basename(root).startsWith('videohub-cleanup-test-')) throw new Error('Unexpected test directory');
    fs.rmSync(root, { recursive: true });
  }
});

test('startClean with rules moves only items of those rules (the banner Clean now)', async () => {
  // (not under the temp folder: %TEMP% is a place the cleanup may work in)
  fs.mkdirSync(path.resolve('.test-tmp'), { recursive: true });
  const root = fs.mkdtempSync(path.resolve('.test-tmp', 'janitor-rules-'));
  const { index } = await import('./scan.js');
  const { findCandidates, startClean, onClean, PROMPT_RULES } = await import('./janitor.js');
  const { config } = await import('./config.js');
  try {
    const make = (name, bytes = 1) => { const f = path.join(root, name); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, Buffer.alloc(bytes, 'x')); return f; };
    const final = make('film_v2.mp4'), silent = make('render/video.mp4'), qa = make('qa/a.png', 2 << 20); make('render/chunks_v1/c_000.mp4');
    const old = new Date(Date.now() - 5 * 864e5); fs.utimesSync(qa, old, old);
    const p = { id: 'clean-rules', path: root, name: 'Fixture', title: 'Fixture', status: 'review', statusAuto: false, notesOpen: 0, sizes: {}, latest: 'film_v2.mp4', outputs: [
      { path: final, rel: 'film_v2.mp4', name: 'film_v2.mp4', role: 'final', mtime: Date.now(), audio: true, size: 1 },
      { path: silent, rel: 'render/video.mp4', name: 'video.mp4', role: 'silent', coveredBy: 'film_v2.mp4', size: 1 }] };
    config().roots = [{ path: root, type: 'project', enabled: true }]; index().projects = [p]; index().dups = [];
    const c = await findCandidates(true);
    assert(c.some(x => x.rule === 'qa') && c.some(x => x.rule === 'silent') && c.some(x => x.rule === 'oldChunks'));
    // nothing may really move in a test: the run refuses every path outside the configured folders
    config().roots = [{ path: path.join(root, 'elsewhere'), type: 'project', enabled: true }];
    assert(!norm(root).startsWith(norm(os.tmpdir()) + path.sep), 'the scratch folder must not be inside the temp folder');
    const done = new Promise(res => { const off = onClean(st => { if (st.state === 'done') { off(); res(st); } }); });
    await startClean(c.map(x => x.id), { rules: PROMPT_RULES, kind: 'leftovers' });
    const st = await done;
    assert.equal(st.kind, 'leftovers');
    assert.deepEqual(st.results.filter(r => r.path).map(r => r.rule).sort(), ['oldChunks', 'silent']);
    assert(st.results.every(r => !r.path || r.status === 'error'), 'outside the configured folders: nothing touched');
    assert(fs.existsSync(silent) && fs.existsSync(qa));
  } finally {
    if (path.dirname(root) !== path.resolve('.test-tmp') || !path.basename(root).startsWith('janitor-rules-')) throw new Error('Unexpected test directory');
    fs.rmSync(root, { recursive: true });
  }
});
