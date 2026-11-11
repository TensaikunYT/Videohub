// 2D layers of the live editor ("🧩 2D layers", ui/review/edit2d.js; page side engine-hooks/vh2d.js):
// validation of tweaks.json "items2d" / "actors2d", and the pictures the user adds (<film>/vh2d/<name>).
import fs from 'node:fs';
import path from 'node:path';
import { project } from './scan.js';

const KINDS = new Set(['image', 'text', 'rect', 'ellipse', 'arrow']);
const num = (v, d, lo = -1e6, hi = 1e6) => { const n = +v; return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : d; };
const str = (v, n = 200) => (typeof v === 'string' ? v.slice(0, n) : undefined);
const col = (v) => (typeof v === 'string' && /^(#[0-9a-f]{3,8}|rgba?\([\d\s.,%]+\))$/i.test(v.trim()) ? v.trim() : undefined);
const SRC_RE = /^vh2d\/[\p{L}\p{N}_.\- ()]{1,120}\.(png|jpe?g|webp|gif|svg)$/iu;

export function cleanItems(list) {
  if (!Array.isArray(list)) return [];
  const out = [], ids = new Set();
  for (const it of list.slice(0, 500)) {
    if (!it || typeof it !== 'object' || !KINDS.has(it.kind)) continue;
    let id = str(it.id, 40) || 'i' + Math.random().toString(36).slice(2, 8);
    while (ids.has(id)) id += 'x';
    ids.add(id);
    const o = { id, kind: it.kind, name: str(it.name, 60) || '', t0: num(it.t0, 0, 0), t1: it.t1 == null ? null : num(it.t1, null, 0),
      fin: num(it.fin, 0, 0, 10), fout: num(it.fout, 0, 0, 10), anim: it.anim === 'pop' ? 'pop' : 'none',
      x: num(it.x, 960), y: num(it.y, 540), w: num(it.w, 200, 1, 20000), h: num(it.h, 120, 1, 20000), rot: num(it.rot, 0, -3600, 3600), op: num(it.op, 1, 0, 1) };
    if (o.t1 != null && o.t1 <= o.t0) o.t1 = o.t0 + 0.1;
    if (it.hide) o.hide = true;
    if (it.shadow) o.shadow = true;
    if (it.kind === 'text') Object.assign(o, { text: str(it.text, 500) ?? '', font: str(it.font, 60) || '', size: num(it.size, 72, 6, 600), weight: num(it.weight, 800, 100, 900),
      color: col(it.color) || '#ffffff', stroke: col(it.stroke) || null, strokeW: num(it.strokeW, 0, 0, 1), align: ['left', 'center', 'right'].includes(it.align) ? it.align : 'center' });
    if (it.kind === 'image') { const s = str(it.src, 160); if (!s || !SRC_RE.test(s.replace(/\\/g, '/'))) continue; o.src = s.replace(/\\/g, '/'); }
    if (it.kind === 'rect' || it.kind === 'ellipse' || it.kind === 'arrow') Object.assign(o, { fill: col(it.fill) || null, line: col(it.line) || null, lineW: num(it.lineW, 0, 0, 400), radius: num(it.radius, 0, 0, 2000) });
    out.push(o);
  }
  return out;
}

export function cleanActors(obj) {
  const out = {};
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return out;
  for (const [k, v] of Object.entries(obj).slice(0, 2000)) {
    if (typeof k !== 'string' || k.length > 160 || !k.includes('|') || !v || typeof v !== 'object') continue;
    const o = {};
    if (Math.abs(num(v.dx, 0)) > 1e-3) o.dx = num(v.dx, 0, -20000, 20000);
    if (Math.abs(num(v.dy, 0)) > 1e-3) o.dy = num(v.dy, 0, -20000, 20000);
    if (Math.abs(num(v.s, 1) - 1) > 1e-3) o.s = num(v.s, 1, 0.05, 20);
    if (v.hide) o.hide = true;
    if (Object.keys(o).length) out[k] = o;
  }
  return out;
}

// a picture the user adds to the film: saved in the film's own folder so previews and renders find it
export function saveAsset(p, { name, data }) {
  const m = /^data:image\/(png|jpeg|webp|gif);base64,([A-Za-z0-9+/=]+)$/.exec(data || '');
  if (!m) throw Object.assign(new Error('Must be a PNG, JPEG, WEBP or GIF'), { code: 400 });
  const buf = Buffer.from(m[2], 'base64');
  if (buf.length > 25 * 1024 * 1024) throw Object.assign(new Error('Image is larger than 25 MB'), { code: 400 });
  const ext = m[1] === 'jpeg' ? '.jpg' : '.' + m[1];
  const base = String(name || 'image').replace(/\.[^.]+$/, '').replace(/[^\p{L}\p{N}_\-]+/gu, '_').slice(0, 60) || 'image';
  const dir = path.join(p.path, 'vh2d');
  fs.mkdirSync(dir, { recursive: true });
  let file = base + ext;
  for (let n = 2; fs.existsSync(path.join(dir, file)); n++) file = `${base}_${n}${ext}`;
  fs.writeFileSync(path.join(dir, file), buf);
  return { src: 'vh2d/' + file };
}
export function listAssets(p) {
  try { return fs.readdirSync(path.join(p.path, 'vh2d')).filter((f) => /\.(png|jpe?g|webp|gif)$/i.test(f)).map((f) => ({ src: 'vh2d/' + f })); } catch { return []; }
}

export function routes(route, readBody) {
  const need = (id) => { const p = project(id); if (!p) throw Object.assign(new Error('Project not found'), { code: 404 }); return p; };
  route('POST', '/api/project/:id/asset2d', async (req, url, { id }) => saveAsset(need(id), await readBody(req)));
  route('GET', '/api/project/:id/assets2d', (req, url, { id }) => listAssets(need(id)));
}
