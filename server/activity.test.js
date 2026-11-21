import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createActivityReader, describeTool, newState, claudeRecord, codexRecord, applyPlanUpdate, stateOf, deriveSession, openCodeSupport, agentDirs } from './activity.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '.test-tmp');
const SECRET = 'SECRET-PROMPT-7f3a', ANSWER = 'SECRET-ANSWER-91bc', OUTPUT = 'SECRET-OUTPUT-c0de', CONTENT = 'SECRET-FILE-55aa';
const MIN = 60e3;

function fakeHome() {
  const home = path.join(root, 'activity-' + crypto.randomUUID());
  const films = path.join(home, 'films');
  fs.mkdirSync(path.join(films, 'gears', 'scenes'), { recursive: true });
  fs.mkdirSync(path.join(films, 'ocean'), { recursive: true });
  return { home, films, list: [{ id: 'gearsid00001', title: 'Gears', path: path.join(films, 'gears'), latest: 'out/v1.mp4', outputs: [{}] }, { id: 'oceanid00002', title: 'Ocean', path: path.join(films, 'ocean'), outputs: [] }] };
}
const iso = t => new Date(t).toISOString();
// Claude Code transcript records (synthetic, same shapes as the real files)
const C = {
  prompt: (t, text = SECRET, extra = {}) => ({ parentUuid: null, isSidechain: false, promptId: 'p', type: 'user', message: { role: 'user', content: text }, uuid: crypto.randomUUID(), timestamp: iso(t), turnOrigin: 'human', cwd: extra.cwd, sessionId: 's', ...extra }),
  tool: (t, name, input, id = crypto.randomUUID(), stop = 'tool_use', cwd) => ({ parentUuid: 'x', isSidechain: false, message: { role: 'assistant', content: [{ type: 'tool_use', id, name, input }], stop_reason: stop }, type: 'assistant', uuid: crypto.randomUUID(), timestamp: iso(t), cwd, sessionId: 's' }),
  result: (t, id, cwd) => ({ parentUuid: 'x', isSidechain: false, type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: OUTPUT }] }, uuid: crypto.randomUUID(), timestamp: iso(t), toolUseResult: { stdout: OUTPUT }, cwd, sessionId: 's' }),
  text: (t, text, stop = 'end_turn') => ({ parentUuid: 'x', isSidechain: false, message: { role: 'assistant', content: [{ type: 'text', text }], stop_reason: stop }, type: 'assistant', uuid: crypto.randomUUID(), timestamp: iso(t), sessionId: 's' }),
  stop: t => ({ type: 'system', subtype: 'stop_hook_summary', timestamp: iso(t), sessionId: 's' }),
  title: title => ({ type: 'custom-title', customTitle: title, sessionId: 's' }),
  lastPrompt: () => ({ type: 'last-prompt', lastPrompt: SECRET, sessionId: 's' }),
};
const jsonl = recs => recs.map(r => JSON.stringify(r)).join('\n') + '\n';
function claudeSession(home, folder, id, recs) {
  const dir = path.join(home, '.claude', 'projects', folder); fs.mkdirSync(dir, { recursive: true });
  const f = path.join(dir, id + '.jsonl'); fs.writeFileSync(f, jsonl(recs)); return f;
}
// a tool call and its result
const call = (t, name, input, cwd) => { const id = crypto.randomUUID(); return [C.tool(t, name, input, id, 'tool_use', cwd), C.result(t + 500, id, cwd)]; };

