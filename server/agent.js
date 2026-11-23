// [REASONIX PATCH] Agent providers for VideoHub.
//
// The original app assumes Claude Code (or OpenCode) is the agent: VideoHub writes the notes, the agent reads them
// through the `videohub` MCP server, and "Send to agent" only copies a message to the clipboard. This module adds two
// providers that work without Claude Code:
//
//   reasonix : run the Reasonix CLI (`reasonix run ...`, the desktop app's engine, also called `r`) in the project
//              folder. It can read and write files, so it really applies the notes.
//   deepseek : call the DeepSeek API directly (OpenAI-compatible chat). It answers in the UI; it cannot write files.
//
// Everything is opt-in through Settings -> Agent provider. The default is still `claude`, so an untouched install
// behaves exactly as before. The code lives in this new file; the existing files only carry small, marked call sites.
import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { config, saveConfig, AGENT_KEY_MASK, AGENT_PROVIDERS, DEFAULT_AGENT } from './config.js';
import { APPDATA, DATA_DIR, HOME, readJson, writeJson, now } from './util.js';
import { project } from './scan.js';
import { list as listNotes, prompt as notePrompt, update as updateNote } from './notes.js';
import * as rollback from './rollback.js';
import { killTree } from './platform.js';

const RUNS_FILE = path.join(DATA_DIR, 'agent-runs.json');
const RUN_LOG_DIR = path.join(DATA_DIR, 'agent-runs');
const runs = readJson(RUNS_FILE, []);
const children = new Map();          // run id -> child process (for cancel)
const listeners = new Set();
export const onAgent = fn => { listeners.add(fn); return () => listeners.delete(fn); };
const emit = ev => { for (const fn of listeners) try { fn(ev); } catch { } };
const save = () => {
  const kept = runs.slice(-50);
  writeJson(RUNS_FILE, kept);
  // [VH FIX] do not let agent logs accumulate: keep only the logs of the 50 runs that are still listed.
  const keep = new Set(kept.map(r => r.log).filter(Boolean));
  try {
    for (const f of fs.readdirSync(RUN_LOG_DIR)) {
      const full = path.join(RUN_LOG_DIR, f);
      if (!keep.has(full)) { try { fs.unlinkSync(full); } catch { } }
    }
  } catch { }
};

// [VH FIX] Reconcile agent runs persisted by an earlier VideoHub process. Their child process and close
// handler are gone, so a stale 'running' record would keep every LIVE/RUNNING indicator on forever.
let bootReconciled = false;
for (const r of runs) {
  if (r.state === 'running' || r.state === 'queued') {
    r.state = 'failed';
    r.error = 'VideoHub restarted; this run is no longer active.';
    r.finishedAt = r.finishedAt || now();
    bootReconciled = true;
  }
}
if (bootReconciled) save();

export const providerLabel = p => p === 'reasonix' ? 'Reasonix' : p === 'deepseek' ? 'DeepSeek' : 'Claude';

// The configuration the browser may see: never the API key itself, only whether one is saved.
export function publicAgent(a = config().agent) {
  const agent = { ...DEFAULT_AGENT(), ...(a || {}) };
  return { ...agent, deepseekApiKey: '', deepseekApiKeySet: !!agent.deepseekApiKey, keyMask: AGENT_KEY_MASK, providers: AGENT_PROVIDERS };
}

// ---------- Reasonix CLI discovery
const CLI_NAMES = process.platform === 'win32' ? ['reasonix.exe', 'reasonix.cmd', 'r.exe', 'r.cmd', 'reasonix', 'r'] : ['reasonix', 'r'];

function versionOf(exe) {
  try {
    const r = spawnSync(exe, ['--version'], { encoding: 'utf8', timeout: 8000, windowsHide: true });
    const text = String(r.stdout || r.stderr || '').trim();
    return text.split(/\r?\n/)[0] || null;
  } catch { return null; }
}

function npxReasonix() {
  const bases = [
    process.env.npm_config_cache && path.join(process.env.npm_config_cache, '_npx'),
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'npm-cache', '_npx'),
  ].filter(Boolean);
  for (const base of bases) {
    let dirs = [];
    try { dirs = fs.readdirSync(base); } catch { continue; }
    for (const d of dirs) {
      const win = path.join(base, d, 'node_modules', '@reasonix', 'cli-win32-x64', 'bin', 'reasonix.exe');
      if (fs.existsSync(win)) return win;
      const bin = path.join(base, d, 'node_modules', '.bin', process.platform === 'win32' ? 'reasonix.cmd' : 'reasonix');
      if (fs.existsSync(bin)) return bin;
    }
  }
  return null;
}

