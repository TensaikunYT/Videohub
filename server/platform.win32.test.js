import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { createPlatform } from './platform.js';

function harness({ existing = [], directories = [], result = { code: 0, stdout: '', stderr: '' }, cores = 8, env = {}, spawnThrows = false, temp = 'C:\\test-temp', hubDir = 'C:\\VideoHub', home = 'C:\\Users\\me', desktopDir = null, realpath } = {}) {
  const calls = [], priorities = [], files = new Map(), children = [], requests=[];
  const spawn = (file, args, opts) => {
    calls.push({ file, args, opts }); if (spawnThrows) throw new Error('Spawn failed'); const child = new EventEmitter();
    child.stdout = new EventEmitter(); child.stderr = new EventEmitter(); child.unref = () => {}; child.kill = () => {};
    children.push(child); return child;
  };
  const platform = createPlatform({ osName: 'win32', env: { PATH: '', ...env }, home, temp, hubDir, desktopDir, path: path.win32,
    fs: { existsSync: f => existing.includes(f), statSync: f => { if (!existing.includes(f)) throw new Error('ENOENT'); return { isFile: () => !directories.includes(f) }; }, mkdirSync() {}, writeFileSync: (f, data) => files.set(f, data), unlinkSync: f => files.delete(f), ...(realpath?{realpathSync:realpath}:{}) },
    os: { cpus: () => Array(cores), setPriority: (...args) => priorities.push(args), constants: { priority: { PRIORITY_NORMAL: 0, PRIORITY_BELOW_NORMAL: 10, PRIORITY_LOW: 19 } } },
    run: async (file, args, opts) => { calls.push({ file, args, opts }); for(const value of files.values()) {const data=JSON.parse(value);if(data.action||data.name)requests.push(data);} return typeof result === 'function' ? result(file, args, opts) : result; }, spawn,
  });
  return { ...platform, calls, priorities, files, children, requests };
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
  const h = harness({ result: (_file, args) => ({ code: 0, stdout: JSON.stringify(args.at(-1).includes('$request.expected')?{saved:true}:{exists:true,command:args.at(-1).includes("GetValue('RenderGuard'") ? '"C:\\VideoHub\\guard\\VideoHubAgent.exe"' : 'C:\\VideoHub\\open.vbs --server'}), stderr: '' }) });
  assert.equal(await h.getAutostart(), true); await h.setAutostart(true); await h.setAutostart(false); await h.cleanupLegacyAutostart();
  assert.equal(h.calls[0].file, 'powershell.exe'); assert.match(h.calls[0].args.at(-1), /Microsoft\.Win32\.Registry/);
  assert.equal(h.requests[0].command,'"' + process.execPath + '" "C:\\VideoHub\\scripts\\install.mjs" open --server');
  assert.deepEqual(h.requests.slice(1).map(r=>[r.name,r.command]),[['VideoHub',null],['RenderGuard',null]]);
  assert.ok(h.calls.some(c=>c.args.at(-1).includes('$key.SetValue'))); assert.equal(h.calls.every(c=>c.file==='powershell.exe'),true);
});

test('Windows startup recognizes owned Node wrappers and direct server entries for migration', async () => {
  for (const command of ['"C:\\Node\\node.exe" "C:\\VideoHub\\server\\hub.js"', '"C:\\Node\\node.exe" "C:\\VideoHub\\scripts\\install.mjs" open --server']) {
    const h = harness({ result: (_file,args)=>({ code: 0, stdout: JSON.stringify(args.at(-1).includes('$request.expected')?{saved:true}:{exists:true,command}), stderr: '' }) });
    assert.equal(await h.getAutostart(), true); await h.setAutostart(true);
    assert.equal(h.requests[0].command,'"' + process.execPath + '" "C:\\VideoHub\\scripts\\install.mjs" open --server');
  }
});

test('Windows login startup leaves another install and its legacy helper unchanged', async () => {
  const h = harness({ result: (_file, args) => ({ code: 0, stdout: JSON.stringify({exists:true,command:args.at(-1).includes("GetValue('RenderGuard'") ? '"C:\\Other VideoHub\\guard\\VideoHubAgent.exe"' : '"C:\\VideoHub-backup\\open.vbs" --server'}), stderr: '' }) });
  assert.equal(await h.getAutostart(), false); await assert.rejects(h.setAutostart(true), /another install/); await assert.rejects(h.setAutostart(false), /another install/);
  await h.cleanupLegacyAutostart(); assert.equal(h.calls.every(c => c.file === 'powershell.exe'), true);
  const missing = harness({ result: { code: 0, stdout: JSON.stringify({exists:false,command:null}), stderr: '' } }); await missing.setAutostart(false); assert.equal(missing.calls.length, 1);
});

