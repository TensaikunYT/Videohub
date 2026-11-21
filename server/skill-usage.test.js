import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createSkillUsage, skillsInText } from './skill-usage.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '.test-tmp');
const SECRET = 'SECRET-PROMPT-31d9', OUTPUT = 'SECRET-OUTPUT-77ab';
const MIN = 60e3, T0 = Date.parse('2026-11-20T10:00:00Z');
const iso = t => new Date(t).toISOString();
const jsonl = recs => recs.map(r => JSON.stringify(r)).join('\n') + '\n';
function put(file, text) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text); }
// synthetic records in the agents' shapes
const C = {
  prompt: (t, cwd) => ({ type: 'user', message: { role: 'user', content: SECRET }, timestamp: iso(t), cwd }),
  tool: (t, name, input, cwd) => ({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id: crypto.randomUUID(), name, input }] }, timestamp: iso(t), cwd }),
  result: (t, text, cwd) => ({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'x', content: text }] }, timestamp: iso(t), cwd }),
};
const X = {
  meta: (t, cwd) => ({ timestamp: iso(t), type: 'session_meta', payload: { id: crypto.randomUUID(), cwd, instructions: 'x'.repeat(5000) } }),
  call: (t, name, args) => ({ timestamp: iso(t), type: 'response_item', payload: { type: 'function_call', name, arguments: JSON.stringify(args), call_id: crypto.randomUUID() } }),
  custom: (t, name, input) => ({ timestamp: iso(t), type: 'response_item', payload: { type: 'custom_tool_call', name, input, call_id: crypto.randomUUID() } }),
  out: (t, text) => ({ timestamp: iso(t), type: 'response_item', payload: { type: 'function_call_output', call_id: 'y', output: text } }),
};
function world() {
  const home = path.join(root, 'usage-' + crypto.randomUUID()), films = path.join(home, 'films');
  const gears = path.join(films, 'gears'), ocean = path.join(films, 'ocean');
  fs.mkdirSync(gears, { recursive: true }); fs.mkdirSync(ocean, { recursive: true });
  const list = [{ id: 'gears0000001', title: 'Gears', path: gears, latest: 'v1.mp4', outputs: [{}] }, { id: 'ocean0000002', title: 'Ocean', path: ocean, outputs: [] }];
  return { home, films, gears, ocean, list, file: path.join(home, 'data', 'skill-usage.json') };
}

test('skill paths in a tool call: any slashes and nesting; output text and lookalikes do not count', () => {
  assert.deepEqual(skillsInText('cat C:\\\\Users\\\\me\\\\.codex\\\\skills\\\\scanline\\\\SKILL.md'), ['scanline']);
  assert.deepEqual(skillsInText('"/home/me/.agents/skills/synced/b1/docx/SKILL.md" and ~/.codex/skills/.system/imagegen/SKILL.md'), ['docx', 'imagegen']);
  assert.deepEqual(skillsInText('read skills/a/SKILL.md then skills/b/SKILL.md'), ['a', 'b']);
  assert.deepEqual(skillsInText('myskills/x/SKILL.md and skills/../SKILL.md and SKILL.md alone'), []);
});

