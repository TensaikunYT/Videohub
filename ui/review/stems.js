// Sound layers under the timeline: a row per stem with a level slider (0–200 %), mute (M) and solo (S).
// Listening: while every layer is as the film has it, the player's own sound plays; once a level differs, or something
// is muted/soloed, the player is muted and the stems play in its place through Web Audio gains (so above 100 % works),
// kept to its clock (moved when they drift > 0.15 s, checked on every play/seek and twice a second).
// "💾 Apply to film" writes the levels into tweaks.json "sound" (whole film or the selected I/O range; PATCH soundOps,
// only that entry's fields) and the review page's apply queue rebuilds the film's mix (server/sound.js; the untouched
// mix stays as *.vhorig.wav; 3D studio: the engine's build at once, since the button asked for it).
import { h, api, toast } from '../app.js';

const KEY = { vo: 'vo', music: 'music', sfx: 'sfx' };   // layer id → tweaks.json sound key
const pct = (g) => Math.round(g * 100) + '%';

export function createStems({ media, projectId, dur, range, live, reloadAudio, applyQueue, status, onSaved }) {
  const el = h('div', { class: 'tl2-layers' });
  let layers = [], cues = null, audios = new Map(), nodes = new Map(), ac = null, mute = new Set(), solo = new Set();
  let active = false, wasMuted = false, timer = 0, onChange = null, scope = 'all', info = null, stored = [], busy = false;
  const gain = {}, base = {};   // what the slider says, what the film has now (for the chosen scope)
  const audible = (id) => solo.size ? solo.has(id) : !mute.has(id);
  const levelOf = (id) => (audible(id) ? gain[id] ?? 1 : 0);
  const apply = () => layers.filter((l) => KEY[l.id]);   // layers whose level can go into the film's mix
  const dirty = () => apply().some((l) => Math.abs((gain[l.id] ?? 1) - (base[l.id] ?? 1)) > 0.004);
  const scopeKey = () => { if (scope === 'all') return { shot: '*', t0: 0, t1: dur() || 1e6 }; const r = range(); return r ? { shot: `range ${r[0].toFixed(2)}–${r[1].toFixed(2)}`, t0: +r[0].toFixed(3), t1: +r[1].toFixed(3) } : null; };
  // the film's levels for this scope (from tweaks.json), shown as the sliders' starting point
  function loadBase() {
    const k = scopeKey(), e = k && stored.find((x) => x.shot === k.shot);
    for (const l of apply()) { base[l.id] = e && e[KEY[l.id]] != null ? +e[KEY[l.id]] : 1; gain[l.id] = base[l.id]; }
  }

  function paint() {
    el.innerHTML = '';
    if (!layers.length && !cues) { el.append(h('span', { class: 'dim' }, 'No sound layers (mix only)')); return; }
    const canApply = info && ['stems', 'studio'].includes(info.mode) && apply().length;
    const row = h('div', { class: 'tl2-lrow' }, h('span', { class: 'dim' }, 'Sound:'));
    for (const l of layers) {
      const out = h('span', { class: 'tl2-lval' }, pct(gain[l.id] ?? 1));
      const slider = h('input', { type: 'range', min: 0, max: 200, step: 5, value: Math.round((gain[l.id] ?? 1) * 100), title: 'Level (double-click: restore the film level)',
        oninput: (e) => { gain[l.id] = +e.target.value / 100; out.textContent = pct(gain[l.id]); update(false); },
        onchange: () => update(), ondblclick: () => { gain[l.id] = base[l.id] ?? 1; update(); } });
      row.append(h('span', { class: 'tl2-layer' + (audible(l.id) ? '' : ' off') + (Math.abs((gain[l.id] ?? 1) - (base[l.id] ?? 1)) > 0.004 ? ' changed' : '') },
        h('b', {}, l.label), slider, out,
        l.audio ? h('button', { class: 'ghost' + (mute.has(l.id) ? ' on' : ''), title: 'Mute (while listening)', onclick: () => toggle(mute, l.id) }, 'M') : null,
        l.audio ? h('button', { class: 'ghost' + (solo.has(l.id) ? ' on' : ''), title: 'Solo', onclick: () => toggle(solo, l.id) }, 'S') : null));
    }
    if (cues) row.append(h('span', { class: 'dim' }, `${cues.length} effect cues`));
    // the one-click wish: take the film's music out (or put it back), whole film
    if (canApply && apply().some((l) => l.id === 'music')) {
      const off = scope === 'all' && (base.music ?? 1) < 0.004;
      row.append(h('button', { class: 'ghost', disabled: busy, title: off ? 'Bring back the film music' : 'Remove all film music (voice and effects stay; original audio is backed up)', onclick: () => { scope = 'all'; loadBase(); gain.music = off ? 1 : 0; applyToFilm(); } }, off ? '🎵 Bring back music' : '🔇 Remove music'));
    }
    el.append(row);
    if (!apply().length) return;
    const r = range();
    const act = h('div', { class: 'tl2-lrow' },
      h('select', { title: 'Where to apply these levels', onchange: (e) => { scope = e.target.value; loadBase(); update(); } },
        h('option', { value: 'all', selected: scope === 'all' }, 'Whole film'),
        h('option', { value: 'range', selected: scope === 'range', disabled: !r }, r ? `Selected range (${r[0].toFixed(1)}–${r[1].toFixed(1)} s)` : 'Selected range (select with I / O first)')),
      canApply ? h('button', { class: dirty() ? 'primary' : 'ghost', disabled: busy || !dirty(), title: 'Apply these levels to the film audio (original audio stays backed up); the next render uses this audio', onclick: () => applyToFilm() }, busy ? 'saving…' : '💾 Apply to film') : h('span', { class: 'dim' }, info ? 'Channel levels in this film can only be previewed.' : ''),
      dirty() ? h('button', { class: 'ghost', onclick: () => { for (const l of apply()) gain[l.id] = base[l.id] ?? 1; update(); } }, 'Undo') : null,
      (mute.size || solo.size) ? h('button', { class: 'ghost', onclick: () => { mute.clear(); solo.clear(); update(); } }, 'Clear M/S') : null,
      stored.length ? h('span', { class: 'dim' }, `${stored.length} sound settings in the film`) : null,
      status?.() || null);
    el.append(act);
  }
  function toggle(set, id) { set.has(id) ? set.delete(id) : set.add(id); update(); }
  function update(repaint = true) {
    // only real stems can be heard on their own; a studio film's channels (no stem files) are set and applied only
    const want = layers.some((l) => l.audio) && (mute.size > 0 || solo.size > 0 || dirty());
    if (want && !active) start(); else if (!want && active) stop();
    if (active) sync(true);
    if (repaint) paint(); onChange?.();
  }
  function start() {
    active = true; wasMuted = !!media.muted;
    try { ac = ac || new AudioContext(); ac.resume?.(); } catch { ac = null; }
    for (const l of layers) if (l.audio && !audios.has(l.id)) {
      const a = new Audio(l.audio); a.preload = 'auto'; a.crossOrigin = 'anonymous'; audios.set(l.id, a);
      if (ac) try { const g = ac.createGain(); ac.createMediaElementSource(a).connect(g); g.connect(ac.destination); nodes.set(l.id, g); } catch { }
    }
    media.muted = true;
    for (const ev of ['play', 'pause', 'seeked', 'ratechange']) media.addEventListener(ev, onMedia);
    timer = setInterval(() => sync(false), 500);
  }
  function stop() {
    active = false; clearInterval(timer);
    for (const ev of ['play', 'pause', 'seeked', 'ratechange']) media.removeEventListener(ev, onMedia);
    for (const a of audios.values()) a.pause();
    media.muted = wasMuted;
  }
  const onMedia = () => sync(true);
  function sync(force) {
    if (!active) return;
    if (!media.muted) media.muted = true;   // the stems are the sound now
    const t = +media.currentTime || 0, playing = !media.paused;
    for (const l of layers) {
      const a = audios.get(l.id); if (!a) continue;
      const g = nodes.get(l.id), lv = levelOf(l.id);
      if (g) { g.gain.value = lv; a.volume = 1; } else a.volume = Math.min(1, lv);
      a.playbackRate = media.playbackRate || 1;
      if ((force || playing) && a.readyState >= 1 && Math.abs(a.currentTime - t) > 0.15) try { a.currentTime = t; } catch { }
      if (playing && a.paused) { ac?.resume?.(); a.play().catch(() => { }); } else if (!playing && !a.paused) a.pause();
    }
  }
  // the levels into the film: tweaks.json "sound" for this scope, then the hub rebuilds the mix
  async function applyToFilm() {
    const k = scopeKey(); if (!k) return toast('Select a range first (I and O)', true);
    busy = true; paint();
    try {
      // this scope's entry, field by field: a level back at 100 % removes its field (and the entry when none is left);
      // fields of other channels (the scene editor's "Overall") stay
      const e = { ...k }; for (const l of apply()) { const g = gain[l.id] ?? 1; e[KEY[l.id]] = Math.abs(g - 1) > 0.004 ? +g.toFixed(3) : null; }
      const r = await api(`/api/project/${projectId}/tweaks`, { method: 'PATCH', body: { soundOps: { set: [e] } } });
      stored = r.sound || []; for (const l of apply()) base[l.id] = gain[l.id];
      onSaved?.(r);
      busy = false; update();
      // the review page's queue builds it (stems/all: a moment later; 3D studio: now, the button asked for it)
      if (info?.mode === 'studio') { toast('Rebuilding audio with the engine (this may take a few minutes)…'); await applyQueue?.applyNow().catch(() => { }); }   // the queue reports a failed build
      else applyQueue?.request('levels');
      return;
    } catch (err) { toast('Could not apply: ' + err.message, true); }
    busy = false; update();
  }
  paint();
  return {
    el,
    async set(L, cb) {
      layers = L.layers || []; cues = L.cues && L.cues.length ? L.cues : null; onChange = cb || null;
      [info, stored] = await Promise.all([api(`/api/project/${projectId}/sound-info`).catch(() => null), api(`/api/project/${projectId}/tweaks`).then((t) => t.sound || []).catch(() => [])]);
      // a 3D studio film has no stem files but its engine mixes voice / music / effects on separate buses: offer their levels
      if (info?.mode === 'studio' && !layers.some((l) => KEY[l.id])) layers = [{ id: 'vo', label: 'Voice' }, { id: 'music', label: 'Music' }, { id: 'sfx', label: 'Effects' }, ...layers];
      loadBase(); update();
    },
    audible: (id) => levelOf(id) > 0.004,
    refresh: () => paint(),
    // the film's levels changed elsewhere (scene editor, another tab's PATCH): new starting point for the sliders
    setStored(list) { const wasDirty = dirty(); stored = Array.isArray(list) ? list : []; if (!wasDirty) { loadBase(); update(); } else paint(); },
    destroy() { if (active) stop(); for (const a of audios.values()) { a.pause(); a.removeAttribute('src'); } audios.clear(); try { ac?.close(); } catch { } },
  };
}
