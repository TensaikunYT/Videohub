// Bridge to VideoHub's render-protection agent (guard\VideoHubAgent.exe, formerly RenderGuard.exe: invisible — no window,
// no tray icon; VideoHub starts and stops it) and to Snipp's render status files. On a Mac the agent is
// guard/agent-mac.mjs (Node, same files and commands, in ~/Library/Application Support/RenderGuard).
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { config } from './config.js';
import { APPDATA, HUB_DIR, IS_MAC, readJson, writeJson, run, powershell, processAlive } from './util.js';
import { loginItemOn, setLoginItem } from './mac.js';

const RG = path.join(APPDATA, 'RenderGuard');   // state.json, cmd\, settings.txt, history.log (unchanged folder name)

// live state written by RenderGuard every ~2 s (null when it is not running or is an older build)
export function guardState() {
  const s = readJson(path.join(RG, 'state.json'));
  if (!s) return { running: false, reason: 'render protection is off (no state.json)' };
  const age = (Date.now() - new Date(s.updated).getTime()) / 1000;
  if (IS_MAC && age >= 10) thawStale(s);
  // a state file RenderGuard stopped writing still lists the renders it last saw: they are not running (a render that
  // had ended hours before still counted as running)
  return { running: age < 10, age, ...s, ...(age < 10 ? {} : { renders: [], staleRenders: s.renders || [] }) };
}

// RenderGuard history.log lines: "2026-10-23 18:07:04  FINISHED     <session>  [<project>]  <what>  <dur>  NN%"
// The log is ~2 MB and was read and parsed on every /api/project/:id and /api/renders: now parsed once, kept by
// size+mtime, and when it only grew just the new lines are read (from the last complete line on).
// Agents built by older (Turkish) versions wrote Turkish event words; they are read as the English ones.
const LEGACY_EVENTS = { 'BA\u015eLADI': 'STARTED', 'B\u0130TT\u0130': 'FINISHED', KAPANDI: 'CLOSED', HATA: 'ERROR', '\u00d6LD\u00dc': 'KILLED', DURDU: 'STOPPED',
  DURAKLATILDI: 'PAUSED', DEVAM: 'RESUMED', 'YAVA\u015eLATILDI': 'SLOWED', 'AC\u0130L': 'EMERGENCY', 'V\u0130DEOHUB': 'VIDEOHUB', KOMUT: 'COMMAND', AYARLAR: 'SETTINGS' };
const LEGACY_UNITS = { sn: 's', dk: 'min', sa: 'h' };
const legacyEvent = e => { const w = e.split(' ')[0]; return LEGACY_EVENTS[w] ? LEGACY_EVENTS[w] + e.slice(w.length).replace('(elle)', '(manual)') : e; };
const parseLine = l => {
  const m = l.match(/^(\d{4}-\d\d-\d\d \d\d:\d\d:\d\d)\s+(\S+(?: \([^)]*\))?)\s+(.*)$/);
  if (!m) return null;
  const rest = m[3].replace(/(\d+)\s*(sn|dk|sa)\b/g, (x, n, u) => n + ' ' + LEGACY_UNITS[u]), pm = rest.match(/\[([^\]]*)\]/);
  return { at: m[1].replace(' ', 'T'), event: legacyEvent(m[2].trim()), session: pm ? rest.slice(0, pm.index).trim() : '', project: pm ? pm[1] : '', detail: pm ? rest.slice(pm.index + pm[0].length).trim() : rest };
};
// hist: { size, mtime, end (bytes up to the last newline), sig (the bytes just before end), entries (complete lines,
// one per non-empty line, null = unparsable), all (+ a last line still being written: counted, read again next time) }
let hist = null;
function loadHistory() {
  const f = path.join(RG, 'history.log');
  let st; try { st = fs.statSync(f); } catch { hist = null; return null; }
  if (hist && hist.size === st.size && hist.mtime === st.mtimeMs) return hist;
  let fd; try { fd = fs.openSync(f, 'r'); } catch { return hist; }
  try {
    const readAt = (pos, len) => { const b = Buffer.alloc(len); return b.subarray(0, fs.readSync(fd, b, 0, len, pos)); };
    // only appended to (RenderGuard's way): read from the last complete line; rewritten or shorter: read it all
    const grew = hist && st.size > hist.size && readAt(hist.end - hist.sig.length, hist.sig.length).equals(hist.sig);
    const from = grew ? hist.end : 0, buf = readAt(from, st.size - from);
    const nl = buf.lastIndexOf(10), done = buf.subarray(0, nl + 1), tail = buf.subarray(nl + 1);
    const parse = b => b.toString('utf8').split(/\r?\n/).filter(Boolean).map(parseLine);
    const entries = (grew ? hist.entries : []).concat(parse(done)), end = from + done.length;
    hist = { size: st.size, mtime: st.mtimeMs, end, sig: readAt(Math.max(0, end - 64), Math.min(64, end)), entries, all: tail.length ? entries.concat(parse(tail)) : entries };
  } catch { } finally { fs.closeSync(fd); }
  return hist;
}
export function guardHistory(limit = 400) {
  const h = loadHistory(); if (!h) return [];
  return h.all.slice(-limit).filter(Boolean).reverse();
}

