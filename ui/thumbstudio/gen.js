// Variants UI: the variants strip under the canvas and the big variant viewer (compare two, lay the layout over it,
// pin notes, "Send fixes to Claude", choose, delete). Images are made by Claude (hub_thumb_variant), never by VideoHub.
import { h, api, toast, confirmBox, AGO } from '../app.js';

const fileUrl = (pid, tid, f, v) => `/api/thumbstudio/${pid}/${tid}/file?f=${encodeURIComponent(f)}${v ? '&v=' + encodeURIComponent(v) : ''}`;
const NOTE_TR = { 'open': 'open', claude: 'with Claude', 'fixed': 'fixed' };

// ---------- variants strip (under the canvas)
export function createVariantStrip({ pid, tid, getBrief, onOpen }) {
  const el = h('div', { class: 'ts-variants' });
  function draw() {
    const brief = getBrief();
    const vs = brief.variants || [];
    el.innerHTML = '';
    el.append(h('div', { class: 'ts-variants-head' }, h('b', {}, 'VARIANTS'), h('span', { class: 'dim' }, vs.length ? ` ${vs.length}` : '')));
    const row = h('div', { class: 'ts-variants-row' });
    el.append(row);
    if (!vs.length) row.append(h('div', { class: 'dim ts-vempty' }, 'No variants yet. Press "💬 Send to Claude" and paste the message into a Claude chat: Claude makes the images and they show up here.'));
    let lastRound = null;
    for (const v of [...vs].reverse()) {
      if (v.round !== lastRound) { row.append(h('div', { class: 'ts-round' }, 'Round ' + v.round)); lastRound = v.round; }
      const open = (v.notes || []).filter(n => n.status === 'open').length;
      row.append(h('div', { class: 'ts-vcard' + (brief.chosen === v.id ? ' chosen' : ''), title: v.prompt || '', onclick: () => onOpen(v.id) },
        h('img', { src: fileUrl(pid, tid, v.file, v.hash || v.at), loading: 'lazy', alt: v.id }),
        h('div', { class: 'ts-vmeta' }, h('b', {}, v.id), v.parent ? h('span', { class: 'dim' }, ' ← ' + v.parent) : null,
          brief.chosen === v.id ? h('span', { class: 'ts-badge' }, '✓ chosen') : null,
          open ? h('span', { class: 'ts-badge warn' }, open + ' notes') : null,
          h('span', { class: 'dim', style: { marginLeft: 'auto' } }, v.by === 'claude' ? 'Claude' : v.by))));
    }
  }
  return { el, draw, dispose: () => { } };
}

