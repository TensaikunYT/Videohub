// Thin shell entry points share their decisions here; runtime helpers never install OS packages silently.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';
import { createInterface } from 'node:readline/promises';
import * as platformDefault from '../server/platform.js';
import { initConfig, state, checkWorkspace } from './init-config.mjs';
import { detectEncoders } from '../server/encoders.js';
import { detectAgents, integrateAgents } from './agents.mjs';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BOOLS = new Set(['watch-found', 'gpu-encoder', 'global-rule', 'shortcut', 'startup', 'example']);
export function parseOptions(args) {
  const out = { action: args.shift() || 'setup' };
  if (!['setup', 'update', 'uninstall', 'open', 'stop', 'validate-update', 'autostart', 'retire-legacy'].includes(out.action)) throw new Error('Unknown lifecycle action: ' + out.action);
  for (let i = 0; i < args.length; i++) {
    const k = args[i].replace(/^--/, '');
    if (['dry-run', 'yes', 'server', 'help', 'launchers'].includes(k)) out[k] = true;
    else if (BOOLS.has(k) || ['workspace', 'agents', 'target', 'source'].includes(k)) { const v = args[++i]; if (!v || v.startsWith('--')) throw new Error('Missing value for --' + k); if (BOOLS.has(k) && !['ask', 'yes', 'no'].includes(v)) throw new Error('--' + k + ' must be ask, yes, or no'); out[k] = v; }
    else throw new Error('Unknown option: ' + args[i]);
  }
  return out;
}
const read = (f, fallback = null) => { try { return JSON.parse(fs.readFileSync(f, 'utf8').replace(/^\uFEFF/, '')); } catch { return fallback; } };
const stat = f => { try { return fs.lstatSync(f); } catch (e) { if (e.code === 'ENOENT') return null; throw e; } };
const skipCode = n => /^(node_modules|render|\.videohub|out)$/i.test(n);
function checkCopy(from, to) {
  const src = stat(from), dst = stat(to); if (!src || src.isSymbolicLink()) return;
  if (dst?.isSymbolicLink()) throw new Error('Update target contains a symbolic link: ' + to);
  if (dst && src.isDirectory() !== dst.isDirectory()) throw new Error('Update source and target have different file types: ' + to);
  if (src.isDirectory()) for (const e of fs.readdirSync(from, { withFileTypes: true })) if (!skipCode(e.name)) checkCopy(path.join(from, e.name), path.join(to, e.name));
}
function write(f, text, mode) { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, text, mode ? { mode } : undefined); if (mode) fs.chmodSync(f, mode); }
function copyTree(from, to, { exclusive = false, skip = () => false } = {}) {
  if (stat(to)?.isSymbolicLink()) throw new Error('Refusing to write through a symbolic link: ' + to);
  fs.mkdirSync(to, { recursive: true });
  for (const e of fs.readdirSync(from, { withFileTypes: true })) {
    if (skip(e.name)) continue;
    const src = path.join(from, e.name), dst = path.join(to, e.name);
    if (e.isSymbolicLink()) continue; // An update must not follow a link out of the supplied code tree.
    if (e.isDirectory()) copyTree(src, dst, { exclusive, skip });
    else if (e.isFile()) { if (stat(dst)?.isSymbolicLink()) throw new Error('Refusing to replace a symbolic link: ' + dst); fs.copyFileSync(src, dst, exclusive ? fs.constants.COPYFILE_EXCL : 0); fs.chmodSync(dst, fs.statSync(src).mode); }
  }
}
const ITEMS = ['server', 'ui', 'templates', 'skill', 'claude', 'examples', 'engine-hooks', 'docs', 'scripts', 'CLAUDE.md', 'AGENTS.md', 'README.md', 'LICENSE', 'SETUP.cmd', 'UPDATE.cmd', 'update.ps1', 'setup.ps1', 'uninstall.ps1', 'open.cmd', 'setup.sh', 'update.sh', 'uninstall.sh', 'open.sh', 'package.json', 'package-lock.json'];
const casePath = (value, platform) => platform.casePath ? platform.casePath(value) : platform.IS_WIN ? String(value).toLowerCase() : String(value);
export function validateUpdatePaths(source, target, { platform = platformDefault, realpath = fs.realpathSync } = {}) {
  const sourceReal = realpath(source), targetReal = realpath(target), src = casePath(sourceReal, platform), dst = casePath(targetReal, platform);
  if (src === dst) return { same: true, source: sourceReal, target: targetReal };
  const rel = path.relative(src, dst), reverse = path.relative(dst, src);
  if ((!rel.startsWith('..' + path.sep) && !path.isAbsolute(rel)) || (!reverse.startsWith('..' + path.sep) && !path.isAbsolute(reverse))) throw new Error('Source and target must be separate folders, not nested');
  return { same: false, source: sourceReal, target: targetReal };
}
function processMatches(p, install, platform) {
  if (!/^node(?:js|\.exe)?$/i.test(path.basename(p.name || ''))) return false;
  const cmd = casePath(String(p.cmd || '').replace(/\\/g, '/'), platform), head = cmd.match(/^(?:"[^"]+"|\S+)\s+/), script = casePath(path.join(install, 'server', 'hub.js').replace(/\\/g, '/'), platform);
  if (!head) return false;
  const args = cmd.slice(head[0].length);
  return args === script || args.startsWith(script + ' ') || args === '"' + script + '"' || args.startsWith('"' + script + '" ');
}
// Windows and Unix lifecycle scripts share the same ownership/queue/termination checks.
export async function stopInstalledHub({ install, platform, port, request, stopPid, delay, dryRun = false, onAction = () => {} }) {
  if (dryRun) { onAction('check the render queue and stop only the server belonging to ' + install); return; }
  const all = await platform.processList(); if (!Array.isArray(all)) throw new Error('Cannot inspect running processes; nothing was stopped');
  const procs = all.filter(p => processMatches(p, install, platform)), base = 'http://127.0.0.1:' + port, ping = await request(base + '/api/ping');
  if (!ping && procs.length) throw new Error('Cannot inspect this running server; nothing was stopped. Close VideoHub and retry.');
  if (ping && ping.app !== 'videohub') throw new Error('The configured port belongs to another program; no server was stopped');
  if (ping && !procs.some(p => p.pid === ping.pid)) throw new Error('The configured port belongs to another process; no server was stopped');
  if (ping) {
    const jobs = await request(base + '/api/jobs'); if (!Array.isArray(jobs)) throw new Error('Cannot inspect the running render queue; nothing changed');
    if (jobs.some(j => ['running', 'queued'].includes(j.state))) throw new Error('Renders are running or queued; run this again when they finish');
    const clean = await request(base + '/api/disk/clean'); if (!clean) throw new Error('Cannot inspect cleanup state; nothing changed'); if (clean.state === 'running') throw new Error('Cleanup is running; run this again when it finishes');
  }
  if (procs.some(p => p.start == null || p.start === '')) throw new Error('Cannot verify server process identity; nothing was stopped');
  for (const p of procs) {
    const current = (await platform.processList())?.find(row => row.pid === p.pid);
    if (!current || current.start !== p.start || !processMatches(current, install, platform)) throw new Error('Server process identity changed; nothing else was stopped');
    onAction('stop this install\'s server (pid ' + p.pid + ')'); stopPid(p.pid);
  }
  if (procs.length) {
    for (let i = 0; i < 20; i++) { await delay(100); const rows = await platform.processList(); if (!Array.isArray(rows)) throw new Error('Cannot verify the server stopped; code was left unchanged'); if (!rows.some(p => processMatches(p, install, platform))) return; }
    throw new Error('VideoHub is still running; code was left unchanged. Close it and retry');
  }
}
// Retired Windows files of an older install: the compiled guard helper (+ its source, build script and backups) and,
// with `launchers`, the old hidden VBScript -> PowerShell launcher, once update.ps1 has re-pointed the shortcut and the
// start-up entry to Node. Everything goes to the Recycle Bin (never a hard delete); nothing old is executed.
export const LEGACY_LAUNCHERS = ['open.vbs', 'open.ps1'];
export function legacyFiles(install, { launchers = false, list = d => { try { return fs.readdirSync(d); } catch { return []; } } } = {}) {
  const guard = path.join(install, 'guard');
  const helpers = [...new Set(['VideoHubAgent.exe', 'RenderGuard.exe', ...list(guard).filter(n => /\.exe$/i.test(n))])].map(n => path.join(guard, n));
  const extras = ['RenderGuard.cs', 'build.ps1', 'tests'].map(n => path.join(guard, n)).concat(launchers ? LEGACY_LAUNCHERS.map(n => path.join(install, n)) : []);
  return { helpers, extras };
}
export async function retireLegacyAgent({ install, platform, stopPid, delay, dryRun = false, launchers = false, onAction = () => {}, exists = fs.existsSync, list }) {
  const { helpers: files, extras } = legacyFiles(install, { launchers, list });
  if (dryRun) { onAction('stop already-running owned legacy helpers and move retired helper' + (launchers ? ' and launcher' : '') + ' files to the Recycle Bin without executing them'); return; }
  const owns = p => {
    if (!/^(VideoHubAgent|RenderGuard)\.exe$/i.test(p.name || '')) return false;
    const first = String(p.cmd || '').match(/^(?:"([^"]+)"|(\S+))/), exe = first && casePath((first[1] || first[2]).replace(/\\/g, '/'), platform);
    return exe && files.some(f => exe === casePath(f.replace(/\\/g, '/'), platform));
  };
  const rows = await platform.processList(); if (!Array.isArray(rows)) throw new Error('Cannot inspect legacy helpers; their files were left unchanged');
  const owned = rows.filter(owns);
  if (owned.some(p => p.start == null || p.start === '' || !Number.isSafeInteger(p.pid) || p.pid <= 1)) throw new Error('Cannot verify legacy helper identity; nothing was stopped');
  for (const p of owned) {
    const current = (await platform.processList())?.find(row => row.pid === p.pid);
    if (!current || current.start !== p.start || !owns(current)) throw new Error('Legacy helper identity changed; nothing else was stopped');
    onAction('stop the already-running legacy helper (pid ' + p.pid + ')'); stopPid(p.pid);
  }
  if (owned.length) for (let i = 0; ; i++) {
    if (i === 20) throw new Error('A legacy helper is still running; its files were left unchanged');
    await delay(100); const after = await platform.processList(); if (!Array.isArray(after)) throw new Error('Cannot verify legacy helpers stopped; their files were left unchanged'); if (!after.some(owns)) break;
  }
  const present = [...files, ...extras].filter(exists);
  if (present.length) { onAction('move retired legacy files to the Recycle Bin: ' + present.map(f => path.relative(install, f)).join(', ')); const result = await platform.trash(present); if (result.some(r => !r.ok) || result.length !== present.length) throw new Error('Some legacy helper files could not be moved to the Recycle Bin; no deletion fallback was used'); }
  await platform.cleanupLegacyAutostart?.();
}
export async function runInstaller(options, { hub = ROOT, platform = platformDefault, env = process.env, log = console.log, ask, run = (f, a, opts) => spawnSync(f, a, { stdio: 'inherit', ...opts }), request = async url => { try { const r = await fetch(url, { signal: AbortSignal.timeout(1500) }); return r.ok ? await r.json() : null; } catch { return null; } }, spawnServer = (f, a, opts) => spawn(f, a, opts), stopPid = pid => process.kill(pid, 'SIGTERM'), delay = ms => new Promise(r => setTimeout(r, ms)), agents = integrateAgents, discover, encoderDetect = detectEncoders, launch = true } = {}) {
  const dry = !!options['dry-run'], quiet = dry || options.yes, home = platform.dirs.home, data = env.VIDEOHUB_DATA_DIR || path.join(hub, 'data');
  const actions = [], warnings = [], say = s => { actions.push((dry ? 'would ' : '') + s); log((dry ? '[dry run] ' : '') + s); };
  const warn = s => { warnings.push(s); log(s); };
  let reader;
  const question = ask || (async prompt => { reader ||= createInterface({ input: process.stdin, output: process.stdout }); return reader.question(prompt); });
  const yesNo = async (key, prompt, recommended, saved = {}) => {
    const value = options[key] && options[key] !== 'ask' ? options[key] : saved[key];
    if (value === 'yes' || value === 'no') return value === 'yes';
    if (quiet) return recommended;
    while (true) { const a = (await question(prompt + (recommended ? ' [Y/n] ' : ' [y/N] '))).trim().toLowerCase(); if (!a) return recommended; if (['y', 'yes'].includes(a)) return true; if (['n', 'no'].includes(a)) return false; }
  };
  const markerFile = path.join(platform.dirs.config, 'install.json');
  const entryFile = path.join(env.XDG_DATA_HOME || path.join(home, '.local', 'share'), 'applications', 'videohub.desktop');
  const desktopFile = path.join(platform.dirs.desktop, platform.IS_MAC ? 'VideoHub.command' : 'VideoHub.desktop');
  const shellQuote = s => "'" + String(s).replaceAll("'", "'\\''") + "'";
  const owned = (f, install) => { try { return fs.readFileSync(f, 'utf8').includes('# VideoHub install: ' + install + '\n'); } catch { return false; } };
  const packageInstall = (install, force = false) => {
    if (!force && fs.existsSync(path.join(install, 'node_modules', '@modelcontextprotocol', 'sdk', 'package.json')) && fs.existsSync(path.join(install, 'node_modules', 'puppeteer-core', 'package.json'))) { say('keep installed Node packages'); return; }
    say('install Node packages with npm ci');
    if (!dry) { const r = run('npm', ['ci', '--no-audit', '--no-fund'], { cwd: install, env }); if (r.status !== 0) throw new Error('npm ci failed; install Node dependencies before continuing'); }
  };
  const settings = install => {
    const f = path.join(env.VIDEOHUB_DATA_DIR || path.join(install, 'data'), 'config.json'); if (!fs.existsSync(f)) return {};
    try { const j = JSON.parse(fs.readFileSync(f, 'utf8').replace(/^\uFEFF/, '')); if (!j || typeof j !== 'object' || Array.isArray(j)) throw new Error('expected an object'); return j; }
    catch (e) { throw new Error('Cannot read ' + f + '; nothing changed (' + e.message + ')'); }
  };
  const portOf = install => { const cfg = settings(install), n = +(env.VIDEOHUB_PORT || cfg.port || 7788); if (!Number.isInteger(n) || n < 1 || n > 65535) throw new Error('Invalid local VideoHub port'); return n; };
  const stopInstall = install => stopInstalledHub({ install, platform, port: portOf(install), request, stopPid, delay, dryRun: dry, onAction: say });
  const open = async install => {
    const base = 'http://127.0.0.1:' + portOf(install);
    if (dry) { say('start the local hub if needed' + (options.server ? ' (server only)' : ' and open its browser window')); return; }
    let ping = await request(base + '/api/ping');
    if (ping && ping.app !== 'videohub') throw new Error('Another program is using the VideoHub port');
    if (ping) { const procs = await platform.processList(); if (!Array.isArray(procs)) throw new Error('Cannot verify which VideoHub install is using this port'); if (!procs.some(p => p.pid === ping.pid && processMatches(p, install, platform))) throw new Error('Another VideoHub install is using this port'); }
    if (!ping) {
      const c = spawnServer(process.execPath, [path.join(install, 'server', 'hub.js')], { cwd: install, detached: true, stdio: 'ignore', env, ...(platform.IS_WIN ? { windowsHide: true } : {}) });
      let spawnError; c.on('error', e => { spawnError = e; }); c.unref();
      for (let i = 0; i < 40 && !ping && !spawnError; i++) { await delay(250); ping = await request(base + '/api/ping'); }
      if (!ping) throw new Error('VideoHub did not start: ' + (spawnError?.message || 'check Node.js and data/config.json'));
      if (ping.app !== 'videohub' || ping.pid !== c.pid) throw new Error('Another program acquired the VideoHub port; no window was opened');
    }
    if (!options.server) await platform.openUrlWindow(base);
    say('VideoHub is available at ' + base);
  };
  try {
    if (options.help) { log('Usage: ./setup.sh [--dry-run] [--yes] [--workspace PATH] [--agents claude,opencode] [--watch-found yes|no] [--gpu-encoder yes|no] [--global-rule yes|no] [--shortcut yes|no] [--startup yes|no] [--example yes|no]\n./update.sh [--target PATH] [--dry-run]\n./uninstall.sh [--dry-run]\n./open.sh [--server]'); return { actions, warnings }; }
    if (options.action === 'validate-update') { const result = validateUpdatePaths(options.source || hub, options.target || hub, { platform }); if (result.same) throw new Error('Source and target refer to the same folder; nothing to update'); say('source and target are separate folders'); return { actions, warnings }; }
    if (options.action === 'stop') { await stopInstall(path.resolve(options.target || hub)); return { actions, warnings }; }
    if (options.action === 'autostart') {
      if (options.startup === 'ask') throw new Error('Choose --startup yes or no explicitly');
      if (options.startup && !dry) await platform.setAutostart(options.startup === 'yes');
      const result = { enabled: await platform.getAutostart(), ...(dry && options.startup ? { wouldSet: options.startup === 'yes' } : {}) }; log(JSON.stringify(result)); return result;
    }
    if (options.action === 'retire-legacy') { await retireLegacyAgent({ install: path.resolve(options.target || hub), platform, stopPid, delay, dryRun: dry, launchers: !!options.launchers, onAction: say }); return { actions, warnings }; }
    if (options.action === 'open') { await open(hub); return { actions, warnings }; }
    if (platform.IS_WIN) throw new Error('On Windows use SETUP.cmd, UPDATE.cmd, uninstall.ps1, or open.cmd');
    if (options.action === 'setup') {
      if (+process.versions.node.split('.')[0] < 22) throw new Error('Node.js 22 or newer is required');
      const ffmpeg = platform.findTool('ffmpeg'), browser = platform.findBrowser().path;
      if (!ffmpeg) warn(platform.IS_MAC ? 'ffmpeg is missing. With Homebrew, run: brew install node ffmpeg.' : 'ffmpeg is missing. Install it using your distribution: sudo apt install ffmpeg; sudo dnf install ffmpeg; or sudo pacman -S ffmpeg.');
      if (!browser) warn(platform.IS_MAC ? 'Install Google Chrome from google.com/chrome or use: brew install --cask google-chrome.' : 'Install a native Chrome or Chromium package. Flatpak and Snap browsers cannot be driven reliably for renders.');
      const st = state({ dataDir: data, ...(discover ? { discover } : {}) }); if (st.error) throw new Error(st.error);
      packageInstall(hub);
      const answersFile = path.join(data, 'setup-answers.json'), saved = read(answersFile, {}), answers = { ...saved };
      let chosen = options.agents ? options.agents.split(',').map(s => s.trim()).filter(Boolean) : saved.agents;
      if (!chosen?.length) {
        const found = detectAgents({ home, env });
        if (found.length === 1 || quiet) chosen = found.length ? found : ['claude'];
        else { const a = (await question('Which agents? claude, opencode, or claude,opencode [' + (found.join(',') || 'claude') + '] ')).trim(); chosen = (a || found.join(',') || 'claude').split(',').map(s => s.trim()); }
      }
      if (chosen.some(a => !['claude', 'opencode'].includes(a))) throw new Error('--agents must contain claude and/or opencode'); answers.agents = chosen;
      let workspace = st.workspace || options.workspace;
      if (!workspace && !quiet) workspace = (await question('Where should your video work live? [' + st.defaultWorkspace + '] ')).trim();
      workspace ||= st.defaultWorkspace;
      if (!st.installed) { const why = checkWorkspace(workspace, hub); if (why) throw new Error(why); }
      if (!st.installed && st.discovered.length) for (const r of st.discovered) log('Found video folder: ' + r.path);
      const watch = !st.installed && st.discovered.length && await yesNo('watch-found', 'Also watch these video folders?', false, saved) ? st.discovered.map(r => r.path) : [];
      if (!st.installed) answers['watch-found'] = watch.length ? 'yes' : 'no';
      let encoder = st.encoder;
      if (!encoder) {
        const det = ffmpeg ? await encoderDetect({ ffmpeg, cacheFile: dry ? null : path.join(data, 'encoders.json'), ...(dry ? { dryRun: true } : {}) }) : { available: [] };
        const useGpu = options['gpu-encoder'] === 'no' || (options['gpu-encoder'] == null && saved['gpu-encoder'] === 'no') ? false : det.available.some(e => e !== 'x264') ? await yesNo('gpu-encoder', 'Use the graphics card for renders?', true, saved) : true;
        encoder = useGpu ? 'auto' : 'x264'; answers['gpu-encoder'] = useGpu ? 'yes' : 'no';
      }
      const result = initConfig({ dataDir: data, hubDir: hub, workspace, watch, encoder, dryRun: dry, ...(discover ? { discover } : {}) }); for (const s of result.actions) say(s.replace(/^would /, ''));
      const rule = await yesNo('global-rule', 'Review each new film in VideoHub before rendering?', true, saved); answers['global-rule'] = rule ? 'yes' : 'no';
      const integration = await agents({ agents: chosen, hub, home, env, globalRule: rule, dryRun: dry }); for (const s of integration.actions) log(s); for (const e of integration.errors) warn(e);
      if (!dry && !st.installed) { const f = path.join(data, 'config.json'), cfg = read(f, {}); cfg.agentName = integration.agentName; write(f, JSON.stringify(cfg, null, 1) + '\n'); }
      const makeShortcut = await yesNo('shortcut', 'Add a Desktop shortcut?', true, saved); answers.shortcut = makeShortcut ? 'yes' : 'no';
      if (/[\r\n]/.test(hub)) throw new Error('Move this VideoHub install to a path without line breaks before creating launchers');
      const entry = platform.IS_MAC ? '#!/bin/bash\n# VideoHub install: ' + hub + '\nset -euo pipefail\nexport PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"\nexec ' + shellQuote(process.execPath) + ' ' + shellQuote(path.join(hub, 'scripts', 'install.mjs')) + ' open "$@"\n' : '# VideoHub install: ' + hub + '\n' + platform.desktopEntry(false);
      for (const f of [...(platform.IS_MAC ? [] : [entryFile]), ...(makeShortcut ? [desktopFile] : [])]) {
        if (fs.existsSync(f) && !owned(f, hub)) { warn('Shortcut belongs to another install; left unchanged: ' + f); continue; }
        say('write launcher ' + f); if (!dry) write(f, entry, 0o755);
      }
      if (platform.IS_MAC && makeShortcut) log('The Desktop VideoHub.command opens Terminal briefly. If macOS blocks its first launch, use Open Anyway in Privacy & Security, then open it again.');
      const startup = await yesNo('startup', 'Start VideoHub quietly when you log in?', false, saved); answers.startup = startup ? 'yes' : 'no';
      if (startup) { say('enable VideoHub at login (server only)'); if (!dry) { const r = await platform.setAutostart(true); if (r?.code) warn(r.stderr || 'Could not enable autostart'); } }
      const exampleDest = path.join(result.workspace, 'films', 'hello-film'), hasExample = fs.existsSync(path.join(exampleDest, 'index.html'));
      const example = !hasExample && await yesNo('example', 'Add the 10-second example film?', true, saved); answers.example = example || hasExample ? 'yes' : 'no';
      if (example) {
        say('copy the example film to ' + exampleDest);
        if (!dry) { if (fs.existsSync(exampleDest)) warn('The example destination already exists; left unchanged'); else { copyTree(path.join(hub, 'examples', 'hello-film'), exampleDest, { exclusive: true, skip: n => /^(node_modules|render|\.videohub|out|videohub-project\.json)$/i.test(n) }); const meta = path.join(hub, 'examples', 'hello-film', 'videohub-project.json'); if (fs.existsSync(meta)) write(path.join(exampleDest, '.videohub', 'project.json'), fs.readFileSync(meta, 'utf8')); } }
      }
      say('remember setup answers and this installation'); if (!dry) { write(answersFile, JSON.stringify(answers, null, 2) + '\n'); write(markerFile, JSON.stringify({ hub }, null, 2) + '\n'); }
      log('Video workspace: ' + result.workspace + '. Start a new agent session to load the hub_* tools.');
      if (launch) await open(hub);
      return { actions, warnings, workspace: result.workspace };
    }
    if (options.action === 'update') {
      const target = path.resolve(options.target || read(markerFile, {})?.hub || hub);
      if (!fs.existsSync(path.join(target, 'server', 'hub.js'))) throw new Error('No installed VideoHub found; use --target PATH or run setup.sh first');
      const paths = validateUpdatePaths(hub, target, { platform });
      if (paths.same) { say('keep this install (source and target are the same; no copy needed)'); return { actions, warnings }; }
      for (const name of ITEMS) checkCopy(path.join(hub, name), path.join(target, name));
      if (stat(path.join(target, 'data'))?.isSymbolicLink() || stat(path.join(target, 'data', 'update-backup'))?.isSymbolicLink()) throw new Error('Update backup folder contains a symbolic link; nothing changed');
      settings(target);
      await stopInstall(target);
      const lockBefore = fs.existsSync(path.join(target, 'package-lock.json')) ? fs.readFileSync(path.join(target, 'package-lock.json'), 'utf8') : null;
      const backup = path.join(target, 'data', 'update-backup', new Date().toISOString().replace(/[:.]/g, '-'));
      say('back up replaced code to ' + backup + ' and copy the new code (data and projects stay)');
      if (!dry) for (const name of ITEMS) {
        const src = path.join(hub, name), dst = path.join(target, name); if (!fs.existsSync(src)) continue;
        if (fs.lstatSync(src).isSymbolicLink()) continue;
        if (fs.existsSync(dst)) { if (fs.lstatSync(dst).isSymbolicLink()) throw new Error('Update target contains a symbolic link: ' + dst); if (fs.statSync(dst).isDirectory()) copyTree(dst, path.join(backup, name)); else { fs.mkdirSync(path.dirname(path.join(backup, name)), { recursive: true }); fs.copyFileSync(dst, path.join(backup, name)); } }
        if (fs.statSync(src).isDirectory()) copyTree(src, dst, { skip: skipCode }); else { fs.copyFileSync(src, dst); fs.chmodSync(dst, fs.statSync(src).mode); }
      }
      const lockAfter = fs.existsSync(path.join(target, 'package-lock.json')) ? fs.readFileSync(path.join(target, 'package-lock.json'), 'utf8') : null;
      packageInstall(target, lockBefore !== lockAfter);
      const integration = await agents({ action: 'refresh', agents: ['claude', 'opencode'], hub: target, home, env, dryRun: dry }); for (const s of integration.actions) log(s); for (const e of integration.errors) warn(e);
      log('Update complete. Open VideoHub with its existing launcher and restart your agent session.'); return { actions, warnings };
    }
    await stopInstall(hub);
    const integration = await agents({ action: 'uninstall', agents: ['claude', 'opencode'], hub, home, env, dryRun: dry, recycle: platform.trash }); for (const s of integration.actions) log(s); for (const e of integration.errors) warn(e);
    const startup = await platform.getAutostart();
    // A macOS LaunchAgent may be installed but unloaded; setAutostart also removes that owned plist.
    if (startup || platform.IS_MAC) { say('disable this install\'s autostart if present'); if (!dry) try { await platform.setAutostart(false); } catch (e) { warn(e.message); } }
    for (const f of [...(platform.IS_MAC ? [] : [entryFile]), desktopFile]) if (owned(f, hub)) { say('move launcher to Trash: ' + f); if (!dry) { const r = await platform.trash([f]); if (!r[0]?.ok) warn(r[0]?.error || 'Could not move launcher to Trash'); } }
    if (read(markerFile, {})?.hub === hub) { say('move installation record to Trash'); if (!dry) await platform.trash([markerFile]); }
    log('Uninstall complete. Your films, notes, outputs, settings and the program folder remain.'); return { actions, warnings };
  } finally { reader?.close(); }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { await runInstaller(parseOptions(process.argv.slice(2))); } catch (e) { console.error(e.message); process.exitCode = 1; }
}
