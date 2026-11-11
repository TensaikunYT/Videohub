// Thumbnail store: CRUD, paths, security, recycle bin, and route bindings
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { catalog, normalizeBrief, validTid, validPid, generateTid } from './schema.js';
import { listTemplates, getTemplate, saveUserTemplate, applyTemplateSlots, watchTemplates } from './templates.js';
import { generatePrompt } from './prompt.js';
import { config } from '../config.js';
import { HUB_DIR, isInside, readJson, writeJson } from '../util.js';
import { project, index } from '../scan.js';
import { recyclePaths } from '../janitor.js';
import { outputsDir } from '../ciktilar-dir.js';
import { describeSpatialTr } from './prompt.js';
import crypto from 'node:crypto';

const MIME = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.md': 'text/markdown; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
};

const ALLOWED_FILE_RE = /^(layout\.png|sketch\.png|depth\.png|final\.jpg|brief\.md|prompt\.txt|refs\/[\w.\-]{1,80}|variants\/[\w.\-]{1,80}|notes\/[\w.\-]{1,80})$/;

const listeners = new Set();
export const onStore = fn => { listeners.add(fn); return () => listeners.delete(fn); };
function emit(type, data) { for (const fn of listeners) { try { fn({ type, ...data }); } catch { } } }

// Resolve folder for a thumbnail: pid === '_' means globalDir
export function resolveThumbDir(pid, tid) {
  if (!validTid(tid)) {
    throw Object.assign(new Error('Invalid thumbnail ID: ' + tid), { code: 400 });
  }
  if (!validPid(pid)) {
    throw Object.assign(new Error('Invalid project ID: ' + pid), { code: 400 });
  }

  let root;
  if (pid === '_') {
    const ts = config().thumbstudio || {};
    root = ts.globalDir;
  } else {
    const p = project(pid);
    if (!p) {
      throw Object.assign(new Error('Project not found: ' + pid), { code: 404 });
    }
    root = path.join(p.path, '.videohub', 'thumbnails');
  }

  const dir = path.join(root, tid);
  if (!isInside(dir, root)) {
    throw Object.assign(new Error('Path traversal blocked'), { code: 403 });
  }
  return { dir, root, pid, tid };
}

// Create a new thumbnail record
export async function createThumbnail(opts = {}) {
  const tid = opts.tid || generateTid();
  const pid = opts.project && opts.project !== '_' ? opts.project : '_';
  const { dir } = resolveThumbDir(pid, tid);

  if (fs.existsSync(dir)) {
    throw Object.assign(new Error('A thumbnail with this ID already exists: ' + tid), { code: 409 });
  }

  await fsp.mkdir(path.join(dir, 'refs'), { recursive: true });
  await fsp.mkdir(path.join(dir, 'variants'), { recursive: true });
  await fsp.mkdir(path.join(dir, 'notes'), { recursive: true });

  let appliedLayers = opts.layers || [];
  let appliedCamera = opts.camera || {};
  let appliedLight = opts.light || {};
  let appliedStyle = opts.style || {};
  let appliedText = opts.text || {};
  let appliedFormat = opts.format === '9:16' ? '9:16' : '16:9';

  if (opts.template) {
    const tpl = typeof opts.template === 'object' ? opts.template : getTemplate(opts.template);
    if (tpl) {
      const applied = applyTemplateSlots(tpl, opts.slots || {});
      appliedFormat = opts.format || applied.format || appliedFormat;
      appliedCamera = { ...applied.camera, ...(opts.camera || {}) };
      appliedLight = { ...applied.light, ...(opts.light || {}) };
      appliedStyle = { ...applied.style, ...(opts.style || {}) };
      appliedText = { ...applied.text, ...(opts.text || {}) };
      appliedLayers = applied.layers || [];
    }
  }

  const rawBrief = {
    id: tid,
    title: opts.title || 'Untitled Thumbnail',
    project: pid === '_' ? null : pid,
    format: appliedFormat,
    status: 'draft',
    layers: appliedLayers,
    goal: opts.goal || {},
    camera: appliedCamera,
    light: appliedLight,
    style: appliedStyle,
    text: appliedText,
  };

  const brief = normalizeBrief(rawBrief);
  writeJson(path.join(dir, 'brief.json'), brief);
  emit('created', { pid, tid, brief });
  return { pid, tid, brief, dir };
}

