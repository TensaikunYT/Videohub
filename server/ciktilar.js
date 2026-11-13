// The global outputs folder (config.outputsDir, default Documents\VideoHub\outputs): every finished render's MP4 in one
// place, named "2026-11-03 My film v2.mp4", so nobody has to dig through project folders.
// Each file is an NTFS hard link to the render (the same data under a second name: no extra disk space; deleting either
// name keeps the other). Only when a link is impossible (another drive) is it a copy. Index: data/ciktilar.json.
//   linkOutput(file, {title, v, kind})  a new render (jobs.js register: queue + hub_register_version)
//   sync()                              after every scan: each project's newest final (the first run fills the folder)
//   afterClean(results)                 the janitor removed renders: their links go to the Recycle Bin too, or the disk
//                                       space would never come back (the data stays in the Bin / archive)
// The folder is outside every scan root and the scan skips it, so it is never a project or a duplicate.
// Every video goes into a folder per day, <outputs>\2026-11-08\…;
// videos left in the top folder by older versions are moved into their day's folder once (tidy, on the first sync).
import fs from 'node:fs';
import path from 'node:path';
import { reveal } from './platform.js';
import { index } from './scan.js';
import { recyclePaths } from './janitor.js';
import { vhDir } from './notes.js';
import { outputsDir } from './ciktilar-dir.js';
import { DATA_DIR, readJson, writeJson, isInside, norm } from './util.js';

