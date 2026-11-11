import test from 'node:test';
import assert from 'node:assert/strict';
import { createHistory } from './history.js';

function make() {
  const st = { v: [1] }; let pushes = 0;
  const H = createHistory({ snapshot: () => JSON.stringify(st.v), restore: s => { st.v = JSON.parse(s); }, max: 3, onPush: () => pushes++ });
  return { st, H, pushes: () => pushes };
}

test('push / undo / redo round trip; a new push clears redo', () => {
  const { st, H, pushes } = make();
  H.push(); st.v = [1, 2];
  H.push(); st.v = [1, 2, 3];
  assert.equal(pushes(), 2);
  assert.ok(H.undo()); assert.deepEqual(st.v, [1, 2]);
  assert.ok(H.undo()); assert.deepEqual(st.v, [1]);
  assert.equal(H.undo(), false);
  assert.ok(H.redo()); assert.deepEqual(st.v, [1, 2]);
  H.push(); st.v = [9];
  assert.equal(H.canRedo(), false);
  assert.ok(H.undo()); assert.deepEqual(st.v, [1, 2]);
});

test('arm + touch: a drag pushes the state before it once, a drag that changed nothing pushes nothing', () => {
  const { st, H, pushes } = make();
  H.arm(); st.v = [2]; H.touch(); st.v = [3]; H.touch();
  assert.equal(pushes(), 1);
  H.arm();   // pressed, never moved
  assert.equal(pushes(), 1);
  assert.ok(H.undo()); assert.deepEqual(st.v, [1]);
});

test('steps equal to the current state are skipped; max keeps the newest', () => {
  const { st, H } = make();
  H.push(); H.push();   // nothing changed between: one step
  st.v = [5]; H.push(); st.v = [6]; H.push(); st.v = [7]; H.push(); st.v = [8];
  assert.ok(H.undo()); assert.deepEqual(st.v, [7]);
  assert.ok(H.undo()); assert.deepEqual(st.v, [6]);
  assert.ok(H.undo()); assert.deepEqual(st.v, [5]);
  assert.equal(H.undo(), false);   // [1] fell off (max 3)
  const h2 = make(); h2.H.push();   // pushed, then the change did nothing
  assert.equal(h2.H.undo(), false); assert.deepEqual(h2.st.v, [1]);
});
