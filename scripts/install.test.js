import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { parseOptions, runInstaller, stopInstalledHub, validateUpdatePaths } from './install.mjs';
import { IS_WIN } from '../server/platform.js';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const write = (f, t = '{}') => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, t); };
function fixture(os = 'linux', installName = 'install') {
  const base = path.join(ROOT, '.test-tmp', 'installer-' + randomUUID()), hub = path.join(base, installName), home = path.join(base, 'home'), workspace = path.join(base, 'work');
  for (const d of [hub, home, path.join(home, 'Desktop')]) fs.mkdirSync(d, { recursive: true });
  write(path.join(hub, 'server', 'hub.js'), '// fixture hub');
  for (const m of ['@modelcontextprotocol/sdk', 'puppeteer-core']) write(path.join(hub, 'node_modules', m, 'package.json'));
  write(path.join(hub, 'skill', 'videohub', 'SKILL.md'), '---\nname: videohub\ndescription: Fixture\n---\n{{VIDEOHUB_DIR}}/server/cli.js\n'); write(path.join(hub, 'claude', 'global-rule.md'), '{{VIDEOHUB_DIR}}/server/cli.js\n');
  write(path.join(hub, 'examples', 'hello-film', 'index.html'), '<canvas></canvas>'); write(path.join(hub, 'examples', 'hello-film', 'videohub-project.json'), '{"title":"Example"}');
  const env = { PATH: '', XDG_CONFIG_HOME: path.join(home, '.config'), XDG_DATA_HOME: path.join(home, '.local', 'share'), VIDEOHUB_DATA_DIR: path.join(hub, 'data'), VIDEOHUB_PORT: '7799', VIDEOHUB_NO_WINDOW: '1' };
  const calls = [], platform = { OS: 'linux', IS_WIN: false, IS_MAC: false, IS_LINUX: true, dirs: { home, config: path.join(home, '.config', 'videohub'), desktop: path.join(home, 'Desktop') }, findTool: () => null, findBrowser: () => ({ path: null }), desktopEntry: () => '[Desktop Entry]\nName=VideoHub\nExec="/home/me/VideoHub/open.sh"\n', pathKey: p => path.resolve(p), processList: async () => [], getAutostart: async () => false, setAutostart: async on => { calls.push(['startup', on]); return { code: 0 }; }, trash: async a => { calls.push(['trash', a]); return a.map(p => ({ path: p, ok: true })); }, openUrlWindow: u => calls.push(['open', u]) };
  if (os === 'darwin') { platform.OS = 'darwin'; platform.IS_MAC = true; platform.IS_LINUX = false; platform.dirs.config = path.join(home, 'Library', 'Application Support', 'VideoHub'); platform.desktopEntry = () => { throw new Error('macOS must not create a desktop entry'); }; }
  return { hub, home, workspace, env, platform, calls, log: () => {}, launch: false, discover: () => [], run: () => { throw new Error('No package or external command may run in this test'); } };
}
test('shell options accept every guided answer and reject typos before changes', () => {
  const r = parseOptions(['setup', '--dry-run', '--yes', '--agents', 'claude,opencode', '--workspace', '/home/me/work', '--watch-found', 'no', '--gpu-encoder', 'yes', '--global-rule', 'yes', '--shortcut', 'no', '--startup', 'no', '--example', 'yes']); assert.equal(r.agents, 'claude,opencode'); assert.equal(r['dry-run'], true);
  assert.throws(() => parseOptions(['setup', '--glob-rule', 'yes']), /Unknown option/); assert.throws(() => parseOptions(['setup', '--startup', 'maybe']), /must be/); assert.throws(() => parseOptions(['update', '--target']), /Missing/);
});
test('Linux setup dry-run writes no config, workspace, skill, launcher, or startup', async () => {
  const o = fixture(), r = await runInstaller({ action: 'setup', yes: true, 'dry-run': true, workspace: o.workspace, agents: 'opencode', startup: 'yes' }, o);
  assert.ok(r.actions.some(s => /write launcher/.test(s))); assert.equal(fs.existsSync(o.workspace), false); assert.equal(fs.existsSync(path.join(o.hub, 'data')), false); assert.equal(fs.existsSync(path.join(o.home, '.config')), false); assert.deepEqual(o.calls, []);
});
test('fake-home Linux setup writes workspace, OpenCode integration, entry, example, and answers; rerun keeps settings', async () => {
  const o = fixture(); let r = await runInstaller({ action: 'setup', yes: true, workspace: o.workspace, agents: 'opencode', startup: 'yes' }, o); assert.deepEqual(r.warnings.filter(s => !/ffmpeg|Chrome|Chromium/.test(s)), []);
  const configFile = path.join(o.hub, 'data', 'config.json'), config = JSON.parse(fs.readFileSync(configFile, 'utf8')); assert.equal(config.agentName, 'OpenCode'); assert.equal(config.baseDir, o.workspace);
  assert.ok(fs.existsSync(path.join(o.workspace, 'films', 'hello-film', '.videohub', 'project.json'))); assert.ok(fs.existsSync(path.join(o.home, '.config', 'opencode', 'AGENTS.md'))); assert.ok(fs.existsSync(path.join(o.home, '.local', 'share', 'applications', 'videohub.desktop'))); assert.deepEqual(o.calls, [['startup', true]]);
  config.agentName = 'My agent'; write(configFile, JSON.stringify(config)); r = await runInstaller({ action: 'setup', yes: true, workspace: path.join(o.home, 'other'), agents: 'opencode' }, o); assert.equal(JSON.parse(fs.readFileSync(configFile, 'utf8')).agentName, 'My agent'); assert.equal(fs.existsSync(path.join(o.workspace, 'films', 'hello-film-2')), false);
});
test('updater preserves data and backs up code without removing old files', async () => {
  const o = fixture(), target = path.join(path.dirname(o.hub), 'target'); write(path.join(target, 'server', 'hub.js'), '// old hub'); write(path.join(target, 'server', 'old.js'), '// old extra'); write(path.join(target, 'data', 'config.json'), '{"mine":true}');
  for (const m of ['@modelcontextprotocol/sdk', 'puppeteer-core']) write(path.join(target, 'node_modules', m, 'package.json'));
  await runInstaller({ action: 'update', target }, { ...o, env: { ...o.env, VIDEOHUB_DATA_DIR: '' }, request: async () => null });
  assert.equal(fs.readFileSync(path.join(target, 'server', 'hub.js'), 'utf8'), '// fixture hub'); assert.equal(fs.readFileSync(path.join(target, 'server', 'old.js'), 'utf8'), '// old extra'); assert.equal(fs.readFileSync(path.join(target, 'data', 'config.json'), 'utf8'), '{"mine":true}');
  const backups = fs.readdirSync(path.join(target, 'data', 'update-backup')); assert.equal(backups.length, 1); assert.equal(fs.readFileSync(path.join(target, 'data', 'update-backup', backups[0], 'server', 'hub.js'), 'utf8'), '// old hub');
});
test('updater refuses active queues and unrelated processes; dry-run does not contact a server', async () => {
  const o = fixture(), target = path.join(path.dirname(o.hub), 'target'); write(path.join(target, 'server', 'hub.js'), '// old');
  const p = { ...o.platform, processList: async () => [{ pid: 123, name: 'node', cmd: 'node ' + path.join(target, 'server', 'hub.js') }] };
  await assert.rejects(runInstaller({ action: 'update', target }, { ...o, platform: p, request: async u => u.endsWith('/api/ping') ? { app: 'videohub', pid: 123 } : [{ state: 'running' }] }), /running or queued/);
  await assert.rejects(runInstaller({ action: 'update', target }, { ...o, request: async () => ({ app: 'videohub', pid: 456 }) }), /another process/);
  await runInstaller({ action: 'update', target, 'dry-run': true }, { ...o, request: async () => { throw new Error('Dry run contacted server'); } }); assert.equal(fs.readFileSync(path.join(target, 'server', 'hub.js'), 'utf8'), '// old');
});
test('uninstall recycles only owned launchers and leaves work and program files', async () => {
  const o = fixture(); await runInstaller({ action: 'setup', yes: true, workspace: o.workspace, agents: 'opencode' }, o); o.calls.length = 0;
  // Other installations can have their own Desktop shortcut.
  write(path.join(o.home, 'Desktop', 'VideoHub.desktop'), '# VideoHub install: /other-install\n[Desktop Entry]');
  await runInstaller({ action: 'uninstall' }, { ...o, request: async () => null });
  assert.ok(o.calls.filter(c => c[0] === 'trash').some(c => c[1].some(f => f.endsWith('videohub.desktop')))); assert.ok(!o.calls.filter(c => c[0] === 'trash').some(c => c[1].some(f => f.endsWith('VideoHub.desktop')))); assert.ok(fs.existsSync(path.join(o.workspace, 'films', 'hello-film', 'index.html'))); assert.ok(fs.existsSync(path.join(o.hub, 'server', 'hub.js')));
});
test('launcher starts a detached local server and opens the window; server flag opens none', async () => {
  const o = fixture(); let polls = 0, spawned = [];
  const overrides = { ...o, request: async () => ++polls > 1 ? { app: 'videohub', pid: 999 } : null, spawnServer: (file, args, opts) => { spawned.push({ file, args, opts }); return { pid: 999, on() {}, unref() {} }; }, delay: async () => {} };
  await runInstaller({ action: 'open' }, overrides); assert.equal(spawned.length, 1); assert.equal(spawned[0].opts.detached, true); assert.deepEqual(spawned[0].args, [path.join(o.hub, 'server', 'hub.js')]); assert.deepEqual(o.calls, [['open', 'http://127.0.0.1:7799']]);
  polls = 0; o.calls.length = 0; await runInstaller({ action: 'open', server: true }, overrides); assert.deepEqual(o.calls, []);
});
test('macOS dry-run gives Homebrew hints and writes no Desktop command or Library settings', async () => {
  const o = fixture('darwin'), r = await runInstaller({ action: 'setup', yes: true, 'dry-run': true, workspace: o.workspace, agents: 'opencode' }, o);
  assert.ok(r.warnings.some(s => /brew install node ffmpeg/.test(s))); assert.ok(r.warnings.some(s => /brew install --cask google-chrome/.test(s))); assert.ok(r.actions.some(s => /VideoHub\.command/.test(s))); assert.ok(!r.actions.some(s => /videohub\.desktop/i.test(s))); assert.equal(fs.existsSync(path.join(o.home, 'Library')), false); assert.equal(fs.existsSync(path.join(o.home, 'Desktop', 'VideoHub.command')), false);
});
test('macOS setup creates a quoted executable Desktop command and Library installation record', async () => {
  const o = fixture('darwin', "VideoHub's copy"); await runInstaller({ action: 'setup', yes: true, workspace: o.workspace, agents: 'opencode' }, o);
  const command = path.join(o.home, 'Desktop', 'VideoHub.command'), text = fs.readFileSync(command, 'utf8'); assert.ok(text.startsWith('#!/bin/bash\n')); assert.ok(text.includes('# VideoHub install: ' + o.hub + '\n')); assert.ok(text.includes('/opt/homebrew/bin:/usr/local/bin:$PATH')); assert.ok(text.includes("exec '" + process.execPath.replaceAll("'", "'\\''") + "' '" + path.join(o.hub, 'scripts', 'install.mjs').replaceAll("'", "'\\''") + "' open \"$@\""));
  if (!IS_WIN) assert.ok(fs.statSync(command).mode & 0o111);
  assert.ok(fs.existsSync(path.join(o.home, 'Library', 'Application Support', 'VideoHub', 'install.json'))); assert.equal(fs.existsSync(path.join(o.home, '.local', 'share', 'applications')), false);
  o.calls.length = 0; await runInstaller({ action: 'uninstall' }, { ...o, request: async () => null }); assert.ok(o.calls.some(c => c[0] === 'startup' && c[1] === false)); assert.ok(o.calls.some(c => c[0] === 'trash' && c[1].includes(command))); assert.ok(fs.existsSync(path.join(o.workspace, 'films', 'hello-film', 'index.html')));
});
test('macOS setup and uninstall leave another installation\'s Desktop command unchanged', async () => {
  const o = fixture('darwin'), command = path.join(o.home, 'Desktop', 'VideoHub.command'), foreign = '#!/bin/bash\n# VideoHub install: /other-install\n'; write(command, foreign);
  const r = await runInstaller({ action: 'setup', yes: true, workspace: o.workspace, agents: 'opencode' }, o); assert.ok(r.warnings.some(s => /another install/.test(s))); assert.equal(fs.readFileSync(command, 'utf8'), foreign);
  o.calls.length = 0; await runInstaller({ action: 'uninstall' }, { ...o, request: async () => null }); assert.ok(!o.calls.some(c => c[0] === 'trash' && c[1].includes(command)));
});
test('updater identifies only direct Node hub launches and refuses nested source/target folders', async () => {
  const o = fixture(), target = path.join(path.dirname(o.hub), 'target'); write(path.join(target, 'server', 'hub.js'), '// old');
  for (const p of [{ pid: 123, name: 'bash', cmd: 'bash ' + path.join(target, 'server', 'hub.js') }, { pid: 123, name: 'node', cmd: 'node ' + path.join(target, 'server', 'hub.js') + '.other' }, { pid: 123, name: 'node', cmd: 'node -e console.log("' + path.join(target, 'server', 'hub.js') + '")' }]) {
    await assert.rejects(runInstaller({ action: 'update', target }, { ...o, platform: { ...o.platform, processList: async () => [p] }, request: async () => ({ app: 'videohub', pid: 123 }) }), /another process/);
  }
  const nested = path.join(o.hub, 'nested'); write(path.join(nested, 'server', 'hub.js'), '// nested'); await assert.rejects(runInstaller({ action: 'update', target: nested }, o), /not nested/);
});
test('invalid config prevents package installation, server requests and code replacement', async () => {
  const o = fixture(), target = path.join(path.dirname(o.hub), 'target'); write(path.join(target, 'server', 'hub.js'), '// old'); write(path.join(o.hub, 'data', 'config.json'), '{ invalid');
  const noRequest = async () => { throw new Error('Should not contact a server'); };
  await assert.rejects(runInstaller({ action: 'setup', yes: true }, { ...o, request: noRequest }), /left as it is/);
  await assert.rejects(runInstaller({ action: 'open' }, { ...o, request: noRequest }), /Cannot read/);
  await assert.rejects(runInstaller({ action: 'update', target }, { ...o, request: noRequest }), /Cannot read/); assert.equal(fs.readFileSync(path.join(target, 'server', 'hub.js'), 'utf8'), '// old');
});
test('updater verifies server termination before replacing any code', async () => {
  const o = fixture(), target = path.join(path.dirname(o.hub), 'target'); write(path.join(target, 'server', 'hub.js'), '// old');
  const row = { pid: 123, name: 'node', start: 'original', cmd: 'node ' + path.join(target, 'server', 'hub.js') }, stopped = [];
  const request = async u => u.endsWith('/api/ping') ? { app: 'videohub', pid: 123 } : u.endsWith('/api/jobs') ? [] : { state: 'idle' };
  await assert.rejects(runInstaller({ action: 'update', target }, { ...o, platform: { ...o.platform, processList: async () => [row] }, request, stopPid: p => stopped.push(p), delay: async () => {} }), /still running/);
  assert.deepEqual(stopped, [123]); assert.equal(fs.readFileSync(path.join(target, 'server', 'hub.js'), 'utf8'), '// old'); assert.equal(fs.existsSync(path.join(target, 'data', 'update-backup')), false);
});
test('updater refuses a reused PID and unavailable process inventory before sending a stop', async () => {
  const o = fixture(), target = path.join(path.dirname(o.hub), 'target'); write(path.join(target, 'server', 'hub.js'), '// old');
  const row = { pid: 123, name: 'node', start: 'original', cmd: 'node ' + path.join(target, 'server', 'hub.js') }; let calls = 0;
  const request = async u => u.endsWith('/api/ping') ? { app: 'videohub', pid: 123 } : u.endsWith('/api/jobs') ? [] : { state: 'idle' };
  await assert.rejects(runInstaller({ action: 'update', target }, { ...o, platform: { ...o.platform, processList: async () => [++calls === 1 ? row : { ...row, start: 'replacement' }] }, request, stopPid: () => { throw new Error('A reused PID must not be stopped'); } }), /identity changed/);
  await assert.rejects(runInstaller({ action: 'update', target }, { ...o, platform: { ...o.platform, processList: async () => null }, request }), /Cannot inspect running processes/);
});
test('updater checks all file types before stopping the server or making a partial update', async () => {
  const o = fixture(), target = path.join(path.dirname(o.hub), 'target'); write(path.join(target, 'server', 'hub.js'), '// old'); write(path.join(target, 'skill'), 'conflicting file');
  await assert.rejects(runInstaller({ action: 'update', target }, { ...o, request: async () => { throw new Error('No server should be contacted'); } }), /different file types/); assert.equal(fs.readFileSync(path.join(target, 'server', 'hub.js'), 'utf8'), '// old');
});
test('launcher does not open a different program that wins a startup port race', async () => {
  const o = fixture(); let polls = 0;
  await assert.rejects(runInstaller({ action: 'open' }, { ...o, request: async () => ++polls === 1 ? null : { app: 'videohub', pid: 456 }, spawnServer: () => ({ pid: 999, on() {}, unref() {} }), delay: async () => {} }), /acquired the VideoHub port/); assert.deepEqual(o.calls, []);
});
test('Windows lifecycle uses the same queue and ownership checks without allowing dry-run API contact', async () => {
  const o = fixture(), platform = { ...o.platform, IS_WIN: true }, stopped = [];
  await runInstaller({ action: 'stop', target: o.hub, 'dry-run': true }, { ...o, platform, request: async () => { throw new Error('Dry-run contacted server'); } });
  await assert.rejects(runInstaller({ action: 'stop', target: o.hub }, { ...o, platform, request: async () => ({ app: 'videohub', pid: 888 }), stopPid: p => stopped.push(p) }), /another process/); assert.deepEqual(stopped, []);
  const row = { pid: 123, name: 'node.exe', start: 'original', cmd: '"' + process.execPath + '" "' + path.join(o.hub, 'server', 'hub.js') + '"' }; let exited = false;
  await stopInstalledHub({ install: o.hub, platform: { processList: async () => exited ? [] : [row] }, port: 7799, request: async u => u.endsWith('/api/ping') ? { app: 'videohub', pid: 123 } : u.endsWith('/api/jobs') ? [] : { state: 'idle' }, stopPid: p => { stopped.push(p); exited = true; }, delay: async () => {} }); assert.deepEqual(stopped, [123]);
});
test('Windows stop ownership folds path casing while Unix and different install prefixes remain distinct', async () => {
  const o = fixture(), stopped = [], request = async u => u.endsWith('/api/ping') ? { app: 'videohub', pid: 123 } : u.endsWith('/api/jobs') ? [] : { state: 'idle' };
  const script = path.join(o.hub, 'server', 'hub.js'), row = { pid: 123, name: 'node.exe', start: 'original', cmd: '"' + process.execPath + '" "' + script.toUpperCase() + '"' }; let exited = false;
  await stopInstalledHub({ install: o.hub, platform: { IS_WIN: true, processList: async () => exited ? [] : [row] }, port: 7799, request, stopPid: p => { stopped.push(p); exited = true; }, delay: async () => {} }); assert.deepEqual(stopped, [123]);
  for (const [IS_WIN, cmd] of [[false, row.cmd], [true, 'node "' + path.join(o.hub + '-copy', 'server', 'hub.js').toUpperCase() + '"']]) {
    await assert.rejects(stopInstalledHub({ install: o.hub, platform: { IS_WIN, processList: async () => [{ ...row, cmd }] }, port: 7799, request, stopPid: () => { throw new Error('Wrong install was stopped'); }, delay: async () => {} }), /another process/);
  }
});
test('lifecycle refuses unknown process start identity instead of treating null as a match', async () => {
  const o = fixture(), row = { pid: 123, name: 'node', start: null, cmd: 'node ' + path.join(o.hub, 'server', 'hub.js') }, stopped = [];
  await assert.rejects(stopInstalledHub({ install: o.hub, platform: { processList: async () => [row] }, port: 7799, request: async u => u.endsWith('/api/ping') ? { app: 'videohub', pid: 123 } : u.endsWith('/api/jobs') ? [] : { state: 'idle' }, stopPid: p => stopped.push(p), delay: async () => {} }), /Cannot verify server process identity/); assert.deepEqual(stopped, []);
});
test('canonical update validation rejects nested junction aliases before stop or copy', async () => {
  const o = fixture(), nested = path.join(o.hub, 'nested'), sibling = o.hub + '-copy', alias = path.join(path.dirname(o.hub), 'nested-alias'), sameAlias = path.join(path.dirname(o.hub), 'same-alias');
  fs.mkdirSync(nested); fs.mkdirSync(sibling);
  // Resolve fake junctions on every host; Windows may deny creating real junctions in test runners.
  const aliases = new Map([[alias, nested], [sameAlias, o.hub]]), realpath = p => aliases.get(p) || fs.realpathSync(p), resolver = { realpath };
  assert.throws(() => validateUpdatePaths(o.hub, alias, resolver), /not nested/); assert.throws(() => validateUpdatePaths(alias, o.hub, resolver), /not nested/); assert.equal(validateUpdatePaths(o.hub, sameAlias, resolver).same, true); assert.equal(validateUpdatePaths(o.hub, sibling).same, false);
  const noContact = { ...o, platform: { ...o.platform, IS_WIN: true }, request: async () => { throw new Error('Validation contacted a server'); }, stopPid: () => { throw new Error('Validation stopped a process'); } };
  await assert.rejects(runInstaller({ action: 'validate-update', source: o.hub, target: nested }, noContact), /not nested/); await assert.rejects(runInstaller({ action: 'validate-update', source: o.hub, target: o.hub }, noContact), /same folder/);
  await runInstaller({ action: 'validate-update', source: o.hub, target: sibling }, noContact); assert.equal(fs.readdirSync(sibling).length, 0);
});
test('Bash launchers pass bash -n when a working Bash is available', t => {
  const version = spawnSync('bash', ['--version'], { encoding: 'utf8', timeout: 10000, windowsHide: true }); if (version.error || version.status !== 0) { t.skip('Bash is unavailable on this host; run bash -n on Linux/macOS'); return; }
  for (const f of ['setup.sh', 'update.sh', 'uninstall.sh', 'open.sh']) { const r = spawnSync('bash', ['-n', f], { cwd: ROOT, encoding: 'utf8', timeout: 10000, windowsHide: true }); assert.equal(r.status, 0, f + ': ' + r.stderr); }
});
