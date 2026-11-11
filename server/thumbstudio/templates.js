// Thumbnail templates: loading, validation, slot replacement, saving, and directory watcher
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { HUB_DIR, readJson, writeJson } from '../util.js';
import { config } from '../config.js';

let watchTimer = null;
let watcher = null;

// Slugify string into template id (lowercase letters, numbers, dashes)
export function slugify(str) {
  if (!str) return 'sablon';
  const trMap = {
    'ç': 'c', 'Ç': 'c',
    'ğ': 'g', 'Ğ': 'g',
    'ı': 'i', 'I': 'i', 'İ': 'i',
    'ö': 'o', 'Ö': 'o',
    'ş': 's', 'Ş': 's',
    'ü': 'u', 'Ü': 'u',
  };
  let s = String(str);
  for (const [k, v] of Object.entries(trMap)) {
    s = s.replaceAll(k, v);
  }
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 50) || 'sablon';
}

// Validate template structure according to SCHEMA.md
export function validateTemplate(data) {
  if (!data || typeof data !== 'object') {
    return { valid: false, error: 'Template must be a valid JSON object.' };
  }
  if (data.kind !== 'thumbstudio-template') {
    return { valid: false, error: 'The kind field must be "thumbstudio-template".' };
  }
  if (data.v !== 1) {
    return { valid: false, error: 'The v (version) field must be 1.' };
  }
  if (!data.id || typeof data.id !== 'string' || !/^[a-z0-9\-_]{1,60}$/.test(data.id)) {
    return { valid: false, error: 'The id field may only contain lowercase letters, numbers and dashes (1-60 characters).' };
  }
  if (!data.name || typeof data.name !== 'string' || !data.name.trim()) {
    return { valid: false, error: 'The name field cannot be empty.' };
  }
  const validFormats = ['16:9', '9:16', '1:1', '4:3', '21:9'];
  if (data.format && !validFormats.includes(data.format)) {
    return { valid: false, error: `Invalid format: ${data.format} (supported: ${validFormats.join(', ')})` };
  }
  if (!Array.isArray(data.layers)) {
    return { valid: false, error: 'The layers field must be an array.' };
  }
  return { valid: true };
}

// Deep clone object
function deepClone(obj) {
  if (obj === undefined || obj === null) return obj;
  return JSON.parse(JSON.stringify(obj));
}

// Replace string slot tokens "{{KEY}}" with provided value or default
function replaceSlotsInValue(val, slotsMap) {
  if (typeof val === 'string') {
    return val.replace(/\{\{([A-Z0-9_\-]+)\}\}/g, (match, key) => {
      if (key in slotsMap && slotsMap[key] !== undefined && slotsMap[key] !== null) {
        return String(slotsMap[key]);
      }
      return match;
    });
  }
  if (Array.isArray(val)) {
    return val.map(item => replaceSlotsInValue(item, slotsMap));
  }
  if (val && typeof val === 'object') {
    const res = {};
    for (const [k, v] of Object.entries(val)) {
      res[k] = replaceSlotsInValue(v, slotsMap);
    }
    return res;
  }
  return val;
}

// Apply slot values to template, producing brief layers and properties
export function applyTemplateSlots(template, slotValues = {}) {
  const cloned = deepClone(template);
  const slotsMap = {};

  // Seed with template defaults
  if (cloned.slots && typeof cloned.slots === 'object') {
    for (const [k, def] of Object.entries(cloned.slots)) {
      if (def && typeof def === 'object' && def.default !== undefined) {
        slotsMap[k] = def.default;
      }
    }
  }

  // Override with user provided slot values
  for (const [k, v] of Object.entries(slotValues)) {
    if (v !== undefined && v !== null && String(v).trim() !== '') {
      slotsMap[k] = v;
    }
  }

  // Replace slots across camera, light, style, text, layers
  const camera = replaceSlotsInValue(cloned.camera || {}, slotsMap);
  const light = replaceSlotsInValue(cloned.light || {}, slotsMap);
  const style = replaceSlotsInValue(cloned.style || {}, slotsMap);
  const text = replaceSlotsInValue(cloned.text || {}, slotsMap);
  const rawLayers = replaceSlotsInValue(cloned.layers || [], slotsMap);

  // Assign fresh unique layer IDs
  let layerSeq = 1;
  const layerIds = new Map();
  const layers = rawLayers.map(l => {
    const id = `l_${layerSeq++}`;
    if (l.id) layerIds.set(l.id, id);
    return { ...l, id };
  });
  if (camera.focusLayer) camera.focusLayer = layerIds.get(camera.focusLayer) || null;

  return {
    format: cloned.format || '16:9',
    camera,
    light,
    style,
    text,
    layers,
  };
}

