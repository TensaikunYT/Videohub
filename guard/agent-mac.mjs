// VideoHub's render protection on a Mac: the counterpart of guard\VideoHubAgent.exe on Windows, written in Node so it
// needs no compiler. Invisible (no window, no Dock icon). The hub starts it (`node guard/agent-mac.mjs --agent`) when a
// VideoHub window opens or a render runs and stops it (SIGTERM) when it idles out. It speaks the Windows agent's file
// protocol, in ~/Library/Application Support/RenderGuard: state.json (every ~2 s), cmd/*.json (commands), settings.txt
// (written by the hub), history.log (same line format), error.log.
//
// What macOS has instead of Job Objects:
// - CPU cap: a render's process tree is continued and stopped (SIGCONT / SIGSTOP) in 100 ms cycles, so renders together
//   use at most N % of the Mac (each one's share is worked out from what it used in the last scan) — only while a cap
//   below 100 % applies; at 100 % nothing runs at all
// - low priority: Darwin background policy (taskpolicy -b) while you use the Mac — on Apple silicon renders then run
//   on the efficiency cores only, so they never fight your apps — lifted as soon as you are away
// - RAM slow mode: below PauseMB free (or when macOS itself reports memory pressure) the newest render crawls at
//   SlowCapPct % in the background; the oldest keeps going unless RAM is critical. Never frozen, so nothing times out.
// - pause / resume: SIGSTOP / SIGCONT of the whole tree; hotkeys ⌃⌥⌘P / ⌃⌥⌘R come from guard/VideoHubKeys (optional,
//   built by setup with swiftc). A render is never left frozen: every stop is followed by a continue within a cycle,
//   quitting (SIGTERM / SIGINT / an error) continues everything, and a new agent thaws what the last one had stopped.
//
//   node guard/agent-mac.mjs --agent                      run (one per user; a second copy exits at once)
//   node guard/agent-mac.mjs --quit                       ask the running agent to lift its limits and exit
//   test copies: --only <TAG> (only renders whose command line has TAG) --dir <folder> --ramfile <file with free MB>
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, execFile, execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { processTable, treeOf, cwdOf, killTree, availableMB, memoryPressure, setLoginItem, loginItemOn } from '../server/mac.js';

const HERE = path.dirname(fileURLToPath(import.meta.url)), HUB_DIR = path.resolve(HERE, '..');
const ARGV = process.argv.slice(2), opt = k => { const i = ARGV.indexOf(k); return i >= 0 ? ARGV[i + 1] : null; };
const ONLY = opt('--only'), RAMFILE = opt('--ramfile');
const DIR = path.resolve(opt('--dir') || path.join(os.homedir(), 'Library', 'Application Support', 'RenderGuard'));
const F = { state: path.join(DIR, 'state.json'), cmd: path.join(DIR, 'cmd'), settings: path.join(DIR, 'settings.txt'), pid: path.join(DIR, 'agent.pid'), history: path.join(DIR, 'history.log'), errors: path.join(DIR, 'error.log') };
const CORES = os.cpus().length, PERIOD = 100;   // CPU cap cycle, ms

// ---------- settings (settings.txt, key=value; VideoHub is its only UI). LowPrio is off by default on a Mac: on
// Apple silicon "background" means the efficiency cores only (the Quiet preset turns it on).
export const DEFAULTS = { CapActive: 90, CapIdle: 100, IdleMin: 2, PauseMB: 700, CriticalMB: 500, SlowCapPct: 5, LowPrio: 0 };
const BOUNDS = { CapActive: [1, 100], CapIdle: [1, 100], IdleMin: [1, 1440], PauseMB: [0, 1048576], CriticalMB: [0, 1048576], SlowCapPct: [1, 100], LowPrio: [0, 1] };
export function parseSettings(txt) {
  const s = { ...DEFAULTS };
  for (const l of String(txt || '').replace(/^﻿/, '').split(/\r?\n/)) {
    const i = l.indexOf('='); if (i <= 0) continue;
    const k = l.slice(0, i).trim(), v = l.slice(i + 1).trim(), b = BOUNDS[k];
    if (b && /^-?\d+$/.test(v) && +v >= b[0] && +v <= b[1]) s[k] = +v;
  }
  return s;
}

