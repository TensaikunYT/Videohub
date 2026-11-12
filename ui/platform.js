// What this computer calls things. The UI runs in a browser on the same computer as the hub (it is local only), so the
// browser's own platform says whether it is a Mac. A plain module (the UI never imports from server/).
const nav = typeof navigator === 'object' && navigator ? navigator : {};
export const IS_MAC = /mac/i.test(nav.userAgentData?.platform || nav.platform || nav.userAgent || '');

export const W = IS_MAC ? {
  bin: 'Trash', files: 'Finder', os: 'macOS', pc: 'Mac', gpu: 'Apple media engine',
  noGpu: 'No hardware encoder with constant quality on this Mac (Intel): renders use the processor (x264).',
  pauseKey: '⌃⌥⌘P', resumeKey: '⌃⌥⌘R', mod: '⌘',
  installFfmpeg: 'brew install ffmpeg (or run setup.sh again, it says how)',
  noBrowser: 'no Chrome, Edge, Brave or Chromium found — renders need one (google.com/chrome)',
  agentMissing: 'Render protection is not installed: run SETUP.command (or setup.sh) again. Renders still work, without CPU/RAM protection.',
  startup: ['Open VideoHub at login and keep it running', 'a login item (no window) that starts render protection at once; when off, VideoHub starts when you open it and quits 2 min after its window closes if no renders run'],
  lowPrio: ['Renders yield to your apps while you work', 'Apple silicon: renders use only the efficiency cores while you use the Mac (cool and quiet, slower); full speed when you are away'],
  folderDialog: 'Choose folder (opens the macOS folder dialog)',
} : {
  bin: 'Recycle Bin', files: 'Explorer', os: 'Windows', pc: 'PC', gpu: 'graphics card',
  noGpu: 'No graphics-card encoder found: renders use the processor (x264).',
  pauseKey: 'Ctrl+Alt+End', resumeKey: 'Ctrl+Alt+Home', mod: 'Ctrl',
  installFfmpeg: 'winget install -e --id Gyan.FFmpeg',
  noBrowser: 'no Edge or Chrome found — renders need one',
  agentMissing: 'Render protection is not installed: run SETUP.cmd again (it needs the .NET Framework C# compiler that comes with Windows). Renders still work, without CPU/RAM protection.',
  startup: ['Start VideoHub with Windows and keep it running', 'opens no window and starts render protection immediately; when disabled, starts when you open VideoHub and exits 2 min after closing the window if no renders are running'],
  lowPrio: ['Run renders at low priority', 'keeps open apps responsive; rendering slows slightly'],
  folderDialog: 'Choose folder (opens a Windows dialog)',
};

// the render speed presets. On a Mac "low priority" means the efficiency cores only (Apple silicon), which is right for
// Quiet but too slow for Balanced: Balanced there is the 90 % cap alone.
export const SPEED_PRESETS = [
  ['Full power', 'no CPU limit, normal priority', { CapActive: 100, CapIdle: 100, LowPrio: false }],
  IS_MAC ? ['Balanced', '90% while active (default)', { CapActive: 90, CapIdle: 100, LowPrio: false }]
    : ['Balanced', '90% while active, low priority (default)', { CapActive: 90, CapIdle: 100, LowPrio: true }],
  IS_MAC ? ['Quiet', '50% while active, efficiency cores; cool and quiet', { CapActive: 50, CapIdle: 100, LowPrio: true }]
    : ['Quiet', '50% while active; keeps your computer responsive', { CapActive: 50, CapIdle: 100, LowPrio: true }],
];

// the last parts of a path, for narrow columns (either slash)
export const tail = (p, n) => { const sep = String(p).includes('\\') ? '\\' : '/'; return String(p).split(/[\\/]/).slice(-n).join(sep); };
