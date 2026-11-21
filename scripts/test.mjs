// npm test: every node:test suite, with VideoHub's default folders pointed at .test-tmp (tests never create
// Documents\VideoHub on the machine running them).
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dirs = ['server', 'ui', 'ui/review', 'scripts', 'desktop'];
const files = dirs.flatMap(d => fs.readdirSync(path.join(root, d)).filter(f => f.endsWith('.test.js')).map(f => path.join(d, f)));
const base = path.join(root, '.test-tmp', 'base');
fs.mkdirSync(base, { recursive: true });
const fakeHome = path.join(root, '.test-tmp', 'home'), temp = path.join(root, '.test-tmp', 'temp');
for (const d of [fakeHome, temp]) fs.mkdirSync(d, { recursive: true });
const r = spawnSync(process.execPath, ['--test', ...files], { cwd: root, stdio: 'inherit', env: { ...process.env, HOME: fakeHome, USERPROFILE: fakeHome, APPDATA: path.join(fakeHome, 'AppData', 'Roaming'), LOCALAPPDATA: path.join(fakeHome, 'AppData', 'Local'), XDG_CONFIG_HOME: path.join(fakeHome, '.config'), XDG_DATA_HOME: path.join(fakeHome, '.local', 'share'), TMP: temp, TEMP: temp, TMPDIR: temp, VIDEOHUB_NO_WINDOW: '1', VIDEOHUB_BASE_DIR: base, VIDEOHUB_DATA_DIR: path.join(root, '.test-tmp', 'data') } });
// Some suites make directory links (junctions on Windows) in .test-tmp, several pointing back at this repo. Remove every
// link the run left there (only the link, never what it points at), so deleting .test-tmp later with a tool that follows
// links cannot reach the repo or anything outside.
console.log(`removed ${unlinkLinks(path.join(root, '.test-tmp'))} test link(s) from .test-tmp`);
process.exit(r.status ?? 1);

function unlinkLinks(dir) {
  let n = 0, es = [];
  try { es = fs.readdirSync(dir, { withFileTypes: true }); } catch { return 0; }
  for (const e of es) {
    const f = path.join(dir, e.name);
    let st; try { st = fs.lstatSync(f); } catch { continue; }
    if (st.isSymbolicLink()) { try { fs.unlinkSync(f); n++; } catch { try { fs.rmdirSync(f); n++; } catch { } } }   // a junction goes as a link, never walked
    else if (st.isDirectory()) n += unlinkLinks(f);
  }
  return n;
}