test('a Claude Code session that is running a tool is working, with film, last action, skill and files', async () => {
  const { home, films, list } = fakeHome(), now = Date.now(), cwd = path.dirname(films), gears = path.join(films, 'gears');
  claudeSession(home, 'C--work', 'sess-working', [
    C.title('Gears explainer'), C.lastPrompt(),
    C.prompt(now - 20 * MIN, SECRET, { cwd }),
    ...call(now - 19 * MIN, 'Skill', { skill: 'scanline-shorts' }, cwd),
    ...call(now - 18 * MIN, 'Write', { file_path: path.join(gears, 'scenes', '03-gears.js'), content: CONTENT }, cwd),
    ...call(now - 17 * MIN, 'Edit', { file_path: path.join(gears, 'render.js'), old_string: CONTENT, new_string: CONTENT }, cwd),
    C.text(now - 16 * MIN, ANSWER, 'tool_use'),
    C.tool(now - 1 * MIN, 'Bash', { command: 'node render.js --check ' + SECRET, description: 'Render one check frame' }, 'open-bash', 'tool_use', cwd),
  ]);
  const r = createActivityReader({ home, env: {}, now: () => now, films: () => list });
  await r.poll();
  const [s] = r.sessions();
  assert.equal(s.agent, 'claude'); assert.equal(s.id, 'sess-working'); assert.equal(s.title, 'Gears explainer');
  assert.equal(s.state, 'working');
  assert.equal(s.film.id, 'gearsid00001'); assert.equal(s.film.title, 'Gears');
  assert.equal(s.lastAction.text, 'Ran a command: Render one check frame');
  assert.deepEqual(s.skills, ['scanline-shorts']);
  assert.equal(s.filesChanged, 2);
  assert.equal(s.turnStartedAt, now - 20 * MIN); assert.equal(s.elapsedSec, 20 * 60);
  assert.equal(s.startedAt, now - 20 * MIN, 'the session started with its first record');
  const out = JSON.stringify(r.sessions());
  for (const secret of [SECRET, ANSWER, OUTPUT, CONTENT]) assert.ok(!out.includes(secret), 'leaked ' + secret);
});

test('state rule: finished, waiting (ask, question mark, open question tool), stale and interrupted', () => {
  const now = Date.now(), feed = recs => { const st = newState('claude', 'x'); for (const r of recs) claudeRecord(st, r); return st; };
  const ended = feed([C.prompt(now - 5 * MIN), C.text(now - 4 * MIN, 'All done.'), C.stop(now - 4 * MIN)]);
  assert.equal(stateOf(ended, now), 'idle');
  const question = feed([C.prompt(now - 5 * MIN), C.text(now - 4 * MIN, 'Shall I render it now?'), C.stop(now - 4 * MIN)]);
  assert.equal(stateOf(question, now), 'waiting');
  const asked = feed([C.prompt(now - 5 * MIN), ...call(now - 4 * MIN, 'mcp__ccd_turn__wrap_up', { recap: 'x', ask: 'Which fix first?' }), C.text(now - 4 * MIN, 'Done.'), C.stop(now - 4 * MIN)]);
  assert.equal(stateOf(asked, now), 'waiting');
  const open = feed([C.prompt(now - 5 * MIN), C.tool(now - 4 * MIN, 'AskUserQuestion', { questions: [] }, 'q1')]);
  assert.equal(stateOf(open, now), 'waiting');
  const thinking = feed([C.prompt(now - 5 * MIN), ...call(now - 4 * MIN, 'Read', { file_path: '/x/a.js' })]);
  assert.equal(stateOf(thinking, now), 'working');
  assert.equal(stateOf(thinking, now + 11 * MIN), 'idle', 'no writes for 10 min: no longer working');
  const longTool = feed([C.prompt(now - 5 * MIN), C.tool(now - 4 * MIN, 'Bash', { command: 'x' }, 'b1')]);
  assert.equal(stateOf(longTool, now + 30 * MIN), 'working', 'an open tool call may run long');
  const stopped = feed([C.prompt(now - 5 * MIN), C.tool(now - 4 * MIN, 'Bash', { command: 'x' }, 'b1'), C.result(now - 3 * MIN, 'b1'), C.prompt(now - 3 * MIN, '[Request interrupted by user]', { turnOrigin: undefined })]);
  assert.equal(stateOf(stopped, now), 'idle');
  // a tool result is not a new request; neither is a note from a helper agent
  const st = feed([C.prompt(now - 9 * MIN), ...call(now - 8 * MIN, 'Read', { file_path: '/a' }), C.prompt(now - 2 * MIN, 'task done', { turnOrigin: 'peer', isMeta: true })]);
  assert.equal(st.turnStartedAt, now - 9 * MIN);
});

