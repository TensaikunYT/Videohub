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
    if (/\.(js|mjs|ps1)$/.test(f) && !/\.test\.js$/.test(f)) assert.doesNotMatch(read(f), /Add-Type\s+-(TypeDefinition|MemberDefinition)|-EncodedCommand|wscript/i, f);
});

test('the retained PowerShell helper passes clear commands without an execution-policy override', async () => {
  const source = read('server/util.js').split(/\r?\n/).find(line => line.startsWith('export function powershell(')), calls = [];
  const ctx = vm.createContext({ run: async (...args) => { calls.push(args); return { code: 0 }; } });
  vm.runInContext(source.replace('export ', ''), ctx);
  await ctx.powershell('Get-Date', { timeout: 10 });
  assert.deepEqual([...calls[0][1]], ['-NoProfile', '-NonInteractive', '-Command', 'Get-Date']);
  assert.equal(calls[0][2].timeout, 10);
});

test('Windows launch needs neither VBScript nor PowerShell; only the visible setup/update consoles lift the policy for their own process', () => {
  assert.equal(exists('open.vbs'), false); assert.equal(exists('open.ps1'), false);
  assert.match(read('open.cmd'), /^node "%~dp0scripts\\install\.mjs" open %\*/m); assert.doesNotMatch(read('open.cmd'), /powershell|wscript/i);
  assert.doesNotMatch(read('open.cmd'), /ExecutionPolicy/i);
  // Windows blocks every .ps1 by default: the user-started, visible SETUP.cmd / UPDATE.cmd lift it for that one process
  for (const f of ['SETUP.cmd', 'UPDATE.cmd']) assert.match(read(f), /^powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0(setup|update)\.ps1" %\*/m, f);
  // ...and nothing the scripts start themselves uses it
  for (const f of ['setup.ps1', 'update.ps1', 'uninstall.ps1']) assert.equal(read(f).split(/\r?\n/).filter(l => /ExecutionPolicy/i.test(l) && !l.trimStart().startsWith('#')).length, 0, f);
  const setup = read('setup.ps1');
  assert.match(setup, /\$lnk\.TargetPath = \$node; \$lnk\.Arguments = "`"\$hub\\scripts\\install\.mjs`" open"/);
  assert.match(setup, /\$lnk\.WindowStyle = 7/);
  assert.match(setup, /install\.mjs'\) autostart --startup yes/);
  assert.doesNotMatch(setup + read('update.ps1') + read('uninstall.ps1'), /wscript\.exe|Start-Process \$(exe|agent)|-WindowStyle Hidden|Remove-Item \$exe/i);
});

test('update re-points only its own shortcut and start-up entry, then recycles retired files without running them', () => {
  const update = read('update.ps1');
  assert.doesNotMatch(update, /'open\.ps1', 'open\.vbs'/); assert.match(update, /'uninstall\.ps1', 'open\.cmd', /);
  assert.match(update, /\$sc\.TargetPath = \$node; \$sc\.Arguments = "`"\$Target\\scripts\\install\.mjs`" open"/);
  assert.match(update, /if \(\$mine\)/);
  assert.match(update, /autostart --startup yes/);
  assert.match(update, /'retire-legacy', '--target', \$Target/);
  assert.match(update, /if \(-not \(\$lnkOld -or \$runOld\)\) \{ \$retireArgs \+= '--launchers' \}/);
  assert.equal(parseOptions(['retire-legacy', '--target', 'X', '--launchers']).launchers, true);
});

test('legacy retirement lists the old helper, its build leftovers and (only on request) the old launchers', () => {
  const install = path.join(path.sep, 'VideoHub'), guard = path.join(install, 'guard');
  const plain = legacyFiles(install, { list: () => ['VideoHubAgent.exe', 'VideoHubAgent.old.exe', 'notes.txt'] });
  assert.deepEqual(plain.helpers, ['VideoHubAgent.exe', 'RenderGuard.exe', 'VideoHubAgent.old.exe'].map(n => path.join(guard, n)));
  assert.deepEqual(plain.extras, ['RenderGuard.cs', 'build.ps1', 'tests'].map(n => path.join(guard, n)));
  assert.deepEqual(legacyFiles(install, { launchers: true, list: () => [] }).extras.slice(-2), [path.join(install, 'open.vbs'), path.join(install, 'open.ps1')]);
});

test('legacy retirement only recycles and refuses a partial Recycle Bin result', async () => {
  const install = path.join(path.sep, 'VideoHub'), present = new Set([path.join(install, 'guard', 'VideoHubAgent.exe'), path.join(install, 'open.vbs')]);
  const trashed = [], platform = { processList: async () => [], trash: async files => { trashed.push(...files); return files.map(f => ({ path: f, ok: true })); }, cleanupLegacyAutostart: async () => {} };
  await retireLegacyAgent({ install, platform, stopPid: () => assert.fail('nothing runs'), delay: async () => {}, launchers: true, exists: f => present.has(f), list: () => [] });
  assert.deepEqual(trashed.sort(), [...present].sort());
  const refused = { ...platform, trash: async files => files.map(f => ({ path: f, ok: false, error: 'Bin off' })) };
  await assert.rejects(retireLegacyAgent({ install, platform: refused, stopPid() {}, delay: async () => {}, exists: f => present.has(f), list: () => [] }), /no deletion fallback/);
  const kept = []; await retireLegacyAgent({ install, platform: { ...platform, trash: async files => { kept.push(...files); return files.map(f => ({ path: f, ok: true })); } }, stopPid() {}, delay: async () => {}, exists: f => present.has(f), list: () => [] });
  assert.equal(kept.includes(path.join(install, 'open.vbs')), false, 'launchers stay unless requested');
});

test('render dialogs offer only this OS encoders, and a film CHROME setting wins over the hub browser', () => {
  assert.match(read('server/jobs.js'), /codecs: ENCODERS\.filter\(n => n === 'auto' \|\| n === 'x264' \|\| PROBE_ORDER\.includes\(n\)\)/);
  for (const f of ['templates/new-film/render.js', 'examples/hello-film/render.js']) assert.match(read(f), /const c = \[process\.env\.CHROME, process\.env\.VIDEOHUB_BROWSER,/, f);
});
