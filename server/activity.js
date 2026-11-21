// Agent activity for the "Now" page: what Claude Code and Codex sessions are doing, read passively from the session
// files those agents already write. VideoHub never talks to an agent here and spends no tokens.
//
// Privacy: only derived facts leave this module (agent, session id, title, folder, film, state, plan step, times, a
// plain-English last action, skill names, a count of changed files). Prompt text, answers, command output and file
// contents are never kept or sent: "last-prompt" records are skipped unparsed, and the few checks that look at text
// (does the agent's last message end with a question mark, is a user record an interruption marker) keep only a boolean.
//
// Cost: only session files changed within the window (default 3 h) are read; each file is read from a remembered byte
// offset (first sight: its last 512 KB, plus a one-off backwards search for the start of the current turn when that
// tail does not contain it); a poll reads at most a fixed budget and yields between files. Folders are listed again
// every 15 s; in between, only the files already known to be recent are checked.
import fsDefault from 'node:fs/promises';
import pathDefault from 'node:path';
import osDefault from 'node:os';
import { pathKey as pathKeyDefault } from './platform.js';

export const WINDOW_MS = 3 * 3600e3;
const FIRST_READ = 512 * 1024;          // first sight of a file: its tail only
const CATCH_UP = 2 << 20;               // more new bytes than this since the last read: jump to the tail again
const POLL_BUDGET = 6 << 20;            // bytes one poll may read in total; the rest waits for the next poll
const BACK_SCAN = 8 << 20;              // backwards search for the current turn's start, once per session
const DISCOVER_MS = 15e3;               // list the agents' folders again at most this often
const STALE_MS = 10 * 60e3;             // a turn with no writes for this long is no longer "working" ...
const STALE_TOOL_MS = 45 * 60e3;        // ... unless a tool call is still open (a long command or render)
const MAX_FILES_PER_POLL = 60;

export const AGENTS = { claude: 'Claude Code', codex: 'Codex', opencode: 'OpenCode' };

// where each agent keeps its sessions (CLAUDE_CONFIG_DIR / CODEX_HOME are the agents' own overrides)
export function agentDirs({ home = osDefault.homedir(), env = process.env, path = pathDefault } = {}) {
  const codexHome = env.CODEX_HOME || path.join(home, '.codex');
  return {
    claude: path.join(env.CLAUDE_CONFIG_DIR || path.join(home, '.claude'), 'projects'),
    codex: path.join(codexHome, 'sessions'),
    codexIndex: path.join(codexHome, 'session_index.jsonl'),
    opencode: path.join(env.XDG_DATA_HOME || path.join(home, '.local', 'share'), 'opencode', 'storage'),
  };
}

// OpenCode keeps sessions as JSON files under its storage folder. Its format is not documented in anything available
// offline here and OpenCode is not installed on the development PC, so it is not read (no guessing at a format).
export function openCodeSupport() { return { agent: 'opencode', supported: false, reason: 'OpenCode is not supported yet' }; }

