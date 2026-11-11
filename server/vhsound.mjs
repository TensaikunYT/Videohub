// Per-shot sound levels from VideoHub's scene editor (tweaks.json "sound": [{ shot, t0, t1, music, sfx, vo, all }],
// film seconds, 1 = unchanged). Shared by VideoHub (server/sound.js) and engines that build their own mix
// (3D studio engine/audio/vhsound.mjs is a copy of this file).
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';

// a level curve over film time for one channel: 1 outside the shots, the shot's level inside, 0.12 s ramps at the edges
export function soundEnv(entries, key, ramp = 0.12) {
  const E = (entries || []).filter((e) => e && e[key] != null && Math.abs(+e[key] - 1) > 1e-3 && +e.t1 > +e.t0);
  if (!E.length) return null;
  const sm = (a, b, t) => { const u = Math.min(1, Math.max(0, (t - a) / (b - a))); return u * u * (3 - 2 * u); };
  const w = (e, t) => { const r = +e.fade > 0 ? +e.fade : ramp; return sm(e.t0 - r, e.t0 + r, t) * (1 - sm(e.t1 - r, e.t1 + r, t)); };
  // old entries add up (unchanged); "duck:" ranges multiply, so a duck over a lowered film never reaches silence
  const isDuck = (e) => String(e.shot || '').startsWith('duck:'), A = E.filter((e) => !isDuck(e)), D = E.filter(isDuck);
  return (t) => { let g = 1; for (const e of A) g += w(e, t) * (+e[key] - 1); g = Math.max(0, g); for (const e of D) g *= 1 + w(e, t) * (+e[key] - 1); return Math.max(0, g); };
}
export const soundKey = (entries) => JSON.stringify((entries || []).map((e) => [e.shot, +(+e.t0).toFixed(3), +(+e.t1).toFixed(3), e.music ?? 1, e.sfx ?? 1, e.vo ?? 1, e.all ?? 1, ...(e.fade != null ? [+e.fade] : [])]));

// ---- WAV (PCM 16 / 24 / 32-bit, float 32) → { sr, ch: [Float32Array…], bits, float }
export function readWav(file) {
  const b = fs.readFileSync(file);
  if (b.toString('ascii', 0, 4) !== 'RIFF' || b.toString('ascii', 8, 12) !== 'WAVE') throw new Error('Not a WAV file: ' + file);
  let o = 12, fmt = null, data = null;
  while (o + 8 <= b.length) {
    const id = b.toString('ascii', o, o + 4), n = b.readUInt32LE(o + 4);
    if (id === 'fmt ') fmt = { tag: b.readUInt16LE(o + 8), nch: b.readUInt16LE(o + 10), sr: b.readUInt32LE(o + 12), bits: b.readUInt16LE(o + 22) };
    if (id === 'data') { data = { o: o + 8, n: Math.min(n, b.length - o - 8) }; break; }
    o += 8 + n + (n & 1);
  }
  if (!fmt || !data) throw new Error('Could not read WAV file: ' + file);
  const float = fmt.tag === 3 || (fmt.tag === 0xfffe && fmt.bits === 32 && false), B = fmt.bits / 8, frames = Math.floor(data.n / (B * fmt.nch));
  const ch = Array.from({ length: fmt.nch }, () => new Float32Array(frames));
  for (let i = 0, p = data.o; i < frames; i++) for (let c = 0; c < fmt.nch; c++, p += B) {
    ch[c][i] = float ? b.readFloatLE(p) : B === 2 ? b.readInt16LE(p) / 32768 : B === 3 ? b.readIntLE(p, 3) / 8388608 : b.readInt32LE(p) / 2147483648;
  }
  return { sr: fmt.sr, ch, bits: float ? 16 : Math.min(24, fmt.bits) };
}
export function writeWav(file, { sr, ch, bits = 16 }) {
  const B = bits === 24 ? 3 : 2, n = ch[0].length, nc = ch.length, data = Buffer.alloc(n * nc * B);
  for (let i = 0, p = 0; i < n; i++) for (let c = 0; c < nc; c++, p += B) {
    const v = Math.max(-1, Math.min(1, ch[c][i]));
    if (B === 2) data.writeInt16LE(Math.round(v * 32767), p); else data.writeIntLE(Math.round(v * 8388607), p, 3);
  }
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + data.length, 4); h.write('WAVE', 8); h.write('fmt ', 12); h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20); h.writeUInt16LE(nc, 22); h.writeUInt32LE(sr, 24); h.writeUInt32LE(sr * nc * B, 28); h.writeUInt16LE(nc * B, 32); h.writeUInt16LE(B * 8, 34);
  h.write('data', 36); h.writeUInt32LE(data.length, 40);
  const tmp = file + '.vhtmp';
  fs.writeFileSync(tmp, Buffer.concat([h, data])); replaceFile(tmp, file);
}
// put tmp in place of file: a rename (a new file, never written through a hard link); Windows refuses it while
// someone reads the file (the preview streaming it, a virus scan), so retry a moment, then write over it in place
export function replaceFile(tmp, file) {
  for (let k = 0; k < 6; k++) {
    try { fs.renameSync(tmp, file); return; } catch (e) { if (!['EPERM', 'EBUSY', 'EACCES'].includes(e.code)) throw e; }
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 120);
  }
  fs.writeFileSync(file, fs.readFileSync(tmp)); fs.unlinkSync(tmp);
}

