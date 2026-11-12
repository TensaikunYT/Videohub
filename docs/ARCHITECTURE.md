# VideoHub architecture

A local Node 22 server (ES modules, no build step, two npm dependencies plus `puppeteer-core` for render scripts),
a vanilla-JS UI served by it, an optional C# agent for render protection, and MCP tools for Claude.
What film projects must look like is in [PROJECT-CONTRACT.md](PROJECT-CONTRACT.md).

## Processes and lifetime
- **Hub** — `server/hub.js`, HTTP on `127.0.0.1:7788` (UI + JSON API + server-sent events). It runs only while used:
  with no VideoHub window (SSE client), no queued/running job, no cleanup, no note pictures or review copies being made
  and no render seen by the agent for 2 minutes (`VIDEOHUB_IDLE_SEC`), it asks the agent to quit and exits — unless
  "Start with Windows" is on (then it stays up). The `hub_*` tools start it again when needed.
- **Agent** — `guard/VideoHubAgent.exe` (source `guard/RenderGuard.cs`, C# 5 WinForms, built with the .NET Framework 4
  `csc.exe` by `guard/build.ps1`). Invisible (no window/tray). The hub starts it (`--agent`) when a window opens or a job
  starts and stops it (`--quit`). It finds render processes (node/Chrome/ffmpeg trees), puts them in **Job Objects**
  with a CPU cap (one cap while you use the PC, another while idle), lowers their priority if asked, slows the newest
  render to a tiny CPU share when free RAM drops below a threshold (the oldest keeps going unless RAM is critical) and
  speeds them back up when RAM frees, and has global hotkeys: **Ctrl+Alt+End** pauses every render, **Ctrl+Alt+Home**
  resumes. It writes `%APPDATA%\RenderGuard\state.json` (~2 s), reads commands from `…\cmd\` and settings from
  `settings.txt` (written by the hub), and logs to `history.log`. Test copies run with `--only TAG` in their own folder
  (`guard/tests/run.ps1`). Without the agent everything works, renders just run unprotected.
- **Agent on a Mac** — `guard/agent-mac.mjs` (Node: nothing to build), started as `node guard/agent-mac.mjs --agent`,
  stopped with SIGTERM (`--quit`). Same files in `~/Library/Application Support/RenderGuard`, same commands, settings
  and history lines, so `server/guard.js` and the Renders page are unchanged. CPU caps are SIGSTOP/SIGCONT cycles of
  the render's process tree, low priority is Darwin background policy (efficiency cores on Apple silicon), the RAM
  watchdog also reads macOS memory pressure, the hotkeys (⌃⌥⌘P / ⌃⌥⌘R) come from `guard/VideoHubKeys` (Swift,
  optional). Every stop is followed by a continue; quitting continues everything; a new agent and the hub continue
  what a dead agent left stopped. Details: [MACOS.md](MACOS.md).
- **MCP server** — `server/mcp.js` (stdio) exposes `server/tools.js`; `server/cli.js` runs the same tools from a shell;
  `server/mcp-selftest.js` checks the MCP wiring. Tools talk to the hub over HTTP (`VIDEOHUB_PORT` overrides the port).

## Map
| File | Role |
|---|---|
| `server/config.js` | `data/config.json`: the workspace (`baseDir`: `VIDEOHUB_BASE_DIR` → `config.baseDir` → `Documents\VideoHub`; the folder defaults derive from it), roots, folders (outputs, sounds, archive, thumbnails, studio), `skipFolders`, render settings (`render.encoder`). First run: the films folder + discovered suggestions (off). An existing config keeps every value it has. |
| `scripts/init-config.mjs` | Setup's helper: what is decided already (`--state`), workspace checks, creating the workspace + README.txt and writing `config.json` (never overwriting a value), encoder detection (`--detect`), the example film (`--example`). `setup.ps1` only asks and passes the answers (`data/setup-answers.json` remembers them). |
| `server/encoders.js` | Render encoders: which ones this PC can use (one tiny test encode each, cached in `data/encoders.json`; `GET /api/encoders`), their ffmpeg arguments (the template's `render.js` carries a copy, kept equal by a test), `VIDEOHUB_ENCODER` for jobs. See RENDER-SPEED.md. |
| `server/legacy.js`, `ui/values.js` | Stored values (note/project/thumbnail statuses, note kinds) and the one place old Turkish values are mapped to English. |
| `server/scan.js` | Projects under the roots, video roles, duplicates, card thumbnails; root watchers so soft scans re-walk only changed projects. |
| `server/source-revision.js` | A project's code revision (live covers; 409 on stale covers). |
| `server/live.js` | Live preview: finds the page/fps/size/length/sound, serves `/live/<id>/…`, watches code → SSE `live-changed`. |
| `server/notes.js` | Review notes (`.videohub/notes.json`), frame pictures cut by ffmpeg in one queue, the "Send to Claude" text. |
| `server/jobs.js` | Render queue (`data/jobs.json`): one at a time, partial re-renders, concat, sound, versions, `register()`. |
| `server/media.js` | Film strip, waveform/peaks, full frames, review copies (`data/proxy`). |
| `server/guard.js`, `ramhogs.js` | Agent state/commands/settings/history; programs holding RAM next to a render (never closes anything). |
| `server/mac.js` | A Mac's counterparts of the Windows calls: Finder (`open`, `open -R`), the Trash (NSFileManager via `osascript -l JavaScript`), notifications, the folder dialog, the login item (LaunchAgent), caffeinate, `killTree`, the process table (`ps`), memory pressure. `IS_MAC` (util.js) picks the branch. |
| `guard/agent-mac.mjs`, `guard/keys-mac.swift` | The Mac render protection agent and its optional hotkeys helper (`guard/build-mac.sh`). |
| `ui/platform.js` | What the UI calls things on this OS (Trash/Recycle Bin, Finder/Explorer, hotkeys, the speed presets). |
| `scripts/mac-install.mjs`, `setup.sh`, `update.sh`, `uninstall.sh`, `open-mac.sh` | The Mac install: setup.sh asks, mac-install.mjs writes (skill, rule, MCP fallback, VideoHub.app, login item). |
| `server/outputs.js`, `ciktilar.js`, `ciktilar-dir.js` | "Recent renders" list; the global outputs folder (hard links, one folder per day). |
| `server/janitor.js` | Cleanup candidates (safe/deep), Recycle Bin, archive; one cleanup at a time. |
| `server/tools.js` | The `hub_*` tools. |
| `server/transcript.js`, `layers.js`, `scenes.js` | Narration text, sound stems + cues, scene lane. |
| `server/tweaks.js`, `sound.js`, `vhsound.mjs`, `soundedit.js`, `sfxlib.mjs`, `edit2d.js` | The film's `tweaks.json` (one writer), mix rebuilds, added sound clips, ready-made effects, 2D layers. |
| `server/example.js` | First-run helper that copies `examples/hello-film` into the films folder. |
| `server/thumbstudio/` | Thumbnail Studio: store, schema, templates (`templates/thumbnail`), variants and notes (Claude makes the images). |
| `ui/app.js` | Pages (Projects, project, Renders, Recent renders, Disk, Settings); `ui/review.js` + `ui/review/*` the review editor; `ui/thumbstudio/*`. |
| `engine-hooks/` | Page-side hooks for the scene editor (`vhtweaks.js`) and 2D layers (`vh2d.js`) that engines can include. |

## Things that matter when changing the code
- **Never block the hub.** Folder walks yield every 300 entries (`breather` in scan.js), the cleanup scan is async;
  one big synchronous loop in a request path once froze every request for ~20 s on a 50k-file project.
- **The UI never imports from `server/`.** A browser cannot load server files or `node:` modules, and one broken module
  in `app.js`'s import graph blanks the whole UI. Shared code lives in `ui/` as plain modules (`ui/values.js`,
  `ui/thumbstudio/catalog.js`, `prompt.js`). Open the pages after a UI change.
- **Per-frame code** (review `tick()`, the live loop) must not read layout: reading `clientWidth` after a text change
  reflowed ~100 note cards every frame (10.6 ms → 0.4 ms after the fix).
- **Never hard-delete.** Recycle Bin (refuse items bigger than the Bin) or archive (copy, verify, then remove; never
  overwrite, `_2`). The user approves every cleanup in the UI.
- **Paths on both OSes**: `path.join` / `path.sep`, never a literal `\` in a joined path (on a Mac `render\chunks` is one
  file name: the cleanup once never found a finished film's chunks there). Rules written with `\` (scan.js
  `category`) get the path with `/` turned into `\` first.
- **Windows `fs.watch` reports reads as changes** (last-access time): count an event only when the mtime is really newer
  (`reallyChanged` in live.js, the same idea in scan.js).
- **Note pictures are cut by ffmpeg** from the original video by frame number, never from the browser's `<video>`
  (comes back black) or the review copy. Live-preview notes send their frame from the page's canvases.
- **One render at a time.** The queue also waits while the agent reports a render started elsewhere. Do not start
  renders in parallel to test something.
- **Render script speed** (`templates/new-film/render.js` = `examples/hello-film/render.js`, keep them equal): the raw
  canvas path is used only when it is pixel-identical to a screenshot; check with lossless renders (RENDER-SPEED.md)
  after changing it. Keep everything VideoHub reads from the script (PROJECT-CONTRACT.md §4).
- **Setup never moves or overwrites** the user's folders or an existing `config.json` value; a re-run keeps every answer.
- **Security:** the server listens on 127.0.0.1 only and refuses requests whose Host is not loopback (DNS rebinding),
  that a browser marks cross-site (`Sec-Fetch-Site`), and writes with a foreign `Origin`. The job queue can run shell
  commands (`mode:"command"`), so the port must never be exposed.
- UI details that bit before: `Element.append(null)` prints "null"; a focused `<select>` eats arrow keys; drawing must
  not move focus into the note box; letter shortcuts normalise Turkish `ı`/`İ` to `i`.

## Data
- `data/` (per machine, never in git): `config.json`, `setup-answers.json`, `encoders.json`, `index.json` (scan), `jobs.json`, `probe-cache.json`, `thumbs/`,
  `media/`, `proxy/`, `ciktilar.json` (outputs index), `seen-outputs.json`, `perf.jsonl`, `sfx-lib/`.
- Per project: `.videohub/` (notes, versions, project.json, scenes, chats, autoscan, thumbnails) and `tweaks.json`,
  `vhaudio/`, `vh2d/` next to the film.

## Testing
- `npm test` (node:test suites, default folders pointed at `.test-tmp`), `node --check` on every changed file.
- Test hubs: `VIDEOHUB_PORT=7799 VIDEOHUB_GUARD=off VIDEOHUB_JOBS=off VIDEOHUB_NO_WINDOW=1` (+ `VIDEOHUB_IDLE_SEC=600`,
  `VIDEOHUB_BASE_DIR=<scratch>` so first-run folders go to a scratch folder). GUARD=off never touches the real agent,
  JOBS=off never picks up the queue, NO_WINDOW opens no Explorer/Edge. The hub reads its config only from its own
  `data/`, so a test with other roots needs a copy of the code (or a clone) with its own `data/`. When calling the CLI
  against a test hub, set `VIDEOHUB_PORT` in the same command — otherwise the tool talks to (or starts) a hub on 7788.
- Agent: `guard/tests/run.ps1` (isolated `--only` copies). Mac agent: `guard/agent-mac.test.js` and a `--only TAG --dir
  <scratch>` copy with dummy renders (MACOS.md, "Checking it").
- On a Mac `npm test` runs every suite: Windows-path cases use `path.win32`, Mac-only cases skip on Windows.
  `VIDEOHUB_TEST_TRASH=1` adds the real Trash check.
