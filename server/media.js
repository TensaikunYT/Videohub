// Things the review player needs from a video: a film strip, a waveform, exact frames, and a
// "review copy" with a keyframe every 6 frames so stepping back one frame is instant.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { DATA_DIR, TOOLS, run, probe, readJson, writeJson, now, refersToHub } from './util.js';
import { guardState } from './guard.js';

export const CACHE = path.join(DATA_DIR, 'media');
export const PROXY = path.join(DATA_DIR, 'proxy');
fs.mkdirSync(CACHE, { recursive: true }); fs.mkdirSync(PROXY, { recursive: true });
const PROXY_MAX = 15 * 1073741824;

const keyOf = (file, st) => crypto.createHash('sha1').update(path.resolve(file).toLowerCase() + '|' + st.size + '|' + Math.round(st.mtimeMs)).digest('hex').slice(0, 16);

// one heavy media job at a time; light ones (strip, wave, frame) share a separate lane
function lane(n) { let free = n; const q = []; return fn => new Promise((res, rej) => { const go = () => { free--; fn().then(res, rej).finally(() => { free++; const x = q.shift(); if (x) x(); }); }; free > 0 ? go() : q.push(go); }); }
const light = lane(1);
const inflight = new Map();
const once = (k, fn) => { if (inflight.has(k)) return inflight.get(k); const p = fn().finally(() => inflight.delete(k)); inflight.set(k, p); return p; };

// ---------- film strip: one sprite of small frames (from keyframes only, so it is fast)
export async function strip(file) {
  const st = fs.statSync(file), k = keyOf(file, st), meta = path.join(CACHE, k + '-strip.json');
  const cached = readJson(meta); if (cached && fs.existsSync(path.join(CACHE, cached.img))) return cached;
  return once('strip' + k, () => light(async () => {
    const info = await probe(file, st); if (!info.ok) return null;
    const dur = info.dur || 1, step = Math.max(2, Math.ceil(dur / 240)), n = Math.max(1, Math.ceil(dur / step));
    const tw = 160, th = 2 * Math.round(tw * info.h / info.w / 2), cols = 16, rows = Math.ceil(n / cols);
    const img = k + '-strip.jpg';
    await run(TOOLS.ffmpeg, ['-v', 'error', '-y', '-skip_frame', 'nokey', '-i', file, '-an', '-vf', `fps=1/${step},scale=${tw}:${th},tile=${cols}x${rows}`, '-frames:v', '1', '-q:v', '5', path.join(CACHE, img)]);
    if (!fs.existsSync(path.join(CACHE, img))) return null;
    const m = { img, url: '/api/media/img/' + img, step, n, cols, rows, tw, th, dur };
    writeJson(meta, m); return m;
  }));
}

// ---------- waveform picture
export async function wave(file) {
  const st = fs.statSync(file), k = keyOf(file, st), img = k + '-wave.png', f = path.join(CACHE, img);
  if (fs.existsSync(f)) return { url: '/api/media/img/' + img };
  const info = await probe(file, st); if (!info.audio) return null;
  return once('wave' + k, () => light(async () => {
    await run(TOOLS.ffmpeg, ['-v', 'error', '-y', '-i', file, '-filter_complex', 'aformat=channel_layouts=mono,showwavespic=s=2400x90:colors=#9aa0b0:scale=sqrt', '-frames:v', '1', f]);
    return fs.existsSync(f) ? { url: '/api/media/img/' + img } : null;
  }));
}

