// The Mac setup helper on a scratch home folder: never your real ~/.claude, ~/Applications or LaunchAgents
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fillPaths, rule, skill, mcpJson, appFiles, app, appIsMine, answers, HUB, BEGIN, END } from './mac-install.mjs';

const home = () => { const d = path.join(HUB, '.test-tmp', 'mac-home-' + randomUUID().slice(0, 8)); fs.mkdirSync(d, { recursive: true }); return d; };

test('Windows paths in the shared texts become this install\'s Mac paths; JSON escapes stay', () => {
  const t = 'see `{{VIDEOHUB_DIR}}\\docs\\PROJECT-CONTRACT.md` or node "{{VIDEOHUB_DIR}}\\server\\cli.js" hub_live "{\\"project\\":\\"x\\"}"';
  assert.equal(fillPaths(t, '/Apps/Video Hub'), 'see `/Apps/Video Hub/docs/PROJECT-CONTRACT.md` or node "/Apps/Video Hub/server/cli.js" hub_live "{\\"project\\":\\"x\\"}"');
});

test('the global rule: added after the user\'s own text, replaced on a re-run, removed only when it is this install\'s', () => {
  const h = home(), f = path.join(h, '.claude', 'CLAUDE.md');
  fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, '# mine\nkeep this\n');
  assert.equal(rule({ home: h, dryRun: true }).action, 'would add the VideoHub block'); assert.equal(fs.readFileSync(f, 'utf8'), '# mine\nkeep this\n');
  assert.equal(rule({ home: h }).action, 'added'); assert.equal(rule({ home: h }).action, 'replaced');
  const txt = fs.readFileSync(f, 'utf8');
  assert.ok(txt.startsWith('# mine\nkeep this\n\n' + BEGIN)); assert.equal(txt.split(BEGIN).length, 2); assert.ok(txt.includes(END)); assert.ok(txt.includes(HUB + '/docs/PROJECT-CONTRACT.md'));
  assert.ok(fs.existsSync(f + '.videohub-backup'));
  assert.equal(rule({ home: h, remove: true, hub: '/Another/VideoHub' }).action, 'kept');
  assert.equal(rule({ home: h, remove: true }).action, 'removed'); assert.equal(fs.readFileSync(f, 'utf8'), '# mine\nkeep this\n');
});

test('the skill gets this install\'s path; the MCP server goes into ~/.claude.json with an absolute node, never over a broken file', async () => {
  const h = home();
  assert.equal((await skill({ home: h })).action, 'installed');
  const sk = fs.readFileSync(path.join(h, '.claude', 'skills', 'videohub', 'SKILL.md'), 'utf8'); assert.ok(sk.includes(HUB)); assert.ok(!sk.includes('{{VIDEOHUB_DIR}}'));
  const cj = path.join(h, '.claude.json'); fs.writeFileSync(cj, JSON.stringify({ theme: 'dark', mcpServers: { other: { command: 'x' } } }));
  assert.equal(mcpJson({ home: h, node: '/opt/homebrew/bin/node' }).action, 'registered');
  let j = JSON.parse(fs.readFileSync(cj, 'utf8')); assert.equal(j.theme, 'dark'); assert.equal(j.mcpServers.other.command, 'x');
  assert.deepEqual(j.mcpServers.videohub, { type: 'stdio', command: '/opt/homebrew/bin/node', args: [path.join(HUB, 'server', 'mcp.js')], env: {} });
  assert.equal(mcpJson({ home: h, remove: true }).action, 'removed'); j = JSON.parse(fs.readFileSync(cj, 'utf8')); assert.equal(j.mcpServers.videohub, undefined); assert.ok(j.mcpServers.other);
  fs.writeFileSync(cj, '{ broken'); assert.equal(mcpJson({ home: h }).action, 'unreadable'); assert.equal(fs.readFileSync(cj, 'utf8'), '{ broken');
});

test('VideoHub.app: a launcher for this install (quoted paths), never over another install\'s app', async () => {
  const files = appFiles('/Apps/It\'s Hub', '/opt/homebrew/bin/node');
  assert.match(files['Contents/Info.plist'], /<key>CFBundleExecutable<\/key><string>VideoHub<\/string>/); assert.match(files['Contents/Info.plist'], /LSUIElement/);
  assert.ok(files['Contents/MacOS/VideoHub'].includes(`exec /bin/bash '/Apps/It'\\''s Hub/open-mac.sh' "$@"`));
  const h = home(), dest = path.join(h, 'Applications');
  const r = await app({ dest, icon: false }); assert.equal(r.action, 'created'); assert.equal(appIsMine(r.app), true);
  assert.equal(fs.statSync(path.join(r.app, 'Contents', 'MacOS', 'VideoHub')).mode & 0o111, 0o111);
  assert.equal((await app({ dest, hub: '/Another/VideoHub', icon: false })).action, 'kept');
});

test('answers a re-run keeps', () => {
  const hub = home(); fs.mkdirSync(path.join(hub, 'data'));
  assert.deepEqual(answers({ hub }), {});
  assert.deepEqual(answers({ hub, set: ['app=yes', 'startup=no', 'bad'] }), { app: 'yes', startup: 'no' });
  assert.deepEqual(answers({ hub }), { app: 'yes', startup: 'no' });
});
