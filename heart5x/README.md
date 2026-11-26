# 5x Heart short

The rendered files are in `../out/` (a symlink to `../deliverables/`); the
report is `../report.md`. Artwork, scene timing, synthesized sound, and frame
rendering live in `src/`. `assets/narration/` contains the fitted user-selected
Arena speech takes, so speech generation is not required to reproduce the
existing output. Fonts are OFL-licensed; license texts are next to the fonts.

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
requires its libx264, AAC, and loudnorm support. To fit alternate speech takes,
place nine signed 16-bit PCM files named
`line1.wav` through `line9.wav` in a directory and run
`python3 heart5x/src/fit_voice.py <directory>` before the render steps above.
The legacy `tts_gen.py` can generate Flite as a lower-quality fallback but
overwrites the shipped narration. Individual caption word times are heuristics,
not forced alignment; see the report before publishing.