export function detectReasonix() {
  const found = [], seen = new Set();
  const add = (p, from) => {
    if (!p || typeof p !== 'string') return;
    let real = p;
    try { real = fs.realpathSync(p); } catch { }
    if (!fs.existsSync(real) || !fs.statSync(real).isFile() || seen.has(real.toLowerCase())) return;
    seen.add(real.toLowerCase()); found.push({ path: real, from });
  };
  add(config().agent.reasonixPath, 'Settings');
  add(process.env.REASONIX_EXE, 'REASONIX_EXE');
  for (const dir of String(process.env.PATH || '').split(path.delimiter)) {
    if (!dir) continue;
    for (const name of CLI_NAMES) if (fs.existsSync(path.join(dir, name))) { add(path.join(dir, name), 'PATH'); break; }
  }
  add(npxReasonix(), 'npx cache');
  const first = found[0];
  return {
    ok: !!first,
    path: first?.path || null,
    from: first?.from || null,
    version: first ? versionOf(first.path) : null,
    candidates: found,
    why: first ? null : 'Reasonix CLI not found. Install it, or set the full path in Settings (the app that runs `reasonix` / `r`).',
  };
}

// ---------- prompt and project context
const mmss = t => {
  if (!Number.isFinite(t)) return '?';
  const m = Math.floor(t / 60), s = t - m * 60;
  return `${m}:${s.toFixed(2).padStart(5, '0')}`;
};

export function buildPrompt(p, notes = []) {
  const lines = notes.map(n => {
    const at = `#${n.id} at ${mmss(n.t)}${n.t2 != null ? '–' + mmss(n.t2) : ''}${n.frame != null ? ` (frame ${n.frame})` : ''}`;
    const pics = n.images ? Object.values(n.images).filter(Boolean) : [];
    return `${at} [${n.kind || 'visual'}${n.layer ? ' · ' + n.layer : ''}] ${n.text || ''}${pics.length ? `\n  annotated picture: ${pics.join(', ')}` : ''}`;
  });
  const code = projectHasCode(p);
  return [
    notePrompt(p),
    'Notes:',
    lines.length ? lines.join('\n') : '(no open notes)',
    '',
    code
      ? 'Work in the project folder. Read the code, make the smallest changes that answer every note, and keep the film\'s contract (window.renderOut(t), window.READY, render.js). Do not render; the user renders in VideoHub when they are ready. Finish with a short summary of what changed and which note ids you fixed.'
      : 'This project has no film code (no render.js/index.html): its current video is a finished MP4. It can still be reviewed and re-encoded by VideoHub, but visual changes need a new film or an ffmpeg edit. Say clearly what can and cannot be fixed, and give exact ffmpeg commands for what can. Do not overwrite the source video.',
  ].join('\n');
}

function projectHasCode(p) {
  return ['render.js', 'render.mjs', 'index.html', 'film.js', 'scene.js'].some(f => fs.existsSync(path.join(p.path, f)));
}

// A small, bounded snapshot of the film's code for a chat-only provider.
export function projectContext(p, maxBytes = 60000) {
  const names = ['render.js', 'render.mjs', 'index.html', 'film.js', 'scene.js', 'package.json', '.videohub/project.json'];
  const parts = [];
  let used = 0;
  for (const name of names) {
    const file = path.join(p.path, name);
    let text;
    try { text = fs.readFileSync(file, 'utf8'); } catch { continue; }
    if (used + text.length > maxBytes) text = text.slice(0, Math.max(0, maxBytes - used)) + '\n… (cut)';
    parts.push(`--- ${name} ---\n${text}`);
    used += text.length;
    if (used >= maxBytes) break;
  }
  return parts.join('\n\n') || '(no code files in the project folder)';
}

// ---------- Reasonix CLI run
function spawnCli(exe, args, opts) {
  // .cmd/.bat are CMD wrappers on Windows and need a shell; a real .exe is spawned directly.
  const shell = process.platform === 'win32' && /\.(cmd|bat)$/i.test(exe);
  return spawn(exe, args, { ...opts, windowsHide: true, ...(shell ? { shell: true } : {}) });
}