// Built-in templates directory: <HUB_DIR>/templates/thumbnail
export function builtinDir() {
  return path.join(HUB_DIR, 'templates', 'thumbnail');
}

// User templates directory from config
export function userDir() {
  const ts = config().thumbstudio || {};
  return ts.templatesDir || '';
}

// Load built-in templates
export function loadBuiltinTemplates() {
  const dir = builtinDir();
  if (!fs.existsSync(dir)) return [];

  const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'));
  const list = [];

  for (const f of files) {
    const filePath = path.join(dir, f);
    try {
      const raw = readJson(filePath);
      const v = validateTemplate(raw);
      if (v.valid) {
        list.push({ ...raw, builtin: true, file: f });
      } else {
        list.push({
          id: path.basename(f, '.json'),
          name: raw?.name || f,
          builtin: true,
          file: f,
          error: v.error,
        });
      }
    } catch (err) {
      list.push({
        id: path.basename(f, '.json'),
        name: f,
        builtin: true,
        file: f,
        error: `Could not read JSON: ${err.message}`,
      });
    }
  }

  return list;
}

// Load user templates
export function loadUserTemplates() {
  const dir = userDir();
  if (!dir || !fs.existsSync(dir)) return [];

  const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'));
  const list = [];

  for (const f of files) {
    const filePath = path.join(dir, f);
    try {
      const raw = readJson(filePath);
      const v = validateTemplate(raw);
      if (v.valid) {
        list.push({ ...raw, builtin: false, file: f });
      } else {
        list.push({
          id: raw?.id || path.basename(f, '.json'),
          name: raw?.name || f,
          builtin: false,
          file: f,
          error: v.error,
        });
      }
    } catch (err) {
      list.push({
        id: path.basename(f, '.json'),
        name: f,
        builtin: false,
        file: f,
        error: `Could not read JSON: ${err.message}`,
      });
    }
  }

  return list;
}

// List all templates (built-in + user)
export function listTemplates() {
  const builtin = loadBuiltinTemplates();
  const user = loadUserTemplates();
  return [...builtin, ...user];
}

// Get single template by ID
export function getTemplate(id) {
  const all = listTemplates();
  return all.find(t => t.id === id && !t.error) || null;
}

// Save a brief as user template
export async function saveUserTemplate({ name, brief, overwrite = false, id: customId }) {
  if (!name || typeof name !== 'string' || !name.trim()) {
    throw Object.assign(new Error('Template name is required.'), { code: 400 });
  }

  const dir = userDir();
  if (!dir) {
    throw Object.assign(new Error('User templates folder is not configured.'), { code: 500 });
  }
  await fsp.mkdir(dir, { recursive: true });

  const id = customId || slugify(name);
  const filePath = path.join(dir, `${id}.json`);

  if (fs.existsSync(filePath) && !overwrite) {
    throw Object.assign(new Error(`A template named "${id}" already exists. Overwrite it?`), { code: 409 });
  }

  // Use template-local IDs so camera focus survives saving and later application.
  const layerIds = new Map();
  const cleanLayers = (brief.layers || []).map((l, i) => {
    const id = `t_${i + 1}`;
    if (l.id) layerIds.set(l.id, id);
    return { ...l, id };
  });
  const camera = { ...(brief.camera || {}) };
  if (camera.focusLayer) camera.focusLayer = layerIds.get(camera.focusLayer) || null;

  const tpl = {
    v: 1,
    kind: 'thumbstudio-template',
    id,
    name: name.trim(),
    desc: brief.goal?.oneLiner || '',
    format: brief.format || '16:9',
    tags: ['custom'],
    slots: {},
    camera,
    light: brief.light || {},
    style: brief.style || {},
    text: brief.text || {},
    layers: cleanLayers,
  };

  const v = validateTemplate(tpl);
  if (!v.valid) {
    throw Object.assign(new Error(`Invalid template data: ${v.error}`), { code: 400 });
  }

  writeJson(filePath, tpl);
  return { ok: true, id, path: filePath, template: tpl };
}

// Watch user templates directory and emit change events
export function watchTemplates(emitFn) {
  const dir = userDir();
  if (!dir) return;

  try {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  } catch { }

  if (!fs.existsSync(dir)) return;

  if (watcher) {
    try { watcher.close(); } catch { }
  }

  try {
    watcher = fs.watch(dir, () => {
      clearTimeout(watchTimer);
      watchTimer = setTimeout(() => {
        if (typeof emitFn === 'function') {
          emitFn('templates-changed', { ts: Date.now() });
        }
      }, 400);
    });
  } catch { }
}
