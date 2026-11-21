// Which skills were used, when and in which films: a background index of the agents' transcripts, built
// incrementally and never on a request path.
//   Claude Code  ~/.claude/projects/<folder>/<session>.jsonl (+ <session>/subagents/agent-*.jsonl): Skill tool calls
//                (input.skill) and reads of a skills/<name>/SKILL.md file (server/activity.js describeTool).
//   Codex        ~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl: a skills/<name>/SKILL.md path inside a tool call.
// A use belongs to a film by the session's edited paths around it (the first one after the use, else the last one
// before it) or its working folder, matched against the scan as activity.js does.
//
// Cost: each transcript is read once from a remembered byte offset (data/skill-usage.json); a chunk is searched for a
// few byte patterns and only the lines that contain one are decoded and parsed, so most of the gigabytes are never
// turned into strings. Chunks are small, the reader sleeps between them and waits while a render runs.
// Privacy: only skill names, times, the working folder and edited folders are kept; never prompt text or contents.
import fspDefault from 'node:fs/promises';
import pathDefault from 'node:path';
import osDefault from 'node:os';
import { agentDirs, describeTool, filmMatcher } from './activity.js';
import { bareName } from './skills.js';
import { pathKey as pathKeyDefault } from './platform.js';

const VERSION = 1;
const CHUNK = 2 << 20;                 // bytes read at a time
const LINE_MAX = 48 << 20;             // a longer line (a huge tool result) is skipped
const HINTS_MAX = 400, USES_MAX = 60;  // per session file: edited folders kept, times kept per skill
const B = s => Buffer.from(s);
const CLAUDE_PAT = ['"name":"Skill"', 'SKILL.md', '"name":"Edit"', '"name":"Write"', '"name":"MultiEdit"', '"name":"NotebookEdit"', '__hub_'].map(B);
const CODEX_PAT = ['SKILL.md', '*** Add File: ', '*** Update File: ', '*** Delete File: '].map(B);
const CWD = B('"cwd":"');
// a skills/<name>/SKILL.md path (any number of escaped slashes; up to 3 folders between "skills" and the skill)
const SKILL_PATH = /(?:^|[\\/\s"'`=(])skills[\\/]+(?:[^\\/\s"'`]+[\\/]+){0,3}?([^\\/\s"'`]+)[\\/]+SKILL\.md/gi;
export function skillsInText(s) { const out = new Set(); for (const m of String(s).matchAll(SKILL_PATH)) if (!/^\.+$/.test(m[1])) out.add(m[1]); return [...out]; }
const ts = r => { const t = Date.parse(r?.timestamp || ''); return Number.isFinite(t) ? t : null; };
const cwdIn = line => { const m = /"cwd":"((?:[^"\\]|\\.){1,1000})"/.exec(line); if (!m) return null; try { return JSON.parse('"' + m[1] + '"'); } catch { return null; } };

export function createSkillUsage({ home = osDefault.homedir(), env = process.env, fs = fspDefault, path = pathDefault, key = pathKeyDefault, file = null,
  enabled = () => true, busy = () => false, busyWaitMs = 2000, now = () => Date.now(), pauseMs = 4, chunk = CHUNK, onDone = null } = {}) {
  const dirs = agentDirs({ home, env, path });
  let index = { v: VERSION, files: {} }, running = null, stats = { ready: false, runs: 0, lastRun: null };
  let version = 0;   // bumps when the index changes (aggregations are cached against it)
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  // read once; every caller (the Skills page, a run) waits for the same read
  let loading = null;
  function load() { return loading || (loading = loadOnce()); }
  async function loadOnce() {
    if (!file) return;
    try { const j = JSON.parse(await fs.readFile(file, 'utf8')); if (j?.v === VERSION && j.files && typeof j.files === 'object') { index = j; stats.ready = !!j.complete; } } catch { }
  }
  async function save() {
    if (!file) return;
    const tmp = file + '.' + process.pid + '.tmp';
    try { await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(tmp, JSON.stringify(index)); await fs.rename(tmp, file); } catch { try { await fs.unlink(tmp); } catch { } }
  }
  async function list(dir) { try { return await fs.readdir(dir, { withFileTypes: true }); } catch { return []; } }
  async function statOf(f) { try { return await fs.stat(f); } catch { return null; } }
  async function discover() {
    const out = [];
    for (const d of await list(dirs.claude)) {
      if (!d.isDirectory()) continue;
      const folder = path.join(dirs.claude, d.name);
      for (const e of await list(folder)) {
        if (e.isFile() && e.name.endsWith('.jsonl')) out.push({ file: path.join(folder, e.name), agent: 'claude' });
        else if (e.isDirectory()) {
          // helper agents: <session>/subagents/agent-*.jsonl and <session>/subagents/workflows/<run>/agent-*.jsonl
          const sub = path.join(folder, e.name, 'subagents');
          for (const a of await list(sub)) {
            if (a.isFile() && /^agent-.*\.jsonl$/.test(a.name)) out.push({ file: path.join(sub, a.name), agent: 'claude' });
            else if (a.isDirectory() && a.name === 'workflows') for (const w of await list(path.join(sub, a.name))) if (w.isDirectory()) for (const f of await list(path.join(sub, a.name, w.name))) if (f.isFile() && /^agent-.*\.jsonl$/.test(f.name)) out.push({ file: path.join(sub, a.name, w.name, f.name), agent: 'claude' });
          }
        }
      }
    }
    for (const y of await list(dirs.codex)) if (y.isDirectory()) for (const m of await list(path.join(dirs.codex, y.name))) if (m.isDirectory()) for (const d of await list(path.join(dirs.codex, y.name, m.name))) {
      if (!d.isDirectory()) continue;
      const dir = path.join(dirs.codex, y.name, m.name, d.name);
      for (const e of await list(dir)) if (e.isFile() && /^rollout-.*\.jsonl$/.test(e.name)) out.push({ file: path.join(dir, e.name), agent: 'codex' });
    }
    return out;
  }

  const addHint = (x, h) => {
    const last = x.hints[x.hints.length - 1];
    if (last && last[0] === h[0]) return;
    x.hints.push(h); if (x.hints.length > HINTS_MAX) x.hints.splice(0, x.hints.length - HINTS_MAX);
  };
  const addUse = (x, name, at) => {
    const n = bareName(name); if (!n || n.length > 120 || !at) return;
    const list = x.uses[n] || (x.uses[n] = []);
    if (list[list.length - 1] === at) return;
    list.push(at); if (list.length > USES_MAX) list.splice(0, list.length - USES_MAX);
  };
  function claudeLine(x, line) {
    let r; try { r = JSON.parse(line); } catch { return; }
    if (typeof r.cwd === 'string' && r.cwd) x.cwd = r.cwd;
    if (r.type !== 'assistant') return;
    const at = ts(r), content = Array.isArray(r.message?.content) ? r.message.content : [];
    for (const b of content) {
      if (b?.type !== 'tool_use') continue;
      const d = describeTool(String(b.name || ''), b.input, { cwd: x.cwd, path });
      if (d.skill) addUse(x, d.skill, at);
      for (const f of d.files) addHint(x, [path.dirname(f), at]);
      if (d.hint?.project) addHint(x, ['@' + d.hint.project, at]);
    }
  }
  function codexLine(x, line) {
    let r; try { r = JSON.parse(line); } catch { return; }
    if (r.type !== 'response_item') return;
    const p = r.payload || {};
    if (!['function_call', 'custom_tool_call', 'local_shell_call'].includes(p.type)) return;   // never the tools' output
    const at = ts(r);
    for (const n of skillsInText(line)) addUse(x, n, at);
    for (const m of line.matchAll(/\*\*\* (?:Add|Update|Delete) File: (.+?)(?=\\\\n|\\n|\\"|"|$)/g)) {
      const f = m[1].replace(/\\\\/g, '\\').trim(); if (!f) continue;
      let abs = null; try { abs = path.isAbsolute(f) ? path.resolve(f) : x.cwd ? path.resolve(x.cwd, f) : null; } catch { }
      if (abs) addHint(x, [path.dirname(abs), at]);
    }
  }
  // the lines of buf[0, end) that contain one of the patterns, in order (each once)
  function matchedLines(buf, end, pats) {
    const starts = new Set();
    for (const pat of pats) {
      let i = buf.indexOf(pat);
      while (i >= 0 && i < end) {
        starts.add(buf.lastIndexOf(10, i) + 1);
        const e = buf.indexOf(10, i); if (e < 0 || e >= end) break;
        i = buf.indexOf(pat, e + 1);   // the rest of this line is already selected
      }
    }
    return [...starts].sort((a, b) => a - b).map(s => { let e = buf.indexOf(10, s); if (e < 0 || e > end) e = end; return [s, e]; });
  }
  let pause = pauseMs;   // a slow background run sleeps longer between chunks
  async function readFile(x, size) {
    const fh = await fs.open(x.file, 'r');
    let carry = Buffer.alloc(0), skipping = false, bytes = 0;
    try {
      let pos = x.offset;
      while (pos < size) {
        while (busy()) await sleep(busyWaitMs);   // a render runs: wait
        const len = Math.min(chunk, size - pos), b = Buffer.alloc(len);
        const { bytesRead } = await fh.read(b, 0, len, pos);
        if (!bytesRead) break;
        pos += bytesRead; bytes += bytesRead;
        let buf = carry.length ? Buffer.concat([carry, b.subarray(0, bytesRead)]) : b.subarray(0, bytesRead);
        if (skipping) { const nl = buf.indexOf(10); if (nl < 0) { carry = Buffer.alloc(0); continue; } buf = buf.subarray(nl + 1); skipping = false; }
        const last = buf.lastIndexOf(10);
        if (last < 0) { if (buf.length > LINE_MAX) { carry = Buffer.alloc(0); skipping = true; } else carry = buf; continue; }
        const end = last;   // complete lines: [0, end)
        if (!x.cwd) { const i = buf.indexOf(CWD); if (i >= 0 && i < end) { const s = buf.lastIndexOf(10, i) + 1; const c = cwdIn(buf.subarray(s, Math.min(end, i + 4096)).toString('utf8')); if (c) x.cwd = c; } }
        for (const [s, e] of matchedLines(buf, end, x.agent === 'claude' ? CLAUDE_PAT : CODEX_PAT)) {
          const line = buf.subarray(s, e).toString('utf8');
          if (x.agent === 'claude') claudeLine(x, line); else codexLine(x, line);
        }
        if (x.agent === 'codex') { for (const [s, e] of matchedLines(buf, end, [B('"type":"turn_context"'), B('"type":"session_meta"')])) { const c = cwdIn(buf.subarray(s, Math.min(e, s + (1 << 20))).toString('utf8')); if (c) x.cwd = c; } }
        carry = Buffer.from(buf.subarray(last + 1));
        x.offset = pos - carry.length;
        await sleep(pause);
      }
    } finally { await fh.close(); }
    return bytes;
  }

  // one pass over every transcript; new bytes only
  async function runOnce() {
    await load();
    if (!enabled()) return { skipped: true };
    const t0 = now(); let bytes = 0, read = 0;
    const found = await discover(), keep = new Set(found.map(f => f.file));
    for (const f of Object.keys(index.files)) if (!keep.has(f)) { delete index.files[f]; version++; }
    // newest first: recent films show up soonest
    const sts = [];
    for (let i = 0; i < found.length; i += 32) sts.push(...await Promise.all(found.slice(i, i + 32).map(f => statOf(f.file))));
    const order = found.map((f, i) => ({ ...f, st: sts[i] })).filter(f => f.st).sort((a, b) => b.st.mtimeMs - a.st.mtimeMs);
    stats.total = order.length; stats.done = 0;
    let sinceSave = 0, stopped = false;
    for (const f of order) {
      if (!enabled()) { stopped = true; break; }
      let x = index.files[f.file];
      if (!x || x.agent !== f.agent || f.st.size < x.offset) x = index.files[f.file] = { agent: f.agent, offset: 0, size: 0, mtime: 0, cwd: '', hints: [], uses: {} };
      if (f.st.size !== x.size || f.st.mtimeMs !== x.mtime) {
        x.file = f.file;
        try { bytes += await readFile(x, f.st.size); read++; } catch { }
        delete x.file;
        x.size = f.st.size; x.mtime = f.st.mtimeMs; version++;
        if (++sinceSave >= 40) { sinceSave = 0; await save(); }
      }
      stats.done++;
    }
    if (!stopped) { index.complete = true; stats.ready = true; }
    stats.runs++;
    stats.lastRun = { at: now(), ms: now() - t0, bytes, files: read, total: order.length };
    await save();
    onDone?.(stats.lastRun);
    return stats.lastRun;
  }
  // opts.pauseMs: a slower run (the first build in the background); a run asked for while one is going joins it
  function run(opts = {}) {
    if (!running) { pause = opts.pauseMs ?? pauseMs; running = runOnce().finally(() => { running = null; pause = pauseMs; }); }
    return running;
  }

  // per skill name: last use, number of uses and sessions, and the films (newest first)
  let aggCache = null;
  function aggregate(films = [], filmsSig = '') {
    const sig = version + ':' + films.length + ':' + filmsSig;
    if (aggCache && aggCache.sig === sig) return aggCache.map;
    const m = filmMatcher(films, { path, key }), map = new Map();
    for (const x of Object.values(index.files)) {
      const names = Object.keys(x.uses || {}); if (!names.length) continue;
      const hf = x.hints.map(([p, at]) => ({ at, f: p.startsWith('@') ? m.byProject(p.slice(1), x.cwd) : m.inFilm(p) }));
      const cwdFilm = m.inFilm(x.cwd);
      const filmAt = at => { const after = hf.find(h => h.at >= at && h.f); if (after) return after.f; for (let i = hf.length - 1; i >= 0; i--) if (hf[i].at < at && hf[i].f) return hf[i].f; return cwdFilm; };
      for (const n of names) {
        const k = n.toLowerCase();
        const a = map.get(k) || map.set(k, { last: 0, uses: 0, sessions: 0, outside: 0, films: new Map() }).get(k);
        a.sessions++;
        for (const at of x.uses[n]) {
          a.uses++; a.last = Math.max(a.last, at);
          const f = filmAt(at);
          if (!f) { a.outside++; continue; }
          const e = a.films.get(f.id) || a.films.set(f.id, { id: f.id, title: f.title || path.basename(f.path), latest: f.latest || null, outputs: Array.isArray(f.outputs) ? f.outputs.length : 0, last: 0, uses: 0 }).get(f.id);
          e.last = Math.max(e.last, at); e.uses++;
        }
      }
    }
    for (const a of map.values()) a.films = [...a.films.values()].sort((x, y) => y.last - x.last);
    aggCache = { sig, map };
    return map;
  }
  return { run, aggregate, stats: () => ({ ...stats, running: !!running }), load, index: () => index };
}
