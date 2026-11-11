// "🧩 2D layers" on the live preview (Nov 6, the user: "I need more control in 2D").
// Pages with window.VH2D (engine-hooks/vh2d.js: the 3D studio's 2D films, spotlight template2d) draw what is edited
// here on every frame, previews and renders alike:
//   items   pictures, texts, boxes, circles, arrows added over the film, each with its own time span and fades
//   actors  the film's characters (drawn through the engine's actor()): moved, scaled or hidden, in one shot or the film
// Everything is saved at once to the film's tweaks.json ("items2d", "actors2d"); no code change, no Claude.
import { h, api, toast, confirmBox } from '../app.js';

const TC = (s) => { s = Math.max(0, +s || 0); const m = Math.floor(s / 60); return `${m}:${(s - m * 60).toFixed(2).padStart(5, '0')}`; };
const parseTC = (v) => { const m = /^(?:(\d+):)?(\d+(?:[.,]\d+)?)$/.exec(String(v).trim()); return m ? (+(m[1] || 0)) * 60 + +m[2].replace(',', '.') : null; };
const FONTS = ['', 'Montserrat', 'Impact', 'Arial Black', 'Segoe UI', 'Bahnschrift', 'Georgia', 'Consolas'];
const KIND_TR = { image: 'Image', text: 'Text', rect: 'Box', ellipse: 'Circle', arrow: 'Arrow' };
const HS = 9;   // handle size (screen px)

