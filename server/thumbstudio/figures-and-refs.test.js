import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { POSES, EXPRESSIONS } from './schema.js';
import { FIGURE_POSES, CROP_CONFIG } from '../../ui/thumbstudio/figures.js';
import { saveReference, createThumbnail, getThumbnail, deleteThumbnail } from './store.js';
import { config } from '../config.js';

// Setup temp test directory for global thumbnails
const testTempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vh-thumb-f-test-'));
const prevGlobal = config().thumbstudio.globalDir;
config().thumbstudio.globalDir = testTempDir;

test.after(() => {
  config().thumbstudio.globalDir = prevGlobal;
  try { fs.rmSync(testTempDir, { recursive: true, force: true }); } catch { }
});

test('All catalog poses are defined in FIGURE_POSES with all required joints', () => {
  const requiredJoints = [
    'head', 'neck', 'shL', 'elL', 'wrL', 'shR', 'elR', 'wrR',
    'pelvis', 'hipL', 'knL', 'anL', 'hipR', 'knR', 'anR'
  ];

  for (const p of POSES) {
    const pose = FIGURE_POSES[p.id];
    assert.ok(pose, `Pose ${p.id} must exist in FIGURE_POSES`);
    for (const j of requiredJoints) {
      assert.ok(Array.isArray(pose[j]), `Joint ${j} in pose ${p.id} must be an array`);
      assert.equal(pose[j].length, 2, `Joint ${j} in pose ${p.id} must be [x, y]`);
      assert.ok(pose[j][0] >= -0.5 && pose[j][0] <= 1.5, `Joint x in range`);
      assert.ok(pose[j][1] >= -0.5 && pose[j][1] <= 1.5, `Joint y in range`);
    }
  }
});

test('Crop configurations are valid', () => {
  const crops = ['full', 'knee', 'waist', 'chest', 'head'];
  for (const c of crops) {
    const cfg = CROP_CONFIG[c];
    assert.ok(cfg, `Crop ${c} must exist`);
    assert.ok(cfg.scale >= 1.0, `Crop scale must be >= 1`);
    assert.ok(cfg.endY > cfg.startY, `Crop endY must be > startY`);
  }
});

test('Reference upload and role binding in store', async () => {
  const tid = '20261104-ref1';
  await createThumbnail({ tid, project: '_', title: 'Ref Test' });

  // Tiny 1x1 png base64
  const testPng = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

  const res = await saveReference('_', tid, {
    name: 'test_character.png',
    data: testPng,
    role: 'character',
    note: 'Main character reference'
  });

  assert.equal(res.ref.id, 'R1');
  assert.equal(res.ref.role, 'character');
  assert.equal(res.ref.note, 'Main character reference');
  assert.ok(res.ref.file.startsWith('refs/'));

  const brief = getThumbnail('_', tid);
  assert.equal(brief.refs.length, 1);
  assert.equal(brief.refs[0].id, 'R1');

  // Verify file written to disk
  const filePath = path.join(testTempDir, tid, brief.refs[0].file);
  assert.ok(fs.existsSync(filePath), 'Ref image file must exist on disk');

  await deleteThumbnail('_', tid);
});