export function guardCommand(action, rootPid, extra = {}) {
  const dir = path.join(RG, 'cmd');
  writeJson(path.join(dir, `${Date.now()}-${action}.json`), { action, rootPid: rootPid ? +rootPid : undefined, ...extra });
  return { ok: true, note: guardState().running ? null : 'Render protection is not running; the command was saved and will run when it starts.' };
}

// A Mac agent that died without cleaning up (killed, crashed) may have left a render stopped mid-cycle: continue the
// processes its last state listed, once per stale state. SIGCONT does nothing to a process that is running.
let thawed = null;
function thawStale(s) {
  if (thawed === s.updated || process.env.VIDEOHUB_GUARD === 'off' || (s.pid && processAlive(s.pid))) return;
  thawed = s.updated;
  for (const r of s.renders || []) for (const pid of r.pids || []) { try { process.kill(pid, 'SIGCONT'); } catch { } }
}

// ---------- agent settings (settings.txt, key=value). VideoHub is its only UI.
const SETTINGS = path.join(RG, 'settings.txt');
// LowPrio on a Mac means "background while you use the Mac" (Apple silicon: efficiency cores only): off by default
const DEFAULTS = { CapActive: 90, CapIdle: 100, IdleMin: 2, PauseMB: 700, CriticalMB: 500, SlowCapPct: 5, LowPrio: IS_MAC ? 0 : 1 };
const RUN_KEY = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run';
// "Start with Windows" starts VideoHub itself, without a window (open.vbs --server); the hub then stays on and
// starts the agent. Older builds had a "RenderGuard" entry that started RenderGuard.exe: it is replaced.
const RUN_NAME = 'VideoHub', RUN_LEGACY = 'RenderGuard';
const startupCommand = () => `"${path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'wscript.exe')}" "${path.join(HUB_DIR, 'open.vbs')}" --server`;
function readKv() {
  const kv = {}; let txt = ''; try { txt = fs.readFileSync(SETTINGS, 'utf8').replace(/^﻿/, ''); } catch { }
  for (const l of txt.split(/\r?\n/)) { const i = l.indexOf('='); if (i > 0) kv[l.slice(0, i).trim()] = l.slice(i + 1).trim(); }
  return kv;
}
export async function guardSettings() {
  const kv = readKv(), out = {};
  for (const [k, d] of Object.entries(DEFAULTS)) out[k] = kv[k] != null && kv[k] !== '' ? +kv[k] : d;
  if (IS_MAC) out.Startup = loginItemOn(HUB_DIR);   // ~/Library/LaunchAgents/local.videohub.hub.plist
  else {
    const r = await run('reg', ['query', RUN_KEY, '/v', RUN_NAME]), old = await run('reg', ['query', RUN_KEY, '/v', RUN_LEGACY]);
    out.Startup = (r.code === 0 && /open\.vbs/i.test(r.stdout)) || (old.code === 0 && /RenderGuard/i.test(old.stdout));
  }
  out.exe = guardExe();
  return out;
}
// guard\VideoHubAgent.exe; an install that was not rebuilt yet still has guard\RenderGuard.exe
const GUARD_DIR = path.join(HUB_DIR, 'guard');
export function guardExe() {
  if (IS_MAC) { const f = path.join(GUARD_DIR, 'agent-mac.mjs'); return fs.existsSync(f) ? f : null; }
  const at = [path.join(GUARD_DIR, 'VideoHubAgent.exe'), path.join(GUARD_DIR, 'RenderGuard.exe')];
  return at.find(f => fs.existsSync(f)) || null;
}
export async function saveGuardSettings(patch) {
  const kv = readKv();
  for (const k of Object.keys(DEFAULTS)) if (patch[k] != null) kv[k] = String(typeof patch[k] === 'boolean' ? (patch[k] ? 1 : 0) : Math.round(+patch[k]));
  fs.mkdirSync(RG, { recursive: true });
  fs.writeFileSync(SETTINGS, Object.entries(kv).map(([k, v]) => `${k}=${v}`).join('\r\n'));
  if (patch.Startup != null && IS_MAC) setLoginItem(!!patch.Startup, HUB_DIR);
  else if (patch.Startup != null) {
    if (patch.Startup) await run('reg', ['add', RUN_KEY, '/v', RUN_NAME, '/t', 'REG_SZ', '/d', startupCommand(), '/f']);
    else await run('reg', ['delete', RUN_KEY, '/v', RUN_NAME, '/f']);
    await run('reg', ['delete', RUN_KEY, '/v', RUN_LEGACY, '/f']);
  }
  guardCommand('reload');
  return guardSettings();
}

