# Moving an existing (Turkish) install to this version

Older VideoHub builds were Turkish and had folder defaults for one particular PC. This version is English and its
defaults live under `Documents\VideoHub`. Nothing is lost when you switch, but a few settings should be written down
first so VideoHub keeps using your current folders.

## What carries over by itself
- **Notes, versions, project settings** (`<project>\.videohub\notes.json`, `versions.json`, `project.json`), thumbnail
  briefs, `tweaks.json`, the render queue (`data\jobs.json`) and the agent history: old Turkish values (`açık`,
  `düzeltildi`, `hâlâ var`, `yapım`, `inceleme`, `onaylandı`, `taslak` …) are read as the English ones
  (`open`, `fixed`, `reopened`, `in-progress`, `review`, `approved`, `draft` …) and saved in English the next time the
  file is written. The `hub_*` tools still accept the Turkish words.
- **Watched folders**: `data\config.json` → `roots` is kept exactly as it is (an existing config is never re-discovered).
- **Archive folder**: `archiveDir` is kept if it is in your config.
- **Sound edits** stored with the old range key (`aralık a–b`) still work; new ones are written as `range a–b`.

## What to set in `data\config.json` before or right after switching
Old builds derived these folders from a `Desktop\<your video folder>` when the key was missing. The new defaults are
under `Documents\VideoHub`, so add the keys you want to keep (use your real paths; JSON needs double backslashes):

```json
{
  "outputsDir": "C:\\Users\\<you>\\Desktop\\<your video folder>\\ciktilar",
  "soundLibDir": "C:\\Users\\<you>\\Desktop\\<your video folder>\\sesler",
  "studioDir": "C:\\Users\\<you>\\Desktop\\<your video folder>\\motorlar\\3d-studyo",
  "thumbstudio": {
    "globalDir": "C:\\Users\\<you>\\Desktop\\<your video folder>\\thumbnails",
    "templatesDir": "C:\\Users\\<you>\\Desktop\\<your video folder>\\referanslar\\thumbnail-sablonlari",
    "styleRefsDir": "C:\\Users\\<you>\\Desktop\\<your video folder>\\referanslar\\thumbnail-stilleri"
  },
  "skipFolders": ["tools", "fonts", "test", "tr", "stiller", "thumbnails", "ref_analiz", "render", "videos"]
}
```

- `outputsDir` — the global outputs folder (hard links of every render). A Desktop folder named `VideoHub çıktılar`
  (the old generic default) is still found without a setting.
- `soundLibDir` — your sound library for "Add sound".
- `studioDir` — the 3D studio engine; needed for the ready-made sound effects and studio scenes.
- `thumbstudio.*` — shared thumbnails, your templates, your style references.
- `skipFolders` — the old build skipped a fixed list of helper folder names inside container roots; put your own
  names here (the new default is `tools, fonts, test, render, videos, thumbnails, assets`).
All of these can also be set on the Settings page.

## Other changes to know about
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
- Built-in thumbnail templates have English ids and file names (`before-after.json` …). Your own templates are not
  touched.
- Render protection is built into the hub. Old history is still readable; no separate agent needs rebuilding.
