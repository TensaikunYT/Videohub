// Transport bar (P2): one row under the picture — frame/seek buttons, a typed timecode, speed + J/K/L shuttle,
// the I/O range, timeline zoom + follow, note / captions / sound / still / fullscreen. What does not fit goes
// into "⋯" by data-pri (dock.js fitRow). parseTime / fmtTC / createShuttle are pure and tested in node.
import { fitRow, openPop } from './dock.js';

// "1:23.45" m:ss.cc · "1:23:12" m:ss:ff · "83.4" / "83" s · "k1234" "f1234" "#1234" frame · "+2" "-0.5" relative s ·
// "+10f" "-3k" relative frames · comma = decimal point. → seconds at the middle of the frame it lands on, or null.
export function parseTime(str, fps, now = 0) {
  const v = String(str ?? '').trim().toLowerCase().replace(/\s+/g, '').replace(/,/g, '.');
  if (!v) return null;
  fps = fps > 0 ? fps : 30; now = Number.isFinite(+now) ? +now : 0;
  const frameOf = t => Math.max(0, Math.floor(t * fps + 1e-4)), at = f => (Math.max(0, f) + 0.5) / fps;
  const num = '(\\d+(?:\\.\\d*)?|\\.\\d+)';
  let m;
  if ((m = v.match(new RegExp(`^([+-])${num}([fk#])?$`)))) {
    const sign = m[1] === '-' ? -1 : 1, n = +m[2];
    if (m[3]) return Number.isInteger(n) ? at(frameOf(now) + sign * n) : null;
    return at(frameOf(now + sign * n));
  }
  if ((m = v.match(/^[kf#](\d+)$/))) return at(+m[1]);
  if ((m = v.match(/^(\d+):(\d{1,2}):(\d{1,3})$/))) {
    const ss = +m[2], ff = +m[3]; if (ss >= 60 || ff >= Math.ceil(fps)) return null;
    return at(Math.round((+m[1] * 60 + ss) * fps) + ff);
  }
  if ((m = v.match(new RegExp(`^(\\d+):${num}$`)))) { const s = +m[2]; return s < 60 ? at(frameOf(+m[1] * 60 + s)) : null; }
  if ((m = v.match(new RegExp(`^${num}s?$`)))) return at(frameOf(+m[1]));
  return null;
}

// "m:ss.cc", the old TC look (centiseconds cut, so 59.999 never reads 0:60.00)
export function fmtTC(t) {
  const cs = Math.max(0, Math.floor((+t || 0) * 100 + 1e-6)), m = Math.floor(cs / 6000), r = (cs % 6000) / 100;
  return `${m}:${r.toFixed(2).padStart(5, '0')}`;
}

// J/K/L shuttle. forward: 1× play, then 2× 4× 8× (raw playbackRate; the speed select keeps its value).
// reverse: paused, the playhead walks back by seeks (one in flight at most; no sound), 1× 2× 4× 8×.
// stop(): back to baseRate() and paused (pass { pause: false } when something else already started/stopped playback).
export function createShuttle({ now, seek, play, pause, setPlaybackRate, baseRate, seeking = () => false, onChange, fps = () => 30,
  raf = (...a) => globalThis.requestAnimationFrame(...a), caf = id => globalThis.cancelAnimationFrame?.(id), clock = () => performance.now() }) {
  const STEPS = [1, 2, 4, 8];
  let dir = 0, sp = 0, handle = 0, lastClock = 0, pos = 0, written = null;
  const up = s => STEPS[Math.min(STEPS.length - 1, STEPS.indexOf(s) + 1)];
  const speed = () => dir * sp;
  const changed = () => onChange?.(speed());
  const halt = () => { if (handle) caf(handle); handle = 0; };
  function stop({ pause: doPause = true } = {}) {
    if (!dir) return false;
    dir = 0; sp = 0; halt(); written = null;
    setPlaybackRate(baseRate()); if (doPause) pause();
    changed(); return true;
  }
  function loop() {
    handle = 0; if (dir >= 0) return;
    // dt cap: a throttled rAF (busy page, ~4/s) still walks back at real speed; only a long stall (hidden tab) is cut
    const c = clock(), dt = Math.min(0.25, Math.max(0, (c - lastClock) / 1000)); lastClock = c;
    // someone else moved the playhead (arrow keys, a click on the timeline): give it back to them
    if (written != null && Math.abs(now() - written) > 2 / (fps() || 30)) { stop(); return; }
    pos -= dt * sp;
    if (pos <= 0) { seek(0); stop(); return; }
    if (!seeking()) { seek(pos); written = now(); }
    handle = raf(loop);
  }
  return {
    forward() {
      if (dir > 0) sp = up(sp); else { halt(); dir = 1; sp = 1; written = null; }
      setPlaybackRate(sp); play(); changed();
    },
    reverse() {
      if (dir < 0) { sp = up(sp); changed(); return; }
      dir = -1; sp = 1; setPlaybackRate(baseRate()); pause();
      pos = now(); written = pos; lastClock = clock(); halt(); handle = raf(loop); changed();
    },
    stop,
    active: () => dir !== 0,
    speed,
  };
}

// tiny DOM helper (this module must stay importable in node for its tests: no app.js)
function el(tag, attrs = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) e.addEventListener(k.slice(2), v); else e.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat()) if (c != null && c !== false) e.append(c);
  return e;
}

// ctx: { now, dur, fps, frame, chunkSec, paused, seek, step, togglePlay, setRate, speeds, range, rangeOk, setIn, setOut,
//        clearRange, applyRange(aText, bText) → bool, noteForRange, loopOn, toggleLoop, muted, setMuted, volume, setVolume,
//        captionsAvailable, captionsOn, toggleCaptions, newNote, saveFrame, fullscreen, view /* tlview */, toast, host }
export function createTransport(ctx) {
  const fps = () => ctx.fps() || 30, V = ctx.view;
  const bt = (label, title, fn, pri, cls = 'tbtn') => el('button', { class: cls, title, 'data-pri': pri, onclick: fn }, label);
  const playBtn = bt('▶', 'Play / pause (Space)', () => ctx.togglePlay(), 9, 'play');
  playBtn.dataset.fitStatic = '';
  // timecode: a button showing where we are; click (or G) turns it into a field that takes any time form
  const tc = el('button', { class: 'tc', title: 'Go to time / frame (G): 1:23.4 · 83.4 · k1234 · +2 · −10f', 'data-pri': 9, 'data-fit-static': '', onclick: () => focusTime() });
  const tcIn = el('input', { class: 'tp-tcin', 'data-pri': 9, hidden: true, placeholder: '3:14.5 · 194.5 · k11640 · +2', spellcheck: 'false', autocomplete: 'off' });
  const speedSel = el('select', { title: 'Speed ([ / ])', 'data-pri': 6, onchange: () => ctx.setRate(+speedSel.value) }, (ctx.speeds || [1]).map(s => el('option', { value: s, selected: s === 1 }, s + '×')));
  const badge = el('span', { class: 'tp-shuttle', hidden: true, 'data-pri': 9, title: 'J / L: rewind / fast forward · K: stop' });
  // range (I/O): from one frame to another, typed or picked; loop it, or attach it to a note
  const rIn = bt('⟦ Range start', 'Start a range at this frame (I). Add a note, lower the music, or loop the selected range.', () => ctx.setIn(ctx.frame()), 7, 'tbtn kf');
  const rOut = bt('Range end ⟧', 'End the range at this frame (O)', () => ctx.setOut(ctx.frame()), 7, 'tbtn kf');
  const rInfo = el('button', { class: 'rinfo', 'data-pri': 8, title: 'Click to enter frame numbers', onclick: () => editRange() });
  const rA = el('input', { class: 'fin', inputmode: 'numeric', title: 'start frame (or 1:02.5)' }), rB = el('input', { class: 'fin', inputmode: 'numeric', title: 'end frame (or 1:04)' });
  const rEdit = el('span', { class: 'redit', 'data-pri': 8, hidden: true }, 'frame', rA, '→', rB, bt('OK', 'Apply range (Enter)', () => applyRange(), null));
  const rLoop = bt('⟲', 'Loop the range (\\ · Ctrl+L)', () => ctx.toggleLoop(), 7);
  const rNote = bt('+ Range note', 'Add a note for the selected range (N)', () => ctx.noteForRange(), 6, 'tbtn rnote');
  const rClear = bt('×', 'Clear the range', () => ctx.clearRange(), 7, 'tbtn ghost');
  // the range items are separate row children, so a narrow bar drops the least needed ones first (not the whole group)
  const rangeEls = [rIn, rInfo, rEdit, rOut, rLoop, rNote, rClear];
  // timeline zoom: slider 0–100 → span = dur·(2/dur)^(v/100); − + Fit; 📌 = the view follows the playhead
  const zSlider = el('input', { type: 'range', min: 0, max: 100, step: 1, value: 0, class: 'tl2-zoom', title: 'whole film' });
  const anchor = () => { const [a, b] = V.get(), t = ctx.now(); return t >= a && t <= b ? t : (a + b) / 2; };
  const zOut = bt('−', 'Timeline: zoom out', () => V.zoomBy(1.6, anchor()), null, 'tbtn ghost');
  const zIn = bt('+', 'Timeline: zoom in around the playhead', () => V.zoomBy(1 / 1.6, anchor()), null, 'tbtn ghost');
  const zFit = bt('All', 'Show the whole film in the timeline (Shift+Z · double-click)', () => V.fit(), null, 'tbtn ghost');
  const zPin = bt('📌', 'Follow: when zoomed in, advance the view as the playhead reaches the edge', () => V.setFollow(!V.followOn()), null, 'tbtn ghost tp-pin');
  const zoomGroup = el('span', { class: 'tp-zoom', 'data-pri': 4 }, zOut, zSlider, zIn, zFit, zPin);
  const noteBtn = bt('📝 Add note', 'Add a note at this frame (N)', () => ctx.newNote(), 8, 'tbtn tp-note');
  const ccBtn = bt('CC', 'Show narration text below the video (C)', () => ctx.toggleCaptions(), 6);
  ccBtn.hidden = true;
  const muteBtn = bt('🔊', 'Sound (U)', () => { ctx.setMuted(!ctx.muted()); update(); }, 8, 'tbtn ghost');
  const vol = el('input', { type: 'range', min: 0, max: 1, step: 0.05, value: 1, class: 'vol', title: 'Volume', 'data-pri': 2, oninput: () => { ctx.setVolume(+vol.value); update(); } });
  const more = el('button', { class: 'tbtn ghost rv2-more', title: 'More controls', hidden: true }, '⋯');
  const row = el('div', { class: 'rv2-transport' },
    bt('⏮', 'Go to start (Home)', () => ctx.seek(0), 5), bt('−5s', 'Back 5 s (Shift+←)', () => ctx.seek(ctx.now() - 5), 3),
    bt('◀︎|', 'Back 1 frame (←) · hold: rewind (J)', () => ctx.step(-1), 9), playBtn, bt('|▶︎', 'Forward 1 frame (→) · fast forward: L', () => ctx.step(1), 9),
    bt('+5s', 'Forward 5 s (Shift+→)', () => ctx.seek(ctx.now() + 5), 3), bt('⏭', 'Go to end (End)', () => ctx.seek(ctx.dur() - 1 / fps()), 5),
    tc, tcIn, speedSel, badge, ...rangeEls, el('span', { class: 'spacer' }), zoomGroup, noteBtn, ccBtn, muteBtn, vol,
    bt('📷', 'Save frame as an image', () => ctx.saveFrame(), 3), bt('⛶', 'Fullscreen (F)', () => ctx.fullscreen(), 7), more);

  // ---- timecode field
  let tcText = '', tcKey = '';
  function closeTime() { tcIn.hidden = true; tcIn.classList.remove('bad'); tc.hidden = false; }
  function focusTime() {
    tc.hidden = true; tcIn.hidden = false; tcIn.value = ''; tcIn.classList.remove('bad'); tcIn.focus();
  }
  tcIn.addEventListener('keydown', e => {
    e.stopPropagation();
    if (e.key === 'Escape') { e.preventDefault(); closeTime(); return; }
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const t = parseTime(tcIn.value, fps(), ctx.now());
    if (t == null) { tcIn.classList.add('bad'); ctx.toast?.('Invalid time: enter 1:23.4, 83.4, k1234 or +2', true); return; }
    closeTime(); ctx.seek(t);
  });
  tcIn.addEventListener('input', () => tcIn.classList.remove('bad'));
  tcIn.addEventListener('blur', () => closeTime());
  // the widest text this film can show, so the button never changes width while playing (fitRow would refit)
  function tcWidth() {
    const d = ctx.dur(), cs = ctx.chunkSec?.(), key = d + '|' + fps() + '|' + cs; if (key === tcKey) return; tcKey = key;
    const sample = `${fmtTC(d)} · frame ${Math.floor(d * fps())}${cs ? ' · chunk ' + Math.floor(d / cs) : ''}`;
    tc.style.minWidth = `calc(${sample.length}ch + 18px)`;
  }

  // ---- range edit: the frame fields, no draft needed; in a popover when the group sits in ⋯
  let rangePop = null;
  function editRange() {
    const R = ctx.range(), f = ctx.frame(); rA.value = R.a ?? f; rB.value = R.b ?? f;
    if (rInfo.classList.contains('fit-hide')) {
      rEdit.hidden = false;
      rangePop = openPop({ anchor: more.hidden ? row : more, host: ctx.host?.(), content: rEdit, onClose: () => { rangePop = null; rEdit.hidden = true; row.insertBefore(rEdit, rOut); } });
    } else { rInfo.hidden = true; rEdit.hidden = false; }
    rA.focus(); rA.select();
  }
  function closeRange() { if (rangePop) rangePop.close(); else { rEdit.hidden = true; rInfo.hidden = false; } }
  function applyRange() { if (ctx.applyRange(rA.value, rB.value)) closeRange(); }
  for (const inp of [rA, rB]) inp.addEventListener('keydown', e => {
    e.stopPropagation();
    if (e.key === 'Enter') { e.preventDefault(); applyRange(); }
    if (e.key === 'Escape') { e.preventDefault(); closeRange(); }
  });
  function updRange() {
    const { a, b } = ctx.range(), ok = ctx.rangeOk(), any = a != null || b != null;
    const txt = ok ? `frame ${a} → ${b} · ${((b - a + 1) / fps()).toFixed(2)} s` : any ? `frame ${a ?? '…'} → ${b ?? '…'}` : 'no range selected';
    if (rInfo.textContent !== txt) rInfo.textContent = txt;
    rInfo.classList.toggle('on', ok);
    setHidden(rLoop, !ok); setHidden(rNote, !ok); setHidden(rClear, !any); rLoop.classList.toggle('on', !!ctx.loopOn());
  }
  const setHidden = (e, on) => { if (e.hidden !== on) e.hidden = on; };

  // ---- zoom controls follow the view (whoever changed it: wheel, Z, slider)
  const span2v = () => { const d = ctx.dur(); if (!(d > 2)) return 0; return Math.round(100 * Math.log(V.span() / d) / Math.log(2 / d)); };
  function syncZoom() {
    const d = ctx.dur(); zSlider.disabled = !(d > 2);
    if (document.activeElement !== zSlider) zSlider.value = span2v();
    zSlider.title = V.label() + ' · Ctrl+wheel also zooms';
    zPin.classList.toggle('on', V.followOn());
    zPin.title = (V.followOn() ? 'Follow on' : 'Follow off') + ': when zoomed in, advance the view as the playhead reaches the edge';
  }
  zSlider.addEventListener('input', () => {
    const d = ctx.dur(); if (!(d > 2)) return;
    const v = +zSlider.value, span = d * Math.pow(2 / d, v / 100);
    if (v <= 0) V.fit(); else V.zoomTo(span, anchor());
  });
  zSlider.addEventListener('change', () => zSlider.blur());   // arrow keys go back to frame stepping
  const offView = V.onChange(syncZoom);

  // ---- per-frame update: text + button states only (cheap; nothing is measured)
  // nothing in ctx is called while building (the page defines some of it later); the first update syncs the rest
  let synced = false;
  function update(t = ctx.now()) {
    if (!synced) { synced = true; syncZoom(); updRange(); }
    tcWidth();
    const f = Math.floor(t * fps() + 1e-4), cs = ctx.chunkSec?.();
    const txt = `${fmtTC(t)} · frame ${f}${cs ? ' · chunk ' + Math.floor(t / cs) : ''}`;
    if (txt !== tcText) { tcText = txt; tc.textContent = txt; }
    const p = ctx.paused() ? '▶' : '⏸'; if (playBtn.textContent !== p) playBtn.textContent = p;
    const m = ctx.muted() || ctx.volume() === 0 ? '🔇' : '🔊'; if (muteBtn.textContent !== m) muteBtn.textContent = m;
    if (document.activeElement !== vol && Math.abs(+vol.value - ctx.volume()) > 0.001) vol.value = ctx.volume();
    setHidden(ccBtn, !ctx.captionsAvailable()); ccBtn.classList.toggle('on', !!ctx.captionsOn?.());
  }
  function setShuttle(s) {
    setHidden(badge, !s);
    if (s) { const txt = (s > 0 ? '▶▶ ' : '◀◀ ') + Math.abs(s) + '×'; if (badge.textContent !== txt) badge.textContent = txt; }
  }

  const fit = fitRow(row, { more, host: ctx.host?.() });
  return {
    el: row, update, focusTime, setShuttle, updRange, refit: fit.refit,
    rate: () => +speedSel.value,
    showRate(r) { const s = String(r); if ([...speedSel.options].some(o => o.value === s)) speedSel.value = s; },
    destroy() { fit.destroy(); offView(); rangePop?.close(); },
  };
}
