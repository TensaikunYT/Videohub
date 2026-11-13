import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LOCAL = new Set(['.git', '.test-tmp', 'node_modules', 'data']);
const EXECUTABLE = /\.(exe|dll|com|scr|msi|msp|ocx|sys|cpl|node)$/i;

test('the source distribution contains no compiled executable helpers or application bundles', () => {
  const bad = [];
  function walk(dir, relative = '') {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const name = relative ? relative + '/' + entry.name : entry.name;
      if ((!relative && LOCAL.has(entry.name)) || entry.isDirectory() && /^examples\/[^/]+\/(?:node_modules|render)$/.test(name)) continue;
      if (entry.isSymbolicLink() || entry.isDirectory() && /\.app$/i.test(entry.name) || entry.isFile() && EXECUTABLE.test(entry.name)) bad.push(name);
      else if (entry.isDirectory()) walk(path.join(dir, entry.name), name);
    }
  }
  walk(root);
  assert.deepEqual(bad, [], 'VideoHub ships source and uses installed Node/browser/ffmpeg executables; do not ship compiled helpers');
});
