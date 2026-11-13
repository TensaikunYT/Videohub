// Programs that hold a lot of RAM next to a render (an Android emulator once held 7.4 GB of a 16 GB PC during a render).
// Renders, system services, agent apps and VideoHub are left out; the user decides what to close.
import { OS, processList } from './platform.js';

const NAMES = {
  mumunxdevice: 'MuMuPlayer (Android emulator)', mumunxmain: 'MuMuPlayer (Android emulator)', mumuplayer: 'MuMuPlayer (Android emulator)',
  mumuvmmheadless: 'MuMuPlayer (Android emulator)', mumuvmmsvc: 'MuMuPlayer (Android emulator)', mumumultiplayer: 'MuMuPlayer (Android emulator)',
  'hd-player': 'BlueStacks (Android emulator)', 'hd-agent': 'BlueStacks (Android emulator)', ldplayer: 'LDPlayer (Android emulator)', 'dnplayer': 'LDPlayer (Android emulator)',
  noxvmhandle: 'Nox (Android emulator)', nox: 'Nox (Android emulator)',
  chrome: 'Chrome (browser)', 'google-chrome': 'Chrome (browser)', chromium: 'Chromium (browser)', 'chromium-browser': 'Chromium (browser)',
  msedge: 'Edge (browser)', 'microsoft-edge': 'Edge (browser)', firefox: 'Firefox', opera: 'Opera', brave: 'Brave',
  discord: 'Discord', steam: 'Steam', steamwebhelper: 'Steam', epicgameslauncher: 'Epic Games', obs64: 'OBS',
  razerappengine: 'Razer Synapse', spotify: 'Spotify', telegram: 'Telegram', whatsapp: 'WhatsApp', teams: 'Teams', 'ms-teams': 'Teams',
  code: 'VS Code', photoshop: 'Photoshop', 'adobe premiere pro': 'Premiere Pro', afterfx: 'After Effects', resolve: 'DaVinci Resolve',
  blender: 'Blender', vmmem: 'WSL / virtual machine', vmmemwsl: 'WSL / virtual machine', 'vmware-vmx': 'VMware', virtualboxvm: 'VirtualBox',
};
// Hide infrastructure rather than suggesting the user close it to free RAM.
const SKIP_BY_OS = { win32: ['system', 'registry', 'memory compression', 'idle', 'secure system', 'smss', 'csrss', 'wininit', 'winlogon', 'services', 'lsass',
  'svchost', 'dwm', 'explorer', 'msmpeng', 'nissrv', 'searchhost', 'searchindexer', 'startmenuexperiencehost', 'shellexperiencehost', 'textinputhost',
  'runtimebroker', 'ctfmon', 'fontdrvhost', 'sihost', 'taskhostw', 'audiodg', 'conhost', 'powershell', 'pwsh', 'cmd', 'wmiprvse', 'spoolsv',
  'claude', 'node', 'ffmpeg', 'ffprobe', 'renderguard', 'msedgewebview2', 'radeonsoftware', 'amdrssrcext', 'atieclxx', 'atiesrxx', 'amdfendrsr',
  'nvcontainer', 'nvdisplay.container', 'lockapp', 'widgets', 'phoneexperiencehost', 'securityhealthservice', 'smartscreen', 'dllhost', 'applicationframehost'],
  linux: ['systemd', 'systemd-journald', 'systemd-logind', 'systemd-udevd', 'dbus-daemon', 'dbus-broker', 'xorg', 'xwayland', 'gnome-shell',
    'kwin_wayland', 'kwin_x11', 'plasmashell', 'pipewire', 'pipewire-pulse', 'wireplumber', 'pulseaudio', 'networkmanager', 'sshd',
    'claude', 'opencode', 'codex', 'node', 'ffmpeg', 'ffprobe', 'sh', 'bash', 'zsh', 'ps', 'kworker', 'kthreadd'],
  darwin: ['kernel_task', 'launchd', 'windowserver', 'loginwindow', 'coreaudiod', 'runningboardd', 'powerd', 'notifyd', 'cfprefsd',
    'syslogd', 'logd', 'distnoted', 'mds', 'mds_stores', 'securityd', 'trustd', 'bird', 'usernoted', 'sharingd', 'spotlight',
    'claude', 'opencode', 'codex', 'node', 'ffmpeg', 'ffprobe', 'sh', 'bash', 'zsh', 'ps'],
};
const SKIP = new Set(SKIP_BY_OS[OS] || []);
const processKey = name => String(name || '').replace(/\.exe$/i, '').toLowerCase();
const browserFamily = key => /^(?:google[ -])?chrome(?: helper.*)?$/.test(key) ? 'chrome' : /^chromium(?:-browser| helper.*)?$/.test(key) ? 'chromium' : /^(?:msedge|microsoft[ -]edge)(?: helper.*)?$/.test(key) ? 'msedge' : null;

let cache = { at: 0, list: [] }, running = null;

async function scan() {
  try {
    const rows = await processList(); if (!rows) return null;
    const byPid = new Map(rows.map(r => [r.pid, r]));
    // a browser process belongs to a headless render (or the VideoHub window) when the top process of its tree says so
    const top = r => { let x = r, k = 0; while (k++ < 20) { const up = byPid.get(x.ppid), family = browserFamily(processKey(x.name)); if (!up || (up.name !== x.name && (!family || browserFamily(processKey(up.name)) !== family))) return x; x = up; } return x; };
    const groups = new Map();
    for (const r of rows) {
      const key = processKey(r.name), family = browserFamily(key);
      if (!key || SKIP.has(key)) continue;
      if (family && (top(r).headless || /--headless|--app=http:\/\/127\.0\.0\.1/.test(top(r).cmd || ''))) continue;
      const name = NAMES[family || key] || r.name.replace(/\.exe$/i, '');
      const g = groups.get(name) || { name, bytes: 0, procs: 0 };
      g.bytes += r.rssBytes || 0; g.procs++; groups.set(name, g);
    }
    return [...groups.values()].sort((a, b) => b.bytes - a.bytes);
  } catch { return null; }
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
