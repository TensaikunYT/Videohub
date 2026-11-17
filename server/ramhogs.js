// Programs that hold a lot of RAM next to a render (an Android emulator once held 7.4 GB of a 16 GB PC during a render).
// Renders, system services, agent apps and VideoHub are left out; the user decides what to close.
import { OS, processList } from './platform.js';

const NAMES = {
  mumunxdevice: 'MuMuPlayer (Android emulator)', mumunxmain: 'MuMuPlayer (Android emulator)', mumuplayer: 'MuMuPlayer (Android emulator)',
  mumuvmmheadless: 'MuMuPlayer (Android emulator)', mumuvmmsvc: 'MuMuPlayer (Android emulator)', mumumultiplayer: 'MuMuPlayer (Android emulator)',
  'hd-player': 'BlueStacks (Android emulator)', 'hd-agent': 'BlueStacks (Android emulator)', ldplayer: 'LDPlayer (Android emulator)', 'dnplayer': 'LDPlayer (Android emulator)',
  noxvmhandle: 'Nox (Android emulator)', nox: 'Nox (Android emulator)',
  chrome: 'Chrome (browser)', 'google-chrome': 'Chrome (browser)', chromium: 'Chromium (browser)', 'chromium-browser': 'Chromium (browser)',
  msedge: 'Edge (browser)', 'microsoft-edge': 'Edge (browser)', firefox: 'Firefox', 'zen-bin': 'Zen (browser)', opera: 'Opera',
  brave: 'Brave (browser)', 'brave-browser': 'Brave (browser)', helium: 'Helium (browser)', 'helium-browser': 'Helium (browser)',
  discord: 'Discord', vesktop: 'Vesktop (Discord)', steam: 'Steam', steamwebhelper: 'Steam', epicgameslauncher: 'Epic Games', obs64: 'OBS', obs: 'OBS',
  razerappengine: 'Razer Synapse', spotify: 'Spotify', telegram: 'Telegram', 'telegram-desktop': 'Telegram', 'signal-desktop': 'Signal', slack: 'Slack', whatsapp: 'WhatsApp', teams: 'Teams', 'ms-teams': 'Teams',
  code: 'VS Code', 'code-oss': 'VS Code', codium: 'VSCodium', cursor: 'Cursor', 'zed-editor': 'Zed',
  photoshop: 'Photoshop', 'adobe premiere pro': 'Premiere Pro', afterfx: 'After Effects', resolve: 'DaVinci Resolve', kdenlive: 'Kdenlive', gimp: 'GIMP', krita: 'Krita', inkscape: 'Inkscape',
  blender: 'Blender', vmmem: 'WSL / virtual machine', vmmemwsl: 'WSL / virtual machine', 'vmware-vmx': 'VMware', virtualboxvm: 'VirtualBox', 'qemu-system-x86_64': 'QEMU / virtual machine',
};
// Hide infrastructure rather than suggesting the user close it to free RAM.
const SKIP_BY_OS = { win32: ['system', 'registry', 'memory compression', 'idle', 'secure system', 'smss', 'csrss', 'wininit', 'winlogon', 'services', 'lsass',
  'svchost', 'dwm', 'explorer', 'msmpeng', 'nissrv', 'searchhost', 'searchindexer', 'startmenuexperiencehost', 'shellexperiencehost', 'textinputhost',
  'runtimebroker', 'ctfmon', 'fontdrvhost', 'sihost', 'taskhostw', 'audiodg', 'conhost', 'powershell', 'pwsh', 'cmd', 'wmiprvse', 'spoolsv',
  'claude', 'node', 'ffmpeg', 'ffprobe', 'renderguard', 'msedgewebview2', 'radeonsoftware', 'amdrssrcext', 'atieclxx', 'atiesrxx', 'amdfendrsr',
  'nvcontainer', 'nvdisplay.container', 'lockapp', 'widgets', 'phoneexperiencehost', 'securityhealthservice', 'smartscreen', 'dllhost', 'applicationframehost'],
  linux: ['systemd', 'systemd-journald', 'systemd-logind', 'systemd-udevd', 'systemd-resolved', 'systemd-timesyncd', 'systemd-oomd',
    'dbus-daemon', 'dbus-broker', 'dbus-broker-launch', 'polkitd', 'rtkit-daemon', 'bluetoothd', 'iwd', 'wpa_supplicant', 'networkmanager',
    'xorg', 'xwayland', 'gnome-shell', 'kwin_wayland', 'kwin_x11', 'plasmashell',
    'hyprland', 'hyprpaper', 'hypridle', 'hyprlock', 'hyprsunset', 'hyprpolkitagent', 'waybar', 'walker', 'elephant',
    'mako', 'dunst', 'swaync', 'swayosd-server', 'swayosd-libinput-backend', 'swaybg', 'swayidle', 'swaylock', 'uwsm', 'rofi', 'wofi', 'fuzzel',
    'sddm', 'sddm-helper', 'gdm', 'gdm-wayland-session', 'lightdm', 'greetd', 'seatd',
    'pipewire', 'pipewire-pulse', 'wireplumber', 'pulseaudio', 'gvfsd', 'gvfsd-fuse', 'gvfsd-trash', 'dconf-service', 'gnome-keyring-daemon',
    'at-spi-bus-launcher', 'at-spi2-registryd', 'fcitx5', 'ibus-daemon', 'sshd',
    'claude', 'opencode', 'agy', 'codex', 'node', 'ffmpeg', 'ffprobe', 'sh', 'bash', 'zsh', 'fish', 'nu', 'tmux', 'ps', 'kworker', 'kthreadd'],
  darwin: ['kernel_task', 'launchd', 'windowserver', 'loginwindow', 'coreaudiod', 'runningboardd', 'powerd', 'notifyd', 'cfprefsd',
    'syslogd', 'logd', 'distnoted', 'mds', 'mds_stores', 'securityd', 'trustd', 'bird', 'usernoted', 'sharingd', 'spotlight',
    'claude', 'opencode', 'agy', 'codex', 'node', 'ffmpeg', 'ffprobe', 'sh', 'bash', 'zsh', 'fish', 'ps'],
};
const SKIP = new Set(SKIP_BY_OS[OS] || []);
// Linux /proc/<pid>/stat truncates comm names to 15 bytes; skip truncated desktop portal, systemd, gvfs and keyring daemons.
const SKIP_LINUX_PREFIX = /^(?:systemd-|xdg-desktop-por|xdg-document-po|xdg-permission-|gvfsd?-|at-spi|polkit-|gnome-keyring|swayosd-|kworker\/|irq\/|btrfs-)/;
const processKey = name => String(name || '').replace(/\.exe$/i, '').toLowerCase();
const browserFamily = key => /^(?:google[ -])?chrome(?: helper.*)?$/.test(key) ? 'chrome'
  : /^chromium(?:-browser| helper.*)?$/.test(key) ? 'chromium'
  : /^(?:msedge|microsoft[ -]edge)(?: helper.*)?$/.test(key) ? 'msedge'
  : /^brave(?:-browser| browser(?: helper.*)?)?$/.test(key) ? 'brave'
  : /^helium(?:-browser)?$/.test(key) ? 'helium' : null;