// the mix with the levels on: from the untouched mix P and (when there) its music / sfx stems. The mix of a
// spotlight score is p·(vo + music + sfx) (p < 1 only when it was turned down to a 0.95 peak), so
// vo = P/p − music − sfx and p comes from P's correlation with the stems (the voice is independent of them).
export function remix(P, stems, entries) {
  const g = { music: soundEnv(entries, 'music'), sfx: soundEnv(entries, 'sfx'), vo: soundEnv(entries, 'vo'), all: soundEnv(entries, 'all') };
  const sr = P.sr, n = P.ch[0].length, nc = P.ch.length, out = P.ch.map((c) => new Float32Array(c));
  const M = stems?.music, S = stems?.sfx;
  const useStems = M && S && M.sr === sr && S.sr === sr && M.ch[0].length >= n * 0.98 && S.ch[0].length >= n * 0.98 && (g.music || g.sfx || g.vo);
  let note = 'overall level';
  if (useStems) {
    let num = 0, den = 0;
    for (let c = 0; c < nc; c++) { const m = M.ch[Math.min(c, M.ch.length - 1)], s = S.ch[Math.min(c, S.ch.length - 1)], p = P.ch[c];
      for (let i = 0; i < n; i += 7) { const q = (m[i] || 0) + (s[i] || 0); num += p[i] * q; den += q * q; } }
    let pk = den > 1e-9 ? num / den : 1; if (!(pk > 0.3 && pk < 1.05)) pk = 1; if (Math.abs(pk - 1) < 0.01) pk = 1;
    let peak = 0;
    for (let c = 0; c < nc; c++) {
      const m = M.ch[Math.min(c, M.ch.length - 1)], s = S.ch[Math.min(c, S.ch.length - 1)], p = P.ch[c], o = out[c];
      for (let i = 0; i < n; i++) {
        const t = i / sr, mi = m[i] || 0, si = s[i] || 0, v = p[i] / pk - mi - si;
        o[i] = v * (g.vo ? g.vo(t) : 1) + mi * (g.music ? g.music(t) : 1) + si * (g.sfx ? g.sfx(t) : 1);
        peak = Math.max(peak, Math.abs(o[i]));
      }
    }
    const k = peak > 0.95 ? 0.95 / peak : 1;
    if (k !== 1) for (const o of out) for (let i = 0; i < n; i++) o[i] *= k;
    note = `music/effects/voice channels (p=${pk.toFixed(3)})`;
  }
  if (g.all) for (const o of out) for (let i = 0; i < n; i++) o[i] *= g.all(i / sr);
  return { mix: { sr, ch: out, bits: P.bits }, note, stems: !!useStems };
}

