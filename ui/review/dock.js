// Editor layout helpers (P1, no-scroll editor): safe storage, drag splitters that write a CSS length var,
// a one-line row that hides its least important children into a "⋯" menu, and a small popover.
// No imports: the pure parts are tested in node (dock.test.js).

// localStorage that never throws (private window, blocked site data); values are JSON
export const ls = {
  get(k, d) { try { const v = globalThis.localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { if (v == null) globalThis.localStorage.removeItem(k); else globalThis.localStorage.setItem(k, JSON.stringify(v)); } catch { } },
};

export const clampPx = (v, min, max) => Math.round(Math.max(min, Math.min(Math.max(min, max), v)));

// which children to hide first: lowest priority, ties rightmost first; 9+ or no priority never; items = [{ pri, idx }]
export function hideOrder(items) {
  return items.filter(it => Number.isFinite(it.pri) && it.pri < 9).sort((a, b) => a.pri - b.pri || b.idx - a.idx).map(it => it.idx);
}

const el = (tag, cls, attrs = {}) => { const e = document.createElement(tag); if (cls) e.className = cls; for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); return e; };

// Drag handle that writes a CSS length var on `root`. axis 'y': dragging up grows; 'x': dragging left grows.
// `want` is what the user asked for (saved); the applied value is `want` clamped to [min, max()] now, so a
// window that grows back gives the user's size back.
export function createSplitter({ root, cssVar, axis = 'y', key, def, min = 0, max = () => Infinity, onChange }) {
  const handle = el('div', 'rv2-split', { 'data-axis': axis, role: 'separator', 'aria-orientation': axis === 'y' ? 'horizontal' : 'vertical', title: 'Drag to resize · double-click to reset' });
  let want = key ? ls.get(key, null) : null, val = null, drag = null;
  if (!Number.isFinite(want)) want = null;
  function apply(v) {
    const nv = clampPx(v, min, max());
    if (nv === val) return;
    val = nv; root.style.setProperty(cssVar, val + 'px'); handle.setAttribute('aria-valuenow', val); onChange?.(val);
  }
  const clamp = () => apply(want ?? def());
  const pos = e => axis === 'y' ? e.clientY : e.clientX;
  handle.addEventListener('pointerdown', e => {
    if (e.button !== 0) return;
    e.preventDefault(); handle.setPointerCapture(e.pointerId); handle.classList.add('drag');
    drag = { p: pos(e), v: val ?? (want ?? def()) };
  });
  handle.addEventListener('pointermove', e => { if (!drag) return; want = drag.v + (drag.p - pos(e)); apply(want); });
  const end = () => { if (!drag) return; drag = null; handle.classList.remove('drag'); want = val; if (key) ls.set(key, val); };
  handle.addEventListener('pointerup', end); handle.addEventListener('pointercancel', end);
  const reset = () => { want = null; if (key) ls.set(key, null); clamp(); };
  handle.addEventListener('dblclick', reset);
  const onResize = () => clamp();
  window.addEventListener('resize', onResize);
  return {
    el: handle, clamp, reset, get: () => val,
    set(px) { want = px; apply(px); if (key) ls.set(key, val); },
    destroy() { window.removeEventListener('resize', onResize); },
  };
}

// Small popover next to `anchor`, appended to `host` (position: fixed, so overflow:hidden parents never cut it).
// Closes on Esc, on a click outside, or through the returned close().
export function openPop({ anchor, host, content, side = 'below', onClose }) {
  const pop = el('div', 'rv2-pop'); pop.append(content);
  (host || document.body).append(pop);
  const r = anchor.getBoundingClientRect(), pw = pop.offsetWidth, ph = pop.offsetHeight;
  let x = side === 'right' ? r.right + 6 : r.right - pw, y = side === 'right' ? r.top : r.bottom + 6;
  x = Math.max(4, Math.min(innerWidth - pw - 4, x)); y = Math.max(4, Math.min(innerHeight - ph - 4, y));
  pop.style.left = x + 'px'; pop.style.top = y + 'px';
  const close = () => { if (!pop.isConnected) return; pop.remove(); document.removeEventListener('pointerdown', outside, true); document.removeEventListener('keydown', onKey, true); onClose?.(); };
  const outside = e => { if (!pop.contains(e.target) && !anchor.contains(e.target)) close(); };
  const onKey = e => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); } };
  setTimeout(() => { if (pop.isConnected) document.addEventListener('pointerdown', outside, true); }, 0);
  document.addEventListener('keydown', onKey, true);
  return { el: pop, close };
}