// history: { push(tag), undone() } = review.js's undo router (Ctrl+Z is routed there then; undone(): the panel's ↶
// took the newest 2D step); keysActive(): false while the timeline
// is the active area (Delete / arrows / Esc belong to it then)
export function createEdit2d({ src, projectId, frame, panelHost, onOpen, onClose, range, scenes, time, dur, history, keysActive }) {
  const btn = h('button', { hidden: true, title: 'Add images, text and shapes to a 2D film; move, resize and hide characters. Preview and render use the same settings (tweaks.json).', onclick: () => (open ? close() : start()) }, '🧩 2D layers');
  const cv = h('canvas', { class: 'sedit-cv' }), ov = h('div', { class: 'sedit-ov e2d-ov', tabindex: '-1' }, cv), panel = h('div', { class: 'sedit-panel e2d-panel' });
  let open = false, V = null, sel = null, actSel = null, drag = null, undo = [], pending = null, saveTimer = 0, scope = 'shot', newSpan = 'scene', listAll = false;
  const fileIn = h('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp,image/gif', hidden: true, onchange: () => { const f = fileIn.files[0]; fileIn.value = ''; if (f) addImage(f); } });
  panel.append(fileIn);

  const page = () => { try { return src.win || null; } catch { return null; } };
  const vh = () => page()?.VH2D || null;
  const W = () => src.info?.w || 1920, H = () => src.info?.h || 1080;
  const data = () => V?.data() || { items2d: [], actors2d: {} };
  const items = () => (data().items2d = data().items2d || []);
  const actorsTw = () => (data().actors2d = data().actors2d || {});
  const now = () => +time() || 0;
  const redraw = () => { try { src.currentTime = src.currentTime; } catch { } setTimeout(draw, 30); };
  function check() { V = vh(); btn.hidden = !V; if (open && !V) close(true); }

  function start() {
    V = vh(); if (!V) return;
    open = true; btn.classList.add('on'); src.pause?.();
    frame.append(ov); (panelHost || frame).append(panel); undo = []; pending = null; sel = null; actSel = null; onOpen?.();
    window.addEventListener('keydown', onKey, true);
    paint(); draw(); ov.focus();
  }
  function close(silent) {
    if (!open) return;
    open = false; btn.classList.remove('on'); ov.remove(); panel.remove(); sel = null; actSel = null;
    window.removeEventListener('keydown', onKey, true);
    flush(); onClose?.(); if (!silent) redraw();
  }

  // ---- coordinates: film px ↔ overlay px
  const R = () => ov.getBoundingClientRect();
  const toFilm = (e) => { const r = R(); return { x: (e.clientX - r.left) / r.width * W(), y: (e.clientY - r.top) / r.height * H() }; };
  const sx = () => R().width / W();

  // ---- what is on screen now
  const visible = () => (V ? V.itemsAt(now()) : []);
  const itemById = (id) => items().find((x) => x.id === id);
  function corners(it) {
    const b = V.box(it, now()), a = (b.rot * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
    return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([u, v]) => ({ x: b.x + (u * b.w / 2) * c - (v * b.h / 2) * s, y: b.y + (u * b.w / 2) * s + (v * b.h / 2) * c }));
  }
  function rotHandle(it) { const b = V.box(it, now()), a = (b.rot * Math.PI) / 180, d = b.h / 2 + 40 / sx(); return { x: b.x + Math.sin(a) * d, y: b.y - Math.cos(a) * d }; }
  function inside(it, p) {
    const b = V.box(it, now()), a = (-b.rot * Math.PI) / 180, dx = p.x - b.x, dy = p.y - b.y;
    const u = dx * Math.cos(a) - dy * Math.sin(a), v = dx * Math.sin(a) + dy * Math.cos(a);
    return Math.abs(u) <= b.w / 2 + 6 / sx() && Math.abs(v) <= b.h / 2 + 6 / sx();
  }
  const actors = () => (V ? V.actors() : []);
  const actorAt = (p) => actors().slice().reverse().find((a) => Math.abs(p.x - a.x) < Math.max(18 / sx(), a.h * 0.22) && p.y <= a.y + 14 / sx() && p.y >= a.y - a.h - 10 / sx()) || null;

  function draw() {
    if (!open) return;
    const r = R(); cv.width = Math.round(r.width); cv.height = Math.round(r.height);
    const g = cv.getContext('2d'), k = sx();
    g.clearRect(0, 0, cv.width, cv.height);
    // characters: a bracket from the feet up, named
    g.font = '600 11px Segoe UI'; g.textBaseline = 'bottom';
    for (const a of actors()) {
      const on = actSel && actSel.key === a.key && actSel.shot === a.shot;
      g.strokeStyle = on ? '#e6c14d' : a.hidden ? 'rgba(232,84,84,.8)' : 'rgba(96,156,255,.85)'; g.lineWidth = on ? 2 : 1.3; g.setLineDash(a.hidden ? [4, 4] : []);
      const x = a.x * k, y = a.y * k, hh = a.h * k, w2 = Math.max(10, hh * 0.18);
      g.strokeRect(x - w2, y - hh, w2 * 2, hh); g.setLineDash([]);
      g.fillStyle = 'rgba(10,12,16,.75)'; const label = `${a.label}${a.hidden ? ' (hidden)' : ''}`; const tw = g.measureText(label).width + 8;
      g.fillRect(x - w2, y - hh - 16, tw, 15); g.fillStyle = on ? '#e6c14d' : '#cfe0ff'; g.fillText(label, x - w2 + 4, y - hh - 2);
    }
    // items: their boxes; the selected one with handles
    for (const it of visible()) {
      const c = corners(it).map((p) => ({ x: p.x * k, y: p.y * k })), on = it.id === sel;
      g.strokeStyle = on ? '#e6c14d' : 'rgba(255,255,255,.55)'; g.lineWidth = on ? 2 : 1; g.setLineDash(on ? [] : [5, 4]);
      g.beginPath(); c.forEach((p, i) => (i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y))); g.closePath(); g.stroke(); g.setLineDash([]);
      if (on) {
        g.fillStyle = '#e6c14d';
        for (const p of c) g.fillRect(p.x - HS / 2, p.y - HS / 2, HS, HS);
        const rh = rotHandle(it); g.beginPath(); g.arc(rh.x * k, rh.y * k, HS / 1.6, 0, Math.PI * 2); g.fill();
      }
    }
  }

  // ---- pointer: move / scale / rotate an item, move a character, wheel = size
  ov.addEventListener('pointerdown', (e) => {
    if (!V) return;
    try { ov.setPointerCapture(e.pointerId); } catch { }
    ov.focus();
    const p = toFilm(e), it = sel && itemById(sel);
    if (it && visible().includes(it)) {
      const rh = rotHandle(it);
      if (Math.hypot(p.x - rh.x, p.y - rh.y) < 12 / sx()) { snap(); drag = { kind: 'rot', it, b: V.box(it, now()) }; return; }
      const ci = corners(it).findIndex((c) => Math.hypot(p.x - c.x, p.y - c.y) < 10 / sx());
      if (ci >= 0) { snap(); drag = { kind: 'scale', it, p0: p, w0: it.w, h0: it.h, size0: it.size, keep: it.kind !== 'rect' && it.kind !== 'ellipse' || e.shiftKey }; return; }
    }
    const hit = visible().slice().reverse().find((x) => inside(x, p));
    if (hit) { sel = hit.id; actSel = null; snap(); drag = { kind: 'move', it: hit, p0: p, x0: hit.x, y0: hit.y }; paint(); draw(); return; }
    const a = actorAt(p);
    if (a) {
      sel = null; actSel = { key: a.key, shot: a.shot, label: a.label };
      const tw = actorTw(a, true); snap();
      // screen → world: the page reports how many frame px one world unit is at this character (a.k)
      const kWorld = +a.k > 0 ? +a.k : 1;
      drag = { kind: 'actor', a, p0: p, dx0: tw.dx || 0, dy0: tw.dy || 0, kWorld };
      paint(); draw(); return;
    }
    sel = null; actSel = null; paint(); draw();
  });
  ov.addEventListener('pointermove', (e) => {
    if (!drag) { const p = toFilm(e); ov.style.cursor = visible().some((x) => inside(x, p)) || actorAt(p) ? 'move' : 'default'; return; }
    const p = toFilm(e);
    if (drag.kind === 'move') { drag.it.x = Math.round(drag.x0 + p.x - drag.p0.x); drag.it.y = Math.round(drag.y0 + p.y - drag.p0.y); }
    else if (drag.kind === 'scale') {
      const b = V.box(drag.it, now()), d0 = Math.hypot(drag.p0.x - b.x, drag.p0.y - b.y) || 1, d1 = Math.hypot(p.x - b.x, p.y - b.y), k = Math.max(0.05, d1 / d0);
      drag.it.w = Math.max(4, Math.round(drag.w0 * k)); drag.it.h = Math.max(4, Math.round(drag.h0 * k));
      if (drag.it.kind === 'text') drag.it.size = Math.max(6, Math.round((drag.size0 || 72) * k));
    } else if (drag.kind === 'rot') {
      let deg = (Math.atan2(p.y - drag.b.y, p.x - drag.b.x) * 180) / Math.PI + 90;
      if (e.shiftKey) deg = Math.round(deg / 15) * 15;
      drag.it.rot = Math.round(deg * 10) / 10;
    } else if (drag.kind === 'actor') {
      const tw = actorTw(drag.a, true);
      tw.dx = Math.round(drag.dx0 + (p.x - drag.p0.x) / drag.kWorld); tw.dy = Math.round(drag.dy0 + (p.y - drag.p0.y) / drag.kWorld);
    }
    redraw();
  });
  ov.addEventListener('pointerup', () => { if (drag) { drag = null; changed(); } });
  ov.addEventListener('wheel', (e) => {
    e.preventDefault();
    const k = e.deltaY < 0 ? 1.06 : 1 / 1.06, it = sel && itemById(sel);
    if (it) { snap(); it.w = Math.max(4, Math.round(it.w * k)); it.h = Math.max(4, Math.round(it.h * k)); if (it.kind === 'text') it.size = Math.max(6, Math.round((it.size || 72) * k)); changed(); }
    else if (actSel) { const a = actors().find((x) => x.key === actSel.key && x.shot === actSel.shot) || actSel; const tw = actorTw(a, true); snap(); tw.s = Math.round((tw.s || 1) * k * 1000) / 1000; changed(); }
  }, { passive: false });

  // the tweak of a character in the chosen scope ("this shot" or "*")
  function actorTw(a, make) {
    const key = `${scope === 'all' ? '*' : a.shot}|${a.key}`, A = actorsTw();
    if (!A[key] && make) A[key] = {};
    return A[key] || {};
  }

  function onKey(e) {
    if (e.target.matches?.('input, textarea, select')) return;
    const it = sel && itemById(sel);
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { if (history) return; e.preventDefault(); e.stopImmediatePropagation(); back(); return; }
    if (keysActive && !keysActive() && (e.key === 'Escape' || e.key.startsWith('Arrow') || e.key === 'Delete' || e.key === 'Backspace')) return;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'd' && it) { e.preventDefault(); e.stopImmediatePropagation(); duplicate(it); return; }
    if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); if (sel || actSel) { sel = null; actSel = null; paint(); draw(); } else close(); return; }
    if ((e.key === 'Delete' || e.key === 'Backspace') && it) { e.preventDefault(); e.stopImmediatePropagation(); remove(it); return; }
    if (e.key.startsWith('Arrow') && (it || actSel)) {
      e.preventDefault(); e.stopImmediatePropagation(); snap();
      const n = e.shiftKey ? 10 : 1, d = { ArrowLeft: [-n, 0], ArrowRight: [n, 0], ArrowUp: [0, -n], ArrowDown: [0, n] }[e.key];
      if (it) { it.x += d[0]; it.y += d[1]; } else { const a = actors().find((x) => x.key === actSel.key && x.shot === actSel.shot) || actSel; const tw = actorTw(a, true); tw.dx = (tw.dx || 0) + d[0]; tw.dy = (tw.dy || 0) + d[1]; }
      changed();
    }
  }

  // ---- changes: undo snapshot, redraw, save shortly after
  // snap() only notes the state before an edit; changed() records the undo step (and the router tag) only when the
  // state really differs, so a plain select click leaves no step and every '2d' tag matches exactly one snapshot
  const state = () => JSON.stringify({ items2d: items(), actors2d: actorsTw() });
  function snap() { if (pending == null) pending = state(); }
  function commit() {
    if (pending == null) return;
    const s0 = pending; pending = null;
    if (s0 === state()) return;
    undo.push(s0); if (undo.length > 100) undo.shift(); history?.push('2d');
  }
  function back(quiet) {
    pending = null;
    const s = undo.pop();
    if (!s) { if (!quiet) toast('Nothing to undo'); return false; }
    const j = JSON.parse(s); data().items2d = j.items2d; data().actors2d = j.actors2d;
    if (sel && !itemById(sel)) sel = null;
    changed(true); return true;
  }
  function changed() { commit(); paint(); redraw(); clearTimeout(saveTimer); saveTimer = setTimeout(save, 500); }
  async function save() {
    saveTimer = 0;
    try {
      // tidy actor tweaks that are back to nothing
      for (const [k, v] of Object.entries(actorsTw())) if (!v.hide && !(+v.dx) && !(+v.dy) && (v.s == null || Math.abs(v.s - 1) < 1e-3)) delete actorsTw()[k];
      // only the 2D keys: everything else in tweaks.json stays as the other editors saved it
      await api(`/api/project/${projectId}/tweaks`, { method: 'PATCH', body: { items2d: items(), actors2d: actorsTw() } });
    } catch (e) { toast('Could not save 2D layers: ' + e.message, true); }
  }
  function flush() { if (saveTimer) { clearTimeout(saveTimer); save(); } }

  // ---- adding
  function spanForNew() {
    const t = now(), D = dur() || 1e6;
    if (newSpan === 'range') { const r = range(); if (r) return [r[0], r[1]]; toast('Select a range first (I and O); added to this scene'); }
    if (newSpan === 'scene' || newSpan === 'range') { const sc = (scenes() || []).find((s) => t >= s.t0 && t < s.t1); if (sc) return [sc.t0, sc.t1]; }
    if (newSpan === 'film') return [0, null];
    return [t, Math.min(D, t + 3)];
  }
  const newId = () => 'i' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
  function add(kind, extra = {}) {
    const [t0, t1] = spanForNew(), w = W(), hh = H();
    // no fade-in on the film's first frame: alpha would be 0 at 0:00.00 (shown, selectable, but not drawn)
    const base = { id: newId(), kind, name: '', t0: +t0.toFixed(3), t1: t1 == null ? null : +(+t1).toFixed(3), fin: t0 > 0.02 ? 0.25 : 0, fout: 0.25, anim: 'none', x: Math.round(w / 2), y: Math.round(hh / 2), rot: 0, op: 1 };
    const def = {
      text: { w: Math.round(w * 0.5), h: Math.round(hh * 0.12), text: 'Text', size: Math.round(Math.min(w, hh) * 0.075), weight: 800, color: '#ffffff', stroke: '#000000', strokeW: 0.16, shadow: true, align: 'center', font: '' },
      rect: { w: Math.round(w * 0.3), h: Math.round(hh * 0.2), fill: 'rgba(0,0,0,0.55)', line: null, lineW: 0, radius: 24 },
      ellipse: { w: Math.round(Math.min(w, hh) * 0.3), h: Math.round(Math.min(w, hh) * 0.3), fill: null, line: '#ff3b3b', lineW: 10 },
      arrow: { w: Math.round(w * 0.22), h: Math.round(hh * 0.06), line: '#ff3b3b', lineW: 16 },
      image: { w: 400, h: 300 },
    }[kind];
    snap();
    const it = { ...base, ...def, ...extra };
    items().push(it); sel = it.id; actSel = null; changed(true);
    return it;
  }
  async function addImage(f) {
    if (f.size > 25 * 1024 * 1024) return toast('Image is larger than 25 MB', true);
    const dataUrl = await new Promise((ok) => { const rd = new FileReader(); rd.onload = () => ok(rd.result); rd.readAsDataURL(f); });
    try {
      const r = await api(`/api/project/${projectId}/asset2d`, { method: 'POST', body: { name: f.name, data: dataUrl } });
      const img = await new Promise((ok) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => ok(null); i.src = dataUrl; });
      const ar = img ? img.naturalWidth / img.naturalHeight : 4 / 3, w = Math.round(Math.min(W() * 0.35, (img?.naturalWidth || 600))), hh = Math.round(w / ar);
      add('image', { src: r.src, w, h: hh, name: f.name.replace(/\.[^.]+$/, '') });
    } catch (e) { toast('Could not add image: ' + e.message, true); }
  }
  function duplicate(it) { snap(); const d = { ...it, id: newId(), x: it.x + 30, y: it.y + 30 }; items().push(d); sel = d.id; changed(true); }
  async function remove(it) {
    if (!await confirmBox('Delete layer', h('div', {}, `Delete ${KIND_TR[it.kind]} "${it.name || it.text || ''}"? (Undo with Ctrl+Z)`), 'Delete')) return;
    snap(); data().items2d = items().filter((x) => x !== it); sel = null; changed(true);
  }
  function order(it, d) { const L = items(), i = L.indexOf(it), j = i + d; if (j < 0 || j >= L.length) return; snap(); [L[i], L[j]] = [L[j], L[i]]; changed(true); }

  // ---- the panel
  function paint() {
    if (!open) return;
    panel.innerHTML = ''; panel.append(fileIn);
    const t = now(), vis = visible();
    panel.append(h('div', { class: 'sedit-head' }, h('b', {}, '🧩 2D layers'), h('span', { class: 'spacer' }),
      h('button', { class: 'ghost', title: 'Undo (Ctrl+Z)', onclick: () => { if (back()) history?.undone?.(); }, disabled: !undo.length }, '↶'),
      h('button', { class: 'ghost', onclick: () => close() }, 'Close')));
    panel.append(h('div', { class: 'sedit-row' },
      h('span', { class: 'dim' }, 'Add:'),
      h('button', { onclick: () => fileIn.click() }, '🖼 Image'), h('button', { onclick: () => add('text') }, '🔤 Text'),
      h('button', { onclick: () => add('rect') }, '▭ Box'), h('button', { onclick: () => add('ellipse') }, '◯ Circle'), h('button', { onclick: () => add('arrow') }, '➜ Arrow')));
    panel.append(h('div', { class: 'sedit-row' }, h('span', { class: 'dim' }, 'Show new layer:'),
      h('select', { onchange: (e) => { newSpan = e.target.value; e.target.blur(); } },
        [['scene', 'Throughout this scene'], ['range', 'Selected range (I/O)'], ['here', 'For 3 s from here'], ['film', 'Entire film']].map(([v, l]) => h('option', { value: v, selected: newSpan === v }, l)))));
    const it = sel && itemById(sel);
    if (it) panel.append(itemPanel(it));
    else if (actSel) panel.append(actorPanel());
    else panel.append(h('div', { class: 'sedit-hint' }, 'Click a layer or character in the preview: drag = move, corner = resize, top circle = rotate (Shift: 15°), wheel = size, arrows = 1 px (Shift 10), Del = delete, Ctrl+D = duplicate.'));
    // the list: what is on screen now (or every item)
    const L = listAll ? items() : vis;
    panel.append(h('div', { class: 'sedit-row' }, h('b', {}, listAll ? `All layers (${items().length})` : `Visible now (${vis.length}/${items().length})`), h('span', { class: 'spacer' }),
      h('button', { class: 'ghost', onclick: () => { listAll = !listAll; paint(); } }, listAll ? 'Only current' : 'Show all')));
    const list = h('div', { class: 'e2d-list' });
    for (const x of L.slice().reverse()) list.append(h('div', { class: 'e2d-li' + (x.id === sel ? ' on' : '') + (x.hide ? ' off' : ''), onclick: () => { sel = x.id; actSel = null; if (!(t >= x.t0 && t <= (x.t1 ?? 1e9))) { try { src.currentTime = x.t0 + 0.01; } catch { } } paint(); setTimeout(draw, 60); } },
      h('span', {}, KIND_TR[x.kind]), h('b', {}, x.name || (x.kind === 'text' ? String(x.text || '').slice(0, 24) : '')), h('span', { class: 'spacer' }), h('span', { class: 'dim mono' }, `${TC(x.t0)}–${x.t1 == null ? 'end' : TC(x.t1)}`)));
    if (!L.length) list.append(h('div', { class: 'dim' }, listAll ? 'No layers yet.' : 'No layers visible right now.'));
    panel.append(list);
    const hidden = Object.entries(actorsTw()).filter(([, v]) => v.hide || v.dx || v.dy || (v.s && v.s !== 1));
    if (hidden.length) panel.append(h('div', { class: 'sedit-foot' }, `Character changes: ${hidden.length}`, h('span', { class: 'spacer' }),
      h('button', { class: 'ghost', onclick: () => { snap(); data().actors2d = {}; changed(true); } }, 'Reset all')));
  }

  function field(label, input) { return h('label', { class: 'e2d-f' }, h('span', { class: 'dim' }, label), input); }
  function itemPanel(it) {
    const set = (k, v, live = false) => { snap(); it[k] = v; live ? redraw() : changed(true); };
    const box = h('div', { class: 'sedit-sel e2d-props' });
    box.append(h('div', { class: 'sedit-row' }, h('b', {}, KIND_TR[it.kind]),
      h('input', { type: 'text', value: it.name || '', placeholder: 'name (shown in list)', style: { flex: 1 }, onchange: (e) => set('name', e.target.value) })));
    if (it.kind === 'text') {
      box.append(h('textarea', { rows: 2, style: { width: '100%' }, value: it.text || '', oninput: (e) => { snap(); it.text = e.target.value; redraw(); }, onchange: () => changed() }),
        h('div', { class: 'sedit-row' },
          field('Font', h('select', { onchange: (e) => { set('font', e.target.value); e.target.blur(); } }, FONTS.map((f) => h('option', { value: f, selected: (it.font || '') === f }, f || 'Film font')))),
          field('Size', h('input', { type: 'number', min: 6, max: 600, value: it.size, style: { width: '58px' }, onchange: (e) => set('size', +e.target.value) })),
          field('Weight', h('select', { onchange: (e) => { set('weight', +e.target.value); e.target.blur(); } }, [400, 600, 800, 900].map((w) => h('option', { value: w, selected: +it.weight === w }, w))))),
        h('div', { class: 'sedit-row' },
          field('Color', h('input', { type: 'color', value: hex(it.color, '#ffffff'), onchange: (e) => set('color', e.target.value) })),
          field('Outline', h('input', { type: 'color', value: hex(it.stroke, '#000000'), onchange: (e) => set('stroke', e.target.value) })),
          field('Outline width', h('input', { type: 'range', min: 0, max: 40, value: Math.round((it.strokeW || 0) * 100), oninput: (e) => set('strokeW', +e.target.value / 100, true), onchange: () => changed() })),
          field('Shadow', h('input', { type: 'checkbox', checked: !!it.shadow, onchange: (e) => set('shadow', e.target.checked) }))));
    }
    if (it.kind === 'rect' || it.kind === 'ellipse' || it.kind === 'arrow') {
      box.append(h('div', { class: 'sedit-row' },
        it.kind !== 'arrow' ? field('Fill', h('input', { type: 'color', value: hex(it.fill, '#000000'), onchange: (e) => set('fill', e.target.value) })) : null,
        it.kind !== 'arrow' ? field('No fill', h('input', { type: 'checkbox', checked: !it.fill, onchange: (e) => set('fill', e.target.checked ? null : '#000000') })) : null,
        field('Line', h('input', { type: 'color', value: hex(it.line, '#ff3b3b'), onchange: (e) => set('line', e.target.value) })),
        field('Line width', h('input', { type: 'number', min: 0, max: 200, value: it.lineW || 0, style: { width: '54px' }, onchange: (e) => set('lineW', +e.target.value) })),
        it.kind === 'rect' ? field('Corner', h('input', { type: 'number', min: 0, max: 500, value: it.radius || 0, style: { width: '54px' }, onchange: (e) => set('radius', +e.target.value) })) : null));
    }
    box.append(h('div', { class: 'sedit-row' },
      field('Opacity', h('input', { type: 'range', min: 0, max: 100, value: Math.round((it.op ?? 1) * 100), oninput: (e) => set('op', +e.target.value / 100, true), onchange: () => changed() })),
      field('Angle', h('input', { type: 'number', step: 1, value: Math.round(it.rot || 0), style: { width: '54px' }, onchange: (e) => set('rot', +e.target.value) })),
      field('Entrance', h('select', { onchange: (e) => { set('anim', e.target.value); e.target.blur(); } }, [['none', 'Fade'], ['pop', 'Pop']].map(([v, l]) => h('option', { value: v, selected: (it.anim || 'none') === v }, l))))));
    const t0In = h('input', { type: 'text', value: TC(it.t0), style: { width: '70px' }, onchange: (e) => { const v = parseTC(e.target.value); if (v != null) set('t0', v); else e.target.value = TC(it.t0); } });
    const t1In = h('input', { type: 'text', value: it.t1 == null ? '' : TC(it.t1), placeholder: 'end', style: { width: '70px' }, onchange: (e) => { const v = e.target.value.trim() ? parseTC(e.target.value) : null; if (v == null && e.target.value.trim()) { e.target.value = TC(it.t1); return; } set('t1', v); } });
    box.append(h('div', { class: 'sedit-row' }, field('Start', t0In), field('End', t1In),
      field('Fade in', h('input', { type: 'number', min: 0, max: 10, step: 0.05, value: it.fin || 0, style: { width: '52px' }, onchange: (e) => set('fin', +e.target.value) })),
      field('Fade out', h('input', { type: 'number', min: 0, max: 10, step: 0.05, value: it.fout || 0, style: { width: '52px' }, onchange: (e) => set('fout', +e.target.value) }))));
    box.append(h('div', { class: 'sedit-row' },
      h('button', { class: 'ghost', title: 'Set start to playhead', onclick: () => set('t0', +now().toFixed(3)) }, '⇤ start now'),
      h('button', { class: 'ghost', title: 'Set end to playhead', onclick: () => set('t1', +Math.max(it.t0 + 0.1, now()).toFixed(3)) }, 'end now ⇥'),
      h('button', { class: 'ghost', onclick: () => { const sc = (scenes() || []).find((s) => now() >= s.t0 && now() < s.t1); if (!sc) return toast('No scene list'); snap(); it.t0 = sc.t0; it.t1 = sc.t1; changed(true); } }, 'this scene'),
      h('button', { class: 'ghost', onclick: () => { const r = range(); if (!r) return toast('Select a range with I and O first'); snap(); it.t0 = r[0]; it.t1 = r[1]; changed(true); } }, 'range'),
      h('button', { class: 'ghost', onclick: () => { snap(); it.t0 = 0; it.t1 = null; changed(true); } }, 'entire film')));
    box.append(h('div', { class: 'sedit-row' },
      h('button', { class: 'ghost', title: 'Bring forward', onclick: () => order(it, 1) }, '▲ forward'), h('button', { class: 'ghost', title: 'Send backward', onclick: () => order(it, -1) }, '▼ backward'),
      h('button', { class: 'ghost', onclick: () => set('hide', !it.hide) }, it.hide ? '👁 show' : '🙈 hide'),
      h('button', { class: 'ghost', onclick: () => duplicate(it) }, '⧉ duplicate'),
      h('button', { class: 'ghost danger', onclick: () => remove(it) }, '🗑 delete')));
    return box;
  }
  function actorPanel() {
    const a = actors().find((x) => x.key === actSel.key && x.shot === actSel.shot) || actSel, tw = actorTw(a, false);
    const sOut = h('span', { class: 'tl2-lval' }, Math.round((tw.s || 1) * 100) + '%');
    return h('div', { class: 'sedit-sel e2d-props' },
      h('div', { class: 'sedit-row' }, h('b', {}, '🧍 ' + a.label), h('span', { class: 'dim mono' }, a.key)),
      h('div', { class: 'sedit-row' }, h('span', { class: 'dim' }, 'Apply change to:'),
        h('select', { onchange: (e) => { scope = e.target.value; e.target.blur(); paint(); } },
          h('option', { value: 'shot', selected: scope === 'shot' }, `This scene (${a.shot || '?'})`), h('option', { value: 'all', selected: scope === 'all' }, 'Entire film'))),
      h('div', { class: 'sedit-row' }, 'Size', h('input', { type: 'range', min: 20, max: 300, value: Math.round((tw.s || 1) * 100), style: { flex: 1 },
        oninput: (e) => { snap(); const t = actorTw(a, true); t.s = +e.target.value / 100; sOut.textContent = e.target.value + '%'; redraw(); }, onchange: () => changed(true) }), sOut),
      h('div', { class: 'sedit-row' },
        h('button', { class: 'ghost', onclick: () => { snap(); const t = actorTw(a, true); t.hide = !t.hide; changed(true); } }, tw.hide ? '👁 show' : '🙈 hide in this scene'.replace('this scene', scope === 'all' ? 'the film' : 'this scene')),
        h('button', { class: 'ghost', onclick: () => { snap(); const k = `${scope === 'all' ? '*' : a.shot}|${a.key}`; delete actorsTw()[k]; changed(true); } }, '↺ reset')),
      h('div', { class: 'sedit-hint' }, 'Drag = move, wheel = resize, arrows = fine adjustment. Characters are edited through the 2D engine\'s robot drawing; figures drawn manually outside the engine do not appear in the list.'));
  }
  const hex = (c, d) => (typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c) ? c : d);

  const onSeek = () => { if (open) { paint(); setTimeout(draw, 40); } };
  src.addEventListener('loadedmetadata', check);
  src.addEventListener('seeked', onSeek);
  const ro = new ResizeObserver(() => draw()); ro.observe(frame);
  return { el: btn, check, close, isOpen: () => open, undo: () => (open ? back(true) : false), destroy() { close(true); ro.disconnect(); src.removeEventListener('loadedmetadata', check); src.removeEventListener('seeked', onSeek); } };
}
