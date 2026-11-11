import test from 'node:test';
import assert from 'node:assert/strict';
import { History } from '../../ui/thumbstudio/history.js';
import {
  createObjectLayer,
  createZoneLayer,
  createBackgroundLayer,
  getLayerBox,
  pointInLayer,
  toLayerLocal,
  snapLayerBounds,
  hitTestHandle
} from '../../ui/thumbstudio/layers.js';

test('History supports 25+ steps of undo and redo', () => {
  const history = new History(150);
  let state = 0;

  for (let i = 1; i <= 25; i++) {
    const prev = state;
    const next = i;
    state = next;
    history.push({
      undo: () => { state = prev; },
      redo: () => { state = next; }
    });
  }

  assert.equal(state, 25);
  assert.equal(history.canUndo(), true);

  // Undo 25 steps
  for (let i = 25; i >= 1; i--) {
    history.undo();
  }
  assert.equal(state, 0);
  assert.equal(history.canUndo(), false);
  assert.equal(history.canRedo(), true);

  // Redo 25 steps
  for (let i = 1; i <= 25; i++) {
    history.redo();
  }
  assert.equal(state, 25);
  assert.equal(history.canUndo(), true);
  assert.equal(history.canRedo(), false);
});

test('Layer creation factories produce valid layers', () => {
  const bg = createBackgroundLayer();
  assert.equal(bg.type, 'background');
  assert.equal(bg.depth, 100);
  assert.equal(bg.locked, true);

  const obj = createObjectLayer([bg]);
  assert.equal(obj.type, 'object');
  assert.equal(obj.locked, false);
  assert.ok(obj.id !== bg.id);

  const zone = createZoneLayer([bg, obj]);
  assert.equal(zone.type, 'zone');
  assert.equal(zone.purpose, 'title');
});

test('Point in layer with and without rotation', () => {
  const W = 1000;
  const H = 1000;
  const layer = { x: 0.2, y: 0.2, w: 0.2, h: 0.2, rot: 0 }; // Box from 200..400 x 200..400

  assert.equal(pointInLayer(300, 300, layer, W, H), true);
  assert.equal(pointInLayer(150, 150, layer, W, H), false);

  // Rotated 45 degrees around center (300, 300)
  layer.rot = 45;
  // Center is still inside
  assert.equal(pointInLayer(300, 300, layer, W, H), true);
  // Old corner (200, 200) is now outside because diamond shape rotated
  assert.equal(pointInLayer(205, 205, layer, W, H), false);
});

test('Snapping to thirds and center', () => {
  const W = 1280;
  const H = 720;
  // Close to vertical third 1/3 (~0.333)
  const snap1 = snapLayerBounds(0.330, 0.1, 0.2, 0.2, [], W, H, 10);
  assert.equal(snap1.snappedX, 1 / 3);
  assert.equal(snap1.guides.some(g => g.type === 'v' && Math.abs(g.pos - 1/3) < 0.001), true);

  // Close to center (0.5)
  const snap2 = snapLayerBounds(0.402, 0.1, 0.2, 0.2, [], W, H, 10); // Center is 0.402 + 0.1 = 0.502
  assert.equal(snap2.snappedX, 0.4); // Centered at 0.5 means left edge is 0.4
});
