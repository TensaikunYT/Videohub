import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('./guard.js', import.meta.url), 'utf8')
  .replace(/^import .+;\r?$/gm, '').replace(/\bexport /g, '');
const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
function harness({ priority } = {}) {
  const calls = [], files = new Map(), timers = [];
  const ctx = {
    fs: { readFileSync: file => files.get(file) || '', mkdirSync() {}, writeFileSync: (file, text) => files.set(file, text) },
    os: { cpus: () => Array(8), freemem: () => 8 * 2 ** 30, totalmem: () => 16 * 2 ** 30 }, path,
    dirs: { guard: path.resolve('.test-tmp', 'guard-fixture') }, capabilities: () => ({ cpuAffinity: true }), availableMemory: () => 8 * 2 ** 30,
    config: () => ({ roots: [] }), readJson: () => null, processAlive: () => true,
    getAutostart: async () => true, setAutostart: async on => calls.push(['startup', on]), cleanupLegacyAutostart: async () => calls.push(['legacy']),
    setTreePriority: async (...args) => { calls.push(['priority', ...args]); return priority?.(...args); }, killTree: async pid => calls.push(['kill', pid]),
    setInterval: fn => { timers.push(fn); return { unref() {} }; }, clearInterval() {},
  };
  vm.createContext(ctx); vm.runInContext(source + '\nglobalThis.guard = {guardSettings,saveGuardSettings,guardTrack,guardUntrack,ensureGuard,quitGuard,guardState,guardCommand};', ctx);
  return { ...ctx.guard, calls, timers, files };
}

test('guard delegates autostart and retains legacy cleanup on every settings save', async () => {
  const h = harness(); assert.equal((await h.guardSettings()).Startup, true);
  assert.equal((await h.guardSettings()).capabilities.cpuAffinity, true);
  await h.saveGuardSettings({ CapActive: 50 }); assert.deepEqual(h.calls, [['legacy']]);
  await h.saveGuardSettings({ Startup: false }); assert.deepEqual(h.calls.at(-2), ['startup', false]);
  assert.deepEqual(h.calls.at(-1), ['legacy']); assert.equal((await h.guardSettings()).CapActive, 50);
});

test('guard applies render priority and restores every core when protection ends', async () => {
  const h = harness(); h.guardTrack(42); await h.ensureGuard();
  await flush();
  assert.deepEqual(h.calls.at(-1), ['priority', 42, 'low', 7]);
  h.guardCommand('slow', 42); await flush(); assert.deepEqual(h.calls.at(-1), ['priority', 42, 'idle', 1]);
  h.guardCommand('kill', 42); assert.deepEqual(h.calls.at(-1), ['kill', 42]);
  await h.quitGuard(); assert.deepEqual(h.calls.at(-1), ['priority', 42, 'normal', 8]);
  assert.equal(h.guardState().running, false);
  assert.equal(h.guardState().capabilities.cpuAffinity, true);
});

test('guard serializes native changes so a late slowdown cannot undo a requested return to normal', async () => {
  const work = [], h = harness({ priority: (...args) => new Promise(resolve => work.push({ args, resolve })) });
  h.guardTrack(42); await h.ensureGuard(); work[0].resolve(); await flush();
  h.guardCommand('slow', 42); await flush(); assert.deepEqual(work[1].args, [42, 'idle', 1]);
  h.guardCommand('normal', 42); await flush(); assert.equal(work.length, 2);
  work[1].resolve(); await flush(); assert.deepEqual(work[2].args, [42, 'low', 7]);
  work[2].resolve(); await flush();
  assert.deepEqual(h.calls.at(-1), ['priority', 42, 'low', 7]);
});

test('guard retries a failed protection change on the next tick without polling unchanged native state', async () => {
  let attempts = 0;
  const h = harness({ priority: async () => { if (++attempts === 1) throw new Error('temporary process query failure'); } });
  h.guardTrack(42); await h.ensureGuard(); await flush(); assert.equal(attempts, 1);
  h.timers[0](); await flush(); assert.equal(attempts, 2);
  h.timers[0](); await flush(); assert.equal(attempts, 2);
});

test('a closed child retires its guard record and a stale close cannot remove a newer render with the same PID', async () => {
  const h = harness(); await h.ensureGuard();
  const first = h.guardTrack(42, { project: 'first' }); await flush();
  const second = h.guardTrack(42, { project: 'second' }); await flush();
  h.guardUntrack(42, first); assert.equal(h.guardState().renders[0].project, 'second');
  h.guardUntrack(42, second); assert.equal(h.guardState().renders.length, 0);
  const calls = h.calls.length; h.guardCommand('kill', 42); h.timers[0](); await flush(); assert.equal(h.calls.length, calls);
});
