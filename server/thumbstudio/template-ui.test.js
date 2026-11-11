import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { applyTemplateSlots, loadBuiltinTemplates } from './templates.js';

// Importing app.js starts routing and SSE. Evaluate the actual gallery module
// with just its DOM and drawScene dependencies stubbed instead.
const source = fs.readFileSync(new URL('../../ui/thumbstudio/templates.js', import.meta.url), 'utf8')
  .replace(/^import .+;\r?$/gm, '')
  .replace(/^export function /gm, 'function ');
const selection = loadBuiltinTemplates().filter(t => t.tags?.includes('reference-picks'));

function harness() {
  const draws = [], errors = [];
  function h(tag, props = {}, ...children) {
    const node = { tag, props, children: children.flat(Infinity).filter(Boolean) };
    if (tag === 'canvas') {
      const context = { canvas: node };
      node.getContext = kind => {
        assert.equal(kind, '2d');
        return context;
      };
    }
    return node;
  }
  const sandbox = {
    h,
    pill: (kind, label) => h('span', { class: kind }, label),
    drawScene: (ctx, brief, mode, opts) => draws.push({ ctx, brief, mode, opts }),
    console: { error: (...args) => errors.push(args) },
  };
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox);
  return { ...sandbox, draws, errors };
}

// Layer IDs deliberately differ on the client and server; compare structure
// using local layer indexes while still checking the camera's target.
function comparable(applied) {
  const clone = JSON.parse(JSON.stringify(applied));
  const ids = new Map(clone.layers.map((layer, i) => [layer.id, `layer-${i}`]));
  clone.layers.forEach(layer => { layer.id = ids.get(layer.id); });
  if (clone.camera.focusLayer) clone.camera.focusLayer = ids.get(clone.camera.focusLayer);
  return clone;
}

function find(node, predicate) {
  if (!node || typeof node !== 'object') return null;
  if (predicate(node)) return node;
  for (const child of node.children || []) {
    const found = find(child, predicate);
    if (found) return found;
  }
  return null;
}

test('client template slots: all 15 reference layouts match server defaults without mutation', () => {
  assert.equal(selection.length, 15);
  const { applyClientTemplateSlots } = harness();
  for (const template of selection) {
    const original = JSON.stringify(template);
    const applied = applyClientTemplateSlots(template);
    assert.doesNotMatch(JSON.stringify(applied), /\{\{[A-Z0-9_\-]+\}\}/, template.id);
    assert.deepEqual(comparable(applied), comparable(applyTemplateSlots(template)), template.id);
    assert.equal(new Set(applied.layers.map(l => l.id)).size, applied.layers.length, template.id);
    assert.ok(applied.layers.every((layer, i) => layer.id !== template.layers[i].id), template.id);
    if (template.camera.focusLayer) {
      const index = template.layers.findIndex(layer => layer.id === template.camera.focusLayer);
      assert.notEqual(index, -1, template.id);
      assert.equal(applied.camera.focusLayer, applied.layers[index].id, template.id);
    }
    applied.layers[0].desc = 'Edited client layer';
    applied.style.palette[0] = '#000000';
    assert.equal(JSON.stringify(template), original, `${template.id}: client edits must leave template data intact`);
  }
});

test('client template slots: overrides and empty values behave identically to the server', () => {
  const { applyClientTemplateSlots } = harness();
  for (const template of selection) {
    for (const key of Object.keys(template.slots)) {
      const original = JSON.stringify(template);
      for (const value of [`CUSTOM_${key}_VALUE`, '', '   ', null, undefined]) {
        const overrides = { [key]: value };
        const applied = applyClientTemplateSlots(template, overrides);
        assert.deepEqual(comparable(applied), comparable(applyTemplateSlots(template, overrides)), `${template.id}/${key}/${value}`);
        assert.doesNotMatch(JSON.stringify(applied), /\{\{[A-Z0-9_\-]+\}\}/, template.id);
        if (typeof value === 'string' && value.trim()) assert.ok(JSON.stringify(applied).includes(value), `${template.id}: ${key} must be editable`);
      }
      assert.equal(JSON.stringify(template), original, template.id);
    }
  }
});

test('gallery cards draw resolved defaults with guides disabled and retain the original apply target', () => {
  const gallery = harness();
  for (const template of selection) {
    const original = JSON.stringify(template);
    const chosen = [];
    const card = gallery.renderTemplateCard(template, { onApply: tpl => chosen.push(tpl) });
    const draw = gallery.draws.at(-1);
    assert.equal(gallery.draws.length, selection.indexOf(template) + 1, template.id);
    assert.equal(draw.mode, 'layout', template.id);
    assert.equal(draw.ctx.canvas.props.width, 320, template.id);
    assert.equal(draw.ctx.canvas.props.height, 180, template.id);
    assert.doesNotMatch(JSON.stringify(draw.brief), /\{\{[A-Z0-9_\-]+\}\}/, `${template.id}: gallery should show actual default text`);
    assert.deepEqual(comparable(draw.brief), comparable({ ...template, ...applyTemplateSlots(template) }), template.id);
    for (const option of ['isExport', 'showGrid', 'showThirds', 'showLight', 'showHandles', 'showBadge']) {
      assert.equal(draw.opts[option], false, `${template.id}: ${option}`);
    }
    const applyButton = find(card, node => node.tag === 'button');
    let stopped = false;
    applyButton.props.onclick({ stopPropagation: () => { stopped = true; } });
    assert.equal(stopped, true);
    assert.equal(chosen[0], template, `${template.id}: apply should use reusable source data`);
    assert.equal(JSON.stringify(template), original, template.id);
  }
  assert.equal(gallery.errors.length, 0, 'gallery preview errors must not be swallowed');
});
