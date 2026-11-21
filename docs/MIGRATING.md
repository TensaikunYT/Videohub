# Moving to this version

## From the previous English version
Update as usual (`UPDATE.cmd` / `node scripts/install.mjs update --target …` or `./update.sh --target …`); films, notes,
versions, the queue and settings carry over unchanged. Then start a new agent session so it loads the new skill.

- **One window.** A rail on the left replaces the top menu: Films (was Projects), Now, Skills, Renders,
  Cleanup (was Disk), Settings. A film opens as tabs: **Review**, **Plan**, **Files**, and *Film details* (the old
  project page). Old `#/…` links still open the same pages.
- **New pages.** *Now* shows what agent sessions and renders are doing; *Skills* lists the skills in your agents' skill
  folders; a film's *Files* tab groups its folder with sizes and leftovers.
- **New tools.** `hub_plan` (scene cards on the Plan tab), `hub_ask` (a question you answer by click in the agent
  drawer) and `hub_wait` (the agent waits for you instead of ending its turn). The skill and the optional review rule
  teach the loop plan → build → live preview → `hub_wait` → fix.
- **The channel.** **Send to agent** now delivers your notes straight to an agent waiting in `hub_wait`, so nothing
  has to be pasted. Each film keeps `plan.json`, `questions.json` and `inbox.json` in its `.videohub` folder.
  **Copy as message** and `hub_notes` still work for older sessions.
- **Codex.** Setup and update can integrate Codex next to Claude Code and OpenCode: `--agents claude,codex,opencode`.
  Codex gets `[mcp_servers.videohub]` in `~/.codex/config.toml` (with `tool_timeout_sec = 600`), the skill in
  `~/.codex/skills/videohub` and the optional rule in `~/.codex/AGENTS.md`. Update refreshes the integrations that
  belong to this install; to add Codex to an existing install, run setup again with `--agents` including `codex`.
- **Agent activity.** The Now page reads the session files Claude Code and Codex already write on this computer
  (derived facts only, no prompt text, no tokens). It is on by default; **Settings → Show agent activity** turns it
  off, and then VideoHub never reads the agents' folders. Skill use is indexed in `data/skill-usage.json`.
- **Desktop window.** An optional Electron window lives in `desktop/` (`npm install`, `npm start` there). The main
  install never downloads Electron.
- **Thumbnail Studio was removed** (its page, the `hub_thumb*` tools and its Settings folders); existing thumbnail
  folders and an old `thumbstudio` key in `config.json` are left on disk and ignored.

## From an older (Turkish) install
Older VideoHub builds were Turkish and had folder defaults for one particular PC. This version is English and its
defaults live under `Documents\VideoHub`. Nothing is lost when you switch, but a few settings should be written down
first so VideoHub keeps using your current folders.

### What carries over by itself
- **Notes, versions, project settings** (`<project>\.videohub\notes.json`, `versions.json`, `project.json`),
  `tweaks.json`, the render queue (`data\jobs.json`) and the agent history: old Turkish values (`açık`,
  `düzeltildi`, `hâlâ var`, `yapım`, `inceleme`, `onaylandı` …) are read as the English ones
  (`open`, `fixed`, `reopened`, `in-progress`, `review`, `approved` …) and saved in English the next time the
  file is written. The `hub_*` tools still accept the Turkish words.
- **Watched folders**: `data\config.json` → `roots` is kept exactly as it is (an existing config is never re-discovered).
- **Archive folder**: `archiveDir` is kept if it is in your config.
- **Sound edits** stored with the old range key (`aralık a–b`) still work; new ones are written as `range a–b`.

### What to set in `data\config.json` before or right after switching
Old builds derived these folders from a `Desktop\<your video folder>` when the key was missing. The new defaults are
under `Documents\VideoHub`, so add the keys you want to keep (use your real paths; JSON needs double backslashes):

```json
{
  "outputsDir": "C:\\Users\\<you>\\Desktop\\<your video folder>\\ciktilar",
  "soundLibDir": "C:\\Users\\<you>\\Desktop\\<your video folder>\\sesler",
  "studioDir": "C:\\Users\\<you>\\Desktop\\<your video folder>\\motorlar\\3d-studyo",
  "skipFolders": ["tools", "fonts", "test", "tr", "stiller", "thumbnails", "ref_analiz", "render", "videos"]
}
```

- `outputsDir` — the global outputs folder (hard links of every render). A Desktop folder named `VideoHub çıktılar`
  (the old generic default) is still found without a setting.
- `soundLibDir` — your sound library for "Add sound".
- `studioDir` — the 3D studio engine; needed for the ready-made sound effects and studio scenes.
- `skipFolders` — the old build skipped a fixed list of helper folder names inside container roots; put your own
  names here (the new default is `tools, fonts, test, render, videos, thumbnails, assets`).
All of these can also be set on the Settings page.

### Other changes to know about
- Script names: `KURULUM.cmd` → `SETUP.cmd`, `GUNCELLE.cmd` → `UPDATE.cmd`, `guncelle.ps1` → `update.ps1`.
  The installed skill (`~/.claude/skills/videohub`) is replaced by the English one; setup asks before adding the
  review-before-render rule to `~/.claude/CLAUDE.md` (keep your own rule if you have one and answer "no").
- The first queue render of a project with no film yet is now `_v1` (it used to be `_v2`).
- A first render with no earlier film takes its sound from the film's own `audio/mix.wav` (it used to be silent
  without a `render.mux`).
- The "Send to Claude" message and `hub_notes` now tell Claude to render only when you ask for it, also for notes on
  rendered videos.
- Ready-made sound effects get English names (`whoosh fast`, `sparkle` …): the old Turkish-named files in
  `data\sfx-lib` stay usable; delete that folder to have them rebuilt with the new names.
- Render protection is built into the hub. Old history is still readable; no separate agent needs rebuilding.
