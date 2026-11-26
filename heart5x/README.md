# 5x Heart short

The rendered files are in `../out/` (a symlink to `../deliverables/`); the
report is `../report.md`. Artwork, scene timing, synthesized sound, and frame
rendering live in `src/`. `assets/narration/` contains the actual fitted local
Flite takes, so Flite is not required to reproduce the existing output. Fonts
are OFL-licensed; license texts are next to the font files.

From the repository root, in a Python 3.11 environment:

```sh
python3 -m pip install -r heart5x/requirements.txt
mkdir -p heart5x/build
python3 heart5x/src/audio_gen.py
python3 heart5x/src/captions.py
python3 heart5x/src/render.py --width 540 --output out/preview.mp4
python3 heart5x/src/render.py --width 1080 --output out/final_heart_5x_short.mp4
```

The renderer uses the FFmpeg executable supplied by `imageio-ffmpeg` and
requires its libx264, AAC, and loudnorm support. To replace the existing TTS,
install/build Flite with the `rms` voice, then set `FLITE=/path/to/flite` and
run `python3 heart5x/src/tts_gen.py` before the steps above. This regenerates
narration assets and the estimated timing manifest. Individual caption word
times are heuristics, not forced alignment; see the report before publishing.
