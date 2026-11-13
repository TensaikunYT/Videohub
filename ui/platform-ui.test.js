import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('./app.js', import.meta.url), 'utf8');
function element(tag, attrs = {}, ...children) {
  return { tag, ...attrs, value: attrs.value || '', children: children.flat(Infinity).filter(c => c != null),
    append(...next) { this.children.push(...next.flat(Infinity)); }, replaceWith() {} };
}
const descendants = node => typeof node === 'object' && node ? [node, ...(node.children || []).flatMap(descendants)] : [];
const textOf = node => typeof node === 'object' && node ? (node.children || []).map(textOf).join(' ') : String(node ?? '');
const event = { preventDefault() {}, stopPropagation() {} };

function picker(result, answer = true, entered = '/home/me/films') {
  const picked = [], dialogs = [], errors = [];
  const ctx = { h: element, api: async () => result, toast: message => errors.push(message),
    confirmBox: async (title, body) => { dialogs.push({ title, body }); descendants(body).find(n => n.tag === 'input').value = entered; return answer; } };
  vm.createContext(ctx);
  vm.runInContext(source.slice(source.indexOf('export function folderButton')).replace('export function', 'function'), ctx);
  const button = ctx.folderButton(() => '/home/me/start', value => picked.push(value));
  return { picked, dialogs, errors, button, click: () => button.onclick(event) };
}

test('desktops without a folder picker offer a typed path for every shared picker caller', async () => {
  const p = picker({ unsupported: true }, true, '  /home/me/new films  ');
  await p.click();
  assert.deepEqual(p.picked, ['/home/me/new films']);
  assert.equal(p.dialogs.length, 1); assert.equal(p.errors.length, 0); assert.equal(p.button.disabled, false);
});

test('native cancellation and text entry cancellation leave the folder unchanged', async () => {
  for (const p of [picker({ path: null }), picker({ unsupported: true }, false), picker({ unsupported: true }, true, '   ')]) {
    await p.click(); assert.deepEqual(p.picked, []); assert.equal(p.button.disabled, false);
  }
  const p = picker({ path: '/home/me/chosen' }); await p.click();
  assert.deepEqual(p.picked, ['/home/me/chosen']); assert.equal(p.dialogs.length, 0);
});

function panel(capabilities) {
  const ctx = { h: element, navigator: { hardwareConcurrency: 8 }, api: async () => ({}), toast() {}, setTimeout, clearTimeout };
  vm.createContext(ctx);
  vm.runInContext(source.slice(source.indexOf('const PRESETS ='), source.indexOf('// ---------- Disk')), ctx);
  return ctx.guardPanel({ CapActive: 90, SlowCapPct: 5, PauseMB: 2000, CriticalMB: 500, LowPrio: true, capabilities }, { full: true });
}

test('systems without affinity show the reason and retain RAM and priority protection controls', () => {
  const p = panel({ cpuAffinity: false, cpuLimitReason: 'CPU limit not available on this system' });
  const fields = descendants(p).map(n => n['data-guard-setting']).filter(Boolean);
  assert.ok(!fields.includes('CapActive')); assert.ok(!fields.includes('SlowCapPct'));
  for (const field of ['LowPrio', 'PauseMB', 'CriticalMB', 'Startup']) assert.ok(fields.includes(field));
  assert.match(textOf(p), /CPU limit not available/); assert.doesNotMatch(textOf(p), /every core|90% of the cores/);
});

test('systems with affinity keep render power controls and Windows-compatible defaults', () => {
  for (const capabilities of [{ cpuAffinity: true }, undefined]) {
    const p = panel(capabilities), fields = descendants(p).map(n => n['data-guard-setting']);
    assert.ok(fields.includes('CapActive')); assert.ok(fields.includes('SlowCapPct')); assert.match(textOf(p), /Full power/);
  }
});

test('macOS explains the missing core limit while retaining available protection', () => {
  const p = panel({ platform: 'darwin', cpuAffinity: false, cpuLimitReason: 'macOS does not support CPU-core limits; priority and RAM protection remain available.' });
  assert.match(textOf(p), /macOS does not support CPU-core limits/);
  assert.ok(!descendants(p).some(n => n['data-guard-setting'] === 'CapActive'));
  assert.ok(descendants(p).some(n => n['data-guard-setting'] === 'LowPrio'));
});
