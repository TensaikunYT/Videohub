import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRows, assignLane, laneCount, tickSpec, fmtTick, findDragSnap, snapEdgeTime, edgeScrollStep, clipLen } from './tracks.js';

const near = (a, b) => Math.abs(a - b) < 1e-9;

test('buildRows: order, heights, collapse, placeholders and clip lanes', () => {
  const layers = [{ id: 'vo', label: 'Voice' }, { id: 'music', label: 'Music' }, { id: 'st_x', label: 'x' }];
  const R = buildRows({ live: false, strip: {}, scenes: [{ t0: 0, t1: 2 }], transcript: { ok: true }, layers, cues: [{ t: 1 }], clips: [{ kind: 'sfx', lane: 1, t: 0 }], canClips: true, collapsed: new Set(['notes']) });
  assert.deepEqual(R.map(r => r.id), ['pic', 'mix', 'scenes', 'notes', 'text', 'vo', 'music', 'st_x', 'cues', 'add-music', 'add-sfx']);
  assert.deepEqual(R.map(r => r.h), [40, 26, 24, 14, 22, 30, 30, 26, 20, 26, 78]);
  assert.equal(R.find(r => r.id === 'add-sfx').lanes, 3);
  assert.equal(R.find(r => r.id === 'st_x').header.level, false);
  let y = 0; for (const r of R) { assert.equal(r.y, y); y += r.h; }
  // live: no picture row; no transcript/scenes/clips → only the always-on rows; sfx stem carries the cues
  const L = buildRows({ live: true, strip: {}, scenes: [], transcript: null, layers: [{ id: 'sfx', label: 'Effects' }], cues: [{ t: 1 }], clips: null, canClips: false });
  assert.deepEqual(L.map(r => r.id), ['mix', 'notes', 'sfx']);
  assert.equal(L[2].cues, true);
});

test('lanes: assignLane picks the first free lane of the kind; laneCount = max + 2', () => {
  const clips = [{ id: 'a', kind: 'sfx', t: 0, dur: 2, lane: 0 }, { id: 'b', kind: 'sfx', t: 1, dur: 2, lane: 1 }, { id: 'm', kind: 'music', t: 0, dur: 9, lane: 0 }];
  assert.equal(assignLane(clips, { id: 'n', kind: 'sfx', t: 1.5, dur: 1 }), 2);
  assert.equal(assignLane(clips, { id: 'n', kind: 'sfx', t: 2.5, dur: 1 }), 0);   // a ends at 2
  assert.equal(assignLane(clips, { id: 'n', kind: 'music', t: 20, dur: 1 }), 0);
  assert.equal(assignLane([{ id: 'l', kind: 'sfx', t: 0, dur: 1, loop: true, lane: 0 }], { id: 'n', kind: 'sfx', t: 50, dur: 1 }), 1);   // a loop runs to the end
  assert.equal(laneCount(clips, 'sfx'), 3); assert.equal(laneCount(clips, 'music'), 2); assert.equal(laneCount([], 'music'), 1);
  assert.equal(laneCount([{ kind: 'sfx', lane: 7 }], 'sfx'), 8);
  assert.equal(laneCount([{ kind: 'sfx' }], 'sfx'), 1);   // no lane yet
  assert.ok(near(clipLen({ t: 0, dur: 3, trim: 1 }), 2)); assert.ok(near(clipLen({ t: 4, loop: true }, 10), 6)); assert.ok(near(clipLen({ t: 0, len: 0 }), 0.05));
});

test('tickSpec / fmtTick', () => {
  let s = tickSpec(300, 1000 / 300, 30); assert.equal(s.major, 30); assert.ok(near(s.minor, 6)); assert.equal(s.frames, false);
  s = tickSpec(300, 1000 / 2, 30); assert.ok(near(s.major, 5 / 30)); assert.ok(near(s.minor, 1 / 30)); assert.equal(s.frames, true);
  s = tickSpec(300, 100, 30); assert.equal(s.major, 1); assert.equal(s.minor, 0.5);
  s = tickSpec(36, 170, 30); assert.equal(s.major, 0.5); assert.ok(near(s.minor, 0.1));    // 0.5 s = 15 frames
  s = tickSpec(36, 170, 60); assert.equal(s.major, 0.5); assert.ok(near(s.minor, 0.1));    // 30 frames
  s = tickSpec(36, 170, 24); assert.equal(s.major, 0.5); assert.ok(near(s.minor, 0.25));   // 12 frames
  s = tickSpec(300, 0.01, 30); assert.equal(s.major, 1200);
  s = tickSpec(300, 2000 * 30, 30); assert.ok(near(s.major, 1 / 30)); assert.ok(near(s.minor, 1 / 30));   // never half a frame
  assert.equal(fmtTick(83.5, 30, true), '1:23:15');
  assert.equal(fmtTick(59.999, 30, true), '1:00:00');
  assert.equal(fmtTick(83, 30, false), '1:23');
  assert.equal(fmtTick(3725, 30, false), '1:02:05');
});

test('snapping and edge scroll', () => {
  assert.deepEqual(findDragSnap([10, 20], 9.95, 3, 100), { t: 10, guide: 10, edge: 'start' });
  assert.deepEqual(findDragSnap([13], 9.97, 3, 100), { t: 10, guide: 13, edge: 'end' });
  assert.equal(findDragSnap([10], 9, 0.5, 100), null);
  assert.equal(snapEdgeTime(5.05, [5, 6], 100), 5);
  assert.equal(snapEdgeTime(5.5, [5, 6], 100), 5.5);
  assert.equal(edgeScrollStep(0, 1000, 10, false), 0);
  assert.equal(edgeScrollStep(0, 1000, 500, true), 0);
  assert.ok(near(edgeScrollStep(0, 1000, 20, true), -18 * 0.25));
  assert.ok(near(edgeScrollStep(0, 1000, 1000, true), 18));
});
