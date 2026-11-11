// Live mixer (P3c, replaces stems.js): channel levels, M/S, the master and the "Channels" section of the Sounds tab.
// Levels live where the render reads them, tweaks.json "sound" (no new key): the whole-film level of vo / music / sfx
// and the master (`all`) on the {shot:'*'} entry, range levels on 'range a–b' (scope select; older films: 'aralık a–b'), "🔇 Remove music" =
// '*' music 0. Each change is a PATCH soundOps (field-level, 400 ms debounce) and then the review page's apply queue
// rebuilds the mix (stems/all: by itself; 3D studio: 💾). M/S are for listening only (sessionStorage 'vh-ms-<id>').
// The Added sounds level multiplies every clip's gain once on release (scaleClips; one undo step in the clips stack).
// Listening engine: while something differs from the built mix the player plays (M/S, a change not built yet, or the
// A/B switch on "Channels"), the player is muted and the stem files play instead through Web Audio: each stem →
// GainNode following M/S × soundEnv(level curve, the render's formula) → master → limiter; added clips are decoded
// once and scheduled as buffer sources with their fades (soundenv.js clipPlan, the render's mixClips rules).
// The transport's 🔊 / volume / U drive the master while it runs. "Built audio" forces the player's own sound.
import { h, api, toast } from '../app.js';
import { createHistory } from './history.js';
import { soundEnv, applyOps, opsToward, clipPlan } from './soundenv.js';

const KEY = { vo: 'vo', music: 'music', sfx: 'sfx', mix: 'all' };   // row id → tweaks.json sound field
const STEM = ['vo', 'music', 'sfx'];
const BUS = 'add-music';   // the Added sounds level sits on the first added-sound row
const pct = (g) => Math.round(g * 100) + '%';
const isDuck = (s) => String(s).startsWith('duck:');
const owned = (s) => s === '*' || String(s).startsWith('range ') || String(s).startsWith('aral\u0131k ') || isDuck(s);
const tcs = (s) => { s = Math.max(0, +s || 0); const m = Math.floor(s / 60); return `${m}:${(s - m * 60).toFixed(2).padStart(5, '0')}`; };
const clamp = (g) => Math.max(0, Math.min(2, Math.round(g * 100) / 100));
const T_PLACE = 'You cannot listen to separate channels in this film; use "Apply to film" to hear changes';
const T_EXTRA = 'This layer is for listening only and cannot be applied to the film';
const APPROX = {
  stems: 'Voice, music and effects play from separate files, so you hear level changes immediately; the film audio is rebuilt at the same levels. Small differences are possible: the render extracts voice from the mix, reduces peaks above the limit to 0.95 and softens clipping in added sounds; this preview only uses a limiter. Compare with "Built audio".',
  studio: '3D studio: the engine compresses music and effects, adds reverb, normalizes and adjusts loudness; channel playback is an approximation. Compare with "Built audio".',
  other: 'This film has a single audio mix: channel levels affect listening only; the "Film audio" level is applied to the film.',
};

