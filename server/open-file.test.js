import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openPlan, openFile } from './open-file.js';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'videohub-open-test-'));
const file = path.join(dir, 'İstanbul (son & %100).mp4');
fs.writeFileSync(file, 'test fixture');
test.after(() => { fs.unlinkSync(file); fs.rmdirSync(dir); });

test('filenames are passed to Explorer without a command shell', () => {
  const p = openPlan(file, 'file', 'win32');
  assert.equal(p.command, 'explorer.exe');
  assert.deepEqual(p.args, ['"' + path.resolve(file) + '"']);
  assert.equal(p.select, false);
});
test('folder action selects the exact video, not just its parent', () => {
  assert.deepEqual(openPlan(file, 'folder', 'win32').args, ['/select,"' + path.resolve(file) + '"']);
  assert.equal(openPlan(file, 'folder').select, true);
  assert.equal(openPlan(dir, 'folder').select, false);
});
test('a Mac: `open` opens the file in its app, `open -R` shows it selected in Finder; no shell, no quoting', () => {
  const p = openPlan(file, 'file', 'darwin');
  assert.equal(p.command, 'open'); assert.deepEqual(p.args, [path.resolve(file)]);
  const f = openPlan(file, 'folder', 'darwin'); assert.deepEqual(f.args, ['-R', path.resolve(file)]); assert.equal(f.select, true);
  assert.deepEqual(openPlan(dir, 'folder', 'darwin').args, [path.resolve(dir)]);
});
test('missing files and invalid actions return useful errors', () => {
  assert.throws(() => openPlan(path.join(dir, 'missing.mp4')), e => e.code === 404);
  assert.throws(() => openPlan(file, 'execute'), e => e.code === 400);
  assert.throws(() => openPlan('bad"path.mp4'), e => e.code === 400);
});
test('"file" opens only media; programs and shortcuts can only be shown in their folder', () => {
  for (const name of ['run.bat', 'tool.exe', 'link.lnk', 'script.cmd', 'page.hta']) {
    const f = path.join(dir, name); fs.writeFileSync(f, 'x');
    try {
      assert.throws(() => openPlan(f), e => e.code === 400); assert.throws(() => openPlan(f, 'file'), e => e.code === 400);
      assert.equal(openPlan(f, 'folder').select, true);
    } finally { fs.unlinkSync(f); }
  }
  const pic = path.join(dir, 'Frame.JPG'); fs.writeFileSync(pic, 'x');
  try { assert.equal(openPlan(pic).how, 'file'); } finally { fs.unlinkSync(pic); }
});
test('test hubs validate paths without opening Windows applications', async () => {
  const previous = process.env.VIDEOHUB_NO_WINDOW;
  process.env.VIDEOHUB_NO_WINDOW = '1';
  try { assert.deepEqual(await openFile(file, 'folder'), { ok: true, path: path.resolve(file), how: 'folder', select: true }); }
  finally { if (previous === undefined) delete process.env.VIDEOHUB_NO_WINDOW; else process.env.VIDEOHUB_NO_WINDOW = previous; }
});
