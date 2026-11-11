// peaksOf from server/media.js, read from the source (importing media.js would set up its cache folders)
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const src = fs.readFileSync(new URL('./media.js', import.meta.url), 'utf8');
const body = src.match(/export function peaksOf[\s\S]*?\r?\n}\r?\n/)[0].replace(/^export /, '');   // \r?: a Windows clone has CRLF
const peaksOf = new Function(body + '; return peaksOf;')();

test('peaksOf: min/max pairs per 80 samples, ×127, a short last bucket', () => {
  const f = new Float32Array(200);
  f[3] = 0.5; f[10] = -1; f[90] = 2; f[170] = -0.25; f[199] = 0.1;
  const p = peaksOf(f);
  assert.equal(p.length, 6);
  assert.deepEqual(Array.from(p), [-127, 64, 0, 127, -32, 13]);
  assert.deepEqual(Array.from(peaksOf(new Float32Array(0))), []);
});