// ---------- waveform peaks for the timeline: Int8 [min0,max0,min1,max1,…] at 100 buckets/s (mono, 8 kHz, 80 samples
// per bucket); cached as <key>.peaks, so a rebuilt mix (new mtime/size) gets new peaks
export const PEAKS_RATE = 100;
export function peaksOf(f32, per = 80) {   // Float32Array of samples → Int8Array of min/max pairs
  const n = Math.ceil(f32.length / per), out = new Int8Array(n * 2), q = v => Math.max(-127, Math.min(127, Math.round(v * 127)));
  for (let i = 0; i < n; i++) {
    let lo = 1, hi = -1; const e = Math.min(f32.length, (i + 1) * per);
    for (let j = i * per; j < e; j++) { const v = f32[j]; if (v < lo) lo = v; if (v > hi) hi = v; }
    out[2 * i] = q(lo); out[2 * i + 1] = q(hi);
  }
  return out;
}
export async function peaks(file) {
  const st = fs.statSync(file), k = keyOf(file, st), f = path.join(CACHE, k + '.peaks');
  if (fs.existsSync(f)) return f;
  const info = await probe(file, st); if (!info.audio) return null;
  return once('peaks' + k, () => light(async () => {
    if (fs.existsSync(f)) return f;
    // streamed: one bucket (80 samples = 320 bytes) at a time, so an hour of sound never sits in memory as PCM
    const data = await new Promise((resolve, reject) => {
      const p = spawn(TOOLS.ffmpeg, ['-v', 'error', '-i', file, '-vn', '-ac', '1', '-ar', '8000', '-f', 'f32le', 'pipe:1'], { windowsHide: true });
      const BUCKET = 80 * 4, out = []; let rest = Buffer.alloc(0), err = '';
      const take = buf => { const n = Math.floor(buf.length / 4), f = new Float32Array(n); for (let i = 0; i < n; i++) f[i] = buf.readFloatLE(i * 4); out.push(peaksOf(f)); };
      p.stdout.on('data', d => {
        const b = rest.length ? Buffer.concat([rest, d]) : d, whole = b.length - (b.length % BUCKET);
        if (whole) take(b.subarray(0, whole));
        rest = Buffer.from(b.subarray(whole));
      });
      p.stderr.on('data', d => { err = (err + d).slice(-400); });
      p.on('error', reject);
      p.on('close', c => {
        if (c !== 0) return reject(new Error('ffmpeg ' + c + ': ' + err));
        if (rest.length >= 4) take(rest);
        const all = new Int8Array(out.reduce((s, a) => s + a.length, 0)); let o = 0; for (const a of out) { all.set(a, o); o += a.length; }
        resolve(all);
      });
    });
    const tmp = f + '.part'; fs.writeFileSync(tmp, data); fs.renameSync(tmp, f);
    return f;
  }));
}

// ---------- one exact frame as PNG (frame number -> time)
export async function frame(file, n) {
  const st = fs.statSync(file), k = keyOf(file, st), info = await probe(file, st), fps = info.fps || 30;
  const f = path.join(CACHE, `${k}-f${n}.png`);
  if (!fs.existsSync(f)) await light(() => run(TOOLS.ffmpeg, ['-v', 'error', '-y', '-ss', (n / fps).toFixed(6), '-i', file, '-frames:v', '1', f]));
  return fs.existsSync(f) ? f : null;
}

// ---------- review copy (same frames, a keyframe every 6 frames, <= 1080p)
const listeners = new Set();
export const onProxy = fn => { listeners.add(fn); return () => listeners.delete(fn); };
const emit = ev => { for (const fn of listeners) try { fn(ev); } catch { } };
const INDEX = path.join(PROXY, 'index.json');
let index = readJson(INDEX, {});
// drop copies that are gone, and copies whose source video was deleted or moved
function prune() {
  for (const [k, x] of Object.entries(index)) {
    const out = path.join(PROXY, k + '.mp4');
    if (!fs.existsSync(out)) { delete index[k]; continue; }
    if (x.file && !fs.existsSync(x.file)) { try { fs.unlinkSync(out); } catch { } delete index[k]; }
  }
}
prune(); writeJson(INDEX, index);
const jobs = new Map();           // key -> { file, progress, state }
const queue = [];
let working = false;

export const makingCopies = () => working || queue.length > 0;   // review copies being made or waiting

export function proxyStatus(file) {
  const st = fs.statSync(file), k = keyOf(file, st), out = path.join(PROXY, k + '.mp4');
  if (index[k]?.done && fs.existsSync(out)) { index[k].used = Date.now(); writeJson(INDEX, index); return { state: 'ready', path: out, key: k }; }
  const j = jobs.get(k);
  if (j) return { state: j.state, progress: j.progress, key: k, waiting: j.waiting || null };
  jobs.set(k, { file, out, key: k, state: 'queued', progress: 0 }); queue.push(k); pump();
  return { state: 'queued', progress: 0, key: k };
}

function busy() {   // wait while a real render runs or RAM is short
  const g = guardState(); if (!g.running) return null;
  if ((g.ramAvailMB || 9999) < 2000) return 'low RAM';
  const r = (g.renders || []).find(x => !x.paused && !refersToHub((x.cmd || '') + ' ' + (x.cwd || '')));   // the hub's own ffmpeg jobs (paths inside this install) are not renders
  return r ? 'render in progress' : null;
}

async function pump() {
  if (working) return; working = true;
  try {
    while (queue.length) {
      const k = queue[0], j = jobs.get(k);
      const why = busy();
      if (why) { if (j.waiting !== why) { j.waiting = why; emit({ key: k, file: j.file, state: 'queued', progress: 0, waiting: why }); } await new Promise(r => setTimeout(r, 5000)); continue; }
      queue.shift(); j.waiting = null;
      if (!fs.existsSync(j.file)) { jobs.delete(k); continue; }   // the video was deleted or moved while waiting
      try { await makeProxy(j); } catch (e) { j.state = 'failed'; j.error = String(e.message || e); emit({ key: k, file: j.file, state: 'failed', error: j.error }); }
      jobs.delete(k);
    }
  } finally { working = false; }
}

