// The tools agents use (through mcp.js, or `node server/cli.js <tool> '<json>'` without MCP).
// They talk to the hub over http://127.0.0.1:7788 and start it when it is not running.
// Status inputs accept the English values and, as aliases, the Turkish words older versions used.
import { z } from 'zod';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { HUB_DIR, DATA_DIR, readJson } from './util.js';
import { summaryText } from './finish.js';
import { NOTE_STATUSES, NOTE_STATUS_ALIASES, PROJECT_STATUSES, PROJECT_STATUS_ALIASES, noteStatus, projectStatus, isOpenNote, normalizeNote } from '../ui/values.js';

// renders and versions made through these tools are labelled "Claude"; the tools never look at which chat called them
const BY_AGENT = { title: (readJson(path.join(DATA_DIR, 'config.json'), {}) || {}).agentName || 'Claude' };
const PORT = +process.env.VIDEOHUB_PORT || (readJson(path.join(DATA_DIR, 'config.json'), {}) || {}).port || 7788;   // env: talk to a test hub
const BASE = `http://127.0.0.1:${PORT}`;

async function ping() { try { const r = await fetch(BASE + '/api/ping', { signal: AbortSignal.timeout(1500) }); return r.ok; } catch { return false; } }
async function ensureHub() {
  if (await ping()) return;
  const child = spawn(process.execPath, [path.join(HUB_DIR, 'server', 'hub.js')], { cwd: HUB_DIR, detached: true, stdio: 'ignore', windowsHide: true });
  child.unref();
  for (let i = 0; i < 40; i++) { await new Promise(r => setTimeout(r, 500)); if (await ping()) return; }
  throw new Error('Could not start the VideoHub server (' + BASE + ').');
}
async function call(method, p, body, timeoutMs = 120e3, signal = null) {
  await ensureHub();
  const r = await fetch(BASE + p, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined, signal: signal ? AbortSignal.any([AbortSignal.timeout(timeoutMs), signal]) : AbortSignal.timeout(timeoutMs) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || r.statusText);
  return j;
}

// which agent runs these tools (mcp.js tells after the MCP handshake; the CLI leaves it empty)
let CLIENT = null;
export function setClient(info) { CLIENT = info && typeof info.name === 'string' ? info : null; }
const clientKind = (c = CLIENT) => !c ? 'cli' : /claude/i.test(c.name) ? 'claude' : /codex/i.test(c.name) ? 'codex' : /opencode/i.test(c.name) ? 'opencode' : 'other';
const CLIENT_LABEL = { claude: 'Claude Code', codex: 'Codex', opencode: 'OpenCode' };

