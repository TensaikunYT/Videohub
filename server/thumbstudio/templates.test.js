import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {
  validateTemplate,
  applyTemplateSlots,
  loadBuiltinTemplates,
  loadUserTemplates,
  listTemplates,
  getTemplate,
  saveUserTemplate,
  slugify,
  builtinDir,
  userDir,
} from './templates.js';
import { config } from '../config.js';
import { normalizeBrief } from './schema.js';
import { generatePrompt, PROMPT_MAX } from '../../ui/thumbstudio/prompt.js';

// Setup temp test directory for user templates
const testTempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vh-templates-test-'));
const prevTemplatesDir = config().thumbstudio.templatesDir;
config().thumbstudio.templatesDir = testTempDir;

test.after(() => {
  config().thumbstudio.templatesDir = prevTemplatesDir;
  try { fs.rmSync(testTempDir, { recursive: true, force: true }); } catch { }
});

test('slugify: converts Turkish characters and punctuation cleanly', () => {
  assert.equal(slugify('Tepki Yüzü + Büyük Başlık!'), 'tepki-yuzu-buyuk-baslik');
  assert.equal(slugify('Çığlık & Şaşkınlık'), 'ciglik-saskinlik');
  assert.equal(slugify('Örnek 123 - Test'), 'ornek-123-test');
});

test('built-in templates: all 27 templates exist and pass validation', () => {
  const builtin = loadBuiltinTemplates();
  assert.equal(builtin.length, 27, '12 original and 15 reference-inspired templates must be present');
  assert.equal(new Set(builtin.map(t => t.id)).size, builtin.length, 'built-in IDs must be unique');

  for (const t of builtin) {
    assert.equal(t.builtin, true);
    assert.ok(!t.error, `Template ${t.file} should not have error, got: ${t.error}`);
    const v = validateTemplate(t);
    assert.ok(v.valid, `Template ${t.id} validation failed: ${v.error}`);
    assert.ok(Array.isArray(t.layers), `Template ${t.id} must have layers array`);
    assert.ok(t.layers.length > 0, `Template ${t.id} must have at least one layer`);
  }
});

