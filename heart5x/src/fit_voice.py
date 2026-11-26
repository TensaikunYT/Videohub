"""Fit user-selected speech clips to the film and make estimated caption timings.

Input is nine files named line1.wav ... line9.wav generated externally from the
exact text in tts_gen.LINES. The shipped fitted takes are sufficient for renders;
the original service and selected voice may not be available in another session.
"""
import argparse
import json
import os
import subprocess
import tempfile
import wave

import imageio_ffmpeg
import numpy as np
from scipy.io import wavfile
from tts_gen import LINES, NARRATION


def duration(path):
    with wave.open(path, 'rb') as f:
        return f.getnframes() / f.getframerate()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('directory', help='directory containing line1.wav ... line9.wav')
    args = parser.parse_args()
    os.makedirs(NARRATION, exist_ok=True)
    manifest = []
    for i, (start, window_end, text) in enumerate(LINES, 1):
        source = os.path.join(args.directory, f'line{i}.wav')
        sr, sound = wavfile.read(source)
        if sound.ndim == 2:
            sound = sound.mean(axis=1).astype(sound.dtype)
        if sound.dtype != np.int16:
            raise ValueError(f'expected signed 16-bit PCM: {source}')
        block = max(1, int(sr * .01))
        count = len(sound) // block
        x = sound[:count * block].astype(np.float32).reshape(count, block) / 32768
        rms = np.sqrt(np.mean(x*x, axis=1))
        active = np.flatnonzero(rms > .008)
        if len(active) == 0:
            raise ValueError(f'no speech detected: {source}')
        # Retain breathing and quiet consonants around the active speech.
        a = max(0, int((active[0] * .01 - .06) * sr))
        z = min(len(sound), int(((active[-1]+1) * .01 + .10) * sr))
        trimmed = sound[a:z]
        fitted_limit = min(window_end - .10, 59.64) - start
        tempo = max(1.0, (len(trimmed) / sr) / (fitted_limit - .05))
        out = os.path.join(NARRATION, f'vo_line{i}.wav')
        with tempfile.TemporaryDirectory() as temp:
            tmp = os.path.join(temp, 'trimmed.wav')
            wavfile.write(tmp, sr, trimmed)
            subprocess.run([imageio_ffmpeg.get_ffmpeg_exe(), '-y', '-v', 'error', '-i', tmp,
                            '-af', f'atempo={tempo:.6f},aresample=48000', '-ac', '1',
                            '-c:a', 'pcm_s16le', out], check=True)
        length = duration(out)
        if start + length > window_end or start + length > 59.7:
            raise ValueError(f'line {i} exceeds window: {start + length:.3f}')
        words = text.split()
        weights = [len(word) + 1 for word in words]
        t = start
        timings = []
        for word, weight in zip(words, weights):
            word_end = t + length * weight / sum(weights)
            timings.append([round(t, 3), round(word_end, 3), word])
            t = word_end
        manifest.append({'line': i, 'start': start, 'window_end': window_end,
                         'text': text, 'raw_duration': round(len(sound) / sr, 3),
                         'trim_start': round(a / sr, 3), 'tempo': round(tempo, 4),
                         'fitted_duration': round(length, 3), 'end': round(start+length, 3),
                         'words': timings, 'file': f'vo_line{i}.wav',
                         'voice': 'Arena selected voice-00'})
        print(f'line {i}: raw {len(sound)/sr:.2f}s; tempo {tempo:.3f}; fitted {length:.2f}s; ends {start+length:.2f}s')
    with open(os.path.join(NARRATION, 'vo_manifest.json'), 'w') as f:
        json.dump(manifest, f, indent=2)
        f.write('\n')


if __name__ == '__main__':
    main()
