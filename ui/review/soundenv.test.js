import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { soundEnv, applyOps, opsToward, clipPlan } from './soundenv.js';

const near = (a, b, e = 1e-6) => Math.abs(a - b) < e;
const fnText = (file, name) => {
  const s = fs.readFileSync(new URL(file, import.meta.url), 'utf8').replace(/\r\n/g, '\n'), i = s.indexOf('export function ' + name + '(');
  assert.ok(i >= 0, name + ' in ' + file);
  const j = s.indexOf('\n}\n', i); return s.slice(i, j + 2);
};

test('soundEnv is the same source as server/vhsound.mjs', () => {
  assert.equal(fnText('./soundenv.js', 'soundEnv'), fnText('../../server/vhsound.mjs', 'soundEnv'));
});

test('soundEnv: levels add up, ramps, nothing to do → null', () => {
  assert.equal(soundEnv([], 'music'), null);
  assert.equal(soundEnv([{ shot: '*', t0: 0, t1: 10, music: 1 }], 'music'), null);
  const f = soundEnv([{ shot: '*', t0: 0, t1: 100, music: 0.5 }, { shot: 'range 10.00–20.00', t0: 10, t1: 20, music: 0.5 }], 'music');
  assert.ok(near(f(5), 0.5)); assert.ok(near(f(15), 0)); assert.ok(near(f(50), 0.5));
  const g = soundEnv([{ shot: 'a', t0: 10, t1: 20, vo: 2 }], 'vo');
  assert.ok(near(g(10), 1.5)); assert.ok(near(g(9), 1)); assert.ok(near(g(15), 2));
});

test('applyOps: field merge, null removes, no level left → dropped, sorted', () => {
  let L = applyOps([], { set: [{ shot: '*', t0: 0, t1: 30, music: 0.5 }] });
  assert.deepEqual(L, [{ shot: '*', t0: 0, t1: 30, music: 0.5 }]);
  L = applyOps(L, { set: [{ shot: '*', vo: 1.5 }, { shot: 'b', t0: -1, t1: 2, sfx: 9 }] });
  assert.deepEqual(L.map((e) => e.shot), ['b', '*']);
  assert.equal(L[0].sfx, 4); assert.equal(L[1].vo, 1.5); assert.equal(L[1].music, 0.5);
  L = applyOps(L, { set: [{ shot: '*', music: null, vo: null }], remove: ['b'] });
  assert.deepEqual(L, []);
});

test('opsToward: only owned shots, only fields that differ', () => {
  const owned = (s) => s === '*' || s.startsWith('range ');
  const cur = [{ shot: '*', t0: 0, t1: 9, music: 0.5, vo: 2 }, { shot: 'sh1', t0: 1, t1: 2, sfx: 0 }];
  const snap = [{ shot: '*', t0: 0, t1: 9, vo: 2 }, { shot: 'range 1.00–2.00', t0: 1, t1: 2, all: 0.3 }];
  const o = opsToward(cur, snap, owned);
  assert.deepEqual(o.set.find((e) => e.shot === '*'), { shot: '*', t0: 0, t1: 9, music: null });
  assert.deepEqual(o.set.find((e) => e.shot.startsWith('range')), { shot: 'range 1.00–2.00', t0: 1, t1: 2, all: 0.3 });
  assert.equal(o.set.length, 2);
  assert.deepEqual(applyOps(cur, o).filter((e) => owned(e.shot)), snap.slice().sort((a, b) => a.t0 - b.t0));
  assert.equal(opsToward(snap, snap, owned), null);
});

test('clipPlan: start delay, offsets, trim, loop, fades, end', () => {
  const c = { t: 10, gain: 0.5, fin: 1, fout: 2, trim: 0.5, len: null, loop: false };
  let P = clipPlan(c, 8, 1, 6.5, 60);   // plays 6 s (file 6.5 − trim 0.5) from 10 s
  assert.ok(near(P.delay, 2)); assert.ok(near(P.offset, 0.5)); assert.ok(near(P.dur, 6));
  assert.deepEqual(P.pts.map(([x, g]) => [+x.toFixed(3), +g.toFixed(3)]), [[0, 0], [1, 0.5], [4, 0.5], [6, 0]]);
  P = clipPlan(c, 12, 2, 6.5, 60);   // 2 s in, double speed: no delay, from 2.5 s of the file
  assert.ok(near(P.delay, 0)); assert.ok(near(P.offset, 2.5)); assert.ok(near(P.dur, 4)); assert.ok(near(P.pts[0][1], 0.5));
  assert.equal(clipPlan(c, 16.5, 1, 6.5, 60), null);   // over
  assert.equal(clipPlan({ ...c, mute: true }, 8, 1, 6.5, 60), null);
  assert.equal(clipPlan({ ...c, gain: 0 }, 8, 1, 6.5, 60), null);
  // loop: to the end of the film, offset wraps inside the file after the trim
  const L = clipPlan({ ...c, loop: true, fin: 0, fout: 0 }, 23, 1, 6.5, 60);
  assert.ok(near(L.dur, 37)); assert.ok(near(L.offset, 0.5 + (13 % 6))); assert.equal(L.loop, true); assert.ok(near(L.loopStart, 0.5));
  // a len longer than the file stops at the file's end (fade-out never reached, as in mixClips)
  const N = clipPlan({ ...c, len: 20, fin: 0, fout: 0 }, 10, 1, 6.5, 60);
  assert.ok(near(N.dur, 6));
});
