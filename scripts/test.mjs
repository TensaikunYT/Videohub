// npm test: every node:test suite, with VideoHub's default folders pointed at .test-tmp (tests never create
// Documents\VideoHub on the machine running them).
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dirs = ['server', 'server/thumbstudio', 'ui', 'ui/review', 'scripts', 'guard'];
const files = dirs.flatMap(d => fs.readdirSync(path.join(root, d)).filter(f => f.endsWith('.test.js')).map(f => path.join(d, f)));
const base = path.join(root, '.test-tmp', 'base');
fs.mkdirSync(base, { recursive: true });
const r = spawnSync(process.execPath, ['--test', ...files], { cwd: root, stdio: 'inherit', env: { ...process.env, VIDEOHUB_BASE_DIR: base, VIDEOHUB_DATA_DIR: path.join(root, '.test-tmp', 'data') } });
process.exit(r.status ?? 1);
