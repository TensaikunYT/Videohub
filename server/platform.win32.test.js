import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { createPlatform } from './platform.js';

function harness({ existing = [], directories = [], result = { code: 0, stdout: '', stderr: '' }, cores = 8, env = {}, spawnThrows = false, temp = 'C:\\test-temp' } = {}) {
  const calls = [], priorities = [], files = new Map(), children = [];
  const spawn = (file, args, opts) => {
    calls.push({ file, args, opts }); if (spawnThrows) throw new Error('Spawn failed'); const child = new EventEmitter();
    child.stdout = new EventEmitter(); child.stderr = new EventEmitter(); child.unref = () => {}; child.kill = () => {};
    children.push(child); return child;
  };
  const platform = createPlatform({ osName: 'win32', env: { PATH: '', ...env }, home: 'C:\\Users\\me', temp, hubDir: 'C:\\VideoHub', path: path.win32,
    fs: { existsSync: f => existing.includes(f), statSync: f => { if (!existing.includes(f)) throw new Error('ENOENT'); return { isFile: () => !directories.includes(f) }; }, mkdirSync() {}, writeFileSync: (f, data) => files.set(f, data), unlinkSync: f => files.delete(f) },
    os: { cpus: () => Array(cores), setPriority: (...args) => priorities.push(args), constants: { priority: { PRIORITY_NORMAL: 0, PRIORITY_BELOW_NORMAL: 10, PRIORITY_LOW: 19 } } },
    run: async (file, args, opts) => { calls.push({ file, args, opts }); return typeof result === 'function' ? result(file, args, opts) : result; }, spawn,
  });
  return { ...platform, calls, priorities, files, children };
}

test('Windows platform retains OneDrive-aware folders, tools and browser order', () => {
  const edge = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
  const h = harness({ existing: ['C:\\Users\\me\\OneDrive\\Desktop', 'C:\\Users\\me\\OneDrive\\Documents', 'C:\\ffmpeg\\bin\\ffmpeg.exe', edge] });
  assert.equal(h.dirs.desktop, 'C:\\Users\\me\\OneDrive\\Desktop'); assert.equal(h.dirs.documents, 'C:\\Users\\me\\OneDrive\\Documents');
  assert.equal(h.dirs.guard, 'C:\\Users\\me\\AppData\\Roaming\\RenderGuard');
  assert.equal(h.findTool('ffmpeg'), 'C:\\ffmpeg\\bin\\ffmpeg.exe'); assert.equal(h.findBrowser().path, edge);
  h.openUrlWindow('http://127.0.0.1:7799'); assert.equal(h.calls[0].file, edge); assert.deepEqual(h.calls[0].args, ['--app=http://127.0.0.1:7799']);
});

test('Windows shell and file actions preserve verbatim quoting', () => {
  const h = harness(), command = 'node -e "console.log(1)" "a b"';
  assert.deepEqual(h.shellCommand(command), { file: 'cmd.exe', args: ['/d', '/s', '/c', '"' + command + '"'], opts: { windowsVerbatimArguments: true } });
  h.reveal('C:\\Films\\a b.mp4', { select: true });
  assert.equal(h.calls[0].file, 'explorer.exe'); assert.deepEqual(h.calls[0].args, ['/select,"C:\\Films\\a b.mp4"']);
  assert.equal(h.calls[0].opts.windowsVerbatimArguments, true);
  h.openPath('C:\\Films'); assert.deepEqual(h.calls[1].args, ['"C:\\Films"']);
  h.openUrlWindow('http://127.0.0.1:7799'); assert.equal(h.calls[2].file, 'cmd'); assert.deepEqual(h.calls[2].args, ['/c', 'start', '', 'http://127.0.0.1:7799']);
});

test('Windows explicit native browser override takes precedence and rejects directories or missing paths', () => {
  const edge = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', custom = 'C:\\Browsers\\custom.exe';
  const h = harness({ existing: [edge, custom], env: { VIDEOHUB_BROWSER: custom } }); assert.equal(h.findBrowser().path, custom);
  assert.equal(harness({ existing: [edge, custom], directories: [custom], env: { VIDEOHUB_BROWSER: custom } }).findBrowser().path, edge);
  assert.equal(harness({ existing: [edge], env: { VIDEOHUB_BROWSER: custom } }).findBrowser().path, edge);
});

