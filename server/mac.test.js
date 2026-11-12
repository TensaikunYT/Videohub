import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parsePs, procName, appName, treeOf, openArgs, notifyArgs, loginPlist, loginItemOn, setLoginItem, loginPlistPath, trashStream } from './mac.js';
import { isInside } from './util.js';

const MAC = process.platform === 'darwin';
const PS = `    1     0  25280 15:18:50   6:11.97 Ss   /sbin/launchd
  500     1  51200    01:10   0:42.10 S    /opt/homebrew/bin/node render.js 2
  501   500 307200    01:08   1:05.33 R    /Applications/Google Chrome.app/Contents/MacOS/Google Chrome --headless=new --user-data-dir=/var/folders/x/T/puppeteer_dev_chrome_profile-1
  502   501 102400    01:07   0:30.00 T    /Applications/Google Chrome.app/Contents/Frameworks/Google Chrome Framework.framework/Versions/142/Helpers/Google Chrome Helper (Renderer).app/Contents/MacOS/Google Chrome Helper (Renderer) --type=renderer
  503   500  20480    00:05   0:01.00 S    /opt/homebrew/bin/ffmpeg -y -f rawvideo -i - c_000.mp4
  900     1  40960 1-02:03:04   0:00.50 S    /Users/x/My Tools/thing --flag`;

test('the process table: pid, parent, MB, start, CPU seconds, stopped, name and app (paths with spaces)', () => {
  const now = Date.parse('2026-11-13T12:00:00Z'), rows = parsePs(PS, now), by = Object.fromEntries(rows.map(r => [r.pid, r]));
  assert.equal(rows.length, 6);
  assert.equal(by[500].name, 'node'); assert.equal(by[500].ppid, 1); assert.equal(by[500].ramMB, 50); assert.equal(by[500].cpuSec, 42.1); assert.equal(by[500].start, now - 70e3);
  assert.equal(by[501].name, 'Google Chrome'); assert.equal(by[501].app, 'Google Chrome'); assert.ok(by[501].cmd.includes('--headless'));
  assert.equal(by[502].name, 'Google Chrome Helper (Renderer)'); assert.equal(by[502].app, 'Google Chrome'); assert.equal(by[502].stopped, true); assert.equal(by[501].stopped, false);
  assert.equal(by[1].cpuSec, 6 * 60 + 11.97); assert.equal(by[900].start, now - (86400 + 2 * 3600 + 3 * 60 + 4) * 1000);
  assert.equal(procName('ffmpeg -i a.mp4'), 'ffmpeg'); assert.equal(appName('/usr/bin/python3 render.py'), 'python3');
  assert.deepEqual(treeOf(rows, 500).sort(), [500, 501, 502, 503]); assert.deepEqual(treeOf(rows, 777), []);
});

test('Finder and notifications: arguments only, never a shell or a script built from text', () => {
  assert.deepEqual(openArgs('/a b/c.mp4'), ['/a b/c.mp4']); assert.deepEqual(openArgs('/a b/c.mp4', true), ['-R', '/a b/c.mp4']);
  const n = notifyArgs('Render finished: "x" & y', 'it\'s done');
  assert.equal(n.at(-2), 'Render finished: "x" & y'); assert.equal(n.at(-1), 'it\'s done');
  assert.ok(n.filter((x, i) => n[i - 1] === '-e').every(l => !l.includes('Render finished')));   // the text is an argument, not script
});

test('the login item: a LaunchAgent that runs this install\'s hub; only this install\'s entry is removed', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'vh-login-')), hub = '/Apps/Video Hub & Co';
  try {
    const xml = loginPlist(hub, '/opt/homebrew/bin/node', home);
    assert.match(xml, /<string>\/Apps\/Video Hub &amp; Co\/server\/hub\.js<\/string>/); assert.match(xml, /<key>RunAtLoad<\/key><true\/>/); assert.match(xml, /Interactive/);
    assert.equal(loginItemOn(hub, home), false);
    assert.equal(setLoginItem(true, hub, home), true); assert.ok(fs.existsSync(loginPlistPath(home)));
    assert.equal(setLoginItem(false, '/Another/VideoHub', home), false); assert.ok(fs.existsSync(loginPlistPath(home)), 'another install leaves it alone');
    assert.equal(setLoginItem(false, hub, home), false); assert.equal(fs.existsSync(loginPlistPath(home)), false);
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
});

test('inside a folder behind a symlink, even for a path that does not exist yet (/var → /private/var on a Mac)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vh-inside-')), link = dir + '-link';
  try {
    fs.symlinkSync(dir, link);
    assert.equal(isInside(path.join(link, 'not', 'yet', 'there.json'), dir), true);
    assert.equal(isInside(path.join(dir, 'new.json'), link), true);
    assert.equal(isInside(path.join(dir + 'x', 'a'), dir), false);
  } finally { fs.rmSync(link, { force: true }); fs.rmSync(dir, { recursive: true, force: true }); }
});

// it really uses your Trash, so it runs only when asked: VIDEOHUB_TEST_TRASH=1 npm test
test('the Trash: files and folders go there (never deleted), each item reports how it went', { skip: !MAC || !process.env.VIDEOHUB_TEST_TRASH }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vh-trash-')), f = path.join(dir, 'a file.txt'), sub = path.join(dir, 'sub dir');
  fs.writeFileSync(f, 'x'); fs.mkdirSync(sub); fs.writeFileSync(path.join(sub, 'b'), 'y');
  try {
    const got = [];
    await trashStream([{ path: f }, { path: sub }, { path: path.join(dir, 'missing') }], (it, code, err) => got.push([path.basename(it.path), code, err || null]), { dataDir: dir });
    assert.deepEqual(got, [['a file.txt', 0, null], ['sub dir', 0, null], ['missing', 1, 'Not found.']]);
    assert.equal(fs.existsSync(f), false); assert.equal(fs.existsSync(sub), false);
    assert.deepEqual(fs.readdirSync(dir), []);   // its list file is gone too
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