// ---------- which processes are renders (the Windows agent's rules, Mac process names)
const rxScript = /render|snap|score|mix|sfx|frames|encode/i;
const rxHubDir = /[\\/]videohub[\\/](?:server|guard)[\\/]/i;
const ownDirs = [path.join(HUB_DIR, 'server') + path.sep, path.join(HUB_DIR, 'guard') + path.sep].map(s => s.toLowerCase());
// VideoHub's own processes (hub.js, cli.js, mcp.js, this agent) are not renders; what its queue starts still is
export const isHub = p => rxHubDir.test(p.cmd) || ownDirs.some(d => p.cmd.toLowerCase().includes(d));
const BROWSER = /^(?:Google Chrome(?: for Testing)?|Microsoft Edge|Brave Browser|Chromium|chrome-headless-shell|chrome)(?: Helper.*)?$/i;
const TEMP_PROFILE = /--user-data-dir=\S*(?:\/var\/folders\/|\/tmp\/|\/T\/)/;
export function isRender(p) {
  if (isHub(p)) return false;
  const n = p.name.toLowerCase();
  if (n === 'ffmpeg') return true;
  if (n === 'ffprobe') return false;   // metadata scans are not renders
  if (BROWSER.test(p.name)) return /chrome-headless-shell/i.test(p.name) || p.cmd.includes('--headless') || TEMP_PROFILE.test(p.cmd);
  if (/^(?:node|python3?(?:\.\d+)?)$/.test(n)) return isRenderScript(p.cmd);
  return false;
}
// the entry point decides, never flags or arguments passed to a server / test runner
export function isRenderScript(command) {
  const a = String(command || '').match(/"[^"]*"|\S+/g) || [];
  for (let i = 1; i < a.length; i++) {
    const arg = a[i].replace(/^"|"$/g, '');
    if (['-e', '--eval', '-p', '--print', '-c', '--test'].includes(arg)) return false;
    if (arg === '-m') return i + 1 < a.length && rxScript.test(a[i + 1].replace(/"/g, ''));
    if (['-r', '--require', '--import', '--loader', '--experimental-loader', '--env-file'].includes(arg)) { i++; continue; }
    if (arg.startsWith('-')) continue;
    if (!/\.(?:[cm]?js|py)$/i.test(arg)) continue;
    if (/(?:\.(?:test|spec)\.[cm]?js$|(?:^|[\\/])(?:tests?|__tests__)[\\/])/i.test(arg)) return false;
    if (path.basename(arg.replace(/\\/g, '/')).toLowerCase() === 'make.mjs') return /(?:^|\s)--(?:chunks|only|seconds|range|preview|stills|mux)(?:\s|$)/i.test(command);
    return rxScript.test(arg);
  }
  return false;
}
// render roots: each render process grouped under its top-most render ancestor
export function findRoots(rows, only = null) {
  const by = new Map(rows.map(r => [r.pid, r])), roots = new Set();
  for (const p of rows) {
    const tagged = only && p.name === 'node' && p.cmd.includes(only) && !isHub(p);
    if (!isRender(p) && !tagged) continue;
    let r = p;
    for (let g = 0; g < 30; g++) { const par = by.get(r.ppid); if (!par || par.start > r.start + 999 || !isRender(par)) break; r = par; }
    if (!only || r.cmd.includes(only)) roots.add(r.pid);
  }
  return [...roots];
}

// ---------- progress from the render's log (Claude's task output or a log file it writes), as on Windows
const rxChunkHdr = /^(\d+)\/(\d+) chunks to render/, rxChunkOk = /chunk \d+ ok\D+(\d+) done, (\d+) queued, (\d+)s/;
const rxWorker = /^\[?w(\d+)\]?\s+(\d+)\/(\d+)(?:\s+frames,)?\s+(\d+)s/, rxWorkerDone = /^\[?w(\d+)\]?\s+done/, rxFrac = /(\d+)\s*\/\s*(\d+)/, rxPct = /(\d{1,3}(?:[.,]\d+)?)\s*%/;
function readHeadTail(file) {
  const fd = fs.openSync(file, 'r');
  try {
    const len = fs.fstatSync(fd).size, rd = (pos, n) => { const b = Buffer.alloc(n); return b.subarray(0, fs.readSync(fd, b, 0, n, pos)).toString('utf8'); };
    return len <= 256 * 1024 ? rd(0, len) : rd(0, 32 * 1024) + '\n' + rd(len - 192 * 1024, 192 * 1024);
  } finally { fs.closeSync(fd); }
}
export function parseLog(text, j) {
  const lines = String(text).replace(/\0/g, '').replace(/\r/g, '\n').split('\n').map(l => l.trim()).filter(Boolean);
  if (!lines.length) return j;
  const useful = lines.filter(l => !l.startsWith('console:'));
  j.lastLine = (useful.length ? useful[useful.length - 1] : lines[lines.length - 1]).slice(0, 200);
  const finished = useful.length > 0 && /^(done|video assembled|partial done)\b/.test(useful[useful.length - 1]);
  const fin = () => { if (finished) { j.progress = 1; j.etaSec = 0; j.finished = true; } return j; };
  let hdr = -1, N = 0, Q0 = 0;
  lines.forEach((l, i) => { const m = rxChunkHdr.exec(l); if (m) { hdr = i; Q0 = +m[1]; N = +m[2]; } });
  if (hdr >= 0 && N > 0) {
    let done = 0, secs = 0;
    for (let i = hdr + 1; i < lines.length; i++) { const m = rxChunkOk.exec(lines[i]); if (m) { done = +m[1]; secs = +m[3]; } }
    const have = N - Q0 + done;
    j.progress = Q0 > 0 ? Math.min(1, done / Q0) : 1;
    if (done > 0 && secs > 0) j.etaSec = (N - have) * secs / done;
    return fin();
  }
  const w = new Map();
  for (const l of lines) {
    let m = rxWorker.exec(l); if (m) { w.set(+m[1], [+m[2], +m[3], +m[4]]); continue; }
    m = rxWorkerDone.exec(l); if (m && w.has(+m[1])) w.get(+m[1])[0] = w.get(+m[1])[1];
  }
  if (w.size) {
    const v = [...w.values()], d = v.reduce((s, x) => s + x[0], 0), t = v.reduce((s, x) => s + x[1], 0);
    if (t > 0) j.progress = d / t;
    let eta = -1; for (const x of v) if (x[0] < x[1] && x[0] > 0 && x[2] > 0) eta = Math.max(eta, (x[1] - x[0]) * x[2] / x[0]);
    j.etaSec = eta < 0 ? null : eta;
    return fin();
  }
  for (let i = useful.length - 1; i >= Math.max(0, useful.length - 30); i--) {
    let m = rxPct.exec(useful[i]); if (m) { const p = +m[1].replace(',', '.'); if (p <= 100) { j.progress = p / 100; break; } }
    m = rxFrac.exec(useful[i]); if (m) { const a = +m[1], b = +m[2]; if (b > 1 && a <= b) { j.progress = a / b; break; } }
  }
  return fin();
}
// Claude Code writes a background command's output to <tmp>/claude…/<project>/<session>/tasks/<id>.output, created
// when the command starts. The agent never reads Claude's transcripts: only these output files and the render's folder.
const claudeTemps = () => [...new Set([path.join(os.tmpdir(), 'claude'), `/private/tmp/claude-${process.getuid?.() ?? ''}`, '/private/tmp/claude']
  .filter(d => fs.existsSync(d)).map(d => { try { return fs.realpathSync(d); } catch { return d; } }))];
function findTaskLog(start) {
  let best = null, bestDiff = 1e9;
  for (const t of claudeTemps()) {
    let projects = []; try { projects = fs.readdirSync(t, { withFileTypes: true }).filter(e => e.isDirectory()); } catch { continue; }
    for (const pr of projects) {
      let sessions = []; try { sessions = fs.readdirSync(path.join(t, pr.name), { withFileTypes: true }).filter(e => e.isDirectory()); } catch { continue; }
      for (const s of sessions) {
        const dir = path.join(t, pr.name, s.name, 'tasks'); let files = []; try { files = fs.readdirSync(dir).filter(f => f.endsWith('.output')); } catch { continue; }
        for (const f of files) { try { const diff = (start - fs.statSync(path.join(dir, f)).birthtimeMs) / 1000; if (diff >= -3 && diff <= 30 && Math.abs(diff) < bestDiff) { bestDiff = Math.abs(diff); best = path.join(dir, f); } } catch { } }
      }
    }
  }
  return best;
}
function findFileLog(cwd, start) {
  if (!cwd) return null;
  const cands = [];
  for (const d of [cwd, path.join(cwd, 'render'), path.join(cwd, 'out'), path.join(cwd, 'logs')]) {
    let fl = []; try { fl = fs.readdirSync(d); } catch { continue; }
    for (const f of fl) if (/\.log$|log.*\.txt$|\.out$/i.test(f)) { try { const m = fs.statSync(path.join(d, f)).mtimeMs; if (m >= start - 5000 && m > Date.now() - 20 * 60e3) cands.push([m, path.join(d, f)]); } catch { } }
  }
  return cands.sort((a, b) => b[0] - a[0])[0]?.[1] || null;
}

// ---------- CPU shares: renders together get `cap` % of the Mac. Calm renders keep what they use, the rest is split
// evenly between the hungry ones (water-filling). use: root → estimated % of the Mac it would use unthrottled.
export function shares(use, cap) {
  const out = new Map(), list = [...use.entries()].sort((a, b) => a[1] - b[1]);
  let budget = cap;
  list.forEach(([r, u], i) => { const fair = budget / (list.length - i), give = Math.min(u, fair); out.set(r, fair); budget -= give; });
  return out;
}
export const dutyFor = (share, use) => use <= 0.5 || share >= use ? 1 : Math.max(0.02, Math.min(1, share / use));
export const dur = s => s < 0 ? '—' : s >= 3600 ? `${Math.floor(s / 3600)} h ${Math.floor(s % 3600 / 60)} min` : s >= 60 ? `${Math.floor(s / 60)} min ${String(Math.floor(s % 60)).padStart(2, '0')} s` : `${Math.floor(s)} s`;

// ---------- the agent
// local time without a zone, as the Windows agent writes it (the hub reads state.json's "updated" as local time)
export const localTime = (ms = Date.now(), sep = 'T') => { const d = new Date(ms), p = n => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}${sep}${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`; };
const stamp = () => localTime(Date.now(), ' ');
const append = (file, line) => { try { fs.mkdirSync(DIR, { recursive: true }); fs.appendFileSync(file, stamp() + '  ' + line + '\n'); } catch { } };
const history = line => append(F.history, line);
const errLog = (() => { let last = null; return m => { if (m !== last) append(F.errors, m); last = m; }; })();
const sig = (pids, s) => { for (const p of pids || []) { try { process.kill(p, s); } catch { } } };
const readJsonFile = f => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };

class Agent {
  constructor() {
    this.st = parseSettings(this.readSettingsText()); this.settingsMtime = this.mtime(F.settings);
    this.jobs = []; this.prevJobs = new Map(); this.rootStart = new Map(); this.tree = new Map();
    this.paused = new Map(); this.pausedAt = new Map(); this.slowed = new Map(); this.flips = new Map(); this.youngSlowed = new Set();
    this.duty = new Map(); this.use = new Map(); this.inStop = new Set(); this.bg = new Set();
    this.lastCpu = new Map(); this.lastT = 0; this.cwd = new Map(); this.logs = new Map(); this.firstSeen = new Map();
    this.idleSec = 0; this.idleAt = 0; this.gpu = null; this.gpuAt = 0; this.pressure = 1; this.active = true; this.capNow = 100;
    this.released = false; this.keys = null; this.hotkeys = false; this.cycleTimer = null; this.wakeTimer = null; this.busy = false;
  }
  mtime(f) { try { return fs.statSync(f).mtimeMs; } catch { return 0; } }
  readSettingsText() { try { return fs.readFileSync(F.settings, 'utf8'); } catch { return ''; } }
  reloadSettings(source) {
    const next = parseSettings(this.readSettingsText()), diff = Object.keys(DEFAULTS).filter(k => next[k] !== this.st[k]).map(k => `${k} ${this.st[k]}→${next[k]}`);
    this.st = next; this.settingsMtime = this.mtime(F.settings);
    if (diff.length) history(`SETTINGS (${source}): ${diff.join(', ')}`);
    return diff.join(', ');
  }
  availMB() { if (RAMFILE) { try { return +fs.readFileSync(RAMFILE, 'utf8').trim(); } catch { } } return availableMB(); }

  // ----- what runs now
  async idle() {
    if (Date.now() - this.idleAt < 4000) return this.idleSec;
    this.idleAt = Date.now();
    await new Promise(res => execFile('ioreg', ['-c', 'IOHIDSystem', '-d', '4', '-r', '-k', 'HIDIdleTime'], { timeout: 4000, maxBuffer: 4 << 20 }, (e, out) => { const m = /"HIDIdleTime" = (\d+)/.exec(String(out || '')); if (m) this.idleSec = +m[1] / 1e9; res(); }));
    return this.idleSec;
  }
  async gpuUse() {
    if (Date.now() - this.gpuAt < 4000) return this.gpu;
    this.gpuAt = Date.now();
    await new Promise(res => execFile('ioreg', ['-r', '-d', '1', '-w', '0', '-c', 'IOAccelerator'], { timeout: 4000, maxBuffer: 8 << 20 }, (e, out) => { const v = [...String(out || '').matchAll(/"Device Utilization %"=(\d+)/g)].map(m => +m[1]); this.gpu = v.length ? Math.max(...v) : null; res(); }));
    return this.gpu;
  }
  async collect() {
    const rows = await processTable(), now = Date.now(), by = new Map(rows.map(r => [r.pid, r]));
    const roots = findRoots(rows, ONLY), dt = this.lastT ? (now - this.lastT) / 1000 : 0, newCpu = new Map();
    const idleSec = await this.idle(); this.pressure = await memoryPressure().catch(() => 1); await this.gpuUse();
    this.active = idleSec < this.st.IdleMin * 60; this.capNow = this.active ? this.st.CapActive : this.st.CapIdle;
    const jobs = [];
    for (const root of roots) {
      const r = by.get(root), pids = treeOf(rows, root);
      const j = { rootPid: root, start: r.start, pids, cmd: r.cmd, what: shortCmd(r.cmd, r.name), ramMB: 0, cpu: 0, progress: null, etaSec: null, lastLine: null, logPath: null, finished: false };
      let cpuSec = 0;
      for (const pid of pids) { const p = by.get(pid); j.ramMB += p.ramMB; newCpu.set(pid, p.cpuSec); const o = this.lastCpu.get(pid); if (o != null && p.cpuSec >= o) cpuSec += p.cpuSec - o; }
      if (dt > 0) j.cpu = Math.max(0, Math.min(100, 100 * cpuSec / (dt * CORES)));
      if (!this.cwd.has(root)) this.cwd.set(root, await cwdOf(root).catch(() => null) || '');
      j.cwd = this.cwd.get(root); j.project = shortPath(j.cwd);
      // started from a Claude Code session: an ancestor named claude (the agent never opens Claude's own files)
      let cur = r, depth = 0, claude = false;
      while (cur && depth++ < 30) { if (cur.name === 'claude') { claude = true; break; } const par = by.get(cur.ppid); cur = par && par.start <= cur.start + 999 ? par : null; }
      j.session = claude ? 'Claude session' : '(outside Claude / manual)';
      let log = this.logs.get(root);
      if (!log) { try { const task = findTaskLog(r.start), file = findFileLog(j.cwd, r.start), small = !task || fs.statSync(task).size < 64; log = small && file ? file : task; if (log && fs.statSync(log).size < 64) log = null; } catch { log = null; } this.logs.set(root, log); }
      j.logPath = log || null;
      if (log) { try { parseLog(readHeadTail(log), j); } catch { } }
      if (j.progress != null && j.etaSec == null) {
        const f = this.firstSeen.get(root);
        if (!f) this.firstSeen.set(root, [now, j.progress]);
        else if (j.progress > f[1] + 0.001) j.etaSec = (1 - j.progress) * (now - f[0]) / 1000 / (j.progress - f[1]);
      }
      jobs.push(j);
    }
    for (const k of [...this.cwd.keys()]) if (!roots.includes(k)) { this.cwd.delete(k); this.logs.delete(k); this.firstSeen.delete(k); }
    this.lastCpu = newCpu; this.lastT = now;
    jobs.sort((a, b) => a.start - b.start);
    this.rows = rows;
    return jobs;
  }

  // ----- limits
  update(jobs) {
    const roots = new Set(jobs.map(j => j.rootPid));
    for (const r of [...this.rootStart.keys()]) if (!roots.has(r)) { for (const m of [this.rootStart, this.tree, this.paused, this.pausedAt, this.slowed, this.flips, this.duty, this.use]) m.delete(r); this.youngSlowed.delete(r); this.inStop.delete(r); }
    for (const j of jobs) {
      const old = this.tree.get(j.rootPid) || [];
      this.rootStart.set(j.rootPid, j.start); this.tree.set(j.rootPid, j.pids);
      if (this.paused.has(j.rootPid)) sig(j.pids.filter(p => !old.includes(p)), 'SIGSTOP');   // appeared inside a paused render
      // what it would use unthrottled: the measured share divided by the time it was allowed to run (smoothed)
      const d = this.duty.get(j.rootPid) ?? 1, est = Math.min(100, j.cpu / Math.max(d, 0.05)), u = this.use.get(j.rootPid);
      this.use.set(j.rootPid, u == null ? est : 0.5 * u + 0.5 * est);
    }
    this.applyCaps(jobs);
    this.applyBackground(jobs);
    for (const j of jobs) { j.paused = this.paused.get(j.rootPid) || null; j.slow = this.slowed.get(j.rootPid) || null; j.cap = this.capOf(j.rootPid); }
  }
  capOf(r) { const d = this.duty.get(r) ?? 1; if (this.slowed.has(r)) return this.st.SlowCapPct; return d >= 0.999 && this.capNow >= 100 ? null : Math.round(Math.min(100, (this.duty.get(r) ?? 1) * (this.use.get(r) || 0)) || this.capNow); }
  applyCaps() {
    if (this.released) return;
    const live = [...this.rootStart.keys()].filter(r => !this.paused.has(r)), normal = live.filter(r => !this.slowed.has(r));
    const sh = this.capNow >= 100 ? null : shares(new Map(normal.map(r => [r, this.use.get(r) || 0])), this.capNow);
    for (const r of live) {
      const u = this.use.get(r) || 0, d = this.slowed.has(r) ? dutyFor(this.st.SlowCapPct, u) : sh ? dutyFor(sh.get(r), u) : 1;
      this.duty.set(r, d);
      if (d >= 0.999 && this.inStop.has(r)) { sig(this.tree.get(r), 'SIGCONT'); this.inStop.delete(r); }
    }
    if (!this.cycleTimer && live.some(r => this.duty.get(r) < 0.999)) this.cycle();
  }
  // one 100 ms cycle: every throttled render runs for duty × 100 ms, then stops until the next cycle
  cycle() {
    this.cycleTimer = null;
    if (this.released) return;
    for (const r of this.inStop) if (!this.paused.has(r)) sig(this.tree.get(r), 'SIGCONT');
    this.inStop.clear();
    const items = [...this.duty.entries()].filter(([r, d]) => d < 0.999 && !this.paused.has(r) && this.tree.has(r));
    if (!items.length) return;
    for (const [r, d] of items) setTimeout(() => { if (!this.released && !this.paused.has(r) && (this.duty.get(r) ?? 1) < 0.999 && this.tree.has(r)) { sig(this.tree.get(r), 'SIGSTOP'); this.inStop.add(r); } }, Math.max(1, Math.round(d * PERIOD)));
    this.cycleTimer = setTimeout(() => this.cycle(), PERIOD);
  }
  // Darwin background policy: slowed renders always, every render while you use the Mac when LowPrio is on
  applyBackground(jobs, all = false) {
    const on = [], off = [];
    for (const j of jobs) {
      const want = !all && !this.released && (this.slowed.has(j.rootPid) || (this.st.LowPrio && this.active));
      for (const p of j.pids) { if (want && !this.bg.has(p)) { on.push(p); this.bg.add(p); } else if (!want && this.bg.has(p)) { off.push(p); this.bg.delete(p); } }
    }
    const live = new Set(jobs.flatMap(j => j.pids)); for (const p of [...this.bg]) if (!live.has(p)) this.bg.delete(p);
    if (!on.length && !off.length) return;
    const script = [...on.map(p => `taskpolicy -b -p ${p}`), ...off.map(p => `taskpolicy -B -p ${p}`)].join(' 2>/dev/null; ') + ' 2>/dev/null; true';
    if (all) { try { execFileSync('/bin/sh', ['-c', script], { timeout: 10000 }); } catch { } }
    else execFile('/bin/sh', ['-c', script], { timeout: 20000 }, () => { });
  }
  pause(r, why) {
    if (this.released || !this.rootStart.has(r) || this.paused.has(r)) return false;
    this.paused.set(r, why); this.pausedAt.set(r, Date.now()); this.inStop.delete(r); sig(this.tree.get(r), 'SIGSTOP'); return true;
  }
  resume(r) {
    if (this.released || !this.paused.has(r)) return false;
    this.paused.delete(r); this.pausedAt.delete(r); sig(this.tree.get(r), 'SIGCONT'); this.applyCaps(); return true;
  }
  pauseAll(why) { let n = 0; for (const r of [...this.rootStart.keys()]) if (this.pause(r, why)) n++; return n; }
  resumeAll() { let n = 0; for (const r of [...this.paused.keys()]) if (this.resume(r)) n++; return n; }
  slow(r, why) { if (this.released || !this.rootStart.has(r) || this.slowed.get(r) === why) return false; this.slowed.set(r, why); this.applyCaps(); this.applyBackground(this.jobs); return true; }
  normal(r) { if (this.released || !this.slowed.delete(r)) return false; this.applyCaps(); this.applyBackground(this.jobs); return true; }
  flip(r) { const now = Date.now(), l = (this.flips.get(r) || []).filter(t => now - t < 10 * 60e3); l.push(now); this.flips.set(r, l); return l.length; }
  normalCount() { return [...this.rootStart.keys()].filter(r => !this.paused.has(r) && !this.slowed.has(r)).length; }
  slowCount(why) { return [...this.slowed.values()].filter(v => why == null || v === why).length; }
  // the newest render at normal speed slows first; the last one at normal speed only when RAM is critical. A render
  // switched more than 3 times in 10 min stays slow as "queue"; one slowed in its first 60 s waits 60 s (Chrome start).
  slowForRam(critical) {
    if (this.released) return [0];
    const now = Date.now(), normal = [...this.rootStart.entries()].filter(([r]) => !this.paused.has(r) && !this.slowed.has(r)).sort((a, b) => b[1] - a[1]).map(e => e[0]);
    if (!normal.length || (normal.length === 1 && !critical)) return [0];
    for (const r of critical ? normal : normal.slice(0, -1)) {
      const young = now - this.rootStart.get(r) < 60e3;
      if (!young) this.youngSlowed.delete(r); else if (this.youngSlowed.has(r)) continue;
      const why = this.flip(r) > 3 ? 'queue' : 'RAM';
      this.slowed.set(r, why); if (young) this.youngSlowed.add(r);
      this.applyCaps(); this.applyBackground(this.jobs);
      return [r, why];
    }
    return [0];
  }
  normalForRam(nothingNormal) {
    if (this.released) return 0;
    const r = [...this.slowed.entries()].filter(([k, v]) => !this.paused.has(k) && (v === 'RAM' || (nothingNormal && v === 'queue'))).sort((a, b) => (this.rootStart.get(a[0]) || 0) - (this.rootStart.get(b[0]) || 0))[0]?.[0];
    if (!r) return 0;
    this.slowed.delete(r); this.flip(r); this.applyCaps(); this.applyBackground(this.jobs); return r;
  }
  who(r) { const j = this.jobs.find(x => x.rootPid === r); return j ? j.session + (j.project ? ' · ' + j.project : '') : 'pid ' + r; }

  // ----- the RAM watchdog (every 0.4 s; reading free memory costs nothing on a Mac)
  watchdog() {
    let last = 0, aboveSince = 0, idleSince = 0;
    const tick = () => {
      if (this.released) return;
      try {
        const avail = this.availMB(), now = Date.now(), low = avail < this.st.PauseMB || this.pressure >= 2, critical = avail < this.st.CriticalMB || this.pressure >= 4;
        if (low) {
          aboveSince = idleSince = 0;
          if (now - last > 1500) {
            const [r, why] = this.slowForRam(critical); last = now;
            if (r) { this.wake(); history((why === 'queue' ? `SLOW IN QUEUE (RAM: ${avail} MB free, more than 3 speed changes in 10 min)` : `SLOWED (RAM: ${avail} MB free${this.pressure >= 2 ? ', macOS memory pressure' : ''}${this.normalCount() === 0 ? ', critical — last render' : ''})`) + `  ${this.st.SlowCapPct}% CPU  ${this.who(r)}  pid ${r}`); }
          }
        } else {
          const plenty = avail > this.st.PauseMB + 1500 && this.slowCount('RAM') > 0;
          const idle = this.normalCount() === 0 && this.slowCount('RAM') + this.slowCount('queue') > 0;
          aboveSince = plenty ? aboveSince || now : 0; idleSince = idle ? idleSince || now : 0;
          if ((plenty && now - aboveSince > 10e3 && now - last > 10e3) || (idle && now - idleSince > 3e3 && now - last > 3e3)) {
            const r = this.normalForRam(idle); last = now; aboveSince = idleSince = 0;
            if (r) { this.wake(); history(`NORMAL SPEED (RAM: ${avail} MB free${idle ? ', queue advanced' : ''})  ${this.who(r)}  pid ${r}`); }
          }
        }
      } catch (e) { errLog('watchdog: ' + e.message); }
      setTimeout(tick, 400);
    };
    tick();
  }

  // ----- commands (cmd/*.json, oldest first; the hub writes x.tmp and renames it to .json)
  async drain() {
    let files = []; try { fs.mkdirSync(F.cmd, { recursive: true }); files = fs.readdirSync(F.cmd).filter(f => f.endsWith('.json')); } catch { return; }
    files = files.map(f => { try { return [fs.statSync(path.join(F.cmd, f)).birthtimeMs, f]; } catch { return null; } }).filter(Boolean).sort((a, b) => a[0] - b[0]).map(x => x[1]);
    for (const f of files) {
      const full = path.join(F.cmd, f); let o = null, young = false;
      try { young = Date.now() - fs.statSync(full).mtimeMs < 3000; o = JSON.parse(fs.readFileSync(full, 'utf8')); } catch { }
      if (!o || typeof o !== 'object') { if (!young) this.bad(full, 'invalid JSON'); continue; }
      const action = o.action, ACTIONS = ['pause', 'resume', 'kill', 'slow', 'normal', 'pauseAll', 'resumeAll', 'reload', 'startup'];
      if (!ACTIONS.includes(action)) { this.bad(full, 'unknown action: ' + (action || '(none)')); continue; }
      const needsRoot = ['pause', 'resume', 'kill', 'slow', 'normal'].includes(action), root = o.rootPid == null ? 0 : Number.isInteger(+o.rootPid) ? +o.rootPid : -1;
      if (root < 0 || (needsRoot && root <= 0)) { this.bad(full, 'rootPid is missing or invalid'); continue; }
      if (action === 'startup' && typeof o.on !== 'boolean') { this.bad(full, 'startup requires "on": true/false'); continue; }
      let outcome; try { outcome = await this.run(action, root, o); } catch (e) { outcome = 'error: ' + e.message; }
      history(`COMMAND  ${action}${needsRoot ? ' ' + root : ''}${o.by ? '  (' + o.by + ')' : ''}  →  ${outcome}`);
      try { fs.unlinkSync(full); } catch { }
    }
  }
  bad(f, why) { try { const d = path.join(F.cmd, 'bad'); fs.mkdirSync(d, { recursive: true }); let to = path.join(d, path.basename(f)); if (fs.existsSync(to)) to = path.join(d, Date.now() + '_' + path.basename(f)); fs.renameSync(f, to); history(`INVALID COMMAND  ${path.basename(f)}  (${why})  →  cmd/bad/`); } catch (e) { errLog('cmd bad: ' + e.message); } }
  async run(action, root, o) {
    if (action === 'reload') { const d = this.reloadSettings('command'); return d ? 'settings loaded: ' + d : 'settings unchanged'; }
    if (action === 'startup') { if (ONLY) return 'test copy: login item untouched'; setLoginItem(o.on, HUB_DIR); return 'Open at login: ' + (loginItemOn(HUB_DIR) ? 'on' : 'off'); }
    const j = this.jobs.find(x => x.rootPid === root), who = j ? `${j.session}  [${j.project}]` : 'pid ' + root;
    let out;
    if (action === 'pause') out = this.pause(root, 'manual') ? 'PAUSED (manual)  ' + who : !j ? 'render not found: pid ' + root : 'already paused: ' + who;
    else if (action === 'resume') out = this.resume(root) ? 'RESUMED  ' + who : !j ? 'render not found: pid ' + root : 'was not paused: ' + who;
    else if (action === 'kill') { if (!j) out = 'render not found, nothing stopped: pid ' + root; else { this.paused.delete(root); killTree(root).catch(() => { }); out = `STOPPED  ${who}  ${j.what}`; } }
    else if (action === 'slow') out = this.slow(root, 'manual') ? `SLOWED (manual)  ${this.st.SlowCapPct}% CPU  ${who}` : !j ? 'render not found: pid ' + root : 'already slow: ' + who;
    else if (action === 'normal') out = this.normal(root) ? 'NORMAL SPEED  ' + who : !j ? 'render not found: pid ' + root : 'was not slow: ' + who;
    else if (action === 'pauseAll') out = this.pauseAll('manual') + ' renders paused';
    else out = this.resumeAll() + ' renders resumed';
    this.wake();
    return out;
  }

  // ----- hotkeys: guard/VideoHubKeys prints "pause" / "resume" (and exits when we do: it watches its stdin)
  startKeys() {
    const exe = path.join(HERE, 'VideoHubKeys');
    if (ONLY || !fs.existsSync(exe)) return;
    try {
      const k = spawn(exe, [], { stdio: ['pipe', 'pipe', 'ignore'] }); this.keys = k; let buf = '';
      k.on('error', () => { this.hotkeys = false; });
      k.on('exit', () => { this.hotkeys = false; this.keys = null; });
      k.stdout.on('data', d => {
        buf += d; let i;
        while ((i = buf.indexOf('\n')) >= 0) {
          const l = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
          if (l === 'ready') this.hotkeys = true;
          else if (l === 'pause') { history(`EMERGENCY PAUSE (⌃⌥⌘P): ${this.pauseAll('manual')} renders`); this.wake(); }
          else if (l === 'resume') { history(`RESUMED (⌃⌥⌘R): ${this.resumeAll()} renders`); this.wake(); }
        }
      });
    } catch { }
  }

  // ----- state.json for the hub (written next to it, then renamed: a reader never sees half a file)
  writeState() {
    const avail = this.availMB(), total = os.totalmem() / 2 ** 30;
    const warnJob = avail < this.st.CriticalMB ? [...this.jobs].filter(j => !j.paused).sort((a, b) => b.ramMB - a.ramMB)[0] : null;
    const warn = warnJob ? `RAM is critically low: consider stopping the render for ${warnJob.session}${warnJob.project ? ' · ' + warnJob.project : ''}` : null;
    const cpuAll = (() => { const c = os.loadavg()[0] / CORES * 100; return Math.max(0, Math.min(100, Math.round(c * 10) / 10)); })();
    const state = {
      updated: localTime(), pid: process.pid, platform: 'darwin', cpu: cpuAll, gpu: this.gpu,
      ramUsedGB: +(total - avail / 1024).toFixed(2), ramTotalGB: +total.toFixed(2), ramAvailMB: avail, memoryPressure: this.pressure,
      active: this.active, idleSec: Math.round(this.idleSec), capNow: this.capNow, pauseMB: this.st.PauseMB, criticalMB: this.st.CriticalMB, slowCapPct: this.st.SlowCapPct,
      hotkeys: this.hotkeys, ramWarning: warn,
      settings: { ...this.st, LowPrio: !!this.st.LowPrio, HubStart: true, Startup: ONLY ? false : loginItemOn(HUB_DIR) },
      renders: this.jobs.map(j => ({ rootPid: j.rootPid, start: localTime(j.start), session: { id: null, title: j.session, dir: '' },
        cwd: j.cwd, project: j.project, what: j.what, cmd: j.cmd, progress: j.progress == null ? null : +j.progress.toFixed(3), etaSec: j.etaSec == null ? null : Math.round(j.etaSec),
        cpu: +j.cpu.toFixed(1), gpu: null, ramMB: j.ramMB, cap: j.cap, paused: j.paused, slow: j.slow, ramWarning: j === warnJob ? warn : null,
        logPath: j.logPath, lastLine: j.lastLine, finished: j.finished, pids: j.pids })),
    };
    try { fs.mkdirSync(DIR, { recursive: true }); const tmp = F.state + '.' + process.pid + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(state, null, 1)); fs.renameSync(tmp, F.state); }
    catch (e) { errLog('state: ' + e.message); }
  }
  // STARTED / FINISHED / CLOSED lines, as the Windows agent writes them (the hub's "Recent renders" reads FINISHED)
  logChanges() {
    const now = new Map(this.jobs.map(j => [j.rootPid, j]));
    for (const j of this.jobs) if (!this.prevJobs.has(j.rootPid)) history(`STARTED   ${j.session}  [${j.project}]  ${j.what}  (pid ${j.rootPid})`);
    for (const [r, j] of this.prevJobs) if (!now.has(r)) { const done = j.finished || (j.progress ?? 0) >= 0.99; history(`${done ? 'FINISHED     ' : 'CLOSED   '}${j.session}  [${j.project}]  ${j.what}  ${dur((Date.now() - j.start) / 1000)}${j.progress != null ? '  ' + Math.round(j.progress * 100) + '%' : ''}`); }
    this.prevJobs = now;
  }

  // ----- the loop: every 2 s while renders run, every 4 s otherwise; commands and settings wake it at once
  wake() { clearTimeout(this.wakeTimer); this.wakeTimer = setTimeout(() => this.loop(), 30); }
  async loop() {
    clearTimeout(this.wakeTimer);
    if (this.busy) { this.wakeTimer = setTimeout(() => this.loop(), 200); return; }
    this.busy = true;
    try {
      if (this.mtime(F.settings) !== this.settingsMtime) this.reloadSettings('file');
      await this.drain();
      this.jobs = await this.collect();
      this.update(this.jobs);
      this.logChanges();
      this.writeState();
    } catch (e) { errLog('loop: ' + e.message); }
    this.busy = false;
    if (!this.released) this.wakeTimer = setTimeout(() => this.loop(), this.jobs.length ? 2000 : 4000);
  }
  // a render the last agent left stopped (it crashed or was killed): continue it
  thawOrphans(rows) {
    const prev = readJsonFile(F.state), had = new Set((prev?.renders || []).flatMap(r => r.pids || [r.rootPid]));
    for (const p of rows) if (p.stopped && had.has(p.pid) && (isRender(p) || had.has(p.pid))) { try { process.kill(p.pid, 'SIGCONT'); history(`FROZEN PROCESS RELEASED  pid ${p.pid}  ${p.name}`); } catch { } }
  }
  release() {
    if (this.released) return;
    this.resumeAll();
    this.released = true;
    clearTimeout(this.cycleTimer); clearTimeout(this.wakeTimer);
    for (const r of this.inStop) sig(this.tree.get(r), 'SIGCONT');
    for (const pids of this.tree.values()) sig(pids, 'SIGCONT');   // belt and braces: nothing stays stopped
    this.applyBackground(this.jobs, true);
    try { this.keys?.kill(); } catch { }
  }
  async start() {
    fs.mkdirSync(F.cmd, { recursive: true });
    this.thawOrphans(await processTable());
    fs.writeFileSync(F.pid, String(process.pid));
    try { fs.watch(F.cmd, () => this.wake()); } catch { }
    setInterval(() => this.wake(), 1000).unref?.();   // the watcher can miss events: a 1 s look at cmd/ catches them
    this.startKeys();
    this.watchdog();
    await this.loop();
  }
}

// "node render.js 2": the program's name, then its arguments with folders left out
export const shortCmd = (cmd, name) => {
  cmd = String(cmd || '');
  const app = /^.*?\.app\/Contents\/MacOS\/[^]*?(?=\s--|\s-\w|$)/.exec(cmd), exe = app ? app[0] : cmd.split(/\s+/)[0];
  const rest = cmd.slice(exe.length).replace(/(?:\S*\/)+([^\s/]+)/g, '$1').replace(/\s+/g, ' ').trim();
  const s = (name + ' ' + rest).trim(); return s.length > 90 ? s.slice(0, 90) + '…' : s;
};
const HOME = os.homedir(), DESKTOP = path.join(HOME, 'Desktop');
const shortPath = p => !p ? '' : p.startsWith(DESKTOP + '/') ? p.slice(DESKTOP.length + 1) : p.startsWith(HOME + '/') ? '~' + p.slice(HOME.length) : p;

// ---------- one agent per user; --quit stops it
const alive = pid => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };
function runningAgent() {
  let pid = 0; try { pid = +fs.readFileSync(F.pid, 'utf8').trim(); } catch { }
  if (!pid || pid === process.pid || !alive(pid)) return 0;
  try { return /agent-mac\.mjs/.test(execFileSync('ps', ['-o', 'args=', '-p', String(pid)]).toString()) ? pid : 0; } catch { return 0; }
}
async function main() {
  if (ARGV.includes('--quit')) {
    const pid = runningAgent(); if (!pid) return;
    process.kill(pid, 'SIGTERM');
    for (let i = 0; i < 25 && alive(pid); i++) await new Promise(r => setTimeout(r, 200));
    return;
  }
  if (runningAgent()) return;   // already running
  const a = new Agent();
  const bye = code => { a.release(); try { if (+fs.readFileSync(F.pid, 'utf8') === process.pid) fs.unlinkSync(F.pid); } catch { } process.exit(code); };
  for (const s of ['SIGTERM', 'SIGINT', 'SIGHUP']) process.on(s, () => bye(0));
  process.on('uncaughtException', e => { errLog('fatal: ' + (e.stack || e.message)); bye(1); });
  process.on('unhandledRejection', e => { errLog('fatal: ' + (e?.stack || e)); bye(1); });
  await a.start();
}
if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) main();