test('Claude Code and Codex uses, mapped to films by the edits around them; incremental by offset; nothing private kept', async () => {
  const w = world(), cwdOut = path.join(w.home, 'elsewhere');
  const cdir = path.join(w.home, '.claude', 'projects', 'C--x');
  // a Claude session: Skill call, then edits in Gears; later a Read of a SKILL.md, then edits in Ocean
  const claudeFile = path.join(cdir, 'sess-1.jsonl');
  put(claudeFile, jsonl([
    C.prompt(T0, cwdOut),
    C.tool(T0 + MIN, 'Skill', { skill: 'anthropic-skills:scanline', args: SECRET }, cwdOut),
    C.result(T0 + MIN, OUTPUT + ' skills/fake/SKILL.md', cwdOut),
    C.tool(T0 + 2 * MIN, 'Write', { file_path: path.join(w.gears, 'scenes', 'a.js'), content: SECRET }, cwdOut),
    C.tool(T0 + 30 * MIN, 'Read', { file_path: path.join(w.home, '.claude', 'skills', 'voice-timing', 'SKILL.md') }, cwdOut),
    C.tool(T0 + 31 * MIN, 'Edit', { file_path: path.join(w.ocean, 'film.js'), old_string: SECRET, new_string: SECRET }, cwdOut),
  ]));
  // a helper agent of it, and a workflow helper
  put(path.join(cdir, 'sess-1', 'subagents', 'agent-a1.jsonl'), jsonl([C.tool(T0 + 40 * MIN, 'Skill', { skill: 'voice-timing' }, w.gears)]));
  put(path.join(cdir, 'sess-1', 'subagents', 'workflows', 'wf_1', 'agent-b2.jsonl'), jsonl([C.tool(T0 + 41 * MIN, 'Skill', { skill: 'scanline' }, w.ocean)]));
  // a Codex session working in Ocean: a SKILL.md read inside a tool call; the same path in a tool's output does not count
  const xfile = path.join(w.home, '.codex', 'sessions', '2026', '11', '20', 'rollout-2026-11-20T10-00-00-abc.jsonl');
  put(xfile, jsonl([
    X.meta(T0, w.ocean),
    X.call(T0 + 5 * MIN, 'shell', { command: ['bash', '-lc', 'cat ~/.codex/skills/flatdeep/SKILL.md'] }),
    X.out(T0 + 5 * MIN, 'see ~/.codex/skills/should-not-count/SKILL.md ' + OUTPUT),
    X.custom(T0 + 6 * MIN, 'apply_patch', '*** Begin Patch\n*** Update File: scenes/b.js\n@@\n-' + SECRET + '\n*** End Patch'),
  ]));
  const u = createSkillUsage({ home: w.home, env: {}, file: w.file, pauseMs: 0 });
  const r1 = await u.run();
  assert.equal(r1.files, 4); assert.ok(r1.bytes > 0);
  const agg = u.aggregate(w.list);
  assert.deepEqual([...agg.keys()].sort(), ['flatdeep', 'scanline', 'voice-timing']);
  const sc = agg.get('scanline');
  assert.equal(sc.uses, 2); assert.equal(sc.sessions, 2);
  assert.deepEqual(sc.films.map(f => [f.id, f.uses]).sort(), [['gears0000001', 1], ['ocean0000002', 1]], 'the edit after the use (Gears); the workflow helper works in Ocean');
  assert.equal(sc.last, T0 + 41 * MIN);
  const vt = agg.get('voice-timing');
  assert.deepEqual(vt.films.map(f => f.id).sort(), ['gears0000001', 'ocean0000002'], 'a Read of SKILL.md counts; the next edit is in Ocean; the helper works in Gears');
  assert.equal(agg.get('flatdeep').films[0].id, 'ocean0000002', 'Codex: by the session folder');
  assert.equal(sc.films.find(f => f.id === 'gears0000001').latest, 'v1.mp4', 'films carry what opening them needs');
  // nothing private in the saved index
  const saved = fs.readFileSync(w.file, 'utf8');
  for (const secret of [SECRET, OUTPUT]) assert.ok(!saved.includes(secret), 'leaked ' + secret);

  // appended lines: only the new bytes are read; a half-written last line waits
  const line = JSON.stringify(C.tool(T0 + 50 * MIN, 'Skill', { skill: 'flatdeep' }, w.gears));
  const line2 = JSON.stringify(C.tool(T0 + 51 * MIN, 'Skill', { skill: 'flatdeep' }, w.gears));
  fs.appendFileSync(claudeFile, line + '\n' + line2.slice(0, 40));
  const r2 = await u.run();
  assert.equal(r2.files, 1); assert.ok(r2.bytes <= line.length + 41, 'read only the appended bytes: ' + r2.bytes);
  assert.equal(u.aggregate(w.list).get('flatdeep').uses, 2);
  fs.appendFileSync(claudeFile, line2.slice(40) + '\n');
  await u.run();
  assert.equal(u.aggregate(w.list).get('flatdeep').uses, 3, 'the finished line is read next time');
  const r4 = await u.run();
  assert.equal(r4.files, 0, 'nothing new: nothing read');

  // a fresh reader starts from the saved index (offsets kept); a rewritten (shorter) file is read again
  const u2 = createSkillUsage({ home: w.home, env: {}, file: w.file, pauseMs: 0 });
  await Promise.all([u2.load(), u2.load()]);   // two callers (the Skills page and a run) share one read
  assert.equal(u2.stats().ready, true);
  assert.equal(u2.aggregate(w.list).get('flatdeep').uses, 3);
  fs.writeFileSync(xfile, jsonl([X.meta(T0, w.gears), X.call(T0 + MIN, 'shell', { command: 'type skills\\\\other\\\\SKILL.md' })]));
  const r5 = await u2.run({ pauseMs: 1 });   // a slow background run reads the same
  assert.equal(r5.files, 1);
  const a5 = u2.aggregate(w.list);
  assert.equal(a5.get('other').films[0].id, 'gears0000001');
  assert.equal(a5.get('flatdeep').uses, 2, 'the rewritten Codex file no longer has its old use');
});

test('the off switch: nothing is read; a render running makes the reader wait', async () => {
  const w = world();
  put(path.join(w.home, '.claude', 'projects', 'C--x', 's.jsonl'), jsonl([C.tool(T0, 'Skill', { skill: 'a' }, w.gears)]));
  const off = createSkillUsage({ home: w.home, env: {}, file: w.file, enabled: () => false, pauseMs: 0 });
  assert.deepEqual(await off.run(), { skipped: true });
  assert.equal(fs.existsSync(w.file), false);
  let busy = true, waited = false;
  const u = createSkillUsage({ home: w.home, env: {}, file: w.file, busy: () => { if (busy) { waited = true; busy = false; return true; } return false; }, busyWaitMs: 5, pauseMs: 0 });
  await u.run();
  assert.equal(waited, true);
  assert.equal(u.aggregate(w.list).get('a').uses, 1);
});