export function startReasonix(p, notes) {
  const det = detectReasonix();
  if (!det.ok) throw Object.assign(new Error(det.why), { code: 400 });
  const a = config().agent;
  const id = 'a' + Date.now().toString(36) + '-' + randomUUID().slice(0, 8);
  const dir = path.join(DATA_DIR, 'agent-runs');
  fs.mkdirSync(dir, { recursive: true });
  const log = path.join(dir, id + '.log');
  const prompt = buildPrompt(p, notes);
  const args = ['run', '--dir', p.path, '--permission-mode', 'auto', '--max-steps', String(a.reasonixMaxSteps || 80), '--output-format', 'text'];
  if (a.reasonixModel) args.push('--model', a.reasonixModel);
  args.push(prompt);
  const env = { ...process.env };
  // The key the user pasted in VideoHub powers the Reasonix CLI too (its own .env is used otherwise).
  if (a.deepseekApiKey) env.DEEPSEEK_API_KEY = a.deepseekApiKey;
  const run = {
    id, provider: 'reasonix', project: p.id, projectName: p.title || p.name, path: p.path,
    state: 'running', startedAt: now(), log, notes: notes.map(n => n.id), pid: null, output: '',
  };
  const stream = fs.createWriteStream(log, { flags: 'a' });
  stream.write(`\n# ${now()}  ${det.path} ${args.map(x => /[\s"]/.test(x) ? JSON.stringify(x) : x).join(' ')}\n`);
  // Mandatory: the exact pre-edit bytes must be recoverable before anything can write. No snapshot, no edit.
  let pre = null;
  try {
    pre = rollback.snapshot(p, { kind: 'before', runId: id, noteIds: notes.map(n => n.id), prompt: notes.map(n => `#${n.id} ${n.text}`).join('\n\n'), label: `before ${id}` });
    stream.write(`# rollback: pre-edit snapshot ${pre.id} sha256 ${pre.sha256}\n`);
  } catch (e) {
    stream.end();
    throw Object.assign(new Error('Could not snapshot the project before the edit; the agent was not started: ' + e.message), { code: 500 });
  }
  let child;
  try { child = spawnCli(det.path, args, { cwd: p.path, env }); }
  catch (e) { stream.end(); throw Object.assign(new Error('Could not start Reasonix: ' + e.message), { code: 500 }); }
  run.pid = child.pid || null;
  children.set(id, child);
  runs.push(run); save(); emit({ type: 'started', run: pubRun(run) });
  const onData = d => {
    stream.write(d);
    run.output = (run.output + String(d)).slice(-8000);
  };
  child.stdout?.on('data', onData);
  child.stderr?.on('data', onData);
  child.on('error', e => {
    run.state = 'failed'; run.error = e.message; run.finishedAt = now(); run.exitCode = null;
    stream.write(`\n# spawn error: ${e.message}\n`); stream.end(); children.delete(id); save(); emit({ type: 'failed', run: pubRun(run) });
  });
  child.on('close', code => {
    if (run.state !== 'cancelled') { run.state = code === 0 ? 'done' : 'failed'; run.error = code === 0 ? null : `Reasonix ended with code ${code} (log: ${log})`; }
    run.exitCode = code; run.finishedAt = now();
    try {
      const post = rollback.snapshot(p, { kind: 'after', runId: id, noteIds: notes.map(n => n.id), prompt: notes.map(n => `#${n.id} ${n.text}`).join('\n\n'), label: `after ${id}` });
      stream.write(`# rollback: post-edit snapshot ${post.id} sha256 ${post.sha256}\n`);
    } catch (e) { stream.write(`# rollback: post-edit snapshot FAILED: ${e.message}\n`); }
    stream.write(`\n# ${now()}  exit ${code}\n`); stream.end(); children.delete(id); save(); emit({ type: run.state === 'done' ? 'done' : run.state === 'cancelled' ? 'cancelled' : 'failed', run: pubRun(run) });
  });
  return run;
}

export function cancelRun(id) {
  const run = runs.find(r => r.id === id);
  if (!run || !['running', 'queued'].includes(run.state)) return false;
  const child = children.get(id);
  if (child?.pid) killTree(child.pid).catch(() => { try { child.kill(); } catch { } });
  else if (run.pid) killTree(run.pid).catch(() => { });
  run.state = 'cancelled'; run.finishedAt = now(); save(); emit({ type: 'cancelled', run: pubRun(run) });
  return true;
}