test('plans: TodoWrite, the desktop plan tool (full list, advance, done/start) and Codex update_plan', () => {
  const now = Date.now(), st = newState('claude', 'p');
  claudeRecord(st, C.prompt(now - 30 * MIN));
  claudeRecord(st, C.tool(now - 29 * MIN, 'TodoWrite', { todos: [{ content: 'Write scenes', status: 'completed', activeForm: 'Writing scenes' }, { content: 'Add sound', status: 'in_progress', activeForm: 'Adding sound' }, { content: 'Preview', status: 'pending', activeForm: 'Opening preview' }] }));
  let s = deriveSession(st, { now });
  assert.deepEqual([s.step.done, s.step.total, s.step.text], [1, 3, 'Adding sound']);
  const p = newState('claude', 'q');
  claudeRecord(p, C.prompt(now - 30 * MIN));
  claudeRecord(p, C.tool(now - 30 * MIN, 'mcp__ccd_turn__update_plan', { items: ['A', 'B', 'C', 'D', 'E'].map((c, i) => ({ content: 'Step ' + c, status: i ? 'pending' : 'in_progress' })), scope: 'first_task' }));
  claudeRecord(p, C.tool(now - 20 * MIN, 'mcp__ccd_turn__update_plan', { advance: true }));
  s = deriveSession(p, { now });
  assert.deepEqual([s.step.done, s.step.text, s.step.current], [1, 'Step B', 2]);
  assert.equal(s.estimate, null, 'no estimate with one step done');
  claudeRecord(p, C.tool(now - 10 * MIN, 'mcp__ccd_turn__update_plan', { done: [2, 3], start: 4 }));
  s = deriveSession(p, { now });
  assert.deepEqual([s.step.done, s.step.text], [3, 'Step D']);
  assert.equal(s.state, 'working');
  assert.equal(s.estimate.estimate, true);
  assert.equal(s.estimate.remainingSec, 2 * 20 * 60 / 3 - 10 * 60);   // 3 steps in 20 min → 2 left ≈ 26.7 min, 10 min of it gone
  applyPlanUpdate(p, { advance: true }, now);   // a partial update without a list is ignored, with one it applies
  assert.equal(p.plan.filter(x => x.status === 'completed').length, 4);
  const none = newState('claude', 'r'); applyPlanUpdate(none, { advance: true }, now); assert.equal(none.plan, null);
  const cx = newState('codex', 'c');
  codexRecord(cx, { timestamp: iso(now), type: 'response_item', payload: { type: 'function_call', name: 'update_plan', call_id: 'u1', arguments: JSON.stringify({ explanation: ANSWER, plan: [{ step: 'Draft', status: 'completed' }, { step: 'Build', status: 'in_progress' }] }) } });
  assert.deepEqual(deriveSession(cx, { now }).step, { done: 1, total: 2, text: 'Build', current: 2, inProgress: true });
});

test('last action wording', () => {
  const cwd = path.resolve('/work/films/gears');
  const t = (name, input) => describeTool(name, input, { cwd }).action;
  assert.deepEqual(t('Edit', { file_path: path.join(cwd, 'scenes', '03.js') }), { verb: 'Edited', file: path.join(cwd, 'scenes', '03.js') });
  assert.equal(t('Bash', { command: 'rm -rf x', description: 'Clean the frames folder' }).text, 'Ran a command: Clean the frames folder');
  assert.equal(t('Bash', { command: 'ffmpeg -i ' + SECRET }).text, 'Ran a command (ffmpeg)');
  assert.equal(t('Skill', { skill: 'scanline-shorts' }).text, 'Loaded skill scanline-shorts');
  assert.equal(t('mcp__videohub__hub_live', { project: 'gears' }).text, 'Opened the live preview');
  assert.equal(t('mcp__videohub__hub_render', { project: 'gears' }).text, 'Queued a render');
  assert.equal(t('Read', { file_path: path.resolve('/home/me/.claude/skills/hd2d-diorama/SKILL.md') }).text, 'Loaded skill hd2d-diorama');
  assert.equal(t('mcp__Claude_Browser__navigate', {}).text, 'Used the browser');
  assert.equal(t('mcp__ccd_turn__wrap_up', { recap: 'x' }), null, 'bookkeeping tools are not an action'); assert.equal(t('TodoWrite', { todos: [] }), null);
  assert.equal(t('mcp__some_server__do_thing', {}).text, 'Used some server (do thing)');
  assert.equal(t('apply_patch', { input: '*** Begin Patch\n*** Add File: scenes/04.js\n+x\n*** End Patch' }).verb, 'Created');
  // relative to the film in the session view
  const st = newState('claude', 'w'); st.cwd = path.dirname(cwd);
  claudeRecord(st, C.prompt(Date.now()));
  claudeRecord(st, C.tool(Date.now(), 'Edit', { file_path: path.join(cwd, 'scenes', '03-gears.js') }));
  assert.equal(deriveSession(st, { films: [{ id: 'g', title: 'Gears', path: cwd }] }).lastAction.text, 'Edited scenes/03-gears.js');
});

