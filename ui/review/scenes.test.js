import test from 'node:test';
import assert from 'node:assert/strict';
import { scenesFromPage, mapPieces, sample, tidy } from './scenes.js';

test('VH_SCENES wins, as array or function', () => {
  const a = scenesFromPage({ VH_SCENES: [{ name: 'a', t0: 0, t1: 2 }], SHOTS: [{ id: 'x', t0: 0, t1: 9 }] }, 10);
  assert.equal(a.source, 'VH_SCENES'); assert.deepEqual(a.scenes.map(s => s.name), ['a']);
  const b = scenesFromPage({ VH_SCENES: () => [{ id: 'f', t0: 1, t1: 3 }] }, 10);
  assert.equal(b.scenes[0].name, 'f');
});

test('SHOTS: missing t1 takes the next start, last one the film end', () => {
  const r = scenesFromPage({ SHOTS: [{ id: 's1', t0: 0 }, { id: 's2', t0: 4 }] }, 9);
  assert.deepEqual(r.scenes.map(s => [s.name, s.t0, s.t1]), [['s1', 0, 4], ['s2', 4, 9]]);
});

test('hd2d pieces map old shot times to film time, black pieces skipped', () => {
  const shots = [{ id: 'A', t0: 0, t1: 5 }, { id: 'B', t0: 5, t1: 10 }];
  const P = [{ a: 3, d: 4, s: 0 }, { black: true, d: 1, s: 4 }, { a: 0, d: 2, s: 5 }];
  assert.deepEqual(mapPieces(shots, P).map(s => [s.name, s.t0, s.t1]), [['A', 0, 2], ['B', 2, 4], ['A', 5, 7]]);
});

test('sampled shot names become runs; same-name neighbours join', () => {
  const r = sample(t => (t < 1 ? 'one' : t < 2.5 ? 'two' : 'one'), 4);
  assert.deepEqual(r.map(s => s.name), ['one', 'two', 'one']);
  assert.ok(Math.abs(r[1].t0 - 1) < 0.06 && Math.abs(r[1].t1 - 2.5) < 0.06);
  assert.deepEqual(tidy([{ name: 'a', t0: 0, t1: 1 }, { name: 'a', t0: 1, t1: 2 }, { name: 'b', t0: 2, t1: 2.01 }], 5).map(s => [s.name, s.t1]), [['a', 2]]);
});

test('nothing exposed: empty', () => {
  assert.deepEqual(scenesFromPage({}, 10), { scenes: [], source: null });
  assert.deepEqual(scenesFromPage(null, 10), { scenes: [], source: null });
});

test('a null end means the film end (film2d VH_SCENES)', () => {
  const r = scenesFromPage({ VH_SCENES: () => [{ name: 'a', t0: 0, t1: 3 }, { name: 'b', t0: 3, t1: null }] }, 8);
  assert.deepEqual(r.scenes.map(s => [s.name, s.t0, s.t1]), [['a', 0, 3], ['b', 3, 8]]);
});
