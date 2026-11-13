import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { createPlatform } from './platform.js';

// Every command and file is fake: these Linux contracts also run on Windows.
function harness({ tools = [], files: initial = {}, proc = null, run: answer, env = {}, uid = 1000, sync = () => '', onDelay } = {}) {
  const files = new Map(Object.entries(initial)), calls = [], spawned = [], priorities = [], signals = [], delays = [], renames = [];
  const error = code => Object.assign(new Error(code), { code });
  for (const f of ['/home/me', '/home/me/films', '/tmp', '/opt/videohub']) if (!files.has(f)) files.set(f, { dir: true, dev: 1 });
  for (const tool of tools) if (!files.has('/usr/bin/' + tool)) files.set('/usr/bin/' + tool, { text: 'native tool', dev: 1 });
  const meta = f => { if (!files.has(f)) throw error('ENOENT'); const m = files.get(f); return typeof m === 'string' ? { text: m } : m; };
  const stat = f => { const m = meta(f); return { dev: m.dev ?? 1, uid: m.uid ?? 1000, mode: m.mode ?? (m.dir ? 0o40700 : 0o100600), size: m.text?.length || 0, isDirectory: () => !!m.dir, isFile: () => !m.dir, isSymbolicLink: () => !!m.link }; };
  const fs = { constants: { X_OK: 1 }, existsSync: f => files.has(f), statSync: stat, lstatSync: stat,
    accessSync: f => { meta(f); }, realpathSync: f => meta(f).link || f,
    readdirSync: f => { if (f === '/proc' && proc != null) return proc; throw error('ENOENT'); },
    readFileSync: f => meta(f).text || '',
    mkdirSync: f => { if (!files.has(f)) files.set(f, { dir: true, dev: f.startsWith('/media/') ? 2 : 1 }); },
    writeFileSync: (f, text, opts) => { if (opts?.flag === 'wx' && files.has(f)) throw error('EEXIST'); files.set(f, { text, dev: f.startsWith('/media/') ? 2 : 1 }); },
    unlinkSync: f => { if (!files.delete(f)) throw error('ENOENT'); },
    renameSync: (source, dest) => { const m = meta(source); files.delete(source); files.set(dest, m); renames.push([source, dest]); },
  };
  const platform = createPlatform({ osName: 'linux', home: '/home/me', temp: '/tmp', hubDir: '/opt/videohub', path: path.posix, env: { PATH: '/usr/bin', ...env }, fs,
    os: { cpus: () => Array(8), freemem: () => 4096, setPriority: (...args) => priorities.push(args) },
    run: async (file, args, opts) => { calls.push({ file, args, opts }); return answer ? answer(file, args, opts) : { code: 0, stdout: '', stderr: '' }; },
    runSync: (file, args, opts) => sync(file, args, opts), uid: () => uid,
    kill: (pid, signal) => signals.push([pid, signal]), delay: async ms => { delays.push(ms); if (onDelay) onDelay(files); },
    spawn: (file, args, opts) => { const child = new EventEmitter(); child.unref = () => {}; spawned.push({ file, args, opts }); queueMicrotask(() => child.emit('spawn')); return child; },
  });
  return { ...platform, files, calls, spawned, priorities, signals, delays, renames };
}
function procFiles(pid, ppid, name = 'node', cmd = 'node\0render.js\0', start = '12345') {
  const fields = ['S', String(ppid), ...Array(17).fill('0'), start, '0', '1'];
  return { [`/proc/${pid}/stat`]: `${pid} (${name}) ${fields.join(' ')}`, [`/proc/${pid}/status`]: 'Name:\tnode\nVmRSS:\t2048 kB\n', [`/proc/${pid}/cmdline`]: cmd };
}

