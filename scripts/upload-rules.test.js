// The repo is published by dragging files into GitHub's browser upload, which drops every name that starts with a dot.
// Nothing VideoHub needs may have such a name, or it goes missing on GitHub without any error.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { droppedByBrowser, ALLOWED_DOT_FILES } from './upload-rules.mjs';

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
