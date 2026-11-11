// Variants from Claude (hub_thumb_variant), their notes, choosing, the final and deleting. RG_TEST
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

process.env.VIDEOHUB_NO_WINDOW = '1';
const { config } = await import('../config.js');
const store = await import('./store.js');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vh-variants-test-'));
const prev = { g: config().thumbstudio.globalDir, o: config().outputsDir };
config().thumbstudio.globalDir = path.join(tmp, 'thumbs');
config().outputsDir = path.join(tmp, 'outputs');
test.after(() => {
  config().thumbstudio.globalDir = prev.g; config().outputsDir = prev.o;
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { }
});

// a 2x2 PNG data URL, enough for layout.png and for a variant
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFklEQVR4nGP8z8DAwMDAxMDAwMDAAAAhJQIBpfGCbQAAAABJRU5ErkJggg==';
// a tiny JPEG (1x1)
const JPG = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==';
// an image file Claude made: the same picture with n extra bytes after it, so every file is a different image to the store
const image = (name, n) => { const f = path.join(tmp, name); fs.writeFileSync(f, Buffer.concat([Buffer.from(PNG.split(',')[1], 'base64'), Buffer.alloc(n, 1)])); return f; };

test('variants from Claude: rounds, notes, fixes, choose, final, delete', async () => {
  const { tid } = await store.createThumbnail({ title: 'Note', layers: [{ id: 'L1', type: 'subject', desc: 'explorer', x: 0.6, y: 0.1, w: 0.3, h: 0.8, depth: 10 }] });
  await store.exportThumbnail('_', tid, { layout: PNG, sketch: PNG, depth: PNG });

  // a file from Claude is copied into variants/ and opens round 1; the same image twice is refused
  const a = image('a.png', 0);
  const v1 = await store.addVariant('_', tid, { file: a, by: 'claude', prompt: 'an explorer' });
  assert.equal(v1.variant.id, 'v1_1');
  assert.ok(fs.existsSync(path.join(config().thumbstudio.globalDir, tid, 'variants', 'v1_1.png')));
  await assert.rejects(store.addVariant('_', tid, { file: a }), /already v1_1/);
  await assert.rejects(store.addVariant('_', tid, { file: path.join(tmp, 'missing.png') }), /not found/);

  // a note on the variant, and the marked copy the editor sends with "Send fixes to Claude"
  const n = store.addVariantNote('_', tid, 'v1_1', { x: 0.2, y: 0.1, text: 'make the face look more surprised' });
  assert.equal(n.note.where, 'top left');
  await store.saveMarked('_', tid, 'v1_1', PNG);
  assert.ok(store.editPrompt([{ x: 0.2, y: 0.1, text: 'make the face look more surprised' }], true).includes('at the top left: make the face look more surprised'));

  // Claude's fix: a new round, the parent is kept and the note it answers is marked fixed
  const v2 = await store.addVariant('_', tid, { file: image('b.png', 1), by: 'claude', parent: 'v1_1', fixes: [n.note.id] });
  assert.equal(v2.variant.id, 'v2_1'); assert.equal(v2.variant.parent, 'v1_1');
  let b = store.getThumbnail('_', tid);
  assert.equal(b.variants.find(v => v.id === 'v1_1').notes[0].status, 'fixed');

  // the editor's autosave must not wipe variants or the choice
  b = store.chooseVariant('_', tid, 'v2_1');
  assert.equal(b.status, 'chosen');
  store.saveFromEditor('_', tid, { title: 'New name', variants: [], chosen: null, status: 'draft' });
  b = store.getThumbnail('_', tid);
  assert.equal(b.title, 'New name'); assert.equal(b.variants.length, 2); assert.equal(b.chosen, 'v2_1');

  const f = await store.saveFinal('_', tid, { data: JPG });
  assert.equal(f.final.w, 1); assert.equal(store.getThumbnail('_', tid).status, 'final');
  assert.ok(f.final.copy && fs.existsSync(f.final.copy), 'copied to the outputs folder');
  await assert.rejects(store.saveFinal('_', tid, { data: 'data:image/jpeg;base64,' + Buffer.alloc(2.1 * 1024 * 1024).toString('base64') }), /2 MB/);
});
