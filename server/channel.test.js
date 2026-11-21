import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

// The agent channel: plan versions, questions with picture options, "Send to agent" and hub_wait's long-poll.
fs.mkdirSync(path.resolve('.test-tmp'), { recursive: true });
const root = fs.mkdtempSync(path.join(path.resolve('.test-tmp'), 'channel-'));
const dir = path.join(root, 'film');
fs.mkdirSync(path.join(dir, 'shots'), { recursive: true });
fs.writeFileSync(path.join(dir, 'shots', 'a.png'), 'png');
fs.writeFileSync(path.join(root, 'outside.png'), 'png');
const p = { id: 'chan-test-0001', path: dir, name: 'film', title: 'Film', outputs: [], render: {} };
const getProject = id => id === p.id ? p : null;
test.after(() => { try { fs.rmSync(root, { recursive: true }); } catch { } });

const ch = await import('./channel.js'), notes = await import('./notes.js');

test('a new plan version keeps the old one and starts unapproved', () => {
  const v1 = ch.writePlan(p, { summary: 'one', scenes: [{ title: 'Open', seconds: 4, narration: 'hi' }, { title: 'End', seconds: 3.5, narration: 'bye' }] });
  assert.equal(v1.v, 1); assert.deepEqual(v1.scenes.map(s => s.start), [0, 4]);
  ch.markBuilt(p, [1]); ch.approveScene(p, 1, 1); ch.approvePlan(p, 1);
  assert.equal(ch.currentPlan(p).scenes[0].state, 'approved'); assert.ok(ch.currentPlan(p).approvedAt);
  assert.throws(() => ch.approveScene(p, 99, 1), e => e.code === 409);
  const v2 = ch.writePlan(p, { scenes: [{ title: 'Open', seconds: 5, narration: 'hi' }] });
  assert.equal(v2.v, 2); assert.equal(v2.approvedAt, null); assert.equal(v2.scenes[0].state, 'planned');
  assert.equal(ch.readPlan(p).versions.length, 2);
  assert.throws(() => ch.writePlan(p, { scenes: [{ title: '', seconds: 1 }] }), e => e.code === 400);
  ch.deliver(p);   // clear the inbox for the next tests
});

test('question pictures must be inside the film folder', () => {
  const q = ch.ask(p, { question: 'Which?', options: [{ label: 'A', image: 'shots/a.png' }, { label: 'B' }], recommended: 'b' });
  assert.equal(q.options[0].image, 'shots/a.png'); assert.equal(q.recommended, 1);
  assert.throws(() => ch.ask(p, { question: 'x', options: [{ label: 'A', image: '../outside.png' }] }), e => e.code === 400);
  assert.throws(() => ch.ask(p, { question: 'x', options: [{ label: 'A', image: path.join(root, 'outside.png') }] }), e => e.code === 400);
  assert.throws(() => ch.answer(p, q.id, { option: 5 }), e => e.code === 400);
  const it = ch.answer(p, q.id, { option: 0, text: 'warmer' });
  assert.equal(it.type, 'answer'); assert.equal(it.label, 'A');
  const got = ch.deliver(p);
  assert.equal(got.length, 1); assert.equal(got[0].text, 'warmer');
  assert.equal(ch.deliver(p).length, 0, 'delivered once');
});

test('sent notes reach a waiting agent at once, marked as taken, and only once', async () => {
  const n1 = await notes.add(p, { t: 1, text: 'too dark', file: '~live' }), n2 = await notes.add(p, { t: 2, text: 'faster', file: '~live' });
  let got = null;
  const gone = ch.wait(getProject, p.id, { seconds: 5, agent: 'Codex' }, items => { got = items; });
  assert.equal(typeof gone, 'function');
  assert.equal(ch.waitingOn(p.id).agent, 'Codex'); assert.equal(ch.waitCount(), 1);
  const r = ch.sendNotes(p);
  assert.equal(r.count, 2); assert.equal(r.waiting.agent, 'Codex');
  assert.equal(got.length, 1); assert.deepEqual(got[0].notes.map(n => n.id), [n1.id, n2.id]);
  assert.ok(notes.list(p).filter(n => [n1.id, n2.id].includes(n.id)).every(n => n.status === 'claude' && n.sentAt));
  assert.equal(ch.waitCount(), 0);
  assert.equal(ch.sendNotes(p).count, 0, 'nothing left to send');
  // reopened: it can be sent again
  notes.update(p, n1.id, { status: 'reopened' });
  assert.equal(ch.sendNotes(p).count, 1);
  // taken with hub_notes before hub_wait came: not delivered twice
  notes.update(p, n1.id, { status: 'claude' }, 'claude');
  assert.equal(ch.deliver(p).length, 0);
});

test('a wait times out empty, and a client that goes away leaves no waiter', async () => {
  const items = await new Promise(res => ch.wait(getProject, p.id, { seconds: 1 }, res));
  assert.deepEqual(items, []);
  let called = null;
  const gone = ch.wait(getProject, p.id, { seconds: 30 }, x => { called = x; });
  assert.equal(ch.waitCount(), 1);
  gone(); assert.equal(called, null); assert.equal(ch.waitCount(), 0);
  // what the user does meanwhile waits for the next call
  ch.approvePlan(p, 2);
  const next = await new Promise(res => ch.wait(getProject, p.id, { seconds: 5 }, res));
  assert.equal(next[0].type, 'plan-approved');
});

test('a note on a scene becomes a sent review note over the scene and marks the scene', async () => {
  ch.writePlan(p, { scenes: [{ title: 'Open', seconds: 4, narration: 'a' }, { title: 'Gears', seconds: 6, narration: 'b' }] });
  const n = await ch.sceneNote(p, 3, 2, 'more gears', { file: '~live', fps: 30 });
  assert.equal(n.t, 4); assert.ok(n.t2 > 9.9 && n.t2 <= 10);
  assert.match(n.text, /^Scene 2 \(Gears\): more gears/);
  assert.equal(ch.currentPlan(p).scenes[1].state, 'changes');
  const got = ch.deliver(p);
  assert.equal(got[0].type, 'scene-note'); assert.equal(got[0].notes[0].id, n.id);
  ch.markBuilt(p, [2]); assert.equal(ch.currentPlan(p).scenes[1].state, 'ready');
});