test('film matching: hub_* project, edited files, working folder, or none', () => {
  const { films, list } = fakeHome(), now = Date.now();
  const mk = (cwd, recs) => { const st = newState('claude', 'f'); st.cwd = cwd; for (const r of recs) claudeRecord(st, r); return deriveSession(st, { now, films: list }).film?.id || null; };
  assert.equal(mk(path.join(films, 'ocean'), []), 'oceanid00002');
  assert.equal(mk(path.join(films, 'ocean', 'scenes'), []), 'oceanid00002');
  assert.equal(mk(films, [C.tool(now, 'mcp__videohub__hub_live', { project: 'gears' })]), 'gearsid00001');
  assert.equal(mk(films, [C.tool(now, 'mcp__videohub__hub_project', { project: 'oceanid00002' })]), 'oceanid00002');
  assert.equal(mk(films, [C.tool(now, 'Edit', { file_path: path.join(films, 'gears', 'a.js') }), C.tool(now, 'Write', { file_path: path.join(films, 'ocean', 'b.js') })]), 'oceanid00002', 'the most recent hint wins');
  assert.equal(mk(path.join(films, '..'), [C.tool(now, 'Edit', { file_path: path.join(films, '..', 'notes.md') })]), null);
});

test('offset reading: only new bytes, partial lines wait, the reader catches appends', async () => {
  const { home, list } = fakeHome(), now = Date.now(), cwd = path.join(home, 'films', 'gears');
  const f = claudeSession(home, 'C--films-gears', 'sess-append', [C.title('Append test'), C.prompt(now - 5 * MIN, SECRET, { cwd }), ...call(now - 4 * MIN, 'Read', { file_path: path.join(cwd, 'a.js') }, cwd)]);
  const r = createActivityReader({ home, env: {}, now: () => now, films: () => list });
  await r.poll();
  assert.equal(r.sessions()[0].lastAction.text, 'Read a.js');
  const size = fs.statSync(f).size;
  await r.poll(); assert.equal(r.stats().bytes, 0, 'nothing new: nothing read');
  const line = JSON.stringify(C.tool(now - 1 * MIN, 'Edit', { file_path: path.join(cwd, 'b.js') }, 'e1', 'tool_use', cwd));
  fs.appendFileSync(f, line.slice(0, 40));
  await r.poll();
  assert.equal(r.sessions()[0].lastAction.text, 'Read a.js', 'a half-written line is not used yet');
  fs.appendFileSync(f, line.slice(40) + '\n');
  await r.poll();
  assert.equal(r.sessions()[0].lastAction.text, 'Edited b.js');
  assert.ok(r.stats().bytes <= line.length + 1 && r.stats().bytes > 0, 'reads only the appended bytes: ' + r.stats().bytes);
  assert.equal([...r.files.values()][0].offset, size + line.length + 1);
});

test('a long turn: the tail is read first and the turn start is found by a one-off backwards search', async () => {
  const { home, list } = fakeHome(), now = Date.now();
  const filler = Array.from({ length: 200 }, (_, i) => call(now - 50 * MIN + i * 1000, 'Read', { file_path: '/w/f' + i + '.js', pad: 'x'.repeat(200) })).flat();
  claudeSession(home, 'C--w', 'sess-long', [C.prompt(now - 60 * MIN, SECRET, { cwd: '/w' }), C.tool(now - 59 * MIN, 'TodoWrite', { todos: [{ content: 'One', status: 'completed' }, { content: 'Two', status: 'in_progress', activeForm: 'Doing two' }] }), ...filler, C.tool(now - MIN, 'Bash', { command: 'x', description: 'Build it' }, 'open')]);
  const r = createActivityReader({ home, env: {}, now: () => now, films: () => list, firstRead: 4096 });
  await r.poll();
  const [s] = r.sessions();
  assert.equal(s.turnStartedAt, now - 60 * MIN);
  assert.equal(s.step.text, 'Doing two');
  assert.equal(s.state, 'working');
  assert.ok(!JSON.stringify(s).includes(SECRET));
});

