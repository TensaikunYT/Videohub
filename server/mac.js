// macOS counterparts of the Windows calls VideoHub makes: Finder instead of Explorer, the Trash instead of the Recycle
// Bin, Notification Center instead of toasts, the system folder dialog, a LaunchAgent instead of the Run registry key,
// caffeinate so a long render is not cut by idle sleep, and the process table (ps) the agent and the RAM list read.
// Only tools every macOS has (open, osascript, ps, lsof, ioreg, sysctl, caffeinate, system_profiler); none of them
// needs a permission prompt (the Trash goes through NSFileManager, not Finder, so no "control Finder" request).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, execFile } from 'node:child_process';

const quietSpawn = (cmd, args, opts = {}) => { try { const c = spawn(cmd, args, { detached: true, stdio: 'ignore', ...opts }); c.on('error', () => { }); c.unref(); return c; } catch { return null; } };
const exec = (cmd, args, opts = {}) => new Promise(resolve => execFile(cmd, args, { maxBuffer: 32 << 20, timeout: 20000, ...opts }, (err, stdout, stderr) => resolve({ code: err ? (typeof err.code === 'number' ? err.code : 1) : 0, stdout: String(stdout || ''), stderr: String(stderr || '') })));

// ---------- Finder, browser window, notifications
// a file or folder in its own app (videos in QuickTime / the default player), or shown selected in Finder (reveal)
export const openArgs = (target, reveal = false) => reveal ? ['-R', target] : [target];
export function openPath(target, reveal = false) { return quietSpawn('open', openArgs(target, reveal)); }

// VideoHub's window: a Chromium "app" window (no tabs, no address bar) like Edge --app on Windows. Started through the
// browser binary so a running browser just opens the window (its single-instance handoff); else the default browser.
export function openAppWindow(url, browser) {
  if (browser && fs.existsSync(browser)) return quietSpawn(browser, ['--app=' + url]);
  return quietSpawn('open', [url]);
}

// AppleScript strings travel as arguments (argv), never pasted into the script: no quoting problems, no injection
export const notifyArgs = (title, body) => ['-e', 'on run argv', '-e', 'display notification (item 2 of argv) with title "VideoHub" subtitle (item 1 of argv)', '-e', 'end run',
  String(title || '').slice(0, 200), String(body || '').slice(0, 200)];
export function notify(title, body) { return quietSpawn('osascript', notifyArgs(title, body)); }

// ---------- the folder dialog: the standard macOS "Choose" sheet, in front of every window; null when cancelled
export function pickFolder(start, title = 'Choose folder') {
  const okStart = typeof start === 'string' && start && fs.existsSync(start) && fs.statSync(start).isDirectory();
  const script = ['on run argv', 'activate',
    okStart ? 'set p to choose folder with prompt (item 1 of argv) default location (POSIX file (item 2 of argv))' : 'set p to choose folder with prompt (item 1 of argv)',
    'return POSIX path of p', 'end run'];
  return exec('osascript', [...script.flatMap(l => ['-e', l]), String(title), okStart ? start : ''], { timeout: 0 })
    .then(r => r.code === 0 && r.stdout.trim() ? r.stdout.trim().replace(/(.)\/$/, '$1') : null);
}