// How long one hub_wait call may block (docs/AGENT-WAIT.md has the measurements). The client stops a tool call at its
// own limit, so the wait ends well before it: Claude Code has no practical limit unless MCP_TOOL_TIMEOUT (ms) is set;
// Codex stops at tool_timeout_sec (documented 60 s; our [mcp_servers.videohub] entry sets 600); OpenCode documents a
// 12-hour mcp.timeout.execution (not measured); unknown clients get a short safe default; the CLI stays under an agent
// shell's usual 2-minute command limit.
export const WAIT_CAP = 540;
export function codexToolTimeout(env = process.env) {
  try {
    const home = env.CODEX_HOME || path.join(env.USERPROFILE || env.HOME || os.homedir(), '.codex');   // Codex passes MCP servers a filtered environment
    const text = fs.readFileSync(path.join(home, 'config.toml'), 'utf8');
    const m = /^\s*\[mcp_servers\.(?:videohub|"videohub")\][^\n]*\n([\s\S]*?)(?=^\s*\[|$(?![\s\S]))/m.exec(text);
    const t = m && /^\s*tool_timeout_sec\s*=\s*([\d.]+)/m.exec(m[1]);
    return t ? +t[1] : null;
  } catch { return null; }
}
export function waitDefault(kind = clientKind(), env = process.env, codexLimit = () => codexToolTimeout(env)) {
  const under = limitSec => Math.max(20, Math.min(WAIT_CAP, Math.floor(limitSec - Math.max(10, limitSec * 0.1))));
  if (kind === 'claude') return +env.MCP_TOOL_TIMEOUT > 0 ? under(+env.MCP_TOOL_TIMEOUT / 1000) : WAIT_CAP;
  if (kind === 'codex') return under(codexLimit() || 60);
  if (kind === 'opencode') return WAIT_CAP;
  if (kind === 'cli') return 100;
  return 45;
}

const TC = s => { const m = Math.floor(s / 60), r = s - m * 60; return `${m}:${r.toFixed(2).padStart(5, '0')}`; };
const GB = b => b >= 1073741824 ? (b / 1073741824).toFixed(1) + ' GB' : Math.round(b / 1048576) + ' MB';
async function resolve(projectArg) {
  const q = projectArg || process.cwd();
  const p = await call('GET', '/api/find?q=' + encodeURIComponent(q));
  if (Array.isArray(p.notes)) p.notes.forEach(normalizeNote);
  return p;
}
const clock = iso => { const d = new Date(iso); return Number.isFinite(+d) ? d.toTimeString().slice(0, 5) : ''; };
// one note as the agent reads it: time, frames, chunks, text, narration and the paths of its pictures
function noteLines(notes) {
  const lines = [];
  for (const n of notes) {
    const fr = n.frames || (n.t2 != null && n.fps ? [Math.floor(n.t * n.fps + 1e-6), Math.floor(n.t2 * n.fps + 1e-6)] : null);
    lines.push(`#${n.id} [${n.status === 'reopened' ? 'STILL THERE (the previous fix did not work)' : n.status}] ${TC(n.t)}${n.t2 != null ? '–' + TC(n.t2) : ''}  ${fr ? `RANGE frames ${fr[0]}–${fr[1]}${n.frame != null && n.frame !== fr[0] ? ` (drawing on frame ${n.frame})` : ''}` : `frame ${n.frame ?? '?'}`}${n.chunks ? `  chunks ${n.chunks.join(',')}` : ''}  ${n.kind}${n.layer ? '  layer: ' + n.layer : ''}  ${n.file === '~live' ? 'LIVE PREVIEW (no render — fix the code, do not render)' : 'file: ' + (n.file || '?')}${n.sentAt ? `  (sent with the button at ${clock(n.sentAt)})` : ''}`);
    if (n.text) lines.push(`   "${n.text}"`);
    if (n.say) lines.push(`   narration at that moment: «${n.say}»`);
    if (n.images?.crop) lines.push(`   close-up: ${n.images.crop}`);
    if (n.images?.annotated) lines.push(`   full frame + drawing: ${n.images.annotated}`);
    else if (n.images?.frame) lines.push(`   frame: ${n.images.frame}`);
    if (n.images?.start) lines.push(`   first frame of the range: ${n.images.start}`);
    if (n.images?.end) lines.push(`   last frame of the range: ${n.images.end}`);
    if (n.reply) lines.push(`   your previous reply: ${n.reply}`);
  }
  return lines;
}
function noteAdvice(notes) {
  const out = [], liveN = notes.filter(n => n.file === '~live').length;
  if (liveN) out.push('', `LIVE PREVIEW notes (${liveN}): fix the code, do NOT render — the user's open preview reloads itself when the code changes and shows the fix at once. Then for each note hub_note_update(status:"fixed", reply:"what you did, 1 sentence"). The user asks for the render at the end.`);
  if (liveN < notes.length) out.push('', 'Notes on a rendered video: after fixing, mark each with hub_note_update(status:"fixed", reply:"what you did, 1 sentence"). Render only when the user asks; then hub_render({mode:"partial", notes:[...]}) re-renders just those chunks. Do not re-review the whole film yourself — the user checks the changed ranges in VideoHub.');
  return out;
}
// what hub_wait got from the hub, as text the agent can act on
export function inboxText(p, items) {
  const lines = [`From the user in VideoHub ("${p.title}", ${p.path}):`], notes = [];
  for (const it of items) {
    if (it.type === 'notes') { lines.push('', `${it.notes.length} note${it.notes.length === 1 ? '' : 's'} sent with "Send to agent":`, ...noteLines(it.notes)); notes.push(...it.notes); }
    else if (it.type === 'scene-note') { lines.push('', `A note on scene ${it.n} "${it.title}" (plan v${it.v}); the scene is now "change requested":`, ...noteLines(it.notes)); notes.push(...it.notes); }
    else if (it.type === 'answer') lines.push('', `Answer to your question ${it.q} ("${it.question}"): ${it.label != null ? `"${it.label}"` : '(no option picked)'}${it.text ? ` — in their words: "${it.text}"` : ''}${it.changed ? ' (they changed an earlier answer)' : ''}`);
    else if (it.type === 'plan-approved') lines.push('', `The user APPROVED plan v${it.v} (${it.scenes} scene${it.scenes === 1 ? '' : 's'}, ${TC(it.seconds || 0)}). Build it now; mark built scenes with hub_plan({built:[…]}) and show the film with hub_live.`);
    else if (it.type === 'scene-approved') lines.push('', `The user approved scene ${it.n} "${it.title}" (plan v${it.v}). Leave it as it is.`);
  }
  if (notes.length) lines.push(...noteAdvice(notes));
  lines.push('', 'When you have acted on all of this, call hub_wait again (do not end your turn while the user is reviewing in VideoHub). Render only when the user asks.');
  return lines.join('\n');
}
const FAM = { A: 'chunked (partial re-renders available)', B: 'worker parts', C: 'segments', studio: '3D studio scene', otomasyon: 'text-to-video pipeline', snipp: 'Snipp', media: 'video folder', code: 'code (no chunked render script)', other: 'other' };
const isOpen = n => isOpenNote({ status: noteStatus(n.status) });

export const TOOLS = {
  hub_live: {
    description: 'Open the film in VideoHub\'s live preview WITHOUT RENDERING: it plays straight from its code, the user watches and leaves notes, and the preview reloads itself when the code changes. Call this as soon as a new film (or a big change) plays, BEFORE any render; then stop and wait for the user\'s notes. Render only when the user asks. If the page lacks window.renderOut(t) + window.READY, it says why.',
    schema: {
      project: z.string().optional().describe('Project folder, name or id. Default: the working folder.'),
      open: z.boolean().optional().describe('false = only check, do not open a window'),
    },
    run: async a => {
      const p = await resolve(a.project);
      const li = await call('GET', `/api/project/${p.id}/live`);   // also starts watching the code for changes
      if (!li.ok) return `The live preview could not open: ${li.reason}\nWhat it needs (docs/PROJECT-CONTRACT.md): the page defines window.renderOut(t), which draws second t synchronously on fixed-size canvases, and sets window.READY = true when ready; the sound in audio/mix.wav. Anything different goes in .videohub/project.json → live: {page, audio, dur, fps}.`;
      let how = 'none';
      if (a.open !== false) how = (await call('POST', '/api/show', { hash: `#/review/${p.id}/~live` })).how;
      return [
        `Live preview ready: "${p.title}" · ${li.page} · ${li.fps} fps · ${TC(li.dur)} (length from: ${li.durFrom}) · sound: ${li.audioName || 'none'}`,
        how === 'window' ? 'The open VideoHub window switched to this film.' : how === 'opened' ? 'A VideoHub window opened.' : '',
        'Do not render. Tell the user in one sentence (in their language): watch it in VideoHub, leave notes on the frames and press "Send to agent". Then call hub_wait instead of ending your turn: it returns their notes, answers and approvals. Fix the code (the preview reloads itself), mark each note with hub_note_update, call hub_wait again. Render with hub_render only when the user asks for a render. (If the user pastes a "VideoHub: N notes" message into the chat instead, get them with hub_notes.)',
        li.durFrom === 'default' ? 'The film length is unknown (60 s assumed): save it with hub_project({set:{render:{env:{DUR:"…"}}}}).' : '',
      ].filter(Boolean).join('\n');
    },
  },
  hub_workspace: {
    description: 'Where this PC keeps its video work: the workspace folder and, inside it, the films folder (make every new film there, one folder per film), the outputs folder (finished renders are collected there by VideoHub; never write there yourself) and the other watched folders. Call it before creating a new film.',
    schema: {},
    run: async () => {
      const c = await call('GET', '/api/config');
      const roots = (c.roots || []).filter(r => r.enabled !== false);
      const films = (roots.find(r => r.type === 'container') || {}).path;
      return [
        `Workspace: ${c.workspace}`,
        films ? `New films go in: ${films}\\<film-name>  (one folder per film; copy templates\\new-film from the VideoHub folder)` : 'No films folder is set: ask the user to add one in VideoHub > Settings > Folders.',
        `Finished renders are collected in: ${c.outputsDir}  (VideoHub links every render there by day; do not write there)`,
        `Sounds: ${c.soundLibDir}  ·  Archive: ${c.archiveDir}`,
        roots.length > 1 ? 'Other watched folders: ' + roots.filter(r => r.path !== films).map(r => `${r.path} (${r.type})`).join(', ') : '',
        'Keep each film self-contained in its own folder (code, audio, render/); never put one film\'s files into another film\'s folder.',
      ].filter(Boolean).join('\n');
    },
  },
  hub_project: {
    description: 'Find this project in VideoHub (project folder, name or id). Gives its status, versions, open notes and render recipe (DUR, chunk length). `set` saves title / status / render recipe; render.mux is an ffmpeg argument array with {video} and {out} placeholders.',
    schema: {
      project: z.string().optional().describe('Project folder, name or id. Default: the working folder.'),
      set: z.object({ title: z.string().optional(), status: z.enum([...PROJECT_STATUSES, ...PROJECT_STATUS_ALIASES]).optional().describe('in-progress | review | revision | approved | published | archived | done'), render: z.object({ script: z.string().optional(), workers: z.number().optional(), env: z.record(z.string(), z.string()).optional(), mux: z.array(z.string()).optional() }).optional() }).optional(),
    },
    run: async a => {
      let p = await resolve(a.project);
      if (a.set) { const set = { ...a.set }; if (set.status) set.status = projectStatus(set.status); await call('POST', `/api/project/${p.id}/meta`, set); p = await resolve(p.id); }
      const rc = await call('GET', `/api/project/${p.id}/recipe`).catch(() => null);
      const vs = (p.versionsLog || []).slice(-5);
      const open = (p.notes || []).filter(isOpen);
      return [
        `Project: ${p.title} (id ${p.id})  ·  ${p.path}`,
        `Kind: ${FAM[p.family] || p.family}  ·  status: ${projectStatus(p.status)}${p.statusAuto ? ' (automatic)' : ''}`,
        rc ? `Render: ${rc.script || 'make.mjs'}, ${rc.fps} fps${rc.chunkSec ? `, ${rc.chunkSec} s chunks (${rc.chunks ?? '?'} chunks)` : ''}${rc.env?.DUR ? `, DUR=${rc.env.DUR}${rc.durInferred ? ' (worked out from the chunks)' : ''}` : ''}${rc.mux ? ', own sound recipe (render.mux)' : ', sound: the previous final\'s track, else the film\'s own audio file'}` : '',
        `Latest video: ${p.latest || '—'}  ·  folder ${GB(p.sizes?.total || 0)}`,
        vs.length ? 'Latest versions: ' + vs.map(v => `v${v.v} ${v.file}${v.changedRanges ? ` (changed: ${v.changedRanges.map(([x, y]) => TC(x) + '–' + TC(y)).join(', ')})` : ''}`).join(' | ') : '',
        `Notes: ${open.length} open / ${(p.notes || []).length} total${open.length ? ' → get them with hub_notes' : ''}`,
      ].filter(Boolean).join('\n');
    },
  },

  hub_notes: {
    description: 'The notes the user left on frames in VideoHub\'s review: time, frame, the render chunks it touches, text, and the paths of the annotated pictures. Open the pictures with Read (the crop first, the annotated frame if needed). Default: open + reopened notes; they are marked "claude" (taken).',
    schema: {
      project: z.string().optional(),
      status: z.enum(['all', ...NOTE_STATUSES, ...NOTE_STATUS_ALIASES]).optional().describe('open = open + reopened (default)'),
      take: z.boolean().optional().describe('Mark the returned open notes "claude" (default true)'),
    },
    run: async a => {
      const p = await resolve(a.project);
      const st = a.status ? (a.status === 'all' ? 'all' : noteStatus(a.status)) : 'open';
      const notes = (p.notes || []).filter(n => st === 'all' || (st === 'open' ? isOpen(n) : n.status === st)).sort((x, y) => x.t - y.t);
      if (!notes.length) return `No ${st === 'open' ? 'open ' : ''}notes on "${p.title}".`;
      if (a.take !== false) for (const n of notes) if (isOpen(n)) await call('POST', `/api/project/${p.id}/note/${n.id}`, { status: 'claude', by: 'claude' });
      const sent = notes.filter(n => n.sentAt && isOpen(n)).length;
      const lines = [`"${p.title}" (${p.path}) — ${notes.length} note${notes.length === 1 ? '' : 's'}${sent ? ` (${sent} sent to you with VideoHub's "Send to agent" button)` : ''}:`];
      lines.push(...noteLines(notes), ...noteAdvice(notes));
      return lines.join('\n');
    },
  },

  hub_plan: {
    description: 'ONLY when the user asks to see or approve a plan before you build (never on your own initiative; by default just build): write the film\'s plan as scene cards. VideoHub shows it on the film\'s Plan tab, where the user approves the plan, approves scenes or leaves a note on a scene. Each call with `scenes` saves a new plan version (earlier ones are kept) and resets the approvals. After writing it, call hub_wait and build once the plan is approved. Later, `built` (scene numbers, no `scenes`) marks scenes as built so the user can watch and approve them.',
    schema: {
      project: z.string().optional().describe('Project folder, name or id. Default: the working folder.'),
      summary: z.string().optional().describe('One or two sentences: what the film is and how it looks'),
      scenes: z.array(z.object({ title: z.string(), seconds: z.number().describe('Length of the scene in seconds'), narration: z.string().describe('What is said (or shown, when there is no voice) in this scene'), note: z.string().optional().describe('Optional: how it will look, open choices') })).optional().describe('All scenes in order (a new plan version)'),
      built: z.array(z.number()).optional().describe('Scene numbers (1 = first) that are built and can be watched in the live preview'),
      open: z.boolean().optional().describe('false = do not switch the VideoHub window to the Plan tab'),
    },
    run: async a => {
      const p = await resolve(a.project);
      if (!a.scenes?.length && !a.built?.length) throw new Error('Give scenes (a new plan) or built (scene numbers that are built).');
      const r = await call('POST', `/api/project/${p.id}/plan`, a.scenes?.length ? { summary: a.summary, scenes: a.scenes } : { built: a.built });
      const total = r.scenes.reduce((s, x) => s + x.seconds, 0);
      if (!a.scenes?.length) {
        const ready = r.scenes.filter(x => x.state === 'ready').map(x => x.n), ok = r.scenes.filter(x => x.state === 'approved').map(x => x.n);
        return `Plan v${r.v}: scenes ${a.built.join(', ')} marked as built.${ready.length ? ` Ready for the user to check: ${ready.join(', ')}.` : ''}${ok.length ? ` Approved: ${ok.join(', ')}.` : ''} Show the film with hub_live if it is not open, then call hub_wait.`;
      }
      let how = 'none';
      if (a.open !== false) how = (await call('POST', '/api/show', { hash: `#/plan/${p.id}` }).catch(() => ({}))).how || 'none';
      return [
        `Plan v${r.v} saved for "${p.title}": ${r.scenes.length} scene${r.scenes.length === 1 ? '' : 's'}, ${TC(total)}.${how === 'window' ? ' The open VideoHub window shows it on the Plan tab.' : how === 'opened' ? ' A VideoHub window opened on the Plan tab.' : ''}`,
        'Tell the user in one sentence (in their language) that the plan is on the film\'s Plan tab in VideoHub, then call hub_wait. Build only after the plan is approved; if notes on scenes come back, change the plan with hub_plan (a new version) and wait again.',
      ].join('\n');
    },
  },

  hub_ask: {
    description: 'Ask the user a question in VideoHub instead of in the chat, for choices that are easier to answer by looking or clicking (a look, a colour, which of two takes, yes / no). It shows as a card in the agent drawer with clickable options (an option may carry a picture from the film folder) and room for a short answer. Returns the question id at once; the answer comes back through hub_wait.',
    schema: {
      project: z.string().optional().describe('Project folder, name or id. Default: the working folder.'),
      question: z.string().describe('The question, short and plain'),
      options: z.array(z.object({ label: z.string(), detail: z.string().optional().describe('One short line under the label'), image: z.string().optional().describe('A picture for this option: a .png/.jpg/.webp path inside the film folder (relative to it, or absolute)') })).optional().describe('2 to 8 choices; leave out for a free-text question'),
      recommended: z.string().optional().describe('The label of the option you recommend (or its number, 1 = first)'),
    },
    run: async a => {
      const p = await resolve(a.project);
      const q = await call('POST', `/api/project/${p.id}/questions`, { question: a.question, options: a.options || [], recommended: a.recommended });
      return `Question ${q.id} is shown in VideoHub (agent drawer of "${p.title}")${q.options.length ? ` with ${q.options.length} options${q.options.some(o => o.image) ? ' (with pictures)' : ''}` : ''}. Do not ask it again in the chat: call hub_wait to get the answer.`;
    },
  },

  hub_wait: {
    description: 'Wait for the user in VideoHub instead of ending your turn: returns as soon as they send notes ("Send to agent"), answer a question (hub_ask), approve the plan or a scene, or leave a note on a scene (hub_plan) — with note ids, timecodes and frame-picture paths, like hub_notes. Each thing comes back once. If nothing comes within `seconds`, it says so: then call it again. Use it after hub_live, hub_plan and hub_ask, and after fixing notes.',
    schema: {
      project: z.string().optional().describe('Project folder, name or id. Default: the working folder.'),
      seconds: z.number().optional().describe('How long to wait at most (default: safely under this agent\'s tool time limit)'),
    },
    run: async (a, extra = {}) => {
      const p = await resolve(a.project);
      const kind = clientKind(), total = Math.max(5, Math.min(WAIT_CAP, +a.seconds || waitDefault(kind)));
      const end = Date.now() + total * 1000, agent = CLIENT_LABEL[kind] || BY_AGENT.title;
      const tok = extra._meta?.progressToken;
      let ticks = 0;
      const progress = tok != null && extra.sendNotification ? setInterval(() => {
        extra.sendNotification({ method: 'notifications/progress', params: { progressToken: tok, progress: ++ticks, message: 'Waiting for the user in VideoHub…' } }).catch(() => { });
      }, 20e3) : null;
      try {
        // one HTTP long-poll at most 100 s (fetch gives up on a response without headers after 300 s), as many as fit
        while (Date.now() < end - 1000) {
          if (extra.signal?.aborted) return 'Cancelled.';
          const secs = Math.max(1, Math.min(100, Math.round((end - Date.now()) / 1000)));
          const r = await call('GET', `/api/project/${p.id}/wait?seconds=${secs}&agent=${encodeURIComponent(agent)}`, null, (secs + 30) * 1000, extra.signal || null);
          if (r.items?.length) return inboxText(p, r.items);
        }
        return 'Nothing from the user yet; call hub_wait again.';
      } finally { if (progress) clearInterval(progress); }
    },
  },

  hub_note_update: {
    description: 'Save a note\'s status and a short reply (the user sees it in VideoHub). After fixing: status "fixed" + reply.',
    schema: { project: z.string().optional(), id: z.number(), status: z.enum(['claude', 'fixed', 'open', ...NOTE_STATUS_ALIASES]).optional(), reply: z.string().optional() },
    run: async a => { const p = await resolve(a.project); const n = await call('POST', `/api/project/${p.id}/note/${a.id}`, { status: a.status ? noteStatus(a.status) : undefined, reply: a.reply, by: 'claude' }); return `#${n.id} → ${n.status}${n.reply ? ' · ' + n.reply : ''}`; },
  },

  hub_render: {
    description: 'Put a render in VideoHub\'s queue (one render at a time on this computer; CPU/RAM protection on when the agent is installed). Only when the user asked for a render. mode "partial": only the chunks the notes/seconds/chunks touch are rendered again, the film is joined, the previous final\'s sound is put back, and a new version (…_vN.mp4) is saved with the changed ranges. "full": the whole film. "preview": PREVIEW=1 (projects that support it). "command": your own command (cmd) + output file; the user has to approve it in VideoHub before it runs. wait=true waits until it ends (at most ~9 min). Options: workers (parallel workers / Chrome copies for 3D), env.FPS (if the script reads FPS, full only), env.CODEC (3D: x264|nvenc|amf); what a project supports: GET /api/project/<id>/render-options.',
    schema: {
      project: z.string().optional(),
      mode: z.enum(['partial', 'full', 'preview', 'command']).optional(),
      notes: z.array(z.number()).optional().describe('Note numbers (partial)'),
      seconds: z.array(z.tuple([z.number(), z.number()])).optional().describe('[[start,end]] in seconds (partial)'),
      chunks: z.array(z.number()).optional().describe('Chunk numbers (partial)'),
      env: z.record(z.string(), z.string()).optional(),
      copyTo: z.string().optional().describe('Also copy the result into this folder when done (full path); the original stays in the project'),
      workers: z.number().optional(),
      cmd: z.string().optional().describe('mode command: the command line (runs in the project folder)'),
      output: z.string().optional().describe('mode command: the video it makes (relative to the project folder)'),
      note: z.string().optional().describe('Version description'),
      wait: z.boolean().optional(),
    },
    run: async a => {
      const p = await resolve(a.project);
      const j = await call('POST', '/api/jobs', { project: p.id, mode: a.mode || 'partial', notes: a.notes, seconds: a.seconds, chunks: a.chunks, env: a.env, workers: a.workers, cmd: a.cmd, output: a.output, note: a.note, copyTo: a.copyTo, session: BY_AGENT });
      const head = `Job ${j.id} queued (position ${j.position}) · ${j.mode}${j.chunks ? ` · ${j.chunks.length} chunk${j.chunks.length === 1 ? '' : 's'} (${j.chunks.join(',')}) = ${j.changedRanges.map(([x, y]) => TC(x) + '–' + TC(y)).join(', ')}` : ''}` +
        (j.ramNote ? `\n${j.ramNote} → Tell the user this in one sentence; never close the program yourself.` : '');
      if (j.needsApproval) return head + '\nThis is a custom command, so it does NOT run until the user approves it in VideoHub (Renders page: it shows the command with Approve / Cancel). Tell the user that now, in one sentence, then check with hub_job({id:"' + j.id + '", wait:true}).';
      if (!a.wait) return head + '\nWait with hub_job({id:"' + j.id + '", wait:true}).';
      return head + '\n' + await TOOLS.hub_job.run({ id: j.id, wait: true });
    },
  },

  hub_job: {
    description: 'The state of a render job. wait=true waits until it ends (at most ~9 min); call again if it has not ended.',
    schema: { id: z.string(), wait: z.boolean().optional() },
    run: async a => {
      const j = await call('GET', `/api/jobs/${a.id}` + (a.wait ? '?wait=540' : ''), null, 600e3);
      const parts = [`Job ${j.id}: ${j.state}${j.state === 'running' ? ` ${Math.round((j.progress || 0) * 100)}%` : ''}${j.state === 'queued' && j.waiting ? ` (waiting: ${j.waiting})` : ''}`];
      if (j.output) parts.push(`Output: ${j.output} (v${j.version})${j.changedRanges ? ` · changed: ${j.changedRanges.map(([x, y]) => TC(x) + '–' + TC(y)).join(', ')}` : ''}${j.durationSec ? ` · took ${j.durationSec} s` : ''}`);
      if (j.ramNote && j.state !== 'done') parts.push(j.ramNote);
      if (j.error) parts.push('Error: ' + j.error);
      if (j.log) parts.push('Log: ' + j.log);
      if (j.state === 'done') parts.push('The user checks the new version in VideoHub with "Watch only the changes"; do not re-review the whole film.');
      if (j.state === 'done' && j.outputPath) parts.push(`Full path: ${j.outputPath}${j.copiedTo ? ` (copy: ${j.copiedTo})` : ''}${j.linkedTo ? `\nIn the outputs folder: ${j.linkedTo}` : ''}\nIt is listed in VideoHub > Renders > "Recent renders" (▶ Watch / 📂 Show in folder); no need to show the video in the chat, the path is enough.`);
      return parts.join('\n');
    },
  },

  hub_register_version: {
    description: 'Register a video made outside VideoHub\'s queue as this project\'s new version (with the seconds that changed).',
    schema: { project: z.string().optional(), file: z.string(), note: z.string().optional(), changedRanges: z.array(z.tuple([z.number(), z.number()])).optional(), notes: z.array(z.number()).optional(), kind: z.enum(['final', 'preview']).optional() },
    run: async a => { const p = await resolve(a.project); const r = await call('POST', `/api/project/${p.id}/version`, { ...a, session: BY_AGENT }); return `Registered: v${r.v} ${r.file}`; },
  },

  hub_finish: {
    description: 'When a film is finished: what "Finish film" would tidy in its folder (render leftovers, copies of the newest video, check pictures and test folders to the Recycle Bin; older versions to the archive; stems, node_modules and image sequences only if the user ticks them). dryRun (default) returns the list as text. dryRun:false opens the Finish film dialog in VideoHub for the user to review and confirm; it never removes anything itself.',
    schema: { project: z.string().optional().describe('Project folder, name or id. Default: the working folder.'), dryRun: z.boolean().optional().describe('true (default): only the list. false: open the dialog in VideoHub; the user decides.') },
    run: async a => {
      const p = await resolve(a.project);
      const c = await call('GET', `/api/project/${p.id}/finish?fresh=1`, null, 300e3);
      const text = summaryText(p.title || p.name, c, GB);
      if (a.dryRun !== false || c.refused) return text + (c.refused ? '' : '\n\nNothing was moved. To tidy, call hub_finish({dryRun:false}): it opens the dialog in VideoHub, where the user reviews and confirms.');
      const how = (await call('POST', '/api/show', { hash: `#/files/${p.id}/finish` }).catch(() => ({}))).how || 'none';
      return text + `\n\n${how === 'none' ? 'Open VideoHub: the film’s Files tab has a "Finish film…" button.' : 'The Finish film dialog is open in VideoHub.'} Nothing was moved: the user reviews the list there and presses "Finish and tidy". Tell them that in one sentence (in their language); never delete these files yourself.`;
    },
  },

  hub_cleanup: {
    description: 'List the files of this project that can safely be removed (a list only; the user decides on VideoHub\'s Disk page).',
    schema: { project: z.string().optional() },
    run: async a => {
      const p = await resolve(a.project); const d = await call('GET', `/api/project/${p.id}`);
      if (!d.cleanup.length) return 'Nothing to clean up.';
      return [`"${p.title}" — ${GB(d.cleanup.reduce((s, c) => s + c.size, 0))} can be cleaned up:`, ...d.cleanup.map(c => `- ${GB(c.size)} ${c.path} — ${c.reason}`), 'Tell the user to approve it on VideoHub\'s Disk page (Recycle Bin / archive). Never delete these yourself.'].join('\n');
    },
  },
};