test('a session read from its tail still knows when it started (its first record, read once from the head)', async () => {
  const { home, list } = fakeHome(), now = Date.now();
  const filler = Array.from({ length: 120 }, (_, i) => call(now - 80 * MIN + i * 1000, 'Read', { file_path: '/w/f' + i + '.js', pad: 'x'.repeat(200) })).flat();
  claudeSession(home, 'C--w', 'sess-two-turns', [C.title('t'), C.prompt(now - 90 * MIN, SECRET, { cwd: '/w' }), ...filler, C.text(now - 70 * MIN, 'ok'), C.stop(now - 70 * MIN), C.prompt(now - 5 * MIN, SECRET, { cwd: '/w' }), C.tool(now - MIN, 'Bash', { command: 'x' }, 'open')]);
  const r = createActivityReader({ home, env: {}, now: () => now, films: () => list, firstRead: 4096 });
  await r.poll();
  const [s] = r.sessions();
  assert.equal(s.turnStartedAt, now - 5 * MIN);
  assert.equal(s.startedAt, now - 90 * MIN);
});

test('the 3 hour window: old files are not read, files touched without new work are not listed', async () => {
  const { home, list } = fakeHome(), now = Date.now();
  const old = claudeSession(home, 'C--a', 'old-file', [C.prompt(now - 5 * 3600e3), C.text(now - 5 * 3600e3, 'x'), C.stop(now - 5 * 3600e3)]);
  const t = new Date(now - 4 * 3600e3); fs.utimesSync(old, t, t);
  claudeSession(home, 'C--a', 'touched-only', [C.prompt(now - 5 * 3600e3), C.text(now - 5 * 3600e3, 'x'), C.stop(now - 5 * 3600e3), C.title('renamed')]);
  claudeSession(home, 'C--a', 'recent', [C.prompt(now - 30 * MIN), C.text(now - 29 * MIN, 'ok'), C.stop(now - 29 * MIN)]);
  const r = createActivityReader({ home, env: {}, now: () => now, films: () => list });
  await r.poll();
  assert.deepEqual(r.sessions().map(s => s.id), ['recent']);
  assert.ok(![...r.files.keys()].some(f => f.includes('old-file')));
  assert.equal(r.sessions()[0].state, 'idle');
  const short = createActivityReader({ home, env: {}, now: () => now, films: () => list, windowMs: 10 * MIN });
  await short.poll();
  assert.deepEqual(short.sessions(), []);
});

test('the off switch: the reader never touches the agent folders', async () => {
  const { home, list } = fakeHome(), now = Date.now();
  claudeSession(home, 'C--a', 'sess', [C.prompt(now - MIN)]);
  const touched = [];
  const spy = Object.fromEntries(['readdir', 'stat', 'open', 'readFile'].map(k => [k, (...a) => { touched.push(String(a[0])); return fsp[k](...a); }]));
  let on = false;
  const r = createActivityReader({ home, env: {}, fs: spy, now: () => now, films: () => list, enabled: () => on });
  await r.poll(); await r.poll();
  assert.deepEqual(touched, []); assert.deepEqual(r.sessions(), []);
  on = true; await r.poll();
  assert.ok(touched.length > 0); assert.equal(r.sessions().length, 1);
  on = false; touched.length = 0; await r.poll();
  assert.deepEqual(touched, []); assert.deepEqual(r.sessions(), [], 'switching off forgets what was read');
});

