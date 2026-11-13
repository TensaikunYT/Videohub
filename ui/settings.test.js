import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { agentName, setAgentName } from './agent.js';
import { sameFolder, setSystemCapabilities } from './system.js';

const source = fs.readFileSync(new URL('./app.js', import.meta.url), 'utf8');
const settingsCode = source.slice(source.indexOf('async function settingsPage'), source.indexOf('// One picker serves'));
function element(tag, attrs = {}, ...children) {
  const el = { tag, ...attrs, value: String(attrs.value || ''), children: children.flat(Infinity).filter(x => x != null),
    append(...next) { this.children.push(...next.flat(Infinity)); } };
  Object.defineProperty(el, 'innerHTML', { set() { this.children = []; } });
  return el;
}
const walk = node => typeof node === 'object' && node ? [node, ...(node.children || []).flatMap(walk)] : [];

async function settings({ platform = 'linux', roots = ['/home/me/film'], failSave = false } = {}) {
  const calls = [], messages = [], pickers = [];
  const config = { capabilities: { platform }, agentName: 'Claude', roots: roots.map(path => ({ path, type: 'container', enabled: true })), archiveDir: '/home/me/archive', maxParallelRenders: 1, secondRenderMinFreeMB: 8000, tools: {}, thumbstudio: {} };
  const ctx = { h: element, sameFolder, setSystemCapabilities, setAgentName, toast: (message, error) => messages.push({ message, error }),
    api: async (url, options) => {
      if (url === '/api/guard/settings') throw new Error('not needed');
      if (url === '/api/hidden') return [];
      if (!options) return config;
      calls.push(JSON.parse(JSON.stringify(options.body)));
      if (failSave) throw new Error('disk is unavailable');
      return { ...config, ...options.body, agentName: String(options.body.agentName || '').trim() || 'Claude' };
    }, renderSpeedControl: () => element('span'),
    folderButton: (start, pick, title, label) => { const el = element('button', {}, label); pickers.push({ start, pick, title, el }); return el; } };
  vm.createContext(ctx); vm.runInContext(settingsCode, ctx);
  const page = element('div'); await ctx.settingsPage(page);
  const button = text => walk(page).find(n => n.tag === 'button' && n.children.includes(text));
  return { page, calls, messages, picker: pickers.find(p => p.title === 'Choose a folder to watch' && p.el.children.includes('📂 Choose folder…')),
    addInput: walk(page).find(n => n.placeholder === 'Absolute path to a folder'),
    agentInput: walk(page).find(n => n.maxlength === '40'), save: () => button('Save').onclick(), add: () => button('Add').onclick() };
}

test('case-distinct Unix watch folders can be added with either entry method', async () => {
  for (const method of ['picker', 'text']) {
    const s = await settings();
    if (method === 'picker') s.picker.pick('/home/me/Film');
    else { s.addInput.value = '/home/me/Film'; s.add(); }
    await s.save();
    assert.deepEqual(s.calls[0].roots.map(r => r.path), ['/home/me/film', '/home/me/Film']);
  }
});

test('both folder entry methods reject duplicate Windows paths without claiming an addition', async () => {
  for (const method of ['picker', 'text']) {
    const s = await settings({ platform: 'win32', roots: ['C:\\Videos\\Film'] });
    if (method === 'picker') s.picker.pick('c:/videos/film/');
    else { s.addInput.value = 'c:/videos/film/'; s.add(); }
    await s.save();
    assert.equal(s.calls[0].roots.length, 1);
    assert.ok(s.messages.some(m => /already in the list/.test(m.message)));
    assert.ok(!s.messages.some(m => /^Added:/.test(m.message)));
  }
});

test('failed settings save keeps the active agent name and reports the failure', async () => {
  setAgentName('Claude');
  const s = await settings({ failSave: true }); s.agentInput.value = 'OpenCode';
  await s.save();
  assert.equal(agentName(), 'Claude');
  assert.equal(s.agentInput.value, 'OpenCode');
  assert.ok(s.messages.some(m => m.error && /Could not save: disk is unavailable/.test(m.message)));
});

test('successful settings save applies the normalized name returned by the server', async () => {
  setAgentName('Claude');
  const s = await settings(); s.agentInput.value = '  OpenCode  ';
  await s.save();
  assert.equal(agentName(), 'OpenCode'); assert.equal(s.agentInput.value, 'OpenCode');
});
