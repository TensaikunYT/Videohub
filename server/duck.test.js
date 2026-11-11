// Ducking the film's music (P4): "duck:" sound entries multiply, old entries keep their additive math and keys.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { soundEnv, soundKey } from './vhsound.mjs';

const old = [{ shot: '*', t0: 0, t1: 100, music: 0.5 }, { shot: 'range 10.00–20.00', t0: 10, t1: 20, music: 0.8, vo: 1.2 }];

test('old entries: same curve and same key as before', () => {
  const sm = (a, b, t) => { const u = Math.min(1, Math.max(0, (t - a) / (b - a))); return u * u * (3 - 2 * u); };
  const before = (E, k) => (t) => { let g = 1; for (const e of E) g += sm(e.t0 - 0.12, e.t0 + 0.12, t) * (1 - sm(e.t1 - 0.12, e.t1 + 0.12, t)) * (e[k] - 1); return Math.max(0, g); };
  const f = soundEnv(old, 'music'), g = before(old, 'music');
  for (const t of [0, 5, 9.9, 10, 10.05, 15, 20, 30]) assert.ok(Math.abs(f(t) - g(t)) < 1e-12, 't=' + t);
  assert.equal(soundKey(old), JSON.stringify([['*', 0, 100, 0.5, 1, 1, 1], ['range 10.00–20.00', 10, 20, 0.8, 1, 1.2, 1]]));
});

test('a duck multiplies instead of adding (never silent unless 0)', () => {
  const f = soundEnv([...old.slice(0, 1), { shot: 'duck:abc123', t0: 10, t1: 20, music: 0.3, fade: 0.5 }], 'music');
  assert.ok(Math.abs(f(15) - 0.15) < 1e-9);
  assert.ok(Math.abs(f(5) - 0.5) < 1e-9);
  assert.ok(f(10) > 0.15 && f(10) < 0.5);   // inside the 0.5 s fade
  const z = soundEnv([{ shot: 'duck:x', t0: 10, t1: 20, music: 0 }], 'music');
  assert.equal(z(15), 0);
  assert.equal(z(25), 1);
  assert.match(soundKey([{ shot: 'duck:x', t0: 1, t1: 2, music: 0, fade: 0.5 }]), /,0\.5\]\]$/);
});