// Read an existing thumbnail brief
export function getThumbnail(pid, tid) {
  const { dir } = resolveThumbDir(pid, tid);
  const file = path.join(dir, 'brief.json');
  if (!fs.existsSync(file)) {
    throw Object.assign(new Error('Thumbnail not found: ' + tid), { code: 404 });
  }
  const raw = readJson(file);
  return normalizeBrief(raw);
}

// Update / save an existing thumbnail brief (PUT)
export function saveThumbnail(pid, tid, patch = {}) {
  const { dir } = resolveThumbDir(pid, tid);
  const file = path.join(dir, 'brief.json');
  const old = fs.existsSync(file) ? readJson(file) : {};
  const merged = { ...old, ...patch, id: tid, project: pid === '_' ? null : pid, created: old.created || new Date().toISOString() };
  const brief = normalizeBrief(merged);
  writeJson(file, brief);
  emit('saved', { pid, tid, brief });
  return brief;
}

// PUT from the editor must not overwrite what the server owns (variants arrive from Claude meanwhile)
const SERVER_OWNED = ['variants', 'chosen', 'final', 'exported', 'status', 'created', 'id', 'project'];
export function saveFromEditor(pid, tid, body = {}) {
  const patch = { ...body };
  for (const k of SERVER_OWNED) delete patch[k];
  return saveThumbnail(pid, tid, patch);
}

// Duplicate a thumbnail
export async function duplicateThumbnail(pid, tid) {
  const original = getThumbnail(pid, tid);
  const newTid = generateTid();
  const title = (original.title || 'Thumbnail') + ' (copy)';
  const { dir: oldDir } = resolveThumbDir(pid, tid);
  const { dir: newDir } = resolveThumbDir(pid, newTid);

  await fsp.mkdir(path.join(newDir, 'refs'), { recursive: true });
  await fsp.mkdir(path.join(newDir, 'variants'), { recursive: true });
  await fsp.mkdir(path.join(newDir, 'notes'), { recursive: true });

  // Copy refs folder contents if any
  try {
    const refs = await fsp.readdir(path.join(oldDir, 'refs'));
    for (const f of refs) {
      await fsp.copyFile(path.join(oldDir, 'refs', f), path.join(newDir, 'refs', f));
    }
  } catch { }

  const newBrief = normalizeBrief({
    ...original,
    id: newTid,
    title,
    created: new Date().toISOString(),
    status: 'draft',
    variants: [],
    chosen: null,
    final: null,
  });

  writeJson(path.join(newDir, 'brief.json'), newBrief);
  emit('created', { pid, tid: newTid, brief: newBrief });
  return { pid, tid: newTid, brief: newBrief };
}

// Delete a thumbnail folder to Recycle Bin (never hard delete)
export async function deleteThumbnail(pid, tid) {
  const { dir } = resolveThumbDir(pid, tid);
  if (!fs.existsSync(dir)) {
    throw Object.assign(new Error('Thumbnail not found: ' + tid), { code: 404 });
  }

  const results = await recyclePaths([{ path: dir }]);
  const ok = results.every(r => r.ok);
  if (!ok) {
    const err = results.find(r => !r.ok)?.error || 'Could not move to the Recycle Bin';
    throw Object.assign(new Error(err), { code: 500 });
  }

  emit('deleted', { pid, tid });
  return { ok: true, pid, tid };
}

// List all thumbnails (global + projects)
export function listThumbnails(filterPid) {
  const list = [];
  const addFromDir = (dir, pid, projectTitle, projectPath) => {
    if (!fs.existsSync(dir)) return;
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (!e.isDirectory() || !validTid(e.name)) continue;
      const tid = e.name;
      const tdir = path.join(dir, tid);
      const bfile = path.join(tdir, 'brief.json');
      if (!fs.existsSync(bfile)) continue;
      try {
        const b = readJson(bfile);
        if (!b) continue;
        list.push({
          id: tid,
          pid: pid || '_',
          title: b.title || 'Untitled',
          format: b.format || '16:9',
          status: b.status || 'draft',
          created: b.created,
          updated: b.updated || b.created,
          variantCount: Array.isArray(b.variants) ? b.variants.length : 0,
          chosen: b.chosen || null,
          hasFinal: !!b.final || fs.existsSync(path.join(tdir, 'final.jpg')),
          hasLayout: fs.existsSync(path.join(tdir, 'layout.png')),
          hasSketch: fs.existsSync(path.join(tdir, 'sketch.png')),
          projectTitle: projectTitle || 'Global',
          projectName: projectTitle || 'General',
          dir: tdir,
          cover: b.final ? 'final.jpg' : (b.chosen && (b.variants || []).find(v => v.id === b.chosen)?.file) || (b.variants || []).slice(-1)[0]?.file || (fs.existsSync(path.join(tdir, 'layout.png')) ? 'layout.png' : null),
          projectPath: projectPath || null,
        });
      } catch { }
    }
  };

  const ts = config().thumbstudio || {};
  if (!filterPid || filterPid === '_') {
    addFromDir(ts.globalDir, '_', 'General (No project)', null);
  }

  const projects = index().projects || [];
  for (const p of projects) {
    if (filterPid && filterPid !== p.id) continue;
    const pdir = path.join(p.path, '.videohub', 'thumbnails');
    addFromDir(pdir, p.id, p.title || p.name, p.path);
  }

  list.sort((a, b) => {
    const ta = Date.parse(a.updated || a.created || 0);
    const tb = Date.parse(b.updated || b.created || 0);
    return tb - ta;
  });

  return list;
}