// ---- added sound clips (Nov 6): tweaks.json "audio": { clips: [{ id, name, src, t, gain, fin, fout, trim, len, loop, mute }] }
// src is relative to tweaks.json's folder (vhaudio/<file>) or a VideoHub library path (absolute, checked by the hub).
// Clips are mixed on top of the finished mix (after the per-shot levels), so they are never turned down by them.
export const clipsOf = (tweaks) => ((tweaks && tweaks.audio && tweaks.audio.clips) || []).filter((c) => c && c.src && !c.mute && Number.isFinite(+c.t));
// a key of what the mix was built with: the per-shot levels and (when there) the clips — the same string as before
// when there are no clips, so mixes made earlier are not rebuilt for nothing
export const mixKey = (entries, clips) => soundKey(entries) + (clips && clips.length ? '|' + JSON.stringify(clips.map((c) => [c.src, +c.t, c.gain ?? 1, c.fin ?? 0, c.fout ?? 0, c.trim ?? 0, c.len ?? null, !!c.loop])) : '');

const decoded = new Map();   // file|mtime|sr|nc → channels (the hub lives long; one decode per file)
export function decodeAudio(file, sr, nc, ffmpeg = 'ffmpeg') {
  const st = fs.statSync(file), k = `${file}|${st.mtimeMs}|${sr}|${nc}`;
  if (decoded.has(k)) return decoded.get(k);
  const r = spawnSync(ffmpeg, ['-v', 'error', '-i', file, '-f', 'f32le', '-acodec', 'pcm_f32le', '-ac', String(nc), '-ar', String(sr), '-'], { maxBuffer: 2 * 1024 * 1024 * 1024 - 1, windowsHide: true });
  if (r.status !== 0 || !r.stdout) throw new Error('could not read audio file: ' + file + ' ' + String(r.stderr || '').slice(0, 200));
  const f = new Float32Array(r.stdout.buffer, r.stdout.byteOffset, Math.floor(r.stdout.length / 4));
  const n = Math.floor(f.length / nc), ch = Array.from({ length: nc }, () => new Float32Array(n));
  for (let i = 0; i < n; i++) for (let c = 0; c < nc; c++) ch[c][i] = f[i * nc + c];
  if (decoded.size > 40) decoded.delete(decoded.keys().next().value);
  decoded.set(k, ch);
  return ch;
}
// mix the clips into { sr, ch } in place; resolve(src) gives the file path. Overs are soft-limited (only the samples
// above 0.98 bend, the rest of the mix keeps its level)
export function mixClips(mix, clips, resolve, ffmpeg) {
  const { sr } = mix, nc = mix.ch.length, n = mix.ch[0].length;
  let used = 0;
  for (const c of clips) {
    const file = resolve(c.src); if (!file || !fs.existsSync(file)) continue;
    const src = decodeAudio(file, sr, nc, ffmpeg), sn = src[0].length; if (!sn) continue;
    const trim = Math.max(0, Math.round((+c.trim || 0) * sr)); if (trim >= sn) continue;
    const avail = sn - trim, start = Math.round(+c.t * sr);
    const len = c.len != null && +c.len > 0 ? Math.round(+c.len * sr) : (c.loop ? n - Math.max(0, start) : avail);
    const fin = Math.max(1, Math.round((+c.fin || 0) * sr)), fout = Math.max(1, Math.round((+c.fout || 0) * sr)), g = Math.max(0, Math.min(4, c.gain == null ? 1 : +c.gain));
    for (let i = 0; i < len; i++) {
      const o = start + i; if (o < 0) continue; if (o >= n) break;
      const j = c.loop ? trim + (i % avail) : trim + i; if (j >= sn) break;
      const e = Math.min(1, (i + 1) / fin, (len - i) / fout) * g;
      for (let ch = 0; ch < nc; ch++) mix.ch[ch][o] += src[ch][j] * e;
    }
    used++;
  }
  if (used) for (const o of mix.ch) for (let i = 0; i < n; i++) { const v = o[i], a = Math.abs(v); if (a > 0.98) o[i] = Math.sign(v) * (0.98 + 0.02 * Math.tanh((a - 0.98) / 0.02)); }
  return used;
}
