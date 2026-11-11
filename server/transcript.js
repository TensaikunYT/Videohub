// The narration's text with timings, from whatever the project already has: words.json ([[s,e,w]] or
// [{w|word|text, s|start, e|end}]), words.js (export const WORDS = [[s,e,"w"], ...]) or an .srt.
// Words are grouped into sentences for the timeline; a note remembers the sentence spoken at its moment.
// .videohub/project.json may set transcript: {file, offset} (offset = seconds of film before the narration starts).
import fs from 'node:fs';
import path from 'node:path';
import { readJson } from './util.js';

const SKIP = new Set(['node_modules', 'render', 'snaps', 'out', '.videohub', '.git', 'chunks', 'qa', 'lookdev', 'previews', 'profiles', 'tmp']);
const cache = new Map();   // file -> {mtime, data}

// best candidate file: word files first (words.json, then words_tr / other languages), then phrase SRTs, then any SRT
// the walk is synchronous and ran for every note (qa/lookdev folders hold thousands of frames): remember the answer 5 min
const found5 = new Map();
function findFile(dir) {
  const c = found5.get(dir); if (c && Date.now() - c.at < 300000 && (!c.f || fs.existsSync(c.f))) return c.f;
  const f = findFileNow(dir); found5.set(dir, { at: Date.now(), f }); return f;
}
function findFileNow(dir) {
  const found = [];
  (function walk(d, depth) {
    let es = []; try { es = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of es) {
      const f = path.join(d, e.name);
      if (e.isDirectory()) { if (depth < 3 && !SKIP.has(e.name) && !e.name.startsWith('chunks')) walk(f, depth + 1); continue; }
      const n = e.name.toLowerCase();
      let score = 0;
      if (n === 'words.json') score = 100; else if (n === 'words_tr.json') score = 95; else if (/^words_[a-z]{2}\.json$/.test(n)) score = 90;
      else if (n === 'words.js') score = 85; else if (/^words.*\.json$/.test(n) && !/raw/.test(n)) score = 70;
      else if (/phrase.*\.srt$/.test(n)) score = 60; else if (n === 'voice.srt') score = 55; else if (/\.srt$/.test(n) && !/words/.test(n)) score = 40; else if (/\.srt$/.test(n)) score = 30;
      if (score) found.push({ f, score: score - depth });
    }
  })(dir, 0);
  found.sort((a, b) => b.score - a.score);
  return found[0]?.f || null;
}

function parse(file) {
  const txt = fs.readFileSync(file, 'utf8').replace(/^﻿/, '');
  if (/\.srt$/i.test(file)) {
    const out = [], ts = s => { const m = s.match(/(\d+):(\d+):(\d+)[,.](\d+)/); return m ? +m[1] * 3600 + +m[2] * 60 + +m[3] + +m[4] / 1000 : null; };
    for (const block of txt.split(/\r?\n\r?\n/)) {
      const lines = block.split(/\r?\n/).filter(Boolean), at = lines.findIndex(l => l.includes('-->')); if (at < 0) continue;
      const [a, b] = lines[at].split('-->').map(ts), text = lines.slice(at + 1).join(' ').replace(/<[^>]+>/g, '').trim();
      if (a != null && b != null && text) out.push([a, b, text]);
    }
    return { items: out, kind: 'phrases' };
  }
  if (/\.js$/i.test(file)) {
    const out = []; const re = /\[\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*,\s*(["'`])((?:\\.|(?!\3).)*)\3\s*\]/g; let m;
    while ((m = re.exec(txt))) out.push([+m[1], +m[2], m[4].replace(/\\(.)/g, '$1')]);
    return { items: out, kind: 'words' };
  }
  const j = JSON.parse(txt), arr = Array.isArray(j) ? j : (j.words || j.segments || []);
  const items = arr.map(x => Array.isArray(x) ? [+x[0], +x[1], String(x[2] ?? '')] : [+(x.s ?? x.start ?? x.t0), +(x.e ?? x.end ?? x.t1), String(x.w ?? x.word ?? x.text ?? '')])
    .filter(x => isFinite(x[0]) && isFinite(x[1]) && x[2].trim());
  return { items, kind: items.some(x => /\s/.test(x[2].trim())) ? 'phrases' : 'words' };
}

// words → sentences: end at . ! ? … : or a pause longer than 0.6 s, or at ~14 words
function sentences(words) {
  const out = []; let cur = null;
  for (const [s, e, w] of words) {
    if (cur && s - cur[1] > 0.6) { out.push(cur); cur = null; }
    if (!cur) cur = [s, e, w.trim()]; else { cur[1] = e; cur[2] += (/^['’,.!?;:)]/.test(w) ? '' : ' ') + w.trim(); }
    if (/[.!?…:]["”’)]*$/.test(w.trim()) || cur[2].split(' ').length >= 14) { out.push(cur); cur = null; }
  }
  if (cur) out.push(cur);
  return out;
}

export function transcript(p) {
  const meta = readJson(path.join(p.path, '.videohub', 'project.json'), {});
  const conf = meta.transcript || {};
  const file = conf.file ? path.resolve(p.path, conf.file) : findFile(p.path);
  if (!file || !fs.existsSync(file)) return { ok: false, reason: 'No narration transcript (words.json / words.js / .srt) found in this project.' };
  const mtime = fs.statSync(file).mtimeMs, offset = +conf.offset || 0, key = file + '|' + offset;
  const hit = cache.get(key); if (hit && hit.mtime === mtime) return hit.data;
  let data;
  try {
    const { items, kind } = parse(file);
    const shift = x => [+(x[0] + offset).toFixed(3), +(x[1] + offset).toFixed(3), x[2]];
    const words = kind === 'words' ? items.map(shift) : [];
    const phrases = (kind === 'words' ? sentences(items) : items).map(shift);
    data = { ok: true, source: path.relative(p.path, file), offset, words, phrases };
  } catch (e) { data = { ok: false, reason: `Could not read transcript file (${path.basename(file)}): ${e.message}` }; }
  cache.set(key, { mtime, data });
  return data;
}

// the sentence(s) spoken at t (or across t..t2), for a note
export function spokenAt(p, t, t2) {
  const tr = transcript(p); if (!tr.ok) return null;
  const a = t, b = t2 ?? t;
  const hits = tr.phrases.filter(([s, e]) => e >= a - 0.25 && s <= b + 0.25);
  if (!hits.length) { const prev = tr.phrases.filter(([s]) => s <= a).pop(); return prev && a - prev[1] < 2 ? prev[2] : null; }
  return hits.map(x => x[2]).join(' ').slice(0, 400);
}
