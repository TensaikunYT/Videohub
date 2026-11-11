import test from 'node:test';
import assert from 'node:assert/strict';
import { createView } from './tlview.js';

const near = (a, b) => Math.abs(a - b) < 1e-9;
const store = new Map();
globalThis.localStorage = { getItem: k => store.has(k) ? store.get(k) : null, setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k) };

test('view: whole film until zoomed; span clamped to [2, dur]; zoomBy keeps the anchor under the same x', () => {
  const V = createView({ dur: () => 100 });
  assert.deepEqual(V.get(), [0, 100]); assert.equal(V.isZoomed(), false); assert.equal(V.label(), 'whole film');
  V.zoomBy(0.5, 40);   // 40 s sits at 40 % of the view before and after
  const [a, b] = V.get(); assert.ok(near(b - a, 50)); assert.ok(near((40 - a) / (b - a), 0.4));
  V.zoomTo(0.1, 40); assert.ok(near(V.span(), 2));
  V.zoomBy(1000, 40); assert.equal(V.isZoomed(), false);
  V.zoomTo(10, 99); const [c, d] = V.get(); assert.ok(d <= 100 + 1e-9 && near(d - c, 10));
  V.fit(); assert.equal(V.isZoomed(), false);
});

test('view: zoomToRange pads 5 %, panBy stays inside, label text', () => {
  const V = createView({ dur: () => 100 });
  V.zoomToRange(10, 20); const [a, b] = V.get(); assert.ok(near(a, 9.5) && near(b, 20.5));
  V.panBy(-50); assert.ok(near(V.get()[0], 0)); V.panBy(500); assert.ok(near(V.get()[1], 100));
  V.zoomToRange(12, 20, 0); assert.equal(V.label(), 'visible: 0:12–0:20 (8.0 s)');
  let n = 0; const off = V.onChange(() => n++); V.panBy(1); V.panBy(0); off(); V.panBy(1); assert.equal(n, 1);
});

test('view follow: page jump only when on, zoomed and playing; setting survives (localStorage)', () => {
  store.clear();
  const V = createView({ dur: () => 100 });
  assert.equal(V.followOn(), true);
  assert.equal(V.follow(50), false);                          // not zoomed
  V.zoomToRange(10, 20, 0);
  assert.equal(V.follow(15), false);                          // inside
  assert.equal(V.follow(19.8, false), false);                 // paused
  assert.equal(V.follow(19.8), true);                         // near the right edge: a = t − 0.15·span
  assert.ok(near(V.get()[0], 19.8 - 1.5) && near(V.span(), 10));
  assert.equal(V.follow(5), true); assert.ok(near(V.get()[0], 3.5));
  V.follow(99.9); assert.ok(near(V.get()[1], 100));           // clamped at the end
  V.setFollow(false); assert.equal(V.follow(0), false);
  assert.equal(createView({ dur: () => 100 }).followOn(), false);
  V.setFollow(true); assert.equal(createView({ dur: () => 100 }).followOn(), true);
});