test('Windows startup refuses unreadable registry values and reports failed owned legacy removal', async () => {
  const denied = harness({result:{code:1,stdout:'',stderr:'Access denied'}});
  assert.equal((await denied.getAutostartState()).exists,null);
  await assert.rejects(denied.getAutostart(),/Access denied/); await assert.rejects(denied.setAutostart(false),/Access denied/);
  await assert.rejects(denied.cleanupLegacyAutostart(),/Access denied/); assert.equal(denied.calls.every(c=>c.file==='powershell.exe'),true);
  const failure = harness({result:(_file,args)=>args.at(-1).includes('$request.expected')?{code:1,stdout:'',stderr:'Access denied'}:{code:0,stdout:JSON.stringify({exists:true,command:'"C:\\VideoHub\\guard\\VideoHubAgent.exe"'}),stderr:''}});
  await assert.rejects(failure.cleanupLegacyAutostart(),/Could not change login startup/);
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

const flush = async () => { for(let i=0;i<20;i++)await Promise.resolve(); };
function shortcutFixture({target,arguments:args,hubDir="C:\\test-home\\Hub's & ! % é",readError=false,saveError=false,realpath=value=>value}={}) {
  const desktop='D:\\test-home\\Redirected Desktop & ! % é', linkPath=path.win32.join(desktop,'VideoHub.lnk');
  let link=target?{path:linkPath,exists:true,target,arguments:args||'',workingDirectory:hubDir,stamp:'638999999999999999',size:128}:{path:linkPath,exists:false,target:'',arguments:'',workingDirectory:'',stamp:null,size:0},h;
  h=harness({hubDir,home:'C:\\test-home',temp:'C:\\test-home\\temp',realpath,result:(_file,commands)=>{
    const request=[...h.files.values()].map(JSON.parse).find(r=>r.action);
    if(readError)return {code:1,stdout:'',stderr:'Shortcut access denied'};
    if(request?.action==='write') {
      if(saveError)return {code:1,stdout:'',stderr:'Desktop shortcut changed; left unchanged.'};
      link={...link,exists:true,target:request.target,arguments:request.arguments,workingDirectory:request.workingDirectory,stamp:'639000000000000000',size:128};
      return {code:0,stdout:JSON.stringify({saved:true}),stderr:''};
    }
    return {code:0,stdout:JSON.stringify(link),stderr:''};
  }});
  return {...h,hubDir,desktop,linkPath,link:()=>link};
}

test('Windows shortcut creation resolves the actual redirected Desktop lazily and carries every path as JSON data', async () => {
  const h=shortcutFixture(), absent=await h.getShortcut(); assert.equal(absent.path,h.linkPath); assert.equal(absent.exists,false);
  assert.notEqual(path.win32.dirname(absent.path),h.dirs.desktop);
  const made=await h.setShortcut(true); assert.deepEqual(made,{path:h.linkPath,changed:true,owned:true,exists:true});
  const request=h.requests.find(r=>r.action==='write');
  // the short-lived Node console of the launcher stays minimized in the taskbar
  assert.match(h.calls.find(c=>/action -eq 'write'/.test(c.args.at(-1))).args.at(-1),/\$link\.WindowStyle = 7;/);
  assert.equal(request.target,process.execPath); assert.equal(request.arguments,'"'+path.win32.join(h.hubDir,'scripts','install.mjs')+'" open'); assert.equal(request.workingDirectory,h.hubDir);
  assert.equal(request.desktop,null); assert.equal(request.expected.exists,false);
  for(const call of h.calls) {
    assert.equal(call.file,'powershell.exe'); const command=call.args.at(-1);
    assert.match(command,/New-Object -ComObject WScript\.Shell/); assert.match(command,/SpecialFolders\.Item\('Desktop'\)/);
    assert.doesNotMatch(command,/EncodedCommand|ExecutionPolicy|TypeDefinition|DllImport/);
    assert.equal(command.includes(h.desktop),false); assert.equal(command.includes(process.execPath),false);
  }
  assert.equal(h.files.size,0);
});

test('Windows shortcut ownership recognizes Node and legacy launcher forms without trusting WorkingDirectory', async () => {
  const hub='C:\\test-home\\Old Hub';
  for(const [target,args] of [['C:\\Node\\node.exe','"'+hub+'\\scripts\\install.mjs" open'],['C:\\Windows\\System32\\wscript.exe','"'+hub+'\\open.vbs"'],['C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe','-NoProfile -File "'+hub+'\\open.ps1"'],[hub+'\\open.vbs','']]) {
    const h=shortcutFixture({hubDir:hub,target,arguments:args}), state=await h.getShortcut();
    assert.equal(state.owned,true,target); assert.equal(state.install,hub); await h.setShortcut(true);
    assert.equal(h.requests.find(r=>r.action==='write').expected.target,target);
  }
  for(const [target,args] of [['C:\\Node\\node.exe','"'+hub+'-other\\scripts\\install.mjs" open'],['C:\\Windows\\System32\\cmd.exe','/c echo "'+hub+'\\scripts\\install.mjs"'],['C:\\Node\\node.exe','"'+hub+'\\scripts\\install.mjs" open extra']]) {
    const h=shortcutFixture({hubDir:hub,target,arguments:args}); assert.equal((await h.getShortcut()).owned,false);
    await assert.rejects(h.setShortcut(true),/another install/); await assert.rejects(h.setShortcut(false),/another install/);
    assert.equal(h.requests.some(r=>r.action==='write'),false); assert.equal(h.children.length,0);
  }
});

test('Windows shortcut read and snapshot failures refuse changes and clean manifests', async () => {
  const denied=shortcutFixture({readError:true}); const state=await denied.getShortcut(); assert.equal(state.exists,null); assert.match(state.error,/access denied/);
  await assert.rejects(denied.setShortcut(true),/access denied/); assert.equal(denied.children.length,0); assert.equal(denied.files.size,0);
  const changed=shortcutFixture({saveError:true}); await assert.rejects(changed.setShortcut(true),/changed/); assert.equal(changed.files.size,0);
  assert.match(changed.calls.at(-1).args.at(-1),/\$request\.expected\.stamp/);
});

test('Windows shortcut removal uses checked restorable recycling and reports refusal', async () => {
  const hub='C:\\test-home\\Hub', h=shortcutFixture({hubDir:hub,target:'C:\\Node\\node.exe',arguments:'"'+hub+'\\scripts\\install.mjs" open'});
  const removing=h.setShortcut(false); await flush(); const manifest=JSON.parse([...h.files.values()][0]);
  assert.equal(manifest[0].path,h.linkPath); assert.equal(manifest[0].shortcut.target,'C:\\Node\\node.exe');
  assert.match(h.calls.at(-1).args.at(-1),/\$i\.shortcut\.stamp/);
  h.children[0].stdout.emit('data','{"n":0,"code":0}\n'); h.children[0].emit('close',0);
  assert.deepEqual(await removing,{path:h.linkPath,changed:true,owned:true,exists:false}); assert.equal(h.files.size,0);
  const refusal=h.setShortcut(false), expected=assert.rejects(refusal,/Recycle Bin/); await flush();
  h.children[1].stdout.emit('data','{"n":0,"code":-1}\n'); h.children[1].emit('close',0); await expected;
});

test('Windows startup mutation carries a snapshot and refuses changes detected inside the signed registry command', async () => {
  const old='"C:\\Windows\\System32\\wscript.exe" "C:\\VideoHub\\open.vbs" --server';
  const h=harness({result:(_file,args)=>({code:args.at(-1).includes('$request.expected')?1:0,stdout:JSON.stringify({exists:true,command:old}),stderr:'Login startup changed; left unchanged.'})});
  await assert.rejects(h.setAutostart(true),/startup changed/);
  assert.equal(h.requests[0].expected.command,old); assert.equal(h.requests[0].expected.exists,true);
  assert.match(h.calls.at(-1).args.at(-1),/\$key\.GetValue/); assert.match(h.calls.at(-1).args.at(-1),/\$value -cne \[string\]\$request\.expected\.command/);
  assert.equal(h.files.size,0);
});

test('Windows shortcut and startup ownership resolve junction aliases and preserve unknown physical identities', async () => {
  const hub='C:\\test-home\\Hub',alias='C:\\test-home\\Hub Alias', target='C:\\Node\\node.exe',args='"'+alias+'\\scripts\\install.mjs" open';
  const real=value=>value===alias?hub:value;
  const shortcut=shortcutFixture({hubDir:hub,target,arguments:args,realpath:real}); assert.equal((await shortcut.getShortcut()).owned,true);
  const startup=harness({hubDir:hub,realpath:real,result:{code:0,stdout:JSON.stringify({exists:true,command:'"'+target+'" '+args+' --server'}),stderr:''}});
  assert.equal((await startup.getAutostartState()).owned,true);
  const unknown=shortcutFixture({hubDir:hub,target,arguments:args,realpath:()=>{throw new Error('unreadable junction');}}), state=await unknown.getShortcut();
  assert.equal(state.owned,false); assert.equal(state.identityKnown,false); assert.equal(state.install,alias);
});
