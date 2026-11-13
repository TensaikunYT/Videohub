// VideoHub's render protection, built into the hub (plain Node + OS tools; no helper program).
// The legacy guard\VideoHubAgent.exe (formerly RenderGuard.exe) was compiled during installation and used process
// suspension and global hotkeys. Current protection uses Node and operating-system commands; it builds no helper.
// What protection still does:
//  - every render VideoHub's queue starts gets a CPU limit (processor affinity: a share of the cores) and low priority;
//    Windows passes both on to every process the render starts later (Chrome, ffmpeg)
//  - free RAM is watched: below PauseMB the newest render slows down (idle priority, SlowCapPct of the cores), below
//    CriticalMB every render does; when RAM is back they return to normal speed, oldest first
//  - Slow down / Normal speed / Stop per render on the Renders page
// What it no longer does: freeze (pause) a render, the Ctrl+Alt+End / Ctrl+Alt+Home hotkeys, and watching renders that
// were started outside VideoHub's queue. The exported names stay the same, so the queue, cleanup and UI did not change.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { config } from './config.js';
import { readJson, processAlive } from './util.js';
import { dirs, capabilities, availableMemory, getAutostart, setAutostart, cleanupLegacyAutostart, setTreePriority, killTree } from './platform.js';

const RG = dirs.guard;   // Windows keeps RenderGuard so existing settings and history remain readable.
const MB = 1048576, CORES = os.cpus().length;

// ---------- settings (settings.txt, key=value). VideoHub is its only UI.
const SETTINGS = path.join(RG, 'settings.txt');
const DEFAULTS = { CapActive: 90, CapIdle: 100, IdleMin: 2, PauseMB: 700, CriticalMB: 500, SlowCapPct: 5, LowPrio: 1 };
function readKv() {
  const kv = {}; let txt = ''; try { txt = fs.readFileSync(SETTINGS, 'utf8').replace(/^\uFEFF/, ''); } catch { }
  for (const l of txt.split(/\r?\n/)) { const i = l.indexOf('='); if (i > 0) kv[l.slice(0, i).trim()] = l.slice(i + 1).trim(); }
  return kv;
}
function current() {
  const kv = readKv(), out = {};
  for (const [k, d] of Object.entries(DEFAULTS)) out[k] = kv[k] != null && kv[k] !== '' && Number.isFinite(+kv[k]) ? +kv[k] : d;
  return out;
}
let S = current();
export async function guardSettings() {
  const out = current();
  out.Startup = await getAutostart();
  out.exe = null; out.builtIn = true; out.capabilities = capabilities();
  return out;
}
export async function saveGuardSettings(patch) {
  const kv = readKv();
  for (const k of Object.keys(DEFAULTS)) if (patch[k] != null) kv[k] = String(typeof patch[k] === 'boolean' ? (patch[k] ? 1 : 0) : Math.round(+patch[k]));
  fs.mkdirSync(RG, { recursive: true });
  fs.writeFileSync(SETTINGS, Object.entries(kv).map(([k, v]) => `${k}=${v}`).join('\r\n'));
  if (patch.Startup != null) await setAutostart(!!patch.Startup);
  await cleanupLegacyAutostart();   // the old agent's autostart, if an old install left it
  guardCommand('reload');
  return guardSettings();
}
// there is no agent program any more (kept for callers and old UIs)
export const guardExe = () => null;

// ---------- the renders VideoHub started (the queue tells us: guardTrack) and what was applied to them
const tracked = new Map();   // root pid -> { rootPid, start, cwd, project, what, slow: null|'RAM'|'manual', applied, changedAt }
let timer = null, lastRamChange = 0, updated = null;
export function guardTrack(pid, info = {}) {
  if (!pid) return;
  const record = { rootPid: pid, start: new Date().toISOString(), cwd: info.cwd || '', project: info.project || '', what: info.what || '', slow: null, applied: null, changedAt: 0 };
  tracked.set(pid, record);
  if (timer) apply(record).catch(() => { });
  return record;
}
export function guardUntrack(pid, record) { if (record && tracked.get(pid) === record) { record.retired = true; tracked.delete(pid); } }

const coresFor = pct => Math.max(1, Math.min(CORES, Math.round(CORES * Math.max(1, Math.min(100, pct)) / 100)));
function wanted(r) {
  if (!timer) return { prio: 'Normal', cores: CORES };   // protection off (the hub is closing): everything back to normal
  if (r.slow) return { prio: 'Idle', cores: coresFor(S.SlowCapPct) };
  return { prio: S.LowPrio ? 'BelowNormal' : 'Normal', cores: coresFor(S.CapActive) };
}
// Apply once per change; processes the render starts later inherit the platform's limits.
async function apply(r, force = false) {
  if (force) r.applied = null;
  r.pending = true;
  if (r.applying) return r.applying;
  // Native commands can finish out of order. Finish one change before applying the latest requested state.
  r.applying = (async () => {
    while (r.pending && !r.retired) {
      r.pending = false;
      const w = wanted(r), key = w.prio + '/' + w.cores;
      if (r.applied === key) continue;
      await setTreePriority(r.rootPid, { Normal: 'normal', BelowNormal: 'low', Idle: 'idle' }[w.prio], w.cores);
      r.applied = key;
    }
  })().finally(() => { r.applying = null; });
  return r.applying;
}

