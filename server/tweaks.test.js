// tweaks.json writer: key-by-key merge, field-level sound ops, cleaners, strict read, atomic write
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { cleanCuts, cleanSound, applySoundOps, mergeTweaks, readTweaksStrict, writeTweaks } from './tweaks.js';
import { cleanAudio } from './soundedit.js';
import { cleanItems, cleanActors } from './edit2d.js';

const C = { cleanAudio, cleanItems, cleanActors };
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vh-tweaks-'));
test.after(() => { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { } });

const OLD = { v: 1, shots: { s1: { camera: { fov: 40 } } }, cuts: [{ at: 3, d: 0.1 }], sound: [{ shot: '*', t0: 0, t1: 60, music: 0.5 }],
  items2d: [{ id: 'i1', kind: 'rect', t0: 0, t1: 2, x: 1, y: 1, w: 10, h: 10 }], audio: { clips: [{ id: 'c1', src: 'vhaudio/a.wav', t: 1, lane: 2 }] }, custom: { keep: true } };

test('PATCH merge: keeps v / shots and every key it was not given (unknown keys too)', () => {
  const out = mergeTweaks(OLD, { audio: { clips: [{ id: 'c1', src: 'vhaudio/a.wav', t: 4, lane: 1 }] } }, C);
  assert.equal(out.v, 1);
  assert.deepEqual(out.shots, OLD.shots);
  assert.deepEqual(out.cuts, OLD.cuts);
  assert.deepEqual(out.sound, OLD.sound);
  assert.equal(out.items2d.length, 1);
  assert.deepEqual(out.custom, { keep: true });
  assert.equal(out.audio.clips[0].t, 4);
  // no shots anywhere: still written as {} (the engine's loadTweaks drops a file without shots)
  assert.deepEqual(mergeTweaks({}, { cuts: [] }, C).shots, {});
  // shots given replace; empty 2D lists are deleted as in PUT
  const o2 = mergeTweaks(OLD, { shots: {}, items2d: [] }, C);
  assert.deepEqual(o2.shots, {}); assert.ok(!('items2d' in o2));
});

test('cleanAudio keeps an integer lane 0–7 only', () => {
  const a = cleanAudio({ clips: [{ src: 'vhaudio/a.wav', t: 0, lane: 3 }, { src: 'vhaudio/b.wav', t: 0, lane: 9 }, { src: 'vhaudio/c.wav', t: 0, lane: '2' }, { src: 'vhaudio/d.wav', t: 0, lane: 1.5 }, { src: 'vhaudio/e.wav', t: 0 }] });
  assert.deepEqual(a.clips.map((c) => c.lane), [3, undefined, undefined, undefined, undefined]);
  assert.equal(mergeTweaks(OLD, {}, C).audio.clips[0].lane, 2);   // an untouched audio key keeps its lanes
});

test('soundOps: field-level merge, null removes a field, an entry with no level left is dropped, sorted by t0', () => {
  const list = [{ shot: '*', t0: 0, t1: 60, music: 0.5, sfx: 0.8 }, { shot: 'b', t0: 10, t1: 20, vo: 1.5 }];
  let L = applySoundOps(list, { set: [{ shot: '*', music: null, vo: 0.9 }] });
  assert.deepEqual(L.find((e) => e.shot === '*'), { shot: '*', t0: 0, t1: 60, sfx: 0.8, vo: 0.9 });
  L = applySoundOps(list, { set: [{ shot: 'b', vo: null }] });
  assert.deepEqual(L.map((e) => e.shot), ['*']);
  L = applySoundOps(list, { set: [{ shot: 'b', vo: 1 }] });   // back to 100 % = no setting
  assert.deepEqual(L.map((e) => e.shot), ['*']);
  L = applySoundOps(list, { remove: ['*'], set: [{ shot: 'range 2.00–4.00', t0: 2, t1: 4, music: 0 }] });
  assert.deepEqual(L.map((e) => e.shot), ['range 2.00–4.00', 'b']);
  // a new entry without t0/t1 is invalid and dropped; unknown shots in remove do nothing
  assert.equal(applySoundOps(list, { set: [{ shot: 'x', music: 0.2 }], remove: ['nope'] }).length, 2);
  // mergeTweaks: soundOps applies to the current sound and keeps every other key
  const out = mergeTweaks(OLD, { soundOps: { set: [{ shot: 'duck:abc123', t0: 5, t1: 9, music: 0.3, fade: 0.5 }] } }, C);
  assert.deepEqual(out.sound.map((e) => e.shot), ['*', 'duck:abc123']);
  assert.equal(out.sound[0].music, 0.5);
  assert.deepEqual(out.audio, OLD.audio);   // untouched keys are never re-cleaned
});

test('cleanSound: clamps levels, keeps fade clamped to 0.02–5; cleanCuts as before', () => {
  const s = cleanSound([{ shot: 'a', t0: 0, t1: 1, music: 9, fade: 0 }, { shot: 'b', t0: 0, t1: 1, sfx: -1, fade: 9 }, { shot: 'c', t0: 0, t1: 1, vo: 0.5, fade: 'x' }, { shot: 'd', t0: 2, t1: 1, vo: 0.5 }, null]);
  assert.deepEqual(s, [{ shot: 'a', t0: 0, t1: 1, music: 4, fade: 0.02 }, { shot: 'b', t0: 0, t1: 1, sfx: 0, fade: 5 }, { shot: 'c', t0: 0, t1: 1, vo: 0.5 }]);
  assert.deepEqual(cleanCuts([{ at: 2, d: 0.1 }, { at: 3, d: 0 }, { at: 4, tr: { type: 'mix', dur: 9 } }, { at: 5, tr: { type: 'nope' } }]), [{ at: 2, d: 0.1 }, { at: 4, d: 0, tr: { type: 'mix', dur: 5 } }]);
  assert.deepEqual(cleanCuts(undefined), []);
});

test('PUT-style body (shots + cuts + sound always) matches the old route', () => {
  const b = { shots: { s: {} }, cuts: undefined, sound: undefined, items2d: OLD.items2d };
  const out = mergeTweaks(OLD, b, C);
  assert.deepEqual(out.cuts, []); assert.deepEqual(out.sound, []); assert.deepEqual(out.shots, { s: {} });
  assert.deepEqual(out.audio, OLD.audio);
});

test('readTweaksStrict: missing / empty file = {}, broken file throws 409; writeTweaks writes whole files', () => {
  const f = path.join(tmp, 'tweaks.json');
  assert.deepEqual(readTweaksStrict(f), {});
  fs.writeFileSync(f, '');
  assert.deepEqual(readTweaksStrict(f), {});
  fs.writeFileSync(f, '{"v":1,"shots":{');
  assert.throws(() => readTweaksStrict(f), (e) => e.code === 409 && /Could not read/.test(e.message));
  writeTweaks(f, { v: 1, shots: {}, sound: [] });
  assert.deepEqual(readTweaksStrict(f), { v: 1, shots: {}, sound: [] });
  fs.writeFileSync(f, '﻿{"v":1,"shots":{"a":1}}');
  assert.deepEqual(readTweaksStrict(f).shots, { a: 1 });
  assert.deepEqual(fs.readdirSync(tmp).filter((x) => x.endsWith('.tmp')), []);
});
