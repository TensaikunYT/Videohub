// Sound editing from the review timeline (ui/review/soundedit.js): clips the user adds to a film (sound effects,
// another music bed), kept in tweaks.json "audio" { clips: [...] } and mixed by server/sound.js (VideoHub-built
// mixes) or by the 3D studio's make.mjs (its own mixdown). Every clip's file is copied into the film's vhaudio/
// folder first, so previews, renders and other PCs find it next to the film.
// Library: the user's sound folder (config.soundLibDir, default Documents\VideoHub\sounds) + ready-made effects built
// with an optional 3D studio engine's synth (config.studioDir; data/sfx-lib, server/sfxlib.mjs). Without that engine the
// library just has no ready-made effects (library().sfxAvailable = false; the UI hides the button).
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { project } from './scan.js';
import { config, baseDir } from './config.js';
import { DATA_DIR, TOOLS, isInside } from './util.js';

const AUDIO_RE = /\.(wav|mp3|m4a|ogg|flac|aac)$/i;
const SFX_DIR = path.join(DATA_DIR, 'sfx-lib');
const num = (v, d, lo, hi) => { const n = +v; return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : d; };
const SRC_RE = /^vhaudio\/[^\\/:*?"<>|]{1,140}\.(wav|mp3|m4a|ogg|flac|aac)$/i;

export function cleanAudio(a) {
  const out = { clips: [] };
  if (!a || typeof a !== 'object') return out;
  const ids = new Set();
  for (const c of (Array.isArray(a.clips) ? a.clips : []).slice(0, 400)) {
    if (!c || typeof c !== 'object') continue;
    const src = typeof c.src === 'string' ? c.src.replace(/\\/g, '/') : '';
    if (!SRC_RE.test(src)) continue;
    let id = typeof c.id === 'string' && c.id ? c.id.slice(0, 40) : 'c' + Math.random().toString(36).slice(2, 8);
    while (ids.has(id)) id += 'x';
    ids.add(id);
    out.clips.push({ id, name: typeof c.name === 'string' ? c.name.slice(0, 80) : path.basename(src), src, kind: c.kind === 'music' ? 'music' : 'sfx',
      t: num(c.t, 0, 0, 1e5), gain: num(c.gain, 1, 0, 4), fin: num(c.fin, 0, 0, 30), fout: num(c.fout, 0, 0, 30), trim: num(c.trim, 0, 0, 1e5),
      len: c.len == null || c.len === '' ? null : num(c.len, null, 0.01, 1e5), loop: !!c.loop, mute: !!c.mute, dur: num(c.dur, 0, 0, 1e5),
      // the timeline lane (0–7) the user put it on; existing clips never change lane by themselves
      ...(Number.isInteger(c.lane) && c.lane >= 0 && c.lane < 8 ? { lane: c.lane } : {}) });
  }
  return out;
}

const libDir = () => config().soundLibDir || path.join(baseDir(), 'sounds');
// the optional engine whose synth makes the ready-made effects (config.studioDir = a 3D studio folder with engine/audio/synth.js)
const synthPath = () => [config().studioDir].filter(Boolean).map((d) => path.join(d, 'engine', 'audio', 'synth.js')).find((f) => fs.existsSync(f)) || null;
function walk(dir, base, out, depth = 0) {
  let es = []; try { es = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of es) {
    const f = path.join(dir, e.name);
    if (e.isDirectory() && depth < 4) walk(f, base, out, depth + 1);
    else if (e.isFile() && AUDIO_RE.test(e.name) && out.length < 2000) out.push({ file: f, name: e.name.replace(/\.[^.]+$/, ''), folder: path.relative(base, dir) || '' });
  }
}
// what the user can pick: ready-made effects + their sound folder (music beds, voices, effects)
export function library() {
  const sfx = [], user = [];
  walk(SFX_DIR, SFX_DIR, sfx);
  walk(libDir(), libDir(), user);
  return { sfx: sfx.map((x) => ({ ...x, group: 'Ready-made effects' })), user: user.map((x) => ({ ...x, group: x.folder || path.basename(libDir()) })), libDir: libDir(), libExists: fs.existsSync(libDir()), sfxReady: sfx.length > 0, sfxAvailable: !!synthPath(), building: !!building };
}

// the ready-made effects, made once with the studio's synth (a few seconds); one run at a time
let building = null;
export function buildSfx() {
  if (building) return building;
  const synth = synthPath();
  if (!synth) return Promise.reject(Object.assign(new Error('Ready-made effects need the optional 3D studio engine (set studioDir in Settings). Your own sound folder and files from disk still work.'), { code: 400 }));
  const script = path.join(path.dirname(fileURLToPath(import.meta.url)), 'sfxlib.mjs');
  building = new Promise((ok, no) => {
    const c = spawn(TOOLS.node || process.execPath, [script, synth, SFX_DIR], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let err = ''; c.stderr.on('data', (d) => { err = (err + d).slice(-600); });
    c.on('error', no);
    c.on('exit', (code) => (code === 0 ? ok(library()) : no(new Error('could not make the effects: ' + (err.trim() || 'exit code ' + code)))));
  }).finally(() => { building = null; });
  return building;
}

// a sound for the film: copied into <film>/vhaudio/ (never moved), its length measured
async function duration(file) {
  return new Promise((res) => {
    const c = spawn(TOOLS.ffprobe, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file], { windowsHide: true });
    let out = ''; c.stdout.on('data', (d) => { out += d; }); c.on('exit', () => res(+out.trim() || 0)); c.on('error', () => res(0));
  });
}
function target(p, name, ext) {
  const dir = path.join(p.path, 'vhaudio');
  fs.mkdirSync(dir, { recursive: true });
  const base = String(name || 'sound').replace(/\.[^.]+$/, '').replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '_').replace(/\s+/g, ' ').trim().slice(0, 80) || 'sound';
  let f = base + ext;
  for (let n = 2; fs.existsSync(path.join(dir, f)); n++) f = `${base}_${n}${ext}`;
  return { abs: path.join(dir, f), src: 'vhaudio/' + f };
}
// a copy already in <film>/vhaudio/ with the same name (or name_n) and size: reused instead of copying again
function findSame(p, name, size) {
  const want = String(name || '').toLowerCase(), dir = path.join(p.path, 'vhaudio');
  try { for (const e of fs.readdirSync(dir)) { if (e.replace(/(_\d+)?(\.[^.]+)$/, '$2').toLowerCase() !== want) continue; const g = path.join(dir, e); if (fs.statSync(g).size === size) return { abs: g, src: 'vhaudio/' + e }; } } catch { }
  return null;
}
export async function addFromLibrary(p, file) {
  const lib = library(), known = [...lib.sfx, ...lib.user].some((x) => path.resolve(x.file).toLowerCase() === path.resolve(String(file || '')).toLowerCase());
  if (!known || !(isInside(file, SFX_DIR) || isInside(file, libDir()))) throw Object.assign(new Error('This sound is not in the library'), { code: 403 });
  // the same file was added before: reuse the copy
  const same = findSame(p, path.basename(file), fs.statSync(file).size);
  const t = same || target(p, path.basename(file), path.extname(file).toLowerCase());
  if (!same) fs.copyFileSync(file, t.abs);
  return { src: t.src, name: path.basename(file).replace(/\.[^.]+$/, ''), dur: await duration(t.abs) };
}
export async function upload(p, { name, data }) {
  const m = /^data:audio\/[\w.+-]+;base64,([A-Za-z0-9+/=]+)$/.exec(data || '') || /^data:application\/octet-stream;base64,([A-Za-z0-9+/=]+)$/.exec(data || '');
  const ext = (String(name || '').match(AUDIO_RE) || [])[0];
  if (!m || !ext) throw Object.assign(new Error('The file must be WAV, MP3, M4A, OGG, FLAC or AAC'), { code: 400 });
  const buf = Buffer.from(m[1], 'base64');
  if (buf.length > 200 * 1024 * 1024) throw Object.assign(new Error('The sound file is larger than 200 MB'), { code: 400 });
  const same = findSame(p, path.basename(String(name)), buf.length);
  const t = same || target(p, name, ext.toLowerCase());
  if (!same) fs.writeFileSync(t.abs, buf);
  return { src: t.src, name: String(name).replace(/\.[^.]+$/, ''), dur: await duration(t.abs) };
}

