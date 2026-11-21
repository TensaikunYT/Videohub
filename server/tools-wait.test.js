import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

// hub_wait: how long one call may block per agent (docs/AGENT-WAIT.md) and the text the agent gets back
const { waitDefault, codexToolTimeout, inboxText, WAIT_CAP } = await import('./tools.js');
const view = await import('../ui/channel-view.js');

test('the wait stays under each client\'s tool time limit', () => {
  assert.equal(waitDefault('claude', {}), WAIT_CAP);
  assert.equal(waitDefault('claude', { MCP_TOOL_TIMEOUT: '60000' }), 50);
  assert.equal(waitDefault('codex', {}, () => null), 50, 'no limit of ours: under the documented 60 s');
  assert.equal(waitDefault('codex', {}, () => 600), 540);
  assert.equal(waitDefault('codex', {}, () => 30), 20);
  assert.equal(waitDefault('opencode', {}), WAIT_CAP);
  assert.equal(waitDefault('other', {}), 45);
  assert.equal(waitDefault('cli', {}), 100);
});

test('Codex\'s tool_timeout_sec is read from our table only', () => {
  const home = fs.mkdtempSync(path.join(path.resolve('.test-tmp'), 'codex-home-'));
  try {
    fs.writeFileSync(path.join(home, 'config.toml'), '[mcp_servers.other]\ntool_timeout_sec = 5\n\n[mcp_servers.videohub]\ncommand = "node"\ntool_timeout_sec = 600\n\n[tui]\n');
    assert.equal(codexToolTimeout({ CODEX_HOME: home }), 600);
    fs.writeFileSync(path.join(home, 'config.toml'), '[mcp_servers.videohub]\ncommand = "node"\n[mcp_servers.other]\ntool_timeout_sec = 5\n');
    assert.equal(codexToolTimeout({ CODEX_HOME: home }), null);
    assert.equal(codexToolTimeout({ CODEX_HOME: path.join(home, 'missing') }), null);
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
});

test('what the user did reads as one text the agent can act on', () => {
  const note = { id: 7, t: 1.5, t2: null, frame: 45, kind: 'visual', file: '~live', status: 'claude', text: 'too dark', sentAt: '2026-11-21T10:02:00.000Z', images: { frame: '/f/n007_frame.jpg' } };
  const text = inboxText({ title: 'Film', path: '/films/film' }, [
    { type: 'notes', ids: [7], notes: [note] },
    { type: 'answer', q: 'q2', question: 'Warm or cool?', option: 0, label: 'Warm', text: 'softer' },
    { type: 'plan-approved', v: 3, scenes: 4, seconds: 42 },
    { type: 'scene-approved', v: 3, n: 2, title: 'Gears' },
  ]);
  assert.match(text, /#7 \[claude\] 0:01\.50 .*LIVE PREVIEW .*sent with the button/);
  assert.match(text, /frame: \/f\/n007_frame\.jpg/);
  assert.match(text, /Answer to your question q2 \("Warm or cool\?"\): "Warm" — in their words: "softer"/);
  assert.match(text, /APPROVED plan v3 \(4 scenes, 0:42\.00\)/);
  assert.match(text, /approved scene 2 "Gears"/);
  assert.match(text, /call hub_wait again/);
});

test('the Review line and the pill count follow the channel', () => {
  assert.equal(view.waitLine(null), null);
  const plan = { v: 2, scenes: [{ n: 1, seconds: 4, state: 'ready' }, { n: 2, seconds: 3.5, state: 'approved' }], approvedAt: null };
  const chan = { plan, questions: [{ id: 'q1', state: 'open' }, { id: 'q2', state: 'answered' }], waiting: { agent: 'Codex', since: 1 } };
  assert.equal(view.needCount(chan), 2);
  const w = view.waitLine(chan, 'Claude');
  assert.match(w.lead, /^Codex is waiting for/); assert.match(w.text, /an answer to its question and your OK on plan v2/); assert.equal(w.questions, 1);
  assert.equal(view.planTitle(plan), 'Plan v2 · 2 scenes · 0:08');
  assert.deepEqual(view.planCounts(plan), { planned: 0, ready: 1, approved: 1, changes: 0 });
  assert.deepEqual(view.unsentNotes([{ status: 'open' }, { status: 'open', sentAt: 'x' }, { status: 'claude' }]).length, 1);
  assert.equal(view.sentState({ status: 'open', sentAt: 'x' }).cls, 'queued');
});
