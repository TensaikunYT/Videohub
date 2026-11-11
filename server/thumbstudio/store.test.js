import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  resolveThumbDir,
  createThumbnail,
  getThumbnail,
  saveThumbnail,
  duplicateThumbnail,
  deleteThumbnail,
  listThumbnails,
  serveThumbnailFile
} from './store.js';
import { config } from '../config.js';

// Setup temp test directory for global thumbnails
const testTempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vh-thumb-test-'));
const prevGlobal = config().thumbstudio.globalDir;
config().thumbstudio.globalDir = testTempDir;

test.after(() => {
  config().thumbstudio.globalDir = prevGlobal;
  try { fs.rmSync(testTempDir, { recursive: true, force: true }); } catch { }
});

test('resolveThumbDir rejects traversal and invalid ids', () => {
  assert.throws(() => resolveThumbDir('_', '../invalid'), /Invalid thumbnail ID/);
  assert.throws(() => resolveThumbDir('_', '20261104-../../../etc'), /Invalid thumbnail ID/);
  assert.throws(() => resolveThumbDir('invalid_pid', '20261104-k3f9'), /Invalid project ID/);

  const res = resolveThumbDir('_', '20261104-k3f9');
  assert.equal(res.tid, '20261104-k3f9');
  assert.equal(res.pid, '_');
  assert.ok(res.dir.includes('20261104-k3f9'));
});

test('create, get, save, duplicate and delete global thumbnail', async () => {
  const tid = '20261104-a1b2';
  
  // 1. Create
  const created = await createThumbnail({
    tid,
    project: '_',
    title: 'Test Thumbnail',
    format: '16:9',
    layers: [{ id: 'L1', type: 'object', name: 'Box', depth: 20 }]
  });
  assert.equal(created.tid, tid);
  assert.equal(created.brief.title, 'Test Thumbnail');
  assert.equal(created.brief.layers.length, 1);

  // Check directories created
  assert.ok(fs.existsSync(path.join(created.dir, 'refs')));
  assert.ok(fs.existsSync(path.join(created.dir, 'variants')));
  assert.ok(fs.existsSync(path.join(created.dir, 'notes')));

  // 2. Get
  const fetched = getThumbnail('_', tid);
  assert.equal(fetched.id, tid);
  assert.equal(fetched.title, 'Test Thumbnail');

  // 3. Save / Update
  const saved = saveThumbnail('_', tid, { title: 'Updated Thumbnail' });
  assert.equal(saved.title, 'Updated Thumbnail');
  const fetched2 = getThumbnail('_', tid);
  assert.equal(fetched2.title, 'Updated Thumbnail');

  // 4. List
  const list = listThumbnails('_');
  const found = list.find(t => t.id === tid);
  assert.ok(found, 'Should find thumbnail in list');
  assert.equal(found.title, 'Updated Thumbnail');

  // 5. Duplicate
  const dup = await duplicateThumbnail('_', tid);
  assert.notEqual(dup.tid, tid);
  assert.ok(dup.brief.title.includes('(copy)'));
  assert.equal(dup.brief.layers.length, 1);

  // 6. Delete (Recycle Bin)
  const delRes = await deleteThumbnail('_', tid);
  assert.equal(delRes.ok, true);
  assert.throws(() => getThumbnail('_', tid), /Thumbnail not found/);

  // Cleanup dup
  await deleteThumbnail('_', dup.tid);
});

test('serveThumbnailFile blocks path traversal and forbidden files', () => {
  const fakeRes = {
    code: 200,
    headers: {},
    ended: false,
    body: '',
    writeHead(code, headers) { this.code = code; this.headers = headers; },
    end(str) { this.ended = true; this.body = str; }
  };

  // Forbidden file
  serveThumbnailFile({}, fakeRes, '_', '20261104-k3f9', 'passwords.txt');
  assert.equal(fakeRes.code, 403);

  // Traversal attempt
  const fakeRes2 = { ...fakeRes };
  serveThumbnailFile({}, fakeRes2, '_', '20261104-k3f9', '../secret.png');
  assert.equal(fakeRes2.code, 403);
});

test('createThumbnail with template applies slots and camera properties', async () => {
  const tid = '20261104-t1p1';
  const created = await createThumbnail({
    tid,
    project: '_',
    title: 'Thumbnail from Template',
    template: 'reaction-face-title',
    slots: {
      TITLE: 'INCREDIBLE MOMENTS',
      SUBJECT: 'flying saucer',
    },
  });

  assert.equal(created.tid, tid);
  assert.equal(created.brief.camera.shot, 'close');
  assert.equal(created.brief.camera.lens, 50);
  assert.ok(created.brief.layers.length >= 3);

  const textLayer = created.brief.layers.find(l => l.type === 'text');
  assert.ok(textLayer);
  assert.equal(textLayer.content, 'INCREDIBLE MOMENTS');

  const bgLayer = created.brief.layers.find(l => l.type === 'background');
  assert.ok(bgLayer);
  assert.ok(bgLayer.desc.includes('flying saucer'));
});

test('janitor and scan ignore thumbnail folders', async () => {
  const { findCandidates } = await import('../janitor.js');
  const candidates = await findCandidates();
  for (const c of candidates) {
    assert.equal(c.path.includes('.videohub\\thumbnails'), false, 'Janitor must never offer .videohub/thumbnails');
    assert.equal(c.path.toLowerCase().includes(testTempDir.toLowerCase()), false, 'Janitor must never offer globalDir');
  }
});
