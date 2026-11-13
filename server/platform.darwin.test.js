import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { createPlatform } from './platform.js';

function harness({ files: initial = {}, env = {}, answer, sync, uid = 501, hubDir = '/opt/VideoHub', priorityError = false } = {}) {
  const files = new Map(Object.entries(initial)), calls = [], syncCalls = [], spawned = [], priorities = [], signals = [], delays = [];
  let time = 1000, loaded = false;
  for (const name of ['/Users/me', '/Users/me/Films']) files.set(name, { dir: true });
  const missing = () => Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
  const meta = f => { if (!files.has(f)) throw missing(); const m = files.get(f); return typeof m === 'string' ? { text: m } : m; };
  const fs = { constants: { X_OK: 1 }, existsSync: f => files.has(f), statSync: f => ({ size: meta(f).text?.length || 0, isDirectory: () => !!meta(f).dir, isFile: () => !meta(f).dir }), accessSync: f => { meta(f); }, realpathSync: f => meta(f).link || f,
    readFileSync: f => meta(f).text || '', mkdirSync: f => files.set(f, { dir: true }), writeFileSync: (f, text) => files.set(f, { text }),
    readdirSync: () => { throw new Error('macOS must not scan /proc'); } };
  const platform = createPlatform({ osName: 'darwin', env: { PATH: '', ...env }, home: '/Users/me', temp: '/tmp', hubDir, path: path.posix, fs, uid: () => uid, now: () => time,
    os: { cpus: () => Array(8), freemem: () => 1024, totalmem: () => 16 * 2 ** 30, setPriority: (...args) => { priorities.push(args); if (priorityError) throw new Error('EPERM'); } },
    run: async (file, args, opts) => {
      calls.push({ file, args, opts }); if (answer) return answer(file, args, opts);
      if (file === 'launchctl') {
        if (args[0] === 'print') return { code: loaded ? 0 : 113, stdout: '', stderr: '' };
        if (args[0] === 'bootstrap') loaded = true;
        if (args[0] === 'bootout') loaded = false;
      }
      if (file === 'osascript' && args[1].includes('tell application "Finder"')) files.delete(args.at(-1));
      return { code: 0, stdout: '', stderr: '' };
    },
    runSync: (file, args, opts) => { syncCalls.push({ file, args, opts }); return sync ? sync(file, args, opts) : ''; },
    kill: (pid, signal) => signals.push([pid, signal]), delay: async ms => delays.push(ms),
    spawn: (file, args, opts) => { const child = new EventEmitter(); child.unref = () => {}; spawned.push({ file, args, opts }); queueMicrotask(() => child.emit('spawn')); return child; },
  });
  return { ...platform, files, calls, syncCalls, spawned, priorities, signals, delays, setTime: value => { time = value; }, setLoaded: value => { loaded = value; } };
}

test('macOS folders and browser discovery use system and user Applications independently of XDG', async () => {
  const chrome = '/Users/me/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  const edge = '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge';
  const h = harness({ env: { XDG_CONFIG_HOME: '/ignored' }, files: { [chrome]: 'binary', [edge]: 'binary' } });
  assert.equal(h.dirs.desktop, '/Users/me/Desktop'); assert.equal(h.dirs.documents, '/Users/me/Documents');
  assert.equal(h.dirs.guard, '/Users/me/Library/Application Support/VideoHub'); assert.equal(h.syncCalls.length, 0);
  assert.equal(h.findBrowser().chrome, chrome); assert.equal(h.findBrowser().path, edge);
  assert.equal(h.capabilities().cpuAffinity, false); assert.equal(h.capabilities().fileManager, 'Finder'); assert.match(h.capabilities().cpuLimitReason, /macOS.*CPU-core/);
  assert.deepEqual(await h.gpuNames(), []);
});

test('macOS login services find Homebrew media tools with a minimal PATH', async () => {
  const h = harness({ env: { PATH: '/usr/bin:/bin' }, files: { '/opt/homebrew/bin/ffmpeg': 'binary', '/usr/local/bin/ffprobe': 'binary' } });
  assert.equal(h.findTool('ffmpeg'), '/opt/homebrew/bin/ffmpeg'); assert.equal(h.TOOLS.ffmpeg, '/opt/homebrew/bin/ffmpeg');
  assert.equal(h.TOOLS.ffprobe, '/usr/local/bin/ffprobe'); await h.setAutostart(true);
  const plist = h.files.get('/Users/me/Library/LaunchAgents/com.videohub.hub.plist').text;
  assert.match(plist, /<key>PATH<\/key><string>\/usr\/bin:\/bin:\/opt\/homebrew\/bin:\/usr\/local\/bin:/);
});

test('macOS opens app windows by bundle path and falls back to the default browser', async () => {
  const chrome = '/Users/me/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  const h = harness({ files: { [chrome]: 'binary' } }); await h.openUrlWindow('http://127.0.0.1:7799');
  assert.equal(h.spawned[0].file, 'open'); assert.deepEqual(h.spawned[0].args, ['-na', '/Users/me/Applications/Google Chrome.app', '--args', '--app=http://127.0.0.1:7799']);
  const fallback = harness(); await fallback.openUrlWindow('http://127.0.0.1:7799');
  assert.deepEqual(fallback.spawned[0].args, ['http://127.0.0.1:7799']);
  const override = harness({ env: { VIDEOHUB_BROWSER: '/custom/browser' }, files: { '/custom/browser': 'binary' } });
  await override.openUrlWindow('http://127.0.0.1:7799'); assert.equal(override.spawned[0].file, '/custom/browser');
});