// The agent runs only while VideoHub is used: the hub starts it (hidden, --agent) when a VideoHub page opens or a render
// starts, and asks it to quit when the hub idles out. It never starts the hub. A second copy exits at once (one per user).
// Only this install's guard folder counts: test copies elsewhere (--only) must not look like the real agent.
export async function guardProcRunning() {
  if (IS_MAC) {   // the agent's pid file, and that pid really is this install's agent
    let pid = 0; try { pid = +fs.readFileSync(path.join(RG, 'agent.pid'), 'utf8').trim(); } catch { }
    if (!pid || !processAlive(pid)) return false;
    const r = await run('ps', ['-o', 'args=', '-p', String(pid)]);
    return r.stdout.includes(path.join(GUARD_DIR, 'agent-mac.mjs'));
  }
  const dir = GUARD_DIR.replace(/'/g, "''") + '\\';
  const r = await powershell(`@(Get-CimInstance Win32_Process -Filter "Name='VideoHubAgent.exe' OR Name='RenderGuard.exe'" | Where-Object { $_.ExecutablePath -and $_.ExecutablePath.StartsWith('${dir}', [StringComparison]::OrdinalIgnoreCase) }).Count`);
  return +r.stdout.trim() > 0;
}
export async function ensureGuard() {
  if (guardState().running) return false;
  const exe = guardExe(); if (!exe) return false;
  if (IS_MAC) { try { spawn(process.execPath, [exe, '--agent'], { detached: true, stdio: 'ignore', cwd: HUB_DIR }).unref(); return true; } catch { return false; } }
  // an old RenderGuard.exe (install not rebuilt yet) knows only --tray: --agent would make it open a VideoHub window
  const args = /RenderGuard\.exe$/i.test(exe) ? ['--tray'] : ['--agent'];
  try { spawn(exe, args, { detached: true, stdio: 'ignore', windowsHide: true }).unref(); return true; } catch { return false; }
}
export async function quitGuard() {
  const exe = guardExe(); if (!exe || !(await guardProcRunning())) return true;
  if (IS_MAC) await run(process.execPath, [exe, '--quit']);   // SIGTERM to the running agent: it continues every render and exits
  else await run(exe, ['--quit']);   // signals the running copy: it lifts its CPU caps and exits
  for (let i = 0; i < 20; i++) { await new Promise(r => setTimeout(r, 400)); if (!(await guardProcRunning())) return true; }
  return false;
}

// Snipp writes <output>\.renders\<name>.json (RenderStatus v1) for every export
export function snippRenders() {
  const out = [];
  for (const r of config().roots) {
    if (r.enabled === false) continue;
    const dir = path.join(r.path, '.renders');
    let files = []; try { files = fs.readdirSync(dir).filter(f => f.endsWith('.json')); } catch { continue; }
    for (const f of files) {
      const j = readJson(path.join(dir, f)); if (!j) continue;
      let mtime = 0; try { mtime = fs.statSync(path.join(dir, f)).mtimeMs; } catch { }
      out.push({ source: 'snipp', name: f.replace(/\.json$/, ''), state: j.state, progress: j.progress, label: j.label, output: j.output, error: j.error, updated: mtime });
    }
  }
  return out.sort((a, b) => b.updated - a.updated).slice(0, 50);
}
