import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('./util.js', import.meta.url), 'utf8');
const code = source.slice(source.indexOf('function realNorm'), source.indexOf('// does a command line')).replace(/\bexport /g, '') + '\nglobalThis.check = isInside;';
function harness(flavor, lookup, lstat = () => missing()) {
  const p = path[flavor], calls = [];
  const key = value => flavor === 'win32' ? p.resolve(value).toLowerCase() : p.resolve(value);
  const ctx = { path: p, norm: key, pathKey: key, fs: { lstatSync: lstat, realpathSync: { native: file => { calls.push(file); return lookup(file); } } } };
  vm.createContext(ctx); vm.runInContext(code, ctx);
  return { check: ctx.check, calls };
}
const missing = () => { throw Object.assign(new Error('missing fixture path'), { code: 'ENOENT' }); };

for (const flavor of ['posix', 'win32']) {
  const p = path[flavor], base = flavor === 'win32' ? 'C:\\' : '/';
  const root = p.join(base, 'allowed'), outside = p.join(base, 'outside'), alias = p.join(base, 'alias');
  test(`${flavor}: a previously authorized file is rejected after its directory link moves outside`, () => {
    let moved = false;
    const child = p.join(root, 'project', 'film.mp4');
    const h = harness(flavor, file => file === child ? (moved ? p.join(outside, 'project', 'film.mp4') : child) : file === root ? root : missing());
    assert.equal(h.check(child, root), true); moved = true;
    assert.equal(h.check(child, root), false);
    assert.equal(h.calls.filter(file => file === child).length, 2);
  });

  test(`${flavor}: a warmed parent alias is resolved again when its target changes`, () => {
    let moved = false; const child = p.join(root, 'film.mp4');
    const h = harness(flavor, file => file === alias ? (moved ? outside : root) : file === child ? child : missing());
    assert.equal(h.check(child, alias), true); moved = true;
    assert.equal(h.check(child, alias), false);
  });

  test(`${flavor}: legitimate aliases allow existing and new descendants with only a check-local cache`, () => {
    const existing = p.join(alias, 'film.mp4'), destination = p.join(alias, 'new', 'thumbnail');
    const h = harness(flavor, file => file === alias ? root : file === existing ? p.join(root, 'film.mp4') : missing());
    assert.equal(h.check(existing, alias), true);
    const before = h.calls.filter(file => file === alias).length;
    assert.equal(h.check(destination, alias), true);
    assert.equal(h.calls.filter(file => file === alias).length, before + 1, 'Reuse the common ancestor only within this check');
  });

  test(`${flavor}: missing destinations beneath an escaping ancestor remain outside`, () => {
    const link = p.join(root, 'link'), destination = p.join(link, 'new', 'file.mp4');
    const h = harness(flavor, file => file === root ? root : file === link ? outside : missing());
    assert.equal(h.check(destination, root), false);
  });

  test(`${flavor}: dangling links are refused instead of being treated as ordinary missing paths`, () => {
    const link = p.join(root, 'dangling');
    const h = harness(flavor, file => file === root ? root : missing(), file => file === link ? { isSymbolicLink: () => true } : missing());
    assert.equal(h.check(link, root), false);
    assert.equal(h.check(p.join(link, 'new', 'file'), root), false);
  });

  test(`${flavor}: inaccessible or otherwise unreadable paths fail closed`, () => {
    const child = p.join(root, 'film.mp4');
    for (const code of ['EACCES', 'EPERM', 'EIO']) {
      const denied = file => { throw Object.assign(new Error('denied fixture path: ' + file), { code }); };
      assert.equal(harness(flavor, file => file === root ? root : denied(file)).check(child, root), false);
      assert.equal(harness(flavor, file => file === child ? child : denied(file)).check(child, root), false);
    }
  });

  test(`${flavor}: ENOTDIR resolves the existing ancestor without allowing sibling prefixes`, () => {
    const h = harness(flavor, file => {
      if (file === root) return root;
      throw Object.assign(new Error('not a directory'), { code: 'ENOTDIR' });
    });
    assert.equal(h.check(p.join(root, 'new', 'file'), root), true);
    assert.equal(h.check(p.join(base, 'allowed-other', 'file'), root), false);
  });
}
