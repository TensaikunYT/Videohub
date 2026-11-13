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

test('media opening plans preserve the absolute Unicode path without a command shell', () => {
  const p = openPlan(file);
  assert.equal(p.target, path.resolve(file));
  assert.equal(p.how, 'file');
  assert.ok(typeof p.command === 'string' && Array.isArray(p.args));
  assert.ok(!/^(?:cmd(?:\.exe)?|(?:\/bin\/)?sh|powershell(?:\.exe)?)$/i.test(p.command));
  assert.deepEqual(Object.keys(p).sort(), ['args', 'command', 'how', 'select', 'target']);
  assert.equal(p.select, false);
});
test('folder action preserves the exact file selection intent for the native file manager', () => {
  assert.equal(openPlan(file, 'folder').target, path.resolve(file));
  assert.equal(openPlan(file, 'folder').how, 'folder');
  assert.equal(openPlan(file, 'folder').select, true);
  assert.equal(openPlan(dir, 'folder').select, false);
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
test('test hubs validate paths without opening system applications', async () => {
  const previous = process.env.VIDEOHUB_NO_WINDOW;
  process.env.VIDEOHUB_NO_WINDOW = '1';
  try { assert.deepEqual(await openFile(file, 'folder'), { ok: true, path: path.resolve(file), how: 'folder', select: true }); }
  finally { if (previous === undefined) delete process.env.VIDEOHUB_NO_WINDOW; else process.env.VIDEOHUB_NO_WINDOW = previous; }
});
