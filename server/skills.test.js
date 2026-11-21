import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createSkills, skillRoots, bareName, skillHash, DEPTH } from './skills.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '.test-tmp');
const md = (name, desc, body = '# ' + name + '\n') => `---\nname: ${name}\ndescription: ${desc}\n---\n${body}`;
function put(file, text) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text); }
function fakeHome() {
  const home = path.join(root, 'skills-' + crypto.randomUUID());
  const C = path.join(home, '.claude', 'skills'), X = path.join(home, '.codex', 'skills'), A = path.join(home, '.agents', 'skills');
  put(path.join(C, 'scanline', 'SKILL.md'), md('scanline', 'Builds 3D shorts.'));
  put(path.join(C, 'scanline', 'references', 'camera.md'), '# Camera\n');
  put(path.join(C, 'scanline', 'models', 'gear.glb'), Buffer.from([0x67, 0x6c, 0x54, 0x46, 0, 0, 0, 2]));
  put(path.join(C, 'scanline', 'big.txt'), 'x'.repeat(300 * 1024));
  put(path.join(C, 'scanline', 'latin1.txt'), Buffer.from([0x63, 0x61, 0x66, 0xe9]));
  put(path.join(C, 'shared-one', 'SKILL.md'), md('shared-one', 'Same everywhere.').replace(/\n/g, '\r\n'));
  put(path.join(A, 'shared-one', 'SKILL.md'), md('shared-one', 'Same everywhere.'));   // only line endings differ: not "differs"
  put(path.join(X, 'scanline', 'SKILL.md'), md('scanline', 'An older copy.'));
  put(path.join(X, '.system', 'imagegen', 'SKILL.md'), md('imagegen', 'Codex system skill.'));
  put(path.join(C, 'synced', 'bucket-1', 'docx', 'SKILL.md'), md('docx', 'Synced from the desktop app.'));
  put(path.join(C, 'a', 'b', 'c', 'too-deep', 'SKILL.md'), md('too-deep', 'Four levels down.'));
  put(path.join(C, 'not-a-skill', 'README.md'), '# nothing');
  put(path.join(home, 'secret.txt'), 'OUTSIDE-SECRET');
  return { home, C, X, A };
}

test('skill folders: each agent root, its own overrides, and namespaced names', () => {
  const home = '/h', P = path.posix;
  const r = skillRoots({ home, env: {}, path: P, key: x => x });
  assert.deepEqual(r.map(x => [x.agent, x.dir]), [['claude', '/h/.claude/skills'], ['codex', '/h/.codex/skills'], ['opencode', '/h/.config/opencode/skills'], ['shared', '/h/.agents/skills']]);
  const o = skillRoots({ home, env: { CLAUDE_CONFIG_DIR: '/c', CODEX_HOME: '/x', XDG_CONFIG_HOME: '/cfg' }, path: P, key: x => x });
  assert.deepEqual(o.map(x => x.dir), ['/h/.claude/skills', '/c/skills', '/h/.codex/skills', '/x/skills', '/cfg/opencode/skills', '/h/.agents/skills']);
  assert.equal(bareName('anthropic-skills:docx'), 'docx'); assert.equal(bareName('videohub'), 'videohub');
  assert.equal(skillHash('a\r\nb\r\n'), skillHash('a\nb'));
});

test('discovery: nested layouts up to the depth limit, one row per name with its agents and whether copies differ', async () => {
  const { home } = fakeHome();
  const s = createSkills({ home, env: {} });
  const c = await s.all();
  const names = c.list.map(x => x.agent + ':' + x.name).sort();
  assert.deepEqual(names, ['claude:docx', 'claude:scanline', 'claude:shared-one', 'codex:imagegen', 'codex:scanline', 'shared:shared-one']);
  assert.equal(DEPTH, 3);
  const rows = s.rows(c), by = n => rows.find(r => r.name === n);
  assert.deepEqual(by('scanline').agents.map(a => a.agent), ['claude', 'codex']);
  assert.equal(by('scanline').differs, true);
  assert.equal(by('scanline').description, 'Builds 3D shorts.', 'the first agent’s copy describes the row');
  assert.equal(by('shared-one').differs, false, 'line endings alone do not make copies different');
  assert.equal(by('docx').agents[0].where, 'synced/bucket-1');
  assert.equal(by('imagegen').agents[0].where, '.system');
  assert.equal(by('scanline').files, 5);
  assert.equal(c.roots.find(r => r.agent === 'opencode').exists, false);
});