// ---------- big variant viewer
export function openVariantViewer({ pid, tid, getBrief, vid, onChanged, onFix, onChoose, onFinal }) {
  const bg = h('div', { class: 'modal-bg ts-viewer-bg' });
  const box = h('div', { class: 'ts-viewer' });
  bg.append(box); document.body.append(bg);
  let cur = vid, compare = null, overlay = 0, draft = null;
  const close = () => { bg.remove(); window.removeEventListener('keydown', onKey, true); };
  const onKey = e => {
    if (e.key === 'Escape') { if (draft) { draft = null; draw(); } else close(); e.stopPropagation(); e.preventDefault(); }
    if (document.activeElement?.matches('input, textarea')) return;
    const vs = getBrief().variants || [];
    const i = vs.findIndex(v => v.id === cur);
    if (e.key === 'ArrowRight' && i < vs.length - 1) { cur = vs[i + 1].id; draw(); e.preventDefault(); e.stopPropagation(); }
    if (e.key === 'ArrowLeft' && i > 0) { cur = vs[i - 1].id; draw(); e.preventDefault(); e.stopPropagation(); }
  };
  window.addEventListener('keydown', onKey, true);
  bg.addEventListener('mousedown', e => { if (e.target === bg) close(); });

  function pane(v, withNotes) {
    const brief = getBrief();
    const wrap = h('div', { class: 'ts-vpane', style: { aspectRatio: brief.format === '9:16' ? '9 / 16' : '16 / 9' } });
    const img = h('img', { src: fileUrl(pid, tid, v.file, v.hash || v.at), draggable: false });
    wrap.append(img);
    if (overlay > 0) wrap.append(h('img', { class: 'ts-voverlay', src: fileUrl(pid, tid, 'layout.png', brief.exported || ''), style: { opacity: overlay } }));
    if (withNotes) {
      (v.notes || []).forEach((n, i) => wrap.append(h('div', { class: 'ts-pin' + (n.status === 'fixed' ? ' done' : ''), style: { left: n.x * 100 + '%', top: n.y * 100 + '%' }, title: n.text }, String(i + 1))));
      if (draft) {
        const ta = h('textarea', { rows: 2, placeholder: 'What should change? (Enter to save, Esc to cancel)' });
        const pop = h('div', { class: 'ts-notepop', style: { left: Math.min(draft.x, 0.7) * 100 + '%', top: Math.min(draft.y, 0.8) * 100 + '%' } }, ta);
        wrap.append(h('div', { class: 'ts-pin draft', style: { left: draft.x * 100 + '%', top: draft.y * 100 + '%' } }, '+'), pop);
        ta.addEventListener('keydown', async e => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            const text = ta.value.trim(); if (!text) return;
            const at = draft; draft = null;
            try { await api(`/api/thumbstudio/${pid}/${tid}/variant/${v.id}/note`, { method: 'POST', body: { x: at.x, y: at.y, text } }); await onChanged(); draw(); }
            catch (err) { toast('Could not save note: ' + err.message, true); }
          }
        });
        setTimeout(() => ta.focus(), 0);
      }
      wrap.addEventListener('click', e => {
        if (e.target.closest('.ts-notepop')) return;
        const r = wrap.getBoundingClientRect();
        draft = { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height };
        draw();
      });
    }
    return wrap;
  }

  function draw() {
    const brief = getBrief();
    const vs = brief.variants || [];
    const v = vs.find(x => x.id === cur);
    if (!v) { close(); return; }
    const other = compare && vs.find(x => x.id === compare);
    const notes = v.notes || [];
    const openNotes = notes.filter(n => n.status !== 'fixed');
    box.innerHTML = '';
    box.append(
      h('div', { class: 'ts-viewer-head row' },
        h('b', { style: { fontSize: '16px' } }, v.id), v.parent ? h('span', { class: 'dim' }, `revision of ${v.parent}`) : null,
        brief.chosen === v.id ? h('span', { class: 'ts-badge' }, '✓ chosen') : null,
        h('span', { class: 'dim' }, `${v.by === 'claude' ? 'Claude' : v.by} · ${AGO(v.at)} · ${v.w || '?'}×${v.h || '?'}`),
        h('span', { class: 'spacer' }),
        h('label', { class: 'row dim', title: 'Overlay the layout image: does the composition match?' }, 'Overlay layout',
          h('input', { type: 'range', min: 0, max: 80, value: Math.round(overlay * 100), oninput: e => { overlay = e.target.value / 100; box.querySelectorAll('.ts-voverlay').forEach(o => o.style.opacity = overlay); if (overlay && !box.querySelector('.ts-voverlay')) draw(); } })),
        h('select', { title: 'Compare side by side', onchange: e => { compare = e.target.value || null; draw(); e.target.blur(); } },
          h('option', { value: '' }, 'Compare…'), vs.filter(x => x.id !== v.id).map(x => h('option', { value: x.id, selected: x.id === compare }, x.id))),
        h('button', { class: 'ghost', onclick: close }, '✕')),
      h('div', { class: 'ts-viewer-body' + (other ? ' two' : '') }, pane(v, true), other ? pane(other, false) : null),
      h('div', { class: 'ts-viewer-foot' },
        h('div', { class: 'ts-notes' },
          notes.length ? notes.map((n, i) => h('div', { class: 'ts-note' + (n.status === 'fixed' ? ' done' : '') },
            h('span', { class: 'ts-pin static' }, String(i + 1)),
            h('span', {}, n.text), h('span', { class: 'dim' }, ` · ${n.where || ''} · ${NOTE_TR[n.status] || n.status}`),
            h('span', { class: 'spacer' }),
            h('button', { class: 'ghost', title: n.status === 'fixed' ? 'Reopen' : 'Mark as fixed', onclick: async () => { await api(`/api/thumbstudio/${pid}/${tid}/variant/${v.id}/note/${n.id}`, { method: 'POST', body: { status: n.status === 'fixed' ? 'open' : 'fixed' } }); await onChanged(); draw(); } }, n.status === 'fixed' ? '↺' : '✓'),
            h('button', { class: 'ghost', title: 'Delete note', onclick: async () => { await api(`/api/thumbstudio/${pid}/${tid}/variant/${v.id}/note/${n.id}`, { method: 'POST', body: { remove: true } }); await onChanged(); draw(); } }, '🗑')))
            : h('div', { class: 'dim' }, 'Click the image and describe what should change. Then "Send fixes to Claude" asks Claude to change only those areas. (← → other variants)')),
        h('div', { class: 'row', style: { gap: '8px' } },
          h('button', { class: 'ghost danger', onclick: async () => {
            if (!await confirmBox('Delete variant', h('div', {}, `${v.id} will be moved to the Recycle Bin.`), 'Delete')) return;
            try { await api(`/api/thumbstudio/${pid}/${tid}/variant/${v.id}/delete`, { method: 'POST' }); await onChanged(); const rest = getBrief().variants || []; if (!rest.length) close(); else { cur = rest[rest.length - 1].id; draw(); } }
            catch (e) { toast('Could not delete: ' + e.message, true); }
          } }, '🗑 Delete'),
          h('button', { class: 'ghost', onclick: () => api(`/api/thumbstudio/${pid}/${tid}/open-folder`, { method: 'POST', body: { file: v.file } }).catch(e => toast(e.message, true)) }, '📂 Show in folder'),
          h('span', { class: 'spacer' }),
          h('button', { disabled: !openNotes.length, title: openNotes.length ? 'Copies a message for Claude: this variant is the reference and only the areas in your notes change' : 'Add a note on the image first', onclick: async () => { const ok = await onFix(v, openNotes); if (ok) close(); } }, `🔧 Send fixes to Claude${openNotes.length ? ` (${openNotes.length})` : ''}`),
          brief.chosen === v.id
            ? h('button', { class: 'primary', onclick: () => { close(); onFinal(); } }, 'Go to final →')
            : h('button', { class: 'primary', onclick: async () => { await onChoose(v.id); draw(); } }, '✓ Choose this'))));
  }
  draw();
  return { redraw: draw, close };
}

// the variant image with red numbered circles at the notes (2nd reference of an edit)
export async function markedImage(src, notes) {
  const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; });
  const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight;
  const ctx = c.getContext('2d');
  ctx.drawImage(img, 0, 0);
  const r = Math.max(18, c.width * 0.025);
  notes.forEach((n, i) => {
    const x = n.x * c.width, y = n.y * c.height;
    ctx.lineWidth = r * 0.22; ctx.strokeStyle = '#ff1f1f';
    ctx.beginPath(); ctx.arc(x, y, r * 2.2, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = '#ff1f1f'; ctx.beginPath(); ctx.arc(x + r * 2.2, y - r * 2.2, r, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.font = `bold ${Math.round(r * 1.2)}px sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(String(i + 1), x + r * 2.2, y - r * 2.2);
  });
  return c.toDataURL('image/png');
}

export { fileUrl };
