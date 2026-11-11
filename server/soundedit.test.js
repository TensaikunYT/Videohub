// Added sound clips: validation and mixing (uses ffmpeg on small temp WAVs). RG_TEST
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { writeWav, readWav, mixClips, clipsOf, mixKey, soundKey } from './vhsound.mjs';
import { cleanAudio } from './soundedit.js';
import { cleanItems, cleanActors } from './edit2d.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vh-soundedit-'));
test.after(() => { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { } });
const sr = 8000;
function tone(sec, amp, f = 440) { const n = Math.round(sec * sr), c = new Float32Array(n); for (let i = 0; i < n; i++) c[i] = amp * Math.sin(2 * Math.PI * f * i / sr); return c; }

test('cleanAudio keeps only vhaudio/ files and clamps numbers', () => {
  const a = cleanAudio({ clips: [
    { src: 'vhaudio/boom.wav', t: 2, gain: 9, fin: -1 },
    { src: '../../etc/passwd.wav', t: 1 },
    { src: 'C:/x/y.wav', t: 1 },
    { src: 'vhaudio/bed.mp3', t: 0, loop: true, kind: 'music', len: '' },
  ] });
  assert.equal(a.clips.length, 2);
  assert.equal(a.clips[0].gain, 4); assert.equal(a.clips[0].fin, 0);
  assert.equal(a.clips[1].kind, 'music'); assert.equal(a.clips[1].len, null); assert.equal(a.clips[1].loop, true);
});

test('mixClips puts a clip at its time with its gain; loop fills to the end; mute is skipped', () => {
  fs.mkdirSync(path.join(tmp, 'vhaudio'), { recursive: true });
  writeWav(path.join(tmp, 'vhaudio', 'beep.wav'), { sr, ch: [tone(0.5, 0.5), tone(0.5, 0.5)], bits: 16 });
  const mix = { sr, ch: [new Float32Array(sr * 3), new Float32Array(sr * 3)], bits: 16 };
  const clips = clipsOf({ audio: { clips: [{ src: 'vhaudio/beep.wav', t: 1, gain: 0.5 }, { src: 'vhaudio/beep.wav', t: 0, mute: true }] } });
  assert.equal(clips.length, 1);
  const n = mixClips(mix, clips, (s) => path.join(tmp, s));
  assert.equal(n, 1);
  const peak = (a, b) => { let m = 0; for (let i = Math.round(a * sr); i < Math.round(b * sr); i++) m = Math.max(m, Math.abs(mix.ch[0][i])); return m; };
  assert.ok(peak(0, 0.95) < 1e-4, 'silent before the clip');
  assert.ok(Math.abs(peak(1.05, 1.45) - 0.25) < 0.02, 'gain 0.5 of a 0.5 tone');
  assert.ok(peak(1.6, 3) < 1e-4, 'silent after');
  const loop = { sr, ch: [new Float32Array(sr * 3), new Float32Array(sr * 3)], bits: 16 };
  mixClips(loop, [{ src: 'vhaudio/beep.wav', t: 0.5, loop: true, gain: 1 }], (s) => path.join(tmp, s));
  let m = 0; for (let i = Math.round(2.6 * sr); i < Math.round(2.9 * sr); i++) m = Math.max(m, Math.abs(loop.ch[0][i]));
  assert.ok(m > 0.4, 'the loop still plays near the end');
});

test('mixKey is the old soundKey when there are no clips', () => {
  const e = [{ shot: '*', t0: 0, t1: 5, music: 0 }];
  assert.equal(mixKey(e, []), soundKey(e));
  assert.notEqual(mixKey(e, [{ src: 'vhaudio/a.wav', t: 1 }]), soundKey(e));
});

test('2D items and actors are validated', () => {
  const it = cleanItems([{ kind: 'text', text: 'Hello', x: 100, y: 50, t0: 2, t1: 1 }, { kind: 'image', src: '../x.png' }, { kind: 'image', src: 'vh2d/logo.png' }, { kind: 'evil' }]);
  assert.deepEqual(it.map((x) => x.kind), ['text', 'image']);
  assert.ok(it[0].t1 > it[0].t0);
  const a = cleanActors({ 'shot1|hero#1': { dx: 10, s: 1 }, '*|robot#1': { hide: true }, 'bad': { dx: 1 }, 'x|y#1': { dx: 0, dy: 0, s: 1 } });
  assert.deepEqual(Object.keys(a), ['shot1|hero#1', '*|robot#1']);
  assert.equal(a['shot1|hero#1'].s, undefined);
});
