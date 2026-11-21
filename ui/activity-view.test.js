import test from 'node:test';
import assert from 'node:assert/strict';
import { actionIcon, groupSessions, filmSession, workingCount, workingFilms, durText, agoText, stepText, stepLabel, elapsedOf, estimateText, doingText, filesText, pillInfo } from './activity-view.js';
import { activeRenders, withRateEta, nowRenders, remainingText } from './render-status.js';

const now = Date.parse('2026-11-21T12:00:00Z'), MIN = 60e3;
const s = (id, state, film, extra = {}) => ({ id, agent: 'claude', agentName: 'Claude Code', title: 'T ' + id, state, film: film ? { id: film, title: film } : null, lastActivityAt: now - MIN, ...extra });
const data = { enabled: true, sessions: [s('a', 'idle', 'f1', { lastActivityAt: now - 5 * MIN }), s('b', 'working', 'f1'), s('c', 'waiting', 'f2'), s('d', 'working', null), s('e', 'idle', 'f2', { lastActivityAt: now })] };

test('sections, counts and the films with a working agent', () => {
  const g = groupSessions(data);
  assert.deepEqual([g.working.map(x => x.id), g.waiting.map(x => x.id), g.finished.map(x => x.id)], [['b', 'd'], ['c'], ['e', 'a']]);
  assert.deepEqual(groupSessions(data, 'f2').finished.map(x => x.id), ['e']);
  assert.equal(workingCount(data), 2);
  assert.deepEqual([...workingFilms(data)], ['f1']);
  assert.equal(workingCount({ enabled: false, sessions: data.sessions }), 0, 'switched off: nothing counts');
  assert.equal(workingCount(null), 0);
});

test('a film pill shows its working session first, then waiting, then the latest finished; none when untouched', () => {
  assert.equal(filmSession(data, 'f1').id, 'b');
  assert.equal(filmSession(data, 'f2').id, 'c');
  assert.equal(filmSession(data, 'nope'), null);
  assert.equal(pillInfo(null), null);
  assert.deepEqual([pillInfo(filmSession(data, 'f1')).label, pillInfo(filmSession(data, 'f1')).cls], ['Working', 'working']);
  assert.equal(pillInfo(s('x', 'idle', 'f')).label, 'Finished');
});

test('times, steps, estimates and the doing-now sentence', () => {
  assert.equal(durText(42), '42 s'); assert.equal(durText(600), '10 min'); assert.equal(durText(3900), '1 h 05 min'); assert.equal(durText(null), '');
  assert.equal(agoText(now - 10e3, now), 'just now'); assert.equal(agoText(now - 5 * MIN, now), '5 min ago');
  assert.equal(stepText({ done: 4, total: 7 }), '4 of 7'); assert.equal(stepText(null), '');
  assert.equal(stepLabel({ done: 1, total: 7, current: 2, inProgress: true }), 'step 2 of 7', 'the step in progress, not the count done');
  assert.equal(stepLabel({ done: 2, total: 10, current: 3, inProgress: false }), '2 of 10 done', 'nothing in progress: how many are done');
  assert.equal(stepLabel({ done: 7, total: 7, current: null, inProgress: false }), '7 of 7 done'); assert.equal(stepLabel(null), '');
  assert.equal(elapsedOf({ state: 'working', turnStartedAt: now - 12 * MIN }, now), 720);
  assert.equal(elapsedOf({ state: 'idle', turnStartedAt: now - 12 * MIN, elapsedSec: 300, endedAt: now - 7 * MIN }, now), 300);
  assert.equal(estimateText({ remainingSec: 1200, at: now - 2 * MIN, estimate: true }, now), 'about 18 min left');
  assert.equal(estimateText({ remainingSec: 90, at: now - MIN, estimate: true }, now), 'almost done');
  assert.equal(estimateText({ remainingSec: 1200, at: now }, now), '', 'only values flagged as an estimate');
  assert.equal(doingText({ state: 'working', step: { text: 'Adding sound' }, lastAction: { text: 'Edited a.js' } }), 'Adding sound');
  assert.equal(doingText({ state: 'working', lastAction: { text: 'Edited a.js' } }), 'Edited a.js');
  assert.equal(doingText({ state: 'working', helpers: 1, helperTasks: ['Build the page'] }), 'A helper agent is working: Build the page');
  assert.equal(doingText({ state: 'waiting', agentName: 'Codex' }), 'Needs your answer in Codex');
  assert.equal(doingText({ state: 'idle', lastAction: { text: 'Queued a render' } }), 'Last: Queued a render');
  assert.deepEqual(['Edited a.js', 'Helper: Ran a command: x', 'Loaded skill y', 'Opened the live preview', 'Queued a render', 'Used something'].map(actionIcon), ['pen', 'code', 'bolt', 'eye', 'renders', 'dot']);
  assert.equal(filesText(1), '1 file changed'); assert.equal(filesText(3), '3 files changed'); assert.equal(filesText(0), '');
});

test('renders: time left from the queue, or from the progress rate when the queue has none', () => {
  const started = new Date(now - 10 * MIN).toISOString();
  const rated = withRateEta({ state: 'running', progress: 0.25, startedAt: started }, now);
  assert.equal(rated.etaSource, 'rate'); assert.equal(rated.etaSec, 30 * 60);
  assert.equal(remainingText(rated, now), '≈ 30 min 0 s');
  assert.equal(withRateEta({ state: 'running', progress: 0.01, startedAt: started }, now).etaSource, null, 'too early to say');
  assert.equal(withRateEta({ state: 'running', progress: 0.5, etaSec: 100, startedAt: started }, now).etaSource, 'queue');
  const rows = nowRenders({ jobs: [{ id: 'j1', state: 'running', project: 'p1', projectName: 'Gears', progress: 0.5, startedAt: started, cmd: 'secret command' }, { id: 'j2', state: 'queued', project: 'p2', projectName: 'Ocean', position: 1 }] }, now);
  assert.deepEqual(rows.map(r => [r.name, r.state, r.etaSource, r.etaSec]), [['Gears', 'running', 'rate', 600], ['Ocean', 'queued', null, null]]);
  assert.ok(!JSON.stringify(rows).includes('secret command'), 'only what the page shows');
  assert.equal(activeRenders({ jobs: [{ id: 'j', state: 'running', progress: 0.5, etaSec: 40, progressAt: now, startedAt: started }] }, now)[0].etaSec, 40);
});
