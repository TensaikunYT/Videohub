# Platform support

Windows remains the established platform. Linux and macOS support are **new, not yet tested on real machines**; their operating-system calls are covered by injected tests on Windows. Passing unit tests does not establish desktop integration or render performance on another operating system.

`server/platform.js` owns operating-system integrations. The queue, cleanup, UI and MCP tools keep the same public contracts. Everything stays local: the hub listens on `127.0.0.1`.

| Feature | Windows 10/11 | Linux desktop | macOS |
|---|---|---|---|
| Workspace, scan, notes and live preview | Supported | Implemented; real desktop verification pending | Implemented; real desktop verification pending |
| Settings location | Existing `%APPDATA%/RenderGuard` protection settings; install `data/` for hub data | `$XDG_CONFIG_HOME/videohub` or `~/.config/videohub` protection settings; install `data/` for hub data | `~/Library/Application Support/VideoHub` protection settings; install `data/` for hub data |
| Desktop and Documents | Existing OneDrive-aware lookup | `xdg-user-dir`, then `~/Desktop` and `~/Documents` | `~/Desktop` and `~/Documents` |
| ffmpeg and ffprobe | PATH and existing `C:/ffmpeg/bin` fallback | Native executables on PATH | Native executables on PATH (including Homebrew paths supplied by the launcher) |
| Browser discovery | Existing Edge and Chrome locations | Native Chrome, Chromium and Edge on PATH; `VIDEOHUB_BROWSER` override | Chrome, Edge and Chromium in `/Applications` or `~/Applications`; `VIDEOHUB_BROWSER` override |
| App-style hub window | Edge or Chrome; default browser fallback | Native browser `--app`; `xdg-open` fallback | Chrome/Edge via `open -na` with `--app`; default-browser `open` fallback |
| Open media and folders | File associations and Explorer | `xdg-open` | `open` with default application |
| Reveal a selected file | Explorer selection | FileManager1 D-Bus where available; parent folder fallback | `open -R` |
| Folder dialog | Installed WinForms folder dialog in front of the app window; typed-path UI fallback if unavailable | `zenity` or `kdialog`; typed-path UI fallback if neither exists | AppleScript `choose folder`; cancellation leaves the selection unchanged |
| Reversible deletion | Installed .NET Recycle Bin API with disabled/capacity checks; refuse unsafe operations or failures | `gio trash`, `trash-put`, then freedesktop Trash in Node; refuse if no safe destination is available | Finder Trash via AppleScript; Automation permission may be requested; refusal preserves source |
| Volume information | Windows volume query and Bin capacity | `df -kP`; no Windows Bin capacity limit | `df -kP`; no Windows Bin capacity limit |
| Render notifications | Existing Windows toast | `notify-send` if available; otherwise in-app notices only | AppleScript desktop notification; best effort |
| Process list and RAM hogs | Windows CIM | `/proc`, with `ps` fallback; Linux system processes excluded | `ps -axo`; macOS system processes excluded |
| Render tree stop | `taskkill /T /F` | Detached render process group; TERM, then KILL after grace period | Detached render process group; TERM, then KILL after grace period |
| Render priority | Existing priority classes | Per-process niceness | Per-process niceness; `taskpolicy` background QoS in slow mode |
| CPU core limit | Existing processor affinity | `taskset` if available; priority and RAM protection remain available without it | Unavailable: no supported affinity API; CPU sliders and presets hidden with explanation |
| RAM protection | Available memory and existing thresholds | Available memory and existing thresholds | `vm_stat`: free + inactive + speculative pages × page size |
| Autostart | HKCU Run entry launches installed Node and the server-only launcher directly | XDG `autostart/videohub.desktop` | `~/Library/LaunchAgents/com.videohub.hub.plist`; `launchctl bootstrap` / `bootout` |
| Custom render commands | Existing `cmd.exe` arguments and approval | `/bin/sh -c`, with the same approval step | `/bin/sh -c`, with the same approval step |
| Video encoders | NVENC, AMF, QSV, x264; short encode probes decide availability | NVENC, VAAPI, QSV, x264; short encode probes decide availability | VideoToolbox and x264; Apple Silicon quality / Intel bitrate candidates probed |
| Render template browser lookup | Existing paths plus `VIDEOHUB_BROWSER` | Native browser paths plus `VIDEOHUB_BROWSER` | Application browser paths plus `VIDEOHUB_BROWSER` |
| Install, update and uninstall | PowerShell scripts and `.cmd` launchers | `setup.sh`, `update.sh`, `uninstall.sh` | Same Bash scripts with macOS paths and Homebrew hints |
| Desktop launcher | Node-based shortcut (minimized) or `open.cmd`; a console may appear briefly | Desktop entry with SVG icon | Optional executable `VideoHub.command`; no `.app` bundle |
| Claude Code integration | CLI MCP registration, skill and managed global rule | Same integrations through shared Node helper | Same integrations through shared Node helper |
| OpenCode integration | CLI MCP registration; JSONC-tolerant fallback only if CLI is absent; skill and managed rule | Same integrations through shared Node helper | Same integrations through shared Node helper |