test('files: text, binary, too large and not UTF-8; tree lists every file', async () => {
  const { home } = fakeHome();
  const s = createSkills({ home, env: {} });
  const k = await s.find('claude', 'scanline');
  assert.equal((await s.file(k, 'SKILL.md')).kind, 'text');
  assert.equal((await s.file(k, 'references/camera.md')).text, '# Camera\n');
  assert.equal((await s.file(k, 'references\\camera.md')).kind, 'text', 'either slash');
  assert.equal((await s.file(k, 'models/gear.glb')).kind, 'binary');
  const big = await s.file(k, 'big.txt'); assert.equal(big.kind, 'large'); assert.equal(big.text, undefined);
  assert.equal((await s.file(k, 'latin1.txt')).kind, 'binary');
  const t = await s.tree(k);
  assert.deepEqual(t.entries.filter(e => e.kind === 'file').map(e => e.rel), ['big.txt', 'latin1.txt', 'models/gear.glb', 'references/camera.md', 'SKILL.md'].sort((a, b) => a.localeCompare(b)));
  assert.ok(t.entries.some(e => e.kind === 'dir' && e.rel === 'references'));
  assert.equal(await s.find('claude', 'nope'), null);
  await assert.rejects(s.file(k, 'missing.md'), e => e.code === 404);
});

test('paths stay inside the skill folder: "..", absolute, drive, stream and link escapes are refused', async () => {
  const { home, C } = fakeHome();
  const s = createSkills({ home, env: {} });
  const k = await s.find('claude', 'scanline');
  for (const bad of ['../shared-one/SKILL.md', '..\\..\\..\\secret.txt', 'references/../../shared-one/SKILL.md', path.join(home, 'secret.txt'), '/etc/passwd', 'C:/Windows/win.ini', '\\\\server\\share\\x', 'SKILL.md:stream', '.', '', 'a\0b', null, 42]) {
    await assert.rejects(s.file(k, bad), e => e.code === 400, 'refused: ' + JSON.stringify(bad));
  }
  // a junction (Windows) or symlink pointing outside, and a file link pointing outside
  const out = path.join(home, 'outside-dir'); put(path.join(out, 'x.md'), 'OUTSIDE-SECRET');
  let dirLink = false, fileLink = false;
  try { fs.symlinkSync(out, path.join(C, 'scanline', 'linked'), 'junction'); dirLink = true; } catch { }
  try { fs.symlinkSync(path.join(home, 'secret.txt'), path.join(C, 'scanline', 'secret-link.txt'), 'file'); fileLink = true; } catch { }   // needs a privilege on Windows
  if (dirLink) {
    await assert.rejects(s.file(k, 'linked/x.md'), e => e.code === 403);
    const t = await s.tree(k), e = t.entries.find(x => x.rel === 'linked');
    assert.equal(e.kind, 'link'); assert.equal(e.outside, true);
    assert.ok(!t.entries.some(x => x.rel.startsWith('linked/')), 'a link leading out is not entered');
  }
  if (fileLink) {
    await assert.rejects(s.file(k, 'secret-link.txt'), e => e.code === 403);
    assert.equal((await s.tree(k)).entries.find(x => x.rel === 'secret-link.txt').kind, 'link');
  }
  // a link inside the folder that stays inside is fine
  try { fs.symlinkSync(path.join(C, 'scanline', 'references'), path.join(C, 'scanline', 'refs-again'), 'junction'); assert.equal((await s.file(k, 'refs-again/camera.md')).kind, 'text'); } catch (e) { if (e.code !== 'EPERM') throw e; }
  // the resolved SKILL.md for "Open in editor" is the folder's own
  assert.equal(path.basename(await s.resolve(k, 'SKILL.md')), 'SKILL.md');
  assert.ok(dirLink || process.platform !== 'win32', 'junctions work on Windows without a privilege');
});
