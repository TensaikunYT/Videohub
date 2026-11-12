# VideoHub: notes for Claude working on this repo

Local hub for videos written as code, on Windows and macOS (catalog, live preview with no render, review notes,
protected render queue, MCP tools). Node 22+, ES modules, no build step, vanilla-JS UI, optional C# agent (Windows) /
Node agent + optional Swift hotkeys helper (Mac). What differs on a Mac and why: [docs/MACOS.md](docs/MACOS.md). Architecture, map and the
pitfalls behind past bugs: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). What a film project must look like:
[docs/PROJECT-CONTRACT.md](docs/PROJECT-CONTRACT.md).

## Installing VideoHub for the user
When the user opened this folder in Claude Code and asks to install, set up or "kur" VideoHub (and `data\config.json`
does not exist yet, or they ask to redo it), you do the install for them. They may know nothing about computers:
work one step at a time, in their language, say in one sentence what a step is for before you run it, and never ask
them to type a command. Do not change VideoHub's code during an install and touch nothing outside what is listed here.

1. **Requirements.** Check `node -v` (22 or newer), `ffmpeg -version`, and that Edge or Chrome exists. For each
   missing one explain what it is for and ask whether you may install it (`winget install -e --id OpenJS.NodeJS.LTS`,
   `winget install -e --id Gyan.FFmpeg`, `winget install -e --id Google.Chrome`); a new terminal is needed afterwards.
   Without winget, give them the download page instead. Node is required; without ffmpeg renders do not work.
2. **Look, change nothing.** `powershell -ExecutionPolicy Bypass -File setup.ps1 -DryRun` prints every step and what it
   found; `node scripts/init-config.mjs --state` says what is already decided and which video folders were found;
   `node scripts/init-config.mjs --detect` says whether the graphics card can encode video.
3. **Ask the user**, with your question tool (not as a wall of text), recommended answer first, skipping anything
   `--state` shows as decided:
   - *Where should all your video work live?* One folder holds everything: `films` (one folder per film), `outputs`
     (every finished video), `sounds`, `thumbnails`, `archive`. Offer `Documents\VideoHub` (recommended), a folder on
     the Desktop such as `Desktop\ClaudeVideo`, or a path they name. Check a typed path with
     `node scripts/init-config.mjs --check "<folder>"`.
   - Only if folders were found: *VideoHub found folders that look like video work (list them). Watch them too?*
     (recommended: no; nothing is ever moved).
   - Only if a graphics-card encoder was detected: *Use the graphics card for renders? Same quality, usually faster.*
     (recommended: yes).
   - *Should Claude show every new film in VideoHub before rendering it?* This adds a short rule to
     `~/.claude/CLAUDE.md` (recommended: yes).
   - *Desktop shortcut?* (yes) · *Start VideoHub with Windows?* (no) · *Add the 10-second example film?* (yes).
4. **Install once, with their answers, asking nothing more:**
   `powershell -ExecutionPolicy Bypass -File setup.ps1 -Workspace "<folder>" -WatchFound yes|no -GpuEncoder yes|no -GlobalRule yes|no -Shortcut yes|no -Startup yes|no -Example yes|no`
   Read its output; if it lists things "left for you to do", handle them with the user. If a step fails, show the
   error in plain words and stop; do not work around it.
5. **Check it works.** `node server/cli.js hub_workspace` (starts VideoHub and prints the folders);
   `wscript open.vbs` opens the window; with the example film, `node server/cli.js hub_project "{\"project\":\"hello-film\"}"`.
6. **Tell the user what now:** where their workspace is, that the Desktop shortcut opens VideoHub, the first thing to
   try (click the hello-film card, press Space, click a frame to leave a note), and that they must start a **new**
   Claude Code session for the `hub_*` tools. Films are made in the workspace's `films` folder, never inside this
   VideoHub folder: for a first film they open the workspace (or any folder) in a new session and ask for a video.

### Installing on a Mac
The same steps and questions, with the Mac files; never ask the user to type a command.
1. **Requirements.** `node -v` (22+), `ffmpeg -version`, and Chrome/Edge/Brave/Chromium in /Applications or
   ~/Applications. Missing ones, with Homebrew (`brew -v`): `brew install node`, `brew install ffmpeg`,
   `brew install --cask google-chrome` (ask first, one at a time). Without Homebrew: nodejs.org's LTS installer and
   https://brew.sh — explain, do not work around. The hotkeys helper needs the Command Line Tools (`xcode-select -p`
   says whether they are there); offer `xcode-select --install` only as optional.
2. **Look, change nothing.** `bash setup.sh --dry-run`; `node scripts/init-config.mjs --state`;
   `node scripts/init-config.mjs --detect` (`vt` = the Apple silicon media engine).