test('reference selection: 15 usable templates keep layout, text and focus through normalization', () => {
  const selection = loadBuiltinTemplates().filter(t => t.tags?.includes('reference-picks'));
  assert.equal(selection.length, 15);
  for (const template of selection) {
    const source = JSON.stringify(template);
    const applied = applyTemplateSlots(template);
    assert.doesNotMatch(JSON.stringify(applied), /\{\{[A-Z0-9_\-]+\}\}/, `${template.id}: all defaults must resolve`);
    const brief = normalizeBrief(applied);
    assert.equal(brief.layers.length, template.layers.length, template.id);
    assert.equal(brief.style.preset, template.style.preset, template.id);
    assert.equal(brief.light.time, template.light.time, template.id);
    assert.ok(brief.layers.length >= 4, `${template.id}: composed layout expected`);
    for (let i = 0; i < brief.layers.length; i++) {
      const raw = applied.layers[i];
      const layer = brief.layers[i];
      for (const prop of ['type', 'x', 'y', 'w', 'h', 'depth']) {
        assert.equal(layer[prop], raw[prop], `${template.id}/${i}: ${prop} should survive schema normalization`);
      }
      if (raw.color) assert.equal(layer.color, raw.color, template.id);
      if (layer.type === 'text') {
        assert.equal(layer.fill, raw.fill, template.id);
        assert.equal(layer.strokeW, raw.strokeW, template.id);
        assert.ok(layer.x >= .035 && layer.y >= .035, `${template.id}: title needs a safe outer margin`);
        assert.ok(layer.x + layer.w <= .965 + 1e-9 && layer.y + layer.h <= .94 + 1e-9, `${template.id}: text should fit the safe frame`);
      }
      if (layer.type === 'effect') assert.equal(layer.kind, raw.kind, template.id);
    }
    if (template.camera.focusLayer) {
      const index = template.layers.findIndex(l => l.id === template.camera.focusLayer);
      assert.notEqual(index, -1, `${template.id}: focus must point to a source layer`);
      assert.equal(brief.camera.focusLayer, brief.layers[index].id, template.id);
    }
    const { prompt } = generatePrompt(brief);
    assert.ok(prompt.length <= PROMPT_MAX, `${template.id}: generation prompt must fit the budget`);
    assert.doesNotMatch(prompt, /\{\{/, `${template.id}: prompt should contain resolved subject descriptions`);
    assert.match(prompt, /No text, no letters/, `${template.id}: typography is composed separately`);
    assert.equal(JSON.stringify(template), source, `${template.id}: applying must not mutate the template`);
  }
});

test('reference selection: every editable slot can be overridden and is used', () => {
  for (const template of loadBuiltinTemplates().filter(t => t.tags?.includes('reference-picks'))) {
    for (const key of Object.keys(template.slots)) {
      const value = `CUSTOM_${key}_VALUE`;
      const applied = applyTemplateSlots(template, { [key]: value });
      assert.ok(JSON.stringify(applied).includes(value), `${template.id}: ${key} should change the actual composition`);
    }
  }
});

test('applyTemplateSlots: camera focus follows new layer IDs and clears stale focus', () => {
  const template = {
    camera: { focusLayer: 'portrait-source' },
    layers: [{ id: 'background-source', type: 'background' }, { id: 'portrait-source', type: 'subject' }],
  };
  const applied = applyTemplateSlots(template);
  assert.equal(applied.camera.focusLayer, applied.layers[1].id);
  assert.equal(template.camera.focusLayer, 'portrait-source');
  assert.equal(applyTemplateSlots({ ...template, camera: { focusLayer: 'removed-layer' } }).camera.focusLayer, null);
});

test('saveUserTemplate: a focused layer remains focused when the saved template is applied', async () => {
  const brief = {
    camera: { focusLayer: 'editor-person', dof: .8 },
    layers: [{ id: 'editor-bg', type: 'background' }, { id: 'editor-person', type: 'subject' }],
  };
  const { path: file, template } = await saveUserTemplate({ name: 'Focus test', brief });
  try {
    assert.equal(template.camera.focusLayer, template.layers[1].id);
    assert.notEqual(template.layers[1].id, brief.layers[1].id);
    const applied = applyTemplateSlots(template);
    assert.equal(applied.camera.focusLayer, applied.layers[1].id);
    assert.equal(brief.camera.focusLayer, 'editor-person');
    assert.equal(brief.layers[1].id, 'editor-person');
  } finally {
    fs.unlinkSync(file);
  }
});

test('validateTemplate: rejects invalid structures', () => {
  assert.equal(validateTemplate(null).valid, false);
  assert.equal(validateTemplate({}).valid, false);
  assert.equal(validateTemplate({ kind: 'other' }).valid, false);
  assert.equal(validateTemplate({ kind: 'thumbstudio-template', v: 2 }).valid, false);
  assert.equal(validateTemplate({ kind: 'thumbstudio-template', v: 1, id: 'INVALID ID' }).valid, false);
  assert.equal(validateTemplate({ kind: 'thumbstudio-template', v: 1, id: 'valid', name: '' }).valid, false);
  assert.equal(validateTemplate({ kind: 'thumbstudio-template', v: 1, id: 'valid', name: 'Valid', layers: 'not an array' }).valid, false);
  assert.equal(validateTemplate({ kind: 'thumbstudio-template', v: 1, id: 'valid', name: 'Valid', layers: [], format: 'invalid' }).valid, false);
});

test('applyTemplateSlots: replaces slots with defaults and overrides', () => {
  const tpl = {
    v: 1,
    kind: 'thumbstudio-template',
    id: 'test-tpl',
    name: 'Test',
    format: '16:9',
    slots: {
      TITLE: { label: 'Title', default: 'DEFAULT TITLE' },
      SUB: { label: 'Subtitle', default: 'Default subtitle' },
    },
    camera: { shot: 'close' },
    layers: [
      { type: 'text', content: '{{TITLE}}' },
      { type: 'text', content: '{{SUB}}' },
    ],
  };

  // Test with defaults
  const applied1 = applyTemplateSlots(tpl);
  assert.equal(applied1.layers[0].content, 'DEFAULT TITLE');
  assert.equal(applied1.layers[1].content, 'Default subtitle');
  assert.equal(applied1.layers[0].id, 'l_1');
  assert.equal(applied1.layers[1].id, 'l_2');

  // Test with user values
  const applied2 = applyTemplateSlots(tpl, { TITLE: 'NEW TITLE' });
  assert.equal(applied2.layers[0].content, 'NEW TITLE');
  assert.equal(applied2.layers[1].content, 'Default subtitle');
});

test('saveUserTemplate and loadUserTemplates: handles custom templates and invalid JSON gracefully', async () => {
  const dir = userDir();
  if (!dir) return; // if userDir not configured

  await fsp.mkdir(dir, { recursive: true });

  const testName = 'Test User Template';
  const testId = 'test-kullanici-sablonu';
  const testFile = path.join(dir, `${testId}.json`);

  // Clean up if existed
  if (fs.existsSync(testFile)) fs.unlinkSync(testFile);

  const brief = {
    format: '16:9',
    camera: { shot: 'wide' },
    layers: [{ type: 'background', kind: 'solid', color: '#111111' }],
  };

  const res = await saveUserTemplate({ name: testName, brief, overwrite: true, id: testId });
  assert.equal(res.ok, true);
  assert.equal(res.id, testId);
  assert.ok(fs.existsSync(testFile));

  // Should fail to overwrite without overwrite flag
  await assert.rejects(
    async () => {
      await saveUserTemplate({ name: testName, brief, overwrite: false, id: testId });
    },
    err => err.code === 409
  );

  // Create an invalid JSON file in user directory to test error reporting
  const badFile = path.join(dir, 'bozuk-sablon.json');
  fs.writeFileSync(badFile, '{ bad json syntax');

  const userTemplates = loadUserTemplates();
  const badTemplate = userTemplates.find(t => t.file === 'bozuk-sablon.json');
  assert.ok(badTemplate, 'Corrupt template file must be returned in list');
  assert.ok(badTemplate.error, 'Corrupt template must have an error property');

  // Clean up test files
  try { fs.unlinkSync(testFile); } catch { }
  try { fs.unlinkSync(badFile); } catch { }
});
