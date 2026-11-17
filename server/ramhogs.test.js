import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('./ramhogs.js', import.meta.url), 'utf8')
  .replace(/^import .+;\r?$/gm, '').replace(/\bexport /g, '');
function harness(rows, OS = 'win32') {
  const ctx = { OS, processList: async () => rows };
  vm.createContext(ctx); vm.runInContext(source + '\nglobalThis.hogs = {ramHogsNow,ramNote};', ctx);
  return ctx.hogs;
}

test('RAM hogs group ordinary browser processes and omit render browser trees and system processes', async () => {
  const row = (pid, ppid, name, rssBytes = 2 ** 30, cmd = '') => ({ pid, ppid, name, rssBytes, cmd });
  const h = harness([row(1, 0, 'chrome.exe', 2 ** 30, '--headless'), row(2, 1, 'chrome.exe'),
    row(3, 0, 'chrome.exe'), row(4, 3, 'chrome.exe'), row(5, 0, 'svchost.exe'), row(6, 0, 'node.exe')]);
  const result = await h.ramHogsNow(); assert.equal(result.length, 1);
  assert.equal(result[0].name, 'Chrome (browser)'); assert.equal(result[0].bytes, 2 * 2 ** 30); assert.equal(result[0].procs, 2);
  assert.match(h.ramNote(result, 1024), /Chrome.*2\.0 GB/);
});

test('RAM hogs tolerate an unavailable process list', async () => {
  assert.equal((await harness(null).ramHogsNow()).length, 0);
});

test('Linux RAM hogs omit the desktop and services while preserving ordinary user programs', async () => {
  const rows = ['systemd', 'gnome-shell', 'kwin_wayland', 'pipewire', 'node', 'opencode', 'chromium', 'blender'].map((name, i) => ({ pid: i + 1, ppid: 0, name, rssBytes: 2 ** 30, cmd: '' }));
  rows.push({ pid: 20, ppid: 0, name: 'chromium', rssBytes: 2 ** 30, cmd: '--headless' });
  rows.push({ pid: 21, ppid: 20, name: 'chromium', rssBytes: 2 ** 30, cmd: '' });
  const result = await harness(rows, 'linux').ramHogsNow();
  assert.deepEqual(Array.from(result, r => r.name).sort(), ['Blender', 'Chromium (browser)']);
  assert.equal(result.find(r => r.name === 'Chromium (browser)').bytes, 2 ** 30);
});

test('Omarchy/Hyprland RAM hogs omit kernel threads, Wayland/portal daemons, and VideoHub app windows while grouping Brave and Helium', async () => {
  const MB = 1048576;
  const rows = [
    { pid: 2, ppid: 0, name: 'kthreadd', rssBytes: 0, cmd: '' },
    { pid: 45, ppid: 2, name: 'btrfs-transacti', rssBytes: 1200 * MB, cmd: '' },
    { pid: 500, ppid: 1, name: 'Hyprland', rssBytes: 1200 * MB, cmd: '' },
    { pid: 510, ppid: 500, name: 'waybar', rssBytes: 1100 * MB, cmd: '' },
    { pid: 520, ppid: 500, name: 'walker', rssBytes: 1100 * MB, cmd: '' },
    { pid: 525, ppid: 500, name: 'elephant', rssBytes: 1100 * MB, cmd: '' },
    { pid: 530, ppid: 1, name: 'xdg-desktop-por', rssBytes: 1100 * MB, cmd: '' },
    { pid: 540, ppid: 1, name: 'pipewire-pulse', rssBytes: 1100 * MB, cmd: '' },
    { pid: 600, ppid: 500, name: 'brave', rssBytes: 600 * MB, cmd: '/usr/bin/brave --ozone-platform-hint=auto --app=http://127.0.0.1:7788' },
    { pid: 601, ppid: 600, name: 'brave', rssBytes: 600 * MB, cmd: '/usr/lib/brave-browser/brave --type=renderer' },
    { pid: 700, ppid: 500, name: 'brave', rssBytes: 700 * MB, cmd: '/usr/bin/brave' },
    { pid: 701, ppid: 700, name: 'brave-browser', rssBytes: 500 * MB, cmd: '/usr/lib/brave-browser/brave --type=renderer' },
    { pid: 800, ppid: 500, name: 'helium-browser', rssBytes: 1050 * MB, cmd: '/usr/bin/helium-browser' },
    { pid: 900, ppid: 500, name: 'kdenlive', rssBytes: 1300 * MB, cmd: '/usr/bin/kdenlive' },
  ];
  const result = await harness(rows, 'linux').ramHogsNow();
  assert.deepEqual(Array.from(result, r => ({ name: r.name, bytes: r.bytes, procs: r.procs })), [
    { name: 'Kdenlive', bytes: 1300 * MB, procs: 1 },
    { name: 'Brave (browser)', bytes: 1200 * MB, procs: 2 },
    { name: 'Helium (browser)', bytes: 1050 * MB, procs: 1 },
  ]);
});

test('macOS RAM hogs group browser helpers with their app and omit helpers belonging to a headless render', async () => {
  const row = (pid, ppid, name, cmd = '') => ({ pid, ppid, name, cmd, rssBytes: 2 ** 30 });
  const rows = [row(1, 0, 'Google Chrome', '--headless'), row(2, 1, 'Google Chrome Helper (Renderer)'), row(3, 2, 'Google Chrome Helper (GPU)'),
    row(4, 0, 'Google Chrome'), row(5, 4, 'Google Chrome Helper (Renderer)'), row(6, 0, 'WindowServer'), row(7, 0, 'launchd')];
  const result = await harness(rows, 'darwin').ramHogsNow(); assert.equal(result.length, 1);
  assert.equal(result[0].name, 'Chrome (browser)'); assert.equal(result[0].procs, 2); assert.equal(result[0].bytes, 2 * 2 ** 30);
});
