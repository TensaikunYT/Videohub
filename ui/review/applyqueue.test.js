import test from 'node:test';
import assert from 'node:assert/strict';
import { createApplyQueue } from './applyqueue.js';

// fake timers + an apply() we resolve by hand
function rig(mode) {
  const T = new Map(); let id = 0;
  const timers = { set: (f, ms) => { T.set(++id, f); return id; }, clear: t => T.delete(t) };
  const fire = () => { const fs = [...T.values()]; T.clear(); fs.forEach(f => f()); };
  const calls = [], built = [];
  const apply = () => new Promise(res => calls.push(res));
  const Q = createApplyQueue({ apply, mode: () => mode, timers, onBuilt: r => built.push(r) });
  const tick = () => new Promise(r => setTimeout(r, 0));
  return { Q, fire, calls, built, tick, pending: () => T.size };
}

test('stems: requests debounce into one build; changes during a build give exactly one more build', async () => {
  const { Q, fire, calls, built, tick, pending } = rig('stems');
  Q.request('clips'); Q.request('clips'); Q.request('levels');
  assert.equal(pending(), 1); assert.equal(Q.dirty(), true);
  fire(); await tick();
  assert.equal(calls.length, 1); assert.equal(Q.busy(), true); assert.equal(Q.dirty(), false);
  Q.request('clips'); fire(); Q.request('clips'); fire();   // two changes while it builds
  await tick(); assert.equal(calls.length, 1);
  calls[0]('a'); await tick(); await tick(); await tick();
  assert.equal(calls.length, 2);   // one rerun, not two
  calls[1]('b'); await tick(); await tick();
  assert.deepEqual(built, ['a', 'b']); assert.equal(Q.busy(), false); assert.equal(Q.dirty(), false);
});

test('studio: request only marks dirty; applyNow builds once', async () => {
  const { Q, fire, calls, tick, pending } = rig('studio');
  Q.request('clips'); Q.request('levels');
  assert.equal(pending(), 0); fire(); await tick();
  assert.equal(calls.length, 0); assert.equal(Q.dirty(), true);
  const p = Q.applyNow(); await tick();
  assert.equal(calls.length, 1); assert.equal(Q.dirty(), false);
  Q.request('clips'); assert.equal(Q.dirty(), true);
  calls[0]({ ms: 5 }); assert.deepEqual(await p, { ms: 5 });
  await tick(); assert.equal(calls.length, 1);   // no automatic rerun in studio: 💾 again
});

test('applyNow while a build runs waits for the one after it; none mode builds nothing', async () => {
  const { Q, calls, tick } = rig('all');
  const p1 = Q.applyNow(); await tick();
  const p2 = Q.applyNow(), p3 = Q.applyNow(); assert.equal(p2, p3);
  calls[0](1); assert.equal(await p1, 1);
  await tick(); await tick(); assert.equal(calls.length, 2);
  calls[1](2); assert.equal(await p2, 2);
  const n = rig('none'); n.Q.request('x'); assert.equal(n.Q.dirty(), false);
  await assert.rejects(n.Q.applyNow());
});
