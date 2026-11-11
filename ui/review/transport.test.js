import test from 'node:test';
import assert from 'node:assert/strict';
import { parseTime, fmtTC, createShuttle } from './transport.js';

const F = 30, frameOf = t => Math.floor(t * F + 1e-4);

test('parseTime: every form lands on the right frame', () => {
  assert.equal(frameOf(parseTime('0:10:00', F)), 300);       // m:ss:ff
  assert.equal(frameOf(parseTime('1:23:12', F)), 83 * 30 + 12);
  assert.equal(frameOf(parseTime('12.5', F)), 375);           // seconds
  assert.equal(frameOf(parseTime('12,5', F)), 375);           // comma decimal
  assert.equal(frameOf(parseTime('83', F)), 2490);
  assert.equal(frameOf(parseTime('1:23.45', F)), frameOf(83.45));
  assert.equal(frameOf(parseTime('3:14.5', F)), frameOf(194.5));
  for (const s of ['k300', 'f300', '#300', 'K300']) assert.equal(frameOf(parseTime(s, F)), 300, s);
  const now = 100.5 / F;                                       // playhead on frame 100
  assert.equal(frameOf(parseTime('+2', F, now)), 160);
  assert.equal(frameOf(parseTime('-0.5', F, now)), 85);
  assert.equal(frameOf(parseTime('-10f', F, now)), 90);
  assert.equal(frameOf(parseTime('+10f', F, now)), 110);
  assert.equal(frameOf(parseTime('-3k', F, now)), 97);
  assert.equal(frameOf(parseTime('-500f', F, now)), 0);       // never before the start
  // the result is the middle of the frame (stable on real videos)
  assert.equal(parseTime('k10', F), 10.5 / F);
});

test('parseTime: rubbish gives null', () => {
  for (const s of ['', 'abc', '1:75', '0:10:45', '+1.5f', 'k', '1:2:3:4', '--2', '12..5']) assert.equal(parseTime(s, F), null, s);
});

test('fmtTC: the old m:ss.cc look, never :60', () => {
  assert.equal(fmtTC(12.4), '0:12.40');
  assert.equal(fmtTC(0), '0:00.00');
  assert.equal(fmtTC(59.999), '0:59.99');
  assert.equal(fmtTC(83.45), '1:23.45');
  assert.equal(fmtTC(-1), '0:00.00');
});

function rig(start = 5) {
  const S = { t: start, playing: false, rate: 1, base: 1, seeking: false, seeks: 0, frames: [], clock: 0, changes: [] };
  const sh = createShuttle({
    now: () => S.t, seek: t => { S.t = Math.max(0, t); S.seeks++; }, play: () => { S.playing = true; }, pause: () => { S.playing = false; },
    setPlaybackRate: r => { S.rate = r; }, baseRate: () => S.base, seeking: () => S.seeking, onChange: s => S.changes.push(s), fps: () => F,
    raf: cb => { S.frames.push(cb); return S.frames.length; }, caf: () => { S.frames = []; }, clock: () => S.clock,
  });
  const frame = (ms = 100) => { S.clock += ms; const cbs = S.frames; S.frames = []; for (const cb of cbs) cb(); };
  return { S, sh, frame };
}

test('shuttle forward: 1× play, then 2× 4× 8×; stop restores the select rate and pauses', () => {
  const { S, sh } = rig(); S.base = 0.5;
  sh.forward(); assert.equal(S.playing, true); assert.equal(S.rate, 1); assert.equal(sh.speed(), 1);
  sh.forward(); assert.equal(S.rate, 2); sh.forward(); assert.equal(S.rate, 4); sh.forward(); sh.forward(); assert.equal(S.rate, 8);
  assert.deepEqual(S.changes, [1, 2, 4, 8, 8]);
  assert.equal(sh.stop(), true); assert.equal(S.rate, 0.5); assert.equal(S.playing, false); assert.equal(sh.active(), false);
  assert.equal(sh.stop(), false);
});

test('shuttle reverse: walks back by seeks, faster on repeat, stops at 0', () => {
  const { S, sh, frame } = rig(1);
  S.playing = true; sh.reverse(); assert.equal(S.playing, false); assert.equal(sh.speed(), -1);
  frame(100); assert.ok(Math.abs(S.t - 0.9) < 1e-9);
  sh.reverse(); assert.equal(sh.speed(), -2);
  frame(100); assert.ok(Math.abs(S.t - 0.7) < 1e-9);
  S.seeking = true; const n = S.seeks; frame(100); assert.equal(S.seeks, n);   // one seek in flight at most
  S.seeking = false; frame(100); assert.ok(Math.abs(S.t - 0.3) < 1e-9);        // time still counted while waiting
  frame(100); frame(100); assert.equal(S.t, 0); assert.equal(sh.active(), false); assert.equal(S.frames.length, 0);
});

test('shuttle reverse keeps real speed at a slow rAF, but a long stall moves at most 0.25 s', () => {
  const { S, sh, frame } = rig(5);
  sh.reverse(); frame(250); assert.ok(Math.abs(S.t - 4.75) < 1e-9);
  frame(3000); assert.ok(Math.abs(S.t - 4.5) < 1e-9);
  sh.stop();
});

test('shuttle reverse gives up when someone else moves the playhead; forward after reverse plays', () => {
  const { S, sh, frame } = rig(3);
  sh.reverse(); frame(100); S.t = 1; frame(100); assert.equal(sh.active(), false);
  sh.reverse(); sh.forward(); assert.equal(sh.speed(), 1); assert.equal(S.playing, true); frame(100); assert.equal(S.t, 1);
  sh.stop({ pause: false }); assert.equal(S.playing, true); assert.equal(S.rate, 1);
});
