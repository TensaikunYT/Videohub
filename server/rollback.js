// SHA-256 snapshots and verified full restore for a film project.
//
// Why: every agent edit must be reversible to the exact bytes it started from. Git is not assumed.
// A snapshot copies the project's code and assets (not .videohub notes, not backups/snapshots) and
// writes a MANIFEST.json with a SHA-256 per file plus one manifest SHA. restore() verifies the
// snapshot, copies the exact files back, removes files the edit added, and verifies the project
// again before reporting success.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const SNAP_DIR = 'snapshots';
export const BACKUP_DIR = 'backups';
const TOP_SKIP = new Set([SNAP_DIR, BACKUP_DIR, '.videohub', 'node_modules', '.git']);
const sha = p => {
  const h = crypto.createHash('sha256');
  const fd = fs.openSync(p, 'r');
  try {
    const b = Buffer.allocUnsafe(1 << 20);
    for (;;) {
      const n = fs.readSync(fd, b, 0, b.length, null);
      if (!n) break;
      h.update(b.subarray(0, n));
    }
  } finally { fs.closeSync(fd); }
  return h.digest('hex');
};
const rel = (p, root) => path.relative(root, p).split(path.sep).join('/');
const validId = id => /^[A-Za-z0-9._-]+$/.test(id || '');
const stamp = () => new Date().toISOString().replace(/[:.]/g, '-');

function walk(root, { skipTop = TOP_SKIP, filter = null } = {}) {
  const out = [];
  const rec = (dir, relDir) => {
    let ents;
    try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      const r = relDir ? relDir + '/' + e.name : e.name;
      if (!relDir && skipTop.has(e.name)) continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { rec(p, r); continue; }
      if (!e.isFile()) continue;
      if (filter && !filter(r)) continue;
      out.push({ path: r, abs: p, size: fs.statSync(p).size });
    }
  };
  rec(root, '');
  return out.sort((a, b) => a.path.localeCompare(b.path));
}

function manifestSha(files) {
  const h = crypto.createHash('sha256');
  for (const f of files) h.update(f.path + '\0' + f.sha256 + '\0' + f.size + '\n');
  return h.digest('hex');
}

export const MAX_SNAPSHOTS = 20;
const snapRoot = p => path.join(p.path, SNAP_DIR);
export function list(p) {
  const dir = snapRoot(p);
  let names = [];
  try { names = fs.readdirSync(dir, { withFileTypes: true }).filter(e => e.isDirectory()).map(e => e.name); } catch { return []; }
  const out = [];
  for (const name of names) {
    try {
      const m = JSON.parse(fs.readFileSync(path.join(dir, name, 'MANIFEST.json'), 'utf8'));
      out.push({ id: name, kind: m.kind, createdAt: m.createdAt, label: m.label || '', runId: m.runId || null, noteIds: m.noteIds || [], prompt: m.prompt || '', sha256: m.sha256, fileCount: (m.files || []).length, bytes: m.bytes || 0, hasFiles: m.files && m.files.length > 0 });
    } catch { }
  }
  return out.sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
}

export function snapshot(p, { kind = 'manual', label = '', runId = null, noteIds = [], prompt = '', files = null } = {}) {
  const id = stamp() + '_' + kind + '_' + crypto.randomBytes(3).toString('hex');
  const dir = path.join(snapRoot(p), id), filesDir = path.join(dir, 'files');
  fs.mkdirSync(filesDir, { recursive: true });
  const source = files || walk(p.path);
  const rows = [];
  for (const f of source) {
    const dest = path.join(filesDir, f.path);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(f.abs, dest);
    const after = sha(dest);
    rows.push({ path: f.path, sha256: after, size: fs.statSync(dest).size });
  }
  const m = {
    id, kind, createdAt: new Date().toISOString(), project: p.path, label, runId,
    noteIds: (noteIds || []).map(Number), prompt: String(prompt || ''),
    files: rows, fileCount: rows.length, bytes: rows.reduce((n, x) => n + x.size, 0),
  };
  m.sha256 = manifestSha(rows);
  fs.writeFileSync(path.join(dir, 'MANIFEST.json'), JSON.stringify(m, null, 2));
  prune(p);
  return m;
}

// Rolling history: keep the newest MAX_SNAPSHOTS versions and drop older snapshot folders.
function prune(p) {
  const all = list(p);
  if (all.length <= MAX_SNAPSHOTS) return;
  for (const s of all.slice(0, all.length - MAX_SNAPSHOTS)) {
    try { fs.rmSync(path.join(snapRoot(p), s.id), { recursive: true, force: true }); } catch { }
  }
}

export function load(p, id) {
  if (!validId(id)) throw Object.assign(new Error('Bad snapshot id'), { code: 400 });
  const file = path.join(snapRoot(p), id, 'MANIFEST.json');
  if (!fs.existsSync(file)) throw Object.assign(new Error('Snapshot not found: ' + id), { code: 404 });
  const m = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (m.sha256 !== manifestSha(m.files || [])) throw Object.assign(new Error('Snapshot manifest failed its own SHA check'), { code: 409 });
  return m;
}

// Every file in the snapshot is verified, the project is brought to exactly that file set, then the
// project is verified again. .videohub (notes, project settings) is never touched.
export function restore(p, id) {
  const m = load(p, id);
  const dir = path.join(snapRoot(p), id, 'files');
  for (const f of m.files) {
    const src = path.join(dir, f.path);
    if (!fs.existsSync(src)) throw Object.assign(new Error('Snapshot file missing: ' + f.path), { code: 409 });
    if (sha(src) !== f.sha256) throw Object.assign(new Error('Snapshot file SHA mismatch: ' + f.path), { code: 409 });
  }
  const want = new Map(m.files.map(f => [f.path, f]));
  for (const f of walk(p.path)) {
    if (want.has(f.path)) continue;
    fs.rmSync(f.abs, { force: true });
  }
  for (const f of m.files) {
    const dest = path.join(p.path, f.path);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(path.join(dir, f.path), dest);
  }
  const bad = [];
  for (const f of m.files) {
    const dest = path.join(p.path, f.path);
    if (!fs.existsSync(dest) || sha(dest) !== f.sha256) bad.push(f.path);
  }
  const extra = walk(p.path).filter(f => !want.has(f.path)).map(f => f.path);
  if (bad.length || extra.length) throw Object.assign(new Error('Restore verification failed: ' + [...bad, ...extra].slice(0, 5).join(', ')), { code: 409 });
  return { ok: true, snapshot: m.id, sha256: m.sha256, fileCount: m.files.length, files: m.files.map(f => f.path), restoredAt: new Date().toISOString() };
}

// The newest pre-edit snapshot that belongs to this note. This is what Undo Last Edit restores.
export function lastForNote(p, noteId) {
  const all = list(p).filter(s => s.kind === 'before' && s.noteIds.includes(Number(noteId)));
  return all.length ? all[all.length - 1] : null;
}

export function status(p, noteId) {
  const s = lastForNote(p, noteId);
  if (!s) return { available: false, noteId: Number(noteId), reason: 'No pre-edit snapshot was recorded for this note.' };
  let verified = true, error = null;
  try { load(p, s.id); } catch (e) { verified = false; error = e.message; }
  return { available: verified, noteId: Number(noteId), snapshot: s, reason: verified ? null : error };
}
