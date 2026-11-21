import test from 'node:test';
import assert from 'node:assert/strict';
import { createLeftovers, summarize, SNOOZE_MS } from './leftovers.js';

const RULES = new Set(['silent', 'renderCopy', 'oldChunks', 'leftover', 'staleChunks']);
const MB = 1048576;
const item = (id, rule, size, freed = size, extra = {}) => ({ id, rule, size, freed, action: 'recycle', project: extra.project || 'p1', projectName: extra.project || 'p1', ...extra });

// the prompt with fake candidates, clock, busy state and storage (no hub, no files)
function setup({ cands = [], cfg = {}, busy = null } = {}) {
  const t = { now: 1_000_000, busy, cands, stored: null, changes: [], notified: [], started: [] };
  const lo = createLeftovers({
    candidates: async () => t.cands, rules: RULES, busy: () => t.busy, config: () => ({ autoCleanPrompt: true, autoCleanMinMB: 500, ...cfg }),
    startClean: async (ids, opts) => { t.started.push({ ids, opts }); return { state: 'running', kind: opts.kind }; },
    file: 'x', readJson: () => t.stored, writeJson: (f, d) => { t.stored = JSON.parse(JSON.stringify(d)); },
    now: () => t.now, onChange: st => t.changes.push(st), notify: p => t.notified.push(p.key),
  });
  return { t, lo };
}

test('leftovers: only the five render-leftover rules, counted by the space they really free', () => {
  const s = summarize([item('a', 'silent', 900 * MB), item('b', 'renderCopy', 400 * MB, 0), item('c', 'qa', 5000 * MB), { ...item('d', 'oldVersion', 3000 * MB), action: 'archive' },
    item('e', 'staleChunks', 300 * MB, 300 * MB, { project: 'p2' }), { ...item('f', 'silent', 50 * MB), action: 'archive' }], RULES);
  assert.deepEqual(s.ids, ['a', 'b', 'e']);
  assert.equal(s.freed, 1200 * MB); assert.equal(s.size, 1600 * MB); assert.equal(s.projects, 2);
  assert.equal(s.perRule.renderCopy.freed, 0); assert.equal(s.perRule.silent.count, 1);
});

test('leftovers: no question during a render or a cleanup, below the threshold or when switched off', async () => {
  let { t, lo } = setup({ cands: [item('a', 'silent', 900 * MB)], busy: 'a render is running or queued' });
  let st = await lo.check('render');
  assert.equal(st.prompt, null); assert.equal(st.summary, null, 'it does not even look while a render runs');
  t.busy = null; st = await lo.check('render'); assert.equal(st.prompt.freed, 900 * MB);
  // a render starts: the question stays as it was, nothing new is counted
  t.busy = 'a render is running'; t.cands = []; st = await lo.check('interval'); assert.equal(st.prompt.freed, 900 * MB);

  ({ lo } = setup({ cands: [item('a', 'silent', 600 * MB, 400 * MB)] }));
  st = await lo.check('start'); assert.equal(st.prompt, null, 'frees 400 MB: below the 500 MB threshold'); assert.equal(st.summary.freed, 400 * MB);

  ({ lo } = setup({ cands: [item('a', 'silent', 900 * MB)], cfg: { autoCleanPrompt: false } }));
  st = await lo.check('start'); assert.equal(st.prompt, null); assert.equal(st.summary.freed, 900 * MB, 'the Films page still shows the total');
});

test('leftovers: Later keeps the same set quiet for 24 h; a new or larger set asks again', async () => {
  const { t, lo } = setup({ cands: [item('a', 'silent', 900 * MB), item('b', 'oldChunks', 200 * MB)] });
  let st = await lo.check('start');
  const key = st.prompt.key;
  assert.equal(t.notified.length, 1);
  await assert.rejects(async () => lo.later('other'), /changed/);
  st = lo.later(key); assert.equal(st.prompt, null); assert.equal(t.stored.later.key, key);
  t.now += 3600e3; st = await lo.check('interval'); assert.equal(st.prompt, null, 'same set: quiet');
  t.cands = [item('a', 'silent', 900 * MB)]; st = await lo.check('interval'); assert.equal(st.prompt, null, 'part of the set: quiet');
  t.cands = [item('a', 'silent', 900 * MB), item('b', 'oldChunks', 200 * MB), item('c', 'leftover', 1 * MB)]; st = await lo.check('render');
  assert(st.prompt && st.prompt.key !== key, 'a new item asks again');
  lo.later(st.prompt.key);
  t.cands = [item('a', 'silent', 900 * MB), item('b', 'oldChunks', 900 * MB), item('c', 'leftover', 1 * MB)]; st = await lo.check('render');
  assert(st.prompt, 'the same items freeing 700 MB more ask again');
  lo.later(st.prompt.key);
  t.now += SNOOZE_MS + 1; st = await lo.check('interval'); assert(st.prompt, 'after 24 h it asks again');
  // the snooze survives a restart (stored), and each set notifies once
  const again = createLeftovers({ candidates: async () => t.cands, rules: RULES, busy: () => null, config: () => ({}), startClean: async () => ({}), file: 'x', readJson: () => t.stored, writeJson() { }, now: () => t.now });
  const st2 = await again.check('start'); assert.equal(st2.prompt.key, st.prompt.key);
  assert.equal(new Set(t.notified).size, t.notified.length);
});

test('leftovers: Clean now moves exactly the asked-about items, only of the five rules, through startClean', async () => {
  const { t, lo } = setup({ cands: [item('a', 'silent', 900 * MB), item('b', 'renderCopy', 300 * MB), item('q', 'qa', 4000 * MB), { ...item('o', 'oldVersion', 2000 * MB), action: 'archive' }] });
  let st = await lo.check('start');
  await assert.rejects(lo.clean('wrong'), /changed/);
  t.busy = 'a cleanup is running'; await assert.rejects(lo.clean(st.prompt.key), /Not now/); t.busy = null;
  const run = await lo.clean(st.prompt.key);
  assert.equal(run.kind, 'leftovers');
  assert.deepEqual(t.started[0].ids, ['a', 'b']);
  assert.deepEqual([...t.started[0].opts.rules].sort(), [...RULES].sort());
  assert.equal(t.started[0].opts.via, 'banner');
  assert.equal(lo.state().prompt, null);
});

test('leftovers: after a scan the numbers follow, but only a scheduled look raises a new question', async () => {
  const { t, lo } = setup({ cands: [item('a', 'silent', 900 * MB)] });
  let st = await lo.recheck(); assert.equal(st.prompt, null); assert.equal(st.summary.freed, 900 * MB);
  st = await lo.check('render'); assert(st.prompt);
  t.cands = []; st = await lo.recheck(); assert.equal(st.prompt, null, 'leftovers gone: the question goes'); assert.equal(st.summary.count, 0);
  t.cands = [item('b', 'oldChunks', 700 * MB)]; st = await lo.peek(); assert.equal(st.prompt, null); assert.equal(st.summary.freed, 700 * MB);
});
