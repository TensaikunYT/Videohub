// Pure helpers for the multi-track timeline (P3a): which rows it shows and how tall, clip lanes, ruler ticks, snapping.
// No DOM here (tracks.test.js runs it in Node).

export const COLLAPSED_H = 14;
export const MAX_LANES = 8;
const STEMS = { vo: 1, music: 1, sfx: 1 };
const ROW_COLOR = { pic: '#8f8f9a', mix: '#9aa0b0', scenes: '#5a78b0', notes: '#e6c14d', text: '#609cff', vo: '#46c480', music: '#5f8fe0', sfx: '#c9a86a', cues: '#f08a3c', st: '#a98ad8', 'add-music': '#3f6fc0', 'add-sfx': '#b08a50' };

// a clip's length on the timeline (loop: to the end of the film)
export function clipLen(c, filmDur = Infinity) {
  return Math.max(0.05, c.len != null ? +c.len : c.loop ? filmDur - c.t : Math.max(0, (c.dur || 0.5) - (c.trim || 0)));
}
const hasLane = c => Number.isInteger(c.lane) && c.lane >= 0 && c.lane < MAX_LANES;

// first lane (0..7) of clip.kind where the clip overlaps no other clip that already has a lane; for a NEW clip
// (and once for an old clip saved before lanes existed, in timestamp order)
export function assignLane(clips, clip, filmDur = Infinity) {
  const a = +clip.t || 0, b = a + clipLen(clip, filmDur), kind = clip.kind === 'music' ? 'music' : 'sfx';
  for (let lane = 0; lane < MAX_LANES; lane++) {
    const busy = (clips || []).some(c => c !== clip && c.id !== clip.id && hasLane(c) && c.lane === lane && (c.kind === 'music' ? 'music' : 'sfx') === kind
      && c.t < b - 1e-6 && c.t + clipLen(c, filmDur) > a + 1e-6);
    if (!busy) return lane;
  }
  return MAX_LANES - 1;
}

// lanes shown for a kind: the highest used lane + one free lane under it (a drop target), at least 1
export function laneCount(clips, kind) {
  let max = -1;
  for (const c of clips || []) if ((c.kind === 'music' ? 'music' : 'sfx') === kind && hasLane(c)) max = Math.max(max, c.lane);
  return Math.max(1, Math.min(MAX_LANES, max + 2));
}

// rows top → bottom; collapsed rows are 14 px; header = which controls the row will carry (P3c), null = none
export function buildRows({ live, strip, scenes, transcript, layers, cues, clips, canClips, collapsed }) {
  const C = collapsed instanceof Set ? collapsed : new Set(collapsed || []), rows = [];
  const add = (id, kind, label, h, color, header = null, extra = {}) => rows.push({ id, kind, label, h: C.has(id) ? COLLAPSED_H : h, full: h, collapsed: C.has(id), color, header, ...extra });
  if (!live && strip) add('pic', 'pic', 'Picture', 40, ROW_COLOR.pic);
  add('mix', 'mix', 'Film audio', 26, ROW_COLOR.mix, { mute: false, solo: false, level: true });
  if (scenes && scenes.length) add('scenes', 'scenes', 'Scenes', 24, ROW_COLOR.scenes);
  add('notes', 'notes', 'Notes', 20, ROW_COLOR.notes);
  if (transcript) add('text', 'text', 'Text', 22, ROW_COLOR.text);
  const L = layers || [];
  for (const l of L) {
    if (STEMS[l.id]) add(l.id, 'layer', l.label, 30, ROW_COLOR[l.id], { mute: true, solo: true, level: true }, { layer: l, cues: l.id === 'sfx' && !!(cues && cues.length) });
    else add(l.id, 'layer', l.label, 26, ROW_COLOR.st, { mute: true, solo: true, level: false }, { layer: l, extra: true });
  }
  if (cues && cues.length && !L.some(l => l.id === 'sfx')) add('cues', 'cues', 'Effects', 20, ROW_COLOR.cues, null, { cues: true });
  if (canClips) for (const k of ['music', 'sfx']) {
    const lanes = laneCount(clips, k);
    add('add-' + k, 'clips', k === 'music' ? 'Added music' : 'Added effects', 26 * lanes, ROW_COLOR['add-' + k], { mute: false, solo: false, level: k === 'music', add: true }, { lanes, clipKind: k });
  }
  let y = 0; for (const r of rows) { r.y = y; y += r.h; }
  return rows;
}