3. **Ask the user** as on Windows. The workspace: offer `~/Movies/VideoHub` (recommended: Movies is not synced by
   iCloud's "Desktop & Documents", so renders are not uploaded, and macOS does not ask permission for it), a folder
   they name (check it with `node scripts/init-config.mjs --check "<folder>"`; `~` is fine). "Desktop shortcut"
   becomes *Add VideoHub to your Applications folder (Spotlight, Launchpad, Dock)?* (yes); "Start with Windows" becomes
   *Open VideoHub at login?* (no).
4. **Install once:** `bash setup.sh --workspace "<folder>" --watch-found yes|no --gpu-encoder yes|no --global-rule
   yes|no --app yes|no --login yes|no --example yes|no`.
5. **Check it works.** `node server/cli.js hub_workspace`; `open ~/Applications/VideoHub.app` opens the window.
6. **Tell the user what now**: Spotlight (⌘ Space, "VideoHub") opens it, the first thing to try, and that a **new**
   Claude Code session sees the tools. Uninstall: `bash uninstall.sh` (`--dry-run` first).

## Setup on a new PC (what `SETUP.cmd` does)
`SETUP.cmd` (or `powershell -ExecutionPolicy Bypass -File setup.ps1`; `-DryRun` asks nothing, assumes the recommended
answers and changes nothing outside this folder; `-Yes` takes every recommended answer). It checks Node 22+, ffmpeg and
Edge/Chrome, runs `npm install`, builds the agent if the .NET Framework `csc.exe` exists, then asks plain questions
(each also a parameter): the workspace folder (default `Documents\VideoHub`: films, outputs, sounds, thumbnails,
archive), watching video folders it found, the graphics-card encoder, the global rule, the Desktop shortcut, start with
Windows, the example film. The logic lives in `scripts/init-config.mjs` (unit-tested); a re-run keeps every answer and
never moves or overwrites folders or `data/config.json` values. It registers the MCP server `videohub` (user scope) and
installs `skill/videohub` into `~/.claude/skills`.
Missing Node: `winget install -e --id OpenJS.NodeJS.LTS`; missing ffmpeg: `winget install -e --id Gyan.FFmpeg`. Tell the
user; do not work around them. Uninstall: `uninstall.ps1` (`-DryRun` too).
A Mac: `SETUP.command` / `setup.sh` asks the same questions (same `data/setup-answers.json`); the file work is in
`scripts/mac-install.mjs` (skill, global rule, `~/.claude.json` fallback, VideoHub.app, login item; unit-tested). It
registers the MCP server with the **absolute** node path (Claude Code started from the Dock has no Homebrew on its
PATH) and builds `guard/VideoHubKeys` with `guard/build-mac.sh` when swiftc exists. `update.sh`, `uninstall.sh` too.

## Map (short)
- `server/hub.js` HTTP + SSE; `scan.js` projects; `live.js` live preview; `notes.js` notes; `jobs.js` render queue;
  `tools.js` the `hub_*` tools (`mcp.js`, `cli.js`); `legacy.js` + `ui/values.js` stored values and legacy aliases;
  `config.js` settings and default folders (the workspace, `Documents\VideoHub\…` by default); `encoders.js` render
  encoders; `scripts/init-config.mjs` setup's config helper.
- `ui/app.js` pages, `ui/review*` review editor, `ui/thumbstudio*` Thumbnail Studio.
- Mac: `server/mac.js` (Finder, Trash, notifications, folder dialog, login item, caffeinate, the process table),
  `guard/agent-mac.mjs` (render protection), `guard/keys-mac.swift` (hotkeys), `ui/platform.js` (the UI's words per
  OS), `open-mac.sh` (what VideoHub.app runs). Windows code paths are unchanged: Mac branches sit next to them.
- `guard/` render protection agent; `engine-hooks/` page-side editor hooks; `examples/hello-film` the example film;
  `templates/new-film` the starter for new films; `templates/thumbnail` built-in thumbnail templates.

## Rules
- Test on copies: a scratch project added as a root of a test hub, never the user's real projects. Other sessions may be
  rendering.
- Setup while developing VideoHub: only ever `-DryRun`; test its logic through `scripts/init-config.mjs --data <scratch>`.
  (A real run is for "Installing VideoHub for the user" above, with their answers.)
- Render script (`templates/new-film/render.js`, same file as `examples/hello-film/render.js`): test renders only on a
  scratch copy of the example under `.test-tmp`, short clips, one at a time; see docs/RENDER-SPEED.md for the checks.
- Test hub: `VIDEOHUB_PORT=7799 VIDEOHUB_GUARD=off VIDEOHUB_JOBS=off VIDEOHUB_NO_WINDOW=1 VIDEOHUB_BASE_DIR=<scratch>`.
  Set `VIDEOHUB_PORT` on every CLI call too, or the tool starts a hub on the real port.
- No renders in parallel; use the queue. Never hard-delete files. A `mode:"command"` job waits for the user's approval
  on the Renders page before it runs (`config.render.confirmCommands`).
- Both OSes: a Windows call gets its Mac branch (`IS_MAC` from util.js, helpers in mac.js), never a replacement. Paths:
  `path.join`/`path.sep`, never a literal `\` inside a joined path (that is a file name on a Mac). UI words that
  differ (Recycle Bin/Trash, Explorer/Finder, hotkeys) come from `ui/platform.js`. Tests with Windows paths use
  `path.win32` so they run on a Mac too; Mac-only tests skip elsewhere.
- English UI text and comments. Keep each file's dense style. Stored values are English; read old files through
  `legacy.js`.
- The UI must never import from `server/`. After a UI change open the pages and check the console.
- Before committing: `npm test` and `node --check` on every changed file.
- Publishing goes through GitHub's browser upload, which drops every name starting with a dot: no file VideoHub needs may
  have one (`scripts/upload-rules.test.js` checks). Build the folder to drag in with `node scripts/make-upload.mjs`.

## Pitfalls
See "Things that matter when changing the code" in docs/ARCHITECTURE.md (hub blocking, fs.watch reads, per-frame
layout reads, note pictures from ffmpeg, security of the local server).
