// Video encoders for renders: which ones this PC can use (one tiny test encode each, cached) and the ffmpeg arguments
// for each. Shared by the hub (Settings, render options, the env of render jobs) and setup (scripts/init-config.mjs).
// The film render script (templates/new-film/render.js) carries its own copy of ENCODER_ARGS because films copy it;
// encoders.test.js checks that the two stay the same. Measurements and what is unverified: docs/RENDER-SPEED.md.
import fs from 'node:fs';
import os from 'node:os';
import { spawn } from 'node:child_process';
export { gpuNames } from './platform.js';
import { gpuNames, OS } from './platform.js';

export const ENCODERS = ['auto', 'nvenc', 'amf', 'vaapi', 'qsv', 'videotoolbox', 'x264'];
export const PROBE_ORDER = ({ win32: ['nvenc', 'amf', 'qsv'], linux: ['nvenc', 'vaapi', 'qsv'], darwin: ['videotoolbox'] })[OS] || [];   // auto: the first that works, else x264
export const LABELS = { videotoolbox: 'Mac graphics (VideoToolbox)', vaapi: 'Linux graphics (VA-API)', auto: 'Automatic (graphics card if it can, else processor)', nvenc: 'NVIDIA graphics card (NVENC)', amf: 'AMD graphics card (AMF)', qsv: 'Intel graphics (Quick Sync)', x264: 'Processor (x264)' };
// Candidate argument sets per encoder, best first (the probe keeps the first one the card accepts). Same picture
// quality as x264 or better, measured against a lossless reference: see docs/RENDER-SPEED.md.
export const ENCODER_ARGS = {
  // measured on another PC with an NVIDIA card (VMAF 94.48 vs x264 94.25), not on the PC this was tested on;
  // -level 5.2 + a high maxrate avoid a ~40 Mbit/s ceiling on grainy 1080p60
  nvenc: [['-c:v', 'h264_nvenc', '-preset', 'p7', '-tune', 'hq', '-rc', 'vbr', '-cq', '20', '-b:v', '0', '-maxrate', '250M', '-bufsize', '500M', '-level', '5.2', '-spatial-aq', '1', '-temporal-aq', '1', '-rc-lookahead', '32', '-bf', '3', '-b_ref_mode', 'middle']],
  // measured on an AMD RDNA2 card: VMAF/SSIM/PSNR at or above x264 on a clean and a grainy clip (docs/RENDER-SPEED.md)
  amf: [['-c:v', 'h264_amf', '-usage', 'transcoding', '-quality', 'quality', '-rc', 'cqp', '-qp_i', '14', '-qp_p', '16', '-qp_b', '18', '-bf', '3'],
    ['-c:v', 'h264_amf', '-usage', 'transcoding', '-quality', 'quality', '-rc', 'cqp', '-qp_i', '14', '-qp_p', '16', '-qp_b', '18']],
  // unverified (no Intel GPU was available): global quality 18 with look-ahead
  qsv: [['-c:v', 'h264_qsv', '-preset', 'veryslow', '-global_quality', '18', '-look_ahead', '1']],
  vaapi: [['-vaapi_device', '/dev/dri/renderD128', '-vf', 'format=nv12,hwupload', '-c:v', 'h264_vaapi', '-qp', '18']],
  videotoolbox: [['-c:v', 'h264_videotoolbox', '-q:v', '65'], ['-c:v', 'h264_videotoolbox', '-b:v', '10M']],
  x264: [['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '16']],
};

// what to use: a named encoder if its probe passes, auto → the first GPU encoder that passes, otherwise x264.
// probe(name) → the working argument list or null. Never throws; `why` says when a wish could not be met.
export async function pickEncoder(want, probe) {
  want = ENCODERS.includes(want) ? want : 'auto';
  const tryOne = async n => { try { return await probe(n); } catch { return null; } };
  if (want === 'x264') return { name: 'x264', args: ENCODER_ARGS.x264[0], why: null };
  if (want !== 'auto') { const a = await tryOne(want); return a ? { name: want, args: a, why: null } : { name: 'x264', args: ENCODER_ARGS.x264[0], why: `${want} is not available on this PC: using x264` }; }
  for (const n of PROBE_ORDER) { const a = await tryOne(n); if (a) return { name: n, args: a, why: null }; }
  return { name: 'x264', args: ENCODER_ARGS.x264[0], why: null };
}

export function encoderCandidates(name, arch = os.arch()) { const candidates = ENCODER_ARGS[name] || []; return name === 'videotoolbox' && arch !== 'arm64' ? [...candidates].reverse() : candidates; }

// one tiny encode (5 frames 640x360) per candidate; resolves to the working argument list or null
export function probeWith(ffmpeg = 'ffmpeg') {
  return name => new Promise(async resolve => {
    for (const args of encoderCandidates(name)) {
      const ok = await new Promise(r => {
        let c; try { c = spawn(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=gray:s=640x360:r=30', '-frames:v', '5', '-pix_fmt', 'yuv420p', ...args, '-f', 'null', '-'], { windowsHide: true, stdio: 'ignore' }); } catch { return r(false); }
        const t = setTimeout(() => { try { c.kill(); } catch { } r(false); }, 20000);
        c.on('error', () => { clearTimeout(t); r(false); }); c.on('close', code => { clearTimeout(t); r(code === 0); });
      });
      if (ok) return resolve(args);
    }
    resolve(null);
  });
}

// the graphics cards Windows reports (names only; virtual display adapters left out)
// What this PC can use: { available: ['amf', 'x264'], best: 'amf', gpus: [...], at }. Cached in memory and in
// cacheFile, keyed by the ffmpeg binary (path, size, date): a new ffmpeg or driver probe again with refresh.
let mem = null;
export async function detectEncoders({ ffmpeg = 'ffmpeg', cacheFile = null, refresh = false, probe = null, gpus = gpuNames } = {}) {
  let key = ffmpeg; try { const s = fs.statSync(ffmpeg); key += '|' + s.size + '|' + s.mtimeMs; } catch { }
  if (!refresh && mem?.key === key) return mem.v;
  if (!refresh && cacheFile) { try { const c = JSON.parse(fs.readFileSync(cacheFile, 'utf8')); if (c.key === key && Array.isArray(c.v?.available)) { mem = c; return c.v; } } catch { } }
  const pr = probe || probeWith(ffmpeg), available = [];
  for (const n of PROBE_ORDER) if (await pr(n).catch(() => null)) available.push(n);
  available.push('x264');
  const v = { available, best: available[0], gpus: await gpus().catch(() => []), at: new Date().toISOString() };
  mem = { key, v };
  if (cacheFile) { try { fs.writeFileSync(cacheFile, JSON.stringify(mem, null, 1)); } catch { } }
  return v;
}

// the environment a render job gets: the job's own VIDEOHUB_ENCODER wins, else the configured choice
export const encoderEnv = (jobEnv = {}, configured = 'auto') => jobEnv.VIDEOHUB_ENCODER ? {} : { VIDEOHUB_ENCODER: ENCODERS.includes(configured) ? configured : 'auto' };
