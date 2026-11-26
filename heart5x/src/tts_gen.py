"""Generate narration with Flite (local TTS, voice 'rms'), fit each line to
its scene window with ffmpeg atempo, and emit a manifest with word timings.

Flite outputs 8 kHz mono WAV. Lines are resampled to 48 kHz for the mix.
Word timings are proportional estimates (character-length weighted) because
Flite does not emit word timestamps and no forced aligner is available.
"""

import json
import os
import subprocess
import wave
import shutil

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
FLITE = os.environ.get("FLITE", shutil.which("flite") or "flite")
BUILD = os.path.join(ROOT, "build")
NARRATION = os.path.join(ROOT, "assets", "narration")
FFMPEG = subprocess.run(
    ["python3", "-c", "import imageio_ffmpeg; print(imageio_ffmpeg.get_ffmpeg_exe())"],
    capture_output=True, text=True,
).stdout.strip()

VOICE = "rms"

# (start, window_end, text) — exact words from the brief.
LINES = [
    (0.4, 3.9, "What if your heart suddenly beat five times faster?"),
    (4.2, 9.8, "At rest, it beats about seventy times a minute. Five times that is three hundred fifty."),
    (10.3, 16.8, "Speeding up is normal. Hard exercise can push a healthy young adult's heart to around one hundred ninety beats per minute."),
    (17.3, 24.8, "But at three hundred fifty, each beat lasts under two-tenths of a second. The chambers barely have time to refill between beats."),
    (25.3, 31.8, "Faster doesn't mean more blood. With less filling, each beat pushes out less, and blood pressure drops."),
    (32.4, 38.8, "Your brain notices first. Dizziness, tunnel vision, and fainting could follow within seconds."),
    (39.3, 46.8, "Worse: the heart feeds itself while relaxing. Now it barely does, and its rhythm can collapse into chaos."),
    (47.4, 54.8, "A hummingbird's heart can top one thousand beats a minute, but it's built for it. Yours isn't."),
    (55.2, 59.9, "Your heart doesn't just beat. It keeps time. Follow for more what-ifs."),
]

# Caption display text: numerals where the graphics show numerals.
CAPTIONS = [
    "What if your heart suddenly beat 5x faster?",
    "At rest, ~70 beats a minute. 5x that is 350.",
    "Speeding up is normal. Hard exercise ~190 BPM.",
    "At 350, each beat lasts under 0.2 s. Chambers barely refill.",
    "Faster is not more blood. Less filling, less output.",
    "Brain notices first. Dizziness, tunnel vision, fainting.",
    "Worse: heart feeds itself while relaxing. Rhythm can collapse.",
    "Hummingbird: 1,000+ BPM. Built for it. Yours isn't.",
    "Your heart keeps time. Follow for more What Ifs.",
]


def wav_duration(path):
    with wave.open(path) as w:
        return w.getnframes() / w.getframerate()


def main():
    os.makedirs(BUILD, exist_ok=True)
    os.makedirs(NARRATION, exist_ok=True)
    manifest = []
    for i, (start, wend, text) in enumerate(LINES, 1):
        raw = os.path.join(BUILD, f"vo_raw_{i}.wav")
        out = os.path.join(NARRATION, f"vo_line{i}.wav")
        subprocess.run([FLITE, "-v", VOICE, "-t", text, "-o", raw], check=True)
        d_raw = wav_duration(raw)
        target = (wend - start) - 0.25  # leave a small tail
        tempo = d_raw / target
        # atempo valid range 0.5..100; clamp so speech stays natural.
        # If the line is short, it simply ends early inside its window.
        tempo = max(0.85, min(1.6, tempo))
        subprocess.run(
            [FFMPEG, "-y", "-v", "error", "-i", raw,
             "-filter:a", f"atempo={tempo:.4f},aresample=48000",
             "-ac", "1", "-c:a", "pcm_s16le", out],
            check=True,
        )
        d_fit = wav_duration(out)
        # proportional word timings over the fitted line
        words = text.split()
        weights = [len(w) + 1 for w in words]
        total = sum(weights)
        tcur = start
        word_times = []
        for w, wt in zip(words, weights):
            dur = d_fit * wt / total
            word_times.append([round(tcur, 3), round(tcur + dur, 3), w])
            tcur += dur
        manifest.append({
            "line": i, "start": start, "window_end": wend,
            "text": text, "caption": CAPTIONS[i - 1],
            "raw_duration": round(d_raw, 3), "tempo": round(tempo, 4),
            "fitted_duration": round(d_fit, 3),
            "end": round(start + d_fit, 3),
            "words": word_times,
            "file": f"vo_line{i}.wav",
        })
        print(f"line {i}: raw={d_raw:.2f}s tempo={tempo:.3f} fitted={d_fit:.2f}s "
              f"window=[{start},{wend}] end={start + d_fit:.2f}")
    with open(os.path.join(NARRATION, "vo_manifest.json"), "w") as f:
        json.dump(manifest, f, indent=2)
    print("manifest written")


if __name__ == "__main__":
    main()
