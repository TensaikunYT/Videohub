import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { parseOptions, runInstaller, legacyFiles, retireLegacyAgent, validateLegacyPaths } from './install.mjs';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const write = (f, text = '{}') => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, text); };
function fixture({ packages = true } = {}) {
  const base = path.join(ROOT, '.test-tmp', 'windows-installer-' + randomUUID()), home = path.join(base, 'home'), hub = path.join(base, 'download'), target = path.join(base, 'installed');
  const desktop = path.join(home, 'Redirected Desktop'), config = path.join(home, 'AppData', 'Roaming');
  for (const d of [hub, target, desktop]) fs.mkdirSync(d, { recursive: true });
  const code = install => {
    write(path.join(install, 'server', 'hub.js'), '// ' + path.basename(install));
    write(path.join(install, 'skill', 'videohub', 'SKILL.md'), '---\nname: videohub\ndescription: Fixture\n---\n{{VIDEOHUB_DIR}}/server/cli.js');
    write(path.join(install, 'claude', 'global-rule.md'), '{{VIDEOHUB_DIR}}/server/cli.js');
    write(path.join(install, 'examples', 'hello-film', 'index.html'), '<canvas></canvas>');
    write(path.join(install, 'examples', 'hello-film', 'videohub-project.json'), '{"title":"Example"}');
    if (packages) for (const name of ['@modelcontextprotocol/sdk', 'puppeteer-core']) write(path.join(install, 'node_modules', name, 'package.json'));
  };
  code(hub); code(target);
  const env = { HOME: home, USERPROFILE: home, APPDATA: config, LOCALAPPDATA: path.join(home, 'AppData', 'Local'), XDG_CONFIG_HOME: path.join(home, '.config'), XDG_DATA_HOME: path.join(home, '.local', 'share'), PATH: '', VIDEOHUB_PORT: '7799', VIDEOHUB_NO_WINDOW: '1' }, calls = [];
  const state = { shortcut: null, startup: null, shortcutFailure: false, startupFailure: false, shortcutUnknown: false, startupUnknown: false };
  const same = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();
  const factory = install => ({
    OS: 'win32', IS_WIN: true, IS_MAC: false, IS_LINUX: false, dirs: { home, desktop, config }, casePath: p => String(p).toLowerCase(), findTool: () => null, findBrowser: () => ({ path: null }),
    shellCommand: command => ({ file: 'cmd.exe', args: ['/d', '/s', '/c', '"' + command + '"'], opts: { windowsVerbatimArguments: true } }),
    getShortcut: async () => ({ path: path.join(desktop, 'VideoHub.lnk'), exists: state.shortcutUnknown || !!state.shortcut, owned: !state.shortcutUnknown && !!state.shortcut && same(state.shortcut, install), install: state.shortcutUnknown ? null : state.shortcut }),
    setShortcut: async on => { calls.push(['shortcut', install, on]); if (state.shortcutFailure) throw new Error('Shortcut write failed'); if (state.shortcutUnknown || (state.shortcut && !same(state.shortcut, install))) throw new Error('Shortcut belongs to another install'); state.shortcut = on ? install : null; return { changed: true, owned: on, exists: on }; },
    getAutostart: async () => !!state.startup && same(state.startup, install),
    getAutostartState: async () => ({ exists: state.startupUnknown || !!state.startup, owned: !state.startupUnknown && !!state.startup && same(state.startup, install), install: state.startupUnknown ? null : state.startup }),
    setAutostart: async on => { calls.push(['startup', install, on]); if (state.startupFailure) throw new Error('Startup update failed'); if (state.startupUnknown || (state.startup && !same(state.startup, install))) throw new Error('Startup belongs to another install'); state.startup = on ? install : null; },
    processList: async () => [], trash: async files => { calls.push(['trash', install, files]); return files.map(f => ({ path: f, ok: true })); }, cleanupLegacyAutostart: async () => { calls.push(['cleanup', install]); }, openUrlWindow: async url => { calls.push(['open', url]); }
  });
  return { base, home, hub, target, desktop, config, env, calls, state, factory, platform: factory(hub), platformForInstall: factory, log: () => {}, launch: false, discover: () => [], request: async () => null, run: () => { throw new Error('No external command may run in fake-home tests'); } };
}
test('Windows legacy parameter names and documented aliases map to common options', () => {
  const r = parseOptions(['setup', '-DryRun', '-Yes', '-Workspace', 'D:\\Video work', '-Agents', 'claude,opencode', '-WatchFound', 'No', '-GpuEncoder', 'YES', '-GlobalRule', 'no', '-Shortcut', 'yes', '-Startup', 'no', '-Example', 'yes', '-NoAgent', '-NoGuard']);
  assert.equal(r['dry-run'], true); assert.equal(r.workspace, 'D:\\Video work'); assert.equal(r['watch-found'], 'no'); assert.equal(r['gpu-encoder'], 'yes'); assert.equal(r['global-rule'], 'no'); assert.equal(r['no-agent'], true); assert.equal(r['no-guard'], true);
  assert.equal(parseOptions(['setup', '-NoShortcut', '-StartWithWindows', '-Test']).shortcut, 'no'); assert.equal(parseOptions(['setup', '-StartWithWindows']).startup, 'yes'); assert.equal(parseOptions(['setup', '-Test'])['dry-run'], true); assert.equal(parseOptions(['update', '-Target', 'D:\\VideoHub', '-NoSkill'])['no-skill'], true);
  assert.throws(() => parseOptions(['setup', '-Workspace', '-Yes']), /Missing value/);
});
test('Windows dry-run plans Node shortcuts and startup without OS writes, npm, or a server', async () => {
  const o = fixture({ packages: false }), workspace = path.join(o.base, 'Work');
  const r = await runInstaller({ action: 'setup', yes: true, 'dry-run': true, workspace, agents: 'opencode', startup: 'yes' }, o);
  assert.ok(r.actions.some(s => /Desktop shortcut/.test(s))); assert.ok(r.actions.some(s => /at login/.test(s))); assert.deepEqual(o.calls, []); assert.equal(fs.existsSync(workspace), false); assert.equal(fs.existsSync(path.join(o.hub, 'data')), false); assert.equal(fs.existsSync(path.join(o.config, 'VideoHub')), false);
});
test('Windows setup writes fake-home config and agents, uses redirected Desktop API, and remembers old answers', async () => {
  const o = fixture(), workspace = path.join(o.base, 'Work');
  write(path.join(o.hub, 'data', 'setup-answers.json'), JSON.stringify({ agents: ['opencode'], globalRule: 'no', shortcut: 'no', startup: 'no', example: 'no' }));
  await runInstaller({ action: 'setup', yes: true, workspace }, o);
  assert.equal(JSON.parse(fs.readFileSync(path.join(o.hub, 'data', 'config.json'), 'utf8')).agentName, 'OpenCode'); assert.ok(fs.existsSync(path.join(o.home, '.config', 'opencode', 'skills', 'videohub', 'SKILL.md'))); assert.equal(fs.existsSync(path.join(o.home, '.config', 'opencode', 'AGENTS.md')), false); assert.ok(fs.existsSync(path.join(o.config, 'VideoHub', 'install.json'))); assert.ok(!o.calls.some(c => c[0] === 'shortcut' || c[0] === 'startup'));
  await runInstaller({ action: 'setup', yes: true, workspace, shortcut: 'yes', startup: 'yes' }, o);
  assert.ok(o.calls.some(c => c[0] === 'shortcut' && c[1] === o.hub && c[2])); assert.ok(o.calls.some(c => c[0] === 'startup' && c[1] === o.hub && c[2])); assert.equal(fs.existsSync(path.join(o.desktop, 'VideoHub.desktop')), false);
});
test('Windows runtime package command uses a fixed cmd plan with cwd and environment passed separately', async () => {
  const o = fixture({ packages: false }), commands = [];
  await runInstaller({ action: 'setup', yes: true, workspace: path.join(o.base, 'Work'), agents: 'opencode', shortcut: 'no', example: 'no' }, { ...o, run: (file, args, options) => { commands.push({ file, args, options }); return { status: 0 }; } });
  assert.equal(commands.length, 1); assert.equal(commands[0].file, 'cmd.exe'); assert.deepEqual(commands[0].args, ['/d', '/s', '/c', '"npm ci --no-audit --no-fund"']); assert.equal(commands[0].options.cwd, o.hub); assert.equal(commands[0].options.env, o.env); assert.equal(commands[0].options.windowsVerbatimArguments, true);
});
test('Windows update discovers the installed shortcut, keeps data, and migrates only target-owned integrations', async () => {
  const o = fixture(); o.state.shortcut = o.target; o.state.startup = o.target;
  write(path.join(o.target, 'data', 'config.json'), '{"port":7799,"personal":"kept"}'); write(path.join(o.target, 'open.vbs'), 'retired launcher fixture'); const before = fs.readFileSync(path.join(o.target, 'data', 'config.json'), 'utf8');
  let refresh = 0;
  await runInstaller({ action: 'update' }, { ...o, agents: async args => { refresh++; assert.equal(args.hub, o.target); return { actions: [], errors: [] }; } });
  assert.equal(refresh, 1); assert.equal(fs.readFileSync(path.join(o.target, 'data', 'config.json'), 'utf8'), before); assert.ok(o.calls.some(c => c[0] === 'shortcut' && c[1] === o.target)); assert.ok(o.calls.some(c => c[0] === 'startup' && c[1] === o.target)); assert.ok(!o.calls.some(c => c[0] === 'shortcut' && c[1] === o.hub)); assert.ok(o.calls.some(c => c[0] === 'trash' && c[2].includes(path.join(o.target, 'open.vbs'))));
  assert.equal(fs.readdirSync(path.join(o.target, 'data', 'update-backup')).length, 1);
});
test('Windows NoSkill skips integration refresh; startup migration failure preserves an old launcher', async () => {
  const o = fixture(); o.state.shortcut = o.target; o.state.startup = o.target; o.state.startupFailure = true; write(path.join(o.target, 'open.vbs'), 'retired launcher fixture');
  const r = await runInstaller({ action: 'update', target: o.target, 'no-skill': true }, { ...o, agents: async () => { throw new Error('NoSkill must skip integration refresh'); } });
  assert.ok(r.warnings.some(s => /Startup update failed/.test(s))); assert.ok(!o.calls.some(c => c[0] === 'trash' && c[2].includes(path.join(o.target, 'open.vbs'))));
});
test('Windows uninstall removes only owned OS integrations and leaves work, notes, and foreign links intact', async () => {
  const o = fixture(), workspace = path.join(o.base, 'Work'); await runInstaller({ action: 'setup', yes: true, workspace, agents: 'opencode', startup: 'yes' }, o);
  o.calls.length = 0; o.state.shortcut = path.join(o.base, 'another-install');
  await runInstaller({ action: 'uninstall' }, o);
  assert.ok(!o.calls.some(c => c[0] === 'shortcut')); assert.ok(o.calls.some(c => c[0] === 'startup' && c[1] === o.hub && c[2] === false)); assert.ok(fs.existsSync(path.join(workspace, 'films', 'hello-film', 'index.html'))); assert.ok(fs.existsSync(path.join(o.hub, 'server', 'hub.js')));
});
test('Windows uninstall keeps a legacy launcher when startup removal fails', async () => {
  const o = fixture(); o.state.startup = o.hub; o.state.startupFailure = true; write(path.join(o.hub, 'open.vbs'), 'retired launcher fixture');
  const r = await runInstaller({ action: 'uninstall' }, o); assert.ok(r.warnings.some(s => /Startup update failed/.test(s))); assert.ok(!o.calls.some(c => c[0] === 'trash' && c[2].includes(path.join(o.hub, 'open.vbs'))));
});
test('legacy retirement recognizes old helper backups and preserves arbitrary executable names', () => {
  const r = legacyFiles(path.join(path.sep, 'VideoHub'), { list: () => ['VIDEOHUBAGENT.EXE', 'renderguard.exe', 'VideoHubAgent.old.exe', 'RenderGuard.old.old.exe', 'foreign.exe', 'other.old.exe'] });
  assert.equal(r.helpers.filter(f => /[/\\]videohubagent\.exe$/i.test(f)).length, 1); assert.equal(r.helpers.filter(f => /[/\\]renderguard\.exe$/i.test(f)).length, 1); assert.ok(r.helpers.some(f => f.endsWith('VideoHubAgent.old.exe'))); assert.ok(r.helpers.some(f => f.endsWith('RenderGuard.old.old.exe'))); assert.ok(!r.helpers.some(f => f.endsWith('foreign.exe') || f.endsWith('other.old.exe')));
});
test('all Windows lifecycle actions preserve old launchers when existing OS references are unrecognized', async () => {
  for (const action of ['setup', 'update', 'uninstall']) for (const unknown of ['shortcutUnknown', 'startupUnknown']) {
    const o = fixture(); o.state[unknown] = true; const install = action === 'update' ? o.target : o.hub, old = path.join(install, 'open.vbs'); write(old, 'old launcher fixture');
    const r = await runInstaller({ action, yes: true, workspace: path.join(o.base, 'Work'), agents: 'opencode', shortcut: 'no', startup: 'no', example: 'no', target: o.target, 'no-skill': true }, o);
    assert.ok(!o.calls.some(c => c[0] === 'trash' && c[2].includes(old)), action + '/' + unknown); assert.ok(r.warnings.some(s => /Old launcher files were kept/.test(s)), action + '/' + unknown);
  }
});
test('setup preserves currently enabled owned integrations despite stale saved no answers', async () => {
  const o = fixture(); o.state.shortcut = o.hub; o.state.startup = o.hub;
  write(path.join(o.hub, 'data', 'setup-answers.json'), JSON.stringify({ agents: ['opencode'], globalRule: 'no', shortcut: 'no', startup: 'no', example: 'no' }));
  await runInstaller({ action: 'setup', yes: true, workspace: path.join(o.base, 'Work') }, o);
  assert.ok(o.calls.some(c => c[0] === 'shortcut' && c[2] === true)); assert.ok(o.calls.some(c => c[0] === 'startup' && c[2] === true));
  o.calls.length = 0; await runInstaller({ action: 'setup', yes: true, shortcut: 'no', startup: 'no' }, o); assert.ok(!o.calls.some(c => c[0] === 'shortcut')); assert.ok(o.calls.some(c => c[0] === 'startup' && c[2] === false));
});
test('retirement refuses a guard junction before listing it or stopping any process', async () => {
  const o = fixture(), guard = path.join(o.hub, 'guard'), link = { isSymbolicLink: () => true, isDirectory: () => true };
  const validatePaths = (install, paths, options) => validateLegacyPaths(install, paths, { ...options, lstat: f => f === guard ? link : null, list: () => assert.fail('A junction must not be listed') });
  await assert.rejects(retireLegacyAgent({ install: o.hub, platform: { ...o.platform, processList: async () => assert.fail('No process inventory before path validation') }, stopPid: () => assert.fail('No stop'), delay: async () => {}, list: () => assert.fail('No legacy discovery through junction'), validatePaths }), /symbolic link or junction/); assert.ok(!o.calls.some(c => c[0] === 'trash'));
});
test('retirement validates canonical containment of extras and launcher paths', () => {
  const o = fixture(), file = path.join(o.hub, 'open.vbs'), guard = path.join(o.hub, 'guard'), directory = { isSymbolicLink: () => false, isDirectory: () => true }, regular = { isSymbolicLink: () => false, isDirectory: () => false };
  const metadata = p => p === guard ? directory : p === file ? regular : null;
  assert.throws(() => validateLegacyPaths(o.hub, [file], { platform: o.platform, lstat: metadata, realpath: p => p === file ? path.join(o.base, 'foreign', 'open.vbs') : fs.realpathSync(p) }), /resolves outside/);
  assert.throws(() => validateLegacyPaths(o.hub, [guard], { platform: o.platform, lstat: metadata, realpath: p => p === guard ? path.join(o.base, 'foreign') : fs.realpathSync(p), list: () => assert.fail('Outside directory must not be listed') }), /resolves outside/);
});
test('retirement rechecks containment after process inspection and never trashes a replaced path', async () => {
  const o = fixture(), guard = path.join(o.hub, 'guard'); let changed = false;
  const validatePaths = (install, paths, options) => validateLegacyPaths(install, paths, { ...options, lstat: p => p === guard && changed ? { isSymbolicLink: () => true, isDirectory: () => true } : null });
  await assert.rejects(retireLegacyAgent({ install: o.hub, platform: { ...o.platform, processList: async () => { changed = true; return []; } }, stopPid: () => assert.fail('No stop'), delay: async () => {}, list: () => [], validatePaths }), /symbolic link or junction/); assert.ok(!o.calls.some(c => c[0] === 'trash'));
});
test('a known lexical foreign install that aliases the target cannot authorize deleting old launchers', async () => {
  const o = fixture(), alias = path.join(o.base, 'alias'), old = path.join(o.target, 'open.vbs'); fs.mkdirSync(alias); write(old, 'old launcher fixture'); o.state.shortcut = alias;
  const r = await runInstaller({ action: 'update', target: o.target, 'no-skill': true }, { ...o, resolveInstall: p => p === alias ? fs.realpathSync(o.target) : fs.realpathSync(p) });
  assert.ok(!o.calls.some(c => c[0] === 'trash' && c[2].includes(old))); assert.ok(r.warnings.some(s => /Old launcher files were kept/.test(s)));
});
