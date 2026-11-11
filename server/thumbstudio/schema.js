// Thumbnail brief validation and normalization. The catalog data lives in ui/thumbstudio/catalog.js (shared with the UI).
import { thumbStatus, thumbNoteStatus } from '../../ui/values.js';
import { STYLE_PRESETS, POSES, EXPRESSIONS, CAMERA_ANGLES, CAMERA_SHOTS, LENSES, LIGHT_KEYS, LIGHT_TIMES, TEXT_PRESETS, EFFECT_KINDS, MOODS, catalog } from '../../ui/thumbstudio/catalog.js';
// text preset ids of older (Turkish) versions
const LEGACY_FONTS = { 'youtube-kal\u0131n': 'youtube-bold', 'youtube-kalin': 'youtube-bold', 'belgesel-serif': 'documentary-serif', 'minimal-temiz': 'clean-minimal', 'etiket-kutusu': 'label-box' };
export { STYLE_PRESETS, POSES, EXPRESSIONS, CAMERA_ANGLES, CAMERA_SHOTS, LENSES, LIGHT_KEYS, LIGHT_TIMES, TEXT_PRESETS, EFFECT_KINDS, MOODS, catalog };
// ---------- brief validation helpers
// a missing value takes the default d (it used to fall to the lower bound: horizon 0, x -0.5, w 0.01 …)
const clamp = (v, lo, hi, d = lo) => Math.max(lo, Math.min(hi, typeof v === 'number' && Number.isFinite(v) ? v : d));
const TID_RE = /^\d{8}-[a-z0-9]{4,8}$/;
const PID_RE = /^(_|[0-9a-f]{12})$/;

export const validTid = id => TID_RE.test(id);
export const validPid = id => PID_RE.test(id);