// ---------- per-session state, fed one record at a time
export function newState(agent, id) {
  return {
    agent, id, title: '', cwd: '', parent: null, nick: '', ignore: false, startedAt: null,   // startedAt: the session's first record
    turnOpen: false, turnStartedAt: null, endedAt: null, lastAt: null, lastQuestion: false, askFlag: false, interrupted: false,
    pending: new Map(),                   // open tool calls: id → { name, at }
    plan: null, planStartedAt: null, doneLog: [],   // doneLog: [{ at, n }] steps completed, and when
    action: null,                         // { verb, file } or { text }, plus at
    skills: new Set(), files: new Set(), hints: [],   // hints: [{ path, at }] film candidates (edited files, hub_* projects)
  };
}
const ts = r => { const t = Date.parse(r?.timestamp || ''); return Number.isFinite(t) ? t : null; };
const endsWithQuestion = text => /\?["'”’)\]*_`\s]*$/.test(String(text || '').slice(-200));
const addHint = (st, p, at) => { if (!p) return; st.hints.push({ path: p, at }); if (st.hints.length > 40) st.hints.splice(0, st.hints.length - 40); };
const setAction = (st, a, at) => { st.action = { ...a, at }; };
const skillFromPath = p => { const m = /[\\/]skills[\\/]+([^\\/]+)[\\/]+SKILL\.md$/i.exec(String(p || '')); return m ? m[1] : null; };
const resolveIn = (path, cwd, p) => { try { return path.isAbsolute(p) ? path.resolve(p) : cwd ? path.resolve(cwd, p) : null; } catch { return null; } };

// plans: the full list from TodoWrite / update_plan, or the desktop plan tool's partial updates against the last list
function setPlan(st, items, at) {
  const steps = items.filter(x => x && typeof x === 'object').slice(0, 60).map(x => ({
    text: String(x.content ?? x.step ?? x.text ?? '').slice(0, 160), active: x.activeForm ? String(x.activeForm).slice(0, 160) : '',
    status: x.status === 'completed' || x.status === 'done' ? 'completed' : x.status === 'in_progress' ? 'in_progress' : 'pending' }));
  if (!steps.length) { st.plan = null; st.planStartedAt = null; st.doneLog = []; return; }
  const same = st.plan && st.plan.length === steps.length && st.plan.every((s, i) => s.text === steps[i].text);
  // a new list: steps it already marks done were not completed now (they are the baseline, not a pace)
  if (!same) { st.planStartedAt = at; st.doneLog = []; st.plan = steps; return; }
  const before = st.plan.filter(s => s.status === 'completed').length;
  st.plan = steps; planDone(st, before, at);
}
function planDone(st, before, at) {
  const n = st.plan.filter(s => s.status === 'completed').length;
  if (n > before && at) { st.doneLog.push({ at, n: n - before }); if (st.doneLog.length > 100) st.doneLog.shift(); }
}
export function applyPlanUpdate(st, input, at) {
  if (Array.isArray(input?.items)) return setPlan(st, input.items, at);
  if (!st.plan) return;   // a partial update with no full list seen: nothing to apply it to
  const before = st.plan.filter(s => s.status === 'completed').length;
  if (input.advance) {
    const cur = st.plan.findIndex(s => s.status === 'in_progress');
    if (cur >= 0) st.plan[cur].status = 'completed';
    const next = st.plan.findIndex((s, i) => i > cur && s.status === 'pending');
    if (next >= 0) st.plan[next].status = 'in_progress';
  }
  for (const n of [].concat(input.done || [])) { const s = st.plan[+n - 1]; if (s) s.status = 'completed'; }
  if (input.start != null) { const s = st.plan[+input.start - 1]; if (s) { for (const o of st.plan) if (o.status === 'in_progress') o.status = 'pending'; s.status = 'in_progress'; } }
  planDone(st, before, at);
}

// ---------- what a tool call was, in plain English (never its arguments' content, only a path / a description)
const HUB = { hub_live: 'Opened the live preview', hub_render: 'Queued a render', hub_notes: 'Read the review notes', hub_note_update: 'Answered a review note', hub_project: 'Looked at the film in VideoHub', hub_job: 'Checked a render', hub_register_version: 'Saved a new version', hub_workspace: 'Looked up the workspace', hub_cleanup: 'Cleaned up render leftovers', hub_finish: 'Looked at what finishing the film would tidy', hub_finish: 'Looked at what finishing the film would tidy', hub_plan: 'Wrote the plan in VideoHub', hub_ask: 'Asked you a question in VideoHub', hub_wait: 'Waited for you in VideoHub' };
// (plan and end-of-turn tools are bookkeeping, not an action: the plan shows itself)
const PLAIN = { Read: null, Grep: 'Searched the files', Glob: 'Looked for files', LS: 'Listed a folder', WebSearch: 'Searched the web', WebFetch: 'Read a web page', web_search: 'Searched the web', web__run: 'Searched the web', ToolSearch: 'Loaded tools', TodoWrite: null, update_plan: null, mcp__ccd_turn__update_plan: null, mcp__ccd_turn__wrap_up: null, Agent: 'Started a helper agent', Task: 'Started a helper agent', spawn_agent: 'Started a helper agent', wait_agent: 'Waited for a helper agent', AskUserQuestion: 'Asked you a question', request_user_input: 'Asked you a question', request_user_input_async: 'Asked you a question', ExitPlanMode: 'Asked you to approve a plan', view_image: 'Looked at an image', sleep: 'Waited', wait: 'Waited', BashOutput: 'Checked a running command', KillShell: 'Stopped a command', TaskStop: 'Stopped a background task', SendMessage: 'Messaged a helper agent', send_message: 'Messaged a helper agent', NotebookEdit: null };
export const ASKS = new Set(['AskUserQuestion', 'ExitPlanMode', 'request_user_input', 'request_user_input_async']);

// one tool call → { action, files: [abs], skill, hint }
export function describeTool(name, input, { cwd = '', path = pathDefault } = {}) {
  input = input && typeof input === 'object' ? input : {};
  const out = { action: null, files: [], skill: null, hint: null };
  const hub = /(?:^|__)(hub_\w+)$/.exec(name);
  if (hub) {
    out.action = { text: HUB[hub[1]] || 'Used VideoHub' };
    if (typeof input.project === 'string' && input.project) out.hint = { project: input.project };
    return out;
  }
  if (['Edit', 'MultiEdit', 'Write', 'NotebookEdit'].includes(name)) {
    const f = resolveIn(path, cwd, String(input.file_path || input.notebook_path || ''));
    if (f) out.files.push(f);
    out.action = { verb: name === 'Write' ? 'Wrote' : 'Edited', file: f };
    return out;
  }
  if (name === 'Bash' || name === 'PowerShell' || name === 'shell' || name === 'exec_command' || name === 'local_shell') {
    const d = typeof input.description === 'string' ? input.description.trim().replace(/\s+/g, ' ').slice(0, 90) : '';
    const cmd = [].concat(input.cmd ?? input.command ?? []).join(' ');
    const sk = skillFromPath((/[^\s"'`]*[\\/]skills[\\/]+[^\\/\s"'`]+[\\/]+SKILL\.md/i.exec(cmd) || [])[0]);
    if (sk) { out.skill = sk; out.action = { text: 'Loaded skill ' + sk }; return out; }
    out.action = { text: d ? 'Ran a command: ' + d : programOf(cmd) ? `Ran a command (${programOf(cmd)})` : 'Ran a command' };
    return out;
  }
  if (name === 'Skill') { const s = String(input.skill || '').trim(); if (s) { out.skill = s; out.action = { text: 'Loaded skill ' + s }; } return out; }
  if (name === 'Read') {
    const f = resolveIn(path, cwd, String(input.file_path || ''));
    const sk = skillFromPath(f);
    if (sk) { out.skill = sk; out.action = { text: 'Loaded skill ' + sk }; }
    else out.action = { verb: 'Read', file: f };
    return out;
  }
  if (name === 'apply_patch') { patchFiles(String(input.input ?? input.patch ?? ''), cwd, path, out); return out; }
  if (/^mcp__(Claude_Browser|claude-in-chrome)__/.test(name)) { out.action = { text: 'Used the browser' }; return out; }
  if (name in PLAIN) { out.action = PLAIN[name] ? { text: PLAIN[name] } : null; return out; }
  const mcp = /^mcp__(.+?)__(.+)$/.exec(name);
  out.action = { text: mcp ? `Used ${mcp[1].replace(/[_-]+/g, ' ')} (${mcp[2].replace(/_/g, ' ')})` : 'Used ' + name.replace(/_/g, ' ') };
  return out;
}
// the program a shell command runs (its first word, no arguments)
function programOf(cmd) {
  const m = /^\s*(?:&\s*)?["']?([^\s"';|&]+)/.exec(String(cmd || '')); if (!m) return '';
  const p = m[1].split(/[\\/]/).pop().replace(/\.(exe|cmd|bat)$/i, '');
  return /^[\w.+-]{1,24}$/.test(p) ? p : '';
}
// apply_patch: only the file headers are looked at
function patchFiles(patch, cwd, path, out) {
  let added = 0, edited = 0, last = null;
  for (const m of patch.matchAll(/^\*\*\* (Add|Update|Delete) File: (.+)$/gm)) {
    const f = resolveIn(path, cwd, m[2].trim()); if (!f) continue;
    out.files.push(f); last = f; if (m[1] === 'Add') added++; else edited++;
  }
  const n = added + edited;
  out.action = n === 1 ? { verb: added ? 'Created' : 'Edited', file: last } : n ? { text: `Edited ${n} files` } : { text: 'Edited files' };
}
function useTool(st, name, input, at, id) {
  const d = describeTool(name, input, { cwd: st.cwd });
  if (id) st.pending.set(id, { name, at });
  for (const f of d.files) { st.files.add(f); addHint(st, f, at); }
  if (d.skill) st.skills.add(d.skill);
  if (d.hint) st.hints.push({ project: d.hint.project, at });
  else if (/(?:^|__)hub_\w+$/.test(name)) addHint(st, st.cwd, at);   // hub_* without a project: the working folder
  if (d.action) setAction(st, d.action, at);
  if (name === 'TodoWrite' && Array.isArray(input?.todos)) setPlan(st, input.todos, at);
  if (name === 'mcp__ccd_turn__update_plan') applyPlanUpdate(st, input || {}, at);
  if (name === 'update_plan' && Array.isArray(input?.plan)) setPlan(st, input.plan, at);
  if (name === 'mcp__ccd_turn__wrap_up') st.askFlag = !!(input?.blocked || input?.ask);   // the desktop app's end-of-turn card
  if (ASKS.has(name)) st.askFlag = true;
}
const startTurn = (st, at) => { st.turnOpen = true; st.turnStartedAt = at; st.endedAt = null; st.askFlag = false; st.lastQuestion = false; st.interrupted = false; st.pending.clear(); };
const endTurn = (st, at) => { if (st.turnOpen) { st.turnOpen = false; st.endedAt = at; } st.pending.clear(); };

// ---------- Claude Code records (~/.claude/projects/<folder>/<session>.jsonl)
// bookkeeping records that carry nothing we use (and "last-prompt", which carries prompt text): never parsed
const CLAUDE_SKIP = /^\{"type":"(api-request|file-history|last-prompt|cost-state|tools-used|atis-latch|mode|agent-name|relocated|queue-operation|attachment|summary)/;
export function claudeRecord(st, r) {
  const at = ts(r);
  if (r.type === 'custom-title') { if (typeof r.customTitle === 'string' && r.customTitle.trim()) st.title = r.customTitle.trim().slice(0, 120); return; }
  if (r.cwd && typeof r.cwd === 'string') st.cwd = r.cwd;
  if (at) { st.lastAt = Math.max(st.lastAt || 0, at); if (!st.startedAt) st.startedAt = at; }
  if (r.type === 'assistant') {
    const m = r.message || {}, content = Array.isArray(m.content) ? m.content : [];
    st.turnOpen = true;
    for (const b of content) {
      if (b?.type === 'tool_use') useTool(st, String(b.name || ''), b.input, at, b.id);
      else if (b?.type === 'text' && typeof b.text === 'string' && b.text.trim()) st.lastQuestion = endsWithQuestion(b.text.trimEnd());
    }
    if (m.stop_reason === 'end_turn' || m.stop_reason === 'stop_sequence') endTurn(st, at);
    return;
  }
  if (r.type === 'user') {
    const c = r.message?.content;
    if (Array.isArray(c) && c.some(b => b?.type === 'tool_result')) { for (const b of c) if (b?.type === 'tool_result') st.pending.delete(b.tool_use_id); st.turnOpen = true; return; }
    if (r.isMeta || r.isCompactSummary) return;
    const head = (typeof c === 'string' ? c : Array.isArray(c) ? String(c.find(b => b?.type === 'text')?.text || '') : '').slice(0, 40).trimStart();
    if (/^\[Request interrupted/.test(head)) { st.interrupted = true; endTurn(st, at); return; }
    if (/^<(local-command|bash-|command-stdout|command-stderr)/.test(head)) return;   // local output, not a request
    if (r.turnOrigin && r.turnOrigin !== 'human') { st.turnOpen = true; return; }     // the app or a helper agent woke it up
    if (at) startTurn(st, at);
    return;
  }
  if (r.type === 'system' && (r.subtype === 'stop_hook_summary' || r.subtype === 'turn_duration')) endTurn(st, at);
}
const claudePromptLine = /"type":"user","message":\{"role":"user","content":("|\[\{"type":"text")|"name":"(TodoWrite|mcp__ccd_turn__update_plan|Skill)"/;

// ---------- Codex records (~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl)
const parseArgs = a => { if (a && typeof a === 'object') return a; try { return JSON.parse(a || '{}'); } catch { return {}; } };
export function codexRecord(st, r) {
  const at = ts(r), p = r.payload || {};
  if (r.type === 'session_meta') {
    if (p.id) st.id = String(p.id); if (p.cwd) st.cwd = p.cwd;
    const t0 = at || Date.parse(p.timestamp || ''); if (Number.isFinite(t0) && t0) st.startedAt = t0;
    const sub = p.source && typeof p.source === 'object' ? p.source.subagent : null;
    if (sub?.thread_spawn?.parent_thread_id) { st.parent = String(sub.thread_spawn.parent_thread_id); st.nick = String(sub.thread_spawn.agent_nickname || '').slice(0, 40); }
    else if (sub || p.thread_source === 'guardian_review') st.ignore = true;   // Codex's own review helpers
    return;
  }
  if (at) st.lastAt = Math.max(st.lastAt || 0, at);
  if (r.type === 'turn_context') { if (p.cwd) st.cwd = p.cwd; return; }
  if (r.type === 'event_msg') {
    if (p.type === 'task_started') {
      const trig = p.turn_attribution?.turn_trigger;
      if (!trig || trig === 'composer' || trig === 'user') startTurn(st, at); else st.turnOpen = true;
    } else if (p.type === 'user_message') startTurn(st, at);
    else if (p.type === 'task_complete') { if (typeof p.last_agent_message === 'string') st.lastQuestion = endsWithQuestion(p.last_agent_message.trimEnd()); endTurn(st, at); }
    else if (p.type === 'turn_aborted') { st.interrupted = true; endTurn(st, at); }
    return;
  }
  if (r.type !== 'response_item') return;
  if (p.type === 'function_call' || p.type === 'custom_tool_call' || p.type === 'local_shell_call') {
    st.turnOpen = true;
    const name = p.type === 'local_shell_call' ? 'local_shell' : String(p.name || '');
    const id = p.call_id || p.id;
    if (name === 'exec' && typeof (p.input ?? p.arguments) === 'string') return codexExec(st, String(p.input ?? p.arguments), at, id);
    const input = p.type === 'custom_tool_call' ? (name === 'apply_patch' ? { input: p.input } : parseArgs(p.input)) : p.type === 'local_shell_call' ? (p.action || {}) : parseArgs(p.arguments);
    useTool(st, name, input, at, id);
  } else if (/_output$/.test(p.type || '')) { st.pending.delete(p.call_id); }
  else if (p.type === 'message' && p.role === 'assistant') st.turnOpen = true;
}
// Codex Desktop wraps tool calls in a small script (`tools.exec_command({cmd:"…"})`, `tools.apply_patch("*** Begin Patch…")`):
// only the tool names, patch file headers, the program name and skill paths are looked at.
function codexExec(st, code, at, id) {
  const names = [...code.matchAll(/tools\.([A-Za-z_]\w*)\s*\(/g)].map(m => m[1]);
  if (id) st.pending.set(id, { name: names[names.length - 1] || 'exec', at });
  if (/\*\*\* (Add|Update|Delete) File: /.test(code)) {
    const out = { files: [] }; patchFiles(unescapeJs(code), st.cwd, pathDefault, out);
    for (const f of out.files) { st.files.add(f); addHint(st, f, at); }
    setAction(st, out.action, at);
  }
  const sk = skillFromPath((/[^\s"'`]*[\\/]+skills[\\/]+[^\\/\s"'`]+[\\/]+SKILL\.md/i.exec(unescapeJs(code)) || [])[0]);
  if (sk) { st.skills.add(sk); setAction(st, { text: 'Loaded skill ' + sk }, at); return; }
  if (names.includes('apply_patch')) return;
  const last = names.filter(n => n !== 'text').pop();
  if (!last) { setAction(st, { text: 'Ran a script' }, at); return; }
  if (last === 'exec_command' || last === 'write_stdin') {
    const m = /cmd\s*:\s*(["'`])([\s\S]{0,200})/.exec(code);
    const prog = m ? programOf(unescapeJs(m[2])) : '';
    return setAction(st, { text: prog ? `Ran a command (${prog})` : 'Ran a command' }, at);
  }
  if (ASKS.has(last)) st.askFlag = true;
  const d = describeTool(last, {}, { cwd: st.cwd });
  if (d.action) setAction(st, d.action, at);
}
// a JS string literal's escapes, enough to read file headers and paths
const unescapeJs = code => code.replace(/\\(\\|n|"|'|`)/g, (m, c) => c === 'n' ? '\n' : c);
const codexPromptLine = /"type":"event_msg","payload":\{"type":"(task_started|user_message)"|"name":"update_plan"/;

// ---------- what a session looks like now (no text from the transcript beyond titles, plan steps and descriptions)
// The state rule:
//   waiting  – a question / plan-approval tool call is still open, or the turn ended with an explicit ask
//              (wrap_up ask/blocked, a question tool used in the turn) or with a final message ending in "?";
//   working  – the turn is open (no end-of-turn record after the last prompt) and the file was written within 10 min
//              (45 min while a tool call is still open, e.g. a long command), or a helper agent of it is working;
//   idle     – anything else: the turn ended, was interrupted, or nothing was written for too long.
export function stateOf(st, now) {
  const open = [...st.pending.values()];
  if (open.some(t => ASKS.has(t.name))) return 'waiting';
  if (st.turnOpen) {
    const quiet = now - (st.lastAt || 0);
    if (quiet < (open.length ? STALE_TOOL_MS : STALE_MS)) return 'working';
    return 'idle';
  }
  if (!st.interrupted && (st.askFlag || st.lastQuestion)) return 'waiting';
  return 'idle';
}
// which film a path or a hub_* project argument belongs to (deepest film folder wins); also used by the skill usage index
export function filmMatcher(films, { path = pathDefault, key = pathKeyDefault } = {}) {
  const list = (films || []).map(f => ({ f, k: key(f.path) })).sort((a, b) => b.k.length - a.k.length);
  const inFilm = p => { if (!p || !list.length) return null; let k; try { k = key(p); } catch { return null; } return list.find(x => k === x.k || k.startsWith(x.k + path.sep) || k.startsWith(x.k + '/'))?.f || null; };
  const byProject = (v, cwd) => {
    if (path.isAbsolute(v)) return inFilm(v);
    const low = v.toLowerCase();
    return films.find(f => f.id === v) || films.find(f => path.basename(f.path).toLowerCase() === low) || films.find(f => String(f.title || '').toLowerCase() === low)
      || (cwd ? inFilm(path.resolve(cwd, v)) : null);
  };
  const ofHint = (h, cwd) => h.project ? byProject(h.project, cwd) : inFilm(h.path);
  return { inFilm, byProject, ofHint };
}
// film for a session: the most recent hint (edited file / hub_* project) inside a film, else the working folder
export function filmOf(st, films, { path = pathDefault, key = pathKeyDefault } = {}) {
  if (!films?.length) return null;
  const m = filmMatcher(films, { path, key });
  for (let i = st.hints.length - 1; i >= 0; i--) {
    const f = m.ofHint(st.hints[i], st.cwd);
    if (f) return f;
  }
  return m.inFilm(st.cwd);
}
function actionText(a, film, cwd, path) {
  if (!a) return '';
  if (a.text) return a.text;
  if (!a.file) return a.verb === 'Read' ? 'Read a file' : a.verb + ' a file';
  let rel = '';
  for (const base of [film?.path, cwd]) {
    if (!base) continue;
    const r = path.relative(base, a.file);
    if (r && !r.startsWith('..') && !path.isAbsolute(r)) { rel = r.split(path.sep).join('/'); break; }
  }
  return a.verb + ' ' + (rel || path.basename(a.file));
}
// steps, and an estimate of the time left, flagged as one. Only steps completed inside the current turn say anything
// about its pace (steps done in earlier turns, maybe days ago, do not): at least 2 of them, measured from the turn's
// start (or the plan's, when the plan was made during the turn) to the last completion.
function planInfo(st, state, now) {
  if (!st.plan?.length) return { step: null, estimate: null };
  const total = st.plan.length, done = st.plan.filter(s => s.status === 'completed').length;
  const cur = st.plan.find(s => s.status === 'in_progress') || (done < total ? st.plan.find(s => s.status === 'pending') : null);
  const step = { done, total, text: cur ? (cur.status === 'in_progress' && cur.active ? cur.active : cur.text) : '', current: cur ? st.plan.indexOf(cur) + 1 : null, inProgress: cur?.status === 'in_progress' };
  let estimate = null;
  const inTurn = st.turnStartedAt ? st.doneLog.filter(e => e.at >= st.turnStartedAt) : [];
  const count = inTurn.reduce((a, e) => a + e.n, 0);
  if (state === 'working' && count >= 2 && done < total) {
    const from = Math.max(st.turnStartedAt, st.planStartedAt || 0), last = Math.max(...inTurn.map(e => e.at));
    if (last > from) {
      const perStep = (last - from) / count, left = perStep * (total - done) - (now - last);
      estimate = { remainingSec: Math.max(60, Math.round(left / 1000)), at: now, estimate: true, basis: `${count} steps done in ${Math.max(1, Math.round((last - from) / 60e3))} min this turn` };
    }
  }
  return { step, estimate };
}
export function deriveSession(st, { now = Date.now(), films = [], helpers = [], path = pathDefault, key = pathKeyDefault } = {}) {
  let state = stateOf(st, now);
  const working = helpers.filter(h => stateOf(h, now) === 'working');
  if (state !== 'waiting' && working.length) state = 'working';
  const film = filmOf(st, films, { path, key }) || helpers.map(h => filmOf(h, films, { path, key })).find(Boolean) || null;
  // the most recent action of the session or one of its helpers
  let action = st.action, helperAction = false;
  for (const h of helpers) if (h.action && (!action || h.action.at > action.at)) { action = h.action; helperAction = true; }
  const skills = new Set(st.skills), files = new Set(st.files);
  for (const h of helpers) { for (const s of h.skills) skills.add(s); for (const f of h.files) files.add(f); }
  const { step, estimate } = planInfo(st, state, now);
  const last = Math.max(st.lastAt || 0, ...helpers.map(h => h.lastAt || 0)) || null;
  const lastText = actionText(action, film, st.cwd, path);
  const turnStartedAt = st.turnStartedAt || null;
  const end = state === 'working' || state === 'waiting' && st.turnOpen ? now : st.endedAt || last || now;
  return {
    agent: st.agent, agentName: AGENTS[st.agent] || st.agent, id: st.id,
    title: st.title || (st.cwd ? path.basename(st.cwd) : '') || 'Session ' + String(st.id).slice(0, 8),
    cwd: st.cwd || '', film: film ? { id: film.id, title: film.title || path.basename(film.path), latest: film.latest || null, outputs: Array.isArray(film.outputs) ? film.outputs.length : 0 } : null,
    state, step, estimate, steps: st.plan ? st.plan.slice(0, 20).map(s => ({ text: s.status === 'in_progress' && s.active ? s.active : s.text, status: s.status })) : null,
    startedAt: st.startedAt || null, turnStartedAt, elapsedSec: turnStartedAt ? Math.max(0, Math.round((end - turnStartedAt) / 1000)) : null, endedAt: st.turnOpen ? null : st.endedAt,
    lastAction: lastText ? { text: (helperAction ? 'Helper: ' : '') + lastText, at: action.at } : null,
    helpers: working.length, helperTasks: working.map(h => h.nick).filter(Boolean).slice(0, 4),
    skills: [...skills].slice(0, 12), filesChanged: files.size, lastActivityAt: last,
  };
}

// ---------- the reader: files, offsets, polls
export function createActivityReader({ home = osDefault.homedir(), env = process.env, fs = fsDefault, path = pathDefault, key = pathKeyDefault,
  now = () => Date.now(), windowMs = WINDOW_MS, films = () => [], enabled = () => true, budget = POLL_BUDGET, firstRead = FIRST_READ } = {}) {
  const dirs = agentDirs({ home, env, path });
  const files = new Map();       // file → { agent, kind: 'main' | 'helper', session key, offset, size, mtime, state, meta }
  let lastDiscover = 0, polling = null, stats = { bytes: 0, ms: 0, files: 0 }, titles = new Map(), indexOffset = 0;
  const breather = () => new Promise(r => setImmediate(r));

  async function list(dir) { try { return await fs.readdir(dir, { withFileTypes: true }); } catch { return []; } }
  async function statOf(f) { try { return await fs.stat(f); } catch { return null; } }
  const recent = st => st && now() - st.mtimeMs < windowMs;

  // A folder's files are stat'ed in small parallel batches. Every await waits for a turn of the event loop, and other
  // hub work can make each turn slow (after startup the cleanup scan walks %TEMP% in synchronous chunks): ~800 stats
  // one by one took ~18 s there.
  async function statAll(paths) {
    const out = [];
    for (let i = 0; i < paths.length; i += 32) out.push(...await Promise.all(paths.slice(i, i + 32).map(statOf)));
    return out;
  }
  async function discover() {
    const found = [];   // [{ file, agent, kind, sessionKey, mtime, size }]
    // Claude Code: <projects>/<folder>/<session>.jsonl and <projects>/<folder>/<session>/subagents/agent-*.jsonl
    for (const d of await list(dirs.claude)) {
      if (!d.isDirectory()) continue;
      const folder = path.join(dirs.claude, d.name);
      const names = (await list(folder)).filter(e => e.isFile() && e.name.endsWith('.jsonl')).map(e => e.name);
      const sts = await statAll(names.map(n => path.join(folder, n)));
      for (let i = 0; i < names.length; i++) {
        const s = sts[i]; if (!recent(s)) continue;
        const id = names[i].slice(0, -6);
        found.push({ file: path.join(folder, names[i]), agent: 'claude', kind: 'main', sessionKey: 'claude:' + id, id, mtime: s.mtimeMs, size: s.size });
        const sub = path.join(folder, id, 'subagents');
        const subs = (await list(sub)).filter(a => a.isFile() && /^agent-.*\.jsonl$/.test(a.name)).map(a => path.join(sub, a.name));
        const ss = await statAll(subs);
        subs.forEach((af, j) => { const as = ss[j]; if (recent(as)) found.push({ file: af, agent: 'claude', kind: 'helper', sessionKey: 'claude:' + id, id: path.basename(af, '.jsonl'), mtime: as.mtimeMs, size: as.size, metaFile: af.replace(/\.jsonl$/, '.meta.json') }); });
      }
    }
    // Codex: <sessions>/YYYY/MM/DD/rollout-*.jsonl (a resumed session keeps writing to its old day folder)
    for (const y of await list(dirs.codex)) for (const m of y.isDirectory() ? await list(path.join(dirs.codex, y.name)) : []) for (const d of m.isDirectory() ? await list(path.join(dirs.codex, y.name, m.name)) : []) {
      if (!d.isDirectory()) continue;
      const dir = path.join(dirs.codex, y.name, m.name, d.name);
      const rolls = (await list(dir)).filter(e => e.isFile() && /^rollout-.*\.jsonl$/.test(e.name)).map(e => path.join(dir, e.name));
      const sts = await statAll(rolls);
      rolls.forEach((f, i) => { const s = sts[i]; if (recent(s)) found.push({ file: f, agent: 'codex', kind: 'main', sessionKey: null, id: path.basename(f), mtime: s.mtimeMs, size: s.size }); });
    }
    const keep = new Set(found.map(x => x.file));
    for (const f of files.keys()) if (!keep.has(f)) files.delete(f);
    for (const x of found) {
      const cur = files.get(x.file);
      if (cur) { cur.size = x.size; cur.mtime = x.mtime; continue; }
      files.set(x.file, { ...x, offset: null, state: newState(x.agent, x.agent === 'claude' && x.kind === 'main' ? x.id : x.id), meta: null });
    }
    lastDiscover = now();
  }

  async function readRange(f, from, to) {
    const fh = await fs.open(f, 'r');
    try { const buf = Buffer.alloc(Math.max(0, to - from)); const { bytesRead } = await fh.read(buf, 0, buf.length, from); return buf.subarray(0, bytesRead); }
    finally { await fh.close(); }
  }
  // complete lines in [from, to): a partial last line waits for the next read
  function lines(buf, skipFirst) {
    const start = skipFirst ? buf.indexOf(10) + 1 : 0;
    if (skipFirst && !start) return { list: [], used: 0, start: 0 };
    const end = buf.lastIndexOf(10);
    if (end < start) return { list: [], used: start, start };
    return { list: buf.subarray(start, end).toString('utf8').split('\n'), used: end + 1, start };
  }
  const feed = (x, line) => {
    if (!line || line.length < 2) return;
    if (x.agent === 'claude' && CLAUDE_SKIP.test(line)) return;
    let r; try { r = JSON.parse(line); } catch { return; }
    if (x.agent === 'claude') claudeRecord(x.state, r); else codexRecord(x.state, r);
  };
  // Codex: the first record names the session (id, folder, parent); it can be long (instructions), so read until its newline
  async function codexMeta(x) {
    let to = Math.min(x.size, 256 << 10);
    for (;;) {
      const buf = await readRange(x.file, 0, to), nl = buf.indexOf(10);
      if (nl >= 0) { feed(x, buf.subarray(0, nl).toString('utf8')); stats.bytes += buf.length; return nl + 1; }
      if (to >= x.size || to >= 4 << 20) { stats.bytes += buf.length; return to; }
      to = Math.min(x.size, to * 4);
    }
  }
  // the turn started before the tail we read: look backwards (once) for its start, the plan and skills
  async function backScan(x, tailFrom) {
    const re = x.agent === 'claude' ? claudePromptLine : codexPromptLine;
    const isStart = x.agent === 'claude' ? l => /"type":"user","message":\{"role":"user","content":("|\[\{"type":"text")/.test(l) && !/"isMeta":true/.test(l) && !/"turnOrigin":"(?!human)/.test(l)
      : l => /"payload":\{"type":"(task_started|user_message)"/.test(l) && !/"turn_trigger":"(?!composer|user)/.test(l);
    const keep = []; let pos = tailFrom, carry = Buffer.alloc(0), read = 0;
    while (pos > 0 && read < BACK_SCAN) {
      const from = Math.max(0, pos - (1 << 20)), chunk = await readRange(x.file, from, pos); read += chunk.length; stats.bytes += chunk.length;
      // a line cut by the chunk start is carried over to the next (earlier) chunk
      const buf = Buffer.concat([chunk, carry]), nl = from > 0 ? buf.indexOf(10) : -1;
      carry = from === 0 ? Buffer.alloc(0) : nl >= 0 ? buf.subarray(0, nl) : buf;
      const parts = from === 0 ? buf.toString('utf8').split('\n') : nl >= 0 ? buf.subarray(nl + 1).toString('utf8').split('\n') : [];
      let found = false;
      for (let i = parts.length - 1; i >= 0; i--) {
        const l = parts[i]; if (!re.test(l)) continue;
        keep.push(l); if (isStart(l)) { found = true; break; }
      }
      pos = from; if (found) break;
      await breather();
    }
    for (let i = keep.length - 1; i >= 0; i--) feed(x, keep[i]);
  }

  async function readFile(x, left) {
    const s = await statOf(x.file); if (!s) return 0;
    x.size = s.size; x.mtime = s.mtimeMs;
    let used = 0;
    if (x.offset == null || s.size < x.offset || s.size - x.offset > CATCH_UP) {
      // first sight (or truncated / far behind): only the tail
      let head = 0;
      if (x.agent === 'codex' && x.offset == null) head = await codexMeta(x);
      if (x.state.ignore) { x.offset = s.size; return 0; }
      const from = Math.max(head, s.size - firstRead);
      const buf = await readRange(x.file, from, s.size); used += buf.length;
      const { list: ls, used: u, start } = lines(buf, from > head);
      const first = x.offset == null;
      x.offset = from + u;
      // the session's start: its first record's time (only the head is read, once)
      if (first && from > head && !x.state.startedAt) {
        const hb = await readRange(x.file, 0, Math.min(s.size, 64 << 10)); used += hb.length;
        const m = /"timestamp":"([^"]{10,40})"/.exec(hb.toString('utf8')); const t = m ? Date.parse(m[1]) : NaN;
        if (Number.isFinite(t)) x.state.startedAt = t;
      }
      if (first && x.kind === 'main' && from > head) {
        const startRe = x.agent === 'claude' ? /"type":"user","message":\{"role":"user","content":("|\[\{"type":"text")/ : /"payload":\{"type":"(task_started|user_message)"/;
        if (!ls.some(l => startRe.test(l))) await backScan(x, from + start);
      }
      for (let i = 0; i < ls.length; i++) { feed(x, ls[i]); if (i % 500 === 499) await breather(); }
      return used;
    }
    if (x.state.ignore || s.size === x.offset) return 0;
    const to = Math.min(s.size, x.offset + Math.max(64 << 10, left));
    const buf = await readRange(x.file, x.offset, to); used += buf.length;
    const { list: ls, used: u } = lines(buf, false);
    x.offset += u;
    for (let i = 0; i < ls.length; i++) { feed(x, ls[i]); if (i % 500 === 499) await breather(); }
    return used;
  }
  async function readHelperMeta(x) {
    if (!x.metaFile || x.meta?.finished) return;
    try { const j = JSON.parse(await fs.readFile(x.metaFile, 'utf8')); x.meta = { finished: !!j.finished }; if (typeof j.description === 'string') x.state.nick = j.description.slice(0, 80); } catch { }
  }
  // Codex thread names (renamed threads append a newer line)
  async function readCodexTitles() {
    const s = await statOf(dirs.codexIndex); if (!s) return;
    if (s.size < indexOffset) { indexOffset = 0; titles = new Map(); }
    if (s.size === indexOffset) return;
    const from = Math.max(indexOffset, s.size - (4 << 20)), buf = await readRange(dirs.codexIndex, from, s.size); stats.bytes += buf.length;
    const { list: ls, used } = lines(buf, from > indexOffset && from > 0);
    indexOffset = from + used;
    for (const l of ls) { try { const r = JSON.parse(l); if (r.id && typeof r.thread_name === 'string') titles.set(String(r.id), r.thread_name.slice(0, 120)); } catch { } }
  }

  async function pollOnce() {
    const t0 = performance.now(); stats = { bytes: 0, ms: 0, files: 0 };
    if (!enabled()) { files.clear(); titles = new Map(); indexOffset = 0; lastDiscover = 0; return; }
    if (!lastDiscover || now() - lastDiscover >= DISCOVER_MS) await discover();
    let left = budget, n = 0;
    // newest first, so a busy poll reads the sessions that matter
    for (const x of [...files.values()].sort((a, b) => b.mtime - a.mtime)) {
      if (left <= 0 || n >= MAX_FILES_PER_POLL) break;
      if (x.offset != null && x.offset === x.size) { const s = await statOf(x.file); if (!s || s.size === x.offset) continue; }
      // the budget counts every byte read for this file (tail, Codex header, the one-off backwards search)
      const b0 = stats.bytes; stats.bytes += await readFile(x, left); left -= stats.bytes - b0; n++;
      if (x.kind === 'helper') await readHelperMeta(x);
      await breather();
    }
    if ([...files.values()].some(x => x.agent === 'codex')) await readCodexTitles();
    stats.files = n; stats.ms = Math.round(performance.now() - t0);
  }
  // one poll at a time; a second caller waits for the running one
  function poll() { if (!polling) polling = pollOnce().finally(() => { polling = null; }); return polling; }

  function sessions() {
    const t = now(), filmList = films() || [];
    const main = new Map(), helpers = new Map();
    for (const x of files.values()) {
      if (x.state.ignore || x.offset == null) continue;
      if (x.agent === 'claude') {
        if (x.kind === 'main') main.set(x.sessionKey, x);
        else { if (x.meta?.finished) x.state.turnOpen = false; (helpers.get(x.sessionKey) || helpers.set(x.sessionKey, []).get(x.sessionKey)).push(x.state); }
      } else if (x.state.parent) (helpers.get('codex:' + x.state.parent) || helpers.set('codex:' + x.state.parent, []).get('codex:' + x.state.parent)).push(x.state);
      else main.set('codex:' + x.state.id, x);
    }
    const out = [];
    for (const [k, x] of main) {
      if (x.agent === 'codex' && !x.state.title && titles.has(x.state.id)) x.state.title = titles.get(x.state.id);
      out.push(deriveSession(x.state, { now: t, films: filmList, helpers: helpers.get(k) || [], path, key }));
    }
    // a file can be touched without new work (bookkeeping records): only sessions with real activity in the window
    return out.filter(s => s.lastActivityAt && t - s.lastActivityAt < windowMs).sort((a, b) => (b.lastActivityAt || 0) - (a.lastActivityAt || 0));
  }
  return { poll, sessions, stats: () => stats, dirs, files };
}
