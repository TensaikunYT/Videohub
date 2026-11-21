// "Finish film": once a film is done, everything it no longer needs leaves its folder — reversibly (Recycle Bin /
// Trash, or the archive for older versions) and only after the user looked at the list and clicked.
//
// classifyFilm(p, ctx) reads one film folder (never writes) and puts every file and folder in one of four kinds:
//   keep     the film's code and text, fonts, models, vendored libraries, inputs, the voice-over and its timings, the
//            final sound mix, anything the film's code refers to, .videohub/, and one copy of the newest video
//   remove   render intermediates, byte-for-byte copies of the newest video, silent intermediates, Chrome profiles and
//            temporary folders, QA / test / snapshot folders, loose test stills and clips at the film root that the
//            code does not use, logs and hidden tool files  → Recycle Bin / Trash
//   archive  older versions of the film (and other earlier renders of the same length)  → the archive folder
//   optional regenerable but costly: sound stems, node_modules beside a package.json, big image sequences the code
//            uses, data caches, thumbnail drafts  → off until the user ticks them
// Never: anything outside the film's folder, a scan root, a studio engine, a skills folder, a film with a running or
// queued render, symbolic links / junctions (not followed, not removed: a folder holding one goes file by file).
//
// "Referenced = keep": before anything that is not a known render intermediate is offered, the film's own source
// text (read once, capped) is searched for its folder or file name. A mention counts only on a line that is not a
// comment and does not write there (mkdir, writeFile, screenshot, OUT = …): snap.js making snaps/ does not keep snaps/.
//
// Space is counted honestly: a file frees space only when no other hard link keeps its data (nlink 1), or when its only
// other link is its outputs-folder link, which the cleanup sends along (ciktilar.afterClean). "moved" is everything
// that leaves the folder, "freed" the part of it that really comes back.
import fsDefault from 'node:fs';
import pathDefault from 'node:path';
import crypto from 'node:crypto';

export const DONE = new Set(['approved', 'published', 'archived', 'done']);
export const LOOKS_DAYS = 7;             // a final video and no file changed for this long: "looks finished"
export const MAX_ENTRIES = 250000;       // files and folders walked before the classifier stops (and refuses)
const SRC_FILE_MAX = 512 * 1024, SRC_TOTAL_MAX = 16 << 20;   // source text read for the reference check
const SAMPLE = 4 << 20;                  // bytes hashed at the start, middle and end of a video to confirm a copy

const VIDEO = /\.(mp4|mov|webm|mkv|m4v|avi)$/i;
const IMAGE = /\.(png|jpe?g|webp|gif|bmp|tiff?|exr|avif)$/i;
const MEDIA = /\.(png|jpe?g|webp|gif|bmp|tiff?|exr|avif|mp4|mov|webm|mkv|m4v|avi|wav|mp3|m4a|flac)$/i;   // what a QA folder that also holds scripts loses
const AUDIO = /\.(wav|mp3|m4a|aac|flac|ogg|oga|opus|aiff?|npy)$/i;
const CODE = /\.(m?js|cjs|ts|tsx|jsx|mts|py|html?|css|scss|less|glsl|frag|vert|wgsl|json|sh|ps1|cmd|bat|toml|ya?ml)$/i;
// spoken words and timings: their text is the narration, not paths ("thumbs" in words.json once kept a thumbs/ folder)
const TRANSCRIPT = /(^|[._-])(words?|sents?|sentences|transcripts?|timings?|alignment|captions?|subs|subtitles|vo|said|script)([._-][^.]*)?\.json$/i;
const RAW_DUMP = /\.(gray|raw|rgba?|yuv|npy|npz|bin|pkl|pt|cache)$/i;

// folder names (lower case), decided where they sit
const QA_DIR = /^(snaps?|snapshots?|.+_snapshots?|snaps?[_-].+|qa|qa[_-].+|checks?|checks?[_-].+|shots|lookdev|previews?|draw[_-].+|tests?|tests?[_-].+|tmp|tmp[_-].+|temp|scratch|debug|bench|probe|compare|cmp|kiyas|sheets?|contact|frames|frames?[_-].+|work|wip|experiments?|deneme)$/;
const TEMP_DIR = /^(\.cache|__pycache__|\.parcel-cache|\.vite|\.tmp|\.render|\.pytest_cache)$/;
const PROFILE_DIR = /^(profiles|tmp_profiles|chrome[-_]?profiles?|chrome-profile.*)$/;
const THUMB_DIR = /^(thumbs?|thumb[_-]?\d+.*|thumbnails?|banners?|kapak|covers?)$/;
const INPUT_DIR = /^(src.*|assets?|clips?|ref|refs|references?|media|footage|b-?roll|stock|inputs?|raw|vendor|libs?|kit|engines?|fonts?|models?|img|images?|textures?|tex|sprites?|brand|vhaudio|vh2d|scenes?|tools?|scripts?|js|css|shaders?|py|out|output|build|dist)$/;
const SOUND_DIR = /^(audio|sounds?|music|voice|vo|stems|sfx|data)$/;
// script names that make check pictures: their mentions of a folder do not keep it
const QA_SCRIPT = /(snap|shot|check|test|probe|bench|debug|sheet|contact|thumb|lint|preview|qa[_\-.]|^qa$|dump|compare|strip)/i;
// loose files at the film root that are made for the upload, not by a test: kept even when the code never names them
// loose pictures at the root that are plainly test output (contact sheets, snapshots, numbered frames): to the Bin;
// any other loose picture the code does not use (a style or option still) is optional
const TEST_STILL = /^(sheet|contact|snap|shot|test|check|qa|frame)|^[a-z]?\d{3,}([._]\d+)?\.\w+$/i;
const DELIVERABLE = /(thumb|cover|poster|banner|logo|kapak|icon|favicon|brand|ref|reference|style|mood|brief|storyboard|design|tasarim|karakter|character|concept|konsept|sketch|eskiz)/i;
const VO = /(^|[_\-. ])(vo|voice|voiceover|narration|narrator|speech|dub|seslendirme|anlatim|said)([_\-. \d]|$)/i;
const MIX = /^(mix|final|master)([_\-. ].*)?\.(wav|flac|aiff?)$/i;
const OLD = /(^|[_\-. ])(old|bak|backup|prev|previous|orig|vhorig|eski|yedek)([_\-. \d]|$)/i;
const STEM = /^(music|sfx|bed|amb|ambience|ambient|drone|score|fx|stem|st|room|noise|hits?|whooshes)([_\-. \d]|$)|(^|[_\-])(raw|stem|bed|sfx|music)([_\-. \d]|$)/i;
const TEST_NAME = /(^|[_\-. ])(test|tests|qa|deneme|bench|tmp|probe|debug|check|snap|try)([_\-. \d]|$)/i;
const LOG = /\.log$|^render_log.*\.txt$|^whisper.*\.txt$/i;
const HIDDEN_TOOL = /^(\.codex_|\.claude_tmp|\.ds_store$|thumbs\.db$|desktop\.ini$)/i;

