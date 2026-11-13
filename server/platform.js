// OS integration lives here so queue, cleanup and UI retain the same contracts.
import fsDefault from 'node:fs';
import osDefault from 'node:os';
import pathDefault from 'node:path';
import { spawn as spawnDefault, execFile, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const install = pathDefault.resolve(pathDefault.dirname(fileURLToPath(import.meta.url)), '..');
function runDefault(file, args, opts = {}) { return new Promise(resolve => execFile(file,args,{ windowsHide:true,maxBuffer:64<<20,...opts },(e,stdout,stderr)=>resolve({code:e?.code??0,stdout:String(stdout||''),stderr:String(stderr||'')}))); }
// Dependencies are injectable: all three OS contracts can be tested on any host.
export function createPlatform({ osName = process.platform, env = process.env, home = osDefault.homedir(), temp = osDefault.tmpdir(), fs = fsDefault, os = osDefault, path = pathDefault, spawn = spawnDefault, run = runDefault, runSync = execFileSync, hubDir = install, kill = process.kill.bind(process), uid = () => process.getuid?.() ?? null, delay = ms => new Promise(r => setTimeout(r,ms)), now = Date.now } = {}) {
if (osName !== 'win32') return createUnixPlatform({ osName, env, home, temp, fs, os, path, spawn, run, runSync, hubDir, kill, delay, uid, now });
const OS = osName, IS_WIN = OS === 'win32', IS_MAC = OS === 'darwin', IS_LINUX = OS === 'linux';
const HUB_DIR = hubDir, DATA_DIR = env.VIDEOHUB_DATA_DIR || path.join(HUB_DIR,'data');
const writeJson = (f,j) => { fs.mkdirSync(path.dirname(f),{recursive:true}); fs.writeFileSync(f,JSON.stringify(j)); };
const HOME = home;
const DESKTOP = (() => {
  // OneDrive can move the Desktop; prefer the one that exists
  for (const d of [path.join(HOME, 'Desktop'), path.join(HOME, 'OneDrive', 'Desktop'), path.join(HOME, 'OneDrive', 'Masa\u00fcst\u00fc')]) if (fs.existsSync(d)) return d;
  return path.join(HOME, 'Desktop');
})();
const DOCUMENTS = (() => {
  for (const d of [path.join(HOME, 'Documents'), path.join(HOME, 'OneDrive', 'Documents')]) if (fs.existsSync(d)) return d;
  return path.join(HOME, 'Documents');
})();
const APPDATA = env.APPDATA || path.join(HOME, 'AppData', 'Roaming');
const TEMP = temp;

const dirs = { home:HOME,desktop:DESKTOP,documents:DOCUMENTS,config:APPDATA,temp:TEMP,guard:path.join(APPDATA,'RenderGuard') };
function which(name, extra = []) {
  const dirs = (env.PATH || '').split(path.delimiter).concat(extra);
  for (const d of dirs) { const f = path.join(d, name); if (d && fs.existsSync(f)) return f; }
  return null;
}
const TOOLS = {
  ffmpeg: which('ffmpeg.exe', ['C:\\ffmpeg\\bin']) || 'ffmpeg',
  ffprobe: which('ffprobe.exe', ['C:\\ffmpeg\\bin']) || 'ffprobe',
  node: process.execPath,
  edge: ['C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', 'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'].find(f => fs.existsSync(f)) || null,
  chrome: ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', path.join(HOME, 'AppData\\Local\\Google\\Chrome\\Application\\chrome.exe')].find(f => fs.existsSync(f)) || null,
};


const findTool = name => name === 'ffmpeg' || name === 'ffprobe' ? (which(name+'.exe',['C:\\ffmpeg\\bin'])) : which(name) || which(name+'.exe');
const findBrowser = () => {
 let override=null; try { if(env.VIDEOHUB_BROWSER && path.isAbsolute(env.VIDEOHUB_BROWSER) && fs.statSync(env.VIDEOHUB_BROWSER).isFile()) override=env.VIDEOHUB_BROWSER; }catch{}
 return {edge:TOOLS.edge,chrome:TOOLS.chrome,chromium:null,path:override||TOOLS.edge||TOOLS.chrome};
};
function detached(file,args,opts={}) { if(env.VIDEOHUB_NO_WINDOW) return Promise.resolve(); return new Promise((resolve,reject)=>{try { const c=spawn(file,args,{detached:true,stdio:'ignore',windowsHide:true,...opts}); c.once('error',reject); c.once('spawn',()=>{c.unref();resolve();}); }catch(e){reject(e);} }); }
function openUrlWindow(url) { const exe=findBrowser().path; return exe ? detached(exe,['--app='+url],{windowsHide:false}) : detached('cmd',['/c','start','',url]); }
function fileOpenPlan(target,{select=false}={}) { return { command:'explorer.exe',args:[select?'/select,"'+target+'"':'"'+target+'"'],opts:{windowsVerbatimArguments:true} }; }
function reveal(target,{select=false}={}) { const p=fileOpenPlan(target,{select}); return detached(p.command,p.args,p.opts); }
const openPath = target => reveal(target);
const q = (s) => "'" + String(s ?? '').replace(/'/g, "''") + "'";
function pickFolder({ start, title = 'Choose folder' } = {}) {
  if (env.VIDEOHUB_NO_WINDOW) return Promise.resolve(null);
  const inputFile = path.join(temp, `vh-pick-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}.json`);
  writeJson(inputFile, { title, start });
  const ps = [
    "$ErrorActionPreference = 'Stop'",
    '[Console]::OutputEncoding = [Text.Encoding]::UTF8',
    `$request = Get-Content -LiteralPath ${q(inputFile)} -Raw -Encoding UTF8 | ConvertFrom-Json`,
    // Loads the installed WinForms assembly (nothing is compiled). An invisible topmost owner keeps the dialog in
    // front of the VideoHub app window; title and start folder stay JSON data, never PowerShell source.
    'Add-Type -AssemblyName System.Windows.Forms',
    "$owner = New-Object Windows.Forms.Form -Property @{ TopMost = $true; ShowInTaskbar = $false; FormBorderStyle = 'None'; Opacity = 0; Width = 1; Height = 1; StartPosition = 'CenterScreen' }",
    '$owner.Show(); $owner.Activate()',
    '$dialog = New-Object Windows.Forms.FolderBrowserDialog -Property @{ Description = [string]$request.title; ShowNewFolderButton = $true }',
    'if ($request.start -and [IO.Directory]::Exists([string]$request.start)) { $dialog.SelectedPath = [string]$request.start }',
    "$selected = if ($dialog.ShowDialog($owner) -eq 'OK') { $dialog.SelectedPath } else { $null }",
    '$owner.Close()',
    'if ($selected) { $selected }',
  ].join('\n');
  return new Promise((res) => {
    let finished = false, o = '', c;
    const done = v => { if (finished) return; finished = true; try { fs.unlinkSync(inputFile); } catch { } res(v); };
    try { c = spawn('powershell.exe', ['-NoProfile', '-STA', '-Command', ps], { windowsHide: true }); }
    catch { done({ unsupported: true }); return; }
    c.stdout.on('data', b => { o += b; });
    c.on('close', code => { const selected = o.replace(/\r?\n$/, ''); done(code === 0 ? path.isAbsolute(selected) ? selected : null : { unsupported: true }); });
    c.on('error', () => done({ unsupported: true }));
  });
}

function recycleStream(items, onItem) {
  return new Promise(resolve => {
    if (!items.length) return resolve();
    const listFile = path.join(DATA_DIR, `recycle-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}.json`);
    writeJson(listFile, items.map(i => ({ path: i.path, size: i.size || 0 })));
    const ps = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName Microsoft.VisualBasic
$caps = @{}
foreach ($v in Get-CimInstance Win32_Volume) {
  if (-not $v.DriveLetter) { continue }
  $g = [regex]::Match($v.DeviceID, '\\{[^}]+\\}').Value
  $k = Get-ItemProperty -LiteralPath "HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\BitBucket\\Volume\\$g" -ErrorAction SilentlyContinue
  if ($k) { $caps[$v.DriveLetter.ToUpper()] = @{ max = [int64]$k.MaxCapacity * 1MB; nuke = [int]$k.NukeOnDelete } }
}
$items = Get-Content -LiteralPath '${listFile.replace(/'/g, "''")}' -Raw -Encoding UTF8 | ConvertFrom-Json
$n = 0
foreach ($i in @($items)) {
  $c = $caps[$i.path.Substring(0, 2).ToUpper()]
  if (-not $c -or $c.nuke -eq 1) { $r = -3 } elseif ([int64]$i.size -gt [int64]($c.max * 0.9)) { $r = -2 } else {
    try {
      if ([IO.Directory]::Exists([string]$i.path)) {
        [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteDirectory([string]$i.path, [Microsoft.VisualBasic.FileIO.UIOption]::OnlyErrorDialogs, [Microsoft.VisualBasic.FileIO.RecycleOption]::SendToRecycleBin, [Microsoft.VisualBasic.FileIO.UICancelOption]::ThrowException)
      } else {
        [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteFile([string]$i.path, [Microsoft.VisualBasic.FileIO.UIOption]::OnlyErrorDialogs, [Microsoft.VisualBasic.FileIO.RecycleOption]::SendToRecycleBin, [Microsoft.VisualBasic.FileIO.UICancelOption]::ThrowException)
      }
      $r = 0
    } catch { $r = -1 }
  }
  [Console]::Out.WriteLine(([pscustomobject]@{ n = $n; code = $r } | ConvertTo-Json -Compress)); [Console]::Out.Flush()
  $n++
}`;
    let p, buf = '', err = '', seen = 0, timer = null, finished = false;
    const finish = () => {
      if (finished) return;
      finished = true; clearTimeout(timer);
      try { fs.unlinkSync(listFile); } catch { }
      for (let i = seen; i < items.length; i++) onItem(items[i], null, (err.trim().split('\n').pop() || 'PowerShell stopped (timeout or error).').slice(0, 300));
      resolve();
    };
    try { p = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], { windowsHide: true }); }
    catch (e) { err = e.message; finish(); return; }
    p.on('error', e => { err = e.message; finish(); });
    // a stuck shell operation must not hold the run forever: 5 min without a result line ends it
    const arm = () => { clearTimeout(timer); timer = setTimeout(() => { err = 'PowerShell stopped (timeout).'; try { p.kill(); } catch { } finish(); }, 5 * 60e3); };
    arm();
    p.stdout.on('data', d => {
      if (finished) return;
      buf += d; let k;
      while ((k = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, k).trim(); buf = buf.slice(k + 1);
        if (!line.startsWith('{')) continue;
        try { const j = JSON.parse(line); seen = Math.max(seen, j.n + 1); onItem(items[j.n], j.code); arm(); } catch { }
      }
    });
    p.stderr.on('data', d => { err += d; });
    p.on('close', finish);
  });
}


function sizeOf(file) { const st=fs.lstatSync(file); return st.isDirectory() && !st.isSymbolicLink() ? fs.readdirSync(file).reduce((n,name)=>n+sizeOf(path.join(file,name)),0) : st.size; }
async function trash(paths) { const out=[]; const items=[]; for(const p of paths){const item=typeof p==='string'?{path:p}:p; try{items.push({...item,size:item.size??sizeOf(item.path)});}catch(e){out.push({path:item.path,ok:false,error:e.message});}} await recycleStream(items,(i,code,error)=>out.push({path:i.path,ok:code===0,code,error:error||(code===0?null:'Could not move to the Recycle Bin.')})); return out; }
async function volumes() { const r=await run('powershell.exe',['-NoProfile','-NonInteractive','-Command','Get-CimInstance Win32_Volume | Select-Object DriveLetter,Capacity,FreeSpace | ConvertTo-Json -Compress']); try { return [].concat(JSON.parse(r.stdout)).filter(x=>x.DriveLetter).map(x=>({mount:x.DriveLetter,freeBytes:+x.FreeSpace,totalBytes:+x.Capacity})); }catch{return [];} }
function notify(title, body) {
  if (env.VIDEOHUB_NO_WINDOW) return;
  const q = (s) => "'" + String(s || '').replace(/'/g, "''").slice(0, 200) + "'";
  const ps = [
    '[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null',
    '$x = [Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent([Windows.UI.Notifications.ToastTemplateType]::ToastText02)',
    '$t = $x.GetElementsByTagName("text")', `$t.Item(0).AppendChild($x.CreateTextNode(${q(title)})) | Out-Null`, `$t.Item(1).AppendChild($x.CreateTextNode(${q(body)})) | Out-Null`,
    '$n = [Windows.UI.Notifications.ToastNotification]::new($x)',
    '[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier("{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\\WindowsPowerShell\\v1.0\\powershell.exe").Show($n)',
  ].join('; ');
  try { spawn('powershell.exe', ['-NoProfile', '-Command', ps], { windowsHide: true, stdio: 'ignore', detached: true }).on('error', () => {}).unref(); } catch { }
}


async function processList() { const script=`Get-CimInstance Win32_Process | ForEach-Object { [pscustomobject]@{ n = $_.Name; p = [int]$_.ProcessId; pp = [int]$_.ParentProcessId; m = [int64]$_.PrivatePageCount; h = [bool]($_.CommandLine -match '--headless|--app=http://127\\.0\\.0\\.1'); cmd = $_.CommandLine; start = $_.CreationDate } } | ConvertTo-Json -Compress`; const r=await run('powershell',['-NoProfile','-NonInteractive','-Command',script],{maxBuffer:16<<20,timeout:20000}); if(r.code!==0) return null; try{return [].concat(JSON.parse(r.stdout)).filter(Boolean).map(r=>({pid:r.p,ppid:r.pp,name:r.n,cmd:r.cmd||'',rssBytes:r.m,start:r.start,headless:r.h}));}catch{return null;} }
async function killTree(pid) { if(!Number.isSafeInteger(+pid)||+pid<=0) return; const r=await run('taskkill',['/PID',String(pid),'/T','/F']); if(r.code!==0) throw new Error(r.stderr||'Could not stop process tree'); }
async function setTreePriority(rootPid,level,cores) {
 const prio={normal:'Normal',low:'BelowNormal',idle:'Idle'}[level]||'Normal';
 try{os.setPriority(rootPid,{normal:os.constants.priority.PRIORITY_NORMAL,low:os.constants.priority.PRIORITY_BELOW_NORMAL,idle:os.constants.priority.PRIORITY_LOW}[level]);}catch{}
 const count=os.cpus().length,n=Math.max(1,Math.min(cores??count,count)),aff=count>63?null:((1n<<BigInt(n))-1n)<<BigInt(count-n);
 const script=["$ErrorActionPreference = 'Stop'",`$ids = @(${rootPid}); $all = @(Get-CimInstance Win32_Process -Property ProcessId,ParentProcessId)`,'do { $n = $ids.Count; $ids = @($ids + @($all | Where-Object { $ids -contains $_.ParentProcessId -and $ids -notcontains $_.ProcessId } | ForEach-Object { $_.ProcessId })) } while ($ids.Count -gt $n)',`foreach ($i in $ids) { try { $p = Get-Process -Id $i -ErrorAction Stop; $p.PriorityClass = '${prio}'${aff != null ? `; $p.ProcessorAffinity = [IntPtr]${aff}` : ''} } catch { } }`].join('\n');
 const result=await run('powershell.exe',['-NoProfile','-NonInteractive','-Command',script]);
 if(result.code!==0) throw new Error(result.stderr||'Could not apply render protection.');
}
const RUN_KEY='HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run';
const runValue = (r,name) => r.code===0 ? r.stdout.match(new RegExp('^\\s*'+name+'\\s+REG_\\w+\\s+(.+)$','im'))?.[1] || null : null;
const commandHasPath = (command,file) => {
 const slashes = s => String(s||'').replace(/[\\/]+/g,'/').toLowerCase();
 return new RegExp('(?:^|[\\s"])'+slashes(file).replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'(?=$|[\\s"])').test(slashes(command));
};
const ownsStartup = r => ['open.vbs',path.join('server','hub.js'),path.join('scripts','install.mjs')].some(file=>commandHasPath(runValue(r,'VideoHub'),path.join(HUB_DIR,file)));
async function getAutostart() {return ownsStartup(await run('reg',['query',RUN_KEY,'/v','VideoHub']));}
async function setAutostart(on) {
 const current=await run('reg',['query',RUN_KEY,'/v','VideoHub']);
 if(current.code===0&&!ownsStartup(current)) throw new Error('Autostart belongs to another install; left unchanged.');
 if(!on&&current.code!==0) return;
 const r=await run('reg',on?['add',RUN_KEY,'/v','VideoHub','/t','REG_SZ','/d',`"${TOOLS.node}" "${path.join(HUB_DIR,'scripts','install.mjs')}" open --server`,'/f']:['delete',RUN_KEY,'/v','VideoHub','/f']);
 if(r.code!==0) throw new Error('Could not change login startup: '+(r.stderr||'registry operation failed'));
 return r;
}
async function cleanupLegacyAutostart() {
 const value=runValue(await run('reg',['query',RUN_KEY,'/v','RenderGuard']),'RenderGuard');
 if(['VideoHubAgent.exe','RenderGuard.exe'].some(name=>commandHasPath(value,path.join(HUB_DIR,'guard',name)))) return run('reg',['delete',RUN_KEY,'/v','RenderGuard','/f']);
}
const shellCommand=cmd=>({file:'cmd.exe',args:['/d','/s','/c','"'+cmd+'"'],opts:{windowsVerbatimArguments:true}});
const renderSpawnOptions={windowsHide:true};
function gpuNames() {
  return new Promise(resolve => {
    let out = '', c;
    try { c = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', '(Get-CimInstance Win32_VideoController).Name'], { windowsHide: true }); } catch { return resolve([]); }
    const t = setTimeout(() => { try { c.kill(); } catch { } resolve([]); }, 15000);
    c.stdout.on('data', d => out += d); c.on('error', () => { clearTimeout(t); resolve([]); });
    c.on('close', () => { clearTimeout(t); resolve(out.split(/\r?\n/).map(s => s.trim()).filter(s => s && !/virtual|basic display|remote|mirror|parsec|idd/i.test(s))); });
  });
}


const capabilities = () => ({ platform: OS, cpuAffinity: true, cpuLimitReason: null, trashLabel: 'Recycle Bin', fileManager: 'Explorer' });
const casePath = value => String(value).toLowerCase(), pathKey = value => casePath(path.resolve(value)), availableMemory = () => os.freemem();
return {casePath,capabilities,pathKey,availableMemory,OS,IS_WIN,IS_MAC,IS_LINUX,dirs,TOOLS,findTool,findBrowser,openUrlWindow,fileOpenPlan,reveal,openPath,pickFolder,trash,recycleStream,volumes,notify,processList,killTree,setTreePriority,getAutostart,setAutostart,cleanupLegacyAutostart,shellCommand,renderSpawnOptions,gpuNames};
}
export const {casePath,desktopEntry,capabilities,pathKey,availableMemory,OS,IS_WIN,IS_MAC,IS_LINUX,dirs,TOOLS,findTool,findBrowser,openUrlWindow,fileOpenPlan,reveal,openPath,pickFolder,trash,recycleStream,volumes,notify,processList,killTree,setTreePriority,getAutostart,setAutostart,cleanupLegacyAutostart,shellCommand,renderSpawnOptions,gpuNames}=createPlatform();

// Unix integration shares the public Windows contract; only this module selects OS behavior.
function createUnixPlatform({ osName: OS, env, home, temp, fs, os, path, spawn, run, runSync, hubDir, kill, delay, uid, now }) {
  const IS_WIN = false, IS_MAC = OS === 'darwin', IS_LINUX = OS === 'linux';
  const exists = f => { try { return fs.existsSync(f); } catch { return false; } };
  // Login services omit shell setup; include Homebrew's standard locations for the documented macOS install.
  const toolDirs = [...new Set((env.PATH || '').split(':').filter(Boolean).concat(IS_MAC ? ['/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin', '/usr/sbin', '/sbin'] : []))];
  function findTool(name) {
    for (const d of toolDirs) {
      const f = path.resolve(d, name);
      try { if (!fs.statSync(f).isFile()) continue; fs.accessSync(f, fs.constants?.X_OK ?? 1); return f; } catch { }
    }
    return null;
  }
  function userDir(kind) { if (!IS_MAC) try { const tool = findTool('xdg-user-dir'); if (tool) { const s = String(runSync(tool, [kind], { encoding: 'utf8', timeout: 3000 })).trim(); if (path.isAbsolute(s)) return s; } } catch { } return path.join(home, kind === 'DESKTOP' ? 'Desktop' : 'Documents'); }
  const dirs = { home, desktop: userDir('DESKTOP'), documents: userDir('DOCUMENTS'), config: IS_MAC ? path.join(home, 'Library', 'Application Support', 'VideoHub') : path.join(env.XDG_CONFIG_HOME || path.join(home, '.config'), 'videohub'), temp };
  dirs.guard = dirs.config;
  function nativeExecutable(file) {
    try {
      if (!file || !path.isAbsolute(file) || !fs.statSync(file).isFile()) return false;
      fs.accessSync(file, fs.constants?.X_OK ?? 1);
      const real = fs.realpathSync(file);
      if ([file, real].some(f => /\/(?:snap|flatpak)(?:\/|$)/.test(f))) return false;
      if (fs.statSync(real).size < 65536 && /\bsnap\s+(?:run|exec)\b|\/snap\/|\bflatpak\s+run\b/.test(String(fs.readFileSync(real, 'utf8')))) return false;
      return true;
    } catch { return false; }
  }
  const nativeBrowser = names => names.map(findTool).find(nativeExecutable) || null;
  function findBrowser() {
    const app = name => ['/Applications', path.join(home, 'Applications')].map(dir => path.join(dir, name + '.app', 'Contents', 'MacOS', name)).find(nativeExecutable) || null;
    const edge = IS_MAC ? app('Microsoft Edge') : nativeBrowser(['microsoft-edge', 'microsoft-edge-stable']), chrome = IS_MAC ? app('Google Chrome') : nativeBrowser(['google-chrome', 'google-chrome-stable']), chromium = IS_MAC ? app('Chromium') : nativeBrowser(['chromium', 'chromium-browser']);
    const override = env.VIDEOHUB_BROWSER;
    return { edge, chrome, chromium, path: nativeExecutable(override) ? override : edge || chrome || chromium };
  }
  const browser = findBrowser();
  const TOOLS = { ffmpeg: findTool('ffmpeg') || 'ffmpeg', ffprobe: findTool('ffprobe') || 'ffprobe', node: process.execPath, ...browser };
  function launch(file, args) {
    if (env.VIDEOHUB_NO_WINDOW) return Promise.resolve();
    return new Promise((resolve, reject) => { try { const c = spawn(file, args, { detached: true, stdio: 'ignore' }); c.once('error', reject); c.once('spawn', () => { c.unref(); resolve(); }); } catch (e) { reject(e); } });
  }
  function fileOpenPlan(target, { select = false } = {}) { return IS_MAC ? { command: 'open', args: [...(select ? ['-R'] : []), target] } : { command: 'xdg-open', args: [select ? path.dirname(target) : target] }; }
  const openPath = target => launch(IS_MAC ? 'open' : 'xdg-open', [target]);
  async function reveal(target, { select = false } = {}) {
    if (env.VIDEOHUB_NO_WINDOW) return;
    if (!IS_MAC && select && findTool('gdbus')) {
      const uri = 'file://' + target.split('/').map(encodeURIComponent).join('/');
      const r = await run('gdbus', ['call', '--session', '--dest', 'org.freedesktop.FileManager1', '--object-path', '/org/freedesktop/FileManager1', '--method', 'org.freedesktop.FileManager1.ShowItems', JSON.stringify([uri]), '']);
      if (r.code === 0) return;
    }
    const p = fileOpenPlan(target, { select }); return launch(p.command, p.args);
  }
  const openUrlWindow = url => {
    const b = findBrowser().path; if (!b) return openPath(url);
    const appEnd = b.indexOf('.app/');
    return IS_MAC && appEnd >= 0 ? launch('open', ['-na', b.slice(0, appEnd + 4), '--args', '--app=' + url]) : launch(b, ['--app=' + url]);
  };
  async function pickFolder({ title = 'Choose folder', start = '' } = {}) {
    if (IS_MAC) {
      if (env.VIDEOHUB_NO_WINDOW) return null;
      let initial = home; try { if (start && fs.statSync(start).isDirectory()) initial = start; } catch { }
      const script = 'on run argv\nreturn POSIX path of (choose folder with prompt (item 1 of argv) default location (POSIX file (item 2 of argv)))\nend run';
      const r = await run('osascript', ['-e', script, '--', String(title), initial]);
      return r.code === 0 ? r.stdout.replace(/\r?\n$/, '') || null : null;
    }
    const zenity = findTool('zenity'), kdialog = findTool('kdialog');
    if (!zenity && !kdialog) return { unsupported: true };
    if (env.VIDEOHUB_NO_WINDOW) return null;
    const r = zenity ? await run(zenity, ['--file-selection', '--directory', '--title=' + title, ...(start ? ['--filename=' + start.replace(/\/$/, '') + '/'] : [])]) : await run(kdialog, ['--getexistingdirectory', start || home, '--title', title]);
    return r.code === 0 ? r.stdout.replace(/\r?\n$/, '') || null : null;
  }
  async function volumes() {
    const r = await run('df', ['-kP']); if (r.code !== 0) return [];
    return r.stdout.split(/\r?\n/).slice(1).flatMap(line => { const m = line.match(/^\S+\s+(\d+)\s+\d+\s+(\d+)\s+\S+\s+(.+)$/); return m ? [{ mount: m[3].replace(/\\([0-7]{3})/g, (_, n) => String.fromCharCode(parseInt(n, 8))), freeBytes: +m[2] * 1024, totalBytes: +m[1] * 1024 }] : []; });
  }
  const encodePath = p => p.split('/').map(encodeURIComponent).join('/');
  async function trashOne(source) {
    const target = path.resolve(source);
    if (target === path.parse(target).root || target === home) throw new Error('Refusing to trash a filesystem root or home folder.');
    if (IS_MAC) {
      // Passing data as argv avoids AppleScript quoting and command-injection hazards for unusual filenames.
      const script = 'on run argv\ntell application "Finder" to delete (POSIX file (item 1 of argv))\nend run';
      const r = await run('osascript', ['-e', script, '--', target]);
      if (r.code !== 0) throw new Error('Could not move to Trash. Allow Finder Automation permission and try again. ' + (r.stderr || '').trim().slice(0, 200));
      return;
    }
    for (const [name, args] of [['gio', ['trash', '--', target]], ['trash-put', ['--', target]]]) {
      const tool = findTool(name); if (!tool) continue;
      const r = await run(tool, args); if (r.code === 0) return;
      if (!exists(target)) return;
    }
    // A rename is reversible and atomic on one filesystem. Never copy/unlink across devices.
    const parent = fs.statSync(path.dirname(target)), homeStat = fs.statSync(home);
    let root, infoPath = target;
    if (parent.dev === homeStat.dev) root = path.join(env.XDG_DATA_HOME || path.join(home, '.local', 'share'), 'Trash');
    else {
      const mounts = (await volumes()).filter(v => target.startsWith(v.mount.replace(/\/$/, '') + '/')).sort((a, b) => b.mount.length - a.mount.length);
      if (!mounts.length || uid() == null) throw new Error('Trash is unavailable on this filesystem; the item was left untouched.');
      root = path.join(mounts[0].mount, '.Trash-' + uid());
      infoPath = path.relative(mounts[0].mount, target);
    }
    const files = path.join(root, 'files'), info = path.join(root, 'info');
    for (const dir of [root, files, info]) {
      fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
      const st = fs.lstatSync(dir); if (!st.isDirectory() || st.isSymbolicLink() || (uid() != null && st.uid != null && st.uid !== uid()) || (st.mode != null && (st.mode & 0o077))) throw new Error('Trash folder is unsafe; the item was left untouched.');
    }
    if (fs.statSync(files).dev !== parent.dev) throw new Error('Trash is on another filesystem; the item was left untouched.');
    const date = new Date(), pad = n => String(n).padStart(2, '0'), deleted = `${date.getFullYear()}-${pad(date.getMonth()+1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
    const base = path.basename(target);
    for (let i = 0; i < 10000; i++) {
      const name = base + (i ? '.' + i : ''), dest = path.join(files, name), metadata = path.join(info, name + '.trashinfo');
      if (exists(dest)) continue;
      try { fs.writeFileSync(metadata, `[Trash Info]\nPath=${encodePath(infoPath)}\nDeletionDate=${deleted}\n`, { flag: 'wx', mode: 0o600 }); } catch (e) { if (e.code === 'EEXIST') continue; throw e; }
      try { fs.renameSync(target, dest); return; } catch (e) { try { fs.unlinkSync(metadata); } catch { } throw e; }
    }
    throw new Error('No free Trash entry; the item was left untouched.');
  }
  async function trash(paths) {
    const out = [];
    for (const item of paths) { const target = typeof item === 'string' ? item : item.path; try { await trashOne(target); out.push({ path: target, ok: true, error: null }); } catch (e) { out.push({ path: target, ok: false, error: e.message }); } }
    return out;
  }
  async function recycleStream(items, onItem) { for (const item of items) { const [r] = await trash([item]); onItem(item, r.ok ? 0 : -3, r.error); } }
  function notify(title, body) {
    if (env.VIDEOHUB_NO_WINDOW) return;
    const tool = IS_MAC ? 'osascript' : findTool('notify-send'); if (!tool) return;
    const args = IS_MAC ? ['-e', 'on run argv\ndisplay notification (item 2 of argv) with title (item 1 of argv)\nend run', '--', String(title), String(body)] : [String(title), String(body)];
    try { Promise.resolve(run(tool, args)).catch(() => {}); } catch { }
  }
  async function psList() {
      // Both fields may contain spaces. Query separately, with full width and a start identity to reject PID reuse.
      const flag = IS_MAC ? '-axo' : '-eo';
      const [table, commands] = await Promise.all([run('ps', ['-ww', flag, 'pid=,ppid=,rss=,lstart=,comm=']), run('ps', ['-ww', flag, 'pid=,args='])]);
      if (table.code !== 0) return null;
      const args = new Map(commands.code === 0 ? commands.stdout.split(/\r?\n/).flatMap(line => { const m = line.match(/^\s*(\d+)\s+(.*)$/); return m ? [[+m[1], m[2]]] : []; }) : []);
      return table.stdout.split(/\r?\n/).flatMap(line => {
        const m = line.match(/^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\S+\s+\S+\s+\d+\s+\S+\s+\d+)\s+(.+)$/);
        return m ? [{ pid: +m[1], ppid: +m[2], rssBytes: +m[3]*1024, name: path.basename(m[5]), cmd: args.get(+m[1]) || '', start: m[4].replace(/\s+/g, ' ') }] : [];
      });
  }
  async function processList() {
    if (IS_MAC) return psList();
    try {
      const entries = fs.readdirSync('/proc').filter(n => /^\d+$/.test(n)), rows = [];
      for (const pid of entries) { try {
        const stat = String(fs.readFileSync('/proc/' + pid + '/stat', 'utf8')), end = stat.lastIndexOf(')'), name = stat.slice(stat.indexOf('(') + 1, end), parts = stat.slice(end + 2).trim().split(/\s+/);
        const status = String(fs.readFileSync('/proc/' + pid + '/status', 'utf8')), cmd = String(fs.readFileSync('/proc/' + pid + '/cmdline', 'utf8')).replace(/\0/g, ' ').trim();
        rows.push({ pid: +pid, ppid: +parts[1], name, cmd, rssBytes: +(status.match(/^VmRSS:\s+(\d+)/m)?.[1] || 0)*1024, start: parts[19] });
      } catch { } }
      return rows;
    } catch { return psList(); }
  }
  function tree(rows, root) { const ids = new Set([root]); let n; do { n = ids.size; for (const p of rows || []) if (ids.has(p.ppid)) ids.add(p.pid); } while (ids.size > n); return [...ids]; }
  async function killTree(pid) {
    pid = +pid; if (!Number.isSafeInteger(pid) || pid <= 1 || pid === process.pid) return;
    const before = await processList(), ids = tree(before, pid), starts = new Map((before || []).map(p => [p.pid, p.start]));
    try { kill(-pid, 'SIGTERM'); } catch { }
    for (const id of ids.reverse()) try { kill(id, 'SIGTERM'); } catch { }
    await delay(3000);
    const after = await processList();
    const same = id => starts.get(id) != null && after?.some(p => p.pid === id && p.start === starts.get(id));
    const surviving = ids.filter(same), root = after?.find(p => p.pid === pid);
    if (surviving.length && (!root || same(pid))) try { kill(-pid, 'SIGKILL'); } catch { }
    for (const id of surviving) try { kill(id, 'SIGKILL'); } catch { }
  }
  const affinity = new Map();
  async function setTreePriority(rootPid, level, cores) {
    const rows = await processList(), ids = tree(rows, +rootPid), taskset = IS_MAC ? null : findTool('taskset');
    const start = rows?.find(p => p.pid === +rootPid)?.start, cached = affinity.get(rootPid);
    let original = start != null && cached?.start === start ? cached.mask : null, failure = rows == null ? 'Could not read the render process tree.' : null;
    if (taskset && original == null) {
      const r = await run(taskset, ['-p', String(rootPid)]), h = r.stdout.match(/mask:\s*([0-9a-f,]+)/i)?.[1]?.replaceAll(',', '');
      if (r.code === 0 && h) { original = BigInt('0x'+h); if (start != null) affinity.set(rootPid, { start, mask: original }); }
      else failure = r.stderr || 'Could not read render CPU affinity.';
    }
    let mask = original;
    if (mask != null && cores != null) { let selected = 0n, count = 0; for (let i = mask.toString(2).length - 1; i >= 0 && count < cores; i--) if (mask & (1n << BigInt(i))) { selected |= 1n << BigInt(i); count++; } mask = selected || original; }
    for (const pid of ids) {
      try { os.setPriority(pid, { normal: 0, low: 10, idle: 19 }[level] ?? 0); } catch { }
      if (IS_MAC) { const r = await run('taskpolicy', [level === 'idle' ? '-b' : '-B', '-p', String(pid)]); if (r.code !== 0) failure ||= r.stderr || 'Could not apply render background QoS.'; }
      if (taskset && mask != null) { const r = await run(taskset, ['-a', '-p', mask.toString(16), String(pid)]); if (r.code !== 0) failure ||= r.stderr || 'Could not apply render CPU affinity.'; }
    }
    if (failure) throw new Error(failure);
    return { cpuAffinity: !!taskset, priority: true };
  }
  const startupFile = IS_MAC ? path.join(home, 'Library', 'LaunchAgents', 'com.videohub.hub.plist') : path.join(env.XDG_CONFIG_HOME || path.join(home, '.config'), 'autostart', 'videohub.desktop');
  const desktopQuote = s => '"' + String(s).replace(/[%]/g, '%%').replace(/[\\"$`]/g, '\\$&') + '"';
  const desktopEntry = (server = false) => `[Desktop Entry]\nType=Application\nName=VideoHub\nComment=Local video review studio\nExec=${desktopQuote(process.execPath)} ${desktopQuote(path.join(hubDir,'scripts','install.mjs'))} open${server ? ' --server' : ''}\nIcon=${path.join(hubDir,'ui','icon.svg')}\nTerminal=false\nCategories=AudioVideo;Video;\nX-VideoHub-Install=${hubDir}\n`;
  const xml = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
  const launchAgent = () => `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0"><dict>\n<key>Label</key><string>com.videohub.hub</string>\n<key>ProgramArguments</key><array><string>${xml(TOOLS.node)}</string><string>${xml(path.join(hubDir,'server','hub.js'))}</string></array>\n<key>WorkingDirectory</key><string>${xml(hubDir)}</string>\n<key>EnvironmentVariables</key><dict><key>PATH</key><string>${xml(toolDirs.join(':'))}</string></dict>\n<key>RunAtLoad</key><true/>\n<key>VideoHubInstall</key><string>${xml(hubDir)}</string>\n</dict></plist>\n`;
  const ownsStartup = () => { try { const data = String(fs.readFileSync(startupFile, 'utf8')); return IS_MAC ? data.includes('<key>VideoHubInstall</key><string>' + xml(hubDir) + '</string>') : data.includes('X-VideoHub-Install=' + hubDir + '\n'); } catch { return false; } };
  const launchDomain = () => { const id = uid(); if (id == null) throw new Error('The login user is unavailable; autostart was left unchanged.'); return 'gui/' + id; };
  const getAutostart = async () => {
    if (!ownsStartup()) return false;
    if (!IS_MAC) return true;
    try { return (await run('launchctl', ['print', launchDomain() + '/com.videohub.hub'])).code === 0; } catch { return false; }
  };
  async function setAutostart(on) {
    if (exists(startupFile) && !ownsStartup()) throw new Error('Autostart belongs to another install; left unchanged.');
    if (IS_MAC) {
      const domain = launchDomain();
      if (on) {
        if (await getAutostart()) return;
        fs.mkdirSync(path.dirname(startupFile), { recursive: true }); fs.writeFileSync(startupFile, launchAgent());
        const r = await run('launchctl', ['bootstrap', domain, startupFile]); if (r.code !== 0) throw new Error('Could not enable login startup: ' + (r.stderr || 'launchctl bootstrap failed'));
      } else if (ownsStartup()) {
        if (await getAutostart()) { const r = await run('launchctl', ['bootout', domain, startupFile]); if (r.code !== 0) throw new Error('Could not disable login startup: ' + (r.stderr || 'launchctl bootout failed')); }
        const [r] = await trash([startupFile]); if (!r.ok) throw new Error(r.error);
      }
      return;
    }
    if (on) { fs.mkdirSync(path.dirname(startupFile), { recursive: true }); fs.writeFileSync(startupFile, desktopEntry(true)); }
    else if (ownsStartup()) { const [r] = await trash([startupFile]); if (!r.ok) throw new Error(r.error); }
  }
  const cleanupLegacyAutostart = async () => {};
  const shellCommand = cmd => ({ file: '/bin/sh', args: ['-c', cmd], opts: {} });
  const renderSpawnOptions = { detached: true };
  async function gpuNames() { if (IS_MAC) return []; const tool = findTool('lspci'); if (!tool) return []; const r = await run(tool, []); return r.code === 0 ? r.stdout.split(/\r?\n/).filter(s => /VGA|3D controller|Display controller/i.test(s)) : []; }
  const capabilities = () => ({ platform: OS, cpuAffinity: !IS_MAC && !!findTool('taskset'), cpuLimitReason: IS_MAC ? 'macOS does not provide a CPU-core affinity limit; priority and background QoS protect responsiveness.' : findTool('taskset') ? null : 'CPU limit not available on this system (taskset is missing).', trashLabel: 'Trash', fileManager: IS_MAC ? 'Finder' : 'file manager', browserWarning: IS_MAC ? null : 'Snap and Flatpak browsers are not supported for rendering; install a native Chrome or Chromium package.' });
  const casePath = value => String(value), pathKey = value => path.resolve(value);
  let memoryCache = null;
  function availableMemory() {
    if (IS_LINUX) try { const kb = String(fs.readFileSync('/proc/meminfo', 'utf8')).match(/^MemAvailable:\s+(\d+)\s+kB\b/m)?.[1]; if (kb != null) return +kb * 1024; } catch { }
    if (!IS_MAC) return os.freemem();
    if (memoryCache && now() - memoryCache.at < 3000) return memoryCache.bytes;
    let bytes = os.freemem();
    try {
      const text = String(runSync('vm_stat', [], { encoding: 'utf8', timeout: 3000 })), pageSize = +(text.match(/page size of (\d+) bytes/)?.[1] || 0);
      const counts = ['free', 'inactive', 'speculative'].map(name => text.match(new RegExp('^Pages ' + name + ':\\s+(\\d+)', 'm'))?.[1]);
      if (pageSize > 0 && counts.every(n => n != null)) bytes = Math.min(os.totalmem(), pageSize * counts.reduce((a, b) => a + +b, 0));
    } catch { }
    memoryCache = { at: now(), bytes }; return bytes;
  }
  return { OS, IS_WIN, IS_MAC, IS_LINUX, dirs, TOOLS, findTool, findBrowser, openUrlWindow, fileOpenPlan, reveal, openPath, pickFolder, trash, recycleStream, volumes, notify, processList, killTree, setTreePriority, getAutostart, setAutostart, cleanupLegacyAutostart, shellCommand, renderSpawnOptions, gpuNames, capabilities, casePath, pathKey, availableMemory, desktopEntry };
}