// ---------- the Trash (never a hard delete). JavaScript for Automation calls NSFileManager.trashItemAtURL for each
// path and prints one JSON line per item as it goes ({n, code: 0} or {n, code: 1, err}), the same stream contract as
// the Windows Recycle Bin script. A volume without a Trash (some network shares) fails here instead of deleting.
// (No NSError out-parameter: osascript crashes on it when the move fails. The reason is worked out afterwards.)
const TRASH_JXA = `ObjC.import('Foundation');
function run(argv) {
  var fm = $.NSFileManager.defaultManager, out = $.NSFileHandle.fileHandleWithStandardOutput;
  var list = JSON.parse(ObjC.unwrap($.NSString.stringWithContentsOfFileEncodingError(argv[0], $.NSUTF8StringEncoding, null)));
  for (var n = 0; n < list.length; n++) {
    var ok = false, msg = null, p = list[n];
    try { ok = fm.trashItemAtURLResultingItemURLError($.NSURL.fileURLWithPath(p), null, null); } catch (e) { msg = String(e); }
    if (!ok && !msg) msg = !fm.fileExistsAtPath(p) ? 'Not found.'
      : !fm.isWritableFileAtPath(ObjC.unwrap($(p).stringByDeletingLastPathComponent)) ? 'Access denied (no permission to move it).'
      : 'Could not move it to the Trash (in use, or this volume has no Trash); left untouched to avoid permanent deletion.';
    var line = JSON.stringify(ok ? { n: n, code: 0 } : { n: n, code: 1, err: msg }) + '\\n';
    out.writeData($(line).dataUsingEncoding($.NSUTF8StringEncoding));
  }
  return '';
}`;
// items: [{path}], onItem(item, code, err) once per item (code 0 = in the Trash)
export function trashStream(items, onItem, { dataDir = os.tmpdir() } = {}) {
  return new Promise(resolve => {
    if (!items.length) return resolve();
    const listFile = path.join(dataDir, `trash-${process.pid}-${Date.now()}.json`);
    fs.writeFileSync(listFile, JSON.stringify(items.map(i => i.path)));
    const p = spawn('osascript', ['-l', 'JavaScript', '-e', TRASH_JXA, listFile]);
    let buf = '', err = '', seen = 0, timer = null;
    const arm = () => { clearTimeout(timer); timer = setTimeout(() => { try { p.kill(); } catch { } }, 5 * 60e3); };
    arm();
    p.stdout.on('data', d => {
      buf += d; let k;
      while ((k = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, k).trim(); buf = buf.slice(k + 1);
        if (!line.startsWith('{')) continue;
        try { const j = JSON.parse(line); seen = Math.max(seen, j.n + 1); onItem(items[j.n], j.code, j.code ? j.err || 'Could not move to the Trash.' : undefined); arm(); } catch { }
      }
    });
    p.stderr.on('data', d => { err += d; });
    const end = () => {
      clearTimeout(timer); try { fs.unlinkSync(listFile); } catch { }
      for (let i = seen; i < items.length; i++) onItem(items[i], null, (err.trim().split('\n').pop() || 'The Trash helper stopped (timeout or error).').slice(0, 300));
      resolve();
    };
    p.on('close', end); p.on('error', e => { err += e.message; end(); });
  });
}

// ---------- graphics: what Settings shows next to "graphics card can encode video" (Apple M2, Intel Iris, AMD Radeon …)
export async function gpuNames() {
  const r = await exec('system_profiler', ['SPDisplaysDataType', '-json'], { timeout: 15000 });
  try { return [...new Set((JSON.parse(r.stdout).SPDisplaysDataType || []).map(g => g.sppci_model || g._name).filter(Boolean))]; } catch { return []; }
}

// ---------- processes. One `ps` for the whole table (~20 ms): pid, parent, resident MB, start (from elapsed time),
// CPU seconds used, state (T = stopped), the command line. `args` is last because paths contain spaces.
export const PS_ARGS = ['-axww', '-o', 'pid=,ppid=,rss=,etime=,time=,stat=,args='];
const secs = t => { // "[[dd-]hh:]mm:ss[.cc]" → seconds
  const m = /^(?:(\d+)-)?(.*)$/.exec(String(t || '').trim()); if (!m) return 0;
  return (+m[1] || 0) * 86400 + m[2].split(':').reduce((s, x) => s * 60 + (+x || 0), 0);
};
export function parsePs(text, nowMs = Date.now()) {
  const out = [];
  for (const line of String(text).split('\n')) {
    const m = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(.*)$/.exec(line); if (!m) continue;
    const args = m[7].trim();
    out.push({ pid: +m[1], ppid: +m[2], ramMB: Math.round(+m[3] / 1024), start: nowMs - secs(m[4]) * 1000, cpuSec: secs(m[5]), stopped: m[6][0] === 'T', cmd: args, name: procName(args), app: appName(args) });
  }
  return out;
}
export const processTable = () => exec('ps', PS_ARGS, { timeout: 10000 }).then(r => r.code === 0 ? parsePs(r.stdout) : []);
// the program's file name: the part of the command up to the first space that is not inside an .app bundle path
export function procName(args) {
  const a = String(args || '');
  const app = /^(.*?\.app\/Contents\/(?:MacOS|Frameworks)\/[^]*?)(?=\s--|\s-\w|$)/.exec(a);
  const exe = app ? app[1] : a.split(/\s+/)[0];
  return path.basename(exe);
}
// the app a process belongs to (helpers count with their app: "Google Chrome Helper (Renderer)" → "Google Chrome")
export function appName(args) {
  const m = /\/([^/]+?)\.app\/Contents\//.exec(String(args || ''));
  return m ? m[1] : procName(args);
}
export const childrenOf = rows => { const ch = new Map(); for (const r of rows) { if (r.ppid === r.pid) continue; (ch.get(r.ppid) || ch.set(r.ppid, []).get(r.ppid)).push(r.pid); } return ch; };
// a process and everything started under it (children started after their parent: no pid-reuse mix-ups)
export function treeOf(rows, root) {
  const by = new Map(rows.map(r => [r.pid, r])), ch = childrenOf(rows), out = [], q = [root];
  while (q.length) { const x = q.shift(); if (!by.has(x) || out.includes(x)) continue; out.push(x); for (const c of ch.get(x) || []) if (by.get(c).start >= by.get(x).start - 1000) q.push(c); }
  return out;
}
// the folder a process runs in (lsof; ~30 ms, callers cache it per render)
export const cwdOf = pid => exec('lsof', ['-a', '-p', String(pid), '-d', 'cwd', '-Fn'], { timeout: 5000 }).then(r => (/^n(.*)$/m.exec(r.stdout) || [])[1] || null);

