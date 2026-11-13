import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { parseJsonc, integrateAgents, agentPaths, detectAgents, parseAgentOptions, executeAgent } from './agents.mjs';
import { IS_WIN } from '../server/platform.js';
const hub = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const scratch = () => { const home = path.join(hub, '.test-tmp', 'agents-' + randomUUID()); fs.mkdirSync(home, { recursive: true }); return { home, env: { PATH: '', XDG_CONFIG_HOME: path.join(home, '.config') }, hub, find: () => null }; };
const write = (f, s) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, s); };

test('JSONC preserves quoted URLs, escaped quotes, comment-like strings and trailing comma strings', () => {
  assert.deepEqual(parseJsonc('{/* header */ "url":"https://example.invalid/a,}", // keep URL\n "array": ["//", "\\\"",],}'), { url: 'https://example.invalid/a,}', array: ['//', '"'] });
  assert.throws(() => parseJsonc('{/* bad'), /Unclosed/);
});
test('JSONC accepts comments after trailing commas while preserving commas inside strings', () => {
  assert.deepEqual(parseJsonc('{"array":["keep,}", /* last item */], "number":1, // final field\n}'), { array: ['keep,}'], number: 1 });
});
test('agent helper rejects typos and missing values instead of installing with default options', () => {
  assert.throws(() => parseAgentOptions(['--agnts', 'opencode']), /Unknown option/); assert.throws(() => parseAgentOptions(['--agents']), /Missing value/); assert.throws(() => parseAgentOptions(['--global-rule', 'maybe']), /yes or no/); assert.deepEqual(parseAgentOptions(['--help']), { '--help': true });
});
test('OpenCode fallback installs rules and skill into fake home, preserves unrelated JSONC keys, and reruns once', async () => {
  const o = scratch(), p = agentPaths('opencode', o); write(path.join(p.dir, 'opencode.jsonc'), '{ // user setting\n "theme":"mine", "mcp":{"servers":{"other":{"command":["other"]}}},}');
  write(p.rule, '# Personal rules\nKeep this rule.\n');
  const r = await integrateAgents({ ...o, agents: ['opencode'] }); assert.deepEqual(r.errors, []); assert.equal(r.agentName, 'OpenCode');
  const f = path.join(p.dir, 'opencode.jsonc'), j = JSON.parse(fs.readFileSync(f, 'utf8'));
  assert.equal(j.theme, 'mine'); assert.deepEqual(j.mcp.servers.other.command, ['other']); assert.deepEqual(j.mcp.servers.videohub.command, ['node', path.join(hub, 'server', 'mcp.js')]); assert.equal(j.mcp.servers.videohub.disabled, false);
  assert.match(fs.readFileSync(p.rule, 'utf8'), /Personal rules/); assert.match(fs.readFileSync(path.join(p.skill, 'SKILL.md'), 'utf8'), /description:/);
  await integrateAgents({ ...o, agents: ['opencode'] }); assert.equal([...fs.readFileSync(p.rule, 'utf8').matchAll(/<!-- videohub:begin/g)].length, 1);
  assert.equal(fs.existsSync(path.join(o.home, '.claude')), false);
});
test('dry run prints OpenCode steps without writing to fake home', async () => {
  const o = scratch(), r = await integrateAgents({ ...o, agents: ['opencode'], dryRun: true }); assert.deepEqual(r.errors, []); assert.ok(r.actions.some(x => /register OpenCode/.test(x))); assert.equal(fs.existsSync(agentPaths('opencode', o).dir), false);
});
test('MCP registration uses OpenCode CLI and verifies list; existing owned entry can be replaced', async () => {
  const o = scratch(), calls = [], run = (f, a) => { calls.push(a); return { status: 0, stdout: a.includes('list') ? 'videohub connected' : '' }; };
  let r = await integrateAgents({ ...o, agents: ['opencode'], find: () => 'opencode', run, globalRule: false }); assert.deepEqual(r.errors, []);
  assert.deepEqual(calls[0], ['mcp', 'add', 'videohub', '--global', '--', 'node', path.join(hub, 'server', 'mcp.js')]); assert.deepEqual(calls[1], ['mcp', 'list']);
  const p = agentPaths('opencode', o); write(p.config, JSON.stringify({ mcp: { servers: { videohub: { command: ['node', path.join(hub, 'server', 'mcp.js')] } } } }));
  calls.length = 0; r = await integrateAgents({ ...o, agents: ['opencode'], find: () => 'opencode', run, globalRule: false }); assert.deepEqual(r.errors, []); assert.deepEqual(calls[0], ['mcp', 'remove', 'videohub', '--global']);
});
test('foreign integrations and malformed configs remain unchanged', async () => {
  const o = scratch(), p = agentPaths('opencode', o), text = JSON.stringify({ mcp: { servers: { videohub: { command: ['node', '/other-install/server/mcp.js'] } } } }); write(p.config, text); write(path.join(p.skill, 'SKILL.md'), 'Other install'); write(p.rule, '<!-- videohub:begin -->\n/other-install/server/cli.js\n<!-- videohub:end -->');
  const r = await integrateAgents({ ...o, agents: ['opencode'] }); assert.deepEqual(r.errors, []); assert.equal(fs.readFileSync(p.config, 'utf8'), text); assert.equal(fs.readFileSync(path.join(p.skill, 'SKILL.md'), 'utf8'), 'Other install');
  write(p.config, '{ unreadable'); const bad = await integrateAgents({ ...o, agents: ['opencode'] }); assert.match(bad.errors[0], /left unchanged/); assert.equal(fs.readFileSync(p.config, 'utf8'), '{ unreadable');
});