export const RULES = {
  keep: 'Stays', copy: 'Copy of the newest video', render: 'Render leftovers', silent: 'Silent intermediate render', preview: 'Old preview',
  qa: 'Check pictures and test folders', temp: 'Temporary files and browser profiles', still: 'Loose test pictures', testclip: 'Test clips', log: 'Logs and tool files',
  oldVersion: 'Older versions (to the archive)', stems: 'Sound stems', nodeModules: 'Installed packages', sequence: 'Image sequences', cache: 'Data caches', thumbs: 'Thumbnail drafts', other: 'Other',
};

const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const sha = s => crypto.createHash('sha1').update(s).digest('hex').slice(0, 12);
function baseName(file) {
  let b = String(file).replace(/^.*[\\/]/, '').replace(/\.[^.]+$/, '').toLowerCase();
  for (let i = 0; i < 6; i++) b = b.replace(/[_\- ](v\d+|web|final|master|1080p|2160p|4k|16x9|9x16|\d+fps|hq|hd|preview|prev)$/, '');
  return b;
}

// ---------- 1. the folder as a tree (lstat: links are seen, never followed)
async function readTree(root, { fs, path, maxEntries, breather }) {
  const top = { name: '', rel: '', path: root, dir: true, kids: [], size: 0, count: 0, nlinkSize: 0, hasLink: false, mtime: 0 };
  const stack = [top]; let n = 0, truncated = false;
  while (stack.length) {
    const d = stack.pop(); let ents = [];
    try { ents = fs.readdirSync(d.path, { withFileTypes: true }); } catch { continue; }
    for (const e of ents) {
      if (++n > maxEntries) { truncated = true; break; }
      if (n % 300 === 0) await breather();
      const full = path.join(d.path, e.name), rel = d.rel ? d.rel + '/' + e.name : e.name;
      let st = null; try { st = fs.lstatSync(full); } catch { continue; }
      const node = { name: e.name, rel, path: full, parent: d, link: st.isSymbolicLink() || e.isSymbolicLink(), dir: false, size: 0, nlink: 1, mtime: st.mtimeMs || 0 };
      if (node.link) { d.kids.push(node); continue; }
      if (st.isDirectory()) { Object.assign(node, { dir: true, kids: [], count: 0, hasLink: false }); d.kids.push(node); stack.push(node); continue; }
      if (!st.isFile()) continue;
      node.size = st.size; node.nlink = st.nlink || 1; d.kids.push(node);
    }
    if (truncated) break;
  }
  // folder sizes, counts, "holds a link", newest change (bottom up)
  const sum = d => { d.size = 0; d.count = 0; d.hasLink = false; for (const k of d.kids) { if (k.link) { d.hasLink = true; continue; } if (k.dir) { sum(k); d.hasLink ||= k.hasLink; d.count += k.count; } else d.count++; d.size += k.size; d.mtime = Math.max(d.mtime, k.mtime); } };
  sum(top);
  return { top, truncated, entries: n };
}
const files = d => d.kids.flatMap(k => k.link ? [] : k.dir ? files(k) : [k]);
const findNode = (top, rel) => { let d = top; for (const s of String(rel).replaceAll('\\', '/').split('/').filter(Boolean)) { d = d.kids?.find(k => k.name.toLowerCase() === s.toLowerCase()); if (!d) return null; } return d; };