test('macOS reveals files with open -R and opens media through the default app', async () => {
  const h = harness(), target = '/Users/me/Films/a "quote" & ü.mp4';
  await h.reveal(target, { select: true }); await h.openPath(target);
  assert.deepEqual(h.spawned.map(c => [c.file, c.args]), [['open', ['-R', target]], ['open', [target]]]);
  assert.deepEqual(h.fileOpenPlan(target), { command: 'open', args: [target] });
});

test('macOS Finder Trash passes unusual filenames as data and refuses failures without hard deletion', async () => {
  const target = '/Users/me/Films/a "quote" \\ ü; shell.mp4', h = harness({ files: { [target]: 'film' } });
  assert.equal((await h.trash([target]))[0].ok, true);
  assert.equal(h.calls[0].file, 'osascript'); assert.deepEqual(h.calls[0].args.slice(2), ['--', target]);
  assert.equal(h.calls[0].args[1].includes(target), false); assert.match(h.calls[0].args[1], /tell application "Finder" to delete/);
  const failed = harness({ files: { [target]: 'film' }, answer: () => ({ code: 1, stdout: '', stderr: 'Not authorized to send Apple events' }) });
  const [r] = await failed.trash([target]); assert.equal(r.ok, false); assert.match(r.error, /Automation permission/); assert.equal(failed.files.has(target), true);
  assert.equal((await h.trash(['/']))[0].ok, false); assert.equal((await h.trash(['/Users/me']))[0].ok, false);
});

test('macOS folder picker passes prompt as data, preserves spaces and maps cancel to null', async () => {
  const title = 'Choose "film" \\ folder', h = harness({ answer: () => ({ code: 0, stdout: '/Users/me/Films/My film/\n', stderr: '' }) });
  assert.equal(await h.pickFolder({ title, start: '/Users/me/Films' }), '/Users/me/Films/My film/');
  assert.deepEqual(h.calls[0].args.slice(2), ['--', title, '/Users/me/Films']);
  assert.equal(h.calls[0].args[1].includes(title), false);
  const canceled = harness({ answer: () => ({ code: 1, stdout: '', stderr: 'User canceled. (-128)' }) });
  assert.equal(await canceled.pickFolder(), null);
});

test('macOS notification errors are best effort and text never enters the AppleScript program', async () => {
  const h = harness({ answer: () => { throw new Error('unavailable'); } });
  assert.doesNotThrow(() => h.notify('VideoHub "title"', 'Film\\body')); await Promise.resolve();
  assert.deepEqual(h.calls[0].args.slice(2), ['--', 'VideoHub "title"', 'Film\\body']);
  const quiet = harness({ env: { VIDEOHUB_NO_WINDOW: '1' } }); quiet.notify('A', 'B'); await quiet.openPath('/Users/me/Films'); assert.equal(await quiet.pickFolder(), null);
  assert.equal(quiet.calls.length, 0); assert.equal(quiet.spawned.length, 0);
});

test('macOS process scan keeps app names with spaces and full argument strings', async () => {
  const h = harness({ answer: (_file, args) => ({ code: 0, stdout: args.at(-1).includes('lstart') ? ' 100 7 2048 Fri Nov 13 10:20:30 2026 /Applications/Google Chrome.app/Contents/MacOS/Google Chrome\n 101 100 300 Fri Nov 13 10:20:31 2026 /Applications/Google Chrome.app/Contents/Frameworks/Google Chrome Helper (Renderer)\n' : ' 100 /Applications/Google Chrome.app/Contents/MacOS/Google Chrome --headless --name="a b"\n 101 Google Chrome Helper (Renderer) --type=renderer\n', stderr: '' }) });
  const rows = await h.processList(); assert.equal(rows.length, 2); assert.equal(rows[0].name, 'Google Chrome'); assert.equal(rows[1].name, 'Google Chrome Helper (Renderer)');
  assert.equal(rows[0].rssBytes, 2048 * 1024); assert.equal(rows[0].start, 'Fri Nov 13 10:20:30 2026'); assert.match(rows[0].cmd, /--headless --name="a b"$/);
  assert.deepEqual(h.calls.map(c => c.args), [['-ww', '-axo', 'pid=,ppid=,rss=,lstart=,comm='], ['-ww', '-axo', 'pid=,args=']]);
});