async function makeProxy(j) {
  const info = await probe(j.file); const dur = info.dur || 1;
  const tmp = j.out.replace(/\.mp4$/, '.part.mp4');
  j.state = 'running'; emit({ key: j.key, file: j.file, state: 'running', progress: 0 });
  const args = ['-v', 'error', '-y', '-i', j.file, '-map', '0:v:0', '-map', '0:a:0?', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '24',   // 24, not 20: a 1080p film's copy was 1.15 GB (GOP 6 costs a lot); copies made before stay
    '-g', '6', '-keyint_min', '6', '-sc_threshold', '0', '-bf', '0', '-vf', "scale='min(1920,iw)':-2", '-pix_fmt', 'yuv420p', '-threads', '4',
    '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', '-progress', 'pipe:1', '-nostats', tmp];
  await new Promise((resolve, reject) => {
    const p = spawn(TOOLS.ffmpeg, args, { windowsHide: true });
    try { os.setPriority(p.pid, os.constants.priority.PRIORITY_BELOW_NORMAL); } catch { }
    let last = 0;
    p.stdout.on('data', d => { const m = String(d).match(/out_time_us=(\d+)/g); if (!m) return; const us = +m[m.length - 1].split('=')[1]; j.progress = Math.min(0.99, us / 1e6 / dur); if (Date.now() - last > 700) { last = Date.now(); emit({ key: j.key, file: j.file, state: 'running', progress: j.progress }); } });
    let err = ''; p.stderr.on('data', d => { err += d; });
    p.on('close', c => c === 0 ? resolve() : reject(new Error('ffmpeg ' + c + ': ' + err.slice(0, 200))));
  });
  fs.renameSync(tmp, j.out);
  index[j.key] = { file: j.file, done: now(), used: Date.now(), size: fs.statSync(j.out).size }; writeJson(INDEX, index);
  evict();
  j.state = 'ready'; emit({ key: j.key, file: j.file, state: 'ready', progress: 1 });
}

function evict() {   // keep the cache under 15 GB, oldest-used first
  prune();
  let total = Object.values(index).reduce((s, x) => s + (x.size || 0), 0);
  for (const [k, x] of Object.entries(index).sort((a, b) => a[1].used - b[1].used)) {
    if (total <= PROXY_MAX) break;
    try { fs.unlinkSync(path.join(PROXY, k + '.mp4')); } catch { }
    total -= x.size || 0; delete index[k];
  }
  writeJson(INDEX, index);
}

export function routes(route, allowed) {
  const need = (url) => { const f = url.searchParams.get('p'); if (!f || !allowed(f) || !fs.existsSync(f)) throw Object.assign(new Error('access denied'), { code: 403 }); return f; };
  route('GET', '/api/media/strip', async (req, url) => (await strip(need(url))) || { error: 'not found' });
  route('GET', '/api/media/wave', async (req, url) => (await wave(need(url))) || { none: true });
  route('GET', '/api/media/peaks', async (req, url, _, res) => {
    const f = await peaks(need(url));
    if (!f) { res.writeHead(404); return res.end(); }
    const n = fs.statSync(f).size;
    res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': n, 'X-Peaks-Rate': String(PEAKS_RATE), 'X-Duration': (n / 2 / PEAKS_RATE).toFixed(3), 'Cache-Control': 'no-cache', 'Access-Control-Expose-Headers': 'X-Peaks-Rate, X-Duration' });
    fs.createReadStream(f).on('error', () => res.destroy()).pipe(res);
  });
  route('GET', '/api/media/proxy', (req, url) => { const s = proxyStatus(need(url)); return s.state === 'ready' ? { ...s, url: '/media?p=' + encodeURIComponent(s.path) } : s; });
  route('GET', '/api/media/frame', async (req, url, _, res) => {
    const f = await frame(need(url), +url.searchParams.get('n') || 0);
    if (!f) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': 'image/png' }); fs.createReadStream(f).on('error', () => res.destroy()).pipe(res);
  });
  route('GET', '/api/media/img/:name', (req, url, { name }, res) => {
    const f = path.join(CACHE, path.basename(name));
    if (!fs.existsSync(f)) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': f.endsWith('.png') ? 'image/png' : 'image/jpeg', 'Cache-Control': 'max-age=86400' }); fs.createReadStream(f).on('error', () => res.destroy()).pipe(res);
  });
}
