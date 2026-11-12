# Render speed

What the film render script (`templates/new-film/render.js`, the same file as `examples/hello-film/render.js`) does to
render fast without losing quality, how to pick the encoder, how to check quality yourself, and what was measured.

## What the render script does
1. **Frames straight from the canvas.** When the page has exactly one canvas of `VW`×`VH` that holds the whole picture
   (shown at 0,0 at full size, nothing else visible over it, no CSS opacity/filter/mask, sRGB, 2D or WebGL), each
   frame's pixels are read from the canvas (`getImageData` / `readPixels`), handed to a Web Worker (transferable
   buffer, no copy) and sent to the script over a local WebSocket as a Blob; ffmpeg gets raw RGBA. The script's own
   small WebSocket reader streams every piece to ffmpeg as it arrives (no package needed). At most 2 frames are in flight:
   the script acks a frame once ffmpeg's pipe holds at most one more, pauses the socket above two and resumes it on
   `drain` (and before closing ffmpeg's input, so the last frame is never held back).
   Any other page (several canvases, HTML text over the canvas, transparency) is captured as **PNG screenshots** —
   lossless as well, only slower. A frame with transparent pixels switches that worker to screenshots (a screenshot
   shows the page behind the canvas, the raw pixels would not). `VIDEOHUB_TRANSPORT=png` forces screenshots.
   Each worker prints which path it uses: `[w0] frames: raw canvas pixels` or `[w0] frames: PNG screenshots (why)`.
2. **2D canvases are drawn in software** (`--disable-accelerated-2d-canvas`): Chromium moves a canvas that is read back
   often to software drawing anyway, and with both paths on the same rasteriser raw frames and screenshots are
   pixel-identical. WebGL is not affected.
3. **Encoder** from `VIDEOHUB_ENCODER` (below). RGB is converted to YUV 4:2:0 with the BT.601 matrix (what renders
   used before, so old and new chunks of a film match) and the file is tagged so.
4. **Watchdog:** a chunk that takes longer than 60 s + 2 s per frame is killed and rendered again in a fresh browser,
   up to 3 times.
5. **Parallel browser copies** (`node render.js <workers>`, VideoHub's "Parallel" setting): 2 is the sweet spot
   (measured below; 3 was not faster). Parallel copies need frames that depend only on `t` (docs/PROJECT-CONTRACT.md §2).

Everything VideoHub reads from the script is unchanged: `FPS`, `CH`, `VW`, `VH`, `PAGE`, chunks in `render/chunks`,
`ONLY`, `PREVIEW`, `DUR`, `WK`, the progress lines, `.tmp.mp4` then rename, resume, `snap`. At the end it prints
`rendered N frames in S s (F fps, encoder E)`.

## Choosing the encoder
`VIDEOHUB_ENCODER` = `auto` | `nvenc` | `amf` | `qsv` | `x264` (default `auto`).
- `auto` tries a tiny test encode with NVIDIA NVENC, then AMD AMF, then Intel Quick Sync, and uses the first that
  works; otherwise x264 on the processor. A named encoder that does not work on the PC falls back to x264 (and says so).
- VideoHub passes the choice from setup / **Settings → Render speed** (`render.encoder` in `data\config.json`) to every
  render job, unless the job sets its own (the render dialog's *Encoder*). Scripts that ignore the variable are not
  affected. `GET /api/encoders` (and `node scripts\init-config.mjs --detect`) shows what this PC can use; the result is
  cached in `data\encoders.json` (`?refresh=1` probes again, e.g. after a driver update).
- `lossless` (libx264rgb, qp 0) exists for checks only: huge files.

| Encoder | Arguments | Status |
|---|---|---|
| x264 | `-c:v libx264 -preset veryfast -crf 16` | unchanged from before |
| AMF | `-c:v h264_amf -usage transcoding -quality quality -rc cqp -qp_i 14 -qp_p 16 -qp_b 18 -bf 3` (without `-bf 3` when the card rejects it) | **measured** (below) |
| NVENC | `-c:v h264_nvenc -preset p7 -tune hq -rc vbr -cq 20 -b:v 0 -maxrate 250M -bufsize 500M -level 5.2 -spatial-aq 1 -temporal-aq 1 -rc-lookahead 32 -bf 3 -b_ref_mode middle` | **unverified here**: measured on another PC (VMAF 94.48 vs x264 medium crf 15 at 94.25, ~25 % smaller); without `-level 5.2` and a high maxrate NVENC hit a ~40 Mbit/s ceiling on grainy 1080p60 |
| QSV | `-c:v h264_qsv -preset veryslow -global_quality 18 -look_ahead 1` | **unverified**: a starting point, never measured |

The table lives in `server/encoders.js` and, because films copy the script, again in `render.js`; a test keeps the two
the same.

## Checking quality yourself
1. Render the same frames twice: `VIDEOHUB_ENCODER=lossless` → a lossless reference; then with the encoder to check.
2. Compare as pictures, each decoded with its own colour tags, then to one YUV format:
   ```
   ffmpeg -i test.mp4 -i reference.mp4 -lavfi "[0:v]format=gbrp,scale=out_color_matrix=bt709,format=yuv444p[d];[1:v]format=gbrp,scale=out_color_matrix=bt709,format=yuv444p[r];[d][r]libvmaf" -f null -
   ```
   (`ssim` / `psnr` in place of `libvmaf` if your ffmpeg has no libvmaf.) Lower than x264 on the same reference means
   the setting loses quality. If the file size does not change when you change the quality setting, the encoder is on a
   bitrate ceiling.
3. Raw path = screenshots: render with `VIDEOHUB_TRANSPORT=png VIDEOHUB_ENCODER=lossless` and with
   `VIDEOHUB_ENCODER=lossless`, then compare `ffmpeg -i video.mp4 -pix_fmt rgb24 -f framemd5 -` of both: every line equal.

## What was measured (one test PC)
A desktop PC with a 12-thread processor and an AMD RDNA2-class graphics card (no NVIDIA, no Intel GPU), Windows 11,
Edge headless, ffmpeg 8.1 with libvmaf. Scratch copies of `examples/hello-film`, renders one at a time.

**Speed** — hello-film, 1920×1080, 10 s at 60 fps (600 frames), 2 workers, time including the browser start, two runs:

| Frames | Encoder | Time | fps |
|---|---|---|---|
| before: JPEG screenshots (quality 92, lossy) | x264 | 17–18 s | ~34 |
| PNG screenshots (the fallback) | x264 | 22.0–22.8 s | ~27 |
| PNG screenshots | AMF | 23.4–23.6 s | ~25.5 |
| raw canvas pixels | x264 | 13.6–13.9 s | ~44 |
| raw canvas pixels | AMF | 12.9–13.3 s | ~46 |

Raw + AMF with 1 / 2 / 3 workers: 30.5 / ~46 / 46.7 fps. PNG screenshots are ~20 % slower than the old JPEG ones; they
are kept because they are lossless and only used when the raw path cannot be. What did not work here: sending the
frame's ArrayBuffer from the worker (~70 ms per 8 MB frame; a Blob is ~2.5× faster), and the `ws` package as the
receiver (unmasking and joining 8 MB messages cost ~15 ms of the script's only thread per frame and capped renders at
~30–34 fps).

**Raw = screenshots** — hello-film 10 s at 30 fps (300 frames) through both paths, lossless: all 300 frames identical
(framemd5); a WebGL test page (60 frames): identical. Without software 2D drawing, frames differed by ±1 in most pixels
(Chromium had moved the read-back canvas to software drawing; the screenshots were GPU-drawn).

**Encoder quality** — against a lossless reference (libvmaf default model, SSIM, PSNR):

| Clip | Encoder | Size | VMAF | SSIM | PSNR |
|---|---|---|---|---|---|
| hello-film, 10 s 30 fps (gradients, text) | x264 veryfast crf 16 | 3.3 MB | 96.86 | 0.9958 | 47.36 |
| | AMF qp 14/16/18, B-frames | 2.1 MB | 97.17 | 0.9963 | 47.83 |
| | AMF qp 14/16/18, no B-frames | 2.8 MB | 97.39 | 0.9963 | 47.51 |
| grain: ffmpeg testsrc2 + strong moving noise, 10 s 1080p60 | x264 veryfast crf 16 | 192 MB | 95.49 | 0.8837 | 37.00 |
| | AMF qp 14/16/18, B-frames | 359 MB | 97.80 | 0.9261 | 39.21 |
| | AMF qp 14/16/18, no B-frames | 430 MB | 98.03 | 0.9422 | 40.11 |

The proposed AMF setting (qp 18/20/22) scored slightly below x264 on hello-film, so it was raised to 14/16/18. AMF's
files are smaller on clean pictures and larger on heavy grain (constant quality, no bitrate target).
A trap found on the way: AMF marks its output BT.709 while ffmpeg converts RGB with BT.601 by default, so players showed
shifted colours (PSNR stuck near 24 dB at any bitrate). The script now converts with BT.601 explicitly and tags it.

End to end (the same 300 frames rendered by the old and the new script, against the software-drawn lossless
reference): old JPEG + x264 VMAF 97.67 / SSIM 0.9953 / PSNR 47.92; new raw + AMF 97.25 / 0.9963 / 47.84; new raw + x264
96.94 / 0.9958 / 47.36. The new path has no lossy step before the encoder (SSIM is higher); VMAF, which looks at
brightness only, came out ~0.4 lower on this soft synthetic clip. The difference is not visible here, but it is
reported as measured.

## Not verified
- NVENC and Quick Sync: no such hardware on the test PC. Their arguments are a measurement from another PC (NVENC) and a
  proposal (QSV); `auto` falls back to x264 when their test encode fails.
- Films with heavy 2D effects (large blurs/shadows): software 2D drawing could be slower than GPU drawing there; the
  example film rendered at the same speed either way.
- Long films: clips were at most 10 s; the watchdog was checked by forcing a tiny time budget.

## On a Mac: VideoToolbox
`vt` (`h264_videotoolbox -q:v 70 -profile:v high`) is the Apple silicon media engine at constant quality 70, the
lowest setting at or above x264 veryfast crf 16 on a clean and a grainy clip (VMAF, SSIM and PSNR against a lossless
reference). On the M5 Pro it rendered the example at the same speed as x264 with 32 % less CPU; an Intel Mac has no
constant-quality mode in ffmpeg and keeps x264. The raw canvas path gave 300 frames identical to PNG screenshots
there too. Measurements, the frame-alignment pitfall in the comparison and what was not tested: [MACOS.md](MACOS.md).
