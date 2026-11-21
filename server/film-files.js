// A film's Files tab (GET /api/project/:id/files): the film folder grouped into Source, Voice and sound, Images and
// models, Renders, Generated folders, Other files and Leftovers, with sizes and a "changed recently" mark.
//
// - Renders are the film's videos as the scan knows them (role, version from .videohub/versions.json, date).
// - Leftovers are exactly the cleanup candidates server/janitor.js lists for this film, with its reason; cleaning
//   them goes through the existing cleanup run (POST /api/disk/clean) and its confirmation, never through here.
// - Big generated folders (render chunks, frame dumps, QA / preview pictures, node_modules, temp files, .videohub,
//   any folder with hundreds of entries) are one row with a file count and size, never thousands of rows.
// - The walk yields every 300 entries like scan.js (each await is slow while the hub is busy, e.g. right after start
//   when the cleanup scan walks %TEMP%); .git is skipped; it stops after MAX_ENTRIES and says so.
import fsDefault from 'node:fs';
import pathDefault from 'node:path';
import { pathKey as pathKeyDefault } from './platform.js';

export const GROUPS = [
  ['source', 'Source'], ['voice', 'Voice and sound'], ['images', 'Images and models'], ['renders', 'Renders'],
  ['generated', 'Generated folders'], ['other', 'Other files'], ['leftovers', 'Leftovers'],
];
export const MAX_ROWS = 400;          // listed rows per group; the rest is counted ("and 1,234 more")
export const MAX_ENTRIES = 250000;    // files and folders walked before the listing stops (and says so)
const BIG_DIR = 400;                  // a folder with more entries than this is one row
const SKIP = new Set(['.git', '.videohub-trash']);

const WORDS = /(^|[._-])words?\.json$|(^|[._-])(timings?|alignment)\.json$/i;
const VOICE = /\.(wav|mp3|m4a|aac|flac|ogg|oga|opus|aiff?|wma|srt|vtt|ass|ssa|lrc)$/i;
const VIDEO = /\.(mp4|mov|webm|mkv|m4v|avi)$/i;
const IMAGES = /\.(png|jpe?g|webp|gif|bmp|svg|avif|tiff?|psd|exr|hdr|ico|glb|gltf|fbx|obj|mtl|stl|ply|usdz?|blend|dae|3ds|ktx2|basis)$/i;
const SOURCE = /\.(m?js|cjs|ts|tsx|jsx|mts|py|json|jsonc|json5|md|markdown|txt|html?|css|scss|less|glsl|frag|vert|wgsl|hlsl|ya?ml|toml|ini|cfg|conf|sh|ps1|cmd|bat|csv|tsv|xml|snipp|lua|rb|go|rs|java|c|cc|cpp|h|hpp|cs|svelte|vue|env|lock)$|^(dockerfile|makefile|\.gitignore|\.editorconfig|\.npmrc)$/i;

// what a file is, by its name (videos only land here when the scan does not list them, e.g. a stray part file)
export function groupOf(name) {
  // hidden helper files that tools leave next to their output (".codex_last_x.png.txt", ".DS_Store") are not the film's source
  if (name.startsWith('.') && !/^\.(gitignore|editorconfig|npmrc)$/i.test(name)) return 'other';
  if (WORDS.test(name) || VOICE.test(name)) return 'voice';
  if (VIDEO.test(name)) return 'renders';
  if (IMAGES.test(name)) return 'images';
  if (SOURCE.test(name)) return 'source';
  return 'other';
}
// folders that are generated in bulk: one row each
const BULK = [
  [/^node_modules$/i, 'Installed packages'],
  [/^chunks(_.+)?$/i, 'Render chunks'],
  [/^frames?([_-].*)?$/i, 'Frame dumps'],
  [/^(qa|snaps|shots|sheets?|lookdev|previews?|bench|compare|contact)$/i, 'Check pictures and test clips'],
  [/^(tmp|temp|profiles|tmp_profiles|\.render|\.tmp)$/i, 'Temporary render files'],
  [/^(\.cache|__pycache__|\.parcel-cache|\.vite)$/i, 'Cache'],
  [/^\.videohub$/i, 'VideoHub’s notes, versions and pictures'],
];
export const bulkHint = name => (BULK.find(([re]) => re.test(name)) || [])[1] || null;

const toRel = (path, base, p) => path.relative(base, p).split(path.sep).join('/');