test('Claude Code helper agents (subagents/) count for their session', async () => {
  const { home, list } = fakeHome(), now = Date.now();
  claudeSession(home, 'C--a', 'parent', [C.title('Parent'), C.prompt(now - 20 * MIN), ...call(now - 19 * MIN, 'Agent', { description: 'Build the page', prompt: SECRET, subagent_type: 'general-purpose' }), C.text(now - 19 * MIN, 'Started it.'), C.stop(now - 19 * MIN)]);
  const sub = path.join(home, '.claude', 'projects', 'C--a', 'parent', 'subagents'); fs.mkdirSync(sub, { recursive: true });
  fs.writeFileSync(path.join(sub, 'agent-a1.jsonl'), jsonl([{ ...C.prompt(now - 19 * MIN, SECRET), isSidechain: true, turnOrigin: undefined }, ...call(now - 2 * MIN, 'Edit', { file_path: '/w/x.js' }).map(r => ({ ...r, isSidechain: true }))]));
  fs.writeFileSync(path.join(sub, 'agent-a1.meta.json'), JSON.stringify({ agentType: 'general-purpose', description: 'Build the page', finished: false }));
  const r = createActivityReader({ home, env: {}, now: () => now, films: () => list });
  await r.poll();
  let [s] = r.sessions();
  assert.equal(r.sessions().length, 1, 'a helper is not a session of its own');
  assert.equal(s.state, 'working'); assert.equal(s.helpers, 1); assert.deepEqual(s.helperTasks, ['Build the page']);
  assert.equal(s.lastAction.text, 'Helper: Edited x.js');
  fs.writeFileSync(path.join(sub, 'agent-a1.meta.json'), JSON.stringify({ description: 'Build the page', finished: true }));
  fs.appendFileSync(path.join(sub, 'agent-a1.jsonl'), jsonl([C.text(now - MIN, ANSWER)]));
  await r.poll();
  [s] = r.sessions();
  assert.equal(s.state, 'idle'); assert.equal(s.helpers, 0);
  assert.ok(!JSON.stringify(s).includes(SECRET));
});

// Codex rollout records (synthetic, same shapes as the real files)
const X = {
  meta: (t, id, cwd, source = 'vscode', extra = {}) => ({ timestamp: iso(t), type: 'session_meta', payload: { id, session_id: id, cwd, source, thread_source: 'user', originator: 'codex', base_instructions: { text: 'x'.repeat(3000) }, ...extra } }),
  started: t => ({ timestamp: iso(t), type: 'event_msg', payload: { type: 'task_started', turn_attribution: { turn_trigger: 'composer' } } }),
  user: t => ({ timestamp: iso(t), type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: SECRET }] } }),
  exec: (t, id, code) => ({ timestamp: iso(t), type: 'response_item', payload: { type: 'custom_tool_call', status: 'completed', call_id: id, name: 'exec', input: code } }),
  out: (t, id) => ({ timestamp: iso(t), type: 'response_item', payload: { type: 'custom_tool_call_output', call_id: id, output: OUTPUT } }),
  fn: (t, id, name, args) => ({ timestamp: iso(t), type: 'response_item', payload: { type: 'function_call', call_id: id, name, arguments: JSON.stringify(args) } }),
  done: (t, msg) => ({ timestamp: iso(t), type: 'event_msg', payload: { type: 'task_complete', last_agent_message: msg } }),
};
function codexSession(home, day, name, recs) {
  const dir = path.join(home, '.codex', 'sessions', ...day.split('/')); fs.mkdirSync(dir, { recursive: true });
  const f = path.join(dir, name); fs.writeFileSync(f, jsonl(recs)); return f;
}

