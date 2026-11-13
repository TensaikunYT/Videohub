import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const code = fs.readFileSync(new URL('./renderbtn.js', import.meta.url), 'utf8')
  .replace(/^import .+;\r?$/gm, '').replace('export function', 'function');

test('rapid clicks and a late job-list response cannot open duplicate render dialogs', async () => {
  let finishList, finishDialog, dialogs = 0, queued = 0;
  const h = (tag, attrs = {}, ...children) => ({ ...attrs, children,
    replaceChildren(...next) { this.children = next; }, classList: { add() {}, remove() {} } });
  const ctx = {
    h, onHubEvent: () => () => {}, folderButton: () => h('button'), toast() {},
    localStorage: { getItem: () => null },
    confirmBox: () => { dialogs++; return new Promise(resolve => { finishDialog = resolve; }); },
    api: (url, opts) => {
      if (url === '/api/jobs' && !opts) return new Promise(resolve => { finishList = resolve; });
      if (url === '/api/jobs' && opts) { queued++; throw new Error('This test must never start a render'); }
      if (url.endsWith('/recipe')) return Promise.resolve({ script: 'render.js', env: {} });
      return Promise.resolve({ script: 'render.js', workers: { default: 1, max: 1 }, info: {} });
    },
  };
  vm.createContext(ctx); vm.runInContext(code, ctx);
  const { el } = ctx.createRenderButton({ id: 'project' }, { notes: () => [] });
  const first = el.onclick();
  for (let i = 0; i < 8; i++) await Promise.resolve();
  assert.equal(dialogs, 1); finishList([]); await Promise.resolve();
  assert.equal(el.disabled, true); await el.onclick(); assert.equal(dialogs, 1);
  finishDialog(false); await first; assert.equal(el.disabled, false); assert.equal(queued, 0);
});

test('the render dialog offers a probed VideoToolbox encoder without starting a job on cancellation', async () => {
  let body, queued = 0;
  const h = (tag, attrs = {}, ...children) => ({ tag, ...attrs, children: children.flat(Infinity).filter(x => x != null), replaceChildren(...next) { this.children = next; } });
  const ctx = { h, onHubEvent: () => () => {}, folderButton: () => h('button'), toast() {}, localStorage: { getItem: () => null },
    api: async (url, opts) => {
      if (url === '/api/jobs') { if (opts) queued++; return []; }
      if (url.endsWith('/recipe')) return { script: 'render.js', env: {} };
      return { script: 'render.js', workers: { default: 1, max: 1 }, codecs: ['auto', 'videotoolbox', 'x264'], codecEnv: 'VIDEOHUB_ENCODER', codecLabels: { videotoolbox: 'Mac graphics (VideoToolbox)' }, info: {} };
    }, confirmBox: async (title, content) => { body = content; return false; } };
  vm.createContext(ctx); vm.runInContext(code, ctx);
  const { el } = ctx.createRenderButton({ id: 'mac-template' }, { notes: () => [] });
  await el.onclick();
  const walk = node => typeof node === 'object' && node ? [node, ...(node.children || []).flatMap(walk)] : [];
  const option = walk(body).find(n => n.tag === 'option' && n.value === 'videotoolbox');
  assert.ok(option); assert.deepEqual(option.children, ['Mac graphics (VideoToolbox)']); assert.equal(queued, 0);
});
