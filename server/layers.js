import { norm } from './util.js';
// The film's sound as layers for the review timeline (Nov 5): voice / music / SFX stems found next to the mix, and the
// SFX cue list the engine wrote. Formats in use:
//   spotlight-shorts  data/vo.wav, audio/music.wav, audio/sfx.wav, data/cues.json [{t, k, g}]
//   paper-hands       audio/st_vo.wav, audio/st_bed.wav, audio/st_sfx.wav, audio/cues.json {cues: [{t, name, gain}]}
//   cutaway / hd2d    audio/vo.wav or data/vo.wav only
//   any               stems/*.wav (one layer per file)
// Waveform pictures come from /api/media/wave (cached), so nothing heavy happens here.
import fs from 'node:fs';
import path from 'node:path';
import { project } from './scan.js';

const CAND = {
  vo: ['audio/st_vo.wav', 'data/vo.wav', 'audio/vo.wav', 'audio/voice.wav', 'stems/vo.wav', 'stems/voice.wav'],
  music: ['audio/music.wav', 'audio/st_bed.wav', 'audio/bed.wav', 'stems/music.wav', 'stems/bed.wav'],
  sfx: ['audio/sfx.wav', 'audio/st_sfx.wav', 'stems/sfx.wav'],
};
const LABEL = { vo: 'Voice', music: 'Music', sfx: 'Effects' };
const media = (f) => '/media?p=' + encodeURIComponent(f);
const big = (f) => { try { const s = fs.statSync(f); return s.isFile() && s.size > 10000; } catch { return false; } };

export function layersOf(p) {
  const base = p.path, layers = [], used = new Set();
  for (const [id, list] of Object.entries(CAND)) {
    const f = list.map((r) => path.join(base, r)).find(big);
    if (f) { layers.push({ id, label: LABEL[id], file: f, audio: media(f) }); used.add(norm(f)); }
  }
  try {
    for (const e of fs.readdirSync(path.join(base, 'stems')).sort()) {
      const f = path.join(base, 'stems', e);
      if (!/\.(wav|mp3|m4a|flac)$/i.test(e) || used.has(norm(f)) || !big(f)) continue;
      layers.push({ id: 'st_' + e.replace(/\W+/g, '_'), label: e.replace(/\.[^.]+$/, ''), file: f, audio: media(f) });
    }
  } catch { }
  let cues = null;
  for (const r of ['data/cues.json', 'audio/cues.json']) {
    try {
      const j = JSON.parse(fs.readFileSync(path.join(base, r), 'utf8')), a = Array.isArray(j) ? j : j && j.cues;
      if (!Array.isArray(a)) continue;
      cues = a.filter((c) => c && Number.isFinite(+c.t)).slice(0, 4000)
        .map((c) => ({ t: +(+c.t).toFixed(3), name: String(c.k || c.name || c.kind || c.sfx || 'effect').slice(0, 30), g: +(c.g ?? c.gain ?? 1) || 0 }))
        .sort((x, y) => x.t - y.t);
      break;
    } catch { }
  }
  return { layers, cues };
}

export function routes(route) {
  route('GET', '/api/project/:id/layers', (req, url, { id }) => {
    const p = project(id); if (!p) throw Object.assign(new Error('Project not found'), { code: 404 });
    return layersOf(p);
  });
}
