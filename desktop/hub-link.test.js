// The desktop shell's logic, without Electron (npm test never downloads or starts Electron).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { dataDir, hubPort, hubOrigin, isHubUrl, externalUrl, findNode, hubLaunch, ping, restoreBounds, backgroundColor } from './hub-link.js';

const here = path.dirname(fileURLToPath(import.meta.url)), hub = path.resolve(here, '..');
const files = obj => f => { if (f in obj) return obj[f]; throw new Error('ENOENT'); };

test('the hub port is found like server/tools.js finds it', () => {
  const cfg = path.join(hub, 'data', 'config.json');
  assert.equal(hubPort({ hubDir: hub, env: {}, readFile: files({}) }), 7788);
  assert.equal(hubPort({ hubDir: hub, env: {}, readFile: files({ [cfg]: '{"port":7900}' }) }), 7900);
  assert.equal(hubPort({ hubDir: hub, env: { VIDEOHUB_PORT: '7797' }, readFile: files({ [cfg]: '{"port":7900}' }) }), 7797);
  assert.equal(hubPort({ hubDir: hub, env: {}, readFile: files({ [cfg]: 'not json' }) }), 7788);
  const scratch = path.resolve('/scratch/data');
  assert.equal(dataDir(hub, { VIDEOHUB_DATA_DIR: scratch }), scratch);
  assert.equal(hubPort({ hubDir: hub, env: { VIDEOHUB_DATA_DIR: scratch }, readFile: files({ [path.join(scratch, 'config.json')]: '{"port":7901}' }) }), 7901);
  assert.throws(() => hubPort({ hubDir: hub, env: {}, readFile: files({ [cfg]: '{"port":70000}' }) }), /Invalid VideoHub port/);
  assert.equal(hubOrigin(7797), 'http://127.0.0.1:7797');
});

test('only the hub address stays inside the window; only web links go to the browser', () => {
  const o = 'http://127.0.0.1:7797';
  for (const u of [o + '/', o + '/#/now', o + '/live/abc/index.html?x=1', 'blob:' + o + '/1234']) assert.equal(isHubUrl(u, o), true, u);
  for (const u of ['http://127.0.0.1:7788/', 'http://localhost:7797/', 'https://127.0.0.1:7797/', 'http://127.0.0.1.evil.test:7797/', 'file:///C:/x', 'data:text/html,hi', 'javascript:alert(1)', 'not a url'])
    assert.equal(isHubUrl(u, o), false, u);
  assert.equal(externalUrl('https://example.com/a?b=1'), 'https://example.com/a?b=1');
  assert.equal(externalUrl('http://example.com'), 'http://example.com/');
  for (const u of ['file:///C:/Windows/system32/calc.exe', 'javascript:alert(1)', 'ms-settings:privacy', 'mailto:a@b.c', 'data:text/html,x', '//no-scheme', ''])
    assert.equal(externalUrl(u), null, u);
});

test('the installed Node is found on PATH (not Electron\'s own executable)', () => {
  const win = findNode({ platform: 'win32', env: { Path: 'C:\\a;"C:\\Program Files\\nodejs"' }, exists: f => f === 'C:\\Program Files\\nodejs\\node.exe' });
  assert.equal(win, 'C:\\Program Files\\nodejs\\node.exe');
  assert.equal(findNode({ platform: 'win32', env: { PATH: '' }, exists: () => false }), null);
  assert.equal(findNode({ platform: 'darwin', env: { PATH: '/usr/bin:/bin' }, exists: f => f === '/opt/homebrew/bin/node' }), '/opt/homebrew/bin/node', 'Homebrew when PATH is short');
  assert.equal(findNode({ platform: 'linux', env: { PATH: '/home/u/.nvm/bin:/usr/bin' }, exists: f => f.startsWith('/home/u') }), '/home/u/.nvm/bin/node');
});

