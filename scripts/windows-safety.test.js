import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { legacyFiles, retireLegacyAgent, parseOptions } from './install.mjs';

const read = f => fs.readFileSync(new URL('../' + f, import.meta.url), 'utf8');
const exists = f => fs.existsSync(new URL('../' + f, import.meta.url));

test('Windows runtime uses OS services without compiling interop or changing execution policy', () => {
  const source = read('server/platform.js');
  assert.doesNotMatch(source, /Add-Type\s+-(TypeDefinition|MemberDefinition)|\[DllImport\s*\(|using System|-EncodedCommand|-ExecutionPolicy/i);
  assert.match(source, /SendToRecycleBin/);
  for (const f of ['server', 'ui', 'scripts', 'templates', 'examples', 'engine-hooks'].flatMap(d => fs.readdirSync(new URL('../' + d, import.meta.url), { recursive: true }).map(n => d + '/' + n)))
    if (/\.(js|mjs|ps1)$/.test(f) && !/\.test\.js$/.test(f)) assert.doesNotMatch(read(f), /Add-Type\s+-(TypeDefinition|MemberDefinition)|['"]-(?:EncodedCommand|ExecutionPolicy)['"]|(?:spawn(?:Sync)?|execFile(?:Sync)?|run|detached)\s*\(\s*['"](?:wscript|cscript)(?:\.exe)?['"]/i, f);
});

test('the retained PowerShell helper passes clear commands without an execution-policy override', async () => {
  const source = read('server/util.js').split(/\r?\n/).find(line => line.startsWith('export function powershell(')), calls = [];
  const ctx = vm.createContext({ run: async (...args) => { calls.push(args); return { code: 0 }; } });
  vm.runInContext(source.replace('export ', ''), ctx);
  await ctx.powershell('Get-Date', { timeout: 10 });
  assert.deepEqual([...calls[0][1]], ['-NoProfile', '-NonInteractive', '-Command', 'Get-Date']);
  assert.equal(calls[0][2].timeout, 10);
});

test('Windows clickable lifecycle entry points invoke Node directly without policy overrides', () => {
  assert.equal(exists('open.vbs'), false); assert.equal(exists('open.ps1'), false);
  for (const [file, action] of [['open.cmd', 'open'], ['SETUP.cmd', 'setup'], ['UPDATE.cmd', 'update'], ['UNINSTALL.cmd', 'uninstall']]) {
    assert.ok(read(file).split(/\r?\n/).includes(`node "%~dp0scripts\\install.mjs" ${action} %*`), file);
    assert.doesNotMatch(read(file), /powershell|wscript|ExecutionPolicy|EncodedCommand/i, file);
  }
});

test('PowerShell compatibility wrappers only forward lifecycle actions while respecting native policy', () => {
  for (const [file, action] of [['setup.ps1', 'setup'], ['update.ps1', 'update'], ['uninstall.ps1', 'uninstall']]) {
    const source = read(file);
    assert.match(source, /install\.mjs/, file);
    assert.match(source, new RegExp("['\"]" + action + "['\"]"), file);
    assert.doesNotMatch(source, /-ExecutionPolicy|-EncodedCommand|Set-ExecutionPolicy|Unblock-File|(?:Add|Set)-MpPreference/i, file);
    assert.doesNotMatch(source, /WScript\.Shell|Copy-Item|Remove-Item|Start-Process|Set-ItemProperty/i, 'Lifecycle mutations belong to the shared Node installer: ' + file);
  }
});

test('legacy retirement lists the old helper, its build leftovers and (only on request) the old launchers', () => {
  assert.equal(parseOptions(['retire-legacy', '--target', 'X', '--launchers']).launchers, true);
  const install = path.join(path.sep, 'VideoHub'), guard = path.join(install, 'guard');
  const plain = legacyFiles(install, { list: () => ['VideoHubAgent.exe', 'VideoHubAgent.old.exe', 'notes.txt'] });
  assert.deepEqual(plain.helpers, ['VideoHubAgent.exe', 'RenderGuard.exe', 'VideoHubAgent.old.exe'].map(n => path.join(guard, n)));
  assert.deepEqual(plain.extras, ['RenderGuard.cs', 'build.ps1', 'tests'].map(n => path.join(guard, n)));
  assert.deepEqual(legacyFiles(install, { launchers: true, list: () => [] }).extras.slice(-2), [path.join(install, 'open.vbs'), path.join(install, 'open.ps1')]);
});

test('legacy retirement only recycles and refuses a partial Recycle Bin result', async () => {
  const install = path.join(path.sep, 'VideoHub'), present = new Set([path.join(install, 'guard', 'VideoHubAgent.exe'), path.join(install, 'open.vbs')]);
  const trashed = [], platform = { processList: async () => [], trash: async files => { trashed.push(...files); return files.map(f => ({ path: f, ok: true })); }, cleanupLegacyAutostart: async () => {} };
  await retireLegacyAgent({ install, platform, stopPid: () => assert.fail('nothing runs'), delay: async () => {}, launchers: true, exists: f => present.has(f), list: () => [], validatePaths: () => {} });
  assert.deepEqual(trashed.sort(), [...present].sort());
  const refused = { ...platform, trash: async files => files.map(f => ({ path: f, ok: false, error: 'Bin off' })) };
  await assert.rejects(retireLegacyAgent({ install, platform: refused, stopPid() {}, delay: async () => {}, exists: f => present.has(f), list: () => [], validatePaths: () => {} }), /no deletion fallback/);
  const kept = []; await retireLegacyAgent({ install, platform: { ...platform, trash: async files => { kept.push(...files); return files.map(f => ({ path: f, ok: true })); } }, stopPid() {}, delay: async () => {}, exists: f => present.has(f), list: () => [], validatePaths: () => {} });
  assert.equal(kept.includes(path.join(install, 'open.vbs')), false, 'launchers stay unless requested');
});

test('render dialogs offer only this OS encoders, and a film CHROME setting wins over the hub browser', () => {
  assert.match(read('server/jobs.js'), /codecs: ENCODERS\.filter\(n => n === 'auto' \|\| n === 'x264' \|\| PROBE_ORDER\.includes\(n\)\)/);
  for (const f of ['templates/new-film/render.js', 'examples/hello-film/render.js']) assert.match(read(f), /const c = \[process\.env\.CHROME, process\.env\.VIDEOHUB_BROWSER,/, f);
});
