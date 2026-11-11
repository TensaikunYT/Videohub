import test from 'node:test';
import assert from 'node:assert/strict';
import { getGridParams, checkFramingConsistency, applyPerspectiveLock } from '../../ui/thumbstudio/camera.js';
import { getSunGizmoPos, hitTestLightGizmo, computeAzimuthFromPointer } from '../../ui/thumbstudio/light.js';

test('getGridParams respects angle and lens', () => {
  const W = 1280;
  const H = 720;

  // Eye angle
  const eye = getGridParams({ angle: 'eye', lens: 50 }, W, H);
  assert.equal(eye.horizonY, 360);
  assert.equal(eye.isBirdsEye, false);
  assert.equal(eye.lineCount, 10);

  // Low angle
  const low = getGridParams({ angle: 'low', lens: 24 }, W, H);
  assert.equal(low.horizonY, 0.75 * 720);
  assert.equal(low.lineCount, 16); // wider lens = more lines

  // Birds-eye
  const birds = getGridParams({ angle: 'birds-eye', lens: 50 }, W, H);
  assert.equal(birds.isBirdsEye, true);
});

test('checkFramingConsistency flags mismatch between shot and crop', () => {
  const briefMismatch = {
    camera: { shot: 'wide' },
    layers: [
      { id: 'L1', type: 'subject', name: 'Explorer', crop: 'head' }
    ]
  };
  const warnings = checkFramingConsistency(briefMismatch);
  assert.equal(warnings.length, 1);
  assert.ok(warnings[0].text.includes('cropped to the head/chest'));

  const briefMatch = {
    camera: { shot: 'wide' },
    layers: [
      { id: 'L1', type: 'subject', name: 'Explorer', crop: 'full' }
    ]
  };
  assert.equal(checkFramingConsistency(briefMatch).length, 0);
});

test('applyPerspectiveLock scales layer down when moving deeper', () => {
  const layer = { x: 0.3, y: 0.3, w: 0.3, h: 0.4, depth: 20 };
  const camera = { lens: 35, horizon: 0.6 };

  // Moving from depth 20 (close) to depth 80 (far)
  const locked = applyPerspectiveLock(layer, 20, 80, camera);
  assert.ok(locked.w < layer.w, 'Layer should become smaller when moved farther');
  assert.ok(locked.h < layer.h, 'Layer should become smaller when moved farther');
  assert.equal(locked.depth, 80);
});

test('light gizmo position, hit-test and azimuth calculations', () => {
  const W = 1000;
  const H = 1000;

  // Azimuth 90 (right side)
  const pos90 = getSunGizmoPos(90, W, H, 20);
  assert.ok(pos90.x > 900, 'Sun should be on the right side');
  assert.ok(Math.abs(pos90.y - 500) < 5, 'Sun should be vertically centered');

  // Hit test
  assert.equal(hitTestLightGizmo(pos90.x, pos90.y, { azimuth: 90 }, W, H), true);
  assert.equal(hitTestLightGizmo(100, 100, { azimuth: 90 }, W, H), false);

  // Compute azimuth from pointer
  const azTop = computeAzimuthFromPointer(500, 50, W, H);
  assert.ok(Math.abs(azTop - 0) <= 2 || Math.abs(azTop - 360) <= 2, 'Top point should be ~0 deg');

  const azRight = computeAzimuthFromPointer(950, 500, W, H);
  assert.ok(Math.abs(azRight - 90) <= 2, 'Right point should be ~90 deg');
});
