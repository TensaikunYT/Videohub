"""Master BPM clock for "5x: What If Your Heart Beat 350 Times a Minute?"

Single source of truth for bpm(t), beat onsets, and phase.
Everything (heart animation, heartbeat audio triggers, ECG, BPM counter)
is driven from here so the whole film stays in sync.

Timeline (seconds):
  0-1.9    70
  1.9-2.4  70 -> 350 (ease-in snap)
  2.4-4.0  350
  4.0-4.6  350 -> 70 (ease-out)
  4.6-10   70
  10-17    70 -> 190 (smoothstep)
  17-19    190 -> 350 (ease-in)
  19-39    350
  39-47    irregular: nominal 350, beat intervals jittered +/-40%
  47-55    350 (chart scene; heart not primary)
  55-56    350 -> 70 (ease-out)
  56-60    70
First beat onset at t=0.30s (loop rhythm anchor).
"""

import bisect
import math
import random

DUR = 60.0
FIRST_BEAT = 0.30


def _ease_in(u):
    return u * u * u


def _ease_out(u):
    return 1.0 - (1.0 - u) ** 3


def _smooth(u):
    return u * u * (3.0 - 2.0 * u)


def bpm(t):
    """Nominal BPM at time t (seconds). Irregular window returns 350."""
    if t < 0:
        t = 0.0
    if t >= DUR:
        return 70.0
    if t < 1.9:
        return 70.0
    if t < 2.4:
        u = (t - 1.9) / 0.5
        return 70.0 + 280.0 * _ease_in(u)
    if t < 4.0:
        return 350.0
    if t < 4.6:
        u = (t - 4.0) / 0.6
        return 350.0 - 280.0 * _ease_out(u)
    if t < 10.0:
        return 70.0
    if t < 17.0:
        u = (t - 10.0) / 7.0
        return 70.0 + 120.0 * _smooth(u)
    if t < 19.0:
        u = (t - 17.0) / 2.0
        return 190.0 + 160.0 * _ease_in(u)
    if t < 55.0:
        return 350.0
    if t < 56.0:
        u = (t - 55.0) / 1.0
        return 350.0 - 280.0 * _ease_out(u)
    return 70.0


def _build_beats():
    """Generate beat onset times. Deterministic (seeded RNG)."""
    rng = random.Random(20261126)
    beats = []
    t = FIRST_BEAT
    # seed one virtual beat before t=0 so phase(0) is well defined
    beats.append(FIRST_BEAT - 60.0 / 70.0)
    beats.append(FIRST_BEAT)
    t = FIRST_BEAT
    while t < DUR + 2.0:
        b = bpm(t)
        interval = 60.0 / b
        if 39.0 <= t < 47.0:
            interval *= 1.0 + rng.uniform(-0.40, 0.40)
        next_t = t + interval
        if t < 56.0 <= next_t:
            next_t = 59.7 - 4 * (60.0 / 70.0)
        t = next_t
        beats.append(t)
    return beats


BEATS = _build_beats()


def beat_times():
    """All beat onset times in [0, DUR]."""
    return [b for b in BEATS if 0.0 <= b <= DUR]


def phase(t):
    """Beat phase in [0,1): 0 at a beat onset, 1 at the next onset."""
    if t <= BEATS[0]:
        return 0.0
    i = bisect.bisect_right(BEATS, t) - 1
    if i < 0:
        i = 0
    if i >= len(BEATS) - 1:
        return 0.0
    t0, t1 = BEATS[i], BEATS[i + 1]
    if t1 <= t0:
        return 0.0
    return (t - t0) / (t1 - t0)


def beat_index(t):
    """Index of the most recent beat onset at or before t."""
    return bisect.bisect_right(BEATS, t) - 1


def pulse_shape(ph, b):
    """Heart scale pulse for phase ph at bpm b. Returns 0..1 (1 = full contraction).

    Lub-dub double thump. At high BPM the dub gap compresses and the
    shape narrows (flutter). Amplitude is applied by the caller.
    """
    # lub: sharp rise + decay
    lub = math.exp(-ph * 9.0) if ph < 0.45 else 0.0
    # dub: smaller second bump; gap shrinks as bpm rises
    gap = 0.20 - 0.13 * min(1.0, max(0.0, (b - 70.0) / 280.0))
    gap = max(0.07, gap)
    dub = 0.0
    if ph > gap:
        dub = 0.55 * math.exp(-(ph - gap) * 11.0)
    v = lub + dub
    return min(1.0, v)


def pulse_amp(b):
    """Pulse amplitude (fractional scale). <=3% at 350 BPM (photosafety)."""
    u = min(1.0, max(0.0, (b - 70.0) / 120.0))
    return 0.085 - 0.055 * u  # <=3% at 190 BPM and above


def bpm_color(b):
    """BPM -> RGB color: cyan/crimson (rest) -> amber (high) -> danger red (350)."""
    u = min(1.0, max(0.0, (b - 70.0) / 280.0))
    if u < 0.5:
        v = u * 2.0
        # crimson (193,18,31) -> amber (255,176,32)
        return tuple(int(a + (c - a) * v) for a, c in zip((193, 18, 31), (255, 176, 32)))
    v = (u - 0.5) * 2.0
    # amber -> danger red (255,59,48)
    return tuple(int(a + (c - a) * v) for a, c in zip((255, 176, 32), (255, 59, 48)))


def ecg_value(ph):
    """ECG waveform value for beat phase ph in [0,1). ~0 baseline, QRS spike ~1."""
    # P wave (small bump)
    p = 0.12 * math.exp(-((ph - 0.16) ** 2) / 0.0012)
    # QRS: small dip then tall spike then dip
    q = -0.10 * math.exp(-((ph - 0.295) ** 2) / 0.00025)
    r = 1.0 * math.exp(-((ph - 0.315) ** 2) / 0.00035)
    s = -0.22 * math.exp(-((ph - 0.335) ** 2) / 0.0004)
    # T wave
    tw = 0.28 * math.exp(-((ph - 0.52) ** 2) / 0.004)
    return p + q + r + s + tw


def ecg_value_chaotic(ph, idx):
    """Chaotic ECG for S7: irregular spikes keyed by beat index (deterministic)."""
    h = math.sin(idx * 12.9898) * 43758.5453
    h = h - math.floor(h)
    base = ecg_value(ph)
    if h < 0.35:
        # flattened / missing beat
        return base * 0.25
    if h < 0.6:
        # extra spike
        extra = 0.7 * math.exp(-((ph - 0.65) ** 2) / 0.0006)
        return base + extra
    if h < 0.8:
        # wide weird complex
        return base * 0.6 + 0.3 * math.sin(ph * 40.0 + idx)
    return base


if __name__ == "__main__":
    print("beats in [0,60]:", len(beat_times()))
    for t in [0, 1.9, 2.15, 2.4, 4.0, 4.3, 4.6, 10, 13.5, 17, 18, 19, 30, 43, 50, 55.5, 56, 59.7]:
        print(f"t={t:5.2f} bpm={bpm(t):6.1f} phase={phase(t):.3f}")
    # irregular interval stats
    iv = [b - a for a, b in zip(BEATS, BEATS[1:]) if 39.0 <= a < 47.0]
    print("irregular intervals: n=%d min=%.3f max=%.3f" % (len(iv), min(iv), max(iv)))
