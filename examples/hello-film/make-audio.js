// Writes audio/mix.wav: the film's sound, synthesized in code (no downloaded assets) — a soft pad that changes chord
// with each scene, a typing tick under the title, little "pops" when the shapes land and a bell at the outro.
//   node make-audio.js            (DUR env = length in seconds, default 10)
// VideoHub's live preview plays audio/mix.wav next to the picture; renders put the same file under the video.
'use strict';
const fs = require('fs'), path = require('path');
const SR = 22050, DUR = +(process.env.DUR || 10), N = Math.round(SR * DUR);
const L = new Float32Array(N), R = new Float32Array(N);
const midi = m => 440 * Math.pow(2, (m - 69) / 12);

function add(t0, len, fn, pan = 0) {   // fn(local time) → sample
  const a = Math.max(0, Math.round(t0 * SR)), b = Math.min(N, Math.round((t0 + len) * SR));
  const gl = Math.cos((pan + 1) * Math.PI / 4), gr = Math.sin((pan + 1) * Math.PI / 4);
  for (let i = a; i < b; i++) { const v = fn((i - a) / SR); L[i] += v * gl; R[i] += v * gr; }
}
// pad: three detuned sines per note, slow attack/release
const chords = [[0, 3.5, [57, 60, 64, 69]], [3.5, 3.5, [53, 57, 60, 65]], [7, 3, [55, 59, 62, 67]]];
for (const [t0, len, notes] of chords) notes.forEach((m, k) => {
  const f = midi(m);
  add(t0, len + 0.6, t => {
    const env = Math.min(1, t / 0.8) * Math.min(1, Math.max(0, (len + 0.6 - t) / 0.9));
    return env * 0.045 * (Math.sin(2 * Math.PI * f * t) + 0.6 * Math.sin(2 * Math.PI * f * 1.003 * t + k) + 0.4 * Math.sin(2 * Math.PI * f * 2 * t));
  }, (k - 1.5) / 2);
});
// typing ticks while the title appears (0.3–1.9 s, one per letter)
for (let i = 0; i < 15; i++) add(0.3 + i * (1.6 / 15), 0.04, t => Math.exp(-t * 180) * 0.25 * Math.sin(2 * Math.PI * 2400 * t) * (0.8 + 0.2 * ((i * 7) % 3)), ((i % 5) - 2) / 4);
// pops when the shapes land
[3.5, 3.75, 4.0].forEach((t0, i) => add(t0 + 0.35, 0.25, t => Math.exp(-t * 22) * 0.35 * Math.sin(2 * Math.PI * (220 + i * 90) * t * (1 + 2 * Math.exp(-t * 30))), i - 1));
// bell at the outro
add(7.1, 2.8, t => Math.exp(-t * 1.6) * 0.18 * (Math.sin(2 * Math.PI * 880 * t) + 0.5 * Math.sin(2 * Math.PI * 1320 * t) + 0.25 * Math.sin(2 * Math.PI * 2210 * t)));
// fade out the last half second, soft limit
for (let i = 0; i < N; i++) {
  const f = Math.min(1, (N - i) / (SR * 0.5));
  L[i] = Math.tanh(L[i] * f * 1.2); R[i] = Math.tanh(R[i] * f * 1.2);
}
// 16-bit stereo WAV
const data = Buffer.alloc(N * 4);
for (let i = 0; i < N; i++) { data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, L[i])) * 32767), i * 4); data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, R[i])) * 32767), i * 4 + 2); }
const h = Buffer.alloc(44);
h.write('RIFF', 0); h.writeUInt32LE(36 + data.length, 4); h.write('WAVE', 8); h.write('fmt ', 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(2, 22);
h.writeUInt32LE(SR, 24); h.writeUInt32LE(SR * 4, 28); h.writeUInt16LE(4, 32); h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(data.length, 40);
fs.mkdirSync(path.join(__dirname, 'audio'), { recursive: true });
fs.writeFileSync(path.join(__dirname, 'audio', 'mix.wav'), Buffer.concat([h, data]));
console.log(`audio/mix.wav: ${DUR} s, ${(data.length / 1048576).toFixed(1)} MB`);