// Serve a specific file from thumbnail directory
export function serveThumbnailFile(req, res, pid, tid, fileName) {
  if (!fileName || typeof fileName !== 'string') {
    res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
    return res.end(JSON.stringify({ error: 'Missing file name parameter (f)' }));
  }

  // Normalise path separators
  const cleanName = fileName.replace(/\\/g, '/');
  if (!ALLOWED_FILE_RE.test(cleanName)) {
    res.writeHead(403, { 'Content-Type': 'application/json; charset=utf-8' });
    return res.end(JSON.stringify({ error: 'Access denied to this file: ' + fileName }));
  }

  const { dir } = resolveThumbDir(pid, tid);
  const full = path.resolve(path.join(dir, cleanName));
  if (!isInside(full, dir) || !fs.existsSync(full)) {
    res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
    return res.end(JSON.stringify({ error: 'File not found' }));
  }

  const ext = path.extname(full).toLowerCase();
  const type = MIME[ext] || 'application/octet-stream';
  const st = fs.statSync(full);
  res.writeHead(200, { 'Content-Type': type, 'Content-Length': st.size, 'Cache-Control': 'no-store' });
  fs.createReadStream(full).pipe(res);
}

// Save an uploaded base64 reference image
export async function saveReference(pid, tid, { name, data, role = 'style', note = '', layer = null, trace = false }) {
  if (!data || typeof data !== 'string') {
    throw Object.assign(new Error('Missing image data'), { code: 400 });
  }

  const m = data.match(/^data:image\/(png|jpeg|jpg|webp);base64,(.+)$/);
  if (!m) {
    throw Object.assign(new Error('Invalid image format (PNG/JPEG/WEBP only)'), { code: 400 });
  }

  const ext = m[1] === 'jpeg' ? '.jpg' : '.' + m[1];
  let baseName = (name ? path.basename(name, path.extname(name)) : 'ref').replace(/[^\w\-]/g, '_').slice(0, 50) || 'ref';
  
  const { dir } = resolveThumbDir(pid, tid);
  const refsDir = path.join(dir, 'refs');
  await fsp.mkdir(refsDir, { recursive: true });

  let fileName = baseName + ext;
  let counter = 2;
  while (fs.existsSync(path.join(refsDir, fileName))) {
    fileName = `${baseName}_${counter}${ext}`;
    counter++;
  }

  const buf = Buffer.from(m[2], 'base64');
  if (buf.length > 15 * 1024 * 1024) {
    throw Object.assign(new Error('Image exceeds the 15 MB size limit'), { code: 400 });
  }

  await fsp.writeFile(path.join(refsDir, fileName), buf);
  // a tracing underlay is only a picture for the editor: never a reference sent to the image model
  if (trace) return { file: 'refs/' + fileName };

  // Update brief.refs
  const brief = getThumbnail(pid, tid);
  const refs = brief.refs || [];
  let maxR = 0;
  for (const r of refs) {
    const rm = (r.id || '').match(/^R(\d+)$/);
    if (rm) maxR = Math.max(maxR, parseInt(rm[1], 10));
  }
  const refId = 'R' + (maxR + 1);

  const newRef = {
    id: refId,
    file: 'refs/' + fileName,
    role: ['style', 'character', 'object', 'composition', 'background'].includes(role) ? role : 'style',
    note: String(note || '').slice(0, 300),
    layer: layer || null,
  };

  refs.push(newRef);
  const updated = saveThumbnail(pid, tid, { refs });
  emit('ref-added', { pid, tid, ref: newRef });
  return { ref: newRef, brief: updated };
}

