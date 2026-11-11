# The project contract

What a film project must look like for each VideoHub feature. Everything here is read from the code
(`server/scan.js`, `live.js`, `jobs.js`, `layers.js`, `transcript.js`, `scenes.js`, `ui/review/scenes.js`).
`examples/hello-film` follows all of it and is the quickest way to see it working; `templates/new-film` is the starter
Claude copies for a new film.

| Feature | Needs |
|---|---|
| Listed on the Projects page | a folder inside a watched folder that has a video, or code VideoHub can play/render (§1) |
| Live preview (no render), notes on live frames | a page with `window.renderOut(t)` + `window.READY` (§2) |
| Notes on a rendered video, compare versions | any MP4 in the project (§3) |
| Render queue, full renders | a `render.js` / `render.mjs` / `render.py` VideoHub can run (§4), or `mode:"command"` |
| Partial re-render of only the fixed chunks | a *chunked* render script ("family A", §4.2) |
| Sound in renders | `audio/mix.wav` (or `render.mux`, §4.4) |
| Scene lane on the timeline | `window.VH_SCENES` or `shots.json` (§5.1) |
| Narration row, captions, "narration at that moment" in notes | `words.json` / `.srt` (§5.2) |
| Sound layers, mute/solo, per-layer levels | stem WAVs (§5.3) |
| Scene editor / 2D layers editor | the optional engine hooks (§5.4) |

## 1. What makes a folder a project

VideoHub scans the folders listed in Settings → Folders ("roots"). A root has a type:

- **container** — every sub-folder is a project (the default films folder, `<workspace>\films`, is one; the
  workspace is chosen in setup, default `Documents\VideoHub`).
  Sub-folders named in `config.skipFolders` (default `tools, fonts, test, render, videos, thumbnails, assets`) and
  folders starting with `_` or `.` are skipped, unless they have their own `render.js`.
- **project** — the folder itself is one project.
- **media** — finished videos; loose files are grouped into films by base name (`film_v2.mp4` + `film_web.mp4`).

A sub-folder of a container is listed when it has a video (`.mp4 .mov .webm .mkv` anywhere inside), or — with no video
yet — when it (or a folder one level down) has `render.js` / `render.mjs` / `render.py` / `make.mjs` / `index.html` /
a `.snipp` file / `STATE.md`, or a `.videohub/notes.json`. Empty folders are not listed. A folder with `make.mjs`,
`scenes/` and `engine/index.html` is a *studio* (one engine, many scenes): each `scenes/<name>/scene.js` is a project.

VideoHub keeps its own files for a project in `<project>/.videohub/`: `notes.json` (+ `notes/` pictures),
`versions.json`, `project.json`, `scenes.json`, `autoscan.json`. They travel with the project folder.

### `.videohub/project.json`
Optional; Claude writes it with `hub_project({set:{…}})`. Keys:

```json
{
  "title": "My film",
  "status": "in-progress",
  "render": { "script": "render.js", "workers": 2, "env": { "DUR": "42.5" }, "mux": ["-y", "-i", "{video}", "-i", "audio/mix.wav", "-map", "0:v", "-map", "1:a", "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-shortest", "{out}"] },
  "live": { "page": "index.html", "audio": "audio/mix.wav", "dur": 42.5, "fps": 60 },
  "transcript": { "file": "voice/words.json", "offset": 0.5 }
}
```

`status` is one of `in-progress`, `review`, `revision`, `approved`, `published`, `archived`, `done` (without one,
VideoHub guesses: no final → in-progress; a final older than a week → done; else review). Only an explicit
`approved` / `published` / `archived` / `done` lets the Disk page offer the film's current chunks for cleanup.

## 2. Live preview contract

The live preview plays the film from its page in an iframe — no MP4 — and reloads it whenever a code file changes.

**The page must:**
1. define `window.renderOut(t)` — draw second `t` of the film **synchronously** (when it returns, the frame is on the
   canvas) on **fixed-size** canvases (the size of the video, e.g. 1920×1080; CSS may scale them for display);
2. be a pure function of `t`: any frame in any order (no `Date.now()`, no accumulated state, no unseeded
   `Math.random()`), so seeking, frame stepping, partial renders and parallel render workers (each browser copy draws
   a different chunk) give the same picture;
3. set `window.READY = true` once everything it needs (images, fonts, models) is loaded.

`renderOut` is found in the page itself, in a `<script src>` next to it, or in any `.js`/`.mjs` under `src/`.

**How VideoHub finds the rest** (first match wins):