// ruler ticks: the first step that leaves ≥ 80 px between labels; minor ticks between them
export function tickSpec(duration, pxPerSec, fps) {
  const f = fps > 0 ? fps : 30;
  const cands = [1 / f, 2 / f, 5 / f, 10 / f, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 1200].sort((p, q) => p - q).filter((s, i, a) => i === 0 || s > a[i - 1] + 1e-9);
  const major = cands.find(s => s * pxPerSec >= 80) || 1200;
  // sub-second majors count in frames (0.5 s = 15 frames at 30 fps → /5); from 1 s on, in whole 5 s steps
  const nf = major * f, isFrames = major < 0.5 - 1e-9, wholeFrames = Math.abs(nf - Math.round(nf)) < 1e-6;
  const mult5 = major < 1 - 1e-9 ? wholeFrames && Math.round(nf) % 5 === 0 : Math.abs(major / 5 - Math.round(major / 5)) < 1e-9;
  let minor = mult5 ? major / 5 : major / 2;
  if (isFrames && minor * f < 1 - 1e-9) minor = major;   // never half a frame
  return { major, minor, frames: major < 1 };
}

// a tick label: m:ss:ff when the ticks are under a second apart, else m:ss (h:mm:ss from an hour)
export function fmtTick(t, fps, frames) {
  t = Math.max(0, t);
  const p2 = n => String(n).padStart(2, '0');
  if (frames) { const f = fps > 0 ? fps : 30, n = Math.round(t * f), s = Math.floor(n / f), ff = n - s * f; return `${Math.floor(s / 60)}:${p2(s % 60)}:${p2(ff)}`; }
  const s = Math.round(t * 1000) / 1000, whole = Math.floor(s + 1e-6);
  if (whole < 3600) return `${Math.floor(whole / 60)}:${p2(whole % 60)}`;
  return `${Math.floor(whole / 3600)}:${p2(Math.floor(whole / 60) % 60)}:${p2(whole % 60)}`;
}

// snapping a dragged block [start, start + len]: the nearest candidate to either edge within thresholdPx (screen px)
export function findDragSnap(cands, start, len, pxPerSec, thresholdPx = 8) {
  let best = null, bd = Infinity;
  for (const [edge, e] of [['start', start], ['end', start + len]]) for (const c of cands || []) {
    if (!Number.isFinite(c)) continue;
    const d = Math.abs((c - e) * pxPerSec);
    if (d <= thresholdPx && d < bd) { bd = d; best = { t: start + (c - e), guide: c, edge }; }
  }
  return best;
}

// snapping one edge (trim): the nearest candidate within thresholdPx, else t itself
export function snapEdgeTime(t, cands, pxPerSec, thresholdPx = 12) {
  let best = t, bd = Infinity;
  for (const c of cands || []) { if (!Number.isFinite(c)) continue; const d = Math.abs(c - t) * pxPerSec; if (d <= thresholdPx && d < bd) { bd = d; best = c; } }
  return best;
}

// auto-pan while dragging near the canvas edges: px per frame, negative at the left edge, 0 until the pointer moved
export function edgeScrollStep(left, right, clientX, moved) {
  if (!moved) return 0;
  const Z = 40, dl = clientX - left, dr = right - clientX;
  const k = d => Math.min(1, (Z - d) / Z) ** 2;
  if (dl < Z && dl <= dr) return -18 * k(dl);
  if (dr < Z) return 18 * k(dr);
  return 0;
}