// Copy reference from existing file path
export async function copyReferenceFrom(pid, tid, { sourcePath, role = 'style', note = '', layer = null }) {
  if (!sourcePath || !fs.existsSync(sourcePath)) {
    throw Object.assign(new Error('Source file not found'), { code: 404 });
  }
  if (!/\.(png|jpe?g|webp)$/i.test(sourcePath)) throw Object.assign(new Error('Only PNG/JPEG/WEBP images can be added'), { code: 400 });
  if (!allowedSource(sourcePath)) throw Object.assign(new Error('References cannot be copied from this folder: ' + sourcePath), { code: 403 });

  const { dir } = resolveThumbDir(pid, tid);
  const refsDir = path.join(dir, 'refs');
  await fsp.mkdir(refsDir, { recursive: true });

  const ext = path.extname(sourcePath).toLowerCase();
  const baseName = path.basename(sourcePath, ext).replace(/[^\w\-]/g, '_').slice(0, 50) || 'ref';

  let fileName = baseName + ext;
  let counter = 2;
  while (fs.existsSync(path.join(refsDir, fileName))) {
    fileName = `${baseName}_${counter}${ext}`;
    counter++;
  }

  await fsp.copyFile(sourcePath, path.join(refsDir, fileName));

  const brief = getThumbnail(pid, tid);
  const refs = brief.refs || [];
  let maxR = 0;
  for (const r of refs) {
    const rm = (r.id || '').match(/^R(\d+)$/);
    if (rm) maxR = Math.max(maxR, parseInt(rm[1], 10));
  }
  const refId = 'R' + (maxR + 1);

  const newRef = {
    id: refId,
    file: 'refs/' + fileName,
    role: ['style', 'character', 'object', 'composition', 'background'].includes(role) ? role : 'style',
    note: String(note || '').slice(0, 300),
    layer: layer || null,
  };

  refs.push(newRef);
  const updated = saveThumbnail(pid, tid, { refs });
  emit('ref-added', { pid, tid, ref: newRef });
  return { ref: newRef, brief: updated };
}

// folders a reference may be copied from: the watched roots, the thumbnail folders and the style library
function allowedSource(p) {
  const c = config(), ts = c.thumbstudio || {};
  return [...(c.roots || []).map(r => r.path), ts.globalDir, ts.templatesDir, ts.styleRefsDir, outputsDir()].filter(Boolean).some(r => isInside(p, r));
}

// Image size from the file header (PNG, JPEG)
export function getImageDimensions(filePath) {
  try {
    const fd = fs.openSync(filePath, 'r');
    const buf = Buffer.alloc(32);
    fs.readSync(fd, buf, 0, 32, 0);
    fs.closeSync(fd);
    // PNG signature 89 50 4E 47
    if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4E && buf[3] === 0x47) {
      const w = buf.readUInt32BE(16);
      const h = buf.readUInt32BE(20);
      return { w, h };
    }
    if (buf[0] === 0xff && buf[1] === 0xd8) {
      const all = fs.readFileSync(filePath);
      for (let i = 2; i < all.length - 9;) {
        if (all[i] !== 0xff) { i++; continue; }
        const m = all[i + 1], len = all.readUInt16BE(i + 2);
        if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { w: all.readUInt16BE(i + 7), h: all.readUInt16BE(i + 5) };
        i += 2 + len;
      }
    }
  } catch { }
  return { w: 0, h: 0 };
}

