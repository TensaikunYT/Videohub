// Programs that hold a lot of RAM next to a render (an Android emulator once held 7.4 GB of a 16 GB PC during a render).
// Renders, Windows itself, the Claude app and VideoHub are left out; nothing is ever closed from here, the user decides.
import { execFile } from 'node:child_process';
import { processTable } from './mac.js';

const NAMES = {
  mumunxdevice: 'MuMuPlayer (Android emulator)', mumunxmain: 'MuMuPlayer (Android emulator)', mumuplayer: 'MuMuPlayer (Android emulator)',
  mumuvmmheadless: 'MuMuPlayer (Android emulator)', mumuvmmsvc: 'MuMuPlayer (Android emulator)', mumumultiplayer: 'MuMuPlayer (Android emulator)',
  'hd-player': 'BlueStacks (Android emulator)', 'hd-agent': 'BlueStacks (Android emulator)', ldplayer: 'LDPlayer (Android emulator)', 'dnplayer': 'LDPlayer (Android emulator)',
  noxvmhandle: 'Nox (Android emulator)', nox: 'Nox (Android emulator)',
  chrome: 'Chrome (browser)', msedge: 'Edge (browser)', firefox: 'Firefox', opera: 'Opera', brave: 'Brave',
  discord: 'Discord', steam: 'Steam', steamwebhelper: 'Steam', epicgameslauncher: 'Epic Games', obs64: 'OBS',
  razerappengine: 'Razer Synapse', spotify: 'Spotify', telegram: 'Telegram', whatsapp: 'WhatsApp', teams: 'Teams', 'ms-teams': 'Teams',
  code: 'VS Code', photoshop: 'Photoshop', 'adobe premiere pro': 'Premiere Pro', afterfx: 'After Effects', resolve: 'DaVinci Resolve',
  blender: 'Blender', vmmem: 'WSL / virtual machine', vmmemwsl: 'WSL / virtual machine', 'vmware-vmx': 'VMware', virtualboxvm: 'VirtualBox',
};
// never listed: Windows, drivers, antivirus, the Claude app, the render tools themselves
const SKIP = new Set(['system', 'registry', 'memory compression', 'idle', 'secure system', 'smss', 'csrss', 'wininit', 'winlogon', 'services', 'lsass',
  'svchost', 'dwm', 'explorer', 'msmpeng', 'nissrv', 'searchhost', 'searchindexer', 'startmenuexperiencehost', 'shellexperiencehost', 'textinputhost',
  'runtimebroker', 'ctfmon', 'fontdrvhost', 'sihost', 'taskhostw', 'audiodg', 'conhost', 'powershell', 'pwsh', 'cmd', 'wmiprvse', 'spoolsv',
  'claude', 'node', 'ffmpeg', 'ffprobe', 'renderguard', 'msedgewebview2', 'radeonsoftware', 'amdrssrcext', 'atieclxx', 'atiesrxx', 'amdfendrsr',
  'nvcontainer', 'nvdisplay.container', 'lockapp', 'widgets', 'phoneexperiencehost', 'securityhealthservice', 'smartscreen', 'dllhost', 'applicationframehost']);

const PS = `Get-CimInstance Win32_Process | ForEach-Object { [pscustomobject]@{ n = $_.Name; p = [int]$_.ProcessId; pp = [int]$_.ParentProcessId; m = [int64]$_.PrivatePageCount; h = [bool]($_.CommandLine -match '--headless|--app=http://127\\.0\\.0\\.1') } } | ConvertTo-Json -Compress`;