export function createMixer({ media, projectId, live, dur, range, clips, clipUrl, applyQueue, history: router, status, onSaved, scaleClips }) {
  const el = h('div', { class: 'mx' });
  let layers = [], cues = null, info = null, server = [], inflight = null, inflightP = null, pend = new Map(), ver = 0;
  let builtList = [], builtKey = '[]', builtClips = null, scope = 'all', ab = null, listen = {}, busFactor = 1, gesture = null, saveTimer = 0;
  let busShown = false, ac = null, master = null, busG = null, active = false, timer = 0, envTimer = 0, M = { volume: 1, muted: false }, lastRate = 1;
  const audios = new Map(), nodes = new Map(), decoded = new Map(), playing = new Set(), views = new Set(), subs = [];
  const msKey = 'vh-ms-' + projectId;
  const ms = (() => { try { const j = JSON.parse(sessionStorage.getItem(msKey) || '{}'); return { mute: new Set(j.mute || []), solo: new Set(j.solo || []) }; } catch { return { mute: new Set(), solo: new Set() }; } })();
  const saveMS = () => { try { sessionStorage.setItem(msKey, JSON.stringify({ mute: [...ms.mute], solo: [...ms.solo] })); } catch { } };

  // ---- the sound list: the server's, plus the PATCH in flight, plus the changes not sent yet
  let memo = { ver: -1, list: [] };
  const list = () => { if (memo.ver !== ver) memo = { ver, list: applyOps(applyOps(server, inflight), { set: [...pend.values()] }) }; return memo.list; };
  const bump = () => { ver++; envs = null; };
  const mode = () => info?.mode || 'none';
  const layer = (id) => layers.find((l) => l.id === id) || null;
  // can this row's level go into the film's mix (else it is listening-only)
  const savable = (id) => (STEM.includes(id) ? ['stems', 'studio'].includes(mode()) : id === 'mix' ? ['stems', 'all', 'studio'].includes(mode()) : false);
  const canListen = (id) => !!layer(id)?.audio;
  const engineOk = () => layers.some((l) => l.audio);
  // the stems add up to the film's sound (the engine can stand in for the built mix)
  const faithful = () => ['stems', 'studio'].includes(mode()) && STEM.every((id) => layer(id)?.audio);
  function scopeKey() {
    if (scope === 'all') return { shot: '*', t0: 0, t1: +(dur() || 1e6).toFixed(3) };
    const r = range(); return r ? { shot: `range ${r[0].toFixed(2)}–${r[1].toFixed(2)}`, t0: +r[0].toFixed(3), t1: +r[1].toFixed(3) } : null;
  }
  const entry = (L, shot) => (L || []).find((e) => e.shot === shot) || null;
  function levelOf(id) {
    if (id === BUS) return busFactor;
    if (savable(id)) { const k = scopeKey(); return k ? entry(list(), k.shot)?.[KEY[id]] ?? 1 : 1; }
    return listen[id] ?? 1;
  }
  // the value the film has (built): double-click and "Undo" go back to it
  function filmLevel(id) { if (!savable(id)) return 1; const k = scopeKey(); return k ? entry(builtList, k.shot)?.[KEY[id]] ?? 1 : 1; }
  const msGain = (id) => (ms.solo.size ? (ms.solo.has(id) ? 1 : 0) : ms.mute.has(id) ? 0 : 1);
  const msOn = () => ms.mute.size > 0 || ms.solo.size > 0;
  const listenOn = () => Object.values(listen).some((g) => Math.abs(g - 1) > 0.004) || Math.abs(busFactor - 1) > 0.004;
  const clipsKey = () => JSON.stringify((clips() || []).filter((c) => !c.mute).map((c) => [c.src, +c.t, c.gain ?? 1, c.fin ?? 0, c.fout ?? 0, c.trim ?? 0, c.len ?? null, !!c.loop]));
  const unbuilt = () => !!(pend.size || inflight || applyQueue?.dirty() || applyQueue?.busy() || JSON.stringify(list()) !== builtKey || (builtClips != null && clipsKey() !== builtClips));
  const mixerDirty = () => list().filter((e) => owned(e.shot)).some((e) => JSON.stringify(e) !== JSON.stringify(entry(builtList, e.shot))) || builtList.filter((e) => owned(e.shot)).some((e) => !entry(list(), e.shot));

  // ---- history (domain 'sound'): the mixer's own entries ('*', 'range …') only
  const hist = createHistory({
    snapshot: () => JSON.stringify(list().filter((e) => owned(e.shot))),
    restore: (s) => { const ops = opsToward(list(), JSON.parse(s), owned); if (ops) { for (const o of ops.set) mergePend(o); bump(); schedule(); } update(); },
    onPush: () => router?.push(),
  });
  const step = () => (gesture ? hist.touch() : hist.push());
  function mergePend(o) { const p = pend.get(o.shot) || { shot: o.shot }; pend.set(o.shot, Object.assign(p, o)); }

  // ---- saving: PATCH soundOps, then the apply queue builds
  function schedule() { clearTimeout(saveTimer); saveTimer = setTimeout(flush, 400); }
  async function flush() {
    clearTimeout(saveTimer); saveTimer = 0;
    if (inflight) return inflightP;
    if (!pend.size) return;
    inflight = { set: [...pend.values()] }; pend = new Map(); bump();
    inflightP = (async () => {
      try {
        const r = await api(`/api/project/${projectId}/tweaks`, { method: 'PATCH', body: { soundOps: inflight } });
        server = Array.isArray(r.sound) ? r.sound : server; inflight = null; bump();
        onSaved?.(r); applyQueue?.request('levels');
      } catch (e) { inflight = null; bump(); toast('Could not save the sound level: ' + e.message, true); }
      inflightP = null;
      if (pend.size) schedule();
      update();
    })();
    return inflightP;
  }

  // ---- edits
  function setLevel(id, g) {
    g = clamp(+g || 0);
    if (id === BUS) { if (!clips()?.length) return; busFactor = g; if (busG) busG.gain.setTargetAtTime(g, ac.currentTime, 0.02); update(); return; }
    if (savable(id)) {
      const k = scopeKey(); if (!k) { toast('Select a range first (I and O)', true); return; }
      if (Math.abs(levelOf(id) - g) < 0.004) return;
      step(); mergePend({ ...k, [KEY[id]]: Math.abs(g - 1) > 0.004 ? g : null }); bump(); schedule(); update(); return;
    }
    if (!layer(id) && id !== 'mix') return;
    listen[id] = g; update();
  }
  function begin(id) { gesture = id; if (savable(id)) hist.arm(); }
  function end(id) {
    if (gesture !== id) return; gesture = null;
    // the Added sounds level: every clip's gain × factor, one undo step (soundedit's history)
    if (id === BUS && Math.abs(busFactor - 1) > 0.004) { const f = busFactor; busFactor = 1; if (busG) busG.gain.setTargetAtTime(1, ac.currentTime, 0.02); scaleClips?.(f); update(); }
  }
  function resetLevel(id) { if (id === BUS) { busFactor = 1; update(); return; } if (savable(id)) setLevel(id, filmLevel(id)); else { delete listen[id]; update(); } }
  function toggle(set, id) { if (!canListen(id)) return; set.has(id) ? set.delete(id) : set.add(id); saveMS(); update(); }
  // whole film: take the film's music out (0) or put it back (field removed)
  function musicOut(off) { scope = 'all'; step(); mergePend({ ...scopeKey(), music: off ? 0 : null }); bump(); schedule(); update(); }
  function revert() {   // the mixer's entries back to the built film's
    const ops = opsToward(list(), builtList.filter((e) => owned(e.shot)), owned); if (!ops) return;
    hist.push(); for (const o of ops.set) mergePend(o); bump(); schedule(); update();
  }
  async function buildNow() { await flush(); await applyQueue?.applyNow().catch(() => { }); }

  // ---- listening engine
  let envs = null;
  function envOf(id) {
    if (!envs) { const L = list(); envs = { vo: soundEnv(L, 'vo'), music: soundEnv(L, 'music'), sfx: soundEnv(L, 'sfx'), all: soundEnv(L, 'all') }; }
    const all = ['stems', 'all', 'studio'].includes(mode()) ? envs.all : null;
    const own = STEM.includes(id) && savable(id) ? envs[id] : null, k = STEM.includes(id) && savable(id) ? 1 : listen[id] ?? 1;
    return (t) => (own ? own(t) : k) * (all ? all(t) : 1);
  }
  function want() {
    if (!engineOk() || ab === 'built') return false;
    return ab === 'ch' || msOn() || listenOn() || (faithful() && unbuilt());
  }
  function update() {
    const w = want();
    if (w && !active) start(); else if (!w && active) stop();
    if (active) { sync(true); applyEnv(); }
    notify();
  }
  function graph() {
    if (ac) return true;
    try {
      ac = new AudioContext();
      // the render limits overs too (0.95 renormalise / soft clip): a hard limiter keeps the live sum from clipping
      const comp = ac.createDynamicsCompressor(); comp.threshold.value = -1; comp.ratio.value = 20; comp.knee.value = 0; comp.attack.value = 0.003; comp.release.value = 0.1;
      master = ac.createGain(); busG = ac.createGain(); busG.gain.value = busFactor;
      busG.connect(master); master.connect(comp); comp.connect(ac.destination);
      return true;
    } catch { ac = null; return false; }
  }
  function start() {
    if (!graph()) return;
    active = true; M = { volume: media.volume ?? 1, muted: !!media.muted }; master.gain.value = M.muted ? 0 : M.volume;
    ac.resume?.().catch(() => { });
    for (const l of layers) if (l.audio && !audios.has(l.id)) {
      const a = new Audio(l.audio); a.preload = 'auto'; a.crossOrigin = 'anonymous'; audios.set(l.id, a);
      try { const g = ac.createGain(); ac.createMediaElementSource(a).connect(g); g.connect(master); nodes.set(l.id, g); } catch { }
    }
    media.muted = true; lastRate = media.playbackRate || 1;
    for (const ev of ['play', 'pause', 'seeked', 'ratechange']) media.addEventListener(ev, onMedia);
    timer = setInterval(() => sync(false), 500); envTimer = setInterval(applyEnv, 50);
    scheduleClips();
  }
  function stop() {
    active = false; clearInterval(timer); clearInterval(envTimer);
    for (const ev of ['play', 'pause', 'seeked', 'ratechange']) media.removeEventListener(ev, onMedia);
    for (const a of audios.values()) a.pause();
    stopClips();
    media.volume = M.volume; media.muted = M.muted;   // the master's state goes back to the player
  }
  const onMedia = (e) => { sync(true); applyEnv(); if (e.type === 'pause') stopClips(); else scheduleClips(); };
  function sync(force) {
    if (!active) return;
    if (!media.muted) media.muted = true;   // the stems are the sound now
    const t = +media.currentTime || 0, on = !media.paused, rate = media.playbackRate || 1;
    for (const l of layers) {
      const a = audios.get(l.id); if (!a) continue;
      a.volume = 1; a.playbackRate = rate;
      if ((force || on) && a.readyState >= 1 && Math.abs(a.currentTime - t) > 0.15) try { a.currentTime = t; } catch { }
      if (on && a.paused) { ac?.resume?.(); a.play().catch(() => { }); } else if (!on && !a.paused) a.pause();
    }
    if (rate !== lastRate) { lastRate = rate; scheduleClips(); }   // the live page fires no ratechange
  }
  // every 50 ms (and on seek / play): each stem's gain follows M/S × its level curve slightly ahead
  function applyEnv() {
    if (!active || !ac) return;
    const t = (+media.currentTime || 0) + 0.05;
    for (const [id, g] of nodes) g.gain.setTargetAtTime(msGain(id) * envOf(id)(t), ac.currentTime, 0.02);
  }
  // added clips: decoded once per file, scheduled from the playhead with their fades
  function buffer(src) {
    if (!decoded.has(src)) decoded.set(src, fetch(clipUrl(src)).then((r) => { if (!r.ok) throw new Error(r.status); return r.arrayBuffer(); }).then((b) => ac.decodeAudioData(b)).catch(() => null));
    return decoded.get(src);
  }
  function stopClips() { for (const s of playing) { try { s.stop(); } catch { } try { s.disconnect(); } catch { } } playing.clear(); }
  let schedTok = 0;
  function scheduleClips() {
    stopClips(); const my = ++schedTok;
    if (!active || !ac || media.paused) return;
    for (const c of clips() || []) {
      if (c.mute || !c.src) continue;
      buffer(c.src).then((buf) => {
        if (!buf || my !== schedTok || !active || media.paused) return;
        const rate = media.playbackRate || 1, P = clipPlan(c, +media.currentTime || 0, rate, buf.duration, dur()); if (!P) return;
        const s = ac.createBufferSource(), g = ac.createGain(), when = ac.currentTime + 0.03 + P.delay;
        s.buffer = buf; s.playbackRate.value = rate;
        if (P.loop) { s.loop = true; s.loopStart = P.loopStart; s.loopEnd = buf.duration; }
        g.gain.value = P.pts[0][1]; g.gain.setValueAtTime(P.pts[0][1], when);
        for (const [x, v] of P.pts.slice(1)) g.gain.linearRampToValueAtTime(v, when + x / rate);
        s.connect(g); g.connect(busG);
        try { s.start(when, Math.min(P.offset, Math.max(0, buf.duration - 0.001))); s.stop(when + P.dur / rate); playing.add(s); s.onended = () => playing.delete(s); } catch { }
      });
    }
  }

  // ---- views: header controls (timeline + this section) update themselves on every change
  function chip(id) {
    const off = id !== BUS && id !== 'mix' && !STEM.includes(id);   // extra stems: no level
    const c = h('span', { class: 'tl2-lvl' });
    const paint = () => {
      const dis = off || (id === 'mix' && !savable('mix')) || (id === BUS && !(clips() || []).length) || (STEM.includes(id) && !layer(id));
      const g = levelOf(id); c.textContent = pct(g);
      c.classList.toggle('dis', !!dis); c.classList.toggle('chg', !dis && Math.abs(g - (id === BUS ? 1 : filmLevel(id))) > 0.004);
      c.title = off ? T_EXTRA : id === BUS ? 'All added sounds together: drag (on release, each clip level is multiplied by this factor, with one undo step)'
        : dis ? 'This channel cannot change the film audio' : (id === 'mix' ? 'Film audio (master level)' : (layer(id)?.label || id)) + ': drag ±1% (Shift: fine) · wheel ±5% · double-click: film level' + (savable(id) ? (scope === 'range' ? ' · applies to the selected range' : ' · applies to the whole film') : ' · listening only');
      c.dataset.dis = dis ? '1' : '';
    };
    let drag = null, wheelT = 0;
    c.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || c.dataset.dis) return; e.preventDefault(); e.stopPropagation();
      c.setPointerCapture(e.pointerId); drag = { x: e.clientX, v: levelOf(id), moved: false }; begin(id); c.classList.add('drag');
    });
    c.addEventListener('pointermove', (e) => {
      if (!drag) return; const dx = e.clientX - drag.x; if (!drag.moved && Math.abs(dx) < 2) return;
      drag.moved = true; setLevel(id, drag.v + dx * (e.shiftKey ? 0.2 : 1) / 100);
    });
    const up = () => { if (!drag) return; drag = null; c.classList.remove('drag'); end(id); };
    c.addEventListener('pointerup', up); c.addEventListener('pointercancel', up);
    c.addEventListener('wheel', (e) => {
      if (e.ctrlKey || c.dataset.dis) return; e.preventDefault(); e.stopPropagation();
      if (gesture !== id) begin(id);
      setLevel(id, levelOf(id) + (e.deltaY < 0 ? 0.05 : -0.05));
      clearTimeout(wheelT); wheelT = setTimeout(() => end(id), 450);
    }, { passive: false });
    c.addEventListener('dblclick', (e) => { e.stopPropagation(); if (!c.dataset.dis) resetLevel(id); });
    view(c, paint); return c;
  }
  function msBtn(id, which) {
    const b = h('button', { class: 'tl2-ms', onclick: (e) => { e.stopPropagation(); toggle(which === 'M' ? ms.mute : ms.solo, id); } }, which === 'M' ? '🔇' : '🎧');
    view(b, () => {
      const ok = canListen(id), on = which === 'M' ? ms.mute.has(id) : ms.solo.has(id);
      b.disabled = !ok; b.classList.toggle(which === 'M' ? 'off' : 'on', ok && on);
      b.title = !ok ? (layer(id)?.placeholder ? T_PLACE : 'This channel has no separate file') : which === 'M' ? 'Mute (listening only; does not affect the render)' : 'Solo (does not affect the render)';
    });
    return b;
  }
  function view(node, paint) { const v = { node, paint, seen: false }; views.add(v); paint(); return node; }
  // a row's controls: M, S, level (the Film audio row: the master level; Added music: all clips; extra stems: M/S)
  function controls(id) {
    if (id === 'add-sfx' || id === 'cues') return null;
    const box = h('span', { class: 'tl2-hctl' });
    if (id !== 'mix' && id !== BUS) box.append(msBtn(id, 'M'), msBtn(id, 'S'));
    box.append(chip(id));
    return box;
  }
  function notify() {
    if (scope === 'range' && !range()) scope = 'all';   // the I/O range was cleared
    for (const v of views) { if (v.node.isConnected) v.seen = true; else if (v.seen) { views.delete(v); continue; } v.paint(); }
    paintActs(); paintDuck(); for (const f of subs) f();
  }

  // ---- P4: the film's music lowered / removed over the I/O range ('duck:<id>' entries multiply the music curve)
  let duckLevel = 0.3, duckFade = 0.5, duckSel = null, duckKey = '';
  const duckEl = h('div', { class: 'mx-duck' });
  const ducks = () => list().filter((e) => isDuck(e.shot) && e.music != null);
  const musicSep = () => ['stems', 'studio'].includes(mode()) && !!layer('music');
  const r3 = (n) => Math.round(n * 1000) / 1000;
  function addDuck(level) {
    const r = range(); if (!r) { toast('Select a range with I / O first', true); return; }
    if (!musicSep()) return;
    let t0 = r3(r[0]), t1 = r3(r[1]);
    hist.push();
    // overlapping ducks become one (multiplied they would stack)
    for (const d of ducks()) if (d.t0 < t1 && d.t1 > t0) { t0 = Math.min(t0, d.t0); t1 = Math.max(t1, d.t1); mergePend({ shot: d.shot, t0: d.t0, t1: d.t1, music: null, fade: null }); }
    const shot = 'duck:' + Math.random().toString(36).slice(2, 8);
    mergePend({ shot, t0, t1, music: level, fade: duckFade }); duckSel = shot; bump(); schedule(); update();
    toast(level < 0.004 ? `Music removed from ${tcs(t0)}–${tcs(t1)}` : `Music lowered to ${Math.round(level * 100)}% from ${tcs(t0)}–${tcs(t1)}`);
  }
  function setDuck(shot, patch) {
    const d = entry(list(), shot); if (!d) return;
    hist.push(); mergePend({ shot, t0: d.t0, t1: d.t1, music: d.music, fade: d.fade ?? null, ...patch }); bump(); schedule(); update();
  }
  function removeDuck(shot) {
    const d = entry(list(), shot); if (!d) return false;
    hist.push(); mergePend({ shot, t0: d.t0, t1: d.t1, music: null, fade: null }); if (duckSel === shot) duckSel = null; bump(); schedule(); update();
    return true;
  }
  function selectDuck(shot) { duckSel = shot && entry(list(), shot) ? shot : null; notify(); }
  function paintDuck() {
    const r = range(), ok = musicSep(), sel = duckSel && entry(list(), duckSel);
    if (duckSel && !sel) duckSel = null;
    const key = JSON.stringify([!!r && r.map((x) => x.toFixed(2)), ok, ducks(), duckSel]);
    if (key === duckKey) return; duckKey = key;
    const lvlOut = h('span', { class: 'tl2-lval' }, Math.round(duckLevel * 100) + '%');
    const kids = [h('div', { class: 'mx-head' }, h('b', { class: 'mx-title' }, '🎵 Film music'))];
    if (!ok) kids.push(h('div', { class: 'dim' }, 'This film has no separate music channel'));
    else {
      kids.push(h('div', { class: 'tl2-lrow' },
        h('button', { class: 'ghost', disabled: !r, title: 'Lower the film music in the selected range (voice and effects stay the same)', onclick: () => addDuck(duckLevel) }, '↘ Lower in range'),
        h('input', { type: 'range', min: 0, max: 100, step: 5, value: Math.round(duckLevel * 100), title: 'Reduced level', oninput: (e) => { duckLevel = +e.target.value / 100; lvlOut.textContent = e.target.value + '%'; } }), lvlOut,
        h('button', { class: 'ghost', disabled: !r, title: 'Remove the film music in the selected range', onclick: () => addDuck(0) }, '🔇 Remove in range'),
        h('label', { class: 'se-f', title: 'Fade duration at the start and end of the reduction' }, 'Fade',
          h('input', { type: 'number', min: 0.1, max: 3, step: 0.1, value: duckFade, style: { width: '56px' }, onchange: (e) => { const v = +e.target.value; if (Number.isFinite(v)) duckFade = Math.max(0.1, Math.min(3, v)); } }), h('span', { class: 'dim' }, 's'))));
      if (!r) kids.push(h('div', { class: 'dim' }, 'Select a range with I / O first'));
      const L = ducks();
      if (L.length) kids.push(h('div', { class: 'tl2-lrow' }, ...L.map((d) => h('button', { class: d.shot === duckSel ? 'primary' : 'ghost', title: 'Select and go to start', onclick: () => { selectDuck(d.shot); } },
        `${tcs(d.t0)}–${tcs(d.t1)} · ${d.music < 0.004 ? 'no music' : 'music ' + Math.round(d.music * 100) + '%'}`))));
      if (sel) {
        const out = h('span', { class: 'tl2-lval' }, Math.round(sel.music * 100) + '%');
        kids.push(h('div', { class: 'tl2-lrow se-sel' },
          h('b', {}, 'Selected reduction'),
          h('label', { class: 'se-f' }, 'Music', h('input', { type: 'range', min: 0, max: 100, step: 5, value: Math.round(sel.music * 100), oninput: (e) => { out.textContent = e.target.value + '%'; }, onchange: (e) => setDuck(sel.shot, { music: +e.target.value / 100 }) }), out),
          h('label', { class: 'se-f' }, 'Fade', h('input', { type: 'number', min: 0.1, max: 3, step: 0.1, value: sel.fade ?? 0.12, style: { width: '56px' }, onchange: (e) => { const v = +e.target.value; if (Number.isFinite(v)) setDuck(sel.shot, { fade: Math.max(0.1, Math.min(3, v)) }); } }), h('span', { class: 'dim' }, 's')),
          h('span', { class: 'dim' }, 'Drag the edges on the timeline'),
          h('button', { class: 'ghost danger', onclick: () => removeDuck(sel.shot) }, '🗑 Delete')));
      }
    }
    duckEl.replaceChildren(...kids);
  }

  // ---- the Channels section (Sounds tab)
  const rowsEl = h('div', { class: 'mx-rows' }), actsEl = h('div', { class: 'tl2-lrow mx-acts' }), abEl = h('span', { class: 'segs mx-ab' }), pillEl = h('div', { class: 'mx-pill', hidden: true });
  const headEl = h('div', { class: 'mx-head' }, h('b', { class: 'mx-title' }, '🎚 Sound channels'), abEl);
  el.append(headEl, pillEl, rowsEl, actsEl);
  function paintRows() {
    rowsEl.innerHTML = ''; views.forEach((v) => { if (!v.node.isConnected) views.delete(v); });
    const rows = [...(mode() !== 'none' ? [{ id: 'mix', label: 'Film audio' }] : []), ...layers.map((l) => ({ id: l.id, label: l.label })), ...((clips() || []).length || ['stems', 'all', 'studio'].includes(mode()) ? [{ id: BUS, label: 'Added sounds' }] : [])];
    if (!layers.length) rowsEl.append(h('div', { class: 'dim' }, 'No sound layers (mix only)'));
    busShown = rows.some((r) => r.id === BUS);
    for (const r of rows) rowsEl.append(h('div', { class: 'mx-row' }, h('span', { class: 'mx-name', title: r.label }, r.label), controls(r.id)));
    for (const v of views) if (v.node.isConnected) v.seen = true;
  }
  function paintActs() {
    const m = mode(), r = range(), canBuild = ['stems', 'all', 'studio'].includes(m), busy = !!applyQueue?.busy(), dirty = !!(applyQueue?.dirty() || pend.size || inflight);
    headEl.title = APPROX[m] || APPROX.other; headEl.querySelector('.mx-title').title = headEl.title;
    abEl.replaceChildren(...(engineOk() ? [['ch', 'Channels', 'Listen to channels (levels, M/S and added sounds update instantly)'], ['built', 'Built audio', 'Listen to the built film audio (used for rendering)']].map(([k, t, tip]) =>
      h('button', { class: 'seg' + ((k === 'ch') === active ? ' on' : '') + (ab === k ? ' pin' : ''), title: tip + (ab === k ? ' · pinned; click again: automatic' : ' · click to pin'), onclick: () => { ab = ab === k ? null : k; update(); } }, t + (ab === k ? ' 📌' : ''))) : []));
    const pill = active && !live ? 'Playing current channels (instead of this video’s own audio)' : ms.solo.size ? 'Solo on: listening only; does not affect the render' : '';
    pillEl.hidden = !pill; pillEl.textContent = pill;
    const any = layers.some((l) => KEY[l.id]) || canBuild;
    actsEl.replaceChildren(...[
      any ? h('select', { title: 'Apply levels to', onchange: (e) => { scope = e.target.value; update(); } },
        h('option', { value: 'all', selected: scope === 'all' }, 'Whole film'),
        h('option', { value: 'range', selected: scope === 'range', disabled: !r }, r ? `Selected range (${r[0].toFixed(1)}–${r[1].toFixed(1)} s)` : 'Selected range (select with I / O first)')) : null,
      mixerDirty() ? h('button', { class: 'ghost', title: 'Restore channel levels to the built film mix', onclick: () => revert() }, 'Undo') : null,
      msOn() ? h('button', { class: 'ghost', title: 'Turn off all mute and solo controls', onclick: () => { ms.mute.clear(); ms.solo.clear(); saveMS(); update(); } }, 'Clear M/S') : null,
      savable('music') && layer('music') ? (() => { const off = (entry(list(), '*')?.music ?? 1) < 0.004; return h('button', { class: 'ghost', title: off ? 'Bring back the film music' : 'Remove all film music (voice and effects stay; original audio is backed up)', onclick: () => musicOut(!off) }, off ? '🎵 Bring back music' : '🔇 Remove music'); })() : null,
      cues ? h('span', { class: 'dim' }, `${cues.length} effect markers`) : null,
      list().length ? h('span', { class: 'dim' }, `${list().length} sound settings in the film`) : null,
      !['stems', 'studio'].includes(m) && layers.length ? h('span', { class: 'dim' }, 'In this film, channel levels affect listening only and cannot be applied separately.') : null,
      canBuild ? h('button', { class: dirty ? 'primary' : 'ghost', disabled: busy, title: 'Apply levels, added sounds and reductions to the film audio (the original is backed up); the preview and next render use this audio', onclick: () => buildNow() }, m === 'studio' ? '💾 Apply to film (a few minutes)' : '💾 Apply to film') : null,
      status?.() || null,
    ].filter(Boolean));
  }
  paintRows(); paintActs(); paintDuck();

  return {
    el, duckEl,
    // P4 ducks: the timeline's music bands (every entry with a music level) + their gestures
    musicBands: () => list().filter((e) => e.music != null).map((e) => ({ ...e, duck: isDuck(e.shot), sel: e.shot === duckSel })),
    addDuck, setDuck, removeDuck, selectDuck, duckSelected: () => (duckSel && entry(list(), duckSel)) || null,
    // L: { layers (studio placeholders included), cues }; soundInfo from sound-info; storedSound = tweaks.json sound
    setLayers(L, soundInfo, storedSound) {
      layers = (L && L.layers) || []; cues = L && L.cues && L.cues.length ? L.cues : null; info = soundInfo || info;
      server = Array.isArray(storedSound) ? storedSound : []; bump();
      builtList = list(); builtKey = JSON.stringify(builtList);
      for (const id of [...ms.mute, ...ms.solo]) if (!canListen(id)) { ms.mute.delete(id); ms.solo.delete(id); }
      paintRows(); update();
    },
    state() {
      const rows = {};
      for (const id of ['mix', ...layers.map((l) => l.id), BUS]) rows[id] = { level: levelOf(id), film: filmLevel(id), savable: savable(id), mute: ms.mute.has(id), solo: ms.solo.has(id), canListen: canListen(id) };
      return { rows, active, soloOn: ms.solo.size > 0, scope, ab, mode: mode(), list: list() };
    },
    setLevel, toggleMute: (id) => toggle(ms.mute, id), toggleSolo: (id) => toggle(ms.solo, id), begin, end, resetLevel,
    clearMS() { ms.mute.clear(); ms.solo.clear(); saveMS(); update(); },
    audible: (id) => msGain(id) > 0 && levelOf(id) > 0.004,
    canListen, controls, active: () => active,
    // the clips changed (loaded = first load: that is what the built mix has)
    clipsChanged(loaded) { if (loaded || builtClips == null) builtClips = clipsKey(); if (!busShown && (clips() || []).length) paintRows(); update(); if (active) scheduleClips(); },
    duckChanged(L) { server = Array.isArray(L) ? L : server; bump(); update(); },
    setStored(L) { if (!Array.isArray(L)) return; server = L; bump(); update(); },
    // a sound build finished: what the player plays now is the current state
    built() { builtList = list(); builtKey = JSON.stringify(builtList); builtClips = clipsKey(); update(); },
    refresh: () => update(),
    setMaster({ volume, muted } = {}) {
      if (active) { if (volume != null) M.volume = volume; if (muted != null) M.muted = muted; if (master) master.gain.value = M.muted ? 0 : M.volume; notify(); }
      else { if (volume != null) media.volume = volume; if (muted != null) media.muted = muted; }
    },
    master: () => (active ? { ...M } : { volume: media.volume ?? 1, muted: !!media.muted }),
    // corner note: solo on / the engine plays over a rendered video
    note: () => (ms.solo.size ? 'Solo on: listening only; does not affect the render' : active && !live ? 'Playing current channels (instead of this video’s own audio)' : ''),
    undo: () => hist.undo(), redo: () => hist.redo(),
    flush,
    onChange(cb) { subs.push(cb); return () => { const i = subs.indexOf(cb); if (i >= 0) subs.splice(i, 1); }; },
    destroy() {
      clearTimeout(saveTimer); if (pend.size) flush();
      if (active) stop(); for (const a of audios.values()) { a.pause(); a.removeAttribute('src'); } audios.clear();
      try { ac?.close(); } catch { } views.clear(); subs.length = 0;
    },
  };
}
