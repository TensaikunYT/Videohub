// Notes panel: the draft note being written, the list of notes, edits, statuses, "send to Claude".
import { h, api, toast, confirmBox, pill, TC, AGO } from '../app.js';

// Element.append prints null/false as text; this skips them like h() does.
const put = (el, ...kids) => { for (const c of kids.flat(Infinity)) if (c != null && c !== false) el.append(c); return el; };
const KINDS = ['visual', 'timing', 'sound', 'text', 'general'];
// a note's range in frames (inclusive), or null
const framesOf = (n, fps) => n.t2 == null ? null : (n.frames || [Math.floor(n.t * (n.fps || fps) + 1e-6), Math.floor(n.t2 * (n.fps || fps) + 1e-6)]);
const STATUS_LABEL = { 'open': 'open', claude: "with Claude", 'fixed': '✓ fixed', 'approved': 'approved', 'reopened': 'still there' };

export function createNotesPanel(ctx) {
  const filterSel = h('select', { onchange: () => render() }, h('option', { value: 'open' }, 'Open'), h('option', { value: 'fixed' }, 'Fixed'), h('option', { value: 'all' }, 'All'), h('option', { value: 'file' }, 'This version'));
  const composerBox = h('div', {}), list = h('div', { class: 'rv2-list' });
  const draftsBox = h('div', { class: 'rv2-drafts', hidden: true });
  const sendBtn = h('button', { class: 'primary', onclick: send });
  const tourBtn = h('button', { class: 'tourbtn', hidden: true, title: 'Review Claude\'s fixes one by one: before/after, approve or mark as still there', onclick: () => ctx.startTour() });
  // notes written before the newest version, cleared in one go (approve all, or take them off the list into the archive)
  const oldBar = h('div', { class: 'rv2-oldbar', hidden: true });
  const el = h('div', { class: 'rv2-notes' },
    h('div', { class: 'rv2-nhead' }, h('b', {}, 'Notes'), tourBtn, h('span', { class: 'spacer' }), filterSel),
    h('div', { class: 'rv2-nfoot' }, sendBtn), oldBar, draftsBox, composerBox, list);
  // pictures the user opened (a card is rebuilt when its note changes; keep it open)
  const openImg = new Set();
  // notes written before the newest version: asked from the hub when the list is loaded or changed in bulk,
  // not on every render (new notes are never old)
  let oldIds = [], oldAsked = false;
  async function refreshOld() {
    oldAsked = true;
    try { oldIds = await api(`/api/project/${ctx.projectId}/notes/old`); } catch { oldIds = []; }
    drawOld();
  }
  function drawOld() {
    const live = new Set(ctx.notes().map(n => n.id)); oldIds = oldIds.filter(i => live.has(i));
    const unapproved = ctx.notes().filter(n => oldIds.includes(n.id) && n.status !== 'approved').length;
    oldBar.hidden = !oldIds.length; oldBar.innerHTML = '';
    if (!oldIds.length) return;
    put(oldBar, h('span', {}, `Old notes: ${oldIds.length}`, h('span', { class: 'dim' }, ' · written before the latest version')), h('span', { class: 'spacer' }),
      unapproved ? h('button', { onclick: () => bulk('approve') }, `✓ Approve all (${unapproved})`) : null,
      h('button', { class: 'danger', onclick: () => bulk('remove') }, '🗑 Remove all'));
  }
  async function bulk(action) {
    const ids = oldIds.slice();
    const ok = await confirmBox(action === 'approve' ? `Approve ${ids.length} old notes?` : `Remove ${ids.length} old notes from the list?`,
      h('p', {}, action === 'approve' ? 'All will be marked as "approved" and their frame images deleted; their text will still appear under the "All" filter.' : 'The notes will be removed from the list and their images deleted. Their text stays in the project\'s .videohub\\notes-archive.json file.'),
      action === 'approve' ? 'Approve' : 'Remove');
    if (!ok) return;
    const r = await api(`/api/project/${ctx.projectId}/notes/bulk`, { method: 'POST', body: { action, ids } });
    toast(`${r.count} notes ${action === 'approve' ? 'approved' : 'removed'}${r.freed ? ` · ${(r.freed / 1048576).toFixed(1)} MB freed` : ''}`);
    await ctx.reloadNotes();
  }
  let editing = null;

  // ---------- draft composer
  function renderDrafts() {
    const drafts = ctx.parkedDrafts?.() || [];
    draftsBox.hidden = !drafts.length;
    draftsBox.replaceChildren();
    if (!drafts.length) return;
    draftsBox.append(h('b', {}, `Unsaved drafts (${drafts.length})`));
    for (const entry of drafts) draftsBox.append(h('button', {
      class: 'ghost',
      title: 'Open this draft and return to its frame',
      onclick: () => ctx.restoreDraft(entry)
    }, `${TC(entry.draft.frame / ctx.fps())} · ${(entry.draft.text || '').trim().slice(0, 48) || 'Note with drawing'}`));
  }
  let comp = null;
  // which sound layer the note is about (only when the film has layers)
  const layerPick = d => { const L = ctx.layers?.() || []; if (!L.length) return null; return h('select', { class: 'layerpick', title: 'Which sound layer is this note about?', onchange: e => { d.layer = e.target.value || null; } }, h('option', { value: '' }, 'layer: —'), L.map(x => h('option', { value: x, selected: d.layer === x }, 'layer: ' + x))); };
  function openComposer(focus = true) {
    const d = ctx.draft(); if (!d) return closeComposer();
    if (comp) return updateComposer();
    const chips = KINDS.map(k => h('span', { class: 'chip' + (k === d.kind ? ' on' : ''), onclick: e => { d.kind = k; chips.forEach(c => c.classList.remove('on')); e.target.classList.add('on'); } }, k));
    // range: the selected I/O range (shared with the transport and the timeline), editable as frame numbers
    const rangeChk = h('input', { type: 'checkbox', onchange: () => {
      if (rangeChk.checked) { d.useRange = true; if (!ctx.rangeOk()) ctx.setRange(d.frame, d.frame + Math.round(2 * ctx.fps())); }
      else d.useRange = false;
      updateComposer();
    } });
    const inA = h('input', { class: 'fin', inputmode: 'numeric', title: 'first frame (or 1:02.5)' }), inB = h('input', { class: 'fin', inputmode: 'numeric', title: 'last frame (or 1:04)' });
    const applyIn = () => {
      const a = ctx.parseFrame(inA.value), b = ctx.parseFrame(inB.value);
      if (a == null || b == null) { toast('Enter a frame number (e.g. 186) or time (e.g. 1:02.5).', true); return; }
      d.useRange = true; ctx.setRange(a, b);
    };
    for (const inp of [inA, inB]) { inp.addEventListener('change', applyIn); inp.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter') { e.preventDefault(); applyIn(); } }); }
    const nowA = h('button', { class: 'ghost', title: 'First frame = current player frame', onclick: () => { d.useRange = true; const r = ctx.range(); ctx.setRange(ctx.frame(), r.b ?? ctx.frame()); } }, 'start = now');
    const nowB = h('button', { class: 'ghost', title: 'Last frame = current player frame', onclick: () => { d.useRange = true; const r = ctx.range(); ctx.setRange(r.a ?? ctx.frame(), ctx.frame()); } }, 'end = now');
    const rangeLen = h('span', { class: 'muted' });
    const rangeBox = h('div', { class: 'rbox' }, h('div', { class: 'rrow' }, 'frame', inA, '→', inB, rangeLen),
      h('div', { class: 'row' }, nowA, nowB, h('span', { class: 'dim', style: { fontSize: '11.5px' } }, 'seek to a frame, then click now · or use I / O')));
    const text = h('textarea', { placeholder: 'What is wrong, and how should it look? (e.g. the sign is floating; place it against the wall)', onkeydown: e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); save(); } if (e.key === 'Escape') { e.preventDefault(); text.blur(); } } });
    text.value = d.text || ''; text.oninput = () => { d.text = text.value; };
    const head = h('div', { class: 'rv2-chead' }), back = h('button', { class: 'ghost', onclick: () => ctx.gotoDraft() }, 'Return to this frame');
    const shapesInfo = h('span', { class: 'dim' });
    comp = { text, head, back, shapesInfo, rangeChk, inA, inB, rangeLen, rangeBox };
    composerBox.append(h('div', { class: 'rv2-composer' }, head,
      h('label', { class: 'row', style: { gap: '6px' } }, rangeChk, 'Range (from frame to frame)'), rangeBox,
      h('div', { class: 'chips' }, chips, layerPick(d)), text,
      h('div', { class: 'row' }, shapesInfo, h('span', { class: 'spacer' }), h('button', { onclick: () => ctx.cancelDraft() }, 'Cancel'), h('button', { class: 'primary', onclick: save }, 'Save')),
      h('div', { class: 'dim', style: { fontSize: '11.5px' } }, 'Draw on the frame with the tools on the left · click the box to type · Enter to save · Win+H to dictate')));
    updateComposer();
    if (focus) setTimeout(() => { if (!document.activeElement || document.activeElement === document.body) text.focus(); }, 20);
  }
  function updateComposer() {
    const d = ctx.draft(); if (!d || !comp) return;
    const cs = ctx.chunkSec();
    comp.head.innerHTML = '';
    comp.head.append(h('b', {}, `New note · ${TC(d.frame / ctx.fps())}`), h('span', { class: 'muted' }, ` frame ${d.frame}${cs ? ' · chunk ' + Math.floor(d.t / cs) : ''}`), h('span', { class: 'spacer' }), ctx.atDraft() ? '' : comp.back);
    const r = ctx.range(), on = !!d.useRange && ctx.rangeOk();
    comp.rangeChk.checked = on; comp.rangeBox.hidden = !d.useRange;
    if (document.activeElement !== comp.inA) comp.inA.value = r.a ?? '';
    if (document.activeElement !== comp.inB) comp.inB.value = r.b ?? '';
    comp.rangeLen.textContent = on ? `${r.b - r.a + 1} frames · ${((r.b - r.a + 1) / ctx.fps()).toFixed(2)} s` : '';
    comp.shapesInfo.textContent = d.shapes.length ? `${d.shapes.length} drawings` : 'no drawings';
  }
  function closeComposer() { comp = null; composerBox.innerHTML = ''; }
  async function save() {
    const d = ctx.draft(); if (!d) return;
    if (!(d.text || '').trim() && !d.shapes.length) { toast('Write something or draw on the frame.', true); comp?.text.focus(); return; }
    await ctx.saveDraft();
  }

  // ---------- list
  async function setStatus(n, status) { const r = await api(`/api/project/${ctx.projectId}/note/${n.id}`, { method: 'POST', body: { status } }); Object.assign(n, r); ctx.changed(); }
  function card(n) {
    const other = n.file && n.file !== ctx.file();
    const cardEl = h('div', { class: 'nc' + (n.id === ctx.selected() ? ' sel' : ''), 'data-id': n.id, onclick: () => { if (editing === n.id) return; ctx.selectNote(n.id); ctx.seek(n.at ?? n.t); } });   // while editing, clicks belong to the edit box (a re-render would throw the typing away)
    if (editing === n.id) {
      const ta = h('textarea', { onkeydown: e => e.stopPropagation() }); ta.value = n.text;
      setTimeout(() => { ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); }, 30);
      const nf = n.fps || ctx.fps(), fr0 = framesOf(n, ctx.fps());
      const eA = h('input', { class: 'fin', inputmode: 'numeric', value: fr0 ? fr0[0] : '' }), eB = h('input', { class: 'fin', inputmode: 'numeric', value: fr0 ? fr0[1] : '' });
      for (const inp of [eA, eB]) inp.addEventListener('keydown', e => e.stopPropagation());
      const rangePatch = () => {
        const a = ctx.parseFrame(eA.value), b = ctx.parseFrame(eB.value), at = n.at ?? n.t;
        if (a == null && b == null) return fr0 ? { t: at, t2: null, at: null } : {};   // range removed
        if (a == null || b == null) throw new Error('Enter both frames for a range (or leave both blank).');
        const [x, y] = a <= b ? [a, b] : [b, a];
        if (fr0 && fr0[0] === x && fr0[1] === y) return {};
        return { t: (x + 0.5) / nf, t2: (y + 0.5) / nf, at, ...(n.file === '~live' && ctx.liveCapture ? { images: ctx.liveCapture(x, y) } : {}) };
      };
      let kind = n.kind; const chips = KINDS.map(k => h('span', { class: 'chip' + (k === kind ? ' on' : ''), onclick: e => { e.stopPropagation(); kind = k; chips.forEach(c => c.classList.remove('on')); e.target.classList.add('on'); } }, k));
      put(cardEl, h('div', { class: 'hd' }, h('b', { class: 'mono' }, '#' + n.id), h('span', { class: 'mono' }, TC(n.t))), h('div', { class: 'chips' }, chips), ta,
        h('div', { class: 'rrow', onclick: e => e.stopPropagation() }, 'range: frame', eA, '→', eB, h('span', { class: 'dim', style: { fontSize: '11.5px' } }, 'blank = no range')),
        h('div', { class: 'acts', onclick: e => e.stopPropagation() }, h('button', { onclick: () => { editing = null; render(); } }, 'Cancel'),
          h('button', { class: 'primary', onclick: async () => {
            let rp; try { rp = rangePatch(); } catch (e) { toast(e.message, true); return; }
            const r = await api(`/api/project/${ctx.projectId}/note/${n.id}`, { method: 'POST', body: { text: ta.value.trim(), kind, ...rp } });
            for (const k of Object.keys(n)) if (!(k in r)) delete n[k];
            Object.assign(n, r); editing = null; ctx.changed();
          } }, 'Save')));
      return cardEl;
    }
    put(cardEl, 
      h('div', { class: 'hd' }, h('b', { class: 'mono' }, '#' + n.id), h('span', { class: 'mono' }, TC(n.t) + (n.t2 != null ? '–' + TC(n.t2) : '')), h('span', {}, n.kind + (n.layer ? ' · ' + n.layer : '')), h('span', { class: 'spacer' }), pill(n.status, STATUS_LABEL[n.status] || n.status)),
      n.text ? h('div', { class: 'tx' }, n.text) : null,
      n.say ? h('div', { class: 'say', title: 'Narration at the time of the note' }, '«' + n.say + '»') : null,
      framesOf(n, ctx.fps()) ? h('div', { class: 'rline' }, (([a, b]) => `range: frame ${a} → ${b} · ${((b - a + 1) / (n.fps || ctx.fps())).toFixed(2)} s`)(framesOf(n, ctx.fps())),
        h('button', { class: 'ghost', onclick: e => { e.stopPropagation(); ctx.playRange(n); } }, '▶ play')) : null,
      n.images?.crop || n.images?.annotated ? h('div', {
        class: 'nimg' + (openImg.has(n.id) ? ' open' : ''), title: 'Expand / collapse frame image',
        onclick: e => { e.stopPropagation(); const o = e.currentTarget.classList.toggle('open'); o ? openImg.add(n.id) : openImg.delete(n.id); }
      }, h('img', { src: `/api/project/${ctx.projectId}/noteimg/${n.id}/${n.images.crop ? 'crop' : 'annotated'}?v=${n.imgV || 0}`, loading: 'lazy' }), h('span', { class: 'nimg-lab' }, '🖼 frame image'))
        : n.pending && n.drawing?.length ? h('div', { class: 'dim', style: { fontSize: '11.5px' } }, 'preparing frame image…') : null,
      other ? h('div', { class: 'dim', style: { fontSize: '12px' } }, n.file === '~live' ? 'in live preview (no render)' : `on "${n.file}"`) : null,
      n.reply ? h('div', { class: 'reply' }, h('b', {}, 'Claude: '), n.reply, n.fixedIn ? h('span', { class: 'dim' }, ` (${n.fixedIn})`) : null) : null,
      h('div', { class: 'acts', onclick: e => e.stopPropagation() },
        n.status === 'fixed' ? [h('button', { onclick: () => setStatus(n, 'approved') }, '✓ Approve'), h('button', { class: 'danger', onclick: () => setStatus(n, 'reopened') }, 'Still there')] : null,
        n.status === 'approved' ? h('button', { onclick: () => setStatus(n, 'reopened') }, 'Reopen') : null,
        n.local ? h('span', { class: 'dim', style: { fontSize: '11.5px' } }, 'saving…') : ['open', 'reopened'].includes(n.status) ? [h('button', { class: 'ghost', onclick: () => { editing = n.id; render(); } }, 'Edit'),
          h('button', { class: 'ghost danger', onclick: async () => { if (await confirmBox(`Delete note #${n.id}?`, h('p', {}, n.text), 'Delete')) { await api(`/api/project/${ctx.projectId}/note/${n.id}/delete`, { method: 'POST' }); ctx.removeNote(n.id); } } }, 'Delete')] : null,
        h('span', { class: 'spacer' }), h('span', { class: 'dim', style: { fontSize: '11px' } }, AGO(n.createdAt))));
    return cardEl;
  }
  // a card is rebuilt only when something it shows changed (rebuilding ~100 cards on every save or selection
  // took ~25 ms and re-requested their pictures); the card being edited is never rebuilt under the user's typing
  const cache = new Map();
  let firstShownId = null;
  const sigOf = n => JSON.stringify([n.local, n.status, n.text, n.kind, n.t, n.t2, n.frames, n.say, n.reply, n.fixedIn, n.imgV, n.pending, n.images?.crop || n.images?.annotated || null,
    n.id === ctx.selected(), n.file === ctx.file(), editing === n.id, Math.floor(Date.now() / 60000)]);
  function render() {
    renderDrafts();
    const f = filterSel.value, notes = ctx.notes();
    // Submission order also keeps a newly written note first after seeking back in the film.
    const shown = notes.filter(n => f === 'all' || (f === 'file' ? n.file === ctx.file() : f === 'fixed' ? n.status === 'fixed' : !['approved', 'fixed'].includes(n.status)))
      .sort((a, b) => (Date.parse(b.createdAt) || 0) - (Date.parse(a.createdAt) || 0) || Number(b.id) - Number(a.id));
    const topChanged = (shown[0]?.id ?? null) !== firstShownId;
    firstShownId = shown[0]?.id ?? null;
    const keep = new Set(), els = shown.map(n => {
      keep.add(n.id); const c = cache.get(n.id), s = sigOf(n);
      if (c && c.obj === n && (c.sig === s || (editing === n.id && c.editing))) return c.el;   // same object: its buttons act on the note in the list
      const el = card(n); cache.set(n.id, { sig: s, el, obj: n, editing: editing === n.id }); return el;
    });
    for (const k of cache.keys()) if (!keep.has(k)) cache.delete(k);
    if (!shown.length) list.replaceChildren(h('div', { class: 'empty', style: { padding: '18px' } }, notes.length ? 'No notes match this filter.' : 'No notes yet. Click a problem area in the video to place a marker, write your note, then press Enter. Use the tools on the left to draw.'));
    else if (els.length !== list.children.length || els.some((e, i) => list.children[i] !== e)) list.replaceChildren(...els);
    if (topChanged) list.scrollTop = 0;
    const open = notes.filter(n => ['open', 'reopened'].includes(n.status)).length;
    sendBtn.textContent = `Send to Claude (${open})`; sendBtn.disabled = !open; ctx.onCount?.(open);
    const fixed = notes.filter(n => n.status === 'fixed').length;
    tourBtn.hidden = !fixed; tourBtn.textContent = `✓ Check fixes (${fixed})`;
    if (!oldAsked && notes.length) refreshOld(); else drawOld();
  }
  async function send() {
    const { text } = await api(`/api/project/${ctx.projectId}/prompt`, { method: 'POST', body: {} });
    try { await navigator.clipboard.writeText(text); toast('Message copied to the clipboard. Paste it into the project chat.'); }
    catch { await confirmBox('Paste into chat', h('textarea', { style: { width: '100%', minHeight: '90px' } }, text), 'OK'); }
  }
  // scrolls the list only: scrollIntoView also scrolled the page, so picking a note in a narrow window moved the
  // player and timeline away from under the mouse
  function scrollTo(id) {
    const c = list.querySelector(`[data-id="${id}"]`); if (!c) return;
    const lr = list.getBoundingClientRect(), cr = c.getBoundingClientRect();
    if (cr.top < lr.top) list.scrollTop += cr.top - lr.top - 4;
    else if (cr.bottom > lr.bottom) list.scrollTop += Math.min(cr.top - lr.top, cr.bottom - lr.bottom + 4);
  }

  const reload = () => ctx.reloadNotes();
  return { el, render, renderDrafts, refreshOld, reload, openComposer, updateComposer, closeComposer, scrollTo, focusText: () => comp?.text.focus() };
}