// ---------- a Mac: one `ps`, processes counted with the app they belong to (Chrome's helpers are Chrome)
const MAC_NAMES = {
  'Google Chrome': 'Chrome (browser)', 'Microsoft Edge': 'Edge (browser)', 'Brave Browser': 'Brave', 'Arc': 'Arc (browser)', firefox: 'Firefox', Firefox: 'Firefox', Safari: 'Safari',
  'com.apple.WebKit.WebContent': 'Safari / web views', Code: 'VS Code', Cursor: 'Cursor', Docker: 'Docker', 'com.docker.backend': 'Docker', 'com.docker.virtualization': 'Docker',
  'qemu-system-aarch64': 'virtual machine (QEMU)', 'qemu-system-x86_64': 'virtual machine (QEMU)', 'Parallels Desktop': 'Parallels', 'prl_vm_app': 'Parallels', UTM: 'UTM (virtual machine)',
  'VirtualBoxVM': 'VirtualBox', 'com.apple.Virtualization.VirtualMachine': 'virtual machine', Xcode: 'Xcode', Simulator: 'iOS Simulator', 'Final Cut Pro': 'Final Cut Pro',
  'DaVinci Resolve': 'DaVinci Resolve', Blender: 'Blender', OBS: 'OBS', Spotify: 'Spotify', Discord: 'Discord', Slack: 'Slack', 'Microsoft Teams': 'Teams', 'zoom.us': 'Zoom',
  'Android Studio': 'Android Studio', 'qemu-system-aarch64-headless': 'Android emulator', Steam: 'Steam', Photoshop: 'Photoshop', 'Adobe Photoshop': 'Photoshop',
};
// never listed: macOS itself, the Claude app, the render tools and VideoHub
const MAC_SKIP = /^(kernel_task|launchd|WindowServer|loginwindow|Finder|Dock|SystemUIServer|ControlCenter|NotificationCenter|Spotlight|mds.*|mdworker.*|corespotlightd|logd|opendirectoryd|cfprefsd|distnoted|trustd|syspolicyd|securityd|tccd|configd|fseventsd|coreaudiod|coreservicesd|lsd|powerd|bluetoothd|airportd|sharingd|cloudd|bird|nsurlsessiond|photoanalysisd|mediaanalysisd|backupd|softwareupdated|WallpaperAgent|iconservicesagent|VTDecoderXPCService|VTEncoderXPCService|UserEventAgent|Claude|claude|node|ffmpeg|ffprobe|VideoHubKeys|caffeinate|Terminal|iTerm2|ps|sysmond|runningboardd|containermanagerd|symptomsd|aned|ANECompilerService)$/;
async function scanMac() {
  const rows = await processTable(); if (!rows.length) return null;
  const by = new Map(rows.map(r => [r.pid, r]));
  // a browser process belongs to a headless render when the top process of its app's tree was started headless
  const top = r => { let x = r, k = 0; while (k++ < 30) { const up = by.get(x.ppid); if (!up || up.app !== x.app) return x; x = up; } return x; };
  const groups = new Map();
  for (const r of rows) {
    if (!r.app || MAC_SKIP.test(r.app) || MAC_SKIP.test(r.name)) continue;
    if (/Chrome|Edge|Brave|Chromium|chrome-headless-shell/.test(r.app) && /--headless/.test(top(r).cmd)) continue;
    const name = MAC_NAMES[r.app] || MAC_NAMES[r.name] || r.app;
    const g = groups.get(name) || { name, bytes: 0, procs: 0 };
    g.bytes += r.ramMB * 1048576; g.procs++; groups.set(name, g);
  }
  return [...groups.values()].sort((a, b) => b.bytes - a.bytes);
}

let cache = { at: 0, list: [] }, running = null;

function scan() {
  if (process.platform === 'darwin') return scanMac().catch(() => null);
  return new Promise(resolve => {
    execFile('powershell', ['-NoProfile', '-NonInteractive', '-Command', PS], { windowsHide: true, maxBuffer: 16 << 20, timeout: 20000 }, (err, out) => {
      if (err) return resolve(null);
      let rows; try { rows = JSON.parse(out); } catch { return resolve(null); }
      const byPid = new Map(rows.map(r => [r.p, r]));
      // a browser process belongs to a headless render (or the VideoHub window) when the top process of its tree says so
      const top = r => { let x = r, k = 0; while (k++ < 20) { const up = byPid.get(x.pp); if (!up || up.n !== x.n) return x; x = up; } return x; };
      const groups = new Map();
      for (const r of rows) {
        const key = String(r.n || '').replace(/\.exe$/i, '').toLowerCase();
        if (!key || SKIP.has(key)) continue;
        if ((key === 'chrome' || key === 'msedge') && top(r).h) continue;
        const name = NAMES[key] || r.n.replace(/\.exe$/i, '');
        const g = groups.get(name) || { name, bytes: 0, procs: 0 };
        g.bytes += r.m || 0; g.procs++; groups.set(name, g);
      }
      resolve([...groups.values()].sort((a, b) => b.bytes - a.bytes));
    });
  });
}

// cached list of programs over minBytes; refreshes in the background when older than maxAgeMs
export function ramHogs({ minBytes = 600 * 2 ** 20, maxAgeMs = 30e3 } = {}) {
  if (Date.now() - cache.at > maxAgeMs && !running) running = scan().then(l => { if (l) cache = { at: Date.now(), list: l }; running = null; });
  return cache.list.filter(g => g.bytes >= minBytes);
}

// the same, fresh (waits for a scan up to ~20 s)
export async function ramHogsNow(opts = {}) {
  if (Date.now() - cache.at > 10e3) { if (!running) running = scan().then(l => { if (l) cache = { at: Date.now(), list: l }; running = null; }); await running; }
  return ramHogs({ ...opts, maxAgeMs: 1e9 });
}

const gb = b => (b / 2 ** 30).toFixed(1) + ' GB';
// one sentence for the job log / Claude: big programs only (≥ 1.5 GB), or null
export function ramNote(list, availMB) {
  const big = list.filter(g => g.bytes >= 1.5 * 2 ** 30);
  if (!big.length) return null;
  return `Programs using RAM: ${big.map(g => `${g.name} ${gb(g.bytes)}`).join(', ')}${availMB ? ` (free RAM ${gb(availMB * 2 ** 20)})` : ''}. ` +
    'Closing them during rendering can speed up the render and keep your computer responsive (the user decides what to close).';
}
