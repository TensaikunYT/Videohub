import test from 'node:test';
import assert from 'node:assert/strict';
import { catalog, normalizeBrief, validTid, validPid, generateTid } from './schema.js';

test('validTid and validPid validation', () => {
  assert.equal(validTid('20261104-k3f9'), true);
  assert.equal(validTid('20261104-abcdef12'), true);
  assert.equal(validTid('2026110-k3f9'), false); // date too short
  assert.equal(validTid('20261104-k'), false); // suffix too short
  assert.equal(validTid('../20261104-k3f9'), false); // path traversal attempt
  assert.equal(validTid('20261104-k3f9/foo'), false);

  assert.equal(validPid('_'), true);
  assert.equal(validPid('a1b2c3d4e5f6'), true);
  assert.equal(validPid('a1b2c3d4e5f'), false); // too short
  assert.equal(validPid('../_'), false);
  assert.equal(validPid(''), false);
});

test('generateTid creates valid format', () => {
  for (let i = 0; i < 10; i++) {
    const tid = generateTid();
    assert.equal(validTid(tid), true, `Generated tid ${tid} should be valid`);
  }
});

test('normalizeBrief clamps values and strips invalid types', () => {
  const raw = {
    id: '20261104-test',
    title: 'A'.repeat(500), // should be clamped
    format: 'invalid', // should default to 16:9
    status: 'unknown_status', // should default to draft
    camera: {
      tilt: 150, // clamp to 30
      height: -5, // clamp to 0
      dof: 2.5, // clamp to 1
      lens: 999, // unknown lens, default 50
    },
    light: {
      azimuth: 500, // clamp to 360
      elevation: -20, // clamp to 0
      contrast: 5, // clamp to 1
    },
    style: {
      saturation: 10, // clamp to 1
      detail: -2, // clamp to 0
    },
    layers: [
      {
        id: 'L1',
        type: 'subject',
        x: 5, // clamp to 1.5
        y: -2, // clamp to -0.5
        w: 10, // clamp to 3
        h: 0, // clamp to 0.01
        rot: 720, // clamp to 360
        depth: 250, // clamp to 100
        importance: 10, // clamp to 3
      },
      {
        id: 'L2',
        type: 'text',
        size: 0.8, // clamp to 0.5
        strokeW: 1.0, // clamp to 0.2
        lineHeight: 5, // clamp to 2.0
      }
    ]
  };

  const b = normalizeBrief(raw);
  assert.equal(b.id, '20261104-test');
  assert.equal(b.title.length, 200);
  assert.equal(b.format, '16:9');
  assert.equal(b.status, 'draft');

  // Camera limits
  assert.equal(b.camera.tilt, 30);
  assert.equal(b.camera.height, 0);
  assert.equal(b.camera.dof, 1);
  assert.equal(b.camera.lens, 50);

  // Light limits
  assert.equal(b.light.azimuth, 360);
  assert.equal(b.light.elevation, 0);
  assert.equal(b.light.contrast, 1);

  // Style limits
  assert.equal(b.style.saturation, 1);
  assert.equal(b.style.detail, 0);

  // Layer limits
  assert.equal(b.layers[0].x, 1.5);
  assert.equal(b.layers[0].y, -0.5);
  assert.equal(b.layers[0].w, 3);
  assert.equal(b.layers[0].h, 0.01);
  assert.equal(b.layers[0].rot, 360);
  assert.equal(b.layers[0].depth, 100);
  assert.equal(b.layers[0].importance, 3);

  assert.equal(b.layers[1].size, 0.5);
  assert.equal(b.layers[1].strokeW, 0.2);
  assert.equal(b.layers[1].lineHeight, 2.0);
});

test('layer count and sketch points limits', () => {
  const layers = [];
  for (let i = 0; i < 100; i++) {
    layers.push({ id: 'L' + i, type: 'object' });
  }
  const brief = normalizeBrief({ layers });
  assert.equal(brief.layers.length, 60, 'Maximum 60 layers allowed');

  // Sketch points limit (20,000 points)
  const hugeStroke = { pts: Array.from({ length: 25000 }, (_, i) => [i, i, 1]), w: 2, color: '#000' };
  const sketchBrief = normalizeBrief({
    layers: [{ id: 'S1', type: 'sketch', strokes: [hugeStroke] }]
  });
  assert.equal(sketchBrief.layers[0].strokes.length, 0, 'Excessive sketch points rejected');
});

test('catalog contains all expected keys', () => {
  const cat = catalog();
  assert.ok(Array.isArray(cat.styles) && cat.styles.length >= 18);
  assert.ok(Array.isArray(cat.poses) && cat.poses.length >= 15);
  assert.ok(Array.isArray(cat.expressions) && cat.expressions.length >= 9);
  assert.ok(Array.isArray(cat.angles) && cat.angles.length >= 7);
  assert.ok(Array.isArray(cat.shots) && cat.shots.length >= 7);
  assert.ok(Array.isArray(cat.lenses) && cat.lenses.length >= 7);
  assert.ok(Array.isArray(cat.textPresets) && cat.textPresets.length >= 5);
});