test('macOS tree protection uses taskpolicy QoS and niceness without any CPU affinity command', async () => {
  const h = harness({ priorityError: true, answer: (file, args) => ({ code: 0, stdout: file === 'ps' ? args.at(-1).includes('lstart') ? '100 7 2048 Fri Nov 13 10:20:30 2026 node\n101 100 300 Fri Nov 13 10:20:31 2026 ffmpeg\n' : '100 node render.js\n101 ffmpeg -i x\n' : '', stderr: '' }) });
  await h.setTreePriority(100, 'idle', 1); await h.setTreePriority(100, 'normal', 8);
  assert.deepEqual(h.priorities, [[100, 19], [101, 19], [100, 0], [101, 0]]);
  assert.deepEqual(h.calls.filter(c => c.file === 'taskpolicy').map(c => c.args), [['-b', '-p', '100'], ['-b', '-p', '101'], ['-B', '-p', '100'], ['-B', '-p', '101']]);
  assert.equal(h.calls.some(c => c.file.includes('taskset')), false);
});

test('macOS available memory includes inactive and speculative pages and caches vm_stat for three seconds', () => {
  const h = harness({ sync: () => 'Mach Virtual Memory Statistics: (page size of 16384 bytes)\nPages free: 10.\nPages inactive: 20.\nPages speculative: 3.\nPages active: 10000.\n' });
  assert.equal(h.availableMemory(), 33 * 16384); assert.equal(h.availableMemory(), 33 * 16384); assert.equal(h.syncCalls.length, 1);
  h.setTime(3999); h.availableMemory(); assert.equal(h.syncCalls.length, 1);
  h.setTime(4000); h.availableMemory(); assert.equal(h.syncCalls.length, 2); assert.equal(h.syncCalls[0].file, 'vm_stat');
  assert.equal(harness({ sync: () => { throw new Error('missing'); } }).availableMemory(), 1024);
  assert.equal(harness({ sync: () => 'page size of 4096 bytes\nPages free: 0.\nPages inactive: 0.\nPages speculative: 0.\n' }).availableMemory(), 0);
});

test('macOS disk information shares df byte conversion and Stop handles the full process group', async () => {
  const h = harness({ answer: (file, args) => ({ code: 0, stdout: file === 'df' ? 'Filesystem 1024-blocks Used Available Capacity Mounted on\n/dev/disk1s1 10000 1000 9000 10% /Volumes/Film disk\n' : args.at(-1).includes('lstart') ? '100 7 2048 Fri Nov 13 10:20:30 2026 node\n101 100 300 Fri Nov 13 10:20:31 2026 ffmpeg\n' : '100 node render.js\n101 ffmpeg\n', stderr: '' }) });
  assert.deepEqual(await h.volumes(), [{ mount: '/Volumes/Film disk', freeBytes: 9000 * 1024, totalBytes: 10000 * 1024 }]);
  await h.killTree(100); assert.deepEqual(h.delays, [3000]); assert.deepEqual(h.signals, [[-100, 'SIGTERM'], [101, 'SIGTERM'], [100, 'SIGTERM'], [-100, 'SIGKILL'], [101, 'SIGKILL'], [100, 'SIGKILL']]);
});

test('macOS LaunchAgent autostart requires an owned plist and loaded service and disables by bootout plus Trash', async () => {
  const file = '/Users/me/Library/LaunchAgents/com.videohub.hub.plist', h = harness({ hubDir: '/opt/VideoHub & review' });
  assert.equal(await h.getAutostart(), false); await h.setAutostart(true);
  const plist = h.files.get(file).text; assert.match(plist, /<key>RunAtLoad<\/key><true\/>/); assert.match(plist, /<key>ProgramArguments<\/key><array>/);
  assert.match(plist, /<key>EnvironmentVariables<\/key><dict><key>PATH<\/key><string>\/opt\/homebrew\/bin:\/usr\/local\/bin:\/usr\/bin:/);
  assert.match(plist, /\/opt\/VideoHub &amp; review\/server\/hub.js/); assert.equal(await h.getAutostart(), true);
  assert.deepEqual(h.calls.find(c => c.args[0] === 'bootstrap').args, ['bootstrap', 'gui/501', file]);
  await h.setAutostart(true); assert.equal(h.calls.filter(c => c.args[0] === 'bootstrap').length, 1);
  await h.setAutostart(false); assert.deepEqual(h.calls.find(c => c.args[0] === 'bootout').args, ['bootout', 'gui/501', file]);
  assert.equal(h.files.has(file), false); assert.equal(await h.getAutostart(), false);
  const foreign = harness({ files: { [file]: 'another install' } }); foreign.setLoaded(true);
  assert.equal(await foreign.getAutostart(), false); await assert.rejects(foreign.setAutostart(true), /another install/); assert.equal(foreign.calls.length, 0);
  const notLoaded = harness({ files: { [file]: plist }, hubDir: '/opt/VideoHub & review' }); assert.equal(await notLoaded.getAutostart(), false);
});

test('macOS failed startup registration stays observable and missing login ownership is refused', async () => {
  const h = harness({ answer: () => ({ code: 113, stdout: '', stderr: 'No GUI session' }) });
  await assert.rejects(h.setAutostart(true), /Could not enable login startup/); assert.equal(await h.getAutostart(), false);
  const unknown = harness({ uid: null }); await assert.rejects(unknown.setAutostart(true), /login user is unavailable/); assert.equal(unknown.files.has('/Users/me/Library/LaunchAgents/com.videohub.hub.plist'), false);
});
