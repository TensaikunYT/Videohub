// Multi-track timeline (P3a): a ruler on top, then one row per track with a DOM header on the left (name; a click
// collapses the row, remembered in localStorage 'vh-tl-rows') and a canvas on the right, and an overview bar of the
// whole film at the bottom (its window = the view: drag pans, drag an edge zooms). Rows (ui/review/tracks.js):
// Picture (film strip) · Film audio · Scenes · Notes · Text · Voice / Music / Effects stems (+ extra stems, SFX cues)
// · Added music / Added effects (clip lanes). Waveforms come from peaks (/api/media/peaks) and fall back to the PNGs.
// Ruler: ticks, render chunks, changed ranges, the I/O range (two diamonds; click = jump to that frame), playhead;
// press/drag there pauses and scrubs. Notes are picked only in their own row (close notes merge into one marker with a
// count; clicking it again steps through them), so scrubbing never lands on a note by accident.
// Ctrl+wheel zooms at the pointer (plain wheel too, over the ruler), Shift+wheel pans, plain wheel scrolls the rows;
// double-click shows the whole film. The view (zoom/pan/follow) lives in tlview.js; its buttons are in the transport.
import { h } from '../app.js';
import { createView } from './tlview.js';
import { ls } from './dock.js';
import { buildRows, tickSpec, fmtTick, clipLen, assignLane, findDragSnap, snapEdgeTime, edgeScrollStep } from './tracks.js';

const STATUS_COLOR = { 'open': '#e6c14d', claude: '#f08a3c', 'fixed': '#46c480', 'approved': '#3a7d58', 'reopened': '#e85454' };
const RULER = 24, PLAY = '#ff5c6c', ROWS_KEY = 'vh-tl-rows';
const HINT = 'Ctrl+wheel: zoom · Shift+wheel: pan · wheel on ruler: zoom · double-click: whole film';
// scene lane colours (cycled); a scene's set name keeps its colour when the film comes back to it
const SCENE_COLORS = ['#3d5a8c', '#7a4f8c', '#3d7a63', '#8c6a3d', '#8c3d4f', '#3d7a85', '#6a7a3d', '#5a4f8c'];
const mmss = s => { s = Math.max(0, s); const m = Math.floor(s / 60), r = Math.floor(s % 60); return `${m}:${String(r).padStart(2, '0')}`; };
const tcs = s => `${mmss(s)}.${String(Math.floor((Math.max(0, s) % 1) * 100)).padStart(2, '0')}`;

