import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { snapshot, restore, list, lastForNote, status, MAX_SNAPSHOTS } from './rollback.js';

function project() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vh-rollback-'));
  fs.mkdirSync(path.join(root, 'assets'), { recursive: true });
  fs.mkdirSync(path.join(root, '.videohub'), { recursive: true });
  fs.writeFileSync(path.join(root, 'film.js'), 'const v = 1;\n');
  fs.writeFileSync(path.join(root, 'assets', 'a.txt'), 'asset-a');
  fs.writeFileSync(path.join(root, '.videohub', 'notes.json'), '[{"id":1,"text":"keep me"}]');
  return { root, p: { path: root } };
}

test('snapshot, then restore exactly, leaving notes alone and removing added files', () => {
  const { root, p } = project();
  try {
    const before = snapshot(p, { kind: 'before', noteIds: [7], prompt: 'make the sign bigger', runId: 'run-1' });
    assert.equal(before.fileCount, 2);
    assert.match(before.sha256, /^[0-9a-f]{64}$/);
    fs.writeFileSync(path.join(root, 'film.js'), 'const v = 2;\n');
    fs.writeFileSync(path.join(root, 'added-by-edit.js'), 'oops');
    fs.writeFileSync(path.join(root, '.videohub', 'notes.json'), '[{"id":7,"text":"new note"}]');
    const r = restore(p, before.id);
    assert.equal(r.ok, true);
    assert.equal(r.sha256, before.sha256);
    assert.equal(fs.readFileSync(path.join(root, 'film.js'), 'utf8'), 'const v = 1;\n');
    assert.equal(fs.existsSync(path.join(root, 'added-by-edit.js')), false);
    assert.equal(fs.readFileSync(path.join(root, '.videohub', 'notes.json'), 'utf8'), '[{"id":7,"text":"new note"}]');
    assert.equal(list(p).length, 1);
    assert.equal(lastForNote(p, 7).id, before.id);
    assert.equal(status(p, 7).available, true);
    assert.equal(status(p, 8).available, false);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('a tampered snapshot is refused instead of restoring broken bytes', () => {
  const { root, p } = project();
  try {
    const before = snapshot(p, { kind: 'before', noteIds: [1] });
    fs.writeFileSync(path.join(root, 'film.js'), 'changed\n');
    const snapFile = path.join(root, 'snapshots', before.id, 'files', 'film.js');
    fs.writeFileSync(snapFile, 'tampered\n');
    assert.throws(() => restore(p, before.id), /SHA mismatch|failed/i);
    assert.equal(fs.readFileSync(path.join(root, 'film.js'), 'utf8'), 'changed\n');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('rolling history keeps only the newest 20 snapshots', async () => {
  const { root, p } = project();
  try {
    const ids = [];
    for (let i = 0; i < MAX_SNAPSHOTS + 2; i++) {
      fs.writeFileSync(path.join(root, 'film.js'), `const v = ${i};
`);
      ids.push(snapshot(p, { kind: 'before', noteIds: [i + 1] }).id);
      await new Promise(r => setTimeout(r, 2));
    }
    const all = list(p);
    assert.equal(all.length, MAX_SNAPSHOTS);
    assert.equal(fs.existsSync(path.join(root, 'snapshots', ids[0])), false);
    assert.equal(fs.existsSync(path.join(root, 'snapshots', ids[1])), false);
    assert.equal(fs.existsSync(path.join(root, 'snapshots', ids[ids.length - 1])), true);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
