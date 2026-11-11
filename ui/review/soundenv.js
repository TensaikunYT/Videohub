// Pure sound helpers for the live mixer (mixer.js). No DOM, no imports (soundenv.test.js runs them in Node).
// soundEnv is an identical copy of server/vhsound.mjs soundEnv (the test compares the two source texts), so the
// levels heard live follow the same curve the render's mix is built with.

// a level curve over film time for one channel: 1 outside the shots, the shot's level inside, 0.12 s ramps at the edges
export function soundEnv(entries, key, ramp = 0.12) {
  const E = (entries || []).filter((e) => e && e[key] != null && Math.abs(+e[key] - 1) > 1e-3 && +e.t1 > +e.t0);
  if (!E.length) return null;
  const sm = (a, b, t) => { const u = Math.min(1, Math.max(0, (t - a) / (b - a))); return u * u * (3 - 2 * u); };
  const w = (e, t) => { const r = +e.fade > 0 ? +e.fade : ramp; return sm(e.t0 - r, e.t0 + r, t) * (1 - sm(e.t1 - r, e.t1 + r, t)); };
  // old entries add up (unchanged); "duck:" ranges multiply, so a duck over a lowered film never reaches silence
  const isDuck = (e) => String(e.shot || '').startsWith('duck:'), A = E.filter((e) => !isDuck(e)), D = E.filter(isDuck);
  return (t) => { let g = 1; for (const e of A) g += w(e, t) * (+e[key] - 1); g = Math.max(0, g); for (const e of D) g *= 1 + w(e, t) * (+e[key] - 1); return Math.max(0, g); };
}

export const LEVELS = ['music', 'sfx', 'vo', 'all'];
const hasLevel = (e) => LEVELS.some((k) => e[k] != null && Math.abs(e[k] - 1) > 1e-3);

// the client's copy of server/tweaks.js applySoundOps (field-level merge by shot; null removes a field; an entry with
// no level ≠ 1 left is dropped; sorted by t0), so the mixer hears a change before the PATCH answers
export function applyOps(list, ops) {
  const o = ops || {}, rm = new Set(o.remove || []);
  let L = (list || []).filter((e) => e && !rm.has(e.shot)).map((e) => ({ ...e }));
  for (const s of o.set || []) {
    if (!s || typeof s.shot !== 'string') continue;
    const i = L.findIndex((e) => e.shot === s.shot), cur = i >= 0 ? { ...L[i] } : { shot: s.shot };
    for (const k of ['t0', 't1', ...LEVELS, 'fade']) if (s[k] !== undefined) { if (s[k] === null) { if (k !== 't0' && k !== 't1') delete cur[k]; } else cur[k] = k === 't0' || k === 't1' ? +s[k] : LEVELS.includes(k) ? Math.max(0, Math.min(4, +s[k])) : +s[k]; }
    if (i >= 0) L.splice(i, 1);
    if (+cur.t1 > +cur.t0 && hasLevel(cur)) L.push(cur);
  }
  return L.filter(hasLevel).sort((a, b) => a.t0 - b.t0);
}

// the ops that bring the mixer's own entries (`owned(shot)`) back to `snap`: only fields that differ are sent
export function opsToward(cur, snap, owned) {
  const shots = new Set([...(cur || []), ...(snap || [])].filter((e) => owned(e.shot)).map((e) => e.shot)), set = [];
  for (const shot of shots) {
    const a = (cur || []).find((e) => e.shot === shot), b = (snap || []).find((e) => e.shot === shot), o = { shot, t0: (b || a).t0, t1: (b || a).t1 };
    let any = false;
    for (const k of [...LEVELS, 'fade']) { const av = a?.[k] ?? null, bv = b?.[k] ?? null; if (av !== bv) { o[k] = bv; any = true; } }
    if (a && b && (a.t0 !== b.t0 || a.t1 !== b.t1)) any = true;   // a duck's edges were dragged
    if (any) set.push(o);
  }
  return set.length ? { set } : null;
}

// how to play one added clip live from film time `t` at playback rate `rate` (mirrors vhsound.mjs mixClips: trim,
// len, loop, fin/fout, gain): null when it has ended or is silent; else { delay (s of real time until it starts),
// offset (s into the file), dur (s of film time it still plays), loop, loopStart, pts: [[filmSecFromNow, gain]…] }
// pts are the corners of the clip's level curve min(1, i/fin, (len−i)/fout)·gain from where it starts playing
export function clipPlan(c, t, rate, fileDur, filmDur) {
  if (!c || c.mute || !Number.isFinite(+c.t) || !(fileDur > 0)) return null;
  const trim = Math.max(0, +c.trim || 0), avail = fileDur - trim; if (avail <= 0.001) return null;
  const len = c.len != null && +c.len > 0 ? +c.len : c.loop ? Math.max(0, filmDur - +c.t) : avail;
  const g = Math.max(0, Math.min(4, c.gain == null ? 1 : +c.gain)); if (g <= 0) return null;
  // the fades follow `len`; without a loop the file's end stops it earlier (as mixClips does)
  const end = c.loop ? len : Math.min(len, avail), i0 = Math.max(0, t - +c.t); if (i0 >= end - 0.002) return null;
  const fin = Math.max(1e-3, +c.fin || 0), fout = Math.max(1e-3, +c.fout || 0);
  const env = (i) => Math.max(0, Math.min(1, i / fin, (len - i) / fout)) * g;
  const corners = [i0, fin, len - fout, ...(fin + fout > len ? [fin * len / (fin + fout)] : []), end].filter((i) => i >= i0 && i <= end).sort((a, b) => a - b);
  const pts = corners.filter((i, k) => !k || i - corners[k - 1] > 1e-4).map((i) => [i - i0, env(i)]);
  const r = rate > 0 ? rate : 1, off = c.loop ? trim + (i0 % avail) : trim + i0;
  return { delay: Math.max(0, +c.t - t) / r, offset: off, dur: end - i0, loop: !!c.loop, loopStart: trim, pts };
}