export function createTimeline(ctx) {
  // ---- DOM
  const rcv = h('canvas', { class: 'tl2-ruler', title: HINT }), rg = rcv.getContext('2d');
  const cv = h('canvas', { class: 'tl2' }), g = cv.getContext('2d');
  // the corner: the zoom readout (click = whole film), or the sound build's state when there is one (setStatus)
  const cornerTxt = h('span', { class: 'tl2-ctxt' }), cornerStat = h('span', { class: 'tl2-cstat', hidden: true });
  const corner = h('div', { class: 'tl2-corner', title: 'Click: whole film · ' + HINT }, cornerStat, cornerTxt);
  const rulerRow = h('div', { class: 'tl2-rulerrow' }, corner, rcv);
  const heads = h('div', { class: 'tl2-heads' });
  const inner = h('div', { class: 'tl2-inner' }, heads, cv);
  const body = h('div', { class: 'tl2-body' }, inner);
  const ovWin = h('div', { class: 'tl2-ovwin' }), ovLab = h('span', { class: 'tl2-ovlab' }), ovHead = h('div', { class: 'tl2-ovhead' });
  const ovTrack = h('div', { class: 'tl2-ovtrack', title: 'Whole film: drag the window = pan, drag an edge = zoom, double-click = whole film' }, ovLab, ovWin, ovHead);
  const ov = h('div', { class: 'tl2-ov' }, h('div', { class: 'tl2-ovcorner' }), ovTrack);
  const el = h('div', { class: 'tl2-wrap' }, rulerRow, body, ov);
  // the tip lives in the editor's overlay host (position: fixed), so the dock's scroll box never clips it and it
  // shows in fullscreen; appended on first hover
  const tip = h('div', { class: 'tl2-tip', hidden: true }), tipCv = h('canvas', { width: 160, height: 90 }), tipTxt = h('div', {});
  tip.append(tipCv, tipTxt);

  // ---- state
  let strip = null, stripImg = null, waveImg = null, tr = null, layers = [], cues = null, scenes = [], selScene = -1;
  let mixer = null, clips = null, clipSel = null, clipHooks = {}, clipOps = null, clipDrag = null, clipHover = null, dragging = null, hoverX = null, hoverRow = null;
  let bands = [], bandOps = null, bandDrag = null, dropAt = null;   // P4: music-level bands on the Music row; a drop's target
  const layerImg = {}, peaks = new Map(), waveCache = new Map(), asked = new Set();
  let collapsed = new Set(ls.get(ROWS_KEY, []) || []), rows = [], H = 40, headEls = new Map();
  const dur = () => ctx.dur() || 1;
  const V = createView({ dur });
  const v = () => V.get();
  const offView = V.onChange(() => draw());
  // widths read only on resize: reading clientWidth while drawing every frame forced a reflow of the whole page
  // (10 ms per frame with ~100 note cards, enough to make the live preview drop frames)
  let cw = 600, dpr = 1;
  const W = () => cw;
  const tx = t => (t - v()[0]) / (v()[1] - v()[0]) * W();
  const xt = x => v()[0] + Math.max(0, Math.min(1, x / W())) * (v()[1] - v()[0]);
  const pps = () => W() / (v()[1] - v()[0]);
  const rowOf = id => rows.find(r => r.id === id) || null;
  const rowAt = y => rows.find(r => y >= r.y && y < r.y + r.h) || null;
  const colorOf = (sc, i) => { const k = sc.set || sc.name; let hsh = 0; for (const c of String(k)) hsh = (hsh * 31 + c.charCodeAt(0)) >>> 0; return SCENE_COLORS[(sc.set ? hsh : i) % SCENE_COLORS.length]; };
  const on = id => ctx.layerOn ? ctx.layerOn(id) : true;

  // ---- rows + headers
  function relayout(live = true) {   // live = false while being built: the caller's ctx (dur, time…) is not ready yet
    // an old clip without a lane gets one once (timestamp order); it is saved with it on the next real change
    if (clips) for (const c of clips.filter(q => !Number.isInteger(q.lane)).sort((p, q) => p.t - q.t)) c.lane = assignLane(clips, c, dur());
    rows = buildRows({ live: !!ctx.live, strip, scenes, transcript: tr, layers, cues, clips, canClips: !!clips, collapsed });
    H = Math.max(20, rows.reduce((s, r) => s + r.h, 0));
    heads.innerHTML = ''; headEls = new Map();
    for (const r of rows) {
      const name = h('span', { class: 'tl2-hname', title: (r.collapsed ? 'Expand: ' : 'Collapse: ') + r.label }, r.label);
      name.addEventListener('click', () => toggleRow(r.id));
      // an added-sound row: ➕ opens the picker with that kind (rows under 26 px have no buttons)
      const add = r.kind === 'clips' && clipOps?.pick && r.h >= 26 ? h('button', { class: 'tl2-hadd', title: r.clipKind === 'music' ? 'Add music (at the playhead)' : 'Add sound effect (at the playhead)', onclick: () => clipOps.pick(r.clipKind) }, '➕') : null;
      // P3c: M / S / level chip from the mixer (they update themselves); rows under 26 px have none
      const mx = mixer && r.header && r.h >= 26 ? mixer.controls(r.id) : null;
      const hd = h('div', { class: 'tl2-head' + (r.collapsed ? ' coll' : '') + (r.h < 26 ? ' small' : ''), 'data-id': r.id }, name, add || mx ? h('span', { class: 'tl2-hside' }, add, mx) : null);
      hd.style.height = r.h + 'px'; hd.style.setProperty('--c', r.color);
      heads.append(hd); headEls.set(r.id, { el: hd, off: false });
    }
    waveCache.clear();
    if (live) size();
  }
  function toggleRow(id) {
    collapsed.has(id) ? collapsed.delete(id) : collapsed.add(id);
    ls.set(ROWS_KEY, [...collapsed]); relayout();
  }
  function size() {
    dpr = devicePixelRatio || 1;
    el.style.setProperty('--tl-gut', Math.max(0, body.offsetWidth - body.clientWidth) + 'px');   // ruler/overview line up with the rows' canvas
    cw = Math.max(40, cv.clientWidth || 600);
    cv.width = Math.round(cw * dpr); cv.height = Math.round(H * dpr); cv.style.height = H + 'px'; g.setTransform(dpr, 0, 0, dpr, 0, 0);
    rcv.width = Math.round(cw * dpr); rcv.height = Math.round(RULER * dpr); rg.setTransform(dpr, 0, 0, dpr, 0, 0);
    waveCache.clear(); draw();
  }
  // the scrolling box: a vertical scrollbar appearing in it (or a dock resize) changes the canvas width
  const ro = new ResizeObserver(size); ro.observe(body);

  // ---- drawing
  function draw() { drawRuler(); drawRows(); drawOverview(); }

  function keys() {   // the range's keyframes: start at its first frame, end after its last frame
    const R = ctx.range(), fps = ctx.fps(), out = [];
    if (R.a != null) out.push({ which: 'a', frame: R.a, x: tx(R.a / fps) });
    if (R.b != null) out.push({ which: 'b', frame: R.b, x: tx((R.b + 1) / fps) });
    return out;
  }
  const KY = RULER - 7;
  function diamond(c, x, y) {
    const r = 5.5; c.beginPath(); c.moveTo(x, y - r); c.lineTo(x + r, y); c.lineTo(x, y + r); c.lineTo(x - r, y); c.closePath();
    c.fillStyle = '#ffd83d'; c.fill(); c.lineWidth = 1.2; c.strokeStyle = '#16171c'; c.stroke();
  }
  function drawRuler() {
    const w = W(), [a, b] = v(), p = pps(), fps = ctx.fps();
    rg.clearRect(0, 0, w, RULER); rg.fillStyle = '#121318'; rg.fillRect(0, 0, w, RULER);
    // changed ranges: a band along the bottom
    rg.fillStyle = 'rgba(96,156,255,.45)'; for (const [x, y] of ctx.changed() || []) rg.fillRect(tx(x), RULER - 4, Math.max(2, tx(y) - tx(x)), 4);
    // the I/O range: a band with bright sides (brighter while it loops)
    const K = keys();
    if (K.length === 2) {
      const lp = ctx.loopOn();
      rg.fillStyle = lp ? 'rgba(255,216,61,.24)' : 'rgba(255,216,61,.12)'; rg.fillRect(K[0].x, 0, Math.max(1, K[1].x - K[0].x), RULER);
      rg.globalAlpha = lp ? 1 : 0.7; rg.fillStyle = '#ffd83d'; rg.fillRect(K[0].x - 1, 0, 2, RULER); rg.fillRect(K[1].x - 1, 0, 2, RULER); rg.globalAlpha = 1;
    }
    // ticks
    const T = tickSpec(dur(), p, fps);
    rg.fillStyle = '#4a4d58';
    if (T.minor < T.major && T.minor * p >= 8) for (let i = Math.ceil(a / T.minor), n = 0; i * T.minor <= b && n < 4000; i++, n++) rg.fillRect(Math.round(tx(i * T.minor)), RULER - 5, 1, 5);
    rg.fillStyle = '#8c8f9c'; rg.font = '10px Segoe UI'; rg.textBaseline = 'top';
    for (let i = Math.ceil(a / T.major - 1e-9), n = 0; i * T.major <= b + 1e-9 && n < 1000; i++, n++) {
      const t = i * T.major, x = Math.round(tx(t)); rg.fillRect(x, RULER - 10, 1, 10); rg.fillText(fmtTick(t, fps, T.frames), x + 3, 2);
    }
    // render chunks: short marks at the bottom
    const cs = ctx.chunkSec();
    if (cs && cs * p > 7) { rg.fillStyle = 'rgba(140,200,255,.55)'; for (let t = Math.ceil(a / cs) * cs; t <= b; t += cs) rg.fillRect(tx(t), RULER - 7, 1, 7); }
    for (const k of K) diamond(rg, k.x, KY);
    if (hoverRow === 'ruler' && hoverX != null && !dragging) { rg.fillStyle = 'rgba(255,255,255,.35)'; rg.fillRect(hoverX, 0, 1, RULER); }
    // playhead flag
    const px = tx(ctx.time()); rg.fillStyle = PLAY; rg.fillRect(px - 1, 0, 2, RULER);
    rg.beginPath(); rg.moveTo(px - 6, 0); rg.lineTo(px + 6, 0); rg.lineTo(px + 6, 5); rg.lineTo(px, 10); rg.lineTo(px - 6, 5); rg.closePath(); rg.fill();
    rg.fillStyle = '#0b0c0f'; rg.fillRect(0, RULER - 1, w, 1);
  }

  function drawRows() {
    const w = W(), [a, b] = v(), now = ctx.time();
    g.clearRect(0, 0, w, H); g.fillStyle = '#16171c'; g.fillRect(0, 0, w, H);
    rows.forEach((r, i) => {
      g.save(); g.beginPath(); g.rect(0, r.y, w, r.h); g.clip();
      g.fillStyle = i % 2 ? '#14151a' : '#17181e'; g.fillRect(0, r.y, w, r.h);
      const dim = r.kind === 'layer' && !on(r.id);
      const he = headEls.get(r.id); if (he && he.off !== dim) { he.off = dim; he.el.classList.toggle('off', dim); }
      ({ pic: drawPic, mix: drawMix, scenes: drawScenes, notes: drawNotes, text: drawText, layer: drawLayer, cues: drawLayer, clips: drawClips })[r.kind]?.(r, a, b, now, dim);
      if (r.id === 'music' && bands.length) drawBands(r);
      g.restore();
      g.fillStyle = '#0d0e12'; g.fillRect(0, r.y + r.h - 1, w, 1);
    });
    // the range's edges as faint lines through every row
    for (const k of keys()) { g.fillStyle = 'rgba(255,216,61,.35)'; g.fillRect(k.x - 0.5, 0, 1, H); }
    // the snap guide of a clip drag
    if (clipDrag?.moved && clipDrag.guide != null) { g.fillStyle = '#25d0c2'; g.fillRect(Math.round(tx(clipDrag.guide)), 0, 1, H); }
    // a sound being dragged in from the library / Explorer: where it will land
    if (dropAt) {
      const x = Math.round(tx(dropAt.t)), r = dropAt.row, cy = r ? r.y + 2 : 2;
      g.fillStyle = '#25d0c2'; g.fillRect(x, 0, 1, H);
      g.font = '11px Segoe UI'; g.textBaseline = 'top'; const tw = g.measureText(dropAt.label).width + 10, cx = Math.min(x + 4, w - tw - 2);
      g.fillRect(cx, cy, tw, 16); g.fillStyle = '#06201d'; g.fillText(dropAt.label, cx + 5, cy + 2);
    }
    // playhead
    const px = tx(now); g.fillStyle = PLAY; g.fillRect(px - 1, 0, 2, H);
  }
  // over the picture and the film sound: cuts, notes, the range tint, changed ranges, the hover line
  function overlays(r, chunks) {
    const w = W(), y = r.y, hh = r.h;
    if (chunks) { const cs = ctx.chunkSec(), [a, b] = v(); if (cs && cs * pps() > 7) { g.fillStyle = 'rgba(255,255,255,.18)'; for (let t = Math.ceil(a / cs) * cs; t <= b; t += cs) g.fillRect(tx(t), y, 1, hh); } }
    g.fillStyle = 'rgba(96,156,255,.28)'; for (const [x0, x1] of ctx.changed() || []) g.fillRect(tx(x0), y, Math.max(2, tx(x1) - tx(x0)), hh);
    const K = keys(); if (K.length === 2) { g.fillStyle = ctx.loopOn() ? 'rgba(230,193,77,.16)' : 'rgba(230,193,77,.08)'; g.fillRect(K[0].x, y, Math.max(1, K[1].x - K[0].x), hh); }
    scenes.forEach((sc, i) => { if (!i) return; const x = tx(sc.t0); if (x > 0 && x < w) { g.fillStyle = 'rgba(255,255,255,.55)'; g.fillRect(x, y, 1, hh); } });
    const sel = ctx.selected();
    for (const n of ctx.notes()) { g.fillStyle = STATUS_COLOR[n.status] || '#e6c14d'; g.globalAlpha = n.id === sel ? 0.9 : 0.35; g.fillRect(tx(n.t) - 0.5, y, n.id === sel ? 2 : 1, hh); }
    g.globalAlpha = 1;
    if (hoverX != null && !dragging && hoverRow !== 'ruler') { g.fillStyle = 'rgba(255,255,255,.35)'; g.fillRect(hoverX, y, 1, hh); }
  }
  function drawPic(r, a, b) {
    const w = W();
    if (strip && stripImg) {
      const i0 = Math.max(0, Math.floor(a / strip.step)), i1 = Math.min(strip.n - 1, Math.ceil(b / strip.step));
      for (let i = i0; i <= i1; i++) {
        const x0 = tx(i * strip.step), x1 = tx((i + 1) * strip.step);
        g.drawImage(stripImg, (i % strip.cols) * strip.tw, Math.floor(i / strip.cols) * strip.th, strip.tw, strip.th, x0, r.y, Math.max(1, x1 - x0), r.h - 1);
      }
    } else { g.fillStyle = '#20222a'; g.fillRect(0, r.y, w, r.h); }
    overlays(r, true);
  }
  function drawMix(r) { wave('mix', r, '#9aa0b0', waveImg); overlays(r, !rowOf('pic')); }
  function drawScenes(r, a, b, now) {
    const w = W(), y0 = r.y, hh = r.h;
    g.fillStyle = '#101116'; g.fillRect(0, y0, w, hh);
    g.font = `600 ${hh < 18 ? 9 : 10.5}px Segoe UI`; g.textBaseline = 'middle';
    scenes.forEach((sc, i) => {
      const x0 = tx(sc.t0), x1 = tx(sc.t1); if (x1 < 0 || x0 > w) return;
      const cur = now >= sc.t0 && now < sc.t1, sel = selScene === i;
      g.fillStyle = colorOf(sc, i); g.globalAlpha = cur || sel ? 1 : 0.62;
      g.fillRect(x0 + 0.5, y0 + 2, Math.max(1, x1 - x0 - 1), hh - 4); g.globalAlpha = 1;
      if (sel) { g.strokeStyle = '#e6c14d'; g.lineWidth = 1.5; g.strokeRect(x0 + 1, y0 + 2.5, Math.max(1, x1 - x0 - 2), hh - 5); }
      if (x1 - x0 > 16 && hh >= 12) { g.save(); g.beginPath(); g.rect(x0, y0, x1 - x0 - 2, hh); g.clip(); g.fillStyle = '#f2f3f7'; g.fillText((i + 1) + ' · ' + sc.name, Math.max(x0, 0) + 4, y0 + hh / 2); g.restore(); }
    });
  }
  // notes in their row, grouped by screen distance
  let groups = [];
  function noteGroups() {
    const out = [];
    for (const n of ctx.notes().slice().sort((p, q) => p.t - q.t)) {
      const x = tx(n.t); if (x < -10 || x > W() + 10) continue;
      const last = out[out.length - 1];
      if (last && x - last.x0 < 14) { last.notes.push(n); last.x = (last.x0 + x) / 2; } else out.push({ x0: x, x, notes: [n] });
    }
    return out;
  }
  const groupAt = (x, r) => r && r.kind === 'notes' ? groups.slice().sort((p, q) => Math.abs(p.x - x) - Math.abs(q.x - x)).find(gr => Math.abs(gr.x - x) < 12) || null : null;
  function drawNotes(r) {
    const w = W(), sel = ctx.selected(), y0 = r.y, hh = r.h, rad = Math.max(3, Math.min(5, hh / 2 - 3));
    g.fillStyle = '#121318'; g.fillRect(0, y0, w, hh);
    for (const n of ctx.notes()) if (n.t2 != null) { const x = tx(n.t); g.fillStyle = STATUS_COLOR[n.status] || '#e6c14d'; g.globalAlpha = .55; g.fillRect(x, y0 + hh - 5, Math.max(3, tx(n.t2) - x), 3); g.globalAlpha = 1; }
    groups = noteGroups();
    g.font = `600 ${hh < 18 ? 8.5 : 10}px Segoe UI`; g.textBaseline = 'middle'; g.textAlign = 'center';
    for (const gr of groups) {
      const hasSel = gr.notes.some(n => n.id === sel), c = STATUS_COLOR[gr.notes[0].status] || '#e6c14d', cy = y0 + hh / 2 - 1;
      if (gr.notes.length === 1) { g.beginPath(); g.arc(gr.x, cy, hasSel ? rad + 1 : rad, 0, Math.PI * 2); g.fillStyle = c; g.fill(); }
      else { const wpx = 10 + String(gr.notes.length).length * 6, hb = Math.min(12, hh - 4); g.fillStyle = c; g.beginPath(); g.roundRect(gr.x - wpx / 2, cy - hb / 2, wpx, hb, hb / 2); g.fill(); g.fillStyle = '#111'; g.fillText(String(gr.notes.length), gr.x, cy + 0.5); }
      if (hasSel) { g.strokeStyle = '#fff'; g.lineWidth = 1.5; g.beginPath(); g.arc(gr.x, cy, rad + 3, 0, Math.PI * 2); g.stroke(); }
    }
    g.textAlign = 'left';
  }
  const textItems = () => tr.words.length && pps() > 90 ? tr.words : tr.phrases;
  function drawText(r, a, b, now) {
    const w = W(), y0 = r.y, hh = r.h;
    g.fillStyle = '#121318'; g.fillRect(0, y0, w, hh);
    g.font = `${hh < 18 ? 9 : 11}px Segoe UI`; g.textBaseline = 'middle';
    textItems().forEach(([s, e, txt], i) => {
      const x0 = tx(s), x1 = tx(e); if (x1 < 0 || x0 > w) return;
      const cur = now >= s && now < e;
      g.fillStyle = cur ? 'rgba(96,156,255,.35)' : i % 2 ? 'rgba(255,255,255,.05)' : 'rgba(255,255,255,.09)';
      g.fillRect(x0, y0 + 2, Math.max(2, x1 - x0 - 1), hh - 4);
      if (x1 - x0 > 14) { g.save(); g.beginPath(); g.rect(x0, y0, x1 - x0 - 2, hh); g.clip(); g.fillStyle = cur ? '#ffffff' : '#b9bcc6'; g.fillText(txt, x0 + 3, y0 + hh / 2); g.restore(); }
    });
  }
  function drawLayer(r, a, b, now, dim) {
    const w = W(), y0 = r.y, hh = r.h;
    g.globalAlpha = dim ? 0.28 : 1;
    if (r.kind === 'layer') {
      if (r.layer?.placeholder) { g.fillStyle = '#5c5f69'; g.font = '10px Segoe UI'; g.textBaseline = 'middle'; g.fillText('no separate audio file · use "Apply to film" to hear it', 6, y0 + hh / 2); }
      else wave(r.id, r, r.color, layerImg[r.id]);
    }
    if (r.cues && cues) {
      g.fillStyle = '#f08a3c'; g.font = '9.5px Segoe UI'; g.textBaseline = 'middle';
      const named = pps() > 35 && hh >= 18; let lastX = -99;
      for (const c of cues) { const x = tx(c.t); if (x < -2 || x > w + 2) continue; g.fillRect(x, y0 + 2, 1.5, hh - 4); if (named && x - lastX > 48) { g.fillText(c.name, x + 3, y0 + hh / 2); lastX = x; } }
    }
    g.globalAlpha = 1;
  }
  // music levels over time (P4): dark band, yellow ramps as wide as the fade, label; ducks can be selected / resized
  const bandSpan = e => (bandDrag && bandDrag.shot === e.shot ? [bandDrag.t0, bandDrag.t1] : [e.t0, e.t1]);
  function drawBands(r) {
    const w = W(), y = r.y, hh = r.h, p = pps();
    g.font = '10px Segoe UI'; g.textBaseline = 'top';
    for (const e of bands) {
      const [t0, t1] = bandSpan(e), x0 = tx(t0), x1 = tx(t1); if (x1 < 0 || x0 > w) continue;
      const fw = Math.max(1, (e.fade > 0 ? e.fade : 0.12) * p);
      g.fillStyle = 'rgba(0,0,0,.45)'; g.fillRect(x0, y, x1 - x0, hh);
      g.fillStyle = e.duck ? 'rgba(255,216,61,.38)' : 'rgba(255,216,61,.18)'; g.fillRect(x0 - fw, y, 2 * fw, hh); g.fillRect(x1 - fw, y, 2 * fw, hh);
      if (e.sel) { g.strokeStyle = '#25d0c2'; g.lineWidth = 1.5; g.strokeRect(x0 + 0.75, y + 0.75, Math.max(1, x1 - x0 - 1.5), hh - 1.5); }
      if (x1 - x0 > 54 && hh >= 14) { g.fillStyle = e.duck ? '#ffd83d' : '#c9ccd6'; g.fillText(e.music < 0.004 ? 'No music' : 'Music ' + Math.round(e.music * 100) + '%', Math.max(x0, 0) + 4, y + 2); }
    }
  }
  // a duck band under the pointer: its edge (6 px) or body; the other bands are drawn only
  function bandHit(x) {
    for (let i = bands.length - 1; i >= 0; i--) {
      const e = bands[i]; if (!e.duck) continue;
      const x0 = tx(e.t0), x1 = tx(e.t1);
      if (Math.abs(x - x0) <= 6) return { e, part: 't0' };
      if (Math.abs(x - x1) <= 6) return { e, part: 't1' };
      if (x > x0 && x < x1) return { e, part: 'body' };
    }
    return null;
  }
  // a row's waveform: peaks drawn per device pixel (cached while the view stays), else the PNG stretched
  function wave(id, r, color, img) {
    const w = W(), [a, b] = v(), P = peaks.get(id);
    if (P) {
      const key = `${a}|${b}|${w}|${r.h}|${dpr}`;
      let c = waveCache.get(id);
      if (!c || c.key !== key) {
        const oc = c?.cv || document.createElement('canvas'); oc.width = Math.max(1, Math.round(w * dpr)); oc.height = Math.max(1, Math.round((r.h - 2) * dpr));
        const og = oc.getContext('2d'); og.clearRect(0, 0, oc.width, oc.height);
        paintPeaks(og, P, x => a + x / oc.width * (b - a), 0, oc.width, oc.height / 2, oc.height / 2 - dpr, color, 1);
        c = { key, cv: oc }; waveCache.set(id, c);
      }
      g.drawImage(c.cv, 0, r.y + 1, w, r.h - 2);
    } else if (img) g.drawImage(img, a / dur() * img.width, 0, (b - a) / dur() * img.width, img.height, 0, r.y + 1, w, r.h - 2);
  }
  // min/max of the buckets under each column; tAt(x) = the source time at column x; sqrt scale like the PNGs
  function paintPeaks(c, P, tAt, x0, x1, ymid, half, color, step) {
    const d = P.data, nb = d.length / 2, rate = P.rate, amp = v => (v < 0 ? -1 : 1) * Math.sqrt(Math.abs(v) / 127);
    c.fillStyle = color;
    for (let x = x0; x < x1; x += step) {
      let i0 = Math.floor(tAt(x) * rate), i1 = Math.max(i0 + 1, Math.ceil(tAt(x + step) * rate));
      if (i1 <= 0 || i0 >= nb) continue; i0 = Math.max(0, i0); i1 = Math.min(nb, i1);
      let lo = 127, hi = -127; for (let i = i0; i < i1; i++) { if (d[2 * i] < lo) lo = d[2 * i]; if (d[2 * i + 1] > hi) hi = d[2 * i + 1]; }
      const yt = ymid - amp(hi) * half, yb = ymid - amp(lo) * half;
      c.fillRect(x, yt, step, Math.max(step, yb - yt));
    }
  }
  // added sounds: one row per kind, lanes stacked inside it. Gestures (P3b): body = select + move (5 px, snaps 8 px to
  // the playhead before the drag, scene starts, other clip edges, cues and 0; Shift = no snap; Alt = copy; another lane
  // or the other row = lane / kind), 8 px edges = trim (snap 12 px), 12 px squares at the top corners = fades (hover,
  // clips ≥ 70 px; double-click = 0). The clip itself changes only on release: one commit through setClipOps.
  const laneOf = (c, r) => Math.max(0, Math.min(r.lanes - 1, Number.isInteger(c.lane) ? c.lane : 0));
  const kindOf = c => c.kind === 'music' ? 'music' : 'sfx';
  const EDGE = 8, FADE = 12, FADE_MIN_W = 70, MOVE_PX = 5;
  function clipBox(c, r) {
    const lh = r.h / r.lanes, len = clipLen(c, dur()), x0 = tx(c.t), x1 = tx(c.t + len), top = r.y + laneOf(c, r) * lh + 3;
    return { x0, x1, top, bh: Math.max(4, lh - 6), lh, len };
  }
  // the fade squares: centred on the fade's end, never over the trim edges
  function fadeHandles(c, B) {
    const p = pps(), fi = Math.max(B.x0 + EDGE + FADE / 2, B.x0 + (c.fin || 0) * p), fo = Math.min(B.x1 - EDGE - FADE / 2, B.x1 - (c.fout || 0) * p);
    return { fin: { x: fi - FADE / 2, y: B.top }, fout: { x: fo - FADE / 2, y: B.top } };
  }
  function clipAt(x, y, r) {
    if (!clips || !r || r.kind !== 'clips') return null;
    const lh = r.h / r.lanes, lane = Math.floor((y - r.y) / lh);
    return clips.slice().reverse().find(c => kindOf(c) === r.clipKind && laneOf(c, r) === lane && x >= tx(c.t) - 3 && x <= tx(c.t + clipLen(c, dur())) + 3) || null;
  }
  // which part of a clip is under the pointer: fin / fout squares, trimL / trimR edges, body
  function clipHit(x, y, r) {
    const c = clipAt(x, y, r); if (!c) return null;
    const B = clipBox(c, r), w = B.x1 - B.x0;
    if (w >= FADE_MIN_W && y >= B.top && y <= B.top + FADE) {
      const F = fadeHandles(c, B);
      for (const k of ['fin', 'fout']) if (x >= F[k].x - 2 && x <= F[k].x + FADE + 2) return { c, part: k };
    }
    if (w >= 3 * EDGE) { if (x <= B.x0 + EDGE) return { c, part: 'trimL' }; if (x >= B.x1 - EDGE) return { c, part: 'trimR' }; }
    return { c, part: 'body' };
  }
  function drawClip(c, r, { alpha = 1, ghost = false, hover = null } = {}) {
    const w = W(), B = clipBox(c, r), { x0, x1, top, bh, lh, len } = B; if (x1 < 0 || x0 > w) return;
    const music = kindOf(c) === 'music', bw = Math.max(3, x1 - x0), rad = lh < 26 ? 2 : 6;
    g.globalAlpha = (c.mute ? 0.3 : 1) * alpha;
    g.fillStyle = music ? '#274a86' : '#6d5330'; g.beginPath(); g.roundRect(x0, top, bw, bh, rad); g.fill();
    // its waveform from the clip file's peaks (trim / loop applied)
    if (c.src) {
      const P = peaks.get(c.src);
      if (P) {
        g.save(); g.beginPath(); g.rect(Math.max(0, x0), top, Math.min(w, x1) - Math.max(0, x0), bh); g.clip();
        const fd = P.dur || c.dur || 1, trim = c.trim || 0;
        paintPeaks(g, P, x => { const s = xt(x) - c.t + trim; return c.loop && fd > 0 ? trim + ((s - trim) % Math.max(0.05, fd - trim)) : s; }, Math.max(0, Math.floor(x0)), Math.min(w, Math.ceil(x1)), top + bh / 2, bh / 2 - 1, 'rgba(255,255,255,.32)', 1 / dpr);
        g.restore();
      } else if (!asked.has(c.src) && ctx.needPeaks) { asked.add(c.src); ctx.needPeaks(c.src); }
    }
    // fades: a dark wedge with a yellow diagonal (the volume ramp)
    const fi = Math.min(len, c.fin || 0), fo = Math.min(len, c.fout || 0);
    if (fi > 0) { const xf = tx(c.t + fi); g.fillStyle = 'rgba(0,0,0,.45)'; g.beginPath(); g.moveTo(x0, top); g.lineTo(xf, top); g.lineTo(x0, top + bh); g.fill(); g.strokeStyle = '#ffd83d'; g.lineWidth = 2; g.beginPath(); g.moveTo(x0, top + bh); g.lineTo(xf, top); g.stroke(); }
    if (fo > 0) { const xf = tx(c.t + len - fo); g.fillStyle = 'rgba(0,0,0,.45)'; g.beginPath(); g.moveTo(x1, top); g.lineTo(xf, top); g.lineTo(x1, top + bh); g.fill(); g.strokeStyle = '#ffd83d'; g.lineWidth = 2; g.beginPath(); g.moveTo(x1, top + bh); g.lineTo(xf, top); g.stroke(); }
    if (c.id === clipSel || ghost) { g.strokeStyle = ghost ? '#ffffff' : '#25d0c2'; g.lineWidth = 2; g.setLineDash(ghost ? [4, 3] : []); g.beginPath(); g.roundRect(x0 + 1, top + 1, Math.max(2, bw - 2), bh - 2, lh < 26 ? 2 : 5); g.stroke(); g.setLineDash([]); }
    if (bw >= 18 && bh >= 10) { g.save(); g.beginPath(); g.rect(x0, top, bw - 2, bh); g.clip(); g.fillStyle = '#eef3f0'; g.fillText((music ? '♪ ' : '') + (c.name || 'sound'), Math.max(x0, 0) + 4, top + bh / 2); g.restore(); }
    // hovered (or being dragged): trim edge, fade squares + their lengths
    if (hover && bw >= 3 * EDGE) {
      g.fillStyle = 'rgba(255,255,255,.55)';
      if (hover === 'trimL') g.fillRect(x0, top, 3, bh); if (hover === 'trimR') g.fillRect(x1 - 3, top, 3, bh);
      if (bw >= FADE_MIN_W) {
        const F = fadeHandles(c, B);
        for (const k of ['fin', 'fout']) {
          g.fillStyle = hover === k ? '#ffd83d' : '#1b1c22'; g.fillRect(F[k].x, F[k].y, FADE, FADE);
          g.strokeStyle = '#ffd83d'; g.lineWidth = 1; g.strokeRect(F[k].x + 0.5, F[k].y + 0.5, FADE - 1, FADE - 1);
          const v = k === 'fin' ? fi : fo;
          if (v > 0 && bh >= 14) { g.fillStyle = '#ffd83d'; g.font = '600 9px Segoe UI'; g.textAlign = k === 'fin' ? 'left' : 'right'; g.fillText(v.toFixed(2) + 's', k === 'fin' ? F[k].x + FADE + 3 : F[k].x - 3, top + FADE / 2 + 1); g.textAlign = 'left'; g.font = '600 9.5px Segoe UI'; }
        }
      }
    }
    g.globalAlpha = 1;
  }
  function drawClips(r) {
    const w = W(), lh = r.h / r.lanes;
    g.fillStyle = r.clipKind === 'music' ? '#121722' : '#17140f'; g.fillRect(0, r.y, w, r.h);
    for (let i = 1; i < r.lanes; i++) { g.fillStyle = 'rgba(255,255,255,.05)'; g.fillRect(0, r.y + i * lh, w, 1); }
    g.font = '600 9.5px Segoe UI'; g.textBaseline = 'middle';
    const D = clipDrag && clipDrag.moved ? clipDrag : null;
    for (const c of clips || []) {
      if (kindOf(c) !== r.clipKind) continue;
      const dragged = D && c.id === D.id;
      if (dragged && D.mode !== 'move') continue;   // trims / fades: the ghost is drawn in its place
      drawClip(c, r, { alpha: dragged && !D.alt ? 0.35 : 1, hover: !D && clipHover && clipHover.id === c.id ? clipHover.part : null });
    }
    if (D && D.ghost && kindOf(D.ghost) === r.clipKind) drawClip(D.ghost, r, { ghost: D.mode === 'move', hover: D.mode === 'move' ? null : D.mode });
  }
  // overview: the whole film, the view's window and the playhead
  let ovLast = '';
  function drawOverview() {
    const d = dur(), [a, b] = v(), label = V.label(), p = ctx.time() / d * 100;
    const s = `${a}|${b}|${label}|${p.toFixed(2)}`; if (s === ovLast) return; ovLast = s;
    ovWin.style.left = (a / d * 100) + '%'; ovWin.style.width = ((b - a) / d * 100) + '%';
    ovHead.style.left = `calc(${Math.max(0, Math.min(100, p))}% - 1px)`;
    if (ovLab.textContent !== label) ovLab.textContent = label;
    const sp = b - a, ct = V.isZoomed() ? '🔍 ' + (sp < 60 ? sp.toFixed(1) + ' s' : mmss(sp)) : 'whole film';
    if (cornerTxt.textContent !== ct) cornerTxt.textContent = ct;
  }

  // ---- tip
  function showTip(canvas, x, y0, y1, fill) {
    const host = ctx.overlayHost?.() || el;
    if (tip.parentNode !== host) host.append(tip);
    tip.hidden = false; fill();
    const r = canvas.getBoundingClientRect(), th = tip.offsetHeight;
    let top = r.top + y0 - th - 6;
    if (top < 4) top = r.top + y1 + 6;   // no room above the row: below it
    tip.style.left = Math.max(4, Math.min(innerWidth - 174, r.left + x - 85)) + 'px';
    tip.style.top = Math.round(top) + 'px';
  }
  function stripTip(t) {   // the strip picture at a moment
    if (strip && stripImg) { const tc = tipCv.getContext('2d'), i = Math.max(0, Math.min(strip.n - 1, Math.floor(t / strip.step))); tipCv.height = Math.round(160 * strip.th / strip.tw); tc.drawImage(stripImg, (i % strip.cols) * strip.tw, Math.floor(i / strip.cols) * strip.th, strip.tw, strip.th, 0, 0, 160, tipCv.height); tipCv.hidden = false; }
    else tipCv.hidden = true;
  }
  function plainTip(t) {
    const fps = ctx.fps(), cs = ctx.chunkSec();
    tipTxt.textContent = `${tcs(t)} · frame ${Math.floor(t * fps)}${cs ? ' · chunk ' + Math.floor(t / cs) : ''}`; stripTip(t);
  }
  const cueNear = (x, r) => { if (!cues || !r?.cues) return null; let best = null, bd = 7; for (const c of cues) { const d = Math.abs(tx(c.t) - x); if (d < bd) { bd = d; best = c; } } return best; };
  const sceneAt = (x, r) => r && r.kind === 'scenes' ? scenes.find(sc => x >= tx(sc.t0) && x < tx(sc.t1)) || null : null;
  function fillRowTip(x, y, r) {
    const t = xt(x);
    if (!r) return plainTip(t);
    if (r.kind === 'layer' || r.kind === 'cues') { const c = cueNear(x, r); tipTxt.textContent = c ? `${c.name} · ${tcs(c.t)} · click: jump here` : `${r.label} · ${mmss(t)}`; stripTip(c ? c.t : t); return; }
    if (r.kind === 'clips') { const ck = clipAt(x, y, r); if (ck) { tipTxt.textContent = `${ck.name || 'sound'} · ${tcs(ck.t)} · volume ${Math.round((ck.gain ?? 1) * 100)}% · drag: move · click: settings`; stripTip(ck.t); } else { tipTxt.textContent = `${r.label} · ${mmss(t)}`; stripTip(t); } return; }
    const sc = sceneAt(x, r);
    if (sc) { const i = scenes.indexOf(sc); tipTxt.textContent = `Scene ${i + 1}: ${sc.name}${sc.set ? ' (' + sc.set + ')' : ''} · ${mmss(sc.t0)}–${mmss(sc.t1)} (${(sc.t1 - sc.t0).toFixed(1)} s) · click: jump to start · Shift+click: set range`; stripTip(sc.t0); return; }
    const said = tr && r.kind === 'text' ? tr.phrases.find(([s, e]) => t >= s - 0.05 && t <= e + 0.05) : null;
    if (said) { tipTxt.textContent = `${mmss(said[0])} · «${said[2]}» · click: jump here`; tipCv.hidden = true; return; }
    const gr = groupAt(x, r);
    if (gr) { const near = gr.notes[0]; tipTxt.textContent = gr.notes.length > 1 ? `${gr.notes.length} notes: ${gr.notes.map(n => '#' + n.id).join(' ')} · click: next note` : `#${near.id} ${near.text.slice(0, 60)} · click: jump to note`; stripTip(near.at ?? near.t); return; }
    plainTip(t);
  }

  const capture = (node, e) => { try { node.setPointerCapture(e.pointerId); } catch { } };   // synthetic events have no active pointer
  // ---- ruler: press/drag pauses and scrubs; a diamond jumps to its frame
  const keyAt = x => keys().sort((p, q) => Math.abs(p.x - x) - Math.abs(q.x - x)).find(k => Math.abs(k.x - x) < 11) || null;
  const rx = e => e.clientX - rcv.getBoundingClientRect().left;
  rcv.addEventListener('pointerdown', e => {
    capture(rcv, e);
    const x = rx(e), k = keyAt(x);
    if (k) { ctx.seek((k.frame + 0.5) / ctx.fps()); return; }
    ctx.pause?.(); dragging = { ruler: true }; ctx.seek(xt(x)); draw();
  });
  rcv.addEventListener('pointermove', e => {
    const x = rx(e); hoverX = x; hoverRow = 'ruler';
    if (dragging?.ruler) ctx.seek(xt(x));
    rcv.style.cursor = keyAt(x) ? 'pointer' : 'ew-resize';
    showTip(rcv, x, 0, RULER, () => { const k = keyAt(x); if (k) { tipTxt.textContent = `${k.which === 'a' ? 'Range start' : 'Range end'}: frame ${k.frame} · click: jump to frame`; stripTip(k.frame / ctx.fps()); } else plainTip(xt(x)); });
    draw();
  });
  rcv.addEventListener('pointerup', () => { dragging = null; draw(); });
  rcv.addEventListener('pointerleave', () => { hoverX = null; hoverRow = null; tip.hidden = true; draw(); });
  rcv.addEventListener('dblclick', () => V.fit());
  corner.addEventListener('click', e => { if (!e.target.closest('button')) V.fit(); });

  // ---- rows canvas (hit order per row: notes, scenes, text, layers/cues, clips, else scrub)
  const xOf = e => e.clientX - cv.getBoundingClientRect().left, yOf = e => e.clientY - cv.getBoundingClientRect().top;
  const scrub = t => { dragging = { t0: t }; ctx.seek(t); draw(); };
  cv.addEventListener('pointerdown', e => {
    capture(cv, e);
    const x = xOf(e), y = yOf(e), t = xt(x), r = rowAt(y);
    if (!r) return scrub(t);
    if (r.kind === 'notes') {
      const gr = groupAt(x, r);
      if (gr) {   // a note marker; a group steps to its next note on every click
        const i = gr.notes.findIndex(n => n.id === ctx.selected()), note = gr.notes[(i + 1) % gr.notes.length];
        ctx.selectNote(note.id); ctx.seek(note.at ?? note.t); return;
      }
      return scrub(t);
    }
    if (r.kind === 'scenes') {
      const sc = sceneAt(x, r);
      if (sc) {   // a scene: jump to its start; Shift = make it the I/O range (notes, sound levels, partial renders)
        selScene = scenes.indexOf(sc);
        if (e.shiftKey && ctx.setRange) { const fps = ctx.fps(); ctx.setRange(Math.round(sc.t0 * fps), Math.max(Math.round(sc.t0 * fps), Math.round(sc.t1 * fps) - 1)); }
        ctx.seek(sc.t0 + 0.001); draw(); return;
      }
      return scrub(t);
    }
    if (r.kind === 'text' && tr) {   // jump to the start of the word / sentence under the pointer (else the next one)
      const items = textItems(), hit = items.find(([s, e2]) => t >= s && t <= e2) || items.find(([s]) => s >= t);
      if (hit) { ctx.seek(hit[0] + 0.001); return; }
      return scrub(t);
    }
    if (r.id === 'music' && bandOps) {   // a duck band: select it; its edges drag
      const bh = bandHit(x);
      if (bh) { bandOps.select(bh.e.shot); if (bh.part !== 'body') bandDrag = { shot: bh.e.shot, part: bh.part, t0: bh.e.t0, t1: bh.e.t1, moved: false }; draw(); return; }
      if (bands.some(e => e.sel)) bandOps.select(null);
    }
    if (r.kind === 'layer' || r.kind === 'cues') { const c = cueNear(x, r); if (c) { ctx.seek(c.t + 0.001); return; } return scrub(t); }
    if (r.kind === 'clips') {
      const hit = clipHit(x, y, r);
      if (hit) {   // select now (Clip tab); the drag decides later: move, trim or fade
        const ck = hit.c; clipSel = ck.id; clipHooks.select?.(ck.id);
        clipDrag = { id: ck.id, mode: hit.part === 'body' ? 'move' : hit.part, x0: x, y0: y, tPress: t, orig: { ...ck, lane: laneOf(ck, r) }, moved: false, alt: e.altKey, playT: ctx.time(), patch: null, ghost: null, guide: null, cx: e.clientX, cy: e.clientY, shift: e.shiftKey };
        clipHover = null; edgeLoopStart(); draw(); return;
      }
      clipSel = null; clipHooks.select?.(null); return scrub(t);   // an empty clip lane deselects and scrubs
    }
    scrub(t);   // picture, film sound: scrub
  });
  // ---- clip drag: a ghost follows the pointer; the clip changes once, on release
  const snapCands = id => [clipDrag ? clipDrag.playT : ctx.time(), 0, ...scenes.map(sc => sc.t0), ...(clips || []).filter(c => c.id !== id).flatMap(c => [c.t, c.t + clipLen(c, dur())]), ...(cues || []).map(c => c.t)];
  const r3 = n => Math.round(n * 1000) / 1000, sgn = n => (n >= 0 ? '+' : '−') + Math.abs(n).toFixed(2);
  function updateClipDrag() {
    const D = clipDrag, R = cv.getBoundingClientRect(), x = D.cx - R.left, y = D.cy - R.top;
    if (!D.moved && Math.hypot(x - D.x0, y - D.y0) < MOVE_PX) return;
    if (!D.moved && D.mode !== 'move') ctx.pause?.();
    D.moved = true;
    const o = D.orig, len = clipLen(o, dur()), dt = xt(x) - D.tPress, cands = D.shift ? [] : snapCands(D.id);
    let patch, guide = null, edge = null;
    if (D.mode === 'move') {
      let nt = Math.max(0, o.t + dt);
      const s = D.shift ? null : findDragSnap(cands, nt, len, pps(), 8);
      if (s) { nt = Math.max(0, s.t); guide = s.guide; }
      // another lane of this row, or the other added-sound row: lane / kind change
      const tr = rowAt(y);
      if (tr && tr.kind === 'clips') { D.kind = tr.clipKind; D.lane = Math.max(0, Math.min(tr.lanes - 1, Math.floor((y - tr.y) / (tr.h / tr.lanes)))); }
      patch = { t: r3(nt), lane: D.lane ?? o.lane, kind: D.kind ?? kindOf(o) };
      D.info = `${o.name || 'sound'} · ${tcs(nt)} · ${sgn(nt - o.t)} s${D.alt ? ' · copy' : ''}${D.shift ? '' : ' · Shift: no snapping'}`;
    } else if (D.mode === 'trimL') {
      const raw = o.t + dt, ns = D.shift ? raw : snapEdgeTime(raw, cands, pps(), 12);
      if (ns !== raw) guide = ns;
      const d = Math.min(len - 0.05, Math.max(ns - o.t, -(o.trim || 0), -o.t));
      patch = { t: r3(o.t + d), trim: r3((o.trim || 0) + d), ...(o.len != null ? { len: r3(o.len - d) } : {}) };
      edge = o.t + d; D.info = `Start ${tcs(o.t + d)} · ${sgn(d)} s · ${(len - d).toFixed(2)} s`;
    } else if (D.mode === 'trimR') {
      const raw = o.t + len + dt, ne = D.shift ? raw : snapEdgeTime(raw, cands, pps(), 12);
      if (ne !== raw) guide = ne;
      const max = o.loop ? dur() - o.t : (o.dur > 0 ? o.dur - (o.trim || 0) : 1e5), nl = Math.max(0.05, Math.min(max, ne - o.t));
      patch = { len: r3(nl) };
      edge = o.t + nl; D.info = `Start ${tcs(o.t)} · ${sgn(nl - len)} s · ${nl.toFixed(2)} s`;
    } else {   // fin / fout: fin + fout never longer than the clip
      const k = D.mode, other = k === 'fin' ? (o.fout || 0) : (o.fin || 0), v = Math.max(0, Math.min(len - other, (o[k] || 0) + (k === 'fin' ? dt : -dt)));
      patch = { [k]: Math.round(v * 100) / 100 };
      D.info = `${k === 'fin' ? 'Fade in' : 'Fade out'} ${v.toFixed(2)} s · double-click: reset`;
    }
    // a trim may leave the fades longer than the clip: shorten them
    if (patch.len != null || patch.trim != null) {
      const nl = clipLen({ ...o, ...patch }, dur()), fi = o.fin || 0, fo = o.fout || 0;
      if (fi + fo > nl) { const k = nl / (fi + fo); patch.fin = Math.round(fi * k * 100) / 100; patch.fout = Math.round(fo * k * 100) / 100; }
    }
    D.patch = patch; D.ghost = { ...o, ...patch }; D.guide = guide;
    if (edge != null) ctx.seek(edge);   // the playhead shows the edge while trimming, back on release
  }
  function commitClip(D) {
    if (clipOps) {
      clipOps.begin?.();
      const id = D.mode === 'move' && D.alt ? clipOps.duplicate?.(D.id) : D.id;
      if (id) { clipOps.move?.(id, D.patch); clipSel = id; }
      clipOps.end?.();
    } else if (!D.alt) { const c = clips && clips.find(q => q.id === D.id); if (c) { Object.assign(c, D.patch); clipHooks.moving?.(c); clipHooks.moved?.(c); } }
  }
  // dragging near the canvas edges pans a zoomed view (the ghost keeps following the pointer)
  let edgeRaf = 0;
  function edgeLoopStart() { cancelAnimationFrame(edgeRaf); edgeRaf = requestAnimationFrame(edgeLoop); }
  function edgeLoop() {
    edgeRaf = 0; if (!clipDrag) return;
    const R = cv.getBoundingClientRect(), st = edgeScrollStep(R.left, R.right, clipDrag.cx, clipDrag.moved);
    if (st && V.isZoomed()) { V.panBy(st / pps()); updateClipDrag(); draw(); }
    edgeRaf = requestAnimationFrame(edgeLoop);
  }
  function endClipDrag(commit) {
    const D = clipDrag; clipDrag = null; cancelAnimationFrame(edgeRaf); edgeRaf = 0;
    if (!D) return;
    const c = clips && clips.find(q => q.id === D.id);
    if (commit && c && D.moved && D.patch) commitClip(D);
    else if (commit && c && !D.moved && D.mode === 'move') ctx.seek(c.t + 0.001);   // a click: go to its start
    if (D.moved && (D.mode === 'trimL' || D.mode === 'trimR')) ctx.seek(D.playT);
  }
  const CURSOR = { body: 'grab', trimL: 'ew-resize', trimR: 'ew-resize', fin: 'col-resize', fout: 'col-resize' };
  cv.addEventListener('pointermove', e => {
    const x = xOf(e), y = yOf(e), r = rowAt(y); hoverX = x; hoverRow = r?.id || null;
    if (bandDrag) {   // a duck edge: snaps like clips (Shift: exact), never past the other edge
      const raw = Math.max(0, Math.min(dur(), xt(x))), nt = e.shiftKey ? raw : snapEdgeTime(raw, snapCands(null), pps(), 12);
      if (bandDrag.part === 't0') bandDrag.t0 = Math.min(nt, bandDrag.t1 - 0.05); else bandDrag.t1 = Math.max(nt, bandDrag.t0 + 0.05);
      bandDrag.moved = true; cv.style.cursor = 'ew-resize'; draw(); return;
    }
    if (clipDrag) { clipDrag.cx = e.clientX; clipDrag.cy = e.clientY; clipDrag.shift = e.shiftKey; updateClipDrag(); }
    else if (dragging) ctx.seek(xt(x));
    const hit = !clipDrag && !dragging && r?.kind === 'clips' ? clipHit(x, y, r) : null;
    clipHover = hit ? { id: hit.c.id, part: hit.part } : null;
    const bh = !clipDrag && !dragging && r?.id === 'music' && bandOps ? bandHit(x) : null;
    cv.style.cursor = bh ? (bh.part === 'body' ? 'pointer' : 'ew-resize') : clipDrag ? (clipDrag.mode === 'move' ? 'grabbing' : CURSOR[clipDrag.mode]) : hit ? CURSOR[hit.part] :dragging ? 'ew-resize' : groupAt(x, r) || sceneAt(x, r) || cueNear(x, r) || r?.kind === 'text' ? 'pointer' : 'ew-resize';
    showTip(cv, x, r ? r.y : 0, r ? r.y + r.h : H, () => { if (clipDrag?.moved) { tipTxt.textContent = clipDrag.info || ''; stripTip(clipDrag.ghost?.t ?? xt(x)); } else fillRowTip(x, y, r); }); draw();
  });
  cv.addEventListener('pointerup', () => {
    if (bandDrag) { const D = bandDrag; bandDrag = null; if (D.moved) bandOps?.set(D.shot, { t0: Math.round(D.t0 * 1000) / 1000, t1: Math.round(D.t1 * 1000) / 1000 }); draw(); return; }
    if (clipDrag?.moved) tip.hidden = true; endClipDrag(true); dragging = null; draw();   // the drag's tip is stale now
  });
  cv.addEventListener('pointercancel', () => { bandDrag = null; endClipDrag(false); dragging = null; draw(); });

  // ---- drop a sound from the library (application/x-vh-sound) or Explorer (Files) onto the rows (P4)
  const canDrop = e => [...(e.dataTransfer?.types || [])].some(t => t === 'application/x-vh-sound' || t === 'Files');
  function dropTarget(e) {
    const R = cv.getBoundingClientRect(), x = e.clientX - R.left, y = e.clientY - R.top, r = rowAt(y);
    let t = x < 0 ? ctx.time() : xt(x);
    if (!e.shiftKey) t = snapEdgeTime(t, snapCands(null), pps(), 8);
    const kind = r?.kind === 'clips' ? r.clipKind : r?.id === 'music' ? 'music' : r && ['sfx', 'vo', 'cues'].includes(r.id) ? 'sfx' : null;
    const lane = r?.kind === 'clips' ? Math.max(0, Math.min(r.lanes - 1, Math.floor((y - r.y) / (r.h / r.lanes)))) : undefined;
    t = Math.max(0, Math.min(dur(), t));
    return { t, kind, lane, row: r, label: `Drop: ${kind === 'music' ? 'Added music' : kind === 'sfx' ? 'Added effects' : 'Added sound'} · ${tcs(t)}` };
  }
  let dropTimer = 0;
  const clearDrop = () => { clearTimeout(dropTimer); if (dropAt) { dropAt = null; draw(); } };
  body.addEventListener('dragover', e => {
    if (!canDrop(e) || !ctx.onDrop) return;
    e.preventDefault(); e.dataTransfer.dropEffect = 'copy';
    dropAt = dropTarget(e); clearTimeout(dropTimer); dropTimer = setTimeout(clearDrop, 450); draw();
  });
  body.addEventListener('dragleave', e => { if (!body.contains(e.relatedTarget)) clearDrop(); });
  body.addEventListener('drop', e => {
    if (!canDrop(e) || !ctx.onDrop) return;
    e.preventDefault(); e.stopPropagation();
    const d = dropTarget(e); clearDrop();
    let item = null; try { item = JSON.parse(e.dataTransfer.getData('application/x-vh-sound') || 'null'); } catch { }
    ctx.onDrop({ item, files: [...(e.dataTransfer.files || [])], t: d.t, kind: d.kind, lane: d.lane });
  });
  cv.addEventListener('pointerleave', () => { hoverX = null; hoverRow = null; clipHover = null; tip.hidden = true; draw(); });
  // double-click: a fade square → no fade; a clip → nothing; elsewhere → the whole film
  cv.addEventListener('dblclick', e => {
    const x = xOf(e), y = yOf(e), r = rowAt(y), hit = r?.kind === 'clips' ? clipHit(x, y, r) : null;
    if (hit) { if ((hit.part === 'fin' || hit.part === 'fout') && clipOps) { clipOps.begin?.(); clipOps.move?.(hit.c.id, { [hit.part]: 0 }); clipOps.end?.(); } return; }
    V.fit();
  });

  // ---- wheel: Ctrl = zoom at the pointer; Shift / sideways = pan; plain = zoom on the ruler, native scroll on the rows
  function onWheel(e, zoomPlain, x) {
    const [a, b] = v(), span = b - a, sideways = Math.abs(e.deltaX) > Math.abs(e.deltaY);
    if (e.ctrlKey || (zoomPlain && !e.shiftKey && !sideways)) { e.preventDefault(); if (e.deltaY) V.zoomBy(e.deltaY > 0 ? 1.25 : 0.8, xt(x)); return; }
    if (e.shiftKey || sideways) { e.preventDefault(); V.panBy((sideways ? e.deltaX : e.deltaY || e.deltaX) / W() * span); }   // also keeps a sideways swipe from turning into Back/Forward
  }
  cv.addEventListener('wheel', e => onWheel(e, false, xOf(e)), { passive: false });
  rcv.addEventListener('wheel', e => onWheel(e, true, rx(e)), { passive: false });

  // ---- overview: drag the window = pan, drag an edge = zoom, press outside = centre there
  let ovDrag = null;
  const ovT = e => { const r = ovTrack.getBoundingClientRect(); return Math.max(0, Math.min(1, (e.clientX - r.left) / Math.max(1, r.width))) * dur(); };
  ovTrack.addEventListener('pointerdown', e => {
    capture(ovTrack, e);
    const t = ovT(e), [a, b] = v(), r = ovTrack.getBoundingClientRect(), edgeT = 6 / Math.max(1, r.width) * dur();
    if (Math.abs(t - a) < edgeT) ovDrag = { edge: 'a' };
    else if (Math.abs(t - b) < edgeT) ovDrag = { edge: 'b' };
    else { if (t < a || t > b) V.panBy(t - (a + b) / 2); ovDrag = { last: t }; }
    e.preventDefault();
  });
  ovTrack.addEventListener('pointermove', e => {
    const t = ovT(e), [a, b] = v(), r = ovTrack.getBoundingClientRect(), edgeT = 6 / Math.max(1, r.width) * dur();
    if (!ovDrag) { ovTrack.style.cursor = Math.abs(t - a) < edgeT || Math.abs(t - b) < edgeT ? 'ew-resize' : t >= a && t <= b ? 'grab' : 'pointer'; return; }
    if (ovDrag.edge === 'a') V.zoomToRange(Math.min(t, b - 2), b, 0);
    else if (ovDrag.edge === 'b') V.zoomToRange(a, Math.max(t, a + 2), 0);
    else { V.panBy(t - ovDrag.last); ovDrag.last = t; }
  });
  ovTrack.addEventListener('pointerup', () => { ovDrag = null; });
  ovTrack.addEventListener('dblclick', () => V.fit());
  ovTrack.addEventListener('wheel', e => onWheel(e, false, tx(ovT(e))), { passive: false });
  // Ctrl+wheel anywhere else in the timeline (row headers, corners): zoom at the view centre, never the browser page
  el.addEventListener('wheel', e => {
    if (!e.ctrlKey || e.defaultPrevented) return;
    e.preventDefault(); if (e.deltaY) V.zoomBy(e.deltaY > 0 ? 1.25 : 0.8, (v()[0] + v()[1]) / 2);
  }, { passive: false });

  relayout(false);   // the ResizeObserver sizes and draws once the element is in the page
  return {
    el, draw, view: V,
    follow(t) { V.follow(t, true); },
    setStrip(meta) { strip = meta; relayout(); const img = new Image(); img.onload = () => { stripImg = img; draw(); }; img.src = meta.url; },
    setWave(url) { const img = new Image(); img.onload = () => { waveImg = img; draw(); }; img.src = url; },
    setTranscript(t) { tr = t && t.ok ? t : null; relayout(); },
    // clips: the live list (the editor changes it in place); hooks: { select(id), moving(clip), moved(clip) }
    setClips(list, hooks) { clips = Array.isArray(list) ? list : null; if (hooks) clipHooks = hooks; relayout(); },
    // P3b: { begin(), move(id, patch), end(), remove(id), duplicate(id) → newId }; a gesture commits once through these
    setClipOps(ops) { clipOps = ops || null; relayout(); },
    // P3c: the mixer gives each row header its M / S / level controls (mixer.controls(rowId)); wider headers
    setMixer(m) { mixer = m || null; el.classList.toggle('tl2-mx', !!mixer); relayout(); },
    // the corner shows this element (sound build state / 💾) in place of the zoom readout; null = the readout again
    setStatus(node) { cornerStat.replaceChildren(...(node ? [node] : [])); cornerStat.hidden = !node; cornerTxt.hidden = !!node; },
    selectClip(id) { clipSel = id; draw(); },
    setScenes(list) { scenes = Array.isArray(list) ? list.filter(x => x && x.t1 > x.t0) : []; selScene = -1; relayout(); },
    scenes: () => scenes,
    // the scene around a time (for "next/previous scene" keys)
    sceneIndexAt(t) { for (let i = scenes.length - 1; i >= 0; i--) if (t >= scenes[i].t0 - 1e-3) return i; return -1; },
    setLayers(L) { layers = (L && L.layers) || []; cues = (L && L.cues && L.cues.length) ? L.cues : null; relayout(); },
    setLayerImage(id, url) { const img = new Image(); img.onload = () => { layerImg[id] = img; draw(); }; img.src = url; },
    // waveform peaks: id = 'mix' | a layer id | a clip's src; { rate, dur, data: Int8Array [min,max,…] }
    // P4: music-level bands (mixer.musicBands()) + ops { select(shot|null), set(shot, {t0, t1}) }
    setBands(list, ops) { bands = Array.isArray(list) ? list : []; if (ops) bandOps = ops; draw(); },
    bandSelected: () => bands.find(e => e.sel) || null,
    setPeaks(id, P) { if (P && P.data) peaks.set(id, P); else peaks.delete(id); waveCache.delete(id); draw(); },
    setRowsChanged() { relayout(); },
    rows: () => rows.map(r => ({ id: r.id, label: r.label, h: r.h, y: r.y, collapsed: r.collapsed })),
    destroy() { ro.disconnect(); offView(); tip.remove(); },
  };
}