test('a foreign MCP entry does not get a mismatched new skill or rule', async () => {
  const o = scratch(), p = agentPaths('opencode', o);
  write(p.config, JSON.stringify({ mcp: { servers: { videohub: { command: ['node', '/other-install/server/mcp.js'] } } } }));
  const r = await integrateAgents({ ...o, agents: ['opencode'] });
  assert.deepEqual(r.errors, []); assert.equal(fs.existsSync(p.skill), false); assert.equal(fs.existsSync(p.rule), false);
});
test('uninstall removes only owned entries/rule and recycles skill; supports CLI without remove', async () => {
  const o = scratch(); await integrateAgents({ ...o, agents: ['opencode'] }); const p = agentPaths('opencode', o), recycled = [];
  const r = await integrateAgents({ ...o, action: 'uninstall', agents: ['opencode'], find: () => 'opencode', run: () => ({ status: 0, stdout: 'add list' }), recycle: async a => { recycled.push(...a); return a.map(p => ({ path: p, ok: true })); } });
  assert.deepEqual(r.errors, []); assert.deepEqual(recycled, [p.skill]); assert.equal(JSON.parse(fs.readFileSync(p.config, 'utf8')).mcp.servers.videohub, undefined); assert.doesNotMatch(fs.readFileSync(p.rule, 'utf8'), /videohub:begin/);
});
test('agent detection uses fake home and supplied PATH lookup', () => {
  const o = scratch(); fs.mkdirSync(agentPaths('opencode', o).dir, { recursive: true }); assert.deepEqual(detectAgents(o), ['opencode']); assert.deepEqual(detectAgents({ ...o, find: n => n === 'claude' ? 'claude' : null }), ['claude', 'opencode']);
});
test('all injected agent CLI calls receive the selected fake environment', async () => {
  const o = scratch(), calls = [];
  const r = await integrateAgents({ ...o, agents: ['opencode'], find: () => 'opencode', run: (_f, args, options) => { calls.push(options.env); return { status: 0, stdout: args.includes('list') ? 'videohub' : '' }; } });
  assert.deepEqual(r.errors, []); assert.equal(calls.length, 2); assert.ok(calls.every(env => env === o.env));
});
test('uninstall preserves conflicting legacy and V2 MCP entries and removes only its own rule block', async () => {
  const o = scratch(), p = agentPaths('opencode', o), foreign = '<!-- videohub:begin -->\n/other-install/server/cli.js\n<!-- videohub:end -->';
  const cfg = { mcp: { videohub: { command: ['node', '/other-install/server/mcp.js'] }, servers: { videohub: { command: ['node', path.join(hub, 'server', 'mcp.js')] } } } }; write(p.config, JSON.stringify(cfg));
  const own = '<!-- videohub:begin -->\n' + hub.replace(/\\/g, '/') + '/server/cli.js\n<!-- videohub:end -->'; write(p.rule, '\n  Personal rule\n\n' + own + '\n' + foreign + '\n\n');
  const r = await integrateAgents({ ...o, action: 'uninstall', agents: ['opencode'] }); assert.deepEqual(r.errors, []); assert.deepEqual(JSON.parse(fs.readFileSync(p.config, 'utf8')), cfg); assert.equal(fs.readFileSync(p.rule, 'utf8'), '\n  Personal rule\n\n\n' + foreign + '\n\n');
});
test('a path embedded inside another install path does not claim ownership of its skill or rule', async () => {
  const o = scratch(), p = agentPaths('opencode', o), foreign = '/other-prefix' + hub.replace(/\\/g, '/') + '/server/cli.js';
  write(path.join(p.skill, 'SKILL.md'), foreign); write(p.rule, '<!-- videohub:begin -->\n' + foreign + '\n<!-- videohub:end -->'); const recycled = [];
  const r = await integrateAgents({ ...o, action: 'uninstall', agents: ['opencode'], recycle: async a => { recycled.push(...a); return []; } }); assert.deepEqual(r.errors, []); assert.deepEqual(recycled, []); assert.match(fs.readFileSync(p.rule, 'utf8'), /other-prefix/);
});
test('Windows agent batch shims preserve special path characters and the supplied fake home', t => {
  if (!IS_WIN) { t.skip('Windows batch execution'); return; }
  const o = scratch(), out = path.join(o.home, 'capture.json'), capture = path.join(o.home, 'capture.mjs'), shim = path.join(o.home, '%VIDEOHUB_TRAP% & tools!', 'opencode.cmd');
  write(capture, 'import fs from "node:fs";fs.writeFileSync(' + JSON.stringify(out) + ',JSON.stringify({args:process.argv.slice(2),home:process.env.HOME,marker:process.env.VIDEOHUB_FAKE_MARKER}));');
  write(shim, '@echo off\r\n"' + process.execPath + '" "' + capture + '" %*\r\n');
  const env = { ...process.env, HOME: o.home, USERPROFILE: o.home, APPDATA: path.join(o.home, 'AppData'), LOCALAPPDATA: path.join(o.home, 'Local'), XDG_CONFIG_HOME: o.env.XDG_CONFIG_HOME, VIDEOHUB_TRAP: 'SHOULD_NOT_EXPAND', VIDEOHUB_FAKE_MARKER: 'fake-only' };
  const args = ['mcp', 'add', path.join(o.home, '%VIDEOHUB_TRAP% & film!')], r = executeAgent(shim, args, { env }); assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(JSON.parse(fs.readFileSync(out, 'utf8')), { args, home: o.home, marker: 'fake-only' });
});