test('Codex sessions: state, patch files, commands, titles, guardian and helper threads', async () => {
  const { home, films, list } = fakeHome(), now = Date.now(), cwd = path.join(films, 'gears');
  codexSession(home, '2026/11/20', 'rollout-a.jsonl', [X.meta(now - 30 * MIN, 'thread-1', cwd), X.started(now - 30 * MIN), X.user(now - 30 * MIN),
    X.exec(now - 20 * MIN, 'c1', 'text(await tools.apply_patch("*** Begin Patch\\n*** Update File: scenes/02.js\\n@@\\n-' + CONTENT + '\\n*** End Patch"))'), X.out(now - 20 * MIN, 'c1'),
    X.exec(now - 10 * MIN, 'c2', 'text(await tools.exec_command({cmd:"cat C:\\\\Users\\\\me\\\\.codex\\\\skills\\\\papercutshorts\\\\SKILL.md"}))'), X.out(now - 10 * MIN, 'c2'),
    X.exec(now - 2 * MIN, 'c3', 'text(await tools.exec_command({cmd:"node render.js ' + SECRET + '"}))')]);
  codexSession(home, '2026/11/20', 'rollout-b.jsonl', [X.meta(now - 50 * MIN, 'thread-2', path.join(films, 'ocean')), X.started(now - 50 * MIN), X.fn(now - 45 * MIN, 'f1', 'exec_command', { cmd: 'git status' }), X.out(now - 45 * MIN, 'f1'), X.done(now - 40 * MIN, 'Started a helper.')]);
  codexSession(home, '2026/11/20', 'rollout-g.jsonl', [X.meta(now - 5 * MIN, 'thread-g', cwd, { subagent: { other: 'guardian' } }), X.started(now - 5 * MIN)]);
  codexSession(home, '2026/11/01', 'rollout-h.jsonl', [X.meta(now - 6 * MIN, 'thread-h', cwd, { subagent: { thread_spawn: { parent_thread_id: 'thread-2', depth: 1, agent_nickname: 'Nash' } } }), X.started(now - 6 * MIN), X.exec(now - MIN, 'h1', 'text(await tools.view_image({path:"a.png"}))')]);
  fs.writeFileSync(path.join(home, '.codex', 'session_index.jsonl'), jsonl([{ id: 'thread-1', thread_name: 'Old name', updated_at: iso(now) }, { id: 'thread-1', thread_name: 'Gears in Codex', updated_at: iso(now) }]));
  const r = createActivityReader({ home, env: {}, now: () => now, films: () => list });
  await r.poll();
  const ss = r.sessions(), a = ss.find(s => s.id === 'thread-1'), b = ss.find(s => s.id === 'thread-2');
  assert.equal(ss.length, 2, 'guardian and helper threads are not sessions of their own');
  assert.equal(a.agent, 'codex'); assert.equal(a.title, 'Gears in Codex'); assert.equal(a.state, 'working');
  assert.equal(a.film.id, 'gearsid00001'); assert.equal(a.filesChanged, 1); assert.deepEqual(a.skills, ['papercutshorts']);
  assert.equal(a.lastAction.text, 'Ran a command (node)'); assert.equal(a.turnStartedAt, now - 30 * MIN);
  assert.equal(b.film.id, 'oceanid00002');
  assert.equal(b.state, 'working', 'its helper thread works'); assert.equal(b.helpers, 1); assert.equal(b.lastAction.text, 'Helper: Looked at an image');
  const out = JSON.stringify(ss);
  for (const secret of [SECRET, ANSWER, OUTPUT, CONTENT]) assert.ok(!out.includes(secret), 'leaked ' + secret);
  const st = newState('codex', 'z'); for (const rec of [X.meta(now, 'z', cwd), X.started(now - MIN), X.done(now, 'Want me to render it?')]) codexRecord(st, rec);
  assert.equal(stateOf(st, now), 'waiting');
  codexRecord(st, X.started(now)); codexRecord(st, { timestamp: iso(now), type: 'event_msg', payload: { type: 'turn_aborted', reason: 'interrupted' } });
  assert.equal(stateOf(st, now), 'idle');
});

test('agent folders follow the fake home and the agents\u2019 own overrides; OpenCode is reported as not supported', () => {
  const home = path.resolve('/fake/home');
  const d = agentDirs({ home, env: {} });
  assert.equal(d.claude, path.join(home, '.claude', 'projects')); assert.equal(d.codex, path.join(home, '.codex', 'sessions'));
  assert.equal(d.opencode, path.join(home, '.local', 'share', 'opencode', 'storage'));
  const o = agentDirs({ home, env: { CLAUDE_CONFIG_DIR: path.resolve('/c'), CODEX_HOME: path.resolve('/x'), XDG_DATA_HOME: path.resolve('/d') } });
  assert.equal(o.claude, path.join(path.resolve('/c'), 'projects')); assert.equal(o.codexIndex, path.join(path.resolve('/x'), 'session_index.jsonl'));
  assert.equal(o.opencode, path.join(path.resolve('/d'), 'opencode', 'storage'));
  assert.deepEqual(openCodeSupport(), { agent: 'opencode', supported: false, reason: 'OpenCode is not supported yet' });
});

