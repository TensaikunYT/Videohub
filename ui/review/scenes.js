// The film's scenes from the live page, for the timeline's scene lane: [{ name, t0, t1 }] in film seconds.
// What the engines expose (first one found wins):
//   window.VH_SCENES      the contract: an array (or a function returning one) of {name|id, t0, t1}
//   window.SHOTS          spotlight-shorts (3D and 2D template): [{id, set, t0, t1}]
//   window.EVENTS.shots   hd2d: shots on its "old" timeline, mapped to film time through window.PIECES
//   window.__qaShotAt(t)  3D studio 2D films (film2d.js): the shot name at a time, sampled every 1/20 s
// Pure (no DOM): tested by ui/review/scenes.test.js.

export function scenesFromPage(win, dur) {
  if (!win) return { scenes: [], source: null };
  const D = +dur || 0;
  try {
    let v = win.VH_SCENES;
    if (typeof v === 'function') v = v();
    if (Array.isArray(v) && v.length) return { scenes: tidy(v, D), source: 'VH_SCENES' };
  } catch { }
  try {
    const s = win.SHOTS;
    if (Array.isArray(s) && s.length) return { scenes: tidy(s.map((x, i) => ({ name: x.name ?? x.id ?? `scene ${i + 1}`, set: x.set, t0: x.t0, t1: x.t1 ?? s[i + 1]?.t0 ?? D })), D), source: 'SHOTS' };
  } catch { }
  try {
    const sh = win.EVENTS && win.EVENTS.shots, P = win.PIECES;
    if (Array.isArray(sh) && sh.length) {
      if (!Array.isArray(P) || !P.length) return { scenes: tidy(sh.map((x) => ({ name: x.id, set: x.set, t0: x.t0, t1: x.t1 })), D), source: 'EVENTS' };
      return { scenes: tidy(mapPieces(sh, P), D), source: 'EVENTS+PIECES' };
    }
  } catch { }
  try {
    if (typeof win.__qaShotAt === 'function' && D > 0) return { scenes: tidy(sample((t) => win.__qaShotAt(t), D), D), source: '__qaShotAt' };
  } catch { }
  return { scenes: [], source: null };
}

// hd2d: each piece plays old time a..b at film time s..s+d (black gaps and cards have no shot)
export function mapPieces(shots, pieces) {
  const out = [];
  for (const p of pieces) {
    if (p.black || p.card || !(p.d > 0)) continue;
    const a = +p.a, b = a + +p.d;
    for (const s of shots) {
      const x0 = Math.max(a, +s.t0), x1 = Math.min(b, +s.t1);
      if (x1 - x0 > 1e-3) out.push({ name: s.id ?? s.name, set: s.set, t0: +p.s + (x0 - a), t1: +p.s + (x1 - a) });
    }
  }
  return out;
}

// runs of the same name, sampled every `step` seconds
export function sample(nameAt, dur, step = 0.05) {
  const out = []; let cur = null;
  for (let t = 0; t < dur + 1e-9; t += step) {
    let n = ''; try { n = String(nameAt(Math.min(t, dur - 1e-3)) ?? ''); } catch { }
    if (!cur || cur.name !== n) { if (cur) cur.t1 = t; cur = { name: n, t0: t, t1: dur }; out.push(cur); }
  }
  if (cur) cur.t1 = dur;
  return out.filter((s) => s.name);
}

// sorted, clipped to the film, neighbours with the same name joined, tiny slivers dropped
export function tidy(list, dur) {
  const D = dur > 0 ? dur : Infinity;
  const s = list.filter((x) => x && Number.isFinite(+x.t0))
    .map((x) => ({ name: String(x.name ?? x.id ?? '').slice(0, 60) || 'scene', ...(x.set ? { set: String(x.set) } : {}), t0: Math.max(0, +x.t0), t1: Math.min(D, x.t1 != null && Number.isFinite(+x.t1) ? +x.t1 : D) }))
    .filter((x) => x.t1 - x.t0 > 0.04)
    .sort((a, b) => a.t0 - b.t0);
  const out = [];
  for (const x of s) {
    const last = out[out.length - 1];
    if (last && last.name === x.name && Math.abs(x.t0 - last.t1) < 0.06) last.t1 = Math.max(last.t1, x.t1);
    else out.push(x);
  }
  return out;
}