// normalize + validate a brief object; strips unknown fields, clamps numbers, returns cleaned copy
export function normalizeBrief(raw) {
  if (!raw || typeof raw !== 'object') throw new Error('Brief is empty or invalid');
  const b = {};
  b.v = 1;
  b.id = typeof raw.id === 'string' && validTid(raw.id) ? raw.id : generateTid();
  b.title = typeof raw.title === 'string' ? raw.title.slice(0, 200) : '';
  b.project = typeof raw.project === 'string' && (raw.project === null || /^[0-9a-f]{12}$/.test(raw.project)) ? raw.project : (raw.project || null);
  b.format = raw.format === '9:16' ? '9:16' : '16:9';
  const status0 = thumbStatus(raw.status);   // older briefs: Turkish status words
  b.status = ['draft', 'generating', 'chosen', 'final'].includes(status0) ? status0 : 'draft';
  b.created = typeof raw.created === 'string' ? raw.created : new Date().toISOString();
  b.updated = new Date().toISOString();

  // goal
  b.goal = {};
  if (raw.goal && typeof raw.goal === 'object') {
    b.goal.topic = typeof raw.goal.topic === 'string' ? raw.goal.topic.slice(0, 500) : '';
    b.goal.feeling = typeof raw.goal.feeling === 'string' ? raw.goal.feeling.slice(0, 200) : '';
    b.goal.hook = typeof raw.goal.hook === 'string' ? raw.goal.hook.slice(0, 200) : '';
  }

  // camera
  b.camera = {};
  const cam = raw.camera || {};
  b.camera.shot = CAMERA_SHOTS.some(s => s.id === cam.shot) ? cam.shot : 'wide';
  b.camera.angle = CAMERA_ANGLES.some(a => a.id === cam.angle) ? cam.angle : 'eye';
  b.camera.tilt = clamp(cam.tilt, -30, 30, 0);
  b.camera.height = clamp(cam.height, 0, 1, 0.5);
  b.camera.lens = LENSES.includes(cam.lens) ? cam.lens : 50;
  b.camera.horizon = clamp(cam.horizon, 0, 1, CAMERA_ANGLES.find(a => a.id === cam.angle)?.horizon ?? 0.5);
  b.camera.vanishX = clamp(cam.vanishX, 0, 1, 0.5);
  b.camera.focusLayer = typeof cam.focusLayer === 'string' ? cam.focusLayer : null;
  b.camera.dof = clamp(cam.dof, 0, 1, 0.4);

  // light
  b.light = {};
  const li = raw.light || {};
  b.light.azimuth = clamp(li.azimuth, 0, 360, 220);
  b.light.elevation = clamp(li.elevation, 0, 90, 35);
  b.light.key = LIGHT_KEYS.some(k => k.id === li.key) ? li.key : 'warm';
  b.light.rim = !!li.rim;
  b.light.time = LIGHT_TIMES.some(t => t.id === li.time) ? li.time : 'day';
  b.light.contrast = clamp(li.contrast, 0, 1, 0.5);
  b.light.notes = typeof li.notes === 'string' ? li.notes.slice(0, 300) : '';

  // style
  b.style = {};
  const st = raw.style || {};
  b.style.preset = STYLE_PRESETS.some(s => s.id === st.preset) ? st.preset : 'cinematic-photo';
  b.style.custom = typeof st.custom === 'string' ? st.custom.slice(0, 500) : '';
  b.style.palette = Array.isArray(st.palette) ? st.palette.filter(c => typeof c === 'string' && /^#[0-9a-fA-F]{6}$/.test(c)).slice(0, 10) : [];
  b.style.saturation = clamp(st.saturation, 0, 1, 0.6);
  b.style.detail = clamp(st.detail, 0, 1, 0.8);
  b.style.mood = typeof st.mood === 'string' ? st.mood.slice(0, 50) : '';

  // text
  b.text = {};
  const tx = raw.text || {};
  b.text.policy = tx.policy === 'ai' ? 'ai' : 'overlay';
  b.text.reserve = tx.reserve !== false;

  b.negative = typeof raw.negative === 'string' ? raw.negative.slice(0, 500) : '';
  b.promptOverride = typeof raw.promptOverride === 'string' ? raw.promptOverride.slice(0, 3000) : null;

  // refs
  b.refs = Array.isArray(raw.refs) ? raw.refs.filter(r => r && typeof r === 'object').slice(0, 20).map(r => ({
    id: typeof r.id === 'string' ? r.id : 'R0',
    file: typeof r.file === 'string' ? r.file : '',
    role: ['style', 'character', 'object', 'composition', 'background'].includes(r.role) ? r.role : 'style',
    note: typeof r.note === 'string' ? r.note.slice(0, 300) : '',
    layer: typeof r.layer === 'string' ? r.layer : null,
  })) : [];

  // layers (limit 60)
  b.layers = Array.isArray(raw.layers) ? raw.layers.filter(l => l && typeof l === 'object').slice(0, 60).map(normalizeLayer) : [];

  // safe guides
  b.safe = {};
  const sf = raw.safe || {};
  b.safe.thirds = sf.thirds !== false;
  b.safe.badge = sf.badge !== false;
  b.safe.shortsUi = !!sf.shortsUi;

  // variants
  b.variants = Array.isArray(raw.variants) ? raw.variants.filter(v => v && typeof v === 'object' && typeof v.id === 'string' && typeof v.file === 'string').slice(0, 200).map(v => ({ ...v, notes: Array.isArray(v.notes) ? v.notes.filter(n => n && typeof n === 'object').slice(0, 100).map(n => (n.status === undefined ? n : { ...n, status: thumbNoteStatus(n.status) })) : [] })) : [];
  b.chosen = typeof raw.chosen === 'string' ? raw.chosen : null;
  b.final = raw.final && typeof raw.final === 'object' ? raw.final : null;
  b.exported = typeof raw.exported === 'string' ? raw.exported : null;
  // final composition settings (crop of the chosen variant + simple adjustments)
  const fe = raw.finalEdit && typeof raw.finalEdit === 'object' ? raw.finalEdit : {};
  b.finalEdit = { x: clamp(fe.x ?? 0.5, 0, 1), y: clamp(fe.y ?? 0.5, 0, 1), zoom: clamp(fe.zoom ?? 1, 1, 3), brightness: clamp(fe.brightness ?? 1, 0.5, 1.5),
    contrast: clamp(fe.contrast ?? 1, 0.5, 1.6), saturation: clamp(fe.saturation ?? 1, 0, 2), vignette: clamp(fe.vignette ?? 0, 0, 1), shade: clamp(fe.shade ?? 0, 0, 1) };

  return b;
}

const TYPE_COLOR = { background: '#1d2432', subject: '#6aa0ff', object: '#f08a3c', text: '#e6c14d', effect: '#ff3b3b', zone: '#a68cff', sketch: '#ff4444', trace: '#888888' };
function normalizeLayer(raw) {
  const l = {};
  const types = ['subject', 'object', 'background', 'text', 'effect', 'sketch', 'zone', 'trace'];
  l.id = typeof raw.id === 'string' ? raw.id : 'L0';
  l.type = types.includes(raw.type) ? raw.type : 'object';
  l.name = typeof raw.name === 'string' ? raw.name.slice(0, 100) : '';
  const full = raw.type === 'background' || raw.type === 'trace';   // these fill the frame unless told otherwise
  l.x = clamp(raw.x, -0.5, 1.5, full ? 0 : 0.25);
  l.y = clamp(raw.y, -0.5, 1.5, full ? 0 : 0.25);
  l.w = clamp(raw.w, 0.01, 3, full ? 1 : 0.5);
  l.h = clamp(raw.h, 0.01, 3, full ? 1 : 0.5);
  l.rot = clamp(raw.rot, -360, 360, 0);
  l.flip = !!raw.flip;
  l.depth = clamp(raw.depth, 0, 100, 50);
  l.importance = clamp(Math.round(raw.importance || 1), 1, 3);
  l.focus = ['auto', 'sharp', 'blur'].includes(raw.focus) ? raw.focus : 'auto';
  l.desc = typeof raw.desc === 'string' ? raw.desc.slice(0, 500) : '';
  // block colour in the editor (never sent to the image model); a default per type so blocks stand apart
  l.color = typeof raw.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(raw.color) ? raw.color : (TYPE_COLOR[l.type] || '#6aa0ff');
  l.hidden = !!raw.hidden;
  l.locked = !!raw.locked;
  l.refs = Array.isArray(raw.refs) ? raw.refs.filter(r => typeof r === 'string').slice(0, 5) : [];

  // type-specific fields
  if (l.type === 'subject') {
    l.pose = typeof raw.pose === 'string' ? raw.pose : 'ayakta';
    l.expression = typeof raw.expression === 'string' ? raw.expression : 'notr';
    l.facing = ['camera', 'left', 'right', 'away'].includes(raw.facing) ? raw.facing : 'camera';
    l.gaze = typeof raw.gaze === 'string' ? raw.gaze : 'camera';
    l.crop = ['full', 'knee', 'waist', 'chest', 'head'].includes(raw.crop) ? raw.crop : 'full';
    if (raw.joints && typeof raw.joints === 'object') l.joints = raw.joints;
  }
  if (l.type === 'object') {
    l.shape = ['rect', 'ellipse', 'blob', 'triangle', 'image'].includes(raw.shape) ? raw.shape : 'rect';
    l.material = typeof raw.material === 'string' ? raw.material.slice(0, 100) : '';
  }
  if (l.type === 'background') {
    l.kind = ['scene', 'gradient', 'solid', 'blur'].includes(raw.kind) ? raw.kind : 'scene';
    l.depth = 100; // always 100
  }
  if (l.type === 'text') {
    l.content = typeof raw.content === 'string' ? raw.content.slice(0, 500) : '';
    l.font = typeof raw.font === 'string' ? (LEGACY_FONTS[raw.font] || raw.font) : 'youtube-bold';
    l.size = clamp(raw.size, 0.01, 0.5, 0.12);
    l.fill = typeof raw.fill === 'string' ? raw.fill : '#ffffff';
    l.stroke = typeof raw.stroke === 'string' ? raw.stroke : '#000000';
    l.strokeW = clamp(raw.strokeW, 0, 0.2, 0.05);
    l.shadow = !!raw.shadow;
    l.align = ['left', 'center', 'right'].includes(raw.align) ? raw.align : 'center';
    l.lineHeight = clamp(raw.lineHeight, 0.8, 2.0, 1.1);
    l.uppercase = !!raw.uppercase;
    l.highlightWords = Array.isArray(raw.highlightWords) ? raw.highlightWords.filter(w => typeof w === 'string').slice(0, 10) : [];
    l.bg = typeof raw.bg === 'string' ? raw.bg : null;
    l.highlight = typeof raw.highlight === 'string' && /^#[0-9a-fA-F]{6}$/.test(raw.highlight) ? raw.highlight : '#ffd400';
  }
  if (l.type === 'effect') {
    l.kind = EFFECT_KINDS.includes(raw.kind) ? raw.kind : 'arrow';
    l.stroke = typeof raw.stroke === 'string' ? raw.stroke : '#ff0000';
    l.fill = typeof raw.fill === 'string' ? raw.fill : null;
    l.points = Array.isArray(raw.points) ? raw.points.slice(0, 20) : [];
    l.overlay = raw.overlay !== false;
  }
  if (l.type === 'sketch') {
    l.strokes = Array.isArray(raw.strokes) ? raw.strokes.slice(0, 500) : [];
    // limit total points to 20000
    let pts = 0;
    l.strokes = l.strokes.filter(s => {
      if (!s || !Array.isArray(s.pts)) return false;
      pts += s.pts.length;
      return pts <= 20000;
    });
  }
  if (l.type === 'zone') {
    l.purpose = ['empty', 'title', 'face'].includes(raw.purpose) ? raw.purpose : 'empty';
  }
  if (l.type === 'trace') {
    l.file = typeof raw.file === 'string' ? raw.file : '';
    l.opacity = clamp(raw.opacity, 0, 1, 0.4);
  }
  return l;
}

// generate a thumbnail id: YYYYMMDD-xxxx
export function generateTid() {
  const d = new Date();
  const date = d.getFullYear().toString() + String(d.getMonth() + 1).padStart(2, '0') + String(d.getDate()).padStart(2, '0');
  const rand = Math.random().toString(36).slice(2, 6);
  return date + '-' + rand;
}
