// The film's scenes/shots ({name, t0, t1} in film seconds) for the review timeline's scene lane.
// The live preview reads them from the page (ui/review/scenes.js: VH_SCENES, SHOTS, EVENTS.shots + PIECES, __qaShotAt)
// and stores them here (<project>/.videohub/scenes.json), so a rendered video of the same film shows them too.
// Without a stored list: data/shots.json (spotlight `render.js cues`), shots.json at the top.
import fs from 'node:fs';
import path from 'node:path';
import { project } from './scan.js';
import { readJson, writeJson } from './util.js';

const file = (p) => path.join(p.path, '.videohub', 'scenes.json');

export function clean(list) {
  if (!Array.isArray(list)) return [];
  const out = list.filter((s) => s && Number.isFinite(+s.t0) && Number.isFinite(+s.t1) && +s.t1 > +s.t0)
    .slice(0, 2000)
    .map((s) => ({ name: String(s.name ?? s.id ?? s.label ?? '').slice(0, 60) || 'scene', t0: +(+s.t0).toFixed(3), t1: +(+s.t1).toFixed(3), ...(s.set ? { set: String(s.set).slice(0, 40) } : {}) }))
    .sort((a, b) => a.t0 - b.t0);
  return out;
}

export function scenesOf(p) {
  const st = readJson(file(p), null);
  if (st && Array.isArray(st.scenes) && st.scenes.length) return { scenes: st.scenes, source: st.source || 'live preview', at: st.at };
  for (const r of ['data/shots.json', 'shots.json']) {
    const j = readJson(path.join(p.path, r), null);
    const s = clean(Array.isArray(j) ? j : j && j.shots);
    if (s.length) return { scenes: s, source: r };
  }
  return { scenes: [], source: null };
}

export function routes(route, readBody) {
  const need = (id) => { const p = project(id); if (!p) throw Object.assign(new Error('Project not found'), { code: 404 }); return p; };
  route('GET', '/api/project/:id/scenes', (req, url, { id }) => scenesOf(need(id)));
  // the live page found its scenes: keep them (only when they changed, so nothing writes on every open)
  route('PUT', '/api/project/:id/scenes', async (req, url, { id }) => {
    const p = need(id), b = await readBody(req), scenes = clean(b.scenes);
    if (!scenes.length) return { ok: false, scenes: [] };
    const old = readJson(file(p), null);
    if (old && JSON.stringify(old.scenes) === JSON.stringify(scenes)) return { ok: true, scenes, unchanged: true };
    fs.mkdirSync(path.dirname(file(p)), { recursive: true });
    writeJson(file(p), { scenes, source: String(b.source || 'live preview').slice(0, 60), at: new Date().toISOString() });
    return { ok: true, scenes };
  });
}