test('Windows autostart migrates an owned legacy launcher to Node and removes only its legacy guard value', async () => {
  const h = harness({ result: (_file, args) => ({ code: 0, stdout: args.at(-1) === 'RenderGuard' ? 'RenderGuard REG_SZ "C:\\VideoHub\\guard\\VideoHubAgent.exe"' : 'VideoHub REG_SZ C:\\VideoHub\\open.vbs --server', stderr: '' }) });
  assert.equal(await h.getAutostart(), true); await h.setAutostart(true); await h.setAutostart(false); await h.cleanupLegacyAutostart();
  const key = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run';
  assert.deepEqual(h.calls[0].args, ['query', key, '/v', 'VideoHub']);
  assert.deepEqual(h.calls.find(c => c.args[0] === 'add').args, ['add', key, '/v', 'VideoHub', '/t', 'REG_SZ', '/d', '"' + process.execPath + '" "C:\\VideoHub\\scripts\\install.mjs" open --server', '/f']);
  assert.deepEqual(h.calls.filter(c => c.args[0] === 'delete').map(c => c.args), [['delete', key, '/v', 'VideoHub', '/f'], ['delete', key, '/v', 'RenderGuard', '/f']]);
});

test('Windows startup recognizes owned Node wrappers and direct server entries for migration', async () => {
  for (const command of ['"node.exe" "C:\\VideoHub\\server\\hub.js"', '"node.exe" "C:\\VideoHub\\scripts\\install.mjs" open --server']) {
    const h = harness({ result: { code: 0, stdout: 'VideoHub REG_SZ ' + command, stderr: '' } });
    assert.equal(await h.getAutostart(), true); await h.setAutostart(true);
    assert.ok(h.calls.find(c => c.args[0] === 'add').args.includes('"' + process.execPath + '" "C:\\VideoHub\\scripts\\install.mjs" open --server'));
  }
});

test('Windows login startup leaves another install and its legacy helper unchanged', async () => {
  const h = harness({ result: (_file, args) => ({ code: 0, stdout: args.at(-1) === 'RenderGuard' ? 'RenderGuard REG_SZ "C:\\Other VideoHub\\guard\\VideoHubAgent.exe"' : 'VideoHub REG_SZ "C:\\VideoHub-backup\\open.vbs" --server', stderr: '' }) });
  assert.equal(await h.getAutostart(), false); await assert.rejects(h.setAutostart(true), /another install/); await assert.rejects(h.setAutostart(false), /another install/);
  await h.cleanupLegacyAutostart(); assert.equal(h.calls.every(c => c.args[0] === 'query'), true);
  const missing = harness({ result: { code: 1, stdout: '', stderr: 'missing' } }); await missing.setAutostart(false); assert.equal(missing.calls.length, 1);
});

test('Windows recycling uses the signed framework recycle API, preserves Bin safeguards and refuses command failures', async () => {
  const target = 'C:\\Films\\é 你好.mp4', h = harness({ temp: "C:\\test-temp\\D'Arté" }), results = [], done = h.recycleStream([{ path: target, size: 1 }], (...args) => results.push(args));
  const child = h.children[0], command = h.calls[0].args.at(-1);
  const manifest = [...h.files].find(([name]) => name.endsWith('.json'))[1]; assert.equal(JSON.parse(manifest)[0].path, target);
  assert.ok(h.calls[0].args.includes('-Command')); assert.equal(h.files.size, 1);
  assert.match(command, /Add-Type -AssemblyName Microsoft\.VisualBasic/);
  assert.match(command, /FileSystem\]::DeleteFile/); assert.match(command, /FileSystem\]::DeleteDirectory/);
  assert.equal((command.match(/RecycleOption\]::SendToRecycleBin/g) || []).length, 2);
  assert.match(command, /if \(-not \$c -or \$c\.nuke -eq 1\) \{ \$r = -3 \}/);
  assert.match(command, /\$i\.size -gt \[int64\]\(\$c\.max \* 0\.9\)/);
  assert.doesNotMatch(command, /TypeDefinition|DllImport|SHFileOperation|DeletePermanently|Remove-Item/);
  assert.equal(command.includes(target), false); assert.equal(h.calls[0].args.some(a => /ExecutionPolicy|Bypass|EncodedCommand/.test(a)), false);
  child.emit('error', new Error('PowerShell could not start')); child.emit('close', -1); await done;
  assert.equal(results.length, 1); assert.match(results[0][2], /could not start/); assert.equal(h.files.size, 0);
  const throws = harness({ spawnThrows: true }), failures = [];
  await throws.recycleStream([{ path: 'C:\\Films\\old.mp4', size: 1 }], (...args) => failures.push(args));
  assert.equal(failures.length, 1); assert.equal(throws.files.size, 0);
});

