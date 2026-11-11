# New film starter

Copy this folder into one of VideoHub's watched folders (default `<workspace>\films\<film-name>`, the workspace chosen in
setup, usually `Documents\VideoHub`) and build the
film in `film.js`. It already follows VideoHub's project contract (`docs/PROJECT-CONTRACT.md` in the VideoHub folder):

| File | What it is | Adapt |
|---|---|---|
| `index.html` | the page: one 1920×1080 canvas `#c` + `film.js` | another size: change the canvas, `W`/`H` in `film.js` and `VW`/`VH` in `render.js` (e.g. 1080×1920 for Shorts) |
| `film.js` | `window.renderOut(t)`, `window.READY`, `window.VH_SCENES` | everything — keep the three names and the "pure function of t" rule |
| `make-audio.js` | writes `audio/mix.wav` (a placeholder tone bed synthesized in code) | replace with your own mix: any `audio/mix.wav` works (voice-over, music, effects mixed together) |
| `render.js` | chunked renderer (Edge/Chrome + ffmpeg), 2-second chunks, `ONLY=` partial re-renders; frames straight from the canvas, graphics-card encoder (`VIDEOHUB_ENCODER`) | `FPS` (30 → 60), `CH` (frames per chunk, e.g. 120 at 60 fps), `VW`/`VH`, `PAGE` |
| `package.json` | `"type": "commonjs"` and an optional `puppeteer-core` | — |

Then:
1. `node make-audio.js` (or put your own `audio/mix.wav` there).
2. Tell VideoHub the length once (and 2 parallel workers, the fastest setting measured): `hub_project({project: "<folder>", set: {title: "…", status: "in-progress", render: {workers: 2, env: {DUR: "10"}}}})`.
3. `hub_live({project: "<folder>"})` — the film plays in VideoHub's live preview, no render.
4. The user leaves notes and presses **Send to Claude**; fix them in code; render (`hub_render({mode: "full"})`) only
   when the user asks for it. Later fixes: `hub_render({mode: "partial", notes: [ids]})` re-renders only those chunks.

`render.js` loads `puppeteer-core` from this folder (`npm install`) or from VideoHub's own `node_modules` (the render
queue passes `VIDEOHUB_DIR`), finds Edge or Chrome by itself (`CHROME` env overrides) and needs `ffmpeg` on PATH
(`FFMPEG` env overrides). Run by hand: `node render.js 2` → `render/<folder>.mp4` with sound.

Speed without quality loss: when the page is one `VW`×`VH` canvas with nothing over it (like this template), frames
are read straight from the canvas (lossless); otherwise they are PNG screenshots (lossless too, slower). Keep the whole
picture on the canvas — draw captions on it, not as HTML over it. The encoder is `VIDEOHUB_ENCODER` = `auto` (graphics
card when it can, else x264) | `nvenc` | `amf` | `qsv` | `x264`. Every frame must depend only on `t`: two browser copies
render different chunks at the same time. Details: `docs/RENDER-SPEED.md` in the VideoHub folder.