## Windows security behavior

Current Windows runtime integrations do not compile inline C#, use custom P/Invoke, generate PowerShell scripts or set execution-policy overrides. Folder selection loads the installed WinForms dialog and has a typed-path fallback; reversible deletion uses an installed .NET API while retaining the Bin safety checks. Normal launch, shortcuts and login startup use the installed Node runtime directly. The old VBScript/PowerShell launchers are no longer shipped; update re-points old shortcuts and start-up entries and recycles those files; migration does not execute the retired helper binaries.

This reduces unnecessary launch/compiler machinery. It does not certify the source or a downloaded archive as malware-free, establish a false-positive verdict, provide a trusted publisher signature or guarantee SmartScreen, Smart App Control or antivirus acceptance. Execution-policy errors, reputation warnings and malware detections need their exact messages to be assessed. No security-tool exclusions, policy downgrades or automatic file submissions are part of VideoHub. See [README security guidance](../README.md#windows-launch-and-security-warnings).

## Optional Linux tools

Native Chrome, Chromium or Edge and ffmpeg are needed for renders. Setup prints package-manager hints and does not silently install system packages. Install `zenity` or `kdialog` for a graphical folder picker, `taskset` for CPU affinity, and `notify-send` for desktop notifications. Their absence does not disable the hub. The Renders page explains when CPU limits are unavailable.

Trash helpers are optional. The Node fallback writes restorable `.trashinfo` metadata and moves files rather than hard-deleting them. Home-filesystem paths use the user's Trash; other filesystems need a writable `.Trash-<uid>` destination. If no safe Trash operation works, the source stays in place and VideoHub reports the refusal.

## macOS permissions and limits

The optional Desktop `VideoHub.command` launcher opens Terminal briefly. No unsigned `.app` bundle is created. After a blocked first launch, use System Settings → Privacy & Security → Open Anyway, then open the launcher again; `bash open.sh` from the installation is an alternative.

Finder may request Automation permission when VideoHub first sends files to Trash. If permission is denied or Finder reports an error, VideoHub keeps the source and reports the refusal. It does not fall back to permanent deletion. macOS has no supported CPU-core affinity API, so the Renders page hides core-power controls while retaining niceness, background QoS and RAM protection.

On Linux and macOS, raising priority after a slow period can require privileges. Restoration is best effort without elevation; an existing render may keep its lower nice priority until completion. A new render starts with its configured priority. The UI does not promise a precise CPU percentage when affinity is unavailable.

## Agent integration

Setup can target Claude Code, OpenCode or both. Skills share one source file and rules are limited to VideoHub's marked block. Existing unrelated settings and rules remain in their respective agent files. An OpenCode `AGENTS.md` causes OpenCode to prefer that rules file over Claude's global rules; setup prints this consequence and does not copy unrelated rules between agents.

## Not supported

- Snap and Flatpak browser wrappers are not used for Puppeteer renders; install a native browser executable.
- Linux CPU affinity without `taskset`, and CPU affinity on macOS; priority and RAM protection still work.
- Guaranteed restoration of Unix niceness without the required privileges; no elevated helper is installed.
- Permanent deletion as a fallback for an unavailable Trash or Recycle Bin.
- Native modules, compiled helper programs and unsigned `.app` bundles.
- Renders made from an older template are not rewritten. Their own browser lookup may need updating or the script may need to honor `VIDEOHUB_BROWSER`.

## Real-machine acceptance still required

On Ubuntu 24.04 desktop, install from a fresh clone, open the example in live preview, send a note, render once with sound after approving the preview, inspect priority and `taskset`, stop a render with children, restore a deleted folder from Trash, update while retaining data, and uninstall. Repeat installation, live preview, notes, one sound render, priority/background QoS, whole-tree Stop, Trash restore, data-preserving update and uninstall on Apple Silicon and, if available, Intel macOS. Verify the `.command` first launch, Finder Automation prompt, LaunchAgent login startup and hidden CPU sliders. Confirm a real OpenCode session exposes the `hub_*` tools on each platform; verify Claude Code integration as well. These desktop, permissions, rendering and performance checks were not executed on Linux/macOS during the Windows implementation run.