const pubRun = (r, cache = null) => {
  let noteDetails = [];
  try {
    let ns = cache?.notes.get(r.path);
    if (!ns) { ns = listNotes({ path: r.path }); cache?.notes.set(r.path, ns); }
    noteDetails = (r.notes || []).map(id => { const n = ns.find(x => x.id === +id); return { id: +id, text: n?.text || '' }; });
  } catch { }
  let version = null;
  try {
    let ss = cache?.snaps.get(r.path);
    if (!ss) { ss = rollback.list({ path: r.path }); cache?.snaps.set(r.path, ss); }
    version = ss.filter(s => s.runId === r.id && s.kind === 'after').slice(-1)[0]
      || ss.filter(s => s.runId === r.id && s.kind === 'before').slice(-1)[0] || null;
  } catch { }
  return { ...r, output: (r.output || '').slice(-4000), noteDetails, version };
};
function reconcileRuns() {
  let changed = false;
  for (const r of runs) {
    if ((r.state === 'running' || r.state === 'queued') && !children.has(r.id)) {
      r.state = 'failed';
      r.error = 'The agent process is not running; state reconciled.';
      r.finishedAt = r.finishedAt || now();
      changed = true;
    }
  }
  if (changed) save();
}
export const listRuns = () => { reconcileRuns(); const cache = { notes: new Map(), snaps: new Map() }; return runs.slice().reverse().map(r => pubRun(r, cache)); };

// ---------- DeepSeek API
function deepseekKey(a = config().agent) { return a.deepseekApiKey || process.env.DEEPSEEK_API_KEY || ''; }
function deepseekBase(a = config().agent) { return (a.deepseekBaseUrl || 'https://api.deepseek.com').replace(/\/+$/, ''); }

export async function testDeepSeek(a = config().agent) {
  const key = deepseekKey(a);
  if (!key) throw Object.assign(new Error('No DeepSeek API key saved. Paste one or import Reasonix\'s key first.'), { code: 400 });
  const res = await fetch(deepseekBase(a) + '/models', { headers: { Authorization: 'Bearer ' + key }, signal: AbortSignal.timeout(15000) });
  const text = await res.text().catch(() => '');
  if (!res.ok) throw Object.assign(new Error(`DeepSeek answered ${res.status}: ${text.slice(0, 300)}`), { code: 502 });
  let models = [];
  try { const j = JSON.parse(text); models = (j.data || []).map(m => m.id).filter(Boolean); } catch { }
  return { ok: true, base: deepseekBase(a), model: a.deepseekModel, models: models.slice(0, 20) };
}

