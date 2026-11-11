// One writer for a film's tweaks.json (scene editor, 2D layers, sound levels, added sounds). Pure helpers: the
// cleaners, the field-level sound merge, the key-by-key merge PATCH uses, a strict reader and an atomic write.
// The page-side tweaks API (window.VH_EDIT) drops a file without `shots`, so every write keeps `v: 1, shots`.
import fs from 'node:fs';

export const NOTE = 'VideoHub scene editor: the engine applies these over the scene code on every frame; sound = per-scene sound levels; items2d/actors2d = 2D layers; audio = audio edits';
const LEVELS = ['music', 'sfx', 'vo', 'all'];
const fin = (v) => v != null && v !== '' && Number.isFinite(+v);

// a cut: shifted d s and/or given a transition tr { type, dur, dir, color } (2D films, engine/lib/transitions2d.js)
const TRT = /^(cut|mix|blur|zoom|whip|slide|ramp|wipe|iris|flash|light-leak|film-burn|portal)$/;
export function cleanTr(t) {
  return t && typeof t.type === 'string' && TRT.test(t.type) ? { type: t.type, ...(fin(t.dur) ? { dur: Math.max(0.05, Math.min(5, +t.dur)) } : {}), ...(/^(left|right|up|down)$/.test(t.dir) ? { dir: t.dir } : {}), ...(/^#[0-9a-f]{6}$/i.test(t.color || '') ? { color: t.color } : {}) } : null;
}
export function cleanCuts(arr) {
  return Array.isArray(arr) ? arr.filter((c) => c && Number.isFinite(+c.at) && (Number.isFinite(+c.d) || c.tr)).map((c) => { const tr = cleanTr(c.tr); return { at: +c.at, d: Number.isFinite(+c.d) ? +c.d : 0, ...(tr ? { tr } : {}) }; }).filter((c) => c.d || c.tr) : [];
}
// one sound entry: { shot, t0, t1, music?, sfx?, vo?, all? (0–4), fade? (s, 0.02–5) }
function cleanEntry(e) {
  if (!e || typeof e.shot !== 'string' || !(+e.t1 > +e.t0)) return null;
  const o = { shot: e.shot.slice(0, 120), t0: +e.t0, t1: +e.t1 };
  for (const k of LEVELS) if (fin(e[k])) o[k] = Math.max(0, Math.min(4, +e[k]));
  if (fin(e.fade)) o.fade = Math.max(0.02, Math.min(5, +e.fade));
  return o;
}
export function cleanSound(arr) {
  return Array.isArray(arr) ? arr.map(cleanEntry).filter(Boolean) : [];
}
const hasLevel = (e) => LEVELS.some((k) => e[k] != null && Math.abs(e[k] - 1) > 1e-3);

// ops = { set: [{ shot, t0?, t1?, music?, sfx?, vo?, all?, fade? }], remove: [shot] }: merged by `shot`, field by
// field (a given field replaces, null removes it); an entry with no level ≠ 1 left is dropped; sorted by t0
export function applySoundOps(list, ops) {
  const out = cleanSound(list).map((e) => ({ ...e }));
  const o = ops && typeof ops === 'object' ? ops : {};
  const rm = new Set((Array.isArray(o.remove) ? o.remove : []).filter((s) => typeof s === 'string'));
  let L = out.filter((e) => !rm.has(e.shot));
  for (const s of Array.isArray(o.set) ? o.set : []) {
    if (!s || typeof s.shot !== 'string') continue;
    const i = L.findIndex((e) => e.shot === s.shot), cur = i >= 0 ? { ...L[i] } : { shot: s.shot };
    for (const k of ['t0', 't1', ...LEVELS, 'fade']) if (s[k] !== undefined) { if (s[k] === null) { if (k !== 't0' && k !== 't1') delete cur[k]; } else cur[k] = s[k]; }
    const c = cleanEntry(cur);
    if (i >= 0) L.splice(i, 1);
    if (c && hasLevel(c)) L.push(c);
  }
  L = L.filter(hasLevel);
  return L.sort((a, b) => a.t0 - b.t0);
}

// a new tweaks.json from the old one and a body: each key given replaces only that key (through its cleaner),
// `soundOps` merges into the current `sound`; keys left out (and unknown keys of the old file) stay as they are
export function mergeTweaks(old, body, { cleanAudio, cleanItems, cleanActors } = {}) {
  const o = old && typeof old === 'object' && !Array.isArray(old) ? old : {}, b = body || {};
  const isObj = (x) => x && typeof x === 'object' && !Array.isArray(x);
  const out = { ...o, v: 1, note: NOTE };
  out.shots = 'shots' in b && isObj(b.shots) ? b.shots : isObj(o.shots) ? o.shots : {};
  if ('cuts' in b) out.cuts = cleanCuts(b.cuts);
  if ('sound' in b) out.sound = cleanSound(b.sound);
  if (b.soundOps) out.sound = applySoundOps(out.sound || [], b.soundOps);
  if ('items2d' in b && cleanItems) out.items2d = cleanItems(b.items2d);
  if ('actors2d' in b && cleanActors) out.actors2d = cleanActors(b.actors2d);
  if ('audio' in b && cleanAudio) out.audio = cleanAudio(b.audio);
  for (const k of ['items2d', 'actors2d']) if (Array.isArray(out[k]) ? !out[k].length : out[k] && !Object.keys(out[k]).length) delete out[k];
  return out;
}

// the file as it is: {} when there is none; a file that exists but does not parse throws (409), so nothing ever
// overwrites a half-written or hand-broken file with a blank one
export function readTweaksStrict(file) {
  let txt;
  try { txt = fs.readFileSync(file, 'utf8'); } catch (e) { if (e.code === 'ENOENT') return {}; throw e; }
  if (!txt.trim()) return {};
  try { const j = JSON.parse(txt.replace(/^﻿/, '')); return j && typeof j === 'object' && !Array.isArray(j) ? j : {}; }
  catch { throw Object.assign(new Error('Could not read tweaks.json; fix it manually'), { code: 409 }); }
}

// tmp file + rename (readers never see half a file); Windows refuses the rename while someone reads the file, so
// retry 6 × 120 ms like vhsound.mjs replaceFile, then write in place
export function writeTweaks(file, obj) {
  const txt = JSON.stringify(obj, null, 1), tmp = file + '.' + process.pid + '.tmp';
  fs.writeFileSync(tmp, txt);
  for (let k = 0; k < 6; k++) {
    try { fs.renameSync(tmp, file); return; } catch (e) { if (!['EPERM', 'EBUSY', 'EACCES'].includes(e.code)) { try { fs.unlinkSync(tmp); } catch { } throw e; } }
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 120);
  }
  fs.writeFileSync(file, txt); try { fs.unlinkSync(tmp); } catch { }
}