test('Linux discovers XDG folders and native browser paths without Snap or Flatpak wrappers', () => {
  const h = harness({ tools: ['xdg-user-dir', 'chromium', 'google-chrome', 'ffmpeg'], env: { XDG_CONFIG_HOME: '/home/me/settings' },
    files: { '/usr/bin/google-chrome': { link: '/snap/chrome/current/chrome' }, '/snap/chrome/current/chrome': { text: '' } },
    sync: (_file, args) => args[0] === 'DESKTOP' ? '/home/me/Work desk\n' : '/home/me/Papers\n' });
  assert.equal(h.dirs.desktop, '/home/me/Work desk'); assert.equal(h.dirs.documents, '/home/me/Papers');
  assert.equal(h.dirs.config, '/home/me/settings/videohub'); assert.equal(h.dirs.guard, h.dirs.config);
  assert.equal(h.findBrowser().chrome, null); assert.equal(h.findBrowser().path, '/usr/bin/chromium');
  assert.equal(h.TOOLS.chrome, null); assert.equal(h.TOOLS.chromium, '/usr/bin/chromium');
  assert.equal(h.findTool('ffmpeg'), '/usr/bin/ffmpeg'); assert.equal(h.pathKey('/Films/A'), '/Films/A');
});

test('Linux RAM protection counts reclaimable cache through MemAvailable and falls back without proc', () => {
  const h = harness({ files: { '/proc/meminfo': 'MemTotal: 16000000 kB\nMemFree: 4 kB\nMemAvailable: 8000000 kB\nCached: 7000000 kB\n' } });
  assert.equal(h.availableMemory(), 8000000 * 1024);
  h.files.set('/proc/meminfo', 'MemAvailable: 0 kB\n'); assert.equal(h.availableMemory(), 0);
  h.files.delete('/proc/meminfo'); assert.equal(h.availableMemory(), 4096);
});

test('Linux proc parser reads private command fields, names with parentheses, RSS and start identity', async () => {
  const h = harness({ proc: ['100', '101', 'not-a-pid'], files: procFiles(100, 7, 'worker (one)', 'node\0render.js\0a b\0') });
  assert.deepEqual(await h.processList(), [{ pid: 100, ppid: 7, name: 'worker (one)', cmd: 'node render.js a b', rssBytes: 2048 * 1024, start: '12345' }]);
  assert.equal(h.calls.length, 0); // A process exiting mid-scan is ignored without spawning per process.
});

test('Linux falls back to aggregate ps tables with process identity when proc is unavailable', async () => {
  const h = harness({ run: (_file, args) => ({ code: 0, stdout: args.at(-1).includes('lstart') ? ' 100 7 2048 Fri Nov 13 10:20:30 2026 /usr/bin/node\n 101 100 100 Fri Nov 13 10:20:31 2026 chromium\n' : ' 100 node render.js "a b"\n 101 chromium --headless\n', stderr: '' }) });
  const rows = await h.processList(); assert.equal(rows.length, 2); assert.equal(rows[0].name, 'node');
  assert.equal(rows[0].cmd, 'node render.js "a b"'); assert.equal(rows[0].rssBytes, 2048 * 1024);
  assert.equal(rows[0].start, 'Fri Nov 13 10:20:30 2026');
  assert.deepEqual(h.calls.map(c => c.args), [['-ww', '-eo', 'pid=,ppid=,rss=,lstart=,comm='], ['-ww', '-eo', 'pid=,args=']]);
});

test('Linux explicit browser override validates native executables and rejects Snap, Flatpak and directories', () => {
  for (const [file, meta] of [['/snap/bin/chromium', 'native-looking'], ['/custom/flatpak-browser', 'exec flatpak run org.chromium.Chromium'], ['/custom/snap-browser', 'exec snap run chromium'], ['/custom/directory', { dir: true }]]) {
    const h = harness({ tools: ['chromium'], files: { [file]: meta }, env: { VIDEOHUB_BROWSER: file } });
    assert.equal(h.findBrowser().path, '/usr/bin/chromium', file);
  }
  const h = harness({ tools: ['chromium'], files: { '/custom/browser': 'native' }, env: { VIDEOHUB_BROWSER: '/custom/browser' } }); assert.equal(h.findBrowser().path, '/custom/browser');
});