// a big file from the user's disk (drag from Explorer / file picker > 35 MB): raw body streamed to vhaudio/, 500 MB cap
const UP_MAX = 500 * 1024 * 1024;
async function uploadStream(p, req, name, size) {
  const ext = (String(name || '').match(AUDIO_RE) || [])[0];
  if (!ext) throw Object.assign(new Error('The file must be WAV, MP3, M4A, OGG, FLAC or AAC'), { code: 400 });
  if (size > UP_MAX) throw Object.assign(new Error('The sound file is larger than 500 MB'), { code: 413 });
  const base = path.basename(String(name).replace(/\\/g, '/')), same = size > 0 && findSame(p, base, size);
  if (same) { req.resume(); return { src: same.src, name: base.replace(/\.[^.]+$/, ''), dur: await duration(same.abs) }; }
  const t = target(p, base, ext.toLowerCase()), tmp = t.abs + '.part';
  await new Promise((ok, no) => {
    let n = 0; const out = fs.createWriteStream(tmp);
    req.on('data', (d) => { n += d.length; if (n > UP_MAX) { req.destroy(); out.destroy(); no(Object.assign(new Error('The sound file is larger than 500 MB'), { code: 413 })); } });
    req.on('error', no); out.on('error', no); out.on('finish', ok);
    req.pipe(out);
  }).catch((e) => { try { fs.unlinkSync(tmp); } catch { } throw e; });
  fs.renameSync(tmp, t.abs);
  return { src: t.src, name: base.replace(/\.[^.]+$/, ''), dur: await duration(t.abs) };
}

export function routes(route, readBody) {
  const need = (id) => { const p = project(id); if (!p) throw Object.assign(new Error('Project not found'), { code: 404 }); return p; };
  route('GET', '/api/sound-library', () => library());
  route('POST', '/api/sound-library/build', () => buildSfx());
  route('POST', '/api/project/:id/audio-clip', async (req, url, { id }) => {
    const p = need(id), b = await readBody(req);
    return b.file ? addFromLibrary(p, b.file) : upload(p, b);
  });
  route('POST', '/api/project/:id/audio-upload', (req, url, { id }) => uploadStream(need(id), req, url.searchParams.get('name') || '', +url.searchParams.get('size') || 0));
  // play a library sound in the browser before adding it
  route('GET', '/api/sound-library/play', (req, url, _, res) => {
    const f = url.searchParams.get('f') || '';
    if (!AUDIO_RE.test(f) || !(isInside(f, SFX_DIR) || isInside(f, libDir())) || !fs.existsSync(f)) { res.writeHead(403); return res.end(); }
    const type = { '.wav': 'audio/wav', '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.ogg': 'audio/ogg', '.flac': 'audio/flac', '.aac': 'audio/aac' }[path.extname(f).toLowerCase()] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': type, 'Content-Length': fs.statSync(f).size, 'Cache-Control': 'no-store' });
    fs.createReadStream(f).on('error', () => res.destroy()).pipe(res);
  });
}