test('the hub is started detached and hidden, like open.cmd, without Electron variables', () => {
  const l = hubLaunch({ hubDir: hub, node: '/usr/bin/node', env: { PATH: '/usr/bin', VIDEOHUB_PORT: '7797', ELECTRON_RUN_AS_NODE: '1' } });
  assert.equal(l.file, '/usr/bin/node');
  assert.deepEqual(l.args, [path.join(hub, 'server', 'hub.js')]);
  assert.equal(l.options.cwd, hub);
  assert.equal(l.options.detached, true); assert.equal(l.options.stdio, 'ignore'); assert.equal(l.options.windowsHide, true);
  assert.deepEqual(l.options.env, { PATH: '/usr/bin', VIDEOHUB_PORT: '7797' });
});

test('ping tells VideoHub, another program and nothing apart', async () => {
  const reply = (ok, body) => async () => ({ ok, json: async () => body });
  assert.deepEqual(await ping('http://127.0.0.1:1', reply(true, { ok: true, app: 'videohub', pid: 5 })), { ok: true, app: 'videohub', pid: 5 });
  assert.deepEqual(await ping('http://127.0.0.1:1', reply(true, { hello: 1 })), { other: true });
  assert.deepEqual(await ping('http://127.0.0.1:1', reply(false, null)), { other: true });
  assert.equal(await ping('http://127.0.0.1:1', async () => { throw new Error('ECONNREFUSED'); }), null);
});

test('the window comes back where it was, unless that place is off every screen', () => {
  const screens = [{ x: 0, y: 0, width: 1920, height: 1040 }];
  assert.deepEqual(restoreBounds(null, screens), { width: 1440, height: 900, maximized: false });
  assert.deepEqual(restoreBounds({ x: 100, y: 50, width: 1200, height: 800, maximized: true }, screens), { x: 100, y: 50, width: 1200, height: 800, maximized: true });
  assert.deepEqual(restoreBounds({ x: 3000, y: 50, width: 1200, height: 800 }, screens), { width: 1200, height: 800, maximized: false }, 'monitor unplugged');
  assert.deepEqual(restoreBounds({ x: 10, y: 10, width: 20, height: 'x' }, screens), { x: 10, y: 10, width: 800, height: 900, maximized: false });
});

test('the window background is the design token --bg', () => {
  const css = fs.readFileSync(path.join(hub, 'ui', 'style.css'), 'utf8');
  assert.match(backgroundColor(css), /^#[0-9a-f]{6}$/i);
  assert.equal(backgroundColor(css), /--bg:\s*(#[0-9a-f]{6})/i.exec(css)[1]);
  assert.equal(backgroundColor(''), '#08090b');
});

test('the desktop shell stays optional and locked down', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(here, 'package.json'), 'utf8')), root = JSON.parse(fs.readFileSync(path.join(hub, 'package.json'), 'utf8'));
  assert.equal(pkg.private, true); assert.equal(pkg.main, 'main.js'); assert.ok(pkg.scripts.start);
  assert.match(pkg.devDependencies.electron, /^\d+\.\d+\.\d+$/, 'Electron is pinned to an exact version');
  assert.equal(JSON.stringify(root).includes('electron'), false, 'the main install never downloads Electron');
  assert.equal(Object.keys(pkg.scripts).some(k => /install/.test(k)), false, 'nothing runs at install');
  const main = fs.readFileSync(path.join(here, 'main.js'), 'utf8');
  assert.match(main, /contextIsolation: true, nodeIntegration: false, sandbox: true/);
  assert.doesNotMatch(main, /preload|nodeIntegration: true|contextIsolation: false|sandbox: false|webSecurity: false/);
  assert.match(main, /requestSingleInstanceLock/);
  assert.match(main, /setWindowOpenHandler/);
  assert.match(main, /will-navigate/);
  assert.doesNotMatch(main, /\.kill\(|killTree|\/api\/stop/, 'closing the window never stops the hub');
});