test('Linux tree protection respects a sparse allowed CPU mask and restores its original mask', async () => {
  const h = harness({ tools: ['taskset'], proc: ['100', '101', '102'], files: { ...procFiles(100, 7), ...procFiles(101, 100), ...procFiles(102, 101) },
    run: (_file, args) => ({ code: 0, stdout: args[0] === '-p' ? "pid 100's current affinity mask: f0f\n" : '', stderr: '' }) });
  await h.setTreePriority(100, 'idle', 2);
  assert.deepEqual(h.priorities, [[100, 19], [101, 19], [102, 19]]);
  assert.deepEqual(h.calls.map(c => c.args), [['-p', '100'], ['-a', '-p', 'c00', '100'], ['-a', '-p', 'c00', '101'], ['-a', '-p', 'c00', '102']]);
  await h.setTreePriority(100, 'normal', null); assert.deepEqual(h.calls.at(-1).args, ['-a', '-p', 'f0f', '102']);
  assert.equal(h.capabilities().cpuAffinity, true);
  const noTool = harness({ proc: [] }); await noTool.setTreePriority(100, 'low', 1);
  assert.deepEqual(noTool.priorities, [[100, 10]]); assert.match(noTool.capabilities().cpuLimitReason, /taskset is missing/);
});

test('Linux affinity cache is discarded when the operating system reuses a render PID', async () => {
  let original = 'f0f';
  const h = harness({ tools: ['taskset'], proc: ['100'], files: procFiles(100, 7), run: (_file, args) => ({ code: 0, stdout: args[0] === '-p' ? `pid 100's current affinity mask: ${original}\n` : '', stderr: '' }) });
  await h.setTreePriority(100, 'idle', 1); assert.deepEqual(h.calls.at(-1).args, ['-a', '-p', '800', '100']);
  for (const [file, text] of Object.entries(procFiles(100, 7, 'node', 'node\0other.js\0', '99999'))) h.files.set(file, text);
  original = '3'; await h.setTreePriority(100, 'low', 1);
  assert.equal(h.calls.filter(c => c.args[0] === '-p').length, 2); assert.deepEqual(h.calls.at(-1).args, ['-a', '-p', '2', '100']);
});

test('Linux protection reports failed native affinity commands for retry while keeping niceness best effort', async () => {
  const query = harness({ tools: ['taskset'], proc: ['100'], files: procFiles(100, 7), run: () => ({ code: 1, stdout: '', stderr: 'temporary taskset query failure' }) });
  await assert.rejects(query.setTreePriority(100, 'low', 2), /temporary taskset query failure/); assert.deepEqual(query.priorities, [[100, 10]]);
  const update = harness({ tools: ['taskset'], proc: ['100'], files: procFiles(100, 7), run: (_file, args) => ({ code: args[0] === '-p' ? 0 : 1, stdout: 'pid 100 current affinity mask: ff', stderr: 'temporary affinity update failure' }) });
  await assert.rejects(update.setTreePriority(100, 'low', 2), /temporary affinity update failure/);
  const failedTree = harness({ run: () => ({ code: 1, stdout: '', stderr: 'ps failed' }) });
  await assert.rejects(failedTree.setTreePriority(100, 'low', 2), /render process tree/);
});

test('Linux stop sends TERM then KILL to the isolated group and its process tree', async () => {
  const h = harness({ proc: ['100', '101'], files: { ...procFiles(100, 7), ...procFiles(101, 100) } });
  await h.killTree(100); assert.deepEqual(h.delays, [3000]);
  assert.deepEqual(h.signals, [[-100, 'SIGTERM'], [101, 'SIGTERM'], [100, 'SIGTERM'], [-100, 'SIGKILL'], [101, 'SIGKILL'], [100, 'SIGKILL']]);
  const count = h.signals.length; for (const pid of [0, 1, -2, 1.5, 'wrong']) await h.killTree(pid); assert.equal(h.signals.length, count);
});