const IDX = path.join(DATA_DIR, 'ciktilar.json');
let idx = null;
const load = () => idx || (idx = readJson(IDX, {}));
const save = () => writeJson(IDX, idx);
const key = norm;
const clean = (s) => String(s || '').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '-').replace(/\s+/g, ' ').trim().slice(0, 110);
const fid = (f) => { try { const s = fs.statSync(f, { bigint: true }); return s.dev + ':' + s.ino; } catch { return null; } };
const day = (t) => { const d = new Date(t); const z = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`; };
const DAY_RE = /^(\d{4}-\d{2}-\d{2})(?: |$)/;
const dayDir = (d) => { const dir = path.join(outputsDir(), d); fs.mkdirSync(dir, { recursive: true }); return dir; };
const free = (dir, base, ext) => { let f = path.join(dir, base + ext); for (let n = 2; fs.existsSync(f); n++) f = path.join(dir, `${base} (${n})${ext}`); return f; };

// videos in the top folder (named "YYYY-MM-DD …") → their day's folder; the index follows. A file that cannot be
// moved (open in a player) stays and is tried again on the next start.
let tidied = false;
export function tidy() {
  tidied = true;
  const root = outputsDir(); let es = [], n = 0;
  try { es = fs.readdirSync(root, { withFileTypes: true }); } catch { return 0; }
  const I = load(), byLink = new Map(Object.entries(I).map(([s, e]) => [key(e.link), s]));
  for (const e of es) {
    const m = e.isFile() && DAY_RE.exec(e.name); if (!m) continue;
    const from = path.join(root, e.name), ext = path.extname(e.name);
    const to = free(dayDir(m[1]), e.name.slice(0, e.name.length - ext.length), ext);
    try { fs.renameSync(from, to); } catch { continue; }
    const src = byLink.get(key(from)); if (src) I[src].link = to;
    n++;
  }
  // entries still pointing at the top folder (a hub that ran during a tidy saved its older index): find the day folder
  for (const e of Object.values(I)) {
    if (!e?.link || fs.existsSync(e.link)) continue;
    const b = path.basename(e.link), m = DAY_RE.exec(b), g = m && path.join(root, m[1], b);
    if (g && fs.existsSync(g)) { e.link = g; n++; }
  }
  if (n) save();
  return n;
}

export function linkOutput(file, { title, v, kind, when } = {}) {
  try {
    if (!file || !fs.existsSync(file)) return null;
    const I = load(), k = key(file), id = fid(file);
    const prev = I[k];
    if (prev && fs.existsSync(prev.link) && (prev.mode === 'copy' || fid(prev.link) === id)) return prev.link;   // already there
    const ext = path.extname(file) || '.mp4';
    const d = day(when || fs.statSync(file).mtimeMs);
    const base = `${d} ${clean(title || path.basename(file, ext))}${v ? ' v' + v : ''}${kind === 'preview' ? ' preview' : ''}`;
    const dir = dayDir(d);
    let dest = path.join(dir, base + ext);
    for (let n = 2; fs.existsSync(dest); n++) {
      if (fid(dest) === id) { I[k] = { link: dest, mode: 'link', at: new Date().toISOString() }; save(); return dest; }   // same file, already linked
      dest = path.join(dir, `${base} (${n})${ext}`);
    }
    let mode = 'link';
    try { fs.linkSync(file, dest); } catch { fs.copyFileSync(file, dest, fs.constants.COPYFILE_EXCL); mode = 'copy'; }   // another drive: a copy
    I[k] = { link: dest, mode, at: new Date().toISOString() }; save();
    return dest;
  } catch (e) { console.error('outputs:', e.message); return null; }
}

// each project's newest final film (not old versions, clips, previews or silent intermediates); finished-video folders
// (media roots) are the user's own uploads, not renders
export function sync() {
  if (!tidied) try { tidy(); } catch (e) { console.error('outputs tidy:', e.message); }
  let n = 0;
  for (const p of index().projects || []) {
    if (p.rootType === 'media' || !p.latest) continue;
    const o = (p.outputs || []).find((x) => x.rel === p.latest);
    if (!o || o.role !== 'final') continue;
    if (load()[key(o.path)]) continue;
    let v = null; try { v = (readJson(path.join(vhDir(p), 'versions.json'), []).find((x) => x.file === o.rel) || {}).v || null; } catch { }
    if (!v) { const m = /_v(\d+)(?:[_.]|$)/i.exec(o.name); v = m ? +m[1] : null; }
    if (linkOutput(o.path, { title: p.title || p.name, v, when: o.mtime })) n++;
  }
  return n;
}

// renders the janitor just recycled or archived: their links follow to the Recycle Bin (never deleted outright)
export async function afterClean(results) {
  const gone = (results || []).filter((r) => r.status === 'ok' && r.path).map((r) => r.path);
  if (!gone.length) return 0;
  const I = load(), links = [];
  for (const [src, e] of Object.entries(I)) {
    if (fs.existsSync(src) || !fs.existsSync(e.link)) continue;
    if (gone.some((g) => key(g) === src || isInside(src, g))) links.push(src);
  }
  if (!links.length) return 0;
  const res = await recyclePaths(links.map((s) => ({ path: I[s].link })));
  for (const s of links) if (!fs.existsSync(I[s].link)) delete I[s];
  save();
  return res.filter((r) => r.ok).length;
}

// the folder's facts: videos, their size, and the space they really take (a hard link of an existing file takes none)
export function stats() {
  const dir = outputsDir(); let count = 0, total = 0, extra = 0;
  const add = (f) => { let st; try { st = fs.statSync(f); } catch { return; } if (!st.isFile()) return; count++; total += st.size; if (!(st.nlink > 1)) extra += st.size; };
  let es = []; try { es = fs.readdirSync(dir, { withFileTypes: true }); } catch { }
  for (const e of es) {
    if (e.isFile()) add(path.join(dir, e.name));
    else if (e.isDirectory() && DAY_RE.test(e.name)) { let sub = []; try { sub = fs.readdirSync(path.join(dir, e.name)); } catch { } for (const s of sub) add(path.join(dir, e.name, s)); }   // day folders
  }
  return { dir, count, total, extra };
}

export function routes(route) {
  route('GET', '/api/ciktilar', () => stats());
  route('POST', '/api/ciktilar/open', async () => {
    const dir = outputsDir(); fs.mkdirSync(dir, { recursive: true });
    if (!process.env.VIDEOHUB_NO_WINDOW) await reveal(dir);
    return { ok: true, dir };
  });
}
