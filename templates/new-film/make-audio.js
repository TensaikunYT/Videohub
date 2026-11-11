// Writes a placeholder audio/mix.wav (a quiet chord bed, synthesized in code) so the film plays with sound in VideoHub's
// live preview from the first minute. Replace it with your real mix (voice-over + music + effects) as audio/mix.wav.
//   node make-audio.js            (DUR env = length in seconds, default 10)
'use strict';
const fs = require('fs'), path = require('path');
const SR = 22050, DUR = +(process.env.DUR || 10), N = Math.round(SR * DUR);
const data = Buffer.alloc(N * 4);
const notes = [57, 60, 64].map(m => 440 * Math.pow(2, (m - 69) / 12));
for (let i = 0; i < N; i++) {
  const t = i / SR, env = Math.min(1, t / 1.5) * Math.min(1, (DUR - t) / 1.5);
  let v = 0; notes.forEach((f, k) => { v += Math.sin(2 * Math.PI * f * t + k) * 0.05 * (1 + 0.3 * Math.sin(t * 0.7 + k)); });
  const s = Math.round(Math.max(-1, Math.min(1, v * env)) * 32767);
  data.writeInt16LE(s, i * 4); data.writeInt16LE(s, i * 4 + 2);
}
const h = Buffer.alloc(44);
h.write('RIFF', 0); h.writeUInt32LE(36 + data.length, 4); h.write('WAVE', 8); h.write('fmt ', 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(2, 22);
h.writeUInt32LE(SR, 24); h.writeUInt32LE(SR * 4, 28); h.writeUInt16LE(4, 32); h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(data.length, 40);
fs.mkdirSync(path.join(__dirname, 'audio'), { recursive: true });
fs.writeFileSync(path.join(__dirname, 'audio', 'mix.wav'), Buffer.concat([h, data]));
console.log(`audio/mix.wav: ${DUR} s placeholder`);
