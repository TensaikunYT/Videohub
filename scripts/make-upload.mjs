// Builds the folder to drag into GitHub's "Add files via upload" page, from the last commit (git archive: the
// right line endings, nothing local such as data\ or node_modules\).
//   node scripts/make-upload.mjs [target folder]      default: VideoHub-upload next to this repo
// The browser upload takes at most 100 files at a time and drops names that start with a dot, so the target gets
// part-1, part-2 … (each under 100 files, same sub-folders): open a part, select everything inside, drag it in,
// commit, then the next part. It stops if a tracked file would be dropped by the browser.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { droppedByBrowser } from './upload-rules.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.resolve(process.argv[2] || path.join(root, '..', 'VideoHub-upload'));
const PER_PART = 90;

if (path.relative(root, out) === '' || !path.relative(root, out).startsWith('..')) { console.error('Pick a folder outside the repo.'); process.exit(1); }
if (execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).trim()) console.warn('Note: uncommitted changes are NOT in the upload (it is built from the last commit).');

const stage = out + '.tmp';
fs.rmSync(stage, { recursive: true, force: true });
fs.mkdirSync(stage, { recursive: true });
const tar = path.join(stage, 'a.tar');
execFileSync('git', ['archive', '--format=tar', '-o', tar, 'HEAD'], { cwd: root });
execFileSync('tar', ['-xf', 'a.tar'], { cwd: stage });
fs.rmSync(tar);

const files = [];
(function walk(d, rel) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const r = rel ? rel + '/' + e.name : e.name;
    if (e.isDirectory()) walk(path.join(d, e.name), r); else files.push(r);
  }
})(stage, '');
const bad = files.filter(droppedByBrowser);
if (bad.length) { fs.rmSync(stage, { recursive: true, force: true }); console.error('The browser upload would drop these (rename them):\n  ' + bad.join('\n  ')); process.exit(1); }
const big = files.filter(f => fs.statSync(path.join(stage, f)).size > 25 * 1024 * 1024);
if (big.length) { fs.rmSync(stage, { recursive: true, force: true }); console.error('Over 25 MB, the browser upload refuses them:\n  ' + big.join('\n  ')); process.exit(1); }

// parts: whole top-level entries first (a folder over the limit is split by its own sub-entries)
const groups = new Map();
for (const f of files.sort()) {
  const segs = f.split('/');
  let key = segs[0];
  if (files.filter(x => x === key || x.startsWith(key + '/')).length > PER_PART) key = segs.slice(0, 2).join('/');
  if (!groups.has(key)) groups.set(key, []);
  groups.get(key).push(f);
}
const parts = [];
for (const g of [...groups.values()].sort((a, b) => b.length - a.length)) {   // biggest first, into the first part it fits
  const fit = parts.find(p => p.length + g.length <= PER_PART);
  if (fit) fit.push(...g); else parts.push([...g]);
}

fs.rmSync(out, { recursive: true, force: true });
parts.forEach((list, i) => {
  for (const f of list) {
    const to = path.join(out, `part-${i + 1}`, f);
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.renameSync(path.join(stage, f), to);
  }
});
fs.rmSync(stage, { recursive: true, force: true });
console.log(`${files.length} files in ${parts.length} part(s) → ${out}`);
parts.forEach((l, i) => console.log(`  part-${i + 1}: ${l.length} files`));