// ---------- 2. the film's source text, read once (vendored libraries, installed packages and check scripts left out)
function readSources(top, { fs }) {
  const out = []; let total = 0;
  const skipDir = n => /^(node_modules|vendor|\.git|\.videohub|render|chunks.*)$/.test(n) || QA_DIR.test(n) || TEMP_DIR.test(n) || PROFILE_DIR.test(n) || THUMB_DIR.test(n);
  const walk = d => {
    for (const k of d.kids) {
      if (total >= SRC_TOTAL_MAX) return;
      if (k.link) continue;
      if (k.dir) { if (!skipDir(k.name.toLowerCase())) walk(k); continue; }
      if (!CODE.test(k.name) || k.size > SRC_FILE_MAX || /\.min\.js$/i.test(k.name) || QA_SCRIPT.test(k.name.replace(/\.[^.]+$/, ''))) continue;
      if (/^(package-lock|tsconfig|jsconfig)\.json$/i.test(k.name) || TRANSCRIPT.test(k.name) || k.rel.startsWith('.')) continue;
      let text = ''; try { text = fs.readFileSync(k.path, 'utf8'); } catch { continue; }
      total += text.length; out.push({ rel: k.rel, path: k.path, text });
    }
  };
  walk(top);
  return { list: out, bytes: total, capped: total >= SRC_TOTAL_MAX };
}
const COMMENT = /^\s*(\/\/|#|\*|\/\*|<!--|rem\s|::|--)/i;
const WRITES = /\b(mkdirSync|mkdirs?|makedirs|writeFile\w*|createWriteStream|screenshot|imwrite|savefig|to_file|unlink\w*|rmSync|rmdir|rimraf|copyFile\w*|renameSync)\b|\.save\(|open\([^)]*,\s*['"][wa]b?['"]|\b(out|outdir|out_dir|output|outputs|dest|dst|snapdir|shotdir|qadir)\w*\s*=(?!=)/i;
// who mentions this name (a folder: followed by a slash or a closing quote; a file: the whole name, or a numbered
// sequence's prefix followed by ${…}, %04d, ' + …)? Lines inside `inside` (the item itself) do not count.
export function referencedBy(sources, name, { dir = false, inside = null } = {}) {
  const res = [new RegExp(`(^|[^\\w.\\-])${esc(name)}${dir ? '(?=[\\\\/\'"`])' : '(?![\\w.])'}`, 'i')];
  const seq = !dir && /^(.*?[A-Za-z_\-])(\d+)\.\w+$/.exec(name);
  if (seq && seq[1].length >= 3) res.push(new RegExp(`(^|[^\\w.\\-])${esc(seq[1])}(\\$\\{|%0?\\d*d|['"\`]\\s*\\+|\\{)`, 'i'));
  for (const s of sources) {
    if (inside && (s.rel === inside || s.rel.toLowerCase().startsWith(inside.toLowerCase() + '/'))) continue;
    if (!res.some(r => r.test(s.text))) continue;
    for (const line of s.text.split(/\r?\n/)) if (res.some(r => r.test(line)) && !COMMENT.test(line) && !WRITES.test(line)) return s.rel;
  }
  return null;
}

// ---------- 3. is this video a byte-for-byte copy of that one? size + sha1 of 4 MB at the start, middle and end
export async function sameContent(a, b, { fs = fsDefault } = {}) {
  if (!a || !b || a.size !== b.size) return false;
  const h = file => {
    const fd = fs.openSync(file, 'r');
    try {
      const n = Math.min(SAMPLE, a.size), hash = crypto.createHash('sha1'), buf = Buffer.alloc(n);
      for (const at of [0, Math.max(0, Math.floor(a.size / 2) - (n >> 1)), Math.max(0, a.size - n)]) { const r = fs.readSync(fd, buf, 0, n, at); hash.update(buf.subarray(0, r)); }
      return hash.digest('hex');
    } finally { fs.closeSync(fd); }
  };
  try { return h(a.path) === h(b.path); } catch { return false; }
}

// ---------- shared with the janitor's render-leftover rules (server/janitor.js), so both say the same thing
// a video named like a version (film_v3.mp4): versions.json and the review player point at it, so of two copies it stays
export const isVersioned = name => /[_ -]v[0-9]+[.][a-z0-9]+$/i.test(String(name || ''));
// the space a file really gives back when it leaves: all of it when no other hard link keeps its data (nlink 1), or when
// its only other link is its outputs-folder link, which the cleanup sends along (ciktilar.afterClean); otherwise nothing
export const freedBytes = (size, nlink, file, linkGoes = () => false) => (nlink || 1) <= 1 || (nlink === 2 && linkGoes(file)) ? size : 0;
// why a film is never tidied (null: it may be): not a film made in code, a studio engine or scene, a link, inside a
// skills folder, a watched folder itself, busy. ctx: roots, skillDirs, busy, fs, path, key (path -> comparable)
export function refusal(p, ctx = {}) {
  const fs = ctx.fs || fsDefault, path = ctx.path || pathDefault, key = ctx.key || (s => path.resolve(String(s)).toLowerCase());
  const inside = (c, par) => { const a = key(c), b = key(par); return a === b || a.startsWith(b.endsWith(path.sep) ? b : b + path.sep); };
  if (!p || !p.path) return 'Film not found.';
  if (p.group || p.rootType === 'media') return 'This is a folder of finished videos, not a film made in code: nothing to tidy.';
  if (p.studio) return 'This is a scene of a studio engine shared by several scenes: the engine is never tidied from one scene.';
  let st; try { st = fs.lstatSync(p.path); } catch { return 'The film folder is missing.'; }
  if (st.isSymbolicLink()) return 'The film folder is a link to another place: it is never tidied.';
  if (isStudioDir(p.path, { fs, path })) return 'This folder is a studio engine with several scenes: it is never tidied as one film.';
  if ((ctx.skillDirs || []).filter(Boolean).some(s => inside(p.path, s))) return 'This folder is inside an agent skills folder: skills are never tidied.';   // (a skills folder inside the film is guarded by the classifier)
  if ((ctx.roots || []).some(r => key(r) === key(p.path)) && p.rootType !== 'project') return 'This is a watched folder itself, not a film.';
  if (ctx.busy) return `Not now: ${ctx.busy}.`;
  return null;
}

// ---------- the classifier
// p: the scanned project (path, outputs with roles, latest, status, meta, studio, group, rootType)
// ctx: roots (scan roots), skillDirs, busy (why the film is busy, or null), linkGoes(file) (its only other hard link is
// its outputs-folder link, which the cleanup sends along), now, fs, path, breather
export async function classifyFilm(p, ctx = {}) {
  const t0 = Date.now();
  const fs = ctx.fs || fsDefault, path = ctx.path || pathDefault;
  const breather = ctx.breather || (() => new Promise(r => setImmediate(r)));
  const key = ctx.key || (s => path.resolve(String(s)).toLowerCase());
  const inside = (c, par) => { const a = key(c), b = key(par); return a === b || a.startsWith(b.endsWith(path.sep) ? b : b + path.sep); };
  const result = (extra) => ({ id: p?.id, path: p?.path, refused: null, items: [], totals: emptyTotals(), hasFinal: false, truncated: false, ms: Date.now() - t0, ...extra });

  // ---- never
  const never = refusal(p, { ...ctx, fs, path, key });
  if (never) return result({ refused: never });
  const skills = (ctx.skillDirs || []).filter(Boolean);

  const { top, truncated } = await readTree(p.path, { fs, path, maxEntries: ctx.maxEntries || MAX_ENTRIES, breather });
  if (truncated) return result({ refused: `The folder has more than ${(ctx.maxEntries || MAX_ENTRIES).toLocaleString('en-US')} files and folders; tidy it by hand.`, truncated: true });
  const sources = readSources(top, { fs });
  // things inside the film that must never move with a folder: scan roots, skills folders
  const guarded = [...(ctx.roots || []), ...skills].filter(g => inside(g, p.path) && key(g) !== key(p.path));
  const holdsGuarded = n => guarded.some(g => inside(g, n.path));
  const linkGoes = ctx.linkGoes || (() => false);
  const freedOf = f => freedBytes(f.size, f.nlink, f.path, linkGoes);

  // ---- the videos: which one is the film, which are copies or older versions
  const outs = new Map((p.outputs || []).map(o => [key(o.path), o]));
  const latest = (p.outputs || []).find(o => o.rel === p.latest) || null;
  const nodeOf = o => findNode(top, path.relative(p.path, o.path));
  const inInput = rel => { const s = rel.split('/'); return s.slice(0, -1).some(x => INPUT_DIR.test(x.toLowerCase())) && !/^(out|output|build|dist)$/i.test(s[0]); };
  const hasFinal = !!(latest && (latest.role === 'final' || latest.role === 'web') && nodeOf(latest));
  const decided = new Map();   // node -> { kind, rule, reason }
  const say = (n, kind, rule, reason) => { decided.set(n, { kind, rule, reason }); };
  const keepers = new Set();
  if (hasFinal) {
    const films = (p.outputs || []).filter(o => (o.role === 'final' || o.role === 'web') && o.audio !== false && nodeOf(o) && !inInput(nodeOf(o).rel) && !/^render\//i.test(nodeOf(o).rel));
    const same = (o, L) => baseName(o.name) === baseName(L.name) || (o.dur && L.dur && Math.abs(o.dur - L.dur) <= 1.5 && o.w === L.w && o.h === L.h);
    const groups = []; const placed = new Set();
    const g0 = films.filter(o => o === latest || same(o, latest)); if (!g0.includes(latest)) g0.unshift(latest);
    groups.push({ lead: latest, list: g0 }); g0.forEach(o => placed.add(o));
    for (const o of films.slice().sort((a, b) => b.mtime - a.mtime)) {
      if (placed.has(o)) continue;
      const g = films.filter(x => !placed.has(x) && baseName(x.name) === baseName(o.name)).sort((a, b) => b.mtime - a.mtime);
      g.forEach(x => placed.add(x)); groups.push({ lead: g.filter(x => x.role === 'final')[0] || g[0], list: g });
    }
    for (const g of groups) {
      const lead = g.lead, web = g.list.filter(o => o.role === 'web' && o.mtime >= lead.mtime - 3600e3).sort((a, b) => b.mtime - a.mtime)[0];
      const keep = [lead, web].filter(Boolean);
      // the newest render sits in render/ (made outside the queue): the newest version outside render/ stays too
      const inRender = o => /^render\//i.test(nodeOf(o).rel);
      const outside = inRender(lead) && g.list.filter(o => o !== lead && o.role === 'final' && !inRender(o)).sort((a, b) => b.mtime - a.mtime)[0];
      if (outside) keep.push(outside);
      // byte-for-byte copies of a kept video: the copy goes; when the copy has more hard links than the kept one
      // (an outputs-folder link), the kept one becomes the copy, so the removal really frees space
      for (const k of keep.slice()) {
        let kn = nodeOf(k);
        for (const o of g.list) {
          if (keep.includes(o)) continue;
          const on = nodeOf(o);
          if (!on || on.size !== kn.size || !(await sameContent(kn, on, { fs }))) continue;
          const by = referencedBy(sources.list, o.name);
          if (by) { say(on, 'keep', 'keep', `Used by the film’s code (${by}).`); continue; }
          let gone = o, stay = k;
          // which of the two stays: the one named like a version (versions.json and the review player point at it);
          // between two of the same kind, the one whose removal would free nothing (an extra hard link that stays)
          const versioned = f => isVersioned(f.name), frees = f => freedOf(f) > 0;
          const swap = versioned(on) !== versioned(kn) ? versioned(on) : frees(kn) && !frees(on);
          if (swap && on.parent === kn.parent && o.role === k.role) { gone = k; stay = o; keep[keep.indexOf(k)] = o; kn = on; }
          say(nodeOf(gone), 'remove', 'copy', `Byte-for-byte copy of ${nodeOf(stay).rel} (same size, same content at the start, middle and end), which stays.`);
        }
      }
      keep.forEach(k => { keepers.add(k); say(nodeOf(k), 'keep', 'keep', k === outside ? `The newest version outside render/ (${nodeOf(lead).rel} is newer but sits in the render folder); both stay.` : g === groups[0] && k === keep[0] ? 'The film: its newest version.' : k.role === 'web' ? 'Web copy of the newest version.' : 'Another film in this folder: its newest version.'); });
      for (const o of g.list) if (!keepers.has(o) && !decided.has(nodeOf(o))) {
        const by = referencedBy(sources.list, o.name);
        if (by) say(nodeOf(o), 'keep', 'keep', `Used by the film’s code (${by}).`);
        else say(nodeOf(o), 'archive', 'oldVersion', `Older version; the newest is ${nodeOf(keep[0]).rel}. Moved to the archive, not deleted.`);
      }
    }
  }
  const newestFinal = Math.max(0, ...[...keepers].map(o => o.mtime || 0));
  const filmRel = hasFinal ? nodeOf([...keepers][0] || latest).rel : null;   // the film as it stays (a copy swap may keep the other name)
  // copies of the kept videos that sit outside the version groups (in an unknown folder, or the scan did not describe them)
  if (hasFinal) for (const f of files(top)) {
    if (!VIDEO.test(f.name) || decided.has(f) || inInput(f.rel) || f.rel.toLowerCase().startsWith('.videohub/')) continue;
    const k = [...keepers].map(nodeOf).find(kn => kn && kn !== f && kn.size === f.size);
    if (k && await sameContent(k, f, { fs })) say(f, 'remove', 'copy', `Byte-for-byte copy of ${k.rel} (same size, same content at the start, middle and end), which stays.`);
  }

  // one video outside the groups above
  function videoRule(f, where) {
    const o = outs.get(key(f.path));
    if (!o) return where === 'render' && hasFinal ? ['remove', 'render', 'Render intermediate; the finished film is ' + filmRel + '.'] : ['keep', 'keep', 'A video the scan has not described yet; kept.'];
    if (o.role === 'silent') {
      const cov = o.coveredBy && String(o.coveredBy).replaceAll('\\', '/');
      if (cov && keepers.size) return ['remove', 'silent', [...keepers].some(k => k.rel === o.coveredBy) ? `Silent intermediate render; the same picture with sound is ${cov}.` : `Silent intermediate render (the same picture as ${cov}); the film stays as ${filmRel}.`];
      if (where === 'render' && hasFinal) return ['remove', 'render', 'The joined picture before the sound was laid on; the finished film is ' + filmRel + '.'];
      return ['keep', 'keep', 'Silent video with no voiced copy found; kept.'];
    }
    if (o.role === 'preview') return hasFinal && (o.mtime || 0) < newestFinal ? ['remove', 'preview', 'Preview render; a final was made afterward.'] : ['keep', 'keep', 'Preview; no newer final.'];
    if (o.role === 'clip') {
      const by = where === 'root' && referencedBy(sources.list, f.name);
      if (by) return ['keep', 'keep', `Used by the film’s code (${by}).`];
      if (where === 'root' || where === 'render') return TEST_NAME.test(f.name.replace(/\.[^.]+$/, '')) ? ['remove', 'testclip', 'Test clip (named so), not the film.'] : ['optional', 'testclip', 'Short video (under half the film’s length) at the film root, not the film. Tick it if it was only a test.'];
      return ['keep', 'keep', 'Short video; kept.'];
    }
    if (o.role === 'broken') return ['optional', 'testclip', 'Unreadable video (no picture found). Tick it if you do not need it.'];
    if (where === 'render' && hasFinal) return ['remove', 'render', 'Render intermediate; the finished film is ' + filmRel + '.'];
    return ['keep', 'keep', 'A video kept as it is.'];
  }
  // the film's sound
  const soundKeep = new Set();
  const addSound = rel => { if (typeof rel === 'string' && rel && !/^\{/.test(rel)) soundKeep.add(rel.replaceAll('\\', '/').replace(/^\.\//, '').toLowerCase()); };
  addSound(p.meta?.live?.audio); addSound(p.meta?.transcript?.file);
  const mux = Array.isArray(p.meta?.render?.mux) ? p.meta.render.mux : [];
  mux.forEach((a, i) => { if (mux[i - 1] === '-i') addSound(a); });
  function audioRule(f) {
    const n = f.name, lower = f.rel.toLowerCase();
    if (soundKeep.has(lower)) return ['keep', 'keep', 'The film’s sound (used by the live preview or the render).'];
    if (/\.npy$/i.test(n)) return ['optional', 'stems', 'Synthesized sound stem (numpy): regenerable by the film’s sound script; the mix stays.'];
    if (VO.test(n.replace(/\.[^.]+$/, '')) || /^vo\.|^st_vo\./i.test(n)) return ['keep', 'keep', 'Voice-over.'];
    if (MIX.test(n)) {
      if (/\.vhorig\./i.test(n)) return ['optional', 'stems', 'VideoHub’s copy of the mix before sound edits (needed only to undo them).'];
      if (OLD.test(n.replace(/\.[^.]+$/, ''))) return ['optional', 'stems', 'An older copy of the mix; the current mix stays.'];
      return ['keep', 'keep', 'The final sound mix.'];
    }
    if (/\.(wav|flac|aiff?)$/i.test(n) && STEM.test(n.replace(/\.[^.]+$/, ''))) return ['optional', 'stems', 'Sound stem used to build the mix; the mix stays. Needed only to rebuild the mix or for per-layer levels in VideoHub.'];
    return ['keep', 'keep', 'Sound file (an input or the mix); kept.'];
  }
  function fileRule(f, where) {
    const n = f.name;
    if (HIDDEN_TOOL.test(n)) return ['remove', 'log', 'Hidden file left by a tool.'];
    if (LOG.test(n)) return ['remove', 'log', 'Log file.'];
    if (VIDEO.test(n)) return videoRule(f, where);
    if (AUDIO.test(n)) return audioRule(f);
    if (where === 'root' && IMAGE.test(n)) {
      const by = referencedBy(sources.list, n);
      if (by) return ['keep', 'keep', `Used by the film’s code (${by}).`];
      if (DELIVERABLE.test(n)) return ['keep', 'keep', 'Thumbnail, cover or reference picture; kept.'];
      if (TEST_STILL.test(n)) return ['remove', 'still', 'Test output at the film root (a contact sheet, snapshot or frame) that the film’s code does not use.'];
      return ['optional', 'still', 'Loose picture, not used by the code. Tick it if it was only a test or an option you no longer need.'];
    }
    if ((where === 'root' || where === 'sound') && RAW_DUMP.test(n) && f.size >= 1 << 20) return ['optional', 'cache', 'Raw data or cache file: regenerable, not part of the film.'];
    return ['keep', 'keep', null];
  }
  // a folder that goes: as a whole, or (when it holds code, a link or something guarded) only its media files
  // a folder that goes: as a whole, or (when it holds scripts, a link, a kept video or something decided otherwise) as
  // one item made of the parts that go: the media files, and the sub-folders where everything goes
  const unitOf = new Map();   // file node -> the folder whose partial item takes it
  function folderGoes(d, kind, rule, reason, { mediaOnly = false } = {}) {
    if (holdsGuarded(d)) return descend(d, 'other');
    const fl = files(d);
    const others = mediaOnly ? fl.filter(f => !MEDIA.test(f.name)) : [];
    const differs = f => { const x = decided.get(f); return x && x.kind !== kind; };   // e.g. an old version inside: archived, not recycled
    if (!others.length && !d.hasLink && !holdsVideo(d) && !fl.some(differs)) return say(d, kind, rule, reason);
    const go = new Set(fl.filter(f => (!mediaOnly || MEDIA.test(f.name)) && !keepers.has(outs.get(key(f.path))) && !decided.has(f)));
    if (!go.size) return say(d, 'keep', 'keep', others.length ? 'Only scripts and notes; kept.' : null);
    const units = [];
    const pack = x => { for (const k of x.kids) { if (k.link) continue; if (!k.dir) { if (go.has(k)) units.push(k); continue; } const all = files(k); if (all.length && !k.hasLink && all.every(f => go.has(f))) units.push(k); else pack(k); } };
    pack(d);
    for (const f of go) unitOf.set(f, d);
    decided.set(d, { kind, rule, reason: reason + (others.length ? ' Its scripts and notes stay.' : d.hasLink ? ' The links inside stay.' : ''), units });
  }
  const holdsVideo = d => files(d).some(f => [...keepers].some(o => key(o.path) === key(f.path)));
  // render/: everything is an intermediate once a finished film exists, except a kept video, the manifest and code
  function renderDir(d, depth = 0) {
    if (!hasFinal) { say(d, 'keep', 'keep', 'No finished video in the film folder yet: render files kept.'); return; }
    for (const k of d.kids) {
      if (k.link) continue;
      const nm = k.name.toLowerCase();
      if (k.dir) {
        if (holdsVideo(k) || holdsGuarded(k)) { renderDir(k, depth + 1); continue; }
        const why = /^chunks_(v\d|prev)/.test(nm) ? 'Old render chunks replaced by a later render.' : nm === 'chunks' ? 'Render chunks of the finished film (a later change needs a full render again).'
          : PROFILE_DIR.test(nm) ? 'Chrome profiles from the render (recreated for each render).' : /^(tmp|temp)$/.test(nm) ? 'Temporary render files.' : nm === 'preview' ? 'Preview render (half resolution); the final was made afterward.' : 'Render working folder.';
        const fl = files(k), code = fl.filter(f => CODE.test(f.name) && !/^(list|concat|manifest)/i.test(f.name));
        if (code.length) { renderDir(k, depth + 1); continue; }
        folderGoes(k, 'remove', 'render', why); continue;
      }
      if (/^manifest\.json$/i.test(k.name)) { say(k, 'keep', 'keep', 'Render manifest (tiny; how the film renders).'); continue; }
      if (VIDEO.test(k.name)) { const [kind, rule, reason] = keepers.has(outs.get(key(k.path))) ? ['keep', 'keep', 'The film.'] : videoRule(k, 'render'); if (!decided.has(k)) say(k, kind, rule, reason); continue; }
      if (CODE.test(k.name) && !/^(list|concat|files|parts)[^.]*\.txt$/i.test(k.name) && !/\.txt$/i.test(k.name)) { say(k, 'keep', 'keep', null); continue; }
      say(k, 'remove', 'render', /\.log$/i.test(k.name) ? 'Render log.' : /\.(txt)$/i.test(k.name) ? 'Concat list of a render.' : /\.tmp\./i.test(k.name) ? 'Unfinished render chunk.' : 'Render leftover.');
    }
  }
  function soundDir(d) { for (const k of d.kids) { if (k.link) continue; if (k.dir) { if (INPUT_DIR.test(k.name.toLowerCase())) say(k, 'keep', 'keep', 'The film’s inputs.'); else soundDir(k); continue; } if (decided.has(k)) continue; const [kind, rule, reason] = fileRule(k, 'sound'); say(k, kind, rule, reason); } }
  function descend(d, where) {
    for (const k of d.kids) {
      if (k.link) continue;
      if (decided.has(k)) continue;
      if (k.dir) { dirRule(k, false); continue; }
      const [kind, rule, reason] = fileRule(k, where); say(k, kind, rule, reason);
    }
  }
  // a folder anywhere in the film (top = directly in the film folder)
  function dirRule(d, isTop) {
    const nm = d.name.toLowerCase();
    if (holdsGuarded(d) && !guarded.some(g => key(g) === key(d.path))) return descend(d, 'other');
    if (guarded.some(g => key(g) === key(d.path))) return say(d, 'keep', 'keep', 'A watched folder or skills folder: never tidied.');
    if (nm === '.videohub') return say(d, 'keep', 'keep', 'VideoHub’s notes, plan and versions.');
    if (nm === '.git') return say(d, 'keep', 'keep', 'Version history (git).');
    if (isStudioDir(d.path, { fs, path })) return say(d, 'keep', 'keep', 'A studio engine with several scenes: never tidied.');
    if (isTop && nm === 'render') return renderDir(d);
    if (/^chunks_(v\d|prev)/.test(nm)) return folderGoes(d, 'remove', 'render', 'Old render chunks replaced by a later render.');
    if (isTop && nm === 'chunks') return hasFinal ? folderGoes(d, 'remove', 'render', 'Render chunks of the finished film (a later change needs a full render again).') : say(d, 'keep', 'keep', 'No finished video yet: chunks kept.');
    if (TEMP_DIR.test(nm)) return folderGoes(d, 'remove', 'temp', 'Cache or temporary files of a tool; made again when needed.');
    if (PROFILE_DIR.test(nm) && d.kids.some(k => k.dir && /^(w\d+|default|profile.*)$/i.test(k.name) || /^local state$/i.test(k.name))) return folderGoes(d, 'remove', 'temp', 'Chrome profiles from a render (recreated for each render).');
    if (nm === 'node_modules') {
      if (d.parent && d.parent.kids.some(k => !k.dir && !k.link && /^package\.json$/i.test(k.name))) return folderGoes(d, 'optional', 'nodeModules', 'Installed packages: `npm install` brings them back from package.json.');
      return say(d, 'keep', 'keep', 'Packages without a package.json beside them (placed by hand): kept.');
    }
    if (QA_DIR.test(nm)) {
      const by = referencedBy(sources.list, d.name, { dir: true, inside: d.rel });
      if (by) return say(d, 'keep', 'keep', `Used by the film’s code (${by}).`);
      return folderGoes(d, 'remove', 'qa', 'Check pictures, tests or experiments; the film’s code does not use this folder.', { mediaOnly: true });
    }
    if (THUMB_DIR.test(nm)) {
      const by = referencedBy(sources.list, d.name, { dir: true, inside: d.rel });
      if (by) return say(d, 'keep', 'keep', `Used by the film’s code (${by}).`);
      return folderGoes(d, 'optional', 'thumbs', 'Thumbnail or banner drafts: not part of the film. Keep them if you still need the thumbnail (scripts stay).', { mediaOnly: true });
    }
    if (INPUT_DIR.test(nm) || nm.startsWith('src')) {
      // a big image sequence the code reads (frames extracted from a video): optional
      const seq = imageSequence(d);
      const by = seq && referencedBy(sources.list, d.name, { dir: true, inside: d.rel });
      if (seq && by && !holdsVideo(d)) return folderGoes(d, 'optional', 'sequence', `Image sequence the film’s code reads (${by}). Needed to render or preview the film again; regenerable only if it was extracted from a video you still have.`);
      return say(d, 'keep', 'keep', nm === 'vendor' || /^(libs?|kit|engines?)$/.test(nm) ? 'Vendored library or engine code.' : /^fonts?$/.test(nm) ? 'Fonts.' : /^models?$/.test(nm) ? '3D models.' : 'The film’s code and inputs.');
    }
    if (isTop && SOUND_DIR.test(nm)) return soundDir(d);
    // an unknown folder: a referenced image sequence is optional, otherwise look inside (videos, sound, logs)
    const seq = imageSequence(d), by = seq && referencedBy(sources.list, d.name, { dir: true, inside: d.rel });
    if (seq && by && !holdsVideo(d)) return folderGoes(d, 'optional', 'sequence', `Image sequence the film’s code reads (${by}). Needed to render or preview the film again; regenerable only if it was extracted from a video you still have.`);
    return descend(d, 'other');
  }
  // many numbered pictures and big: frames read one by one
  function imageSequence(d) {
    const fl = files(d), min = ctx.seqMin || { bytes: 200 << 20, files: 200 }; if (d.size < min.bytes || fl.length < min.files) return false;
    const pics = fl.filter(f => IMAGE.test(f.name) && /\d{2,}\.\w+$/.test(f.name));
    return pics.length >= fl.length * 0.8;
  }
  // links are never followed or removed
  const markLinks = d => { for (const k of d.kids) { if (k.link) say(k, 'keep', 'keep', 'A link to another place: never followed or removed.'); else if (k.dir) markLinks(k); } };
  markLinks(top);
  for (const k of top.kids) {
    if (decided.has(k)) continue;
    if (k.dir) dirRule(k, true);
    else { const [kind, rule, reason] = fileRule(k, 'root'); say(k, kind, rule, reason); }
  }

  // ---- the list: every removed / archived / optional item, and one "stays" row per top-level entry
  const items = [];
  const whole = d => d && d.kind !== 'keep' && !d.units;
  const covered = n => { for (let a = n.parent; a; a = a.parent) if (whole(decided.get(a))) return true; return false; };
  const gone = n => whole(decided.get(n)) || unitOf.has(n);
  const goneFiles = n => n.link ? [] : gone(n) ? (n.dir ? files(n) : [n]) : n.dir ? n.kids.flatMap(goneFiles) : [];
  for (const [n, d] of decided) {
    if (d.kind === 'keep' || covered(n)) continue;
    const fl = d.units ? [...unitOf].filter(([, of]) => of === n).map(([f]) => f) : n.dir ? files(n) : [n];
    const it = { id: sha(d.kind + ':' + key(n.path)), rel: n.rel, path: n.path, kind: d.kind, rule: d.rule, reason: d.reason, dir: !!n.dir, size: fl.reduce((s, f) => s + f.size, 0),
      freed: fl.reduce((s, f) => s + freedOf(f), 0), count: fl.length, mtime: n.mtime, checked: d.kind === 'remove' || d.kind === 'archive' };
    if (d.units) { it.files = d.units.map(u => ({ path: u.path, dir: !!u.dir, size: u.dir ? files(u).reduce((s, f) => s + f.size, 0) : u.size })); it.partial = true; }
    if (!n.dir && n.nlink > 1 && !it.freed) it.note = 'Another hard link keeps this file’s data: moving it frees no space.';
    else if (it.freed < it.size) it.note = 'Some files have another hard link that keeps their data: only part of the space comes back.';
    items.push(it);
  }
  // what stays, per top-level entry (the kept part of it)
  const below = n => n.kids.flatMap(x => x.dir ? [x, ...below(x)] : [x]);
  for (const k of top.kids) {
    if (gone(k)) continue;
    const g = goneFiles(k), size = k.link ? 0 : k.dir ? k.size - g.reduce((s, f) => s + f.size, 0) : k.size;
    const d = decided.get(k);
    const reasons = k.dir && (!d || d.units) ? [...new Set(below(k).map(f => decided.get(f)).filter(x => x && x.kind === 'keep' && x.reason).map(x => x.reason))] : [];
    items.push({ id: sha('keep:' + key(k.path)), rel: k.rel, path: k.path, kind: 'keep', rule: 'keep', dir: !!k.dir, link: !!k.link, size, freed: 0, count: k.link ? 0 : k.dir ? k.count - g.length : 1, checked: false,
      reason: (d && d.kind === 'keep' && d.reason) || (d && d.units ? 'What stays of it: scripts, notes and links (the pictures go).' : '') || reasons.slice(0, 2).join(' ') || (k.link ? 'A link to another place: never followed or removed.' : k.dir ? 'The film’s files.' : CODE.test(k.name) ? 'The film’s code.' : /\.(md|txt|pdf|docx?)$/i.test(k.name) ? 'Notes and text.' : 'Kept.') });
  }
  const order = { remove: 0, archive: 1, optional: 2, keep: 3 };
  items.sort((a, b) => order[a.kind] - order[b.kind] || b.size - a.size);
  const totals = emptyTotals();
  for (const it of items) { const t = totals[it.kind]; t.size += it.size; t.freed += it.freed; t.count++; }
  return { id: p.id, path: p.path, refused: null, items, totals, hasFinal, latest: latest ? latest.rel : null, sources: { files: sources.list.length, bytes: sources.bytes, capped: sources.capped }, truncated: false, ms: Date.now() - t0 };
}
const emptyTotals = () => ({ remove: { size: 0, freed: 0, count: 0 }, archive: { size: 0, freed: 0, count: 0 }, optional: { size: 0, freed: 0, count: 0 }, keep: { size: 0, freed: 0, count: 0 } });
export const isStudioDir = (d, { fs = fsDefault, path = pathDefault } = {}) => { try { return fs.existsSync(path.join(d, 'make.mjs')) && fs.existsSync(path.join(d, 'scenes')) && fs.existsSync(path.join(d, 'engine', 'index.html')); } catch { return false; } };

// finished (the user said so) or looks finished (a final video, nothing changed for LOOKS_DAYS days)
export function finishState(p, now = Date.now()) {
  if (!p || p.group || p.rootType === 'media' || p.studio) return null;
  if (DONE.has(p.status) && !p.statusAuto) return 'finished';
  const latest = (p.outputs || []).find(o => o.rel === p.latest);
  if (latest && latest.role === 'final' && p.updated && now - p.updated > LOOKS_DAYS * 864e5) return 'looks';
  return null;
}

// the items the user chose: removals and archives they kept ticked plus the optional ones they ticked
export function pick(c, { ids = null, optional = [] } = {}) {
  const want = ids ? new Set(ids) : null, opt = new Set(optional || []);
  return c.items.filter(it => it.kind !== 'keep' && (want ? want.has(it.id) : it.kind === 'optional' ? opt.has(it.id) : true));
}

// the summary hub_finish prints
export function summaryText(title, c, GB) {
  if (c.refused) return `"${title}": ${c.refused}`;
  const T = c.totals, line = (it) => `- ${GB(it.size)} ${it.rel}${it.dir ? '/' : ''} — ${it.reason}${it.note ? ' ' + it.note : ''}`;
  const by = k => c.items.filter(it => it.kind === k);
  const out = [`"${title}": Finish film would move ${GB(T.remove.size + T.archive.size)} and free ${GB(T.remove.freed + T.archive.freed)} (optional items not counted).`];
  if (by('remove').length) out.push('', `To the Recycle Bin / Trash (${GB(T.remove.size)}):`, ...by('remove').map(line));
  if (by('archive').length) out.push('', `To the archive (${GB(T.archive.size)}):`, ...by('archive').map(line));
  if (by('optional').length) out.push('', `Optional, off unless the user ticks them (${GB(T.optional.size)}):`, ...by('optional').map(line));
  out.push('', `Stays (${GB(T.keep.size)}): ${by('keep').slice(0, 12).map(it => it.rel + (it.dir ? '/' : '')).join(', ')}${by('keep').length > 12 ? ', …' : ''}`);
  return out.join('\n');
}

// ---------- the hub side: classifications kept a little while, the finished-films list, starting a run
// deps: projects() / project(id), busyWhy(p), roots(), skillDirs(), linkGoes(file), startCleanItems(items, opts),
// setStatus(id, status) (async), onList(state) (the list changed), fs, path, now
export function createFinish(deps) {
  const fs = deps.fs || fsDefault, path = deps.path || pathDefault;
  const cache = new Map();   // id -> { sig, at, value }
  const sig = p => JSON.stringify([p.updated, p.latest, p.status, (p.outputs || []).length]);
  const ctx = p => ({ roots: deps.roots(), skillDirs: deps.skillDirs(), busy: deps.busyWhy(p), linkGoes: deps.linkGoes, fs, path });
  async function classify(id, { fresh = false } = {}) {
    const p = deps.project(id); if (!p) throw Object.assign(new Error('Project not found'), { code: 404 });
    const hit = cache.get(id), s = sig(p);
    if (!fresh && hit && hit.sig === s && Date.now() - hit.at < 120e3) return hit.value;
    const c = await classifyFilm(p, ctx(p));
    const value = { ...c, film: { id: p.id, title: p.title || p.name, status: p.status, statusAuto: !!p.statusAuto, state: finishState(p) } };
    cache.set(id, { sig: s, at: Date.now(), value });
    return value;
  }
  // the Cleanup page's "Finished films": counted one film after another in the background
  let run = null, at = 0;
  // the Cleanup page's "Films with leftovers": every film made in code is counted (one after another, in the background);
  // the list holds the films with something to free, finished and looks-finished ones marked
  const eligible = p => p && !p.group && p.rootType !== 'media' && !p.studio;
  function list() {
    const films = deps.projects().filter(eligible);
    const ready = films.map(p => { const h = cache.get(p.id); return h && h.sig === sig(p) ? h.value : null; });
    if (ready.some(x => !x) && !run) run = (async () => { for (const p of films) { try { await classify(p.id); } catch { } } })().finally(() => { run = null; at = Date.now(); deps.onList?.(); });
    const rows = [];
    films.forEach((p, i) => {
      const c = ready[i]; if (!c || c.refused) return;
      const T = c.totals; if (!(T.remove.count + T.archive.count + T.optional.count)) return;
      rows.push({ id: p.id, title: p.title || p.name, status: p.status, statusAuto: !!p.statusAuto, state: finishState(p), updated: p.updated || 0, totals: T, frees: T.remove.freed + T.archive.freed });
    });
    rows.sort((a, b) => b.frees - a.frees || b.totals.optional.size - a.totals.optional.size);
    return { pending: ready.some(x => !x), counted: ready.filter(Boolean).length, total: films.length, at, films: rows };
  }
  // the user's click: classified again now, so only what is still what they saw moves; then one cleanup run through the
  // janitor's machinery. A film is marked approved (published / done / archived stay) only once something of it was
  // really tidied: afterRun() with the run's results
  async function start(req) {
    const plan = [], films = [];
    for (const f of req || []) {
      const p = deps.project(f.id); if (!p) throw Object.assign(new Error('Project not found'), { code: 404 });
      const c = await classify(f.id, { fresh: true });
      if (c.refused) throw Object.assign(new Error(`${p.title || p.name}: ${c.refused}`), { code: 409 });
      const chosen = pick(c, { ids: Array.isArray(f.ids) ? f.ids : null, optional: f.optional });
      const real = (() => { try { return fs.realpathSync(p.path); } catch { return null; } })();
      for (const it of chosen) {
        let st = null; try { st = fs.lstatSync(it.path); } catch { }
        let rp = null; try { rp = fs.realpathSync(it.path); } catch { }
        const inFilm = real && rp && rp.toLowerCase() !== real.toLowerCase() && rp.toLowerCase().startsWith(real.toLowerCase().replace(/[\/]+$/, '') + path.sep);
        if (!st || st.isSymbolicLink() || !inFilm) continue;   // gone, a link, or not inside the film any more: never moved
        plan.push({ id: it.id, project: p.id, projectName: p.title || p.name, path: it.path, size: it.size, freed: it.freed, dir: it.dir, ...(it.files ? { files: it.files } : {}),
          action: it.kind === 'archive' ? 'archive' : 'recycle', rule: it.rule, reason: it.reason });
      }
      films.push(p.id);
    }
    if (!plan.length) throw Object.assign(new Error('Nothing to move: the films are already tidy.'), { code: 400 });
    const st = deps.startCleanItems(plan, { kind: 'finish', films });   // throws while another cleanup runs: nothing changed then
    for (const id of films) cache.delete(id);
    return st;
  }
  async function afterRun(st) {
    if (!st || st.kind !== 'finish') return [];
    const tidied = (st.films || []).filter(id => (st.results || []).some(r => r.projectId === id && r.status === 'ok'));
    for (const id of tidied) { cache.delete(id); const p = deps.project(id); if (p && !(DONE.has(p.status) && !p.statusAuto)) try { await deps.setStatus(id, 'approved'); } catch { } }
    return tidied;
  }
  return { classify, list, start, afterRun, invalidate: id => { if (id) cache.delete(id); else cache.clear(); } };
}
