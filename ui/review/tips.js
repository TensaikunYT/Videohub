// Quick tooltips for the editor: every button / field with a `title` shows it in a styled bubble after 250 ms
// (the browser's own tooltip waits ~1 s and is easy to miss, so icon-only buttons stayed a riddle).
// The title moves to data-vhtip while the pointer is on the element, so the native one does not show twice.
export function installTips(root, host = () => root) {
  const bub = document.createElement('div');
  bub.className = 'vh-tip';
  bub.hidden = true;
  let cur = null, timer = 0;
  function hide() {
    clearTimeout(timer); bub.hidden = true;
    if (cur && cur.dataset.vhtip != null) { cur.title = cur.dataset.vhtip; delete cur.dataset.vhtip; }
    cur = null;
  }
  function show() {
    if (!cur || !cur.isConnected) return;
    const text = cur.dataset.vhtip; if (!text) return;
    const h = host(); if (bub.parentNode !== h) h.append(bub);
    bub.textContent = text; bub.hidden = false;
    const r = cur.getBoundingClientRect(), b = bub.getBoundingClientRect(), W = innerWidth, H = innerHeight;
    // below the element when there is room, else above; inside the window
    let top = r.bottom + 6; if (top + b.height > H - 4) top = r.top - b.height - 6;
    let left = r.left + r.width / 2 - b.width / 2; left = Math.max(4, Math.min(W - b.width - 4, left));
    // tool rail buttons: to the right (their neighbours above and below would be covered)
    if (cur.closest('.rv2-tools')) { left = r.right + 8; top = r.top + r.height / 2 - b.height / 2; }
    bub.style.left = left + 'px'; bub.style.top = Math.max(4, top) + 'px';
  }
  const onOver = (e) => {
    const el = e.target.closest?.('[title]');
    if (el === cur) return;
    hide();
    if (!el || !root.contains(el) || !el.title || el.tagName === 'CANVAS' || el.title.trim() === el.textContent.trim()) return;
    cur = el; el.dataset.vhtip = el.title; el.title = '';
    timer = setTimeout(show, 250);
  };
  const onOut = (e) => { if (cur && !cur.contains(e.relatedTarget)) hide(); };
  root.addEventListener('pointerover', onOver);
  root.addEventListener('pointerout', onOut);
  root.addEventListener('pointerdown', hide, true);
  return () => { hide(); root.removeEventListener('pointerover', onOver); root.removeEventListener('pointerout', onOut); root.removeEventListener('pointerdown', hide, true); bub.remove(); };
}