test('Windows folder picker loads the installed WinForms dialog with JSON data and offers the typed fallback when unavailable', async () => {
  const title = "Choose 'film'; $(must stay data)", selected = 'C:\\Films\\é 你好', h = harness({ temp: "C:\\test-temp\\D'Arté" });
  const result = h.pickFolder({ title, start: 'D:\\Films' }), command = h.calls[0].args.at(-1);
  assert.match(command, /Add-Type -AssemblyName System\.Windows\.Forms/); assert.match(command, /FolderBrowserDialog/); assert.match(command, /TopMost = \$true/);
  assert.match(command, /SelectedPath = \[string\]\$request\.start/);
  assert.doesNotMatch(command, /TypeDefinition|MemberDefinition|DllImport|using System/); assert.equal(command.includes(title), false);
  assert.equal(command.includes('D:\\Films'), false); assert.equal(JSON.parse([...h.files.values()][0]).start, 'D:\\Films');
  assert.match(command, /D''Arté/); assert.equal(h.calls[0].args.some(a => /ExecutionPolicy|Bypass|EncodedCommand/.test(a)), false);
  assert.equal(JSON.parse([...h.files.values()][0]).title, title);
  h.children[0].stdout.emit('data', selected + '\r\n'); h.children[0].emit('close', 0); assert.equal(await result, selected); assert.equal(h.files.size, 0);
  const cancel = harness(), canceled = cancel.pickFolder(); cancel.children[0].emit('close', 0); assert.equal(await canceled, null);
  const denied = harness(), unavailable = denied.pickFolder(); denied.children[0].emit('close', 1); assert.deepEqual(await unavailable, { unsupported: true });
  assert.deepEqual(await harness({ spawnThrows: true }).pickFolder(), { unsupported: true });
});

test('Windows notifications do not change execution policy', () => {
  const h = harness(); h.notify('VideoHub', 'Render complete');
  assert.equal(h.calls[0].args.some(a => /ExecutionPolicy|Bypass|EncodedCommand/.test(a)), false);
});

test('Windows protection retains top-core mask, priority and taskkill process tree', async () => {
  const h = harness(); await h.setTreePriority(42, 'low', 2);
  assert.deepEqual(h.priorities, [[42, 10]]); assert.equal(h.calls[0].file, 'powershell.exe');
  assert.match(h.calls[0].args.at(-1), /PriorityClass = 'BelowNormal'; \$p\.ProcessorAffinity = \[IntPtr\]192/);
  assert.match(h.calls[0].args.at(-1), /ParentProcessId/);
  await h.killTree(42); assert.deepEqual(h.calls[1], { file: 'taskkill', args: ['/PID', '42', '/T', '/F'], opts: undefined });
  await h.killTree(-1); assert.equal(h.calls.length, 2);
  const many = harness({ cores: 64 }); await many.setTreePriority(42, 'idle', 2); assert.doesNotMatch(many.calls[0].args.at(-1), /ProcessorAffinity/);
  await assert.rejects(harness({ result: { code: 1, stdout: '', stderr: 'CIM is temporarily unavailable' } }).setTreePriority(42, 'low', 2), /temporarily unavailable/);
});

test('Windows process parser preserves private RAM and handles a single process', async () => {
  const h = harness({ result: { code: 0, stdout: JSON.stringify({ n: 'chrome.exe', p: 42, pp: 4, m: 987654, h: true, cmd: '--headless', start: '2026-01-01' }), stderr: '' } });
  assert.deepEqual(await h.processList(), [{ pid: 42, ppid: 4, name: 'chrome.exe', cmd: '--headless', rssBytes: 987654, start: '2026-01-01', headless: true }]);
  assert.match(h.calls[0].args.at(-1), /PrivatePageCount/); assert.equal(h.calls[0].opts.timeout, 20000);
  assert.equal(await harness({ result: { code: 1, stdout: '', stderr: 'unavailable' } }).processList(), null);
});
