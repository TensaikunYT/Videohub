# VideoHub on a Mac

The same VideoHub (same server, UI, MCP tools, render queue, notes, Thumbnail Studio) runs on macOS. Everything that
was a Windows call has a Mac counterpart; nothing Windows-side changed. This page says what differs, why, and how it
was checked. Install and everyday use: README.md.

## Which Macs
- **macOS 11 Big Sur or newer**, Apple silicon (M1 … M5) and Intel. Node.js 22 (the oldest Node VideoHub supports)
  runs on macOS 11+. Google Chrome needs macOS 12+ for current versions; on Big Sur an already installed Chrome or
  Edge still renders.
- **Tested on**: an Apple M5 Pro (18 cores, 48 GB), macOS 26.5, Node 26, ffmpeg 8 (Homebrew), Chrome. Not tested
  here: an Intel Mac, macOS 11–15, a Mac with 8 GB. The code paths for them are described below and are the same.

## What is different on a Mac
| Windows | Mac | Where |
|---|---|---|
| `SETUP.cmd` / `setup.ps1`, `UPDATE.cmd`, `uninstall.ps1` | `SETUP.command` / `setup.sh`, `UPDATE.command` / `update.sh`, `uninstall.sh` (same questions, same answers file) | repo root, `scripts/mac-install.mjs` |
| Desktop shortcut → `open.vbs` | `~/Applications/VideoHub.app` (Spotlight, Launchpad, Dock) → `open-mac.sh`; made on the Mac, so Gatekeeper does not stop it | `scripts/mac-install.mjs app` |
| Start with Windows (Run key) | Open at login: `~/Library/LaunchAgents/local.videohub.hub.plist` (server only, no window) | `server/mac.js` |
| Edge app window | Chrome (else Edge, Brave, Chromium) app window, else the default browser | `server/mac.js`, `open-mac.sh` |
| Explorer, `/select` | Finder: `open`, `open -R` | `server/open-file.js`, `server/mac.js` |
| Recycle Bin (SHFileOperation) | the Trash (NSFileManager through `osascript -l JavaScript`; no "control Finder" permission prompt). A volume without a Trash refuses instead of deleting. | `server/mac.js` `trashStream` |
| toast notification | Notification Center (`osascript display notification`) | `server/mac.js` |
| folder dialog (IFileOpenDialog) | the macOS "Choose folder" dialog (`osascript choose folder`) | `server/pickfolder.js` |
| `cmd.exe /c` for `mode:"command"` jobs | `/bin/sh -c` | `server/jobs.js` |
| `taskkill /T /F` | TERM (and CONT) to the whole tree, KILL after 3 s | `server/mac.js` `killTree` |
| — | **caffeinate**: the Mac does not idle-sleep while a render step runs (a long render on a laptop is no longer cut by sleep); the display may still sleep | `server/jobs.js` |
| NVENC / AMF / Quick Sync | **VideoToolbox** (`vt`): the Apple silicon media engine | `server/encoders.js`, `render.js` |
| `guard\VideoHubAgent.exe` (C#) | `guard/agent-mac.mjs` (Node, nothing to build) + optional `guard/VideoHubKeys` (Swift, hotkeys) | `guard/` |
| `%APPDATA%\RenderGuard` | `~/Library/Application Support/RenderGuard` (same files) | `server/guard.js` |
| workspace `Documents\VideoHub` | **`~/Movies/VideoHub`** (see below) | `server/config.js` |

Paths: every place that joined or matched paths with `\` now works with `/` too (scan roles, cleanup rules, the
outputs list, the history filter, the archive). Two of those were real bugs on any path with `/`: the cleanup looked
for `render\chunks` and `render\log.txt`, which on a Mac are file names with a backslash in them, so finished films'
chunks were never offered and a running render's log was not seen. `isInside` now resolves a path that does not
exist yet through its nearest existing folder (a Mac's temp folder is `/var/…` → `/private/var/…`; new thumbnails
there were refused as "path traversal").

## Why ~/Movies/VideoHub
- **iCloud**: with "Desktop & Documents Folders" on (common), everything in Documents is uploaded. A render writes
  hundreds of MB of chunks, rewrites them on every partial render, and iCloud would upload all of it, slow the render
  down and can evict files to "download on demand". Movies is never synced.
- **Privacy prompts**: macOS asks before an app reads Desktop, Documents or Downloads ("VideoHub would like to
  access files in your Documents folder"). Movies is not one of those folders, so VideoHub.app starts without a prompt.
- It is where macOS keeps video. Setup still asks; any folder works (`~/…` paths are fine).

## Render protection on a Mac
macOS has no Job Objects (hard CPU caps). The Mac agent gets the same behaviour from what macOS does have:

- **CPU cap** (`CapActive` / `CapIdle`): the render's process tree is continued and stopped (SIGCONT / SIGSTOP) in
  100 ms cycles. Each render's share of the Mac is worked out from what it used in the last scan (calm renders keep
  what they use, hungry ones split the rest). Measured: a 2 % cap on an 18-core Mac held a busy dummy render at 38 %
  of one core (target 36 %). At 100 % (the default when you are away) nothing runs and nothing is signalled.
- **Low priority** (`LowPrio`): Darwin background policy (`taskpolicy -b`) while you use the Mac, lifted when you are
  away. On Apple silicon that means *efficiency cores only*: renders never compete with your apps, the fans stay
  quiet, but renders are much slower. That is right for **Quiet** and too slow for **Balanced**, so on a Mac
  Balanced is the 90 % cap alone and low priority is off by default. (Windows' Balanced is unchanged.)
- **RAM slow mode**: free memory is what macOS can hand out without swapping (free + inactive pages,
  `process.availableMemory()`, read every 0.4 s at no cost) **and** the kernel's own memory-pressure level
  (`kern.memorystatus_vm_pressure_level`): "warning" counts as low, "critical" as critical. The newest render then
  crawls at `SlowCapPct` in the background; the oldest keeps going unless memory is critical; speed comes back after
  10 s of comfortable memory. Same rules and history lines as the Windows agent. Measured with a faked free-memory
  figure: the newest of two dummy renders went to 17 % of a core, the oldest kept 97 %, both back after 10 s.
- **Pause / resume**: SIGSTOP / SIGCONT of the whole tree. **Hotkeys ⌃⌥⌘P** (pause every render) and **⌃⌥⌘R**
  (resume); ⌃⌥End / ⌃⌥Home also work (fn+→ / fn+← on a laptop). They come from `guard/VideoHubKeys`, a small Swift
  helper setup builds with `swiftc` when the Command Line Tools are installed (`xcode-select --install`). Carbon hot
  keys need no Accessibility permission. Without the helper, the Renders page's Pause all / Resume all do the same.
- **Never frozen**: every stop in a cycle is followed by a continue; quitting (SIGTERM / SIGINT / an error)
  continues everything and lifts the background policy; a new agent continues what the last one had stopped (it
  lists every render process in `state.json`); and the hub continues those processes too when it finds the agent
  gone with a stale state.
- **What counts as a render** is the Windows agent's rule with Mac process names: ffmpeg, headless Chrome / Edge /
  Brave / Chromium / chrome-headless-shell (or one with a temp profile), and node / python scripts whose entry point
  looks like a render (`render`, `snap`, `frames`, `encode` …). Progress comes from Claude Code's task output
  (`/private/tmp/claude-<uid>/…/tasks/*.output`) or a log the render writes, exactly as on Windows.
- **Cost**: one `ps` (~20 ms) every 2 s while renders run (4 s otherwise), `ioreg` for idle time and GPU load every
  4 s, `sysctl` for memory pressure. The cap cycle only runs while a cap below 100 % applies.

## Encoding: VideoToolbox
`vt` = `-c:v h264_videotoolbox -q:v 70 -profile:v high`, constant quality. Measured on the M5 Pro against a lossless
reference, frames aligned by index (`setpts=N`; aligning by timestamp misreports every encoder by ~20 VMAF points):

| Clip | Encoder | Size | VMAF | SSIM | PSNR |
|---|---|---|---|---|---|
| testsrc2 1080p30, 10 s (clean) | x264 veryfast crf 16 | 12.6 MB | 97.83 | 0.9985 | 49.0 |
| | **vt q70** | 12.6 MB | **98.47** | 0.9985 | **50.3** |
| | vt q65 | 10.1 MB | 97.77 | 0.9974 | 47.4 |
| testsrc2 + strong moving noise, 1080p60, 10 s (grain) | x264 veryfast crf 16 | 440 MB | 95.88 | 0.947 | 35.8 |
| | **vt q70** | 524 MB | **97.23** | 0.954 | **36.7** |
| | vt q65 | 384 MB | 94.53 | 0.907 | 33.8 |

q70 is the lowest setting at or above x264 on both clips. **Speed**: the 10-second example film (300 frames, 2
workers, raw canvas path) renders at ~100 fps with either encoder here — drawing frames is the limit on 18 cores —
but VideoToolbox used **32 % less CPU** for the same render (12.8 vs 18.9 CPU-seconds). On a Mac with fewer cores
that is CPU the Chrome workers get (not measured here).

**Intel Macs**: ffmpeg offers VideoToolbox constant quality on Apple silicon only; on an Intel Mac the probe fails and
renders use x264 (a fixed bitrate could not promise the same quality on grainy films). Setup says so.

**Raw path = screenshots on a Mac**: the example rendered losslessly through the raw canvas path and through PNG
screenshots gave 300 identical frames (framemd5), so the raw path's pixel-exactness holds with Mac Chrome too. ffmpeg
prints `Truncating packet of size 8294400 to 65536` a few times per chunk when it reads raw frames from the pipe (a
read at the 64 KB pipe buffer); no frame is lost or changed (same check).

## Old Macs and small Macs
- **8 GB** (M1/M2 Air, older Intel): keep render workers at 1–2 (each is a headless Chrome, 300–600 MB). The RAM
  watchdog and macOS memory pressure slow the newest render before the Mac starts swapping.
- **Laptops**: caffeinate keeps a long render alive through idle sleep; closing the lid still sleeps the Mac (unless
  an external display is connected). Quiet = efficiency cores while you work: cooler and longer on battery.
- **Intel**: x264 (see above); low priority = lowest priority and throttled disk I/O, all cores when free.
- **No Homebrew**: install Node 22 LTS from nodejs.org and a ready-made ffmpeg + ffprobe into /usr/local/bin; setup
  finds them there (and in /opt/homebrew, /opt/local).

## Checking it (developers)
- `npm test` on a Mac runs every suite: the Windows cases with `path.win32` and the Windows encoder list (so they
  test the Windows logic on any OS), plus the Mac ones (`server/mac.test.js`, `guard/agent-mac.test.js`,
  `scripts/mac-install.test.js`, Mac cases in the config, queue, encoder, open-file and setup tests).
  `VIDEOHUB_TEST_TRASH=1 npm test` also moves a few temp files to your Trash to check the Trash path.
- **Setup**: `bash setup.sh --dry-run` changes nothing outside the folder; `bash uninstall.sh --dry-run`.
- **The agent, on dummy renders only**: run a test copy with its own folder and a tag, never the resident agent:
  `node guard/agent-mac.mjs --agent --only TAG --dir <scratch> [--ramfile <file with free MB>]`, with a busy
  `node render-dummy.js TAG` next to it; write settings.txt in `<scratch>` (e.g. `CapActive=2`) and commands into
  `<scratch>/cmd/*.json`; measure the dummy's CPU with `ps -o time= -p <pid>`. A test copy never touches the login item
  and never starts the hotkeys helper.
- Test hubs as in ARCHITECTURE.md (`VIDEOHUB_PORT=7799 VIDEOHUB_GUARD=off VIDEOHUB_NO_WINDOW=1 …`); `NO_WINDOW` also
  keeps Finder, notifications, the folder dialog and caffeinate out of it.