let cache = { at: 0, list: [] }, running = null;

export function groupRamHogs(rows, osName = OS) {
  const skip = osName === OS ? SKIP : new Set(SKIP_BY_OS[osName] || []);
  const byPid = new Map(rows.map(r => [r.pid, r]));
  // a browser process belongs to a headless render (or the VideoHub window) when the top process of its tree says so
  const top = r => { let x = r, k = 0; while (k++ < 20) { const up = byPid.get(x.ppid), family = browserFamily(processKey(x.name)); if (!up || (up.name !== x.name && (!family || browserFamily(processKey(up.name)) !== family))) return x; x = up; } return x; };
  const groups = new Map();
  for (const r of rows) {
    const key = processKey(r.name), family = browserFamily(key);
    if (!key || skip.has(key)) continue;
    if (osName === 'linux' && (r.pid === 2 || r.ppid === 2 || SKIP_LINUX_PREFIX.test(key))) continue;
    if (family && (top(r).headless || /--headless|--app=http:\/\/127\.0\.0\.1/.test(top(r).cmd || ''))) continue;
    const name = NAMES[family || key] || r.name.replace(/\.exe$/i, '');
    const g = groups.get(name) || { name, bytes: 0, procs: 0 };
    g.bytes += r.rssBytes || 0; g.procs++; groups.set(name, g);
  }
  return [...groups.values()].sort((a, b) => b.bytes - a.bytes);
}

async function scan() {
  try {
    const rows = await processList(); if (!rows) return null;
    return groupRamHogs(rows, OS);
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