// Export thumbnail layout.png, sketch.png, depth.png, prompt.txt, and brief.md
export async function exportThumbnail(pid, tid, { layout, sketch, depth }) {
  const { dir } = resolveThumbDir(pid, tid);
  const brief = getThumbnail(pid, tid);

  const saveImage = async (dataUrl, fileName) => {
    if (!dataUrl) return;
    const m = String(dataUrl).match(/^data:image\/(png|jpeg);base64,(.+)$/);
    if (!m) {
      throw Object.assign(new Error(`Invalid image data: ${fileName}`), { code: 400 });
    }
    const buf = Buffer.from(m[2], 'base64');
    if (buf.length > 15 * 1024 * 1024) {
      throw Object.assign(new Error(`Image size limit exceeded (>15MB): ${fileName}`), { code: 400 });
    }
    await fsp.writeFile(path.join(dir, fileName), buf);
  };

  await Promise.all([
    saveImage(layout, 'layout.png'),
    saveImage(sketch, 'sketch.png'),
    saveImage(depth, 'depth.png'),
  ]);

  // Generate prompt & summary
  const { prompt, summaryTr, refsOrdered } = generatePrompt(brief);

  // Write prompt.txt
  await fsp.writeFile(path.join(dir, 'prompt.txt'), prompt, 'utf-8');

  // Write brief.md
  const briefMd = `# VideoHub Thumbnail: ${brief.title || 'Untitled'} (${brief.format || '16:9'})
ID: ${tid}
Created: ${brief.created || ''}
Last Export: ${new Date().toISOString()}

${summaryTr}

---

## AI Prompt Draft (EN)
\`\`\`text
${prompt}
\`\`\`
`;
  await fsp.writeFile(path.join(dir, 'brief.md'), briefMd, 'utf-8');

  // Update brief with exported timestamp
  const updatedBrief = saveThumbnail(pid, tid, {
    exported: new Date().toISOString(),
  });

  emit('exported', { pid, tid, prompt, summaryTr, refsOrdered });
  return { ok: true, prompt, summaryTr, refsOrdered, brief: updatedBrief };
}