test('Linux delayed Stop never kills a replacement root or a group with no known survivors', async () => {
  const initial = { ...procFiles(100, 7), ...procFiles(101, 100) };
  const replaced = harness({ proc: ['100', '101'], files: initial, onDelay: files => { for (const [f, text] of Object.entries(procFiles(100, 7, 'other', 'other\0', '99999'))) files.set(f, text); } });
  await replaced.killTree(100); assert.deepEqual(replaced.signals.filter(([, sig]) => sig === 'SIGKILL'), [[101, 'SIGKILL']]);
  const ended = harness({ proc: ['100', '101'], files: initial, onDelay: files => { files.delete('/proc/100/stat'); files.delete('/proc/101/stat'); } });
  await ended.killTree(100); assert.equal(ended.signals.some(([, sig]) => sig === 'SIGKILL'), false);
  const orphan = harness({ proc: ['100', '101'], files: initial, onDelay: files => files.delete('/proc/100/stat') });
  await orphan.killTree(100); assert.deepEqual(orphan.signals.filter(([, sig]) => sig === 'SIGKILL'), [[-100, 'SIGKILL'], [101, 'SIGKILL']]);
});

test('Linux ps fallback also rejects a PID reused during the Stop grace period', async () => {
  let replaced = false;
  const h = harness({ onDelay: () => { replaced = true; }, run: (_file, args) => ({ code: 0, stdout: args.at(-1).includes('lstart') ? `100 7 2048 Fri Nov 13 10:20:${replaced ? '59' : '30'} 2026 node\n` : '100 node render.js\n', stderr: '' }) });
  await h.killTree(100); assert.equal(h.signals.some(([, signal]) => signal === 'SIGKILL'), false);
});

test('Linux file selection degrades to the parent folder and folder picker cancellation is harmless', async () => {
  const h = harness({ tools: ['gdbus', 'zenity'], run: (_file, args) => ({ code: 1, stdout: '', stderr: '' }) });
  await h.reveal('/home/me/films/a b.mp4', { select: true });
  assert.deepEqual(h.calls[0].args, ['call', '--session', '--dest', 'org.freedesktop.FileManager1', '--object-path', '/org/freedesktop/FileManager1', '--method', 'org.freedesktop.FileManager1.ShowItems', '["file:///home/me/films/a%20b.mp4"]', '']);
  assert.deepEqual(h.spawned[0].args, ['/home/me/films']); assert.equal(h.spawned[0].file, 'xdg-open');
  assert.equal(await h.pickFolder({ start: '/home/me/films', title: 'Pick a film' }), null);
  assert.deepEqual(h.calls.at(-1).args, ['--file-selection', '--directory', '--title=Pick a film', '--filename=/home/me/films/']);
  assert.deepEqual(await harness().pickFolder(), { unsupported: true });
  const kde = harness({ tools: ['kdialog'], run: () => ({ code: 0, stdout: '/home/me/films\n', stderr: '' }) });
  assert.equal(await kde.pickFolder({ title: 'Pick' }), '/home/me/films'); assert.deepEqual(kde.calls[0].args, ['--getexistingdirectory', '/home/me', '--title', 'Pick']);
  const spaces = harness({ tools: ['zenity'], run: () => ({ code: 0, stdout: '/home/me/films/Film \n', stderr: '' }) });
  assert.equal(await spaces.pickFolder(), '/home/me/films/Film ');
});

test('Linux df parser decodes mount names and reports bytes', async () => {
  const h = harness({ run: () => ({ code: 0, stdout: 'Filesystem 1024-blocks Used Available Capacity Mounted on\n/dev/root 10000 1000 9000 10% /\n/dev/sdb1 20000 5000 15000 25% /media/Film\\040disk\n', stderr: '' }) });
  assert.deepEqual(await h.volumes(), [{ mount: '/', freeBytes: 9000 * 1024, totalBytes: 10000 * 1024 }, { mount: '/media/Film disk', freeBytes: 15000 * 1024, totalBytes: 20000 * 1024 }]);
  assert.deepEqual(h.calls[0].args, ['-kP']);
});

