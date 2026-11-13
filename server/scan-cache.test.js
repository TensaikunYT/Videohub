import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('./scan.js', import.meta.url), 'utf8');
const code = source.slice(source.indexOf('async function samePicture('), source.indexOf('// ---------- roles of finished videos'));
const clip = name => ({ path: '/films/' + name + '.mp4', size: 100, mtime: 1, info: { dur: 10 } });

test('case-sensitive video pairs cannot reuse another pair\'s similarity result', async () => {
  let decoded = 0;
  const ctx = vm.createContext({ simCache: {}, SIM_FILE: 'fake-cache', writeJson() {}, casePath: p => p,
    tinyFrame: async file => { decoded++; return Buffer.alloc(144, file.endsWith('/b.mp4') ? 255 : 0); } });
  vm.runInContext(code, ctx);
  assert.equal(await ctx.samePicture(clip('A'), clip('B')), true);
  const cachedAt = decoded; assert.equal(await ctx.samePicture(clip('A'), clip('B')), true); assert.equal(decoded, cachedAt);
  assert.equal(await ctx.samePicture(clip('a'), clip('b')), false); assert.ok(decoded > cachedAt);
});

test('Windows spelling variants still reuse the same video comparison', async () => {
  let decoded = 0;
  const ctx = vm.createContext({ simCache: {}, SIM_FILE: 'fake-cache', writeJson() {}, casePath: p => p.toLowerCase(),
    tinyFrame: async () => { decoded++; return Buffer.alloc(144); } });
  vm.runInContext(code, ctx);
  assert.equal(await ctx.samePicture(clip('A'), clip('B')), true); const cachedAt = decoded;
  assert.equal(await ctx.samePicture(clip('a'), clip('b')), true); assert.equal(decoded, cachedAt);
});

test('legacy lowercase cache entries cannot keep a false duplicate match alive after upgrading', async () => {
  const a = clip('a'), b = clip('b'), legacy = [a.path, a.size, a.mtime, b.path, b.size, b.mtime].join('|');
  const ctx = vm.createContext({ simCache: { [legacy]: true }, SIM_FILE: 'fake-cache', writeJson() {}, casePath: p => p,
    tinyFrame: async file => Buffer.alloc(144, file === b.path ? 255 : 0) });
  vm.runInContext(code, ctx); assert.equal(await ctx.samePicture(a, b), false);
});