// Hide children of a one-line row by priority until it fits; hidden ones go into the "⋯" menu at the end.
// Children carry data-pri (1 = hide first); children without it never hide. Hiding uses a class, so the app's own
// `hidden` attribute stays its own business.
export function fitRow(row, { more, host }) {
  let hiddenEls = [], pop = null, raf = 0;
  function refit() {
    raf = 0;
    for (const c of hiddenEls) c.classList.remove('fit-hide');
    hiddenEls = []; more.hidden = true;
    if (row.scrollWidth <= row.clientWidth + 1) return;
    more.hidden = false;
    const kids = [...row.children].filter(c => c !== more);
    const order = hideOrder(kids.map((c, idx) => ({ pri: c.dataset.pri != null ? +c.dataset.pri : NaN, idx })));
    for (const i of order) {
      if (row.scrollWidth <= row.clientWidth + 1) break;
      const c = kids[i]; if (c.hidden) continue;
      c.classList.add('fit-hide'); hiddenEls.push(c);
    }
    if (!hiddenEls.length) more.hidden = true;
  }
  const later = () => { if (!raf) raf = requestAnimationFrame(refit); };
  // a menu entry for a hidden child: buttons click the original, selects mirror it, groups list their buttons
  function entries(c) {
    if (c.tagName === 'SELECT') {
      const s = c.cloneNode(true); s.value = c.value; s.removeAttribute('class');
      s.addEventListener('change', () => { c.value = s.value; c.dispatchEvent(new Event('change', { bubbles: true })); pop?.close(); });
      return [s];
    }
    // a slider (volume, timeline zoom): a live copy that drives the original
    const slider = r => {
      const s = r.cloneNode(true); s.value = r.value; s.removeAttribute('class'); s.title = r.title || ''; s.disabled = !!r.disabled;
      s.addEventListener('input', () => { r.value = s.value; r.dispatchEvent(new Event('input', { bubbles: true })); });
      return s;
    };
    if (c.tagName === 'INPUT' && c.type === 'range') return [slider(c)];
    const btns = c.tagName === 'BUTTON' || c.tagName === 'A' ? [c] : [...c.querySelectorAll('button, input[type=range]')];
    const list = btns.length ? btns : [c];
    return list.filter(b => !b.hidden).map(b => {
      if (b.tagName === 'INPUT') return slider(b);
      const x = el('button', 'ghost' + (b.classList.contains('on') ? ' on' : ''));
      // a bare symbol (⏮, −, 📌) says little in a list: its title goes next to it
      const t = (b.textContent || '').trim();
      x.textContent = !t ? (b.title || '…') : [...t].length <= 3 && b.title ? `${t}  ${b.title}` : t;
      if (b.title) x.title = b.title; x.disabled = !!b.disabled;
      x.addEventListener('click', () => { pop?.close(); b.click(); });
      return x;
    });
  }
  more.addEventListener('click', () => {
    if (pop) { pop.close(); return; }
    const box = el('div', 'rv2-morelist');
    for (const c of row.children) if (hiddenEls.includes(c) && !c.hidden) box.append(...entries(c));   // in bar order
    pop = openPop({ anchor: more, host, content: box, onClose: () => { pop = null; } });
  });
  const ro = new ResizeObserver(later); ro.observe(row);
  // the app shows/hides buttons and changes their text (render progress): refit on those too; text changes inside a
  // [data-fit-static] element (fixed width, e.g. the transport's timecode, rewritten every frame) never refit
  const isStatic = r => r.type !== 'attributes' && !!(r.target.nodeType === 1 ? r.target : r.target.parentElement)?.closest?.('[data-fit-static]');
  const mo = new MutationObserver(recs => { if (recs.some(r => !isStatic(r))) later(); });
  mo.observe(row, { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden'], characterData: true });
  later();
  return { refit: later, destroy() { ro.disconnect(); mo.disconnect(); cancelAnimationFrame(raf); pop?.close(); } };
}