export function importDeepSeekKey() {
  const files = [
    path.join(APPDATA, 'reasonix', '.env'),
    path.join(HOME, '.reasonix', '.env'),
    path.join(HOME, '.config', 'reasonix', '.env'),
  ];
  for (const file of files) {
    let text = '';
    try { text = fs.readFileSync(file, 'utf8'); } catch { continue; }
    const m = text.match(/^\s*(?:export\s+)?DEEPSEEK_API_KEY\s*=\s*(.+?)\s*$/m);
    if (!m) continue;
    const key = m[1].replace(/^['"]|['"]$/g, '').trim();
    if (!key) continue;
    saveConfig({ agent: { deepseekApiKey: key } });
    return { ok: true, file };
  }
  throw Object.assign(new Error('No DEEPSEEK_API_KEY found in Reasonix\'s .env (looked in ' + files.join(', ') + ').'), { code: 404 });
}

export async function askDeepSeek(p, notes) {
  const a = config().agent, key = deepseekKey(a);
  if (!key) throw Object.assign(new Error('No DeepSeek API key saved. Paste one or import Reasonix\'s key in Settings → Agent provider.'), { code: 400 });
  const system = [
    'You are the coding assistant behind VideoHub, a local review studio for videos written as code.',
    'You receive review notes the user left on frames, plus the project\'s code. Answer concretely: say which file and which lines to change, or give exact ffmpeg commands when the project is a finished video with no code.',
    'You cannot edit files yourself in this mode. Never claim you changed something. Keep the answer focused and short enough to act on.',
  ].join(' ');
  const user = buildPrompt(p, notes) + '\n\nProject files:\n\n' + projectContext(p);
  const res = await fetch(deepseekBase(a) + '/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
    body: JSON.stringify({ model: a.deepseekModel, messages: [{ role: 'system', content: system }, { role: 'user', content: user }], temperature: 0.2, max_tokens: 4000, stream: false }),
    signal: AbortSignal.timeout(180000),
  });
  const text = await res.text().catch(() => '');
  if (!res.ok) throw Object.assign(new Error(`DeepSeek answered ${res.status}: ${text.slice(0, 300)}`), { code: 502 });
  let j = {};
  try { j = JSON.parse(text); } catch { }
  const answer = j.choices?.[0]?.message?.content;
  if (!answer) throw Object.assign(new Error('DeepSeek returned no answer: ' + text.slice(0, 300)), { code: 502 });
  return { text: answer, model: j.model || a.deepseekModel, usage: j.usage || null };
}

// ---------- dispatch: what "Send to <agent>" does for the saved provider
export function dispatch(p, { provider, notes } = {}) {
  const chosen = AGENT_PROVIDERS.includes(provider) ? provider : config().agent.provider;
  if (!notes?.length) throw Object.assign(new Error('No open notes to send. Write a note on a frame first.'), { code: 400 });
  if (chosen === 'claude') return { kind: 'clipboard', provider: chosen, text: notePrompt(p) };
  if (chosen === 'reasonix') return { kind: 'run', provider: chosen, run: pubRun(startReasonix(p, notes)) };
  return { kind: 'deepseek', provider: chosen };   // the route awaits askDeepSeek (JSON is not serializable mid-flight)
}

// ---------- routes
export function routes(route, readBody) {
  const need = id => { const p = project(id); if (!p) throw Object.assign(new Error('Project not found'), { code: 404 }); return p; };
  route('GET', '/api/agent', () => ({ config: publicAgent(), reasonix: detectReasonix(), runs: listRuns() }));
  route('POST', '/api/agent/detect', () => detectReasonix());
  route('POST', '/api/agent/test', async req => {
    const b = await readBody(req), a = { ...config().agent, ...(b.agent || {}) };
    if (a.provider === 'reasonix') {
      const d = detectReasonix();
      if (!d.ok) throw Object.assign(new Error(d.why), { code: 400 });
      return { ok: true, provider: 'reasonix', path: d.path, version: d.version };
    }
    return testDeepSeek(a);
  });
  route('POST', '/api/agent/import-key', () => importDeepSeekKey());
  route('POST', '/api/project/:id/agent', async (req, url, { id }) => {
    const p = need(id), b = await readBody(req);
    const notes = b.ids?.length ? listNotes(p).filter(n => b.ids.includes(n.id)) : listNotes(p).filter(n => ['open', 'reopened'].includes(n.status));
    const d = dispatch(p, { provider: b.provider, notes });
    if (d.kind === 'deepseek') {
      const started = Date.now();
      const answer = await askDeepSeek(p, notes);
      return { ...d, ...answer, tookMs: Date.now() - started, noteCount: notes.length };
    }
    return { ...d, noteCount: notes.length };
  });
  route('GET', '/api/agent/runs', () => listRuns());
  route('POST', '/api/project/:id/rollback/version', async (req, url, { id }) => {
    const p = need(id), b = await readBody(req);
    const snapshot = String(b.snapshot || '');
    if (!snapshot) throw Object.assign(new Error('snapshot is required'), { code: 400 });
    const m = rollback.load(p, snapshot);
    const guard = rollback.snapshot(p, { kind: 'pre-version', noteIds: m.noteIds || [], prompt: 'before revert to ' + snapshot, label: 'before revert to ' + snapshot });
    const r = rollback.restore(p, snapshot);
    return { ...r, guard: guard.id, version: snapshot };
  });
  route('GET', '/api/project/:id/rollback/last', (req, url, { id }) => {
    const p = need(id), noteId = Number(url.searchParams.get('note'));
    return { ...rollback.status(p, noteId), snapshots: rollback.list(p).slice(-20) };
  });
  route('POST', '/api/project/:id/rollback', async (req, url, { id }) => {
    const p = need(id), b = await readBody(req), noteId = Number(b.noteId);
    if (!Number.isFinite(noteId)) throw Object.assign(new Error('noteId is required'), { code: 400 });
    const snap = rollback.lastForNote(p, noteId);
    if (!snap) throw Object.assign(new Error('No pre-edit snapshot was recorded for this note.'), { code: 400 });
    // The undo is itself reversible: keep the bytes we are about to leave behind.
    const guard = rollback.snapshot(p, { kind: 'pre-undo', noteIds: [noteId], label: 'before undo/reedit of ' + snap.id, prompt: String(b.text || '') });
    const restored = rollback.restore(p, snap.id);
    const patch = { status: 'open' };
    if (b.reedit && typeof b.text === 'string') patch.text = b.text;
    const note = updateNote(p, noteId, patch, 'user') || null;
    // The undo is one edit round, not one note: reopen every note in the snapshot.
    for (const nid of [...new Set(snap.noteIds || [])]) if (nid !== noteId) updateNote(p, nid, { status: 'open' }, 'user');
    return { ...restored, guard: guard.id, snapshot: snap, note, reedit: !!b.reedit };
  });
  route('GET', '/api/agent/runs/:id', (req, url, { id }) => {
    const r = runs.find(x => x.id === id);
    if (!r) throw Object.assign(new Error('Agent run not found'), { code: 404 });
    return pubRun(r);
  });
  route('POST', '/api/agent/runs/:id/cancel', (req, url, { id }) => ({ ok: cancelRun(id) }));
}