// every 3 s while protection is on: forget renders that ended, slow down / restore for RAM
function tick() {
  for (const [pid, r] of tracked) {
    if (!processAlive(pid)) tracked.delete(pid);
    else apply(r).catch(() => { });   // Retry failed changes; unchanged settings spawn no OS command.
  }
  const free = availableMemory() / MB, list = [...tracked.values()].sort((a, b) => a.start.localeCompare(b.start));
  updated = new Date().toISOString();
  if (!list.length || Date.now() - lastRamChange < 20e3) return;   // one change at a time, then 20 s to settle (no ping-pong)
  const ram = list.filter(r => r.slow === 'RAM'), normal = list.filter(r => !r.slow);
  let pick = null, slow = null;
  if (free < S.CriticalMB && normal.length) { pick = normal[0]; slow = 'RAM'; }                         // even the oldest
  else if (free < S.PauseMB && normal.length > 1) { pick = normal[normal.length - 1]; slow = 'RAM'; }   // the newest first
  else if (free > S.PauseMB + 500 && ram.length) { pick = ram[0]; slow = null; }                       // back, oldest first
  if (!pick) return;
  pick.slow = slow; lastRamChange = Date.now();
  apply(pick).catch(() => { });
}

// live state (same shape the old agent wrote to state.json)
export function guardState() {
  if (!timer) return { running: false, reason: 'render protection is off', capabilities: capabilities() };
  const free = availableMemory() / MB;
  return {
    running: true, builtIn: true, capabilities: capabilities(), updated: updated || new Date().toISOString(), age: 0,
    ramAvailMB: Math.round(free), ramTotalMB: Math.round(os.totalmem() / MB), cpu: null, capNow: S.CapActive, hotkeys: false,
    pauseMB: S.PauseMB, criticalMB: S.CriticalMB, slowCapPct: S.SlowCapPct,
    renders: [...tracked.values()].map(r => ({ rootPid: r.rootPid, start: r.start, project: r.project, cwd: r.cwd, cmd: '', what: r.what, slow: r.slow, paused: false, cpu: null, ramMB: null })),
    settings: { ...S },
  };
}

// Renders page buttons and old callers. Freezing is gone: "pause" now slows the render down to the minimum instead.
export function guardCommand(action, rootPid) {
  const pick = rootPid ? [tracked.get(+rootPid)].filter(Boolean) : [...tracked.values()];
  let note = null;
  if (action === 'reload') { S = current(); for (const r of tracked.values()) apply(r).catch(() => { }); return { ok: true, note }; }
  if (action === 'kill') { for (const r of pick) killTree(r.rootPid).catch(() => { }); return { ok: true, note }; }
  if (/^(pause|pauseAll|slow)$/.test(action)) { if (action !== 'slow') note = 'Pausing is no longer available: the render was slowed down to the minimum instead.'; for (const r of pick) { r.slow = 'manual'; apply(r).catch(() => { }); } }
  else if (/^(resume|resumeAll|normal)$/.test(action)) for (const r of pick) { r.slow = null; apply(r).catch(() => { }); }
  else return { ok: false, note: 'unknown command' };
  if (!timer) note = 'Render protection is off right now.';
  return { ok: true, note };
}

// on while VideoHub is used (a page is open or a render runs); off when the hub idles out: renders back to normal
export async function guardProcRunning() { return !!timer; }
export async function ensureGuard() {
  if (timer) return false;
  S = current(); timer = setInterval(tick, 3000); timer.unref(); tick();
  for (const r of tracked.values()) apply(r, true).catch(() => { });
  return true;
}
export async function quitGuard() {
  if (!timer) return true;
  clearInterval(timer); timer = null;
  await Promise.all([...tracked.values()].map(r => apply(r, true).catch(() => { })));
  return true;
}

// ---------- the old agent's history.log (renders it saw end, also outside the queue): still read, no longer written
// "2026-10-23 18:07:04  BİTTİ     <session>  [<project>]  <what>  <dur>  %NN". Parsed once, kept by size+mtime.
const parseLine = l => {
  const m = l.match(/^(\d{4}-\d\d-\d\d \d\d:\d\d:\d\d)\s+(\S+(?: \([^)]*\))?)\s+(.*)$/);
  if (!m) return null;
  const rest = m[3], pm = rest.match(/\[([^\]]*)\]/);
  return { at: m[1].replace(' ', 'T'), event: m[2].trim(), session: pm ? rest.slice(0, pm.index).trim() : '', project: pm ? pm[1] : '', detail: pm ? rest.slice(pm.index + pm[0].length).trim() : rest };
};
let hist = null;
export function guardHistory(limit = 400) {
  const f = path.join(RG, 'history.log');
  let st; try { st = fs.statSync(f); } catch { return []; }
  if (!hist || hist.size !== st.size || hist.mtime !== st.mtimeMs) {
    try { hist = { size: st.size, mtime: st.mtimeMs, all: fs.readFileSync(f, 'utf8').split(/\r?\n/).filter(Boolean).map(parseLine) }; } catch { return []; }
  }
  return hist.all.slice(-limit).filter(Boolean).reverse();
}

// Snipp writes <cikti>\.renders\<name>.json (RenderStatus v1) for every export
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