test('the estimate uses only steps completed in the current turn', () => {
  const now = Date.now(), DAY = 24 * 3600e3, plan = (done, cur) => ({ items: Array.from({ length: 10 }, (_, i) => ({ content: 'Step ' + (i + 1), status: i < done ? 'completed' : i === cur ? 'in_progress' : 'pending' })) });
  const open = (st, t) => claudeRecord(st, C.tool(t, 'Bash', { command: 'x' }, 'open-' + t));   // keeps the turn running
  // a plan from earlier turns (days ago): 2 steps were done then; this turn is 8 min old with no step finished in it
  const old = newState('claude', 'old');
  claudeRecord(old, C.prompt(now - 2 * DAY));
  claudeRecord(old, C.tool(now - 2 * DAY, 'mcp__ccd_turn__update_plan', plan(0, 0)));
  claudeRecord(old, C.tool(now - 2 * DAY + 10 * MIN, 'mcp__ccd_turn__update_plan', { advance: true }));
  claudeRecord(old, C.tool(now - 2 * DAY + 20 * MIN, 'mcp__ccd_turn__update_plan', { advance: true }));
  claudeRecord(old, C.text(now - 2 * DAY + 21 * MIN, 'ok')); claudeRecord(old, C.stop(now - 2 * DAY + 21 * MIN));
  claudeRecord(old, C.prompt(now - 8 * MIN)); open(old, now - MIN);
  let s = deriveSession(old, { now });
  assert.equal(s.state, 'working'); assert.deepEqual([s.step.done, s.step.current, s.step.inProgress], [2, 3, true]);
  assert.equal(s.estimate, null, 'earlier turns say nothing about this turn’s pace');
  // one step inside the turn: still no estimate
  claudeRecord(old, C.tool(now - 4 * MIN, 'mcp__ccd_turn__update_plan', { advance: true })); open(old, now - MIN);
  assert.equal(deriveSession(old, { now }).estimate, null);
  // two inside the turn (4 and 6 min after it began): 3 min a step, 6 left = 18 min, 2 min of it gone
  claudeRecord(old, C.tool(now - 2 * MIN, 'mcp__ccd_turn__update_plan', { advance: true })); open(old, now - MIN);
  s = deriveSession(old, { now });
  assert.equal(s.step.done, 4); assert.equal(s.estimate.estimate, true);
  assert.equal(s.estimate.remainingSec, (6 * MIN / 2 * 6 - 2 * MIN) / 1000);
  // a full list sent again with steps already marked done is a baseline, not completions
  const fresh = newState('claude', 'fresh');
  claudeRecord(fresh, C.prompt(now - 8 * MIN));
  claudeRecord(fresh, C.tool(now - 7 * MIN, 'mcp__ccd_turn__update_plan', plan(5, 5))); open(fresh, now - MIN);
  s = deriveSession(fresh, { now });
  assert.deepEqual([s.step.done, s.step.current], [5, 6]); assert.equal(s.estimate, null);
  // TodoWrite: completions inside the turn measured from the plan's creation in that turn
  const todo = newState('claude', 'todo'), list = n => ({ todos: ['a', 'b', 'c', 'd'].map((c, i) => ({ content: c, activeForm: c + '…', status: i < n ? 'completed' : i === n ? 'in_progress' : 'pending' })) });
  claudeRecord(todo, C.prompt(now - 30 * MIN));
  claudeRecord(todo, C.tool(now - 20 * MIN, 'TodoWrite', list(0)));
  claudeRecord(todo, C.tool(now - 15 * MIN, 'TodoWrite', list(1)));
  claudeRecord(todo, C.tool(now - 10 * MIN, 'TodoWrite', list(2))); open(todo, now - MIN);
  // 2 steps in the 10 min since the plan was made: 5 min a step, 2 left = 10 min, all of it gone → never below 1 min
  assert.equal(deriveSession(todo, { now }).estimate.remainingSec, 60);
});
