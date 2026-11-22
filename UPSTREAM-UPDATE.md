# Keeping this copy up to date with upstream

This copy adds the **Reasonix CLI / DeepSeek API agent provider** and a **finished-video render** path. The work is
kept on its own branch so upstream can be pulled without losing it.

## What changed, and where

New files (they do not conflict with upstream):

| File | Purpose |
|---|---|
| `server/agent.js` | Provider detection, prompt/context building, Reasonix run control, DeepSeek API, routes |
| `server/agent.test.js` | Tests for the prompt, public config and detection |
| `ui/agent-panel.js` | Settings → Agent provider panel and the Send-to-agent dispatcher |
| `docs/AGENT-PROVIDERS.md` | This feature's documentation |
| `UPSTREAM-UPDATE.md` | This file |
| `.gitignore` | Keeps `data/`, `node_modules/`, `.test-tmp/` and logs out of git |

Small edits to existing files, each marked with `[REASONIX PATCH]`:

| File | Edit |
|---|---|
| `server/config.js` | `agent` defaults, validation and key-preserving merge |
| `server/jobs.js` | No missing-`render.js` default; finished-video render path; null-safe render options |
| `server/hub.js` | Agent routes/SSE; the raw API key is stripped from `/api/config` |
| `ui/app.js` | One guarded call site for the provider panel; provider-aware agent name |
| `ui/review/notes.js` | Send button calls the provider dispatcher |
| `ui/review/renderbtn.js` | Finished-video render option |
| `server/media.js` | `[VH FIX]` a missing ffmpeg fails the review proxy instead of crashing the hub |
| `server/agent.js`, `server/jobs.js` | `[VH FIX]` log retention: the 50 newest agent runs and 20 newest render logs per project |
| `vh.ps1`, `vh.cmd` | `vh` launcher: starts the server hidden, waits for `/api/ping`, opens Edge/Chrome `--app`, finds ffmpeg for the shortcut's PATH; `vh.ps1 -Shortcut` recreates the desktop shortcuts |
| `ui/index.html`, `ui/shell.js` | Window and rail title `vh` |
| `README.md`, `skill/videohub/SKILL.md` | Documentation only |

## The vh desktop shortcut

The Desktop shortcuts (`VideoHub.lnk` and `vh.lnk`) point to `powershell.exe -File vh.ps1`. The launcher starts the
server with `Start-Process -WindowStyle Hidden` (so it outlives the shortcut), waits for the server, then opens the UI
as a browser app window (`--app=`, no address bar). It also finds ffmpeg in the user's usual install locations, because
a shortcut can inherit a shorter PATH than a normal shell.

If a future setup/update rewrites the shortcuts, recreate them with:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File "<hub>\vh.ps1" -Shortcut
```

## Pulling an upstream update

The feature branch is `feat/reasonix-deepseek-agent`. Rebase it onto the new upstream instead of merging upstream
into it, so the `[REASONIX PATCH]` hunks stay on top:

```bash
git fetch origin
git switch feat/reasonix-deepseek-agent
git rebase origin/main
# resolve conflicts only in the files listed above; keep every [REASONIX PATCH] block
npm test
```

Then start VideoHub again (Desktop shortcut or `open.cmd`).

If you prefer a clean merge commit, `git merge origin/main` works too; the marked blocks are still the only regions
that can conflict.

## What upstream must not overwrite

- **`data/config.json`** holds the provider choice and (if used) the DeepSeek key. `data/` is git-ignored and is never
  part of a code update; `scripts/install.mjs update` keeps `data/` as it is.
- **Films and outputs** live outside this folder (the workspace chosen in setup). Setup/update never touch them.
- If a future upstream release renames `server/jobs.js`'s render recipe or `ui/review/notes.js`'s send button, search
  the tree for `REASONIX PATCH` to find every integration point:

```bash
grep -rn "REASONIX PATCH" server ui README.md skill docs
```

## Verifying after an update

```bash
npm test                     # 342 tests; the two path/ffmpeg environment failures are described below
npm run check                # syntax check of the server entry points
curl -s http://127.0.0.1:7788/api/agent   # provider config + Reasonix detection
```

Two tests (`server/encoders.test.js`, `server/soundedit.test.js`) fail in some Windows shells because the checkout
path contains spaces and `&` and is URL-encoded by the test runner; they are unrelated to this feature. Run the
suite from a path without `&`/spaces, or compare the result with the upstream tree.

## Reverting

`git switch main` (the branch without the feature) leaves the feature branch intact; switching back restores it.