test('Linux Trash fallback writes encoded restorable metadata and never overwrites a collision', async () => {
  const source = '/home/me/films/a #é.mp4', root = '/home/me/.local/share/Trash';
  const h = harness({ files: { [source]: { text: 'film' }, [root + '/files/a #é.mp4']: { text: 'older film' } } });
  assert.equal((await h.trash([source]))[0].ok, true);
  assert.deepEqual(h.renames, [[source, root + '/files/a #é.mp4.1']]);
  const info = h.files.get(root + '/info/a #é.mp4.1.trashinfo').text;
  assert.match(info, /^\[Trash Info\]\nPath=\/home\/me\/films\/a%20%23%C3%A9\.mp4\nDeletionDate=\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\n$/);
  assert.equal(h.files.get(root + '/files/a #é.mp4').text, 'older film');
});

test('Linux Trash prefers desktop tools and safely refuses an unsafe fallback directory', async () => {
  const source = '/home/me/films/a.mp4', native = harness({ tools: ['gio'], files: { [source]: 'film' } });
  assert.equal((await native.trash([source]))[0].ok, true); assert.deepEqual(native.calls[0].args, ['trash', '--', source]); assert.equal(native.renames.length, 0);
  const unsafe = harness({ files: { [source]: 'film', '/home/me/.local/share/Trash': { dir: true, link: '/other' } } });
  const [r] = await unsafe.trash([source]); assert.equal(r.ok, false); assert.match(r.error, /unsafe/); assert.equal(unsafe.files.has(source), true); assert.equal(unsafe.renames.length, 0);
  const writable = harness({ files: { [source]: 'film', '/home/me/.local/share/Trash': { dir: true, mode: 0o40777 } } });
  const [denied] = await writable.trash([source]); assert.equal(denied.ok, false); assert.match(denied.error, /unsafe/);
  assert.equal(writable.files.has(source), true); assert.equal(writable.renames.length, 0);
});

test('Linux external Trash uses its mount and refuses unknown ownership instead of deleting', async () => {
  const source = '/media/Film disk/film.mp4';
  const fixture = { [source]: { text: 'film', dev: 2 }, '/media/Film disk': { dir: true, dev: 2 } };
  const run = () => ({ code: 0, stdout: 'Filesystem 1024-blocks Used Available Capacity Mounted on\n/dev/sdb1 20000 5000 15000 25% /media/Film\\040disk\n', stderr: '' });
  const h = harness({ files: fixture, run }); assert.equal((await h.trash([source]))[0].ok, true);
  assert.deepEqual(h.renames, [[source, '/media/Film disk/.Trash-1000/files/film.mp4']]);
  assert.match(h.files.get('/media/Film disk/.Trash-1000/info/film.mp4.trashinfo').text, /\nPath=film\.mp4\n/);
  const refused = harness({ files: fixture, run, uid: null });
  assert.equal((await refused.trash([source]))[0].ok, false); assert.equal(refused.files.has(source), true); assert.equal(refused.renames.length, 0);
});

test('Linux launcher, shell and autostart entries keep arguments separate and identify their install', async () => {
  const h = harness({ tools: ['chromium'] });
  assert.deepEqual(h.shellCommand('node render.js "a b"'), { file: '/bin/sh', args: ['-c', 'node render.js "a b"'], opts: {} });
  assert.equal(h.renderSpawnOptions.detached, true);
  await h.openUrlWindow('http://127.0.0.1:7799'); assert.deepEqual(h.spawned[0].args, ['--app=http://127.0.0.1:7799']);
  await h.setAutostart(true); assert.equal(await h.getAutostart(), true);
  const entry = h.files.get('/home/me/.config/autostart/videohub.desktop').text;
  const node = '"' + process.execPath.replace(/[%]/g, '%%').replace(/[\\"$`]/g, '\\$&') + '"';
  assert.ok(entry.includes('Exec=' + node + ' "/opt/videohub/scripts/install.mjs" open --server\n')); assert.match(entry, /X-VideoHub-Install=\/opt\/videohub\n/);
});
