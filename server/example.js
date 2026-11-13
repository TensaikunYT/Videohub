import { norm } from './util.js';
// The example film (examples/hello-film): a first-run helper copies it into the default films folder so a new user
// (and their Claude) can see the whole loop — live preview, notes, render — before writing a film of their own.
import fs from 'node:fs';
import path from 'node:path';
import { config, saveConfig, defaultFilmsDir } from './config.js';
import { HUB_DIR, isInside } from './util.js';

const SRC = path.join(HUB_DIR, 'examples', 'hello-film');
const SKIP = /^(node_modules|render|\.videohub|out|videohub-project\.json)$/i;

// where the copy goes: the first enabled container root, else the default films folder (added as a root)
function target() {
  const r = (config().roots || []).find(x => x.enabled !== false && x.type === 'container' && fs.existsSync(x.path));
  return r ? r.path : defaultFilmsDir();
}
export function info() {
  const dir = target(), installed = fs.existsSync(path.join(dir, 'hello-film', 'index.html'));
  return { available: fs.existsSync(path.join(SRC, 'index.html')), source: SRC, target: path.join(dir, 'hello-film'), installed };
}
function copyDir(a, b) {
  fs.mkdirSync(b, { recursive: true });
  for (const e of fs.readdirSync(a, { withFileTypes: true })) {
    if (SKIP.test(e.name)) continue;
    const s = path.join(a, e.name), d = path.join(b, e.name);
    if (e.isDirectory()) copyDir(s, d); else fs.copyFileSync(s, d, fs.constants.COPYFILE_EXCL);
  }
}
export function install() {
  if (!fs.existsSync(path.join(SRC, 'index.html'))) throw Object.assign(new Error('The example film is missing from this install (examples/hello-film).'), { code: 404 });
  const dir = target();
  let dest = path.join(dir, 'hello-film');
  for (let n = 2; fs.existsSync(dest); n++) dest = path.join(dir, `hello-film-${n}`);
  copyDir(SRC, dest);
  // its VideoHub settings (title, length) — never notes or versions someone left in the example folder. Kept in the repo
  // as videohub-project.json (no dot folder: GitHub's browser upload drops names that start with a dot)
  const pj = [path.join(SRC, 'videohub-project.json'), path.join(SRC, '.videohub', 'project.json')].find(f => fs.existsSync(f));
  if (pj) { fs.mkdirSync(path.join(dest, '.videohub'), { recursive: true }); fs.copyFileSync(pj, path.join(dest, '.videohub', 'project.json')); }
  // make sure the folder it went to is a root VideoHub scans
  const roots = config().roots || [];
  if (!roots.some(r => r.enabled !== false && isInside(dest, r.path))) saveConfig({ roots: [{ path: dir, type: 'container', enabled: true }, ...roots.filter(r => norm(r.path) !== norm(dir))] });
  return { ok: true, path: dest };
}
export function routes(route, readBody, rescan) {
  route('GET', '/api/example', () => info());
  route('POST', '/api/example/install', async () => { const r = install(); await rescan(); return r; });
}
