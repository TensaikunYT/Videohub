import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ENCODERS, ENCODER_ARGS, PROBE_ORDER, pickEncoder, detectEncoders, encoderEnv } from './encoders.js';
const MAC = process.platform === 'darwin', GPU = PROBE_ORDER[0];   // this OS's first hardware encoder (vt on a Mac, nvenc on Windows)

// the film render script carries its own copy of the table (films copy the script): both must say the same
test('the render script template and its example copy use the same encoder arguments as the hub', () => {
  for (const f of ['../templates/new-film/render.js', '../examples/hello-film/render.js']) {
    const src = fs.readFileSync(new URL(f, import.meta.url), 'utf8'), m = src.match(/const ENCODER_ARGS = (\{[\s\S]*?\n\});/);
    assert.ok(m, f + ' has ENCODER_ARGS');
    const table = vm.runInNewContext('(' + m[1] + ')');
    for (const n of Object.keys(ENCODER_ARGS)) assert.deepEqual(JSON.parse(JSON.stringify(table[n])), ENCODER_ARGS[n], `${f}: ${n}`);
    assert.match(src, /process\.env\.VIDEOHUB_ENCODER/);
  }
  assert.equal(fs.readFileSync(new URL('../templates/new-film/render.js', import.meta.url), 'utf8'), fs.readFileSync(new URL('../examples/hello-film/render.js', import.meta.url), 'utf8'));
});

test('a Mac: auto means VideoToolbox, then x264; Windows card encoders are not offered', { skip: !MAC }, async () => {
  const probe = ok => async n => ok.includes(n) ? ENCODER_ARGS[n].at(-1) : null;
  assert.deepEqual(PROBE_ORDER, ['vt']); assert.deepEqual(ENCODERS, ['auto', 'vt', 'x264']);
  const vt = await pickEncoder('auto', probe(['vt'])); assert.equal(vt.name, 'vt'); assert.equal(vt.args[1], 'h264_videotoolbox'); assert.ok(vt.args.includes('-q:v'));
  assert.equal((await pickEncoder('auto', probe([]))).name, 'x264');   // an Intel Mac: no constant-quality mode, the probe fails
  assert.equal((await pickEncoder('nvenc', probe(['vt']))).name, 'vt');   // a Windows choice carried over counts as auto here
  const named = await pickEncoder('vt', probe([])); assert.equal(named.name, 'x264'); assert.match(named.why, /vt is not available/);
});

test('pickEncoder: auto takes the first GPU encoder whose probe works, else x264; a named one that fails falls back', { skip: MAC }, async () => {
  const probe = ok => async n => ok.includes(n) ? ENCODER_ARGS[n].at(-1) : null;
  assert.equal((await pickEncoder('auto', probe(['amf', 'qsv']))).name, 'amf');
  assert.equal((await pickEncoder('auto', probe(['nvenc', 'amf']))).name, 'nvenc');
  const none = await pickEncoder('auto', probe([])); assert.equal(none.name, 'x264'); assert.equal(none.why, null); assert.deepEqual(none.args, ENCODER_ARGS.x264[0]);
  const want = await pickEncoder('nvenc', probe(['amf'])); assert.equal(want.name, 'x264'); assert.match(want.why, /nvenc is not available/);
  assert.equal((await pickEncoder('amf', probe(['amf']))).args.at(1), 'h264_amf');
  assert.equal((await pickEncoder('auto', async () => { throw new Error('ffmpeg missing'); })).name, 'x264');   // a probe that throws counts as "no"
  assert.equal((await pickEncoder('warp9', probe(['qsv']))).name, 'qsv');   // unknown → auto
  let probed = 0; assert.equal((await pickEncoder('x264', async () => { probed++; return []; })).name, 'x264'); assert.equal(probed, 0);
  assert.deepEqual(PROBE_ORDER, ['nvenc', 'amf', 'qsv']); assert.deepEqual(ENCODERS, ['auto', 'nvenc', 'amf', 'qsv', 'x264']);
});

test('detectEncoders probes once and caches (memory and file, keyed by the ffmpeg binary)', async () => {
  const dir = new URL('../.test-tmp/encoders-cache/', import.meta.url); fs.mkdirSync(dir, { recursive: true });
  const cacheFile = fileURLToPath(new URL('cache.json', dir)); try { fs.renameSync(cacheFile, cacheFile + '.' + Date.now()); } catch { }   // (a URL's pathname breaks on folders with spaces)
  const last = PROBE_ORDER.at(-1);
  let calls = 0; const probe = async n => { calls++; return n === last ? ['x'] : null; }, gpus = async () => ['Some GPU'];
  const a = await detectEncoders({ ffmpeg: 'fake-ffmpeg-1', cacheFile, probe, gpus });
  assert.deepEqual(a.available, [last, 'x264']); assert.equal(a.best, last); assert.deepEqual(a.gpus, ['Some GPU']); assert.equal(calls, PROBE_ORDER.length);
  await detectEncoders({ ffmpeg: 'fake-ffmpeg-1', cacheFile, probe, gpus }); assert.equal(calls, PROBE_ORDER.length);
  assert.equal(JSON.parse(fs.readFileSync(cacheFile, 'utf8')).v.best, last);
  const b = await detectEncoders({ ffmpeg: 'fake-ffmpeg-1', cacheFile, probe: async () => null, gpus, refresh: true }); assert.deepEqual(b.available, ['x264']);
});

