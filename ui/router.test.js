import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

// the hash router of ui/app.js, run with stub pages
const source = fs.readFileSync(new URL('./app.js', import.meta.url), 'utf8');
const routerCode = source.slice(source.indexOf('// ---------- router'), source.indexOf('const agentReady'));

function router(hash, over = {}) {
  const calls = [], cleaned = [];
  const location = { hash, replace(h) { calls.push('replace ' + h); this.hash = h; } };
  const page = name => async () => { calls.push(name); return () => cleaned.push(name); };
  const ctx = { location, agentReady: Promise.resolve(), shellRoute() { }, $: () => ({ innerHTML: '', append() { } }), h: () => ({ append() { } }) };
  for (const n of ['nowPage', 'skillsPage', 'filesPage', 'planPage', 'outputsPage', 'projectsPage', 'projectPage', 'reviewPage', 'rendersPage', 'diskPage', 'settingsPage']) ctx[n] = page(n);
  Object.assign(ctx, typeof over === 'function' ? over(ctx, page) : over);
  vm.createContext(ctx); vm.runInContext(routerCode + '\nglobalThis.go = render;', ctx);
  return { go: (...a) => ctx.go(...a), calls, cleaned, location };
}

test('an old Thumbnail Studio link (or any unknown page) lands on Films', async () => {
  for (const hash of ['#/thumbstudio', '#/thumbstudio/abc/20261104-k3f9', '#/nothing-here']) {
    const r = router(hash); await r.go();
    assert.deepEqual(r.calls, ['replace #/']);
    r.calls.length = 0; await r.go();
    assert.deepEqual(r.calls, ['projectsPage']);
  }
  const r = router('#/now'); await r.go(); assert.deepEqual(r.calls, ['nowPage']);
});

test('a page that finishes loading after the user moved on is cleaned up at once', async () => {
  let loaded; const slow = new Promise(res => { loaded = res; });
  const r = router('#/skills', (ctx, page) => ({ skillsPage: async (...a) => { await slow; return page('skillsPage')(...a); } }));
  const first = r.go(); await new Promise(res => setImmediate(res));   // the Skills page is loading
  r.location.hash = '#/now'; await r.go();
  loaded(); await first;
  assert.deepEqual(r.calls, ['nowPage', 'skillsPage']); assert.deepEqual(r.cleaned, ['skillsPage']);
});

test('the rail and the UI have no Thumbnail Studio left', () => {
  const ui = new URL('./', import.meta.url);
  const files = fs.readdirSync(ui, { recursive: true }).filter(f => /\.(js|css|html)$/.test(f) && !/\.test\.js$/.test(f));
  for (const f of files) assert.doesNotMatch(fs.readFileSync(new URL(f.replaceAll('\\', '/'), ui), 'utf8'), /thumbstudio|hub_thumb|thumbnail studio/i, f);
});
