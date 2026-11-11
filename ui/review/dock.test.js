import test from 'node:test';
import assert from 'node:assert/strict';
import { ls, clampPx, hideOrder } from './dock.js';

test('ls: JSON round trip, default on missing / broken / throwing storage', () => {
  const store = new Map();
  globalThis.localStorage = { getItem: k => store.has(k) ? store.get(k) : null, setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k) };
  ls.set('a', 262); assert.equal(ls.get('a', 0), 262);
  ls.set('b', 'notes'); assert.equal(ls.get('b', null), 'notes');
  assert.equal(ls.get('none', 7), 7);
  store.set('bad', '{'); assert.equal(ls.get('bad', 5), 5);
  ls.set('a', null); assert.equal(ls.get('a', 1), 1);
  globalThis.localStorage = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); }, removeItem() { throw new Error('blocked'); } };
  assert.equal(ls.get('a', 3), 3); assert.doesNotThrow(() => ls.set('a', 1));
  delete globalThis.localStorage;
  assert.equal(ls.get('a', 4), 4);
});

test('clampPx: min wins over a too small max, rounds', () => {
  assert.equal(clampPx(500, 120, 300), 300);
  assert.equal(clampPx(50, 120, 300), 120);
  assert.equal(clampPx(200, 120, 80), 120);
  assert.equal(clampPx(200.6, 120, Infinity), 201);
});

test('hideOrder: lowest priority first, ties rightmost first, 9 and no data-pri never', () => {
  const items = [{ pri: 9, idx: 0 }, { pri: 2, idx: 1 }, { pri: NaN, idx: 2 }, { pri: 2, idx: 3 }, { pri: 1, idx: 4 }, { pri: 6, idx: 5 }];
  assert.deepEqual(hideOrder(items), [4, 3, 1, 5]);
});