test('render jobs get the configured encoder unless the job sets its own', () => {
  assert.deepEqual(encoderEnv({}, GPU), { VIDEOHUB_ENCODER: GPU });
  assert.deepEqual(encoderEnv({ VIDEOHUB_ENCODER: 'x264' }, GPU), {});
  assert.deepEqual(encoderEnv({}, 'amf', ['auto', 'amf', 'x264']), { VIDEOHUB_ENCODER: 'amf' });
  assert.deepEqual(encoderEnv({}, MAC ? 'amf' : 'vt'), { VIDEOHUB_ENCODER: 'auto' });   // another OS's encoder
  assert.deepEqual(encoderEnv({}, undefined), { VIDEOHUB_ENCODER: 'auto' }); assert.deepEqual(encoderEnv({}, 'bogus'), { VIDEOHUB_ENCODER: 'auto' });
});

// the render script's own selection and ffmpeg arguments, with ffmpeg mocked (no encode runs)
function renderScript(env, works, platform = 'win32') {
  const src = fs.readFileSync(new URL('../templates/new-film/render.js', import.meta.url), 'utf8');
  const head = src.slice(0, src.indexOf('(async () => {')), spawned = [], probed = [];
  const cp = { spawn: (cmd, args) => { spawned.push(args); return {}; }, execFileSync() { }, spawnSync: (cmd, args) => { const c = args[args.indexOf('-c:v') + 1]; probed.push(c); return { status: works.some(w => c.includes(w)) ? 0 : 1 }; } };
  const ctx = { require: m => m === 'child_process' ? cp : m === 'fs' ? fs : m === 'path' ? path : m === 'os' ? { homedir: () => 'X:\home' } : m === 'url' ? { pathToFileURL: x => x } : {}, process: { env, argv: [], platform }, console: { log() { }, error() { } }, Buffer, URL, __dirname: '.' };
  vm.createContext(ctx); vm.runInContext(head + '\nglobalThis.api = { pickEncoder, encoder, setEnc: e => { ENC = e; } };', ctx);
  return { ...ctx.api, spawned, probed };
}
test('render.js: auto probes nvenc, amf, qsv in that order and falls back to x264; raw input with BT.601 conversion', () => {
  let r = renderScript({}, ['amf']); assert.equal(r.pickEncoder().name, 'amf'); assert.deepEqual(r.probed, ['h264_nvenc', 'h264_amf']);
  r = renderScript({}, []); assert.equal(r.pickEncoder().name, 'x264'); assert.deepEqual(r.probed, ['h264_nvenc', 'h264_amf', 'h264_amf', 'h264_qsv']);   // amf: with and without B-frames
  r = renderScript({ VIDEOHUB_ENCODER: 'nvenc' }, ['amf']); assert.equal(r.pickEncoder().name, 'x264');
  r = renderScript({ VIDEOHUB_ENCODER: 'x264' }, ['nvenc']); assert.equal(r.pickEncoder().name, 'x264'); assert.equal(r.probed.length, 0);
  r = renderScript({ VIDEOHUB_ENCODER: 'amf' }, ['amf']); r.setEnc(r.pickEncoder()); r.encoder('raw', 'c_000.mp4.tmp.mp4');
  const a = [...r.spawned[0]], at = k => a[a.indexOf(k) + 1];
  assert.equal(at('-f'), 'rawvideo'); assert.equal(at('-pix_fmt'), 'rgba'); assert.equal(at('-s'), '1920x1080'); assert.equal(at('-c:v'), 'h264_amf');
  assert.match(at('-vf'), /out_color_matrix=bt601/); assert.equal(a.at(-1), 'c_000.mp4.tmp.mp4');
  r = renderScript({ PREVIEW: '1' }, []); r.setEnc(r.pickEncoder()); r.encoder('png', 'x.mp4'); const b = [...r.spawned[0]];
  assert.equal(b[b.indexOf('-c:v') + 1], 'png'); assert.equal(b[b.indexOf('-framerate') + 1], '30');
});

test('render.js on a Mac: auto probes VideoToolbox only, then x264; looks for Chrome, Edge, Brave, Chromium in Applications', () => {
  let r = renderScript({}, ['videotoolbox'], 'darwin'); const vt = r.pickEncoder(); assert.equal(vt.name, 'vt'); assert.deepEqual(r.probed, ['h264_videotoolbox']);
  r.setEnc(vt); r.encoder('raw', 'c_000.mp4.tmp.mp4'); const a = [...r.spawned[0]];
  assert.equal(a[a.indexOf('-c:v') + 1], 'h264_videotoolbox'); assert.match(a[a.indexOf('-vf') + 1], /out_color_matrix=bt601/);
  r = renderScript({}, [], 'darwin'); assert.equal(r.pickEncoder().name, 'x264'); assert.deepEqual(r.probed, ['h264_videotoolbox']);
  const src = fs.readFileSync(new URL('../templates/new-film/render.js', import.meta.url), 'utf8');
  for (const app of ['Google Chrome', 'Microsoft Edge', 'Brave Browser', 'Chromium']) assert.ok(src.includes(`'${app}'`), app);
});