// p: the scanned project; candidates: janitor's list for this film (or null while it is not ready);
// since: files modified at or after this time count as "changed recently"; versions: [{ v, file }]
export async function listFilmFiles(p, { candidates = null, since = 0, versions = [], fs = fsDefault, path = pathDefault, key = pathKeyDefault,
  maxRows = MAX_ROWS, maxEntries = MAX_ENTRIES, breather = () => new Promise(r => setImmediate(r)) } = {}) {
  const t0 = Date.now();
  const bases = [{ dir: p.path, prefix: '' }];
  if (p.outDir && p.outDir !== p.path) bases.push({ dir: p.outDir, prefix: 'out/' });   // a studio scene renders into out/<scene>
  const relOf = file => {
    for (const b of bases.slice().reverse()) { const k = key(b.dir), fk = key(file); if (fk === k || fk.startsWith(k + path.sep) || fk.startsWith(k + '/')) return b.prefix + toRel(path, b.dir, file); }
    return path.basename(file);
  };
  const groups = new Map(GROUPS.map(([k, name]) => [k, { key: k, name, size: 0, count: 0, changed: 0, rows: [], more: 0 }]));
  const changedAt = m => !!since && m >= since;

  // leftovers: every janitor candidate is one row; the files inside it are counted there and nowhere else
  const left = (candidates || []).map(c => {
    const units = c.files ? c.files.map(u => ({ k: key(u.path), dir: !!u.dir })) : [{ k: key(c.path), dir: !!c.dir }];
    return { c, units, row: { rel: relOf(c.path), name: path.basename(c.path), kind: c.dir || c.files ? 'folder' : 'file', size: 0, count: 0, mtime: 0, changed: false,
      leftover: { id: c.id, rule: c.rule, reason: c.reason, action: c.action, preset: c.preset, checked: !!c.checked, size: c.size || 0, partial: !!c.files } } };
  });
  const leftoverOf = fk => left.find(l => l.units.some(u => u.k === fk || (u.dir && (fk.startsWith(u.k + path.sep) || fk.startsWith(u.k + '/'))))) || null;
  const leftoverDir = dk => left.find(l => l.units.length === 1 && l.units[0].dir && l.units[0].k === dk) || null;

  // the scan's videos (renders), with their version when VideoHub registered one
  const vByRel = new Map((versions || []).filter(v => v && v.file).map(v => [String(v.file).replaceAll('\\', '/').toLowerCase(), v.v]));
  const outs = new Map((p.outputs || []).map(o => [key(o.path), o]));
  const seenOut = new Set();
  const renderRow = (o, st) => ({ rel: relOf(o.path), name: o.name || path.basename(o.path), kind: 'file', size: st?.size ?? o.size ?? 0, mtime: st?.mtimeMs ?? o.mtime ?? 0,
    role: o.role || null, version: vByRel.get(String(o.rel || '').replaceAll('\\', '/').toLowerCase()) ?? null, latest: o.rel === p.latest, dur: o.dur || null, w: o.w || null, h: o.h || null });

  const add = (g, row) => {
    const G = groups.get(g); G.size += row.size; G.count += 'count' in row ? row.count : 1;
    row.changed = row.kind === 'folder' ? (row.changedCount || 0) > 0 : changedAt(row.mtime);
    if (row.changed) G.changed++;   // rows, not the files inside a folder row (that count is on the row)
    G.rows.push(row);
  };
  const aggRows = [];   // generated folders, filled while walking
  const bump = (row, st) => { row.size += st.size; row.count++; row.mtime = Math.max(row.mtime, st.mtimeMs); if (changedAt(st.mtimeMs)) row.changedCount = (row.changedCount || 0) + 1; };

  let entries = 0, truncated = false, n = 0;
  const yieldSome = async () => { if (++n >= 300) { n = 0; await breather(); } };
  const lstat = f => { try { return fs.lstatSync(f); } catch { return null; } };
  function file(full, st, agg) {
    const fk = key(full), l = leftoverOf(fk);
    if (l) { bump(l.row, st); return; }
    const o = outs.get(fk);
    if (o) { seenOut.add(fk); add('renders', renderRow(o, st)); return; }
    if (agg) { bump(agg, st); return; }
    const name = path.basename(full);
    add(groupOf(name), { rel: relOf(full), name, kind: 'file', size: st.size, mtime: st.mtimeMs });
  }
  async function walk(base) {
    const stack = [{ dir: base, agg: null, root: true }];
    while (stack.length) {
      const { dir, agg, root } = stack.pop();
      let ents; try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
      // a folder with hundreds of entries is one row (unless it is the film folder itself)
      let here = agg;
      if (!here && !root && ents.length > BIG_DIR) { here = { rel: relOf(dir), name: path.basename(dir), kind: 'folder', size: 0, count: 0, mtime: 0, hint: 'Many files' }; aggRows.push(here); }
      const files = [];
      for (const e of ents) {
        if (++entries > maxEntries) { truncated = true; return; }
        await yieldSome();
        const full = path.join(dir, e.name);
        if (e.isDirectory()) {
          if (SKIP.has(e.name)) continue;
          if (here) { stack.push({ dir: full, agg: here }); continue; }
          const l = leftoverDir(key(full));
          if (l) { stack.push({ dir: full, agg: null }); continue; }   // its files land in the leftover row
          const hint = bulkHint(e.name);
          if (hint) { const row = { rel: relOf(full), name: e.name, kind: 'folder', size: 0, count: 0, mtime: 0, hint }; aggRows.push(row); stack.push({ dir: full, agg: row }); continue; }
          stack.push({ dir: full, agg: null });
        } else if (e.isFile()) files.push(full);   // (links and other special entries are not followed or counted)
      }
      for (const f of files) { const st = lstat(f); if (st?.isFile()) file(f, st, here); await yieldSome(); }
    }
  }
  if (p.group && Array.isArray(p.groupFiles)) {
    // loose videos in a media folder: only the film's own files
    for (const f of p.groupFiles.map(x => path.join(p.path, x))) { const st = lstat(f); if (st?.isFile()) file(f, st, null); await yieldSome(); }
  } else {
    for (const b of bases) { if (truncated) break; await walk(b.dir); }
  }
  // videos the walk did not reach (e.g. outside the folder): still listed from the scan
  for (const [fk, o] of outs) if (!seenOut.has(fk) && !leftoverOf(fk)) add('renders', renderRow(o, null));
  for (const r of aggRows) if (r.count) add('generated', r);
  for (const l of left) {
    // a candidate the walk did not see keeps janitor's own size
    if (!l.row.count) { l.row.size = l.c.size || 0; l.row.count = 0; l.row.mtime = 0; }
    if (l.row.kind === 'folder') l.row.changedCount = l.row.changedCount || 0;
    add('leftovers', l.row);
  }

  const out = [];
  let total = 0, count = 0;
  for (const G of groups.values()) {
    total += G.size; count += G.count;
    if (G.key === 'renders') G.rows.sort((a, b) => (b.mtime || 0) - (a.mtime || 0));
    else if (G.key === 'generated' || G.key === 'leftovers') G.rows.sort((a, b) => b.size - a.size);
    else G.rows.sort((a, b) => a.rel.localeCompare(b.rel));
    if (G.rows.length > maxRows) {
      // keep the changed rows first so the filter still finds them, then the rest in order
      const keep = [...G.rows.filter(r => r.changed), ...G.rows.filter(r => !r.changed)].slice(0, maxRows);
      const set = new Set(keep); G.more = G.rows.length - keep.length; G.rows = G.rows.filter(r => set.has(r));
    }
    out.push(G);
  }
  return { groups: out, total: { size: total, count }, truncated, maxEntries, ms: Date.now() - t0, leftoversPending: candidates == null };
}

// which rule marks files as "changed recently": since the film's current agent session started (when known), else 24 h
export function changedRule(session, now = Date.now()) {
  if (session?.startedAt && session.startedAt > now - 14 * 864e5) return { kind: 'session', since: session.startedAt, agent: session.agentName || session.agent || 'Agent', title: session.title || '', state: session.state || '' };
  return { kind: 'day', since: now - 864e5 };
}
// a relative path from the client → an absolute path inside the film (or its out/ folder), else null
export function resolveInFilm(p, rel, { path = pathDefault } = {}) {
  if (typeof rel !== 'string' || !rel || rel.length > 1024 || /[\0\r\n]/.test(rel) || path.isAbsolute(rel) || /^[a-z]:/i.test(rel) || rel.startsWith('/') || rel.startsWith('\\')) return null;
  const parts = rel.split(/[\\/]+/).filter(Boolean);
  if (!parts.length || parts.some(s => s === '..' || s === '.')) return null;
  if (parts[0] === 'out' && p.outDir && p.outDir !== p.path) return path.join(p.outDir, ...parts.slice(1));
  return path.join(p.path, ...parts);
}