// Generate clipboard message for Claude
export function getClaudeMessage(pid, tid) {
  const { dir } = resolveThumbDir(pid, tid);
  const brief = getThumbnail(pid, tid);
  const projArg = pid === '_' ? '_' : pid;

  // Check for open notes in variants
  const openNotesInfo = [];
  for (const v of brief.variants || []) {
    const open = (v.notes || []).filter(n => n.status === 'open');
    if (open.length > 0) {
      openNotesInfo.push(`${v.id} has ${open.length} open notes (${open.map(n => `#${n.id}: "${n.text}"`).join(', ')})`);
    }
  }

  const lines = [
    `VideoHub Thumbnail: "${brief.title || 'Untitled'}" (${brief.format || '16:9'})`,
    `Folder: ${dir}`,
    `Get the brief with hub_thumb_brief({project:"${projArg}", id:"${tid}"});`,
    `look at sketch.png and layout.png, generate 2 variants with your image tool (layout.png is the first reference),`,
    `save with hub_thumb_variant. Do not draw text in the image; I will overlay it in VideoHub.`
  ];

  if (openNotesInfo.length > 0) {
    lines.push(`Open notes: ${openNotesInfo.join('; ')} — use that variant as a reference and only fix the notes.`);
  }

  return {
    ok: true,
    message: lines.join('\n')
  };
}

// Add a variant (copied to variants/v<round>_<seq>.png)
export async function addVariant(pid, tid, { file, prompt = '', parent = null, fixes = [], by = 'claude', round: wantRound = null, refs = null, mode = null, inPlace = false }) {
  if (!file || !fs.existsSync(file)) {
    throw Object.assign(new Error('Variant image file not found: ' + file), { code: 404 });
  }
  const ext = (path.extname(file).toLowerCase().match(/^\.(png|jpe?g|webp)$/) || [])[0];
  if (!ext) throw Object.assign(new Error('Variant must be PNG, JPEG or WEBP: ' + file), { code: 400 });
  const hash = crypto.createHash('md5').update(await fsp.readFile(file)).digest('hex');

  const { dir } = resolveThumbDir(pid, tid);
  const variantsDir = path.join(dir, 'variants');
  await fsp.mkdir(variantsDir, { recursive: true });

  const brief = getThumbnail(pid, tid);
  const existing = brief.variants || [];

  const same = existing.find(v => v.hash === hash);
  if (same) throw Object.assign(new Error(`This image is already ${same.id}`), { code: 409 });

  // a file from Claude opens a new round (unless the caller names one)
  const round = wantRound || nextRound(existing);
  let vid, targetFileName, targetPath;
  if (inPlace) {
    // the file is already variants/v<round>_<k>.png
    targetFileName = path.basename(file); vid = path.basename(file, path.extname(file)); targetPath = file;
  } else {
    const inRound = existing.filter(v => (v.round || 1) === round);
    let seq = inRound.length + 1;
    do { vid = `v${round}_${seq++}`; targetFileName = vid + (ext === '.jpeg' ? '.jpg' : ext); targetPath = path.join(variantsDir, targetFileName); } while (fs.existsSync(targetPath) || existing.some(v => v.id === vid));
    await fsp.copyFile(file, targetPath);
  }

  // Get dimensions
  const dims = getImageDimensions(targetPath);

  // Update fixes on notes
  if (Array.isArray(fixes) && fixes.length > 0) {
    for (const v of existing) {
      if (v.notes) {
        for (const n of v.notes) {
          if (fixes.includes(n.id)) {
            n.status = 'fixed';
          }
        }
      }
    }
  }

  const newVariant = {
    id: vid,
    file: `variants/${targetFileName}`,
    round,
    parent: parent || null,
    mode: mode || (parent ? 'edit' : 'new'),
    by,
    prompt: String(prompt || '').trim().slice(0, 4000),
    refs: Array.isArray(refs) ? refs : ['layout.png'],
    hash,
    w: dims.w,
    h: dims.h,
    at: new Date().toISOString(),
    notes: [],
  };

  existing.push(newVariant);

  const updatedBrief = saveThumbnail(pid, tid, {
    variants: existing,
    status: brief.status === 'draft' ? 'generating' : brief.status,
  });

  emit('variant', { pid, tid, variant: newVariant });
  return { ok: true, variant: newVariant, brief: updatedBrief };
}

export function nextRound(variants = []) {
  return variants.length ? Math.max(...variants.map(v => v.round || 1)) + 1 : 1;
}
const findVariant = (brief, vid) => {
  const v = (brief.variants || []).find(x => x.id === vid);
  if (!v) throw Object.assign(new Error('Variant not found: ' + vid), { code: 404 });
  return v;
};

// the prompt for fixing a variant from its notes
export function editPrompt(notes, hasMarks) {
  const list = notes.map((n, i) => `(${i + 1}) at the ${spatialEn(n.x, n.y)}: ${n.text}`).join(' ');
  return `The exact same image as the first reference, identical composition, style, characters and lighting. Only change: ${list}.` +
    (hasMarks ? ' The second reference shows red numbered marks where to change; do not draw the marks.' : '') + ' No text, no letters, no watermark.';
}
function spatialEn(x, y) {
  const hp = x < 0.38 ? 'left' : x > 0.62 ? 'right' : 'center', vp = y < 0.38 ? 'top' : y > 0.62 ? 'bottom' : 'middle';
  return hp === 'center' && vp === 'middle' ? 'center' : `${vp} ${hp}`;
}

// ---------- variant notes
export function addVariantNote(pid, tid, vid, { x, y, text } = {}) {
  const brief = getThumbnail(pid, tid);
  const v = findVariant(brief, vid);
  const t = String(text || '').trim().slice(0, 500);
  if (!t) throw Object.assign(new Error('Note is empty'), { code: 400 });
  v.notes = Array.isArray(v.notes) ? v.notes : [];
  const id = v.notes.reduce((m, n) => Math.max(m, n.id || 0), 0) + 1;
  const note = { id, x: clamp01(x), y: clamp01(y), text: t, where: describeSpatialTr(clamp01(x), clamp01(y)), status: 'open', at: new Date().toISOString() };
  v.notes.push(note);
  const b = saveThumbnail(pid, tid, { variants: brief.variants });
  emit('note', { pid, tid, vid, note });
  return { ok: true, note, brief: b };
}
export function updateVariantNote(pid, tid, vid, nid, patch = {}) {
  const brief = getThumbnail(pid, tid);
  const v = findVariant(brief, vid);
  const i = (v.notes || []).findIndex(n => n.id === +nid);
  if (i < 0) throw Object.assign(new Error('Note not found'), { code: 404 });
  if (patch.remove) v.notes.splice(i, 1);
  else {
    if (typeof patch.text === 'string' && patch.text.trim()) v.notes[i].text = patch.text.trim().slice(0, 500);
    if (['open', 'claude', 'fixed'].includes(patch.status)) v.notes[i].status = patch.status;
  }
  const b = saveThumbnail(pid, tid, { variants: brief.variants });
  emit('note', { pid, tid, vid });
  return { ok: true, brief: b };
}
const clamp01 = v => Math.max(0, Math.min(1, Number.isFinite(+v) ? +v : 0.5));

// the variant with red numbered marks (drawn by the browser), sent as the 2nd reference of an edit
export async function saveMarked(pid, tid, vid, data) {
  const { dir } = resolveThumbDir(pid, tid);
  findVariant(getThumbnail(pid, tid), vid);
  const m = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(data || '');
  if (!m) throw Object.assign(new Error('Not a PNG'), { code: 400 });
  await fsp.mkdir(path.join(dir, 'notes'), { recursive: true });
  await fsp.writeFile(path.join(dir, 'notes', `${vid}_marked.png`), Buffer.from(m[1], 'base64'));
  return { ok: true, file: `notes/${vid}_marked.png` };
}

export function chooseVariant(pid, tid, vid) {
  const brief = getThumbnail(pid, tid);
  if (vid) findVariant(brief, vid);
  return saveThumbnail(pid, tid, { chosen: vid || null, status: brief.status === 'final' ? 'final' : vid ? 'chosen' : (brief.variants.length ? 'generating' : 'draft') });
}

export async function deleteVariant(pid, tid, vid) {
  const { dir } = resolveThumbDir(pid, tid);
  const brief = getThumbnail(pid, tid);
  const v = findVariant(brief, vid);
  const f = path.join(dir, v.file);
  if (isInside(f, dir) && fs.existsSync(f)) {
    const r = await recyclePaths([{ path: f }]);
    if (!r.every(x => x.ok)) throw Object.assign(new Error(r.find(x => !x.ok)?.error || 'Could not move to the Recycle Bin'), { code: 500 });
  }
  const variants = brief.variants.filter(x => x.id !== vid);
  const b = saveThumbnail(pid, tid, { variants, chosen: brief.chosen === vid ? null : brief.chosen });
  emit('variant-removed', { pid, tid, vid });
  return { ok: true, brief: b };
}

// ---------- final (the browser composes the chosen variant + text; the server stores it)
export const FINAL_MAX = 2 * 1024 * 1024;
export async function saveFinal(pid, tid, { data, copyToOutputs = true } = {}) {
  const { dir } = resolveThumbDir(pid, tid);
  const brief = getThumbnail(pid, tid);
  const m = /^data:image\/jpeg;base64,([A-Za-z0-9+/=]+)$/.exec(data || '');
  if (!m) throw Object.assign(new Error('Final must be JPEG'), { code: 400 });
  const buf = Buffer.from(m[1], 'base64');
  if (buf.length > FINAL_MAX) throw Object.assign(new Error(`Final is ${(buf.length / 1048576).toFixed(2)} MB; YouTube limit is 2 MB`), { code: 400 });
  const file = path.join(dir, 'final.jpg');
  await fsp.writeFile(file, buf);
  const dims = getImageDimensions(file);
  let copy = null, copyError = null;
  if (copyToOutputs) {
    try {
      const out = path.join(outputsDir(), 'thumbnails');
      await fsp.mkdir(out, { recursive: true });
      const d = new Date(), z = n => String(n).padStart(2, '0');
      const safe = String(brief.title || tid).replace(/[\\/:*?"<>|\u0000-\u001f]/g, '-').trim().slice(0, 100);
      copy = path.join(out, `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())} ${safe} (${tid}).jpg`);
      // this thumbnail's earlier copy under another day's name is replaced, not piled up
      const old = brief.final?.copy;
      if (old && old !== copy && isInside(old, out) && fs.existsSync(old)) await recyclePaths([{ path: old }]).catch(() => { });
      await fsp.copyFile(file, copy);
    } catch (e) { copyError = e.message; copy = null; }
  }
  const final = { file: 'final.jpg', at: new Date().toISOString(), bytes: buf.length, w: dims.w, h: dims.h, from: brief.chosen, copy, copyError };
  const b = saveThumbnail(pid, tid, { final, status: 'final' });
  emit('final', { pid, tid, final });
  return { ok: true, final, path: file, brief: b };
}

export async function openThumbFolder(pid, tid, file) {
  const { dir } = resolveThumbDir(pid, tid);
  const clean = file ? String(file).replace(/\\/g, '/') : null;
  const f = clean && ALLOWED_FILE_RE.test(clean) ? path.join(dir, clean) : null;
  const { openFile } = await import('../open-file.js');
  return openFile(f && fs.existsSync(f) ? f : dir, 'folder');   // a file is shown selected in its folder
}

// Register all thumbstudio HTTP routes
export function routes(route, readBody) {
  // Catalog
  route('GET', '/api/thumbstudio/catalog', () => catalog());
  // find a thumbnail by its id alone (tools called without a project)
  route('GET', '/api/thumbstudio/find/:tid', (req, url, { tid }) => {
    const t = listThumbnails().find(x => x.id === tid);
    if (!t) throw Object.assign(new Error('Thumbnail not found: ' + tid), { code: 404 });
    return t;
  });

  // List
  route('GET', '/api/thumbstudio/list', (req, url) => {
    const p = url.searchParams.get('project');
    return listThumbnails(p);
  });

  // Create
  route('POST', '/api/thumbstudio/new', async req => {
    const body = await readBody(req);
    return createThumbnail(body);
  });

  // Duplicate
  route('POST', '/api/thumbstudio/:pid/:tid/duplicate', async (req, url, { pid, tid }) => {
    return duplicateThumbnail(pid, tid);
  });

  // Delete
  route('POST', '/api/thumbstudio/:pid/:tid/delete', async (req, url, { pid, tid }) => {
    return deleteThumbnail(pid, tid);
  });

  // Save uploaded reference
  route('POST', '/api/thumbstudio/:pid/:tid/ref', async (req, url, { pid, tid }) => {
    const body = await readBody(req);
    return saveReference(pid, tid, body);
  });

  // Copy reference from path
  route('POST', '/api/thumbstudio/:pid/:tid/ref-from', async (req, url, { pid, tid }) => {
    const body = await readBody(req);
    return copyReferenceFrom(pid, tid, body);
  });

  // Serve file
  route('GET', '/api/thumbstudio/:pid/:tid/file', (req, url, { pid, tid }, res) => {
    const f = url.searchParams.get('f');
    return serveThumbnailFile(req, res, pid, tid, f);
  });

  // Get brief
  route('GET', '/api/thumbstudio/:pid/:tid', (req, url, { pid, tid }) => {
    return getThumbnail(pid, tid);
  });

  // Put / Save brief (from the editor: server-owned fields are kept)
  route('PUT', '/api/thumbstudio/:pid/:tid', async (req, url, { pid, tid }) => {
    const body = await readBody(req);
    return saveFromEditor(pid, tid, body);
  });

  // Generation, variants, notes, final
  route('POST', '/api/thumbstudio/:pid/:tid/choose', async (req, url, { pid, tid }) => chooseVariant(pid, tid, (await readBody(req)).vid || null));
  route('POST', '/api/thumbstudio/:pid/:tid/final', async (req, url, { pid, tid }) => saveFinal(pid, tid, await readBody(req)));
  route('POST', '/api/thumbstudio/:pid/:tid/open-folder', async (req, url, { pid, tid }) => openThumbFolder(pid, tid, (await readBody(req)).file));
  route('POST', '/api/thumbstudio/:pid/:tid/variant/:vid/note', async (req, url, { pid, tid, vid }) => addVariantNote(pid, tid, vid, await readBody(req)));
  route('POST', '/api/thumbstudio/:pid/:tid/variant/:vid/note/:nid', async (req, url, { pid, tid, vid, nid }) => updateVariantNote(pid, tid, vid, nid, await readBody(req)));
  route('POST', '/api/thumbstudio/:pid/:tid/variant/:vid/marked', async (req, url, { pid, tid, vid }) => saveMarked(pid, tid, vid, (await readBody(req)).data));
  route('POST', '/api/thumbstudio/:pid/:tid/variant/:vid/delete', async (req, url, { pid, tid, vid }) => deleteVariant(pid, tid, vid));

  // Export layout, sketch, depth, prompt.txt, brief.md
  route('POST', '/api/thumbstudio/:pid/:tid/export', async (req, url, { pid, tid }) => {
    const body = await readBody(req);
    return exportThumbnail(pid, tid, body);
  });

  // Claude message generator
  route('POST', '/api/thumbstudio/:pid/:tid/claude-message', (req, url, { pid, tid }) => {
    return getClaudeMessage(pid, tid);
  });

  // Add external/Claude variant
  route('POST', '/api/thumbstudio/:pid/:tid/variant', async (req, url, { pid, tid }) => {
    const body = await readBody(req);
    return addVariant(pid, tid, body);
  });

  // Templates list
  route('GET', '/api/thumbstudio/templates', () => listTemplates());

  // Save template
  route('POST', '/api/thumbstudio/templates', async req => {
    const body = await readBody(req);
    const res = await saveUserTemplate(body);
    emit('templates-changed', { id: res.id });
    return res;
  });

  // Start watching user templates directory
  watchTemplates(emit);
}

