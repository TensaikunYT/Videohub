# 5x Heart — production and QA report

## Delivered

- [Final 1080 × 1920 video](out/final_heart_5x_short.mp4)
- [540 × 960 preview](out/preview.mp4)
- [SubRip captions](out/captions.srt)
- Source, fonts, fitted narration and reproduction instructions: `heart5x/`.

`out` is a relative symlink to `deliverables/`; the media themselves are stored in the latter. The final was actually rendered, not merely specified. All illustrations are procedural; no stock footage or music was used.

## Capability probe and tools actually used

The render environment was Linux x86-64, Python 3.11.2, Node 22.22.3, two CPUs and about 3.8 GiB RAM. No GPU, Blender, installed headless browser, system FFmpeg, or system TTS was found in the probe. No external speech or image API was used, and no API-key capability is claimed. Apt package downloads failed because the Debian mirrors were unreachable. The preferred browser/Three.js or Remotion route was therefore not used.

- Procedural layered 2D graphics: Pillow 13.0.0 and NumPy 2.4.6, drawn frame by frame at the actual output resolution. SciPy 1.17.1 was used in audio synthesis/filtering. Preview was rendered before the final.
- FFmpeg 9.0.2 from `imageio-ffmpeg` 0.8.1, with libx264, AAC, and `loudnorm`. For inspection, ffprobe was obtained separately from the npm `@ffprobe-installer/linux-x64` package; it was not used for encoding.
- Fonts: Montserrat, Inter and JetBrains Mono variable fonts from Google Fonts, under the SIL Open Font License; license files are in `heart5x/assets/fonts/`. ExtraBold/Bold weights are selected in the renderer.
- Narration: local open-source Flite, built from `festvox/flite`, using its `rms` voice. Raw output was 8 kHz mono; FFmpeg tempo fitting and resampling produced the included 48 kHz mono takes. The script contains the supplied exact narration wording. No Piper model was used: a model download from GitHub release assets failed due to the sandbox's network restrictions. Flite is an audible quality fallback, not a natural neural voice. No generated speech API was used.
- Audio: original NumPy-synthesized dual thumps/noise clicks and a simple oscillator-based ambient bed. The music is ducked approximately 9 dB under the narration; heartbeat is also reduced during speech. Voice processing uses an 80 Hz high-pass and soft saturation, **not** a dedicated de-esser or a conventional compressor. FFmpeg loudness normalization is applied to the finished mix.

## Measured final-file checks

| Check | Result |
|---|---|
| Container and duration | MP4, 60.000000 s, 1,800 frames |
| Video | H.264 High, 1080 × 1920, yuv420p, constant 30/1 fps, 11.96 Mb/s video (approximately 12 Mb/s) |
| Audio | AAC-LC, stereo, 48 kHz, approximately 191 kb/s |
| Streaming | `moov` atom before `mdat` (+faststart) |
| Loudness | FFmpeg EBU R128: −14.5 LUFS integrated, −1.1 dBTP measured after AAC encoding |
| Loop image | Decoded first/last frame mean absolute difference: about 0.02 out of 255 per RGB channel; differences are encoder artifacts. The final clock beat is at 59.7 s and the first at 0.3 s; the join interval is 0.6 s, not an exact 70 BPM interval, so the audio loop is not perfectly periodic. |
| Captions | 41 SRT cards; the same words are burned in with a highlighted current word. The four-word maximum cards were checked for wrapping in the intended caption area. |
| Photosensitivity | Code review: no repeated full-frame flashes; heartbeat scale modulation is at most 3% from 190 BPM upward. The separate brief hook camera punch is not a heartbeat pulse. This is not a formal photosensitivity certification. |

The final encoded output was decoded at the nine scene boundaries and one point in each scene for visual inspection, plus the first and last frames. Composition, major labels, counter, and disclaimer were checked. Data bar proportions for heart filling and pressure are illustrative; the comparison-chart heights follow the labeled values. All specified scene time windows and the BPM clock are present. The last scene includes the medical disclaimer. The BPM clock drives the counter, beat timing, pulse and ECG, including seeded irregular intervals during the 39–47 s section.

## Known limitations / departures from the brief

- Word highlighting and SRT timings are **character-weighted estimates**, not speech timestamps or forced alignment. They can lead or lag the actual syllables; manual alignment and a listening pass are recommended before publication. The synthetic voice was not independently assessed by a human listener in this environment, so clarity and the intended delivery should not be considered verified.
- The medical illustrations are deliberately simplified flat/layered 2D graphics, not anatomical 3D. Several requested bespoke cinematic details are approximated or absent: artery particles do not thin out over time; brain dimming is uniform rather than region-by-region; there is no fully realized tunnel-vision POV, rack focus, camera orbit, volumetric lighting, or film grain. Motion consists mainly of timed graphics, heartbeat scale, particles, ECG and a hummingbird wing. The music/SFX are a simple synthesized bed and heartbeat rather than the full detailed riser, whoosh, wing hum and transition design requested. Not all cuts land on beats; transitions are mostly cuts or short dark dips. The ending image is near-identical, but the audio loop is not perfectly periodic as noted above.
- VO level is prioritized by the mix and music ducking, but intelligibility has not been verified by a listening panel. An independent medical and accessibility review has not been performed. S7's near-silence is applied to the music and heartbeat; the exact supplied narration can continue across that interval.