| | Source |
|---|---|
| page | `project.json` `live.page` → `PAGE` in `render.env` → the render script's `PAGE = process.env.PAGE \|\| 'x.html'`, `goto(…/x.html)` or `resolve('x.html')` → `index.html` |
| fps | `live.fps` → the render recipe's fps when not 60 → `FPS = …` in the render script → 60 |
| size | `"width": …, "height": …` in `data.js`/`data.json` next to the page → `VW = …` / `VH = …` in the render script → 1920×1080; the player then also adopts `window.__config`, `window.DATA`, or the page's largest canvas |
| length | `live.dur` → `render.env.DUR` → the audio file's length → the newest video's length → 60 s (then `hub_live` asks Claude to save `DUR`) |
| sound | `live.audio` → `audio/mix.wav`, `audio/mix.mp3`, `audio/final.wav`, `audio/master.wav`, `mix.wav`, `audio/mix.m4a` → an `-i` input of `render.mux` → the biggest audio file in `audio/` or the top folder (names with mix/final/master first) → the newest final video |

The page is served at `/live/<id>/…` from the project folder (absolute `src`/`href` and importmap paths are pointed into
the project). Folders `render, out, snaps, chunks*, node_modules, .videohub, tmp, profiles, vh2d, vhaudio` and
`tweaks.json` do not trigger a reload.

## 3. Outputs: how videos are classified

Every video in the project is probed with ffprobe and gets a role:

- **broken** — no video stream; **silent** — no audio stream (an intermediate when a voiced video shows the same picture);
- **web** — name contains `_web` / `-web`; **preview** — `preview`, `_prev`, `draft` in the name;
- **clip** — a voiced test render: under half the film's length, in a test folder (`qa, lookdev, test(s), tmp, temp,
  debug, bench, clip(s), scratch, preview(s), probe`) or named test/clip/qa/probe/bench/debug — unless `versions.json`
  registered it;
- **final** — everything else with sound.

Files under `chunks/` (`c_NNN.mp4`) are chunks, `chunks_prev*` / `chunks_vN` old chunks, `part*.mp4`, `seg_*`,
`*_silent.mp4`, `*.tmp.mp4` are parts, images in `snaps/ qa/ frames*/ shots/` are snaps. The project's **latest
video** is the newest final (then web, then preview) — never a clip, part or silent file.

## 4. Render scripts the queue understands

The queue (`hub_render` / "🎬 Render" / `POST /api/jobs`) runs one render at a time on the PC. For a project with a
render script it runs, in the project folder:

```
node render.js <workers>          (render.mjs the same; render.py is listed but rendered only through mode:"command")
```

with these environment variables: `DUR` (from `project.json` `render.env`, else the manifest, else worked out from
existing chunks), `WK` (= workers), `ONLY` (partial renders), `PREVIEW=1` (preview mode), `FPS` (if the user picked
one), `VIDEOHUB_ENCODER` (`auto | nvenc | amf | qsv | x264`: Settings → Render speed, or the render dialog; a script may
ignore it), `VIDEOHUB_JOB` (the job id) and `VIDEOHUB_DIR` (the VideoHub folder — e.g. to load its `puppeteer-core`).
Any other `render.env` keys are passed too. Progress is read from stdout lines like `12/40 chunks to render` and
`[w0] chunk 3 ok — 5 done` (also `chunk 3 ok  5/40  85s` and `w1] 120/600`).

### 4.1 Families (what the scan reads from the script's source)
- **A, chunked** — has `CH = <frames per chunk>` and the word `chunks`: writes `render/chunks/c_000.mp4, c_001.mp4 …`.
  Full and partial renders, versions, chunk-accurate notes.
- **B / C** — writes `part${w}` worker files / `seg_` segments: full renders only.
- **code** — any other script: full renders only (`mode:"full"`), or `mode:"command"` with your own command and output
  (a custom command waits on the Renders page until the user approves it).
- A `render/manifest.json` (`{fps, chunkFrames, chunkSec, width, height, dur, family}`) overrides what the scan read.

Read from the source: `FPS = 60` or `FPS = +(process.env.FPS || 60)` (fps), `CH = 120` (chunk frames),
`VW = 1920` / `VH = 1080` (size), `process.env.ONLY` (can re-render single chunks), `process.env.PREVIEW` and
`process.env.FPS` (offered in the render dialog), `process.env.WK` (workers), `process.env.VIDEOHUB_ENCODER` (the
render dialog offers the encoder). How the template's script renders fast without losing quality (frames straight from
a single full-size canvas, else PNG screenshots; graphics-card encoders): [RENDER-SPEED.md](RENDER-SPEED.md).

### 4.2 Chunks and partial re-renders (family A)
- Chunk `c` covers frames `c*CH … c*CH+CH-1`; files are `render/chunks/c_` + 3-digit number + `.mp4`, each exactly `CH`
  frames (the last may be shorter). The queue checks the frame count of every re-rendered chunk.
- **Full render:** the queue moves `render/chunks/` to `render/chunks_v<N-1>/` (kept for comparing, cleanable later),
  runs the script, then joins all chunks itself (`render/list.txt` → `render/video.mp4`, stream copy).
- **Partial render** (`mode:"partial"` with note ids, seconds or chunk numbers): the chunks a note touches (its time
  ±0.5 s, its range, its drawing frame) are moved to `render/chunks_v<N-1>/`, the script runs with `ONLY=3,4` and must
  render only the missing chunks it is asked for (a script should skip chunks that already exist and are not in
  `ONLY`), then the film is joined again. Without `process.env.ONLY` support the script renders every missing chunk.
- Partial renders need a known length (`DUR`): save it once with `hub_project({set:{render:{env:{DUR:"…"}}}})`.

### 4.3 Preview renders
`mode:"preview"` runs the script with `PREVIEW=1` and expects `render/preview/video.mp4` (or `render/preview.mp4`).
Saved as `<name>_preview_vN.mp4`.

### 4.4 Sound (mux)
After joining, the queue lays the sound under the picture, in this order:
1. `project.json` `render.mux` — your ffmpeg arguments with `{video}` and `{out}` (runs in the project folder);
2. the mix VideoHub rebuilt itself (sound levels or clips added on the review timeline, see §5.3);
3. the previous final's audio track, copied as is (only from a film about as long as the new picture);
4. the film's own audio file — the same one the live preview plays (`audio/mix.wav` …) — for a first render;
5. otherwise the result is silent.

### 4.5 Versions
Each render is saved as `<base>_vN.mp4` in the project (base = the latest film's name without `_vN`/`_web`, else the
folder name) and recorded in `.videohub/versions.json` (`v, file, kind, created, job, mode, parent, changedRanges,
chunks, notes`). Registering a final also marks every older note that was still open/with Claude as `fixed`
(the user re-checks them in the review's check tour). Each version is also hard-linked into the outputs folder
(`<outputs>\YYYY-MM-DD\YYYY-MM-DD <title> vN.mp4`, no extra disk space). A video made outside the queue can be
registered with `hub_register_version`.

### 4.6 Studio scenes
A studio (`make.mjs` + `scenes/` + `engine/`) renders with `node make.mjs <scene> --chunks [--only a,b] --jobs N`
into `out/<scene>/render/chunks`, and adds its sound with `make.mjs <scene> --mux <video> <out>`. Partial renders need
one full render first (its `out/<scene>/render/manifest.json`).

## 5. Optional extras

### 5.1 Scenes on the timeline
`window.VH_SCENES = [{name, t0, t1}, …]` (or a function returning it) on the live page. Also understood: `SHOTS`,
`EVENTS.shots` with `PIECES`, `__qaShotAt(t)`. The live preview stores what it found in `.videohub/scenes.json` so
rendered videos show the lane too; without it `data/shots.json` or `shots.json` is read.

### 5.2 Narration text
Found automatically (up to 3 folders deep): `words.json` (`[[start, end, "word"], …]` or `[{w|word|text, s|start,
e|end}]`), `words_<lang>.json`, `words.js` (`export const WORDS = [[s, e, "w"], …]`), then `*.srt` (phrase SRTs first).
`project.json` `transcript: {file, offset}` picks one explicitly. It fills the timeline's text row, captions (C) and
each note's "narration at that moment".

### 5.3 Sound layers and cues
Stems shown as timeline rows with mute/solo/level: voice `audio/st_vo.wav, data/vo.wav, audio/vo.wav, audio/voice.wav,
stems/vo.wav`; music `audio/music.wav, audio/st_bed.wav, audio/bed.wav, stems/music.wav`; effects `audio/sfx.wav,
audio/st_sfx.wav, stems/sfx.wav`; and every other `stems/*.wav`. Cue marks: `data/cues.json` `[{t, k, g}]` or
`audio/cues.json` `{cues: [{t, name, gain}]}`. With music + effects stems next to a WAV mix, "Apply to film" rebuilds
the mix (the original is kept as `<mix>.vhorig.wav`).

### 5.4 Edits the user makes in VideoHub (`tweaks.json`)
The film's `tweaks.json` holds what the user changed in VideoHub without code: `sound` (levels, "Remove music",
ducking), `audio.clips` (sounds added on the timeline; files copied into `vhaudio/`), and — for engines with the hooks
in `engine-hooks/` — `shots`/`cuts` (scene editor: `window.VH_EDIT`), `items2d` / `actors2d` (2D layers: `window.VH2D`,
pictures in `vh2d/`). A page that wants these edits in its renders must apply them itself (the hooks show how);
sound edits are applied by VideoHub when it builds the mix. Never delete or overwrite these keys when editing the film.

### 5.5 Quick checks ("🔍 Scan")
Pages with `window.qaFrame` get engine-specific frame checks; every live page gets brightness/freeze checks from its
canvases.
