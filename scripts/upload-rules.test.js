// The repo is published by dragging files into GitHub's browser upload, which drops every name that starts with a dot.
// Nothing VideoHub needs may have such a name, or it goes missing on GitHub without any error.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { droppedByBrowser, ALLOWED_DOT_FILES, excludedFromUpload, missingFromUpload, readmeImages, REQUIRED_IN_UPLOAD } from './upload-rules.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LOCAL = new Set(['.git', '.github', '.test-tmp', 'node_modules', 'data']);   // .github is optional CI; browser uploads must add it separately.

test('the browser-upload rule', () => {
  assert.equal(droppedByBrowser('examples/hello-film/.videohub/project.json'), true);
  assert.equal(droppedByBrowser('.gitignore'), true);
  assert.equal(droppedByBrowser('examples/hello-film/videohub-project.json'), false);
});

test('no file VideoHub needs starts with a dot (GitHub\'s browser upload would drop it)', () => {
  const bad = [];
  (function walk(d, rel) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const r = rel ? rel + '/' + e.name : e.name;
      if (!rel && (LOCAL.has(e.name) || ALLOWED_DOT_FILES.has(e.name))) continue;
      if (e.isDirectory() && (e.name === 'node_modules' || e.name === 'render')) continue;
      if (droppedByBrowser(r)) { bad.push(r); continue; }
      if (e.isDirectory()) walk(path.join(d, e.name), r);
    }
  })(root, '');
  assert.deepEqual(bad, []);
});

test('the example film keeps its settings in a visible file', () => {
  const pj = JSON.parse(fs.readFileSync(path.join(root, 'examples', 'hello-film', 'videohub-project.json'), 'utf8'));
  assert.equal(pj.render.env.DUR, '10');
});

test('uploads leave out installed packages, data, scratch folders and .git', () => {
  for (const f of ['desktop/node_modules/electron/dist/electron.exe', 'node_modules/zod/index.js', 'data/config.json', '.test-tmp/home/x', '.git/studio-checkpoints/phase4/a.patch', 'examples/hello-film/render/chunk_000.mp4', 'docs/screenshots/films.tmp.png'])
    assert.equal(excludedFromUpload(f), true, f);
  for (const f of ['desktop/main.js', 'desktop/package-lock.json', 'docs/screenshots/films.png', 'server/hub.js', 'examples/hello-film/render.js'])
    assert.equal(excludedFromUpload(f), false, f);
  // a copy downloaded from a browser-uploaded repository has no dot files (GitHub's upload page drops them)
  const ignore = path.join(root, '.gitignore');
  if (fs.existsSync(ignore)) assert.match(fs.readFileSync(ignore, 'utf8'), /^node_modules\/$/m, 'desktop/node_modules is ignored by git');
});

test('an upload needs the desktop shell sources, the docs and README\'s screenshots', () => {
  const readme = fs.readFileSync(path.join(root, 'README.md'), 'utf8');
  const shots = readmeImages(readme);
  assert.ok(shots.length >= 7, 'README shows the screenshots');
  assert.deepEqual(missingFromUpload([...REQUIRED_IN_UPLOAD, ...shots], readme), []);
  assert.deepEqual(missingFromUpload(REQUIRED_IN_UPLOAD.filter(f => f !== 'desktop/main.js'), ''), ['desktop/main.js']);
  for (const f of [...REQUIRED_IN_UPLOAD, ...shots]) assert.ok(fs.existsSync(path.join(root, f)), f + ' exists');
  const onDisk = fs.readdirSync(path.join(root, 'docs', 'screenshots')).filter(f => f.endsWith('.png') && !f.endsWith('.tmp.png')).map(f => 'docs/screenshots/' + f);
  assert.deepEqual(onDisk.filter(f => !shots.includes(f)), [], 'no screenshot is left unused');
});
