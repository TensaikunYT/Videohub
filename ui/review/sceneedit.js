// Scene editor on the live preview (pages that offer window.VH_EDIT: the 3D studio engine, engine/tweaks.js).
// The user moves the camera, an object or a screen item right in the picture, or moves a cut; the change is saved to
// the scene's tweaks.json at once and every later preview and render draws it. No code change, no Claude, no tokens.
import { h, api, toast, confirmBox } from '../app.js';

const STEPS = [0.01, 0.1, 1];
const TC = (s) => { const m = Math.floor(s / 60), r = s - m * 60; return `${m}:${r.toFixed(2).padStart(5, '0')}`; };

// history: { push(tag), undone() } (review.js's undo router: Ctrl+Z is then routed there, not swallowed here; undone()
// tells it the panel's own ↶ took the newest scene step);
// keysActive(): false while the timeline is the active area (Delete / arrows / Esc are its keys then);
// applyNow(): the review page's sound build (one queue for every editor); onSoundSaved(r): its levels were saved
export function createSceneEditor({ src, projectId, frame, panelHost, onOpen, onClose, history, keysActive, applyNow, onSoundSaved }) {
  const btn = h('button', { hidden: true, title: 'Adjust the camera, objects, screen text or cuts directly in the picture; no code changes or tokens needed (tweaks.json)', onclick: () => open ? close() : start() }, '✏️ Edit scene');
  let open = false, E = null, mode = 'cam', sel = null, scope = 'shot', step = 0.1, undo = [], saveTimer = 0, savedAt = 0;
  let items = [], osel = null, cut = null;
  let snd = null, sndShot = null, sndApplied = null, sndBusy = false, sndBase = null;   // sound: what the film's mix allows, the shot on screen, the levels last put in        // screen items of this frame, the selected one; the cut being moved
  const cv = h('canvas', { class: 'sedit-cv' });
  const ov = h('div', { class: 'sedit-ov' }, cv);
  const panel = h('div', { class: 'sedit-panel' });
  const fps = () => src.info?.fps || 60;
  // what this page can do (older pages: overlays only when they report them)
  const caps = () => { try { return E.caps ? E.caps() : { overlays: !!E.overlays, cuts: !!E.findCut }; } catch { return {}; } };

  const edit = () => { try { return src.win?.VH_EDIT || null; } catch { return null; } };
  const key = () => scope === 'all' ? '*' : (E.shot() || '*');
  // the page is ready (again): offer the button when it has the editor
  function check() {
    const e = edit(); btn.hidden = !e;
    if (open && e !== E) close(true);    // the page reloaded (code changed): its free camera and selection are gone
  }

  function start() {
    E = edit(); if (!E) return;
    open = true; btn.classList.add('on'); src.pause();
    frame.append(ov); (panelHost || frame).append(panel); undo = []; sel = null; osel = null; cut = null;
    if (!snd) api(`/api/project/${projectId}/sound-info`).then((r) => { snd = r; paint(); }).catch(() => { snd = { mode: 'none', channels: [] }; });
    if (sndApplied == null) sndApplied = JSON.stringify(E.get().sound || []);
    sndBase = E.get().sound || [];
    // the page's copy is as old as its last load: take levels saved since then (timeline, Channels)
    api(`/api/project/${projectId}/tweaks`).then((t) => { if (open) syncSound(t.sound || []); }).catch(() => { });
    setMode('cam'); onOpen?.();
    window.addEventListener('keydown', onKey, true);
  }
  function close(silent) {
    if (!open) return;
    try { E?.freeStop(); } catch { }
    open = false; btn.classList.remove('on'); ov.remove(); panel.remove(); sel = null; osel = null;
    window.removeEventListener('keydown', onKey, true);
    flush(); onClose?.(); if (!silent) src.currentTime = src.currentTime;
  }
  function onKey(e) {
    if (e.target.matches?.('input, textarea, select')) return;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { if (history) return; e.preventDefault(); e.stopImmediatePropagation(); back(); }
    else if (keysActive && !keysActive() && (e.key === 'Escape' || e.key.startsWith('Arrow') || e.key === 'Delete' || e.key === 'Backspace')) return;
    else if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); if (sel || osel) { sel = null; osel = null; draw(); paint(); } else close(); }
    else if (mode === 'ovl' && osel && e.key.startsWith('Arrow')) {     // arrows nudge the selected screen item
      e.preventDefault(); e.stopImmediatePropagation();
      const n = e.shiftKey ? 20 : 2, d = { ArrowLeft: [-n, 0], ArrowRight: [n, 0], ArrowUp: [0, -n], ArrowDown: [0, n] }[e.key];
      change(() => E.ovMove(key(), osel, d[0], d[1])); refreshItems();
    }
  }

  // ---- changes: remember the state before for undo, save shortly after
  function change(fn) {
    undo.push(E.get()); if (undo.length > 80) undo.shift(); history?.push('scene');
    const r = fn(); queueSave(); draw(); return r;
  }
  function back(quiet) {
    const prev = undo.pop(); if (!prev) { if (!quiet) toast('Nothing to undo'); return false; }
    E.set(prev); queueSave(); if (mode === 'ovl') refreshItems();
    // the cut on show keeps its shift / transition from the restored snapshot (the panel label reads it)
    if (cut) {
      const c = (prev.cuts || []).find((x) => Math.abs(x.at - cut.at) < 1e-3);
      cut.d = c ? c.d || 0 : 0; cut.tr = c?.tr ? { ...c.tr } : null; cut.film = +(cut.at + cut.d).toFixed(4);
      if (mode === 'cut') src.currentTime = cut.film + 0.5 / fps();
    }
    draw(); paint(); return true;
  }
  function queueSave() { clearTimeout(saveTimer); saveTimer = setTimeout(flush, 350); }
  // only this editor's keys: shots, cuts, and the sound fields it changed itself (a field-level diff against what it
  // last sent), so levels, ducks and clips saved elsewhere survive — also when an undo here restores an old snapshot
  async function flush() {
    if (!saveTimer || !E) return; clearTimeout(saveTimer); saveTimer = 0;
    const d = E.get(), cur = d.sound || [], ops = soundDiff(sndBase, cur);
    try {
      const r = await api(`/api/project/${projectId}/tweaks`, { method: 'PATCH', body: { shots: d.shots || {}, cuts: d.cuts || [], ...(ops ? { soundOps: ops } : {}) } });
      sndBase = r.sound || cur; savedAt = Date.now(); paint();
      if (ops) onSoundSaved?.(r);   // the mixer's chips show the same levels; the queue marks the sound to rebuild
    } catch (e) { toast('Could not save tweaks.json: ' + e.message, true); }
  }
  // "shot|field" pairs this editor changed; only those go into soundOps
  const touched = new Set();
  function soundDiff(base, cur) {
    const set = new Map(), find = (L, k) => (L || []).find((e) => e.shot === k) || null;
    for (const tf of touched) {
      const i = tf.lastIndexOf('|'), shot = tf.slice(0, i), f = tf.slice(i + 1), b = find(base, shot), c = find(cur, shot);
      const bv = b ? b[f] ?? null : null, cv = c ? c[f] ?? null : null;
      if (bv === cv) continue;
      const o = set.get(shot) || { shot, ...(c ? { t0: c.t0, t1: c.t1 } : {}) };
      o[f] = cv; set.set(shot, o);
    }
    return set.size ? { set: [...set.values()] } : null;
  }
  // a level saved elsewhere (timeline, Channels): into the page's copy, unless this editor has an unsent change there
  function syncSound(list) {
    const e = E || edit(); if (!e || !e.soundSet) return;
    const mine = e.get().sound || [], pend = new Set();
    for (const tf of touched) { const shot = tf.slice(0, tf.lastIndexOf('|')), f = tf.slice(tf.lastIndexOf('|') + 1); const a = (sndBase || []).find((x) => x.shot === shot), b = mine.find((x) => x.shot === shot); if ((a?.[f] ?? null) !== (b?.[f] ?? null)) pend.add(shot); }
    const shots = new Set([...(list || []).map((x) => x.shot), ...mine.map((x) => x.shot)]);
    for (const shot of shots) {
      if (pend.has(shot)) continue;
      const n = (list || []).find((x) => x.shot === shot), o = mine.find((x) => x.shot === shot);
      try { e.soundSet(n ? { ...n } : { shot, t0: o.t0, t1: o.t1 }); } catch { }
    }
    sndBase = (list || []).map((x) => ({ ...x }));
    if (open) paint();
  }

  // ---- mouse on the picture
  const ndc = (e) => { const r = ov.getBoundingClientRect(); return [((e.clientX - r.left) / r.width) * 2 - 1, -(((e.clientY - r.top) / r.height) * 2 - 1)]; };
  const toPx = (p) => [(p[0] + 1) / 2 * 1920, (1 - p[1]) / 2 * 1080];
  let drag = null;
  ov.addEventListener('contextmenu', (e) => e.preventDefault());
  ov.addEventListener('pointerdown', (e) => {
    e.preventDefault(); e.stopPropagation();
    if (mode === 'cut') return;
    ov.setPointerCapture(e.pointerId);
    const p = ndc(e);
    drag = { p0: p, last: p, moved: false, btn: e.button, shift: e.shiftKey, alt: e.altKey, snap: E.get() };
    if (mode === 'cam' && e.button === 0 && !e.shiftKey && !e.altKey) E.pivotAt(p[0], p[1]);
    // a press on a screen item selects it at once, so one drag both picks and moves it
    if (mode === 'ovl') { const hit = itemAt(toPx(p)); if (hit && hit.id !== osel) { osel = hit.id; draw(); paint(); } }
  });
  ov.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const p = ndc(e), dx = p[0] - drag.last[0], dy = p[1] - drag.last[1];
    if (!drag.moved && Math.hypot(p[0] - drag.p0[0], p[1] - drag.p0[1]) < 0.01) return;
    drag.moved = true;
    if (mode === 'cam') E.nav(drag.btn === 2 || drag.shift ? 'pan' : drag.alt ? 'look' : 'orbit', dx / 2, dy / 2);
    else if (mode === 'obj' && sel) { E.drag(key(), sel.path, drag.last[0], drag.last[1], p[0], p[1], drag.shift); draw(); }
    else if (mode === 'ovl' && osel) { E.ovMove(key(), osel, drag.shift ? 0 : dx / 2 * 1920, -dy / 2 * 1080); refreshItems(); draw(); }
    drag.last = p;
  });
  ov.addEventListener('pointerup', () => {
    if (!drag) return;
    const d = drag; drag = null;
    if (!d.moved && mode === 'obj') { pickAt(d.p0); return; }
    if (!d.moved && mode === 'ovl') { const hit = itemAt(toPx(d.p0)); osel = hit ? hit.id : null; draw(); paint(); return; }
    if (d.moved && (mode === 'obj' && sel || mode === 'ovl' && osel)) { undo.push(d.snap); history?.push('scene'); queueSave(); paint(); }
  });
  ov.addEventListener('wheel', (e) => {
    e.preventDefault(); e.stopPropagation();
    if (mode === 'cam') E.nav('dolly', e.deltaY * 0.0012);
    else if (mode === 'obj' && sel) change(() => E.nudge(key(), sel.path, [0, (e.deltaY < 0 ? 1 : -1) * step, 0]));
    else if (mode === 'ovl' && osel) scaleItem(e.deltaY < 0 ? 1.05 : 1 / 1.05);
  }, { passive: false });

  function pickAt(p) {
    const r = E.pick(p[0], p[1]);
    if (!r) { sel = null; draw(); paint(); return; }
    sel = { chain: r.chain, i: r.sel, ...r.chain[r.sel] };
    draw(); paint();
  }
  function selectLevel(d) {
    if (!sel) return;
    const i = Math.max(0, Math.min(sel.chain.length - 1, sel.i + d));
    sel = { chain: sel.chain, i, ...sel.chain[i] }; draw(); paint();
  }
  // screen items: the smallest box under the point
  function refreshItems() { try { items = E.overlays(); } catch { items = []; } }
  function itemAt([x, y]) {
    return items.filter((it) => x >= it.box[0] - 6 && x <= it.box[2] + 6 && y >= it.box[1] - 6 && y <= it.box[3] + 6)
      .sort((a, b) => (a.box[2] - a.box[0]) * (a.box[3] - a.box[1]) - (b.box[2] - b.box[0]) * (b.box[3] - b.box[1]))[0] || null;
  }
  function scaleItem(k) {
    const it = items.find((i) => i.id === osel); if (!it) return;
    change(() => E.ovScale(key(), osel, k, (it.box[0] + it.box[2]) / 2, (it.box[1] + it.box[3]) / 2)); refreshItems(); draw();
  }
  const itemName = (it) => it.text ? `“${it.text}”` : it.kind === 'custom' ? `drawing ${+it.id.split('#').pop() + 1}` : `${it.kind} ${+it.id.split('#').pop() + 1}`;

  // boxes on the picture: the selected object, or the screen items
  function draw() {
    const r = ov.getBoundingClientRect();
    cv.width = Math.round(r.width); cv.height = Math.round(r.height);
    const g = cv.getContext('2d'); g.clearRect(0, 0, cv.width, cv.height);
    if (mode === 'ovl') {
      const sx = cv.width / 1920, sy = cv.height / 1080;
      for (const it of items) {
        const on = it.id === osel;
        g.strokeStyle = on ? '#ffb547' : 'rgba(126,231,135,.75)'; g.lineWidth = on ? 2 : 1; g.setLineDash(on ? [6, 4] : [3, 3]);
        g.strokeRect(it.box[0] * sx - 2, it.box[1] * sy - 2, (it.box[2] - it.box[0]) * sx + 4, (it.box[3] - it.box[1]) * sy + 4);
      }
      return;
    }
    if (!sel || mode !== 'obj') return;
    const info = E.info(sel.path); if (!info?.rect) return;
    sel.size = info.size;
    const [x0, y0, x1, y1] = info.rect, X = (x) => (x + 1) / 2 * cv.width, Y = (y) => (1 - y) / 2 * cv.height;
    g.strokeStyle = '#ffb547'; g.lineWidth = 2; g.setLineDash([6, 4]);
    g.strokeRect(X(x0), Y(y1), X(x1) - X(x0), Y(y0) - Y(y1));
  }

  // ---- cuts: find the next / previous one, show its first frame, move it by frames
  function goCut(dir) {
    const from = cut ? cut.film + dir / fps() : undefined;
    const r = E.findCut(dir, from, fps());
    if (!r) return toast(dir > 0 ? 'No cut in the next 40 seconds' : 'No cut in the previous 40 seconds');
    cut = r; src.currentTime = r.film + 0.5 / fps(); paint();
  }
  function moveCut(frames) {
    if (!cut) return;
    change(() => { cut.d = E.cutShift(cut.at, frames, fps()); cut.film = +(cut.at + cut.d).toFixed(4); });
    src.currentTime = cut.film + 0.5 / fps(); paint();
  }
  function playCut() {
    if (!cut) return;
    src.currentTime = Math.max(0, cut.film - 1.5); src.play();
    setTimeout(() => { if (!src.paused) src.pause(); }, 3000);
  }
  // ---- transitions (2D films: engine/lib/transitions2d.js): one click picks one for this cut and plays it
  const TRDIRS = [['left', '←'], ['right', '→'], ['up', '↑'], ['down', '↓']];
  const PORTAL = [['#ff8a2a', 'Ember'], ['#4fd2ff', 'Ice'], ['#a98bff', 'Void'], ['#3ddc84', 'Emerald'], ['#ff5c8a', 'Rose'], ['#ffd166', 'Gold']];
  let playTimer = 0;
  function playTr(dur) {
    if (!cut) return;
    clearTimeout(playTimer); src.currentTime = Math.max(0, cut.film - 0.8); src.play();
    playTimer = setTimeout(() => { if (!src.paused) src.pause(); }, (0.8 + (dur || 0.5) + 1.2) * 1000);
  }
  function setTr(tr, play = true) {
    if (!cut) return;
    change(() => E.cutTr(cut.at, tr)); cut.tr = tr ? { ...tr } : null; paint();
    if (play) playTr(tr?.dur);
  }
  const trDef = (type) => (caps().transitions || []).find((x) => x.id === type) || {};
  function pickTr(type) {
    const d = trDef(type), cur = cut?.tr;
    setTr({ type, dur: cur && cur.type === type ? cur.dur : d.dur, ...(d.dirs ? { dir: (cur && cur.dir) || 'left' } : {}), ...(d.color ? { color: (cur && cur.color) || PORTAL[0][0] } : {}) });
  }
  // the same transition on every cut of the film (each cut keeps its own shift)
  async function trAll() {
    if (!cut?.tr) return;
    const tr = { ...cut.tr }, F = fps(); let n = 0, from = 0;
    if (!await confirmBox('Apply transition to all cuts', h('p', {}, `Apply "${trDef(tr.type).label || tr.type}" to every cut in the film?`), 'Apply')) return;
    change(() => { for (let i = 0; i < 2000; i++) { const r = E.findCut(1, from, F); if (!r) break; E.cutTr(r.at, tr); n++; from = r.film + 1 / F; } });
    toast(`Applied to ${n} cuts`); paint();
  }
  function trPanel() {
    const list = caps().transitions;
    if (!list || !cut) return [];
    const tr = cut.tr, cur = tr ? tr.type : null, d = tr ? trDef(tr.type) : {};
    const out = [h('div', { class: 'sedit-hint' }, 'Transition: click to preview it. Without a selection, the film uses its own transition.'),
      h('div', { class: 'sedit-items' }, list.map((x) => b(x.label, x.id === 'cut' ? 'Cut without a transition' : `${x.label} (${x.dur} s)`, () => pickTr(x.id), x.id === cur ? 'on' : '')))];
    if (tr && tr.type !== 'cut') {
      const dur = tr.dur ?? d.dur ?? 0.5, val = h('span', { class: 'sedit-val' }, dur.toFixed(2) + ' s');
      out.push(h('label', { class: 'sedit-row' }, h('span', { class: 'sedit-lbl' }, 'Duration'),
        h('input', { type: 'range', min: 0.15, max: 2.5, step: 0.05, value: dur, oninput: (e) => { val.textContent = (+e.target.value).toFixed(2) + ' s'; }, onchange: (e) => setTr({ ...tr, dur: +e.target.value }) }), val));
      if (d.dirs) out.push(h('div', { class: 'sedit-row' }, h('span', { class: 'sedit-lbl' }, 'Direction'), TRDIRS.map(([k, l]) => b(l, k, () => setTr({ ...tr, dir: k }), (tr.dir || 'left') === k ? 'on' : ''))));
      if (d.color) out.push(h('div', { class: 'sedit-row' }, h('span', { class: 'sedit-lbl' }, 'Color'), PORTAL.map(([c, l]) => h('button', { class: tr.color === c ? 'on' : '', title: l, style: `background:${c};min-width:28px`, onclick: (e) => { e.stopPropagation(); setTr({ ...tr, color: c }); } }, ''))));
    }
    out.push(h('div', { class: 'sedit-row' },
      tr ? b('▶ Play transition', 'Replay the transition', () => playTr(tr.dur ?? d.dur)) : null,
      tr ? b('Apply to all cuts', 'Use this transition on every cut in the film', () => trAll()) : null,
      tr ? b('↺ Remove transition', 'Restore the film\'s own transition', () => setTr(null, false), 'danger') : null));
    return out;
  }

  // ---- panel
  function setMode(m) {
    mode = m;
    try { m === 'cam' ? E.freeStart() : E.freeStop(); } catch { }
    ov.style.cursor = m === 'cam' ? 'grab' : m === 'cut' ? 'default' : m === 'ovl' ? 'move' : 'crosshair';
    ov.classList.toggle('passive', m === 'cut');
    if (m === 'ovl') refreshItems();
    if (m === 'snd') findSndShot();
    draw(); paint();
  }
  // the shot on screen as film time (cut to cut); the whole film for the "Whole film" scope
  function findSndShot() {
    const t = src.currentTime, F = fps(), a = E.findCut(-1, t + 0.5 / F, F), z = E.findCut(1, t, F);
    sndShot = { shot: E.shot() || '*', t0: a ? a.film : 0, t1: z ? z.film : (src.duration || 0) };
  }
  const sndEntry = () => { const k = scope === 'all' ? '*' : sndShot?.shot; return (E.get().sound || []).find((e) => e.shot === k) || null; };
  function setLevel(ch, v) {
    if (!sndShot) findSndShot();
    const all = scope === 'all', base = sndEntry() || {};
    touched.add(`${all ? '*' : sndShot.shot}|${ch}`);
    change(() => E.soundSet({ ...base, shot: all ? '*' : sndShot.shot, t0: all ? 0 : sndShot.t0, t1: all ? (src.duration || 1e6) : sndShot.t1, [ch]: v }));
    paint();
  }
  async function applySound() {
    if (sndBusy) return; sndBusy = true; paint();
    try {
      clearTimeout(saveTimer); saveTimer = 1; await flush();
      toast(snd?.mode === 'studio' ? 'Rebuilding audio with the engine (this may take a few minutes)…' : 'Building audio…');
      // the review page's queue builds it (and reloads the preview's sound); alone, the old direct call
      if (applyNow) { if (await applyNow().then(() => false, () => true)) { sndBusy = false; paint(); return; } }   // the queue reports a failed build
      else { const r = await api(`/api/project/${projectId}/sound-apply`, { method: 'POST', body: {} }); src.reloadAudio?.(); toast(`Audio applied (${(r.ms / 1000).toFixed(1)} s · ${r.note})`); }
      sndApplied = JSON.stringify(E.get().sound || []);
      const at = scope === 'all' ? src.currentTime : Math.max(0, (sndShot?.t0 || 0) - 0.4); src.currentTime = at; setTimeout(() => src.play(), 250);
    } catch (e) { toast('Could not apply audio: ' + e.message, true); }
    sndBusy = false; paint();
  }
  const b = (label, title, fn, cls) => h('button', { class: cls || '', title, onclick: (e) => { e.stopPropagation(); fn(); } }, label);
  function paint() {
    if (!open) return;
    const shot = E.shot(), data = E.get(), here = data.shots[key()] || {};
    const nObj = Object.keys(here.objects || {}).length, nOv = Object.keys(here.overlays || {}).length, nAll = Object.keys(data.shots).length, nCut = (data.cuts || []).length;
    const scopeSel = h('select', { onchange: (e) => { scope = e.target.value; paint(); } },
      h('option', { value: 'shot', selected: scope === 'shot' }, shot ? `This scene: ${shot}` : 'This scene'),
      h('option', { value: 'all', selected: scope === 'all' }, 'Whole film'));
    const stepSel = h('select', { title: 'Step', onchange: (e) => { step = +e.target.value; } }, STEPS.map((s) => h('option', { value: s, selected: s === step }, s + ' m')));
    const body = [];
    if (mode === 'cam') {
      const fs = E.freeState();
      body.push(h('div', { class: 'sedit-hint' }, 'Drag: orbit · Shift or right-click: pan · Alt: look around · Wheel: zoom in/out'),
        h('label', { class: 'sedit-row' }, 'Lens (FOV) ', h('input', { type: 'range', min: 12, max: 100, step: 0.5, value: fs?.fov || 50, oninput: (e) => { E.nav('fov', +e.target.value); e.target.nextSibling.textContent = ' ' + (+e.target.value).toFixed(0) + '°'; } }), h('span', {}, ' ' + Math.round(fs?.fov || 50) + '°')),
        h('div', { class: 'sedit-row' },
          b('✓ Save angle', 'Use this angle as the scene camera (the scene\'s own motion is preserved and added to it)', () => { change(() => E.saveCam(key())); toast('Camera angle saved'); setMode('cam'); }, 'primary'),
          b('Reset view', 'Reset the free camera to the scene camera', () => { E.freeStop(); E.freeStart(); }),
          here.camera ? b('↺ Clear camera adjustment', 'Remove the camera adjustment for this scene', () => { change(() => E.resetCam(key())); setMode('cam'); }, 'danger') : null));
    } else if (mode === 'obj') {
      body.push(h('div', { class: 'sedit-hint' }, 'Click: select · Drag: move · Shift+drag: vertical only · Wheel: move up/down · Esc: clear selection'));
      if (!sel) body.push(h('div', { class: 'dim' }, 'Click an object.'));
      else {
        const t = (here.objects || {})[sel.path] || {};
        body.push(h('div', { class: 'sedit-sel' }, h('b', {}, sel.name || (sel.type === 'Mesh' ? 'part' : 'group')), h('span', { class: 'dim' }, ` · level ${sel.chain.length - sel.i}/${sel.chain.length}`), h('span', { class: 'dim' }, ` ${sel.size?.join(' × ') || ''} m`),
            h('div', { class: 'dim mono', title: sel.path }, sel.path)),
          h('div', { class: 'sedit-row' }, b('⬆ Larger part', 'Select the object containing this part', () => selectLevel(1)), b('⬇ Smaller part', 'Select the part inside it', () => selectLevel(-1))),
          h('div', { class: 'sedit-row' },
            b('↑', `${step} m up`, () => change(() => E.nudge(key(), sel.path, [0, step, 0]))),
            b('↓', `${step} m down`, () => change(() => E.nudge(key(), sel.path, [0, -step, 0]))),
            b('Place on surface', 'Move onto a nearby surface below it (or lift it out if slightly embedded)', () => { const d = change(() => E.ground(key(), sel.path)); toast(d == null ? 'No nearby surface below it' : `Placed on surface (${d > 0 ? '+' : ''}${d} m)`); }),
            stepSel),
          h('div', { class: 'sedit-row' },
            b('⟲ 15°', 'Rotate left', () => change(() => E.rotate(key(), sel.path, 15))), b('⟳ 15°', 'Rotate right', () => change(() => E.rotate(key(), sel.path, -15))),
            b('＋10%', 'Enlarge', () => change(() => E.scale(key(), sel.path, 1.1))), b('－10%', 'Shrink', () => change(() => E.scale(key(), sel.path, 1 / 1.1))),
            b(t.hide ? 'Show' : 'Hide', 'Hide in this scene', () => change(() => E.hide(key(), sel.path, !t.hide)))),
          Object.keys(t).some((k) => k !== 't') ? h('div', { class: 'sedit-row' }, h('span', { class: 'dim' }, 'Adjustment: ' + describeTweak(t)), b('↺ Reset', 'Remove this object\'s adjustments', () => change(() => E.resetObj(key(), sel.path)), 'danger')) : null);
      }
    } else if (mode === 'ovl') {
      body.push(h('div', { class: 'sedit-hint' }, 'Click: select · Drag: move (Shift: vertical only) · Wheel: enlarge/shrink · Arrows: 2 px (Shift: 20 px)'));
      if (!items.length) body.push(h('div', { class: 'dim' }, 'No screen text or drawings in this frame.'));
      else body.push(h('div', { class: 'sedit-items' }, items.slice(0, 16).map((it) => b(itemName(it) + (it.hide ? ' (hidden)' : ''), it.id, () => { osel = it.id; draw(); paint(); }, it.id === osel ? 'on' : ''))));
      const it = items.find((i) => i.id === osel);
      if (it) {
        const t = (here.overlays || {})[it.id] || {};
        body.push(h('div', { class: 'sedit-row' },
            b('＋10%', 'Enlarge', () => scaleItem(1.1)), b('－10%', 'Shrink', () => scaleItem(1 / 1.1)),
            b(t.hide ? 'Show' : 'Hide', 'Hide in this scene', () => { change(() => E.ovHide(key(), it.id, !t.hide)); refreshItems(); paint(); }),
            Object.keys(t).length ? b('↺ Reset', 'Remove this item\'s adjustments', () => { change(() => E.ovReset(key(), it.id)); refreshItems(); draw(); paint(); }, 'danger') : null),
          Object.keys(t).length ? h('div', { class: 'dim' }, 'Adjustment: ' + [t.dx || t.dy ? `moved (${t.dx || 0}, ${t.dy || 0}) px` : '', t.s ? `×${t.s.toFixed(2)}` : '', t.hide ? 'hidden' : ''].filter(Boolean).join(' · ')) : null);
      }
    } else if (mode === 'snd') {
        const LBL = { music: 'Music', sfx: 'Effects', vo: 'Voice', all: 'Master' }, e = sndEntry() || {}, dirty = JSON.stringify(E.get().sound || []) !== sndApplied;
        body.push(h('div', { class: 'sedit-hint' }, scope === 'all' ? 'Audio levels for the whole film.' : `Audio levels for this scene${sndShot ? ` (${sndShot.shot}, ${sndShot.t0.toFixed(2)}–${sndShot.t1.toFixed(2)} s)` : ''}. Transitions are smoothed over 0.12 s.`));
        if (!snd) body.push(h('div', { class: 'dim' }, 'Loading audio info…'));
        else if (snd.mode === 'none') body.push(h('div', { class: 'dim' }, 'This film has no adjustable audio: ' + (snd.reason || '')));
        else {
          if (snd.mode === 'all') body.push(h('div', { class: 'dim' }, 'This film has no separate music/effects channels: only the master level is available.'));
          for (const ch of snd.channels) {
            const v = Math.round((e[ch] ?? 1) * 100), out = h('span', { class: 'sedit-val' }, v + '%');
            body.push(h('label', { class: 'sedit-row' }, h('span', { class: 'sedit-lbl' }, LBL[ch]),
              h('input', { type: 'range', min: 0, max: 200, step: 5, value: v, oninput: (ev) => { out.textContent = ev.target.value + '%'; }, onchange: (ev) => setLevel(ch, +ev.target.value / 100) }), out));
          }
          body.push(h('div', { class: 'sedit-row' },
            b(sndBusy ? 'Building…' : '🔊 Apply and listen', 'Apply levels to the film audio (the original is backed up) and play this scene with sound', () => applySound(), 'primary'),
            Object.keys(e).some((k) => ['music', 'sfx', 'vo', 'all'].includes(k)) ? b('↺ Clear this adjustment', 'Remove the audio adjustment for this scene', () => { for (const k of ['music', 'sfx', 'vo', 'all']) touched.add(`${e.shot}|${k}`); change(() => E.soundSet({ shot: e.shot, t0: e.t0, t1: e.t1 })); paint(); }, 'danger') : null),
            dirty ? h('div', { class: 'sedit-warn' }, 'Changes have not been applied to the audio yet: click "Apply and listen".') : null,
            h('div', { class: 'dim' }, `Scenes with audio adjustments: ${(E.get().sound || []).length}`));
        }
    } else {
      body.push(h('div', { class: 'sedit-hint' }, 'Moving a cut keeps audio in place; scenes around the cut speed up or slow down slightly (up to 1.5 s).'),
        h('div', { class: 'sedit-row' }, b('◀ Previous cut', 'The first scene change before this point', () => goCut(-1)), b('Next cut ▶', 'The first scene change after this point', () => goCut(1))));
      if (!cut) body.push(h('div', { class: 'dim' }, 'Find a cut.'));
      else {
        const fr = Math.round(cut.d * fps());
        body.push(h('div', { class: 'sedit-sel' }, h('b', {}, `${cut.from} → ${cut.to}`), h('span', { class: 'dim' }, ` · ${TC(cut.film)}` + (fr ? ` · ${fr > 0 ? '+' : ''}${fr} frames` : ''))),
          h('div', { class: 'sedit-row' },
            b('−5 frames', 'Move cut 5 frames earlier', () => moveCut(-5)), b('−1', '1 frame earlier', () => moveCut(-1)),
            b('+1', '1 frame later', () => moveCut(1)), b('+5 frames', 'Move cut 5 frames later', () => moveCut(5)),
            b('▶ Play', 'Play 3 s starting 1.5 s before the cut (with sound)', () => playCut()),
            fr ? b('↺', 'Restore the cut\'s original position', () => { change(() => E.cutReset(cut.at)); cut.d = 0; cut.film = cut.at; src.currentTime = cut.film + 0.5 / fps(); paint(); }, 'danger') : null),
          ...trPanel());
      }
    }
    panel.innerHTML = '';
    panel.append(
      h('div', { class: 'sedit-head' }, h('b', {}, 'Edit scene'), mode === 'cut' ? h('span', { class: 'dim' }, 'whole film') : scopeSel, h('span', { class: 'spacer' }), b('✕', 'Close (Esc)', () => close(), 'ghost')),
      h('div', { class: 'segs sedit-seg' },
        [['cam', '🎥 Camera', 'Camera angle'], ['obj', '📦 Object', 'Move / rotate / hide an object'], ['ovl', '🔤 Screen', 'Screen text and drawings: move / enlarge / hide'], ['cut', '✂️ Cut', 'Move a scene cut or choose a transition type'], ['snd', '🔊 Sound', 'Music / effects / voice levels per scene']]
          .filter(([m]) => (m !== 'ovl' || caps().overlays) && (m !== 'snd' || (caps().sound && E.soundSet))).map(([m, l, t]) => b(l, t, () => setMode(m), 'seg' + (mode === m ? ' on' : '')))),
      ...body.filter(Boolean),
      h('div', { class: 'sedit-foot dim' },
        `In this scope: ${here.camera ? 'camera ✓ · ' : ''}${nObj} objects · ${nOv} screen items · ${nAll} scenes adjusted · ${nCut} cuts`,
        h('span', { class: 'spacer' }), b('↶ Undo', 'Ctrl+Z', () => { if (back()) history?.undone?.(); }, 'ghost'),
        h('span', {}, savedAt && Date.now() - savedAt < 4000 ? ' · saved ✓' : '')));
  }
  const describeTweak = (t) => [t.dp && `moved (${t.dp.map((n) => n.toFixed(2)).join(', ')})`, t.ry && `${t.ry}°`, t.s && `×${t.s.toFixed(2)}`, t.hide && 'hidden'].filter(Boolean).join(' · ');

  // another moment: the free camera starts again from that shot's own camera, boxes follow
  function onSeek() {
    if (!open || drag) return;
    if (mode === 'cam') { E.freeStop(); E.freeStart(); }
    if (mode === 'ovl') { refreshItems(); if (osel && !items.some((i) => i.id === osel)) osel = null; }
    if (mode === 'snd') findSndShot();
    draw(); paint();
  }
  src.addEventListener('loadedmetadata', check);
  src.addEventListener('seeked', onSeek);
  return { el: btn, check, close, isOpen: () => open, undo: () => (open && E ? back(true) : false), syncSound, destroy() { close(true); src.removeEventListener('loadedmetadata', check); src.removeEventListener('seeked', onSeek); } };
}
