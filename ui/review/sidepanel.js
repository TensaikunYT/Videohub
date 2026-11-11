// The editor's right-hand panel: tabs (Notes / Sounds / Clip, plus one per open editor) over one pane each,
// and a footer that stays visible on every tab ("Send to Claude"). Only the current pane is shown.
import { ls } from './dock.js';

const mk = (tag, cls, attrs = {}) => { const e = document.createElement(tag); if (cls) e.className = cls; for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); return e; };

export function createSidePanel({ tabs = [], foot = null, key = 'vh-side-tab' }) {
  const nav = mk('nav', 'rv2-tabs', { role: 'tablist' }), body = mk('div', 'rv2-tabbody'), footer = mk('footer', 'rv2-sidefoot');
  if (foot) footer.append(foot); else footer.hidden = true;
  const el = mk('aside', 'rv2-side'); el.append(nav, body, footer);
  const T = new Map();   // id → { btn, pane, badge }
  const keep = new Set(tabs.map(t => t.id));   // only the fixed tabs are remembered (an editor tab is gone after a reload)
  let cur = null, hist = [];

  function show(id) {
    const t = T.get(id); if (!t) return;
    hist = hist.filter(x => x !== id); hist.push(id);
    if (cur === id) return;
    cur = id;
    for (const [k, x] of T) { const on = k === id; x.btn.classList.toggle('on', on); x.btn.setAttribute('aria-selected', on ? 'true' : 'false'); x.pane.classList.toggle('on', on); }
    if (keep.has(id)) ls.set(key, id);
    reveal();
  }
  // keep the active tab fully inside the (scrollbar-less) strip
  function reveal() {
    const b = T.get(cur)?.btn; if (!b || nav.scrollWidth <= nav.clientWidth) return;
    const nb = nav.getBoundingClientRect(), bb = b.getBoundingClientRect();
    const l = bb.left - nb.left + nav.scrollLeft, r = l + bb.width;
    if (l < nav.scrollLeft) nav.scrollLeft = l - 4;
    else if (r > nav.scrollLeft + nav.clientWidth) nav.scrollLeft = r - nav.clientWidth + 4;
  }
  // a plain (vertical) wheel scrolls the strip sideways
  nav.addEventListener('wheel', (e) => {
    if (nav.scrollWidth <= nav.clientWidth || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
    nav.scrollLeft += e.deltaY; e.preventDefault();
  }, { passive: false });
  // the strip's width changes with the side splitter
  const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(() => reveal()) : null;
  ro?.observe(nav);
  function add({ id, label, el: content }, { select = false } = {}) {
    if (T.has(id)) { if (select) show(id); return; }
    const lab = mk('span', 'rv2-tlab'); lab.textContent = label;
    const badge = mk('span', 'rv2-badge'); badge.hidden = true;
    const btn = mk('button', keep.has(id) ? 'rv2-tab' : 'rv2-tab rv2-tab-x', { 'data-id': id, role: 'tab', 'aria-selected': 'false', type: 'button', title: label }); btn.append(lab, badge);
    btn.addEventListener('click', () => show(id));
    const pane = mk('section', 'rv2-pane', { 'data-id': id, role: 'tabpanel' }); if (content) pane.append(content);
    nav.append(btn); body.append(pane); T.set(id, { btn, pane, badge });
    if (select || !cur) show(id);
  }
  function remove(id) {
    const t = T.get(id); if (!t) return;
    t.btn.remove(); t.pane.remove(); T.delete(id); hist = hist.filter(x => x !== id);
    if (cur === id) { cur = null; const back = hist.slice().reverse().find(x => T.has(x)) || T.keys().next().value; if (back) show(back); }
  }
  for (const t of tabs) add(t);
  const saved = ls.get(key, null);
  if (saved && T.has(saved)) show(saved);

  return {
    el, show, add, remove, has: id => T.has(id), current: () => cur,
    setBadge(id, n) { const t = T.get(id); if (!t) return; t.badge.textContent = n === '' || n == null ? '' : String(n); t.badge.hidden = !t.badge.textContent; },
    destroy() { ro?.disconnect(); T.clear(); el.remove(); },
  };
}