// stop a process tree: TERM (and CONT, so a paused render can act on it), then KILL what is left after `graceMs`
export async function killTree(pid, graceMs = 3000) {
  const rows = await processTable(), pids = treeOf(rows, +pid);
  if (!pids.length) pids.push(+pid);
  const sig = (s) => { for (const p of pids) { try { process.kill(p, s); } catch { } } };
  sig('SIGTERM'); sig('SIGCONT');
  await new Promise(r => setTimeout(r, graceMs));
  sig('SIGKILL');
  return pids.length;
}

// a render keeps the Mac awake (idle sleep only; the display may still sleep) for as long as its process lives
export function keepAwake(pid) { return quietSpawn('caffeinate', ['-i', '-w', String(pid)]); }

// ---------- memory: what macOS can hand out without swapping (free + inactive pages; Node's process.availableMemory
// reads exactly that on darwin) and the kernel's own pressure verdict (1 normal, 2 warning, 4 critical)
export const availableMB = () => Math.round((typeof process.availableMemory === 'function' ? process.availableMemory() : os.freemem()) / 1048576);
export const memoryPressure = () => exec('sysctl', ['-n', 'kern.memorystatus_vm_pressure_level'], { timeout: 3000 }).then(r => +r.stdout.trim() || 1);

// ---------- start at login: a LaunchAgent that runs the hub (no window), the Mac's "Start with Windows"
export const LOGIN_LABEL = 'local.videohub.hub';
export const loginPlistPath = (home = os.homedir()) => path.join(home, 'Library', 'LaunchAgents', LOGIN_LABEL + '.plist');
const xml = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
// node: a stable path (Homebrew's /opt/homebrew/bin/node survives upgrades; the Cellar path does not)
export function stableNode(execPath = process.execPath) {
  for (const p of ['/opt/homebrew/bin/node', '/usr/local/bin/node']) { try { if (fs.realpathSync(p) === fs.realpathSync(execPath)) return p; } catch { } }
  return execPath;
}
export function loginPlist(hubDir, node = stableNode(), home = os.homedir()) {
  const logs = path.join(home, 'Library', 'Logs', 'VideoHub');
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${LOGIN_LABEL}</string>
  <key>ProgramArguments</key>
  <array><string>${xml(node)}</string><string>${xml(path.join(hubDir, 'server', 'hub.js'))}</string></array>
  <key>WorkingDirectory</key><string>${xml(hubDir)}</string>
  <key>RunAtLoad</key><true/>
  <!-- renders the hub starts must run at full speed: no background throttling of this job -->
  <key>ProcessType</key><string>Interactive</string>
  <key>StandardOutPath</key><string>${xml(path.join(logs, 'hub.log'))}</string>
  <key>StandardErrorPath</key><string>${xml(path.join(logs, 'hub.log'))}</string>
</dict>
</plist>
`;
}
// on: this install's hub starts at login
export function loginItemOn(hubDir, home = os.homedir()) {
  try { return fs.readFileSync(loginPlistPath(home), 'utf8').includes(xml(path.join(hubDir, 'server', 'hub.js'))); } catch { return false; }
}
export function setLoginItem(on, hubDir, home = os.homedir()) {
  const f = loginPlistPath(home);
  if (on) {
    fs.mkdirSync(path.dirname(f), { recursive: true }); fs.mkdirSync(path.join(home, 'Library', 'Logs', 'VideoHub'), { recursive: true });
    fs.writeFileSync(f, loginPlist(hubDir, stableNode(), home));
  } else if (fs.existsSync(f)) {
    // only this install's entry; launchd forgets it at the next login (bootout would also stop a running hub)
    if (loginItemOn(hubDir, home)) fs.unlinkSync(f);
  }
  return loginItemOn(hubDir, home);
}

// ---------- the Mac itself: chip, performance cores, memory (Settings / render dialog hints)
export async function machine() {
  const r = await exec('sysctl', ['-n', 'machdep.cpu.brand_string', 'hw.perflevel0.physicalcpu', 'hw.physicalcpu', 'hw.memsize'], { timeout: 3000 });
  const [chip, perf, phys, mem] = r.stdout.trim().split('\n');
  const appleSilicon = process.arch === 'arm64' || /Apple/.test(chip || '');
  return { chip: chip || os.cpus()[0]?.model || '', appleSilicon, perfCores: +perf || +phys || os.cpus().length, cores: os.cpus().length, ramGB: Math.round((+mem || os.totalmem()) / 2 ** 30) };
}
