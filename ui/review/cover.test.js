import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const code = fs.readFileSync(new URL('./cover.js', import.meta.url), 'utf8').replace('export function', 'function');
function harness() {
  let isVisible = true, copies = 0, fail = false, sequence = 0;
  const pending = new Map(), saves = [];
  const source = { info: { revision: 'v1' }, displayedTime: 2, duration: 120, seeking: false,
    snapDisplayed(width) { copies++; assert.equal(width, 480); return { toDataURL: () => 'data:image/jpeg;base64,picture' }; } };
  const ctx = { setTimeout: fn => { const id = ++sequence; pending.set(id, fn); return id; }, clearTimeout: id => pending.delete(id) };
  vm.createContext(ctx); vm.runInContext(code, ctx);
  const cover = ctx.createLiveCover({ source, visible: () => isVisible, save: async data => { saves.push(data); if (fail) throw new Error('offline'); } });
  return { source, cover, pending, saves, get copies() { return copies; }, hide() { isVisible = false; }, fail() { fail = true; },
    async flush() { const work = [...pending.values()]; pending.clear(); for (const fn of work) await fn(); } };
}

test('a visible player supplies one small cached cover per revision without a background player', async () => {
  const h = harness(); for (let i = 0; i < 120; i++) h.cover.update();
  assert.equal(h.copies, 1); assert.equal(h.saves.length, 0);
  await h.flush(); assert.equal(h.saves.length, 1); assert.equal(h.saves[0].revision, 'v1');
  h.source.info.revision = 'v2'; h.cover.update(); await h.flush();
  assert.equal(h.copies, 2); assert.equal(h.saves[1].revision, 'v2');
});

test('hidden, seeking and opening-fade frames do no cover work', () => {
  for (const condition of ['hidden', 'seeking', 'fade']) {
    const h = harness();
    if (condition === 'hidden') h.hide();
    if (condition === 'seeking') h.source.seeking = true;
    if (condition === 'fade') h.source.displayedTime = 0;
    h.cover.update(); assert.equal(h.copies, 0); assert.equal(h.pending.size, 0);
  }
});

test('navigation, hidden tabs and changed code cancel a pending cover', async () => {
  for (const condition of ['destroy', 'hidden', 'revision']) {
    const h = harness(); h.cover.update();
    const late = [...h.pending.values()][0];
    if (condition === 'destroy') h.cover.destroy();
    if (condition === 'hidden') h.hide();
    if (condition === 'revision') h.source.info.revision = 'v2';
    await late(); assert.equal(h.saves.length, 0);
  }
});

test('a failed save cannot cause a per-frame cover retry loop', async () => {
  const h = harness(); h.fail(); h.cover.update(); await h.flush();
  for (let i = 0; i < 120; i++) h.cover.update();
  assert.equal(h.copies, 1); assert.equal(h.saves.length, 1); assert.equal(h.pending.size, 0);
});
