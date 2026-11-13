import { agentName } from './agent.js';
// Review studio v2: always-visible tools, a real transport bar, timeline with strip + waveform,
// zoom/pan, compare (side / wipe / difference), review copy for instant frame stepping.
import { h, api, toast, TC, DUR, AGO, onHubEvent, openFolder } from './app.js';
import { COLORS, WIDTHS, paint, bbox, hit, pinR, PIN_HEAD } from './review/shapes.js';
import { createTimeline } from './review/timeline.js';
import { createNotesPanel } from './review/notes.js';
import { createLiveSource } from './review/live.js';
import { createLiveCover } from './review/cover.js';
import { createSceneEditor } from './review/sceneedit.js';
import { createMixer } from './review/mixer.js';
import { scenesFromPage } from './review/scenes.js';
import { createSoundEditor } from './review/soundedit.js';
import { createEdit2d } from './review/edit2d.js';
import { createAutoScan } from './review/autoscan.js';
import { createRenderButton } from './review/renderbtn.js';
import { createSplitter, fitRow, openPop } from './review/dock.js';
import { createSidePanel } from './review/sidepanel.js';
import { createTransport, createShuttle } from './review/transport.js';
import { createApplyQueue } from './review/applyqueue.js';
import { createLibrary } from './review/library.js';
import { installTips } from './review/tips.js';

const ICON = {
  cursor: '<path d="M5 3l13 7.5-5.5 1.5-2.5 5.5z"/>',
  pen: '<path d="M4 20l1-4L16 5l3 3L8 19z"/><path d="M14 7l3 3"/>',
  arrow: '<path d="M5 19L19 5"/><path d="M10 5h9v9"/>',
  rect: '<rect x="4" y="6" width="16" height="12" rx="1"/>',
  ellipse: '<ellipse cx="12" cy="12" rx="8.5" ry="6.5"/>',
  text: '<path d="M5 6h14M12 6v13M9 19h6"/>',
  pin: '<circle cx="12" cy="10" r="4.5"/><path d="M12 14.5V21"/>',
  eraser: '<path d="M8 19l-4-4 9-9 7 7-6 6z"/><path d="M12 19h8"/>',
  undo: '<path d="M9 14L4 9l5-5"/><path d="M4 9h10a6 6 0 010 12h-3"/>',
  redo: '<path d="M15 14l5-5-5-5"/><path d="M20 9H10a6 6 0 000 12h3"/>',
  zin: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5L20 20M10.5 7.5v6M7.5 10.5h6"/>',
  zout: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5L20 20M7.5 10.5h6"/>',
  fit: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
};
const svg = (name, size = 20) => { const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('width', size); s.setAttribute('height', size); s.setAttribute('fill', 'none'); s.setAttribute('stroke', 'currentColor'); s.setAttribute('stroke-width', '1.8'); s.setAttribute('stroke-linecap', 'round'); s.setAttribute('stroke-linejoin', 'round'); s.innerHTML = ICON[name]; return s; };
const TOOLS = [['cursor', 'Note: click the video → add a note at that point (V)', 'Note'], ['pen', 'Pen: draw freehand (P)', 'Pen'], ['arrow', 'Draw an arrow (A)', 'Arrow'], ['rect', 'Draw a box (R)', 'Box'], ['ellipse', 'Draw a circle (E)', 'Circle'], ['text', 'Add text over the image (T)', 'Text'], ['pin', 'Add a numbered marker (M)', 'Marker'], ['eraser', 'Eraser: erase drawings in the draft (X)', 'Eraser']];
const TOOL_KEYS = { v: 'cursor', p: 'pen', a: 'arrow', r: 'rect', e: 'ellipse', t: 'text', m: 'pin', x: 'eraser' };
const SPEEDS = [0.1, 0.25, 0.5, 1, 1.5, 2];
const HELP = [
  ['Click the video', 'pauses and adds a numbered point there; type a note, Enter → saves it and resumes playback'], ['Click a point', 'opens that note'],
  ['Space / K', 'play / pause'], ['← / →', '1 frame back / forward (hold to repeat)'], ['Shift + ← / →', '5 s back / forward'], ['J / K / L', 'rewind · stop · fast forward (press again: 2× 4× 8×)'], ['[ / ]', 'speed: slower / faster'], ['Home / End', 'start / end'],
  ['I / O', 'range: start / end (this frame)'], ['Shift + I / O', 'go to range start / end'], ['\\', 'loop the range'], ['Ctrl+L', 'loop'], ['◆ (on the timeline)', 'range start / end; click to go to that frame'], [', / .', 'previous / next note'], ['N', 'new note on this frame'], ['G', 'go to time / frame (1:23.4 · 83.4 · k1234 · +2 · −10f)'],
  ['Z / Shift+Z', 'timeline: zoom to range / fit'],
  ['M / S (in the row header)', 'mute / solo the channel (playback only; renders are unaffected)'], ['% (in the row header)', 'level: drag ±1% (Shift: fine) · scroll ±5% · double-click: value in the film'],
  ['Alt + ← / →', 'move the selected sound by 1 frame (Shift: 10 frames)'], ['Delete', 'delete the selected sound (click the timeline first)'], ['Alt + drag', 'drag a copy of the added sound'],
  ['V P A R E T M X', 'cursor, pen, arrow, box, circle, text, marker, eraser'], ['Ctrl+Z / Ctrl+Y', 'undo / redo (newest change first: drawing, sound, scene, 2D)'], ['Esc', 'return to cursor · close an empty draft (Cancel discards a note with drawings)'],
  ['+ / − / 0 / 1', 'zoom in / zoom out / fit / 100%'], ['Space + drag', 'pan while zoomed in'], ['Ctrl + scroll', 'zoom the video or timeline (scrolling the ruler also zooms)'], ['F', 'fullscreen'], ['U', 'mute / unmute'], ['C', 'show narration text below the video'], ['Y / B', 'during a fix check: approve / before ⇄ after'], ['? or H', 'this list'],
];

export async function reviewPage(page, id, relArg = '') {
  const [rel0, qs] = String(relArg).split('?');
  const params = new URLSearchParams(qs || '');
  const focusNote = +(params.get('n') || 0), autoPlay = params.get('play') === '1';
  const p = await api('/api/project/' + id + '?lite=1');
  const vids = p.outputs.filter(o => o.ok !== false);
  const liveMode = rel0 === '~live';
  let liveInfo = null;
  if (liveMode) {
    liveInfo = await api(`/api/project/${id}/live`).catch(e => ({ ok: false, reason: e.message }));
    if (!liveInfo.ok) { page.append(h('div', { class: 'empty' }, 'Could not open live preview: ' + liveInfo.reason)); return; }
  }
  let cur = liveMode ? { rel: '~live', name: (p.title || p.name) + ' (live)', path: null, fps: liveInfo.fps, dur: liveInfo.dur, w: liveInfo.w, h: liveInfo.h }
    : vids.find(o => o.rel === rel0) || vids.find(o => o.rel === p.latest) || (rel0 ? vids[0] : null);
  if (!cur) {   // no film yet (nothing, or only test clips / parts): play it from its code if it can
    const li = await api(`/api/project/${id}/live?probe=1`).catch(() => null);
    if (li?.ok) { location.replace(`#/review/${id}/~live${qs ? '?' + qs : ''}`); return; }
    cur = vids[0];
  }
  if (!cur) {
    const li = await api(`/api/project/${id}/live?probe=1`).catch(() => null);
    page.append(h('div', { class: 'empty' }, 'This project has no video to watch' + (li?.reason ? ' (live preview is also unavailable: ' + li.reason + ')' : '') + '.')); return;
  }
  // editor mode: the page fills the window and never scrolls; the hub sidebar shrinks to an icon strip
  const appEl = document.querySelector('.app'), mainEl = document.querySelector('#main');
  page.classList.add('page-wide', 'page-editor'); appEl?.classList.add('app-editor'); mainEl?.classList.add('main-editor');
  const rv2 = h('div', { class: 'rv2' });   // the editor grid; also the host of popovers, the timeline tip and (in fullscreen) toasts
  let side = null;   // the right-hand tab panel (built once the notes panel exists)
  const offTips = installTips(rv2, () => document.fullscreenElement || document.body);   // quick tooltips for every titled control
  // ---------- undo router: one Ctrl+Z for every editor, newest change first. Tags: draw · clips · sound · scene · 2d
  // (each domain keeps its own stack; a tag whose domain has nothing left is skipped). Scene / 2D have no redo.
  let undoOrder = [], redoOrder = [];
  let mixer = null;   // the live mixer (ui/review/mixer.js): channel levels, M/S, master; built with the sound rows
  const pushTag = tag => { undoOrder.push(tag); if (undoOrder.length > 400) undoOrder.shift(); redoOrder = []; };
  const dropLastTag = tag => { const i = undoOrder.lastIndexOf(tag); if (i >= 0) undoOrder.splice(i, 1); };   // an editor's own ↶ button undid its newest step
  const dropTags = tag => { undoOrder = undoOrder.filter(t => t !== tag); redoOrder = redoOrder.filter(t => t !== tag); };
  const undoDomains = () => ({ draw: { undo: () => undo(), redo: () => redo() }, clips: soundEd && { undo: () => soundEd.undo(), redo: () => soundEd.redo() }, sound: mixer && { undo: () => mixer.undo(), redo: () => mixer.redo() }, scene: sceneEd && { undo: () => sceneEd.undo() }, '2d': edit2d && { undo: () => edit2d.undo() } });
  function routeUndo() {
    const D = undoDomains();
    while (undoOrder.length) { const tag = undoOrder.pop(); if (D[tag]?.undo()) { if (D[tag].redo) redoOrder.push(tag); return; } }
    undo();   // a parked draft brought back keeps its drawing steps without tags
  }
  function routeRedo() {
    const D = undoDomains();
    while (redoOrder.length) { const tag = redoOrder.pop(); if (D[tag]?.redo?.()) { undoOrder.push(tag); return; } }
    redo();
  }
  // ---------- keyboard area: the region of the last press decides who gets Delete / Alt+arrows / Esc
  let area = 'stage';
  const onAreaDown = e => { const t = e.target; area = t.closest?.('.rv2-dock') ? 'timeline' : t.closest?.('.rv2-side') ? 'side' : t.closest?.('.rv2-view') ? 'stage' : area; };
  document.addEventListener('pointerdown', onAreaDown, true);
  // ---------- one sound build queue (levels, clips, ducks): stems/all build by themselves, the 3D studio on 💾
  let soundMode = null;
  const applyQueue = createApplyQueue({
    apply: () => api(`/api/project/${id}/sound-apply`, { method: 'POST', body: {} }),
    mode: () => soundMode,
    onBuilt: r => { soundBuilt(); toast(`Sound updated (${((r?.ms || 0) / 1000).toFixed(1)} s).` + (liveMode ? '' : ' This video is an older render; the new sound will be in the next render.')); },
    onBusy: () => { refreshApply(); mixer?.refresh(); },   // the mixer's engine runs while a change is not built yet
    onError: e => toast('Could not build sound: ' + e.message, true),
  });
  // 3D studio: changes saved but never built (e.g. before a reload) keep 💾
  api(`/api/project/${id}/sound-info`).then(i => { soundMode = i?.mode || 'none'; if (i?.stale) applyQueue.request('stale'); refreshApply(); })
    .catch(() => { soundMode = 'none'; refreshApply(); });
  // its state in the timeline corner, the Sounds and the Clip tab (persistent hosts: no pane repaint mid-edit);
  // Sounds' Channels section has its own 💾 (mixer.js), so stSounds only says when a build runs
  const stCorner = h('span', { class: 'rv2-astat' }), stSounds = h('span', { class: 'rv2-astat' }), stClip = h('span', { class: 'rv2-astat' });
  let cornerKey = '';
  function refreshApply() {
    const busy = applyQueue.busy(), want = soundMode === 'studio' && applyQueue.dirty(), note = !busy && !want ? mixer?.note() || '' : '';
    const key = `${busy}|${want}|${note}`; if (key === cornerKey) return; cornerKey = key;   // the mixer notifies often
    for (const [host, short] of [[stCorner, true], [stSounds, null], [stClip, false]]) {
      host.replaceChildren(...(busy ? [h('span', { class: 'accent' }, 'Building sound…')] : want && short != null ? [h('button', { class: 'primary', title: 'Apply sound changes to the film using the 3D studio engine (takes a few minutes); the preview and next render will use the new sound', onclick: () => applyQueue.applyNow().catch(() => { }) }, short ? '💾 Apply to film' : '💾 Apply to film (a few minutes)')] : []));
    }
    // the corner: the build, else a listening note (solo on / the channels play over a rendered video)
    if (note) stCorner.replaceChildren(h('span', { class: 'tl2-cnote', title: note }, note));
    try { timeline.setStatus(busy || want || note ? stCorner : null); } catch { }   // (not built yet on a very early call)
  }
  if (cur?.path) api('/api/outputs/seen', { method: 'POST', body: { path: cur.path } }).then(r => window.__vhNewCount?.(r.unseen)).catch(() => { });   // "new" → seen
  let notes = p.notes || [];
  const fps = () => cur.fps || p.render?.fps || 30;
  const chunkSec = () => p.render?.chunkSec || null;
  const versionInfo = () => (p.versionsLog || []).find(v => v.file === cur.rel) || null;
  const S = { tool: 'cursor', color: COLORS[0], width: 1, draft: null, parkedDrafts: [], undo: [], redo: [], selected: focusNote || null, range: { a: null, b: null }, loopOn: false, z: { k: 1, x: 0, y: 0 }, cmp: null, cmpMode: 'side', wipe: 0.5, frame: 0, usingProxy: false };
  // quick point: a click drops a numbered point and opens a small note box next to it
  let quickOpen = false;
  const quickEmpty = d => !!d && d.quick && !d.useRange && !(d.text || '').trim() && d.shapes.every(s => s.type === 'pin');   // a point with a range survives moving to its edges

  // ---------- layout
  const backA = h('a', { href: '#/', class: 'muted', title: 'Projects' }, '← ' + p.title);
  const infoBtn = h('button', { class: 'ghost', title: 'Project page: videos, disk, notes list, render history', onclick: () => { location.hash = '#/p/' + id; } }, 'ℹ Project');
  const fileSel = h('select', { onchange: e => { location.hash = `#/review/${id}/${encodeURIComponent(e.target.value)}`; } }, liveMode ? h('option', { value: '~live', selected: true }, '● Live preview (from code, no render)') : null, vids.map(o => h('option', { value: o.rel, selected: o === cur }, `${o.rel} · ${DUR(o.dur)} · ${AGO(o.mtime)}`)));
  // the live preview is always one pick away in the file menu (watching a render, the newer code was hard to find)
  if (!liveMode) api(`/api/project/${id}/live?probe=1`).then(li => { if (li?.ok) fileSel.prepend(h('option', { value: '~live' }, '● Live preview (from code, no render)')); }).catch(() => { });   // live in the file menu
  const cmpSel = h('select', { onchange: () => setCompare(cmpSel.value) }, h('option', { value: '' }, 'No comparison'), vids.filter(o => o !== cur).map(o => h('option', { value: o.rel }, 'Compare with: ' + o.rel)));
  const modeBtns = [['side', 'Side by side'], ['wipe', 'Wipe'], ['diff', 'Difference']].map(([m, t]) => h('button', { class: 'seg', 'data-m': m, onclick: () => { S.cmpMode = m; applyCompare(); } }, t));
  const modeSeg = h('span', { class: 'segs', hidden: true }, modeBtns);
  const changedBtn = h('button', { hidden: true, onclick: () => playChanged() }, 'Watch only the changes');
  const proxyPill = h('span', { class: 'pill', title: 'Lightweight review copy for smooth frame stepping' }, '…');
  const helpBtn = h('button', { class: 'ghost', title: 'How to use, all keyboard shortcuts (?)', onclick: () => toggleHelp() }, '❔ Help');
  const folderBtn = h('button', { class: 'ghost', title: 'Open project folder in the file manager: ' + p.path, onclick: () => openFolder(id) }, '📂 Folder');
  const liveRefreshBtn = liveMode ? h('button', { class: 'ghost', title: 'Find the current page again and reload the code', onclick: async () => {
    try { const fresh = await api('/api/project/' + id + '/live'); if (fresh.ok) liveSrc.reload(fresh); else toast(fresh.reason, true); }
    catch (e) { toast(e.message, true); }
  } }, '↻ Reload') : null;
  const fileBtn = liveMode ? null : h('button', { class: 'ghost', title: 'Open the current video folder with the file selected', onclick: () => openFolder(id, cur.rel) }, '📄 Show file');
  // live preview: the user starts the render when they are happy with it (full film, or only the parts of fixed notes)
  // also on a video (a film opened on its video used to have no button); projects with no render script get told why on click
  const renderBtn = createRenderButton(p, { notes: () => notes });
  const thumbBtn = h('button', { class: 'ghost', title: 'Start a thumbnail from this frame: use it as a trace underlay and composition reference in Thumbnail Studio', onclick: () => frameToThumbnail() }, '🖼 Thumbnail');
  // ☰ shows the hub sidebar over the page (in the editor it is an icon strip)
  const peek = on => { appEl?.classList.toggle('side-peek', on ?? !appEl.classList.contains('side-peek')); };
  const menuBtn = h('button', { class: 'ghost rv2-menu', title: 'Menu', onclick: () => peek() }, '☰');
  const onPeekOutside = e => { if (appEl?.classList.contains('side-peek') && !e.target.closest?.('.side') && !menuBtn.contains(e.target)) peek(false); };
  document.addEventListener('pointerdown', onPeekOutside, true);
  const moreBtn = h('button', { class: 'ghost rv2-more', title: 'More buttons', hidden: true }, '⋯');
  backA.classList.add('rv2-back');
  // one row: when it does not fit, the lowest data-pri goes into ⋯ first (9 = always stays)
  const pri = (n, el) => { if (el) el.dataset.pri = n; return el; };
  pri(9, menuBtn); pri(9, backA); pri(9, fileSel); pri(9, renderBtn?.el); pri(9, helpBtn);
  pri(6, liveRefreshBtn); pri(5, cmpSel); pri(5, modeSeg); pri(4, changedBtn); pri(3, thumbBtn);
  pri(2, folderBtn); pri(2, infoBtn); pri(2, fileBtn); pri(1, proxyPill);
  const edLabel = pri(3, h('span', { class: 'rv2-glabel', hidden: !liveMode }, 'Edit'));
  const top = h('div', { class: 'rv2-top' }, menuBtn, backA, fileSel, cmpSel, modeSeg, changedBtn, h('span', { class: 'spacer' }), edLabel, thumbBtn, liveRefreshBtn, folderBtn, infoBtn, fileBtn, proxyPill, helpBtn, moreBtn, renderBtn?.el);

  // tools
  const toolBtns = {};
  // colour + width live in a popover behind one 🎨 button (the rail must fit a ~360 px stage)
  const stylePop = h('div', { class: 'rv2-stylepop' },
    h('div', { class: 'rv2-poprow' }, COLORS.map(c => h('button', { class: 'sw', title: 'Color', style: { background: c }, 'data-c': c, onclick: () => { S.color = c; refreshTools(); styleMenu?.close(); } }))),
    h('div', { class: 'rv2-poprow' }, WIDTHS.map((w, i) => h('button', { class: 'tb wb', title: ['Thin', 'Medium', 'Thick'][i], 'data-w': w, onclick: () => { S.width = w; refreshTools(); styleMenu?.close(); } }, h('i', { style: { height: (2 + i * 2.5) + 'px' } })))));
  const styleDot = h('span', { class: 'sdot' }), styleBar = h('i', { class: 'sbar' });
  let styleMenu = null;
  const styleBtn = h('button', { class: 'tb tb-style', title: 'Color and width', onclick: () => {
    if (styleMenu) { styleMenu.close(); return; }
    styleMenu = openPop({ anchor: styleBtn, host: rv2, content: stylePop, side: 'right', onClose: () => { styleMenu = null; } });
  } }, styleDot, styleBar, h('span', { class: 'tl' }, 'Color'));
  const tools = h('div', { class: 'rv2-tools' },
    TOOLS.map(([k, tip, name]) => (toolBtns[k] = h('button', { class: 'tb', title: tip, onclick: () => setTool(k) }, svg(k), h('span', { class: 'tl' }, name)))),
    h('div', { class: 'tsep' }),
    styleBtn,
    h('div', { class: 'tsep' }),
    h('button', { class: 'tb', title: 'Undo (Ctrl+Z): newest change (drawing, sound, scene, 2D)', onclick: () => routeUndo() }, svg('undo'), h('span', { class: 'tl' }, 'Undo')),
    h('button', { class: 'tb', title: 'Redo (Ctrl+Y)', onclick: () => routeRedo() }, svg('redo'), h('span', { class: 'tl' }, 'Redo')),
  );
  // picture zoom: a small overlay in the stage's bottom-right corner
  const zoomPct = h('span', { class: 'zpct', hidden: true });
  const zoomCtl = h('div', { class: 'rv2-zoomctl' },
    h('button', { class: 'ghost', title: 'Zoom out (−)', onclick: () => zoomBy(1 / 1.5) }, svg('zout', 16)), zoomPct,
    h('button', { class: 'ghost', title: 'Zoom in (+)', onclick: () => zoomBy(1.5) }, svg('zin', 16)),
    h('button', { class: 'ghost', title: 'Fit (0)', onclick: () => zoomFit() }, svg('fit', 16)));
  function refreshTools() {
    for (const [k, b] of Object.entries(toolBtns)) b.classList.toggle('on', S.tool === k);
    for (const box of [tools, stylePop]) {
      box.querySelectorAll('.sw').forEach(b => b.classList.toggle('on', b.dataset.c === S.color));
      box.querySelectorAll('.wb').forEach(b => b.classList.toggle('on', +b.dataset.w === S.width));
    }
    styleDot.style.background = S.color; styleBar.style.height = (2 + Math.max(0, WIDTHS.indexOf(S.width)) * 2) + 'px';
    zoomPct.hidden = S.z.k <= 1.001; zoomPct.textContent = Math.round(S.z.k * 100) + '%';
    ov.style.cursor = S.tool === 'cursor' ? (S.z.k > 1 ? 'grab' : 'crosshair') : S.tool === 'text' ? 'text' : S.tool === 'eraser' ? 'not-allowed' : 'crosshair';
  }

  // stage
  const liveSrc = liveMode ? createLiveSource(liveInfo, { onStatus: st => liveStatus(st) }) : null;
  const liveCover = liveSrc ? createLiveCover({ source: liveSrc, save: data => api(`/api/project/${id}/live-thumb`, { method: 'POST', body: data }) }) : null;
  const videoA = liveSrc || h('video', { src: '/media?p=' + encodeURIComponent(cur.path), preload: 'auto', playsinline: true });
  const videoB = h('video', { preload: 'auto', muted: true, playsinline: true, class: 'vb', hidden: true });
  const diffCv = h('canvas', { class: 'diff', hidden: true });
  const ov = h('canvas', { class: 'ov' });
  const wipeHandle = h('div', { class: 'wipe', hidden: true }, h('span', {}, '⇔'));
  const tagA = h('span', { class: 'tag', hidden: true }), tagB = h('span', { class: 'tag tagb', hidden: true });
  // check tour: the frame from when the note was written, laid over the current one ("before")
  const beforeImg = h('img', { class: 'beforeimg', hidden: true, alt: '' }), beforeTag = h('span', { class: 'tag beforetag', hidden: true }, 'BEFORE · when the note was written');
  const frameA = h('div', { class: 'frame' }, liveSrc ? liveSrc.el : videoA, videoB, diffCv, beforeImg, ov, wipeHandle, tagA, tagB, beforeTag);
  // move the camera / objects right in the live picture (pages with window.VH_EDIT), saved to tweaks.json
  // each editor's panel goes into its own side-panel tab (added on open, removed on close), unscaled by the picture zoom
  const edHost = (tid, label) => {
    const el = h('div', { class: 'rv2-edit' });
    return { panelHost: el, onOpen: () => side?.add({ id: tid, label, el }, { select: true }), onClose: () => { side?.remove(tid); dropTags(tid); } };
  };
  const keysActive = () => area !== 'timeline';   // the timeline's Delete / arrows / Esc are not the editors' then
  const sceneEd = liveSrc ? createSceneEditor({ src: liveSrc, projectId: id, frame: frameA, ...edHost('scene', '✏️ Scene'), history: { push: () => pushTag('scene'), undone: () => dropLastTag('scene') }, keysActive, applyNow: () => applyQueue.applyNow(), onSoundSaved: r => { mixer?.setStored(r.sound); applyQueue.request('levels'); } }) : null;
  if (sceneEd) top.insertBefore(pri(7, sceneEd.el), thumbBtn);
  if (sceneEd) sceneEd.el.classList.add('rv2-ed');
  // 2D layers (pages with window.VH2D: added pictures / texts / shapes, characters moved / scaled / hidden)
  const edit2d = liveSrc ? createEdit2d({ src: liveSrc, projectId: id, frame: frameA, ...edHost('2d', '🧩 2D'), range: () => rangeOk() ? rangeSec() : null, scenes: () => timeline.scenes(), time: () => liveSrc.displayedTime ?? 0, dur: () => dur(), history: { push: () => pushTag('2d'), undone: () => dropLastTag('2d') }, keysActive }) : null;
  if (edit2d) { top.insertBefore(pri(7, edit2d.el), thumbBtn); edit2d.el.classList.add('rv2-ed'); }
  // frame-by-frame automatic check in the open preview (no render, no tokens)
  const scanner = liveSrc ? createAutoScan({ src: liveSrc, projectId: id, frame: frameA, ...edHost('scan', '🔍 Scan'), reloadNotes: () => notesPanel.reload() }) : null;
  if (scanner) { top.insertBefore(pri(7, scanner.el), thumbBtn); scanner.el.classList.add('rv2-ed', 'rv2-ed-last'); }
  const capBar = h('div', { class: 'capbar', hidden: true });
  const frameB = h('div', { class: 'frame', hidden: true });
  const zoomBox = h('div', { class: 'zoombox' }, frameA, frameB);
  const view = h('div', { class: 'rv2-view' }, zoomBox, zoomCtl);
  const textInput = h('input', { class: 'textin', hidden: true, placeholder: 'text + Enter' });
  view.append(textInput);
  const quickHead = h('div', { class: 'qh' }), quickText = h('textarea', { rows: 2, placeholder: 'What is wrong here?' });
  const quick = h('div', { class: 'quick', hidden: true }, quickHead, quickText, h('div', { class: 'qf' }, 'Enter save · Shift+Enter new line · Esc close'));
  view.append(quick);
  const tipChip = (k, t) => h('span', { class: 'tchip' }, h('kbd', {}, k), t);
  const tipBar = h('div', { class: 'rv2-tip', hidden: true }, h('b', {}, 'Tip'), tipChip('👆', 'Click the video → type your note'), tipChip('Space', 'play / pause'), tipChip('← →', 'frame by frame'), tipChip('J K L', 'rewind · stop · fast forward'), tipChip('?', 'all shortcuts'), h('button', { class: 'ghost', onclick: () => { tipBar.hidden = true; try { localStorage.setItem('vh-tip2', '1'); } catch { } } }, 'Got it ✓'));
  try { tipBar.hidden = !!localStorage.getItem('vh-tip2'); } catch { }

  // timeline (built before the transport: the transport's zoom controls drive the timeline's view)
  let layerLabels = [], soundEd = null;   // sound layer names (set once loaded), added sounds
  const timeline = createTimeline({ overlayHost: () => rv2, live: !!liveSrc, pause: () => { if (shuttle.speed()) shuttle.stop(); else { videoA.pause(); videoB.pause(); } }, needPeaks: src => loadWave(src, p.path + '/' + src, false), layerOn: lid => mixer ? mixer.audible(lid) : true, dur: () => dur(), time: () => liveSrc?.displayedTime ?? videoA.currentTime, fps, chunkSec, notes: () => notes, selected: () => S.selected, range: () => S.range, loopOn: () => S.loopOn, setRange: (a, b) => setRange(a, b), changed: () => versionInfo()?.changedRanges, seek: t => seek(t), selectNote: nid => selectNote(nid), onDrop: d => soundEd?.dropAdd(d) });

  // transport: one row (ui/review/transport.js); nothing in this ctx is called while it is built
  let trData = null, ccOn = false; try { ccOn = localStorage.getItem('vh-cc') === '1'; } catch { }
  const transport = createTransport({
    now: () => nowT(), dur: () => dur(), fps, frame: () => S.frame, chunkSec, paused: () => videoA.paused,
    seek: t => seek(t), step: n => { shuttle.stop(); step(n); }, togglePlay: () => { shuttle.stop({ pause: false }); togglePlay(); }, setRate: r => setRate(r), speeds: SPEEDS,
    range: () => S.range, rangeOk: () => rangeOk(), setIn: f => setIn(f), setOut: f => setOut(f), clearRange: () => clearRange(),
    applyRange: (a, b) => applyRangeEdit(a, b), noteForRange: () => noteForRange(), loopOn: () => S.loopOn, toggleLoop: () => toggleLoop(),
    // while the mixer's channels play, the player stays muted: 🔊 / volume / U drive the mixer's master instead
    muted: () => master().muted, setMuted: m => setMaster({ muted: m }), volume: () => master().volume, setVolume: v => setMaster({ volume: v, muted: false }),
    captionsAvailable: () => !!trData, captionsOn: () => ccOn, toggleCaptions: () => toggleCaptions(),
    newNote: () => { ensureDraft(); notesPanel.focusText(); }, saveFrame: () => saveFrame(), fullscreen: () => fullscreen(),
    view: timeline.view, toast, host: () => rv2,
  });
  // J/K/L: forward via the raw playbackRate (the speed select keeps its value), reverse by seeks
  const shuttle = createShuttle({
    now: () => nowT(), seek: t => seek(t), play: () => { videoA.play().catch(() => { }); }, pause: () => { videoA.pause(); videoB.pause(); },
    setPlaybackRate: r => { videoA.playbackRate = r; videoB.playbackRate = r; }, baseRate: () => transport.rate(), seeking: () => !!videoA.seeking,
    fps, onChange: s => transport.setShuttle(s),
  });
  const notesPanel = createNotesPanel({
    layers: () => layerLabels,
    projectId: id, notes: () => notes, file: () => cur.rel, seek: t => seek(t), selectNote: nid => selectNote(nid), selected: () => S.selected,
    fps, chunkSec, dur: () => dur(), time: () => videoA.currentTime, draft: () => S.draft, atDraft: () => S.draft && S.frame === S.draft.frame,
    parkedDrafts: () => S.parkedDrafts, restoreDraft: entry => restoreDraft(entry),
    gotoDraft: () => S.draft && seekFrame(S.draft.frame), cancelDraft: () => cancelDraft(), saveDraft: () => saveDraft(),
    startTour: () => startTour(),
    liveCapture: liveSrc ? (a, b) => ({ start: liveSrc.capture((a + 0.5) / fps()), end: liveSrc.capture((b + 0.5) / fps()) }) : null,
    range: () => S.range, rangeOk: () => rangeOk(), setRange: (a, b) => setRange(a, b), frame: () => S.frame, parseFrame: v => parseFrame(v), playRange: n => playRange(n),
    changed: () => { notesPanel.render(); timeline.draw(); redraw(); }, removeNote: nid => { notes = notes.filter(n => n.id !== nid); notesPanel.render(); timeline.draw(); redraw(); },
    reloadNotes: async () => { notes = await api(`/api/project/${id}/notes`); notesPanel.render(); timeline.draw(); redraw(); notesPanel.refreshOld(); },
    onCount: n => side?.setBadge('notes', n || ''),
  });
  // side panel: Notes / Sounds / Clip; `Send to ${agentName()}` sits under the panes, visible on every tab
  const soundsHost = h('div', { class: 'rv2-sounds' }), clipHost = h('div', { class: 'rv2-clip' });
  const nfoot = notesPanel.el.querySelector('.rv2-nfoot');
  side = createSidePanel({ tabs: [{ id: 'notes', label: '📝 Notes', el: notesPanel.el }, { id: 'sounds', label: '🎵 Sounds', el: soundsHost }, { id: 'clip', label: '🎚 Selected sound', el: clipHost }], foot: nfoot });
  const showNotes = () => side.show('notes');   // a hidden pane can neither take focus nor scroll
  const helpBox = h('div', { class: 'rv2-help', hidden: true, onclick: () => toggleHelp(false) }, h('div', { class: 'panel', onclick: e => e.stopPropagation() }, h('h2', { style: { marginTop: 0 } }, 'Keyboard shortcuts'), h('div', { class: 'kv' }, HELP.flatMap(([k, d]) => [h('div', { class: 'k mono' }, k), h('div', {}, d)]))));
  const tourBar = h('div', { class: 'tourbar', hidden: true });
  view.append(capBar);
  const center = h('div', { class: 'rv2-center' }, tipBar, tourBar, view, transport.el);
  const dock = h('div', { class: 'rv2-dock' }, timeline.el);
  // splitters: the dock's height (the picture keeps ≥ 180 px) and the side panel's width
  const dockMax = () => {
    const cs = getComputedStyle(rv2), padY = (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.paddingBottom) || 0), gap = parseFloat(cs.rowGap) || 0;
    const cg = parseFloat(getComputedStyle(center).rowGap) || 0, extras = [tipBar, tourBar, transport.el].filter(e => !e.hidden);
    return rv2.clientHeight - padY - top.offsetHeight - 6 - gap * 3 - extras.reduce((s, e) => s + e.offsetHeight + cg, 0) - 180;
  };
  const dockSplit = createSplitter({ root: rv2, cssVar: '--dock-h', axis: 'y', key: 'vh-dock-h', def: () => Math.max(200, Math.min(420, Math.round(innerHeight * 0.38))), min: 120, max: dockMax });
  const sideSplit = createSplitter({ root: rv2, cssVar: '--side-w', axis: 'x', key: 'vh-side-w', def: () => innerWidth < 1500 ? 300 : 340, min: 260, max: () => rv2.classList.contains('rv2-narrow') ? 280 : 560 });
  rv2.append(top, tools, center, sideSplit.el, side.el, dockSplit.el, dock, helpBox);
  page.append(rv2);
  const topFit = fitRow(top, { more: moreBtn, host: rv2 });
  sideSplit.clamp(); dockSplit.clamp();
  // the stage's own width decides the narrow layout (a media query would see the window)
  const ro2 = new ResizeObserver(() => { rv2.classList.toggle('rv2-narrow', rv2.clientWidth < 1150); sideSplit.clamp(); dockSplit.clamp(); topFit.refit(); });
  ro2.observe(rv2);

  // ---------- sizing + zoom
  let fit = { w: 0, h: 0 };
  function layout() {
    const vw = videoA.videoWidth || cur.w || 1920, vh = videoA.videoHeight || cur.h || 1080;
    const side = S.cmp && S.cmpMode === 'side', n = side ? 2 : 1, gap = 8;
    // the grid sizes the view (the dock splitter decides its height); nothing here sets it
    const W = view.clientWidth, H = view.clientHeight; if (!W || !H) return;
    const s = Math.min((W - gap * (n - 1)) / n / vw, H / vh);
    fit = { w: Math.floor(vw * s), h: Math.floor(vh * s) };
    for (const f of [frameA, frameB]) { f.style.width = fit.w + 'px'; f.style.height = fit.h + 'px'; }
    if (liveSrc) liveSrc.fit(fit.w);
    zoomBox.style.width = (fit.w * n + gap * (n - 1)) + 'px'; zoomBox.style.height = fit.h + 'px';
    zoomBox.style.left = Math.max(0, (W - (fit.w * n + gap * (n - 1))) / 2) + 'px'; zoomBox.style.top = Math.max(0, (H - fit.h) / 2) + 'px';
    const dpr = devicePixelRatio || 1;
    ov.width = Math.round(fit.w * dpr * Math.min(S.z.k, 3)); ov.height = Math.round(fit.h * dpr * Math.min(S.z.k, 3));
    diffCv.width = Math.min(vw, 1280); diffCv.height = Math.round(diffCv.width * vh / vw);
    applyZoom(); redraw(); timeline.draw();
  }
  function applyZoom() { zoomBox.style.transform = `translate(${S.z.x}px, ${S.z.y}px) scale(${S.z.k})`; refreshTools(); }
  function zoomAt(k, px, py) {
    k = Math.max(1, Math.min(8, k)); if (px == null) { px = view.clientWidth / 2; py = view.clientHeight / 2; }
    const ox = parseFloat(zoomBox.style.left) || 0, oy = parseFloat(zoomBox.style.top) || 0;
    const lx = px - ox, ly = py - oy;
    S.z.x = lx - (lx - S.z.x) * k / S.z.k; S.z.y = ly - (ly - S.z.y) * k / S.z.k; S.z.k = k;
    if (k === 1) { S.z.x = 0; S.z.y = 0; }
    layout();
  }
  const zoomBy = f => zoomAt(S.z.k * f);
  const zoomFit = () => zoomAt(1);
  const zoom100 = () => zoomAt((videoA.videoWidth || 1920) / fit.w);
  view.addEventListener('wheel', e => { if (!e.ctrlKey) return; e.preventDefault(); const r = view.getBoundingClientRect(); zoomAt(S.z.k * (e.deltaY < 0 ? 1.2 : 1 / 1.2), e.clientX - r.left, e.clientY - r.top); }, { passive: false });
  // the view's size follows the splitters, the tip/tour bars and fullscreen; the dock is re-clamped a frame later
  // (changing it inside the observer would loop)
  let clampRaf = 0;
  const ro = new ResizeObserver(() => { layout(); if (!clampRaf) clampRaf = requestAnimationFrame(() => { clampRaf = 0; dockSplit.clamp(); }); }); ro.observe(view);
  // in fullscreen only the fullscreen element is drawn: toasts move into it and back
  const toastEl = document.getElementById('toast');
  const onFs = () => {
    if (!toastEl) return;
    if (document.fullscreenElement === rv2) rv2.append(toastEl); else if (toastEl.parentNode !== document.body) document.body.append(toastEl);
  };
  document.addEventListener('fullscreenchange', onFs);
  document.addEventListener('fullscreenchange', layout);

  // ---------- playback
  const dur = () => videoA.duration || cur.dur || 1;
  let pendingSeek = null, target = null;   // target: where the latest seek is heading, so fast key presses add up
  function seek(t) {
    t = Math.max(0, Math.min(dur() - 0.0005, t)); target = t;
    if (videoA.seeking) { pendingSeek = t; return; }
    videoA.currentTime = t; if (S.cmp) videoB.currentTime = t;
  }
  const seekFrame = f => seek((f + 0.5) / fps());
  const nowT = () => target ?? videoA.currentTime;   // relative jumps start from where the latest seek is heading
  videoA.addEventListener('seeked', () => { if (pendingSeek != null) { const t = pendingSeek; pendingSeek = null; seek(t); } else target = null; tick(); });
  function step(n) { videoA.pause(); videoB.pause(); const base = target != null ? Math.floor(target * fps() + 1e-4) : S.frame; seekFrame(base + n); }
  function togglePlay() {
    if (videoA.paused) { if (S.loopOn && rangeOk()) { const [a, b] = rangeSec(); if (videoA.currentTime >= b - 0.5 / fps() || videoA.currentTime < a) seek(a); } videoA.play().catch(() => { }); if (S.cmp) videoB.play().catch(() => { }); }
    else { videoA.pause(); videoB.pause(); if (S.cmp) videoB.currentTime = videoA.currentTime; }
  }
  function setRate(r) { shuttle.stop({ pause: false }); videoA.playbackRate = r; videoB.playbackRate = r; transport.showRate(r); }
  // the compare video follows every play/pause, whatever started it (loop, 'changed only', keys)
  videoA.addEventListener('play', () => { if (quickEmpty(S.draft)) cancelDraft(); if (shuttle.speed() < 0) shuttle.stop({ pause: false }); transport.update(shownT()); if (S.cmp) videoB.play().catch(() => { }); });
  videoA.addEventListener('pause', () => { if (shuttle.speed() > 0) shuttle.stop({ pause: false }); transport.update(shownT()); if (S.cmp) { videoB.pause(); videoB.currentTime = videoA.currentTime; } });
  const updMute = () => transport.update(shownT());
  const master = () => mixer ? mixer.master() : { volume: videoA.volume, muted: videoA.muted };
  function setMaster(m) { if (mixer) mixer.setMaster(m); else { if (m.volume != null) videoA.volume = m.volume; if (m.muted != null) videoA.muted = m.muted; } updMute(); }
  const shownT = () => liveSrc?.displayedTime ?? videoA.currentTime;
  let followAt = 0;
  function tick(meta) {
    // while playing the frame callback's time is exact; once paused currentTime is the truth (a late callback can be stale)
    const t = liveSrc?.displayedTime ?? (meta && !videoA.paused ? meta.mediaTime : videoA.currentTime);
    S.frame = Math.floor(t * fps() + 1e-4);
    transport.update(t);
    if (S.loopOn && rangeOk() && !videoA.paused) { const [a, b] = rangeSec(); if (t >= b - 0.5 / fps()) seek(a); }
    if (S.cmp && !videoA.paused && Math.abs(videoB.currentTime - t) > 0.12) videoB.currentTime = t;
    if (changedRun) changedRun.check(t);
    // the view pages along while playing (also backwards on the J shuttle), checked at most every 120 ms
    if ((!videoA.paused || shuttle.speed() < 0) && performance.now() - followAt > 120) { followAt = performance.now(); timeline.follow(t); }
    timeline.draw(); redraw();
    if (trData && ccOn) updCaptions();
    if (quickEmpty(S.draft) && S.frame !== S.draft.frame && !videoA.seeking) cancelDraft();
    if (S.draft) notesPanel.updateComposer();
    liveCover?.update();
  }
  // frame callbacks are dropped when the source changes (review copy), so restart them per source
  let rvfcToken = 0;
  function startFrameLoop() {
    if (!videoA.requestVideoFrameCallback) return;
    const my = ++rvfcToken;
    const loop = (now, meta) => { if (my !== rvfcToken) return; tick(meta); videoA.requestVideoFrameCallback(loop); };
    videoA.requestVideoFrameCallback(loop);
  }
  videoA.addEventListener('timeupdate', () => tick());
  videoA.addEventListener('loadedmetadata', () => {
    if (liveSrc) { cur.fps = liveSrc.info.fps; cur.dur = liveSrc.info.dur; cur.w = liveSrc.info.w; cur.h = liveSrc.info.h; }   // the page told its real timing/size
    layout(); startFrameLoop();
    if (S.resumeAt != null) { seek(S.resumeAt); if (S.resumePlay) videoA.play().catch(() => { }); S.resumeAt = null; return; }
    const n = notes.find(x => x.id === focusNote);
    if (params.get('tour') === '1' && !tour) { startTour(); return; }
    if (n) { seek(n.at ?? n.t); selectNote(n.id); } else if (autoPlay) videoA.play().catch(() => { });
  });

  // ---------- loop
  // ---------- range: frames a..b (both included)
  const lastFrame = () => Math.max(0, Math.floor(dur() * fps()) - 1);
  const rangeOk = () => S.range.a != null && S.range.b != null;
  const rangeSec = () => [S.range.a / fps(), (S.range.b + 1) / fps()];
  function setRange(a, b) {
    const c = f => f == null || isNaN(f) ? null : Math.max(0, Math.min(lastFrame(), Math.round(f)));
    a = c(a); b = c(b); if (a != null && b != null && b < a) [a, b] = [b, a];
    S.range = { a, b }; if (!rangeOk()) S.loopOn = false;
    if (S.draft && rangeOk() && S.draft.useRange == null) S.draft.useRange = true;
    updRange();
  }
  function setIn(f) { setRange(f, S.range.b != null && S.range.b < f ? null : S.range.b); }
  function setOut(f) { setRange(S.range.a != null && S.range.a > f ? null : S.range.a, f); }
  function clearRange() { S.range = { a: null, b: null }; S.loopOn = false; updRange(); }
  function toggleLoop() { if (!rangeOk()) { toast('Select a range first: «◆ Range start» (I) at the start, «Range end ◆» (O) at the end.'); return; } S.loopOn = !S.loopOn; updRange(); if (S.loopOn && videoA.paused) { seek(rangeSec()[0]); togglePlay(); } }
  function updRange() {
    const { a, b } = S.range, any = a != null || b != null;
    transport.updRange();
    timeline.draw(); notesPanel.updateComposer(); if (quickOpen) openQuickHead();
    mixer?.refresh();   // the Channels scope select names the range
  }
  // a frame number (186), k186, a time (1:02.5) or seconds with a dot (62.5)
  function parseFrame(v) {
    v = String(v || '').trim().replace(',', '.'); let m;
    if ((m = v.match(/^k?(\d+)$/i))) return +m[1];
    if ((m = v.match(/^(\d+):(\d+(?:\.\d+)?)$/))) return Math.floor((+m[1] * 60 + +m[2]) * fps() + 1e-6);
    if ((m = v.match(/^(\d+\.\d+)s?$/))) return Math.floor(+m[1] * fps() + 1e-6);
    return null;
  }
  // the transport's range fields (Enter / OK): frames or times; false keeps the fields open
  function applyRangeEdit(aText, bText) {
    const a = parseFrame(aText), b = parseFrame(bText);
    if (a == null || b == null) { toast('Enter a frame number (e.g. 186) or time (e.g. 1:02.5).', true); return false; }
    setRange(a, b); seekFrame(S.range.a); return true;
  }
  // a note for the range: on the playhead's frame if it is inside the range, else on the range's first frame
  function noteForRange() {
    if (!rangeOk()) return toast('Select a range first.');
    if (S.draft) { showNotes(); S.draft.useRange = true; notesPanel.updateComposer(); notesPanel.focusText(); return; }
    const inside = S.frame >= S.range.a && S.frame <= S.range.b, f = inside ? S.frame : S.range.a;
    if (!inside) seekFrame(f);
    const d = ensureDraft((f + 0.5) / fps()); d.useRange = true; notesPanel.updateComposer(); notesPanel.focusText();
  }
  // a saved range note: select its range and play it in a loop
  function playRange(n) {
    const nf = n.fps || fps(), a = Math.floor(n.t * nf + 1e-6), b = Math.floor((n.t2 ?? n.t) * nf + 1e-6);
    setRange(a, b); S.loopOn = true; updRange(); seek(a / fps()); if (videoA.paused) togglePlay();
  }

  // ---------- tools + drafts
  function setTool(k) { S.tool = k; if (k !== 'cursor' && !videoA.paused) togglePlay(); refreshTools(); }
  const noteTime = () => liveSrc?.displayedTime ?? videoA.currentTime;
  function freezeNoteFrame(at = noteTime()) {
    if (liveSrc) {
      // Annotation belongs to the visible picture, even if a slow draw is behind the playback clock.
      pendingSeek = target = null;
      liveSrc.pauseAt(at);
    } else {
      videoA.pause(); videoB.pause();
    }
    S.frame = Math.floor(at * fps() + 1e-4);
    return at;
  }
  function parkDraft() {
    const d = S.draft;
    if (!d) return;
    if (!quickEmpty(d) && ((d.text || '').trim() || d.shapes.length || d.useRange)) {
      S.parkedDrafts.push({ draft: d, undo: S.undo, redo: S.redo, range: { ...S.range } });
    }
    S.draft = null; S.undo = []; S.redo = [];
    textInput.hidden = true; quickOpen = false; quick.hidden = true;
    notesPanel.closeComposer(); notesPanel.renderDrafts();
  }
  function restoreDraft(entry) {
    const index = S.parkedDrafts.indexOf(entry);
    if (index < 0) return;
    S.parkedDrafts.splice(index, 1);
    showNotes(); parkDraft();
    freezeNoteFrame((entry.draft.frame + 0.5) / fps());
    S.draft = entry.draft; S.undo = entry.undo; S.redo = entry.redo;
    S.range = { ...entry.range }; S.loopOn = false;
    if (!liveSrc) seekFrame(entry.draft.frame);
    notesPanel.closeComposer(); notesPanel.openComposer(); notesPanel.renderDrafts(); updRange(); redraw();
    if (S.draft.quick) openQuick(); else notesPanel.focusText();
  }
  function ensureDraft(tAt, focus = true) {
    const t = tAt ?? noteTime();
    showNotes();
    freezeNoteFrame(t);
    const frame = Math.floor(t * fps() + 1e-4);
    if (S.draft?.frame === frame) return S.draft;
    if (S.draft) parkDraft();
    S.draft = { t, frame, shapes: [], kind: 'visual', text: '', useRange: rangeOk() && frame >= S.range.a && frame <= S.range.b ? true : null };
    S.undo = []; S.redo = [];
    notesPanel.openComposer(focus); redraw();
    return S.draft;
  }
  function pushUndo() { S.undo.push(JSON.stringify(S.draft.shapes)); S.redo = []; pushTag('draw'); }
  function undo() { if (!S.draft || !S.undo.length) return false; S.redo.push(JSON.stringify(S.draft.shapes)); S.draft.shapes = JSON.parse(S.undo.pop()); redraw(); notesPanel.updateComposer(); return true; }
  function redo() { if (!S.draft || !S.redo.length) return false; S.undo.push(JSON.stringify(S.draft.shapes)); S.draft.shapes = JSON.parse(S.redo.pop()); redraw(); notesPanel.updateComposer(); return true; }
  function cancelDraft() { S.draft = null; S.undo = []; S.redo = []; textInput.hidden = true; quickOpen = false; quick.hidden = true; notesPanel.closeComposer(); setTool('cursor'); redraw(); }
  // a lone point gives a tiny crop; widen it so Claude sees what is around the point
  const padRegion = ([x0, y0, x1, y1], p) => [Math.max(0, x0 - p), Math.max(0, y0 - p), Math.min(1, x1 + p), Math.min(1, y1 + p)];
  async function saveDraft() {
    const d = S.draft; if (!d) return;
    const recovery = { draft: d, undo: S.undo, redo: S.redo, range: { ...S.range } };
    const perf = probeSave();
    let strokes = null;
    if (d.shapes.length) {
      const vw = videoA.videoWidth || cur.w || 1920, vh = videoA.videoHeight || cur.h || 1080;
      const c = h('canvas', { width: 1280, height: 2 * Math.round(1280 * vh / vw / 2) });
      paint(c.getContext('2d'), numbered(d.shapes, nextId()), c.width, c.height); strokes = c.toDataURL('image/png');
    }
    const r = d.useRange && rangeOk() ? { ...S.range } : null, tAt = (d.frame + 0.5) / fps();
    // live: the page draws the moments now (before playback goes on); JPEG encoding happens after
    const shots = liveSrc ? { frame: liveSrc.snap(tAt), ...(r ? { start: liveSrc.snap((r.a + 0.5) / fps()), end: liveSrc.snap((r.b + 0.5) / fps()) } : {}) } : null;
    const body = { file: cur.rel, t: r ? (r.a + 0.5) / fps() : tAt, t2: r ? (r.b + 0.5) / fps() : null, at: r ? tAt : null, kind: d.kind, layer: d.layer || null, text: (d.text || '').trim(), drawing: d.shapes, region: d.shapes.length ? padRegion(bbox(d.shapes), d.shapes.every(x => x.type === 'pin') ? 0.08 : 0) : null, images: { strokes }, fps: fps() };
    // optimistic: the note is in the list right away (pictures follow over SSE when the hub has cut them)
    const tmp = { ...body, id: nextId(), images: {}, pending: true, local: true, status: 'open', createdAt: new Date().toISOString(), history: [] };
    notes.push(tmp); saving++; S.draft = null; quickOpen = false; quick.hidden = true; notesPanel.closeComposer(); setTool('cursor'); S.selected = tmp.id;
    notesPanel.render(); notesPanel.scrollTo(tmp.id); timeline.draw(); redraw();
    if (r && !S.loopOn) clearRange();   // the range was for this note
    if (d.resume) videoA.play().catch(() => { });   // the click paused a playing video: carry on watching
    perf.shown(!!d.resume);
    try {
      if (shots) for (const [k, c] of Object.entries(shots)) if (c) body.images[k] = await encodeJpeg(c);
      const tp = performance.now(); const n = await api(`/api/project/${id}/notes`, { method: 'POST', body }); perf.post(performance.now() - tp);
      const early = earlyNotes.get(n.id); earlyNotes.delete(n.id);
      const sel = S.selected === tmp.id; for (const k of Object.keys(tmp)) delete tmp[k]; Object.assign(tmp, early?.imgV ? early : n);
      if (sel) S.selected = tmp.id;
      if (saving === 1) { for (const [k, e] of earlyNotes) if (!notes.some(x => x.id === k)) notes.push(e); earlyNotes.clear(); }
      notesPanel.render(); timeline.draw(); redraw();
      toast(`Note #${n.id} saved`);
    } catch (e) {
      notes = notes.filter(x => x !== tmp); notesPanel.render(); timeline.draw(); redraw();
      toast('Could not save: ' + e.message, true);
      // A failed save may arrive after another note was started; retain both drafts without moving playback.
      if (!S.draft) { S.draft = d; S.undo = recovery.undo; S.redo = recovery.redo; S.range = recovery.range; notesPanel.closeComposer(); notesPanel.openComposer(); updRange(); }
      else { S.parkedDrafts.push(recovery); notesPanel.renderDrafts(); }
    } finally { saving--; }
  }
  // The user felt 1–2 s after Enter (Oct 26) that could not be reproduced here (~20 ms). When a save is slow in the
  // user's own window, what was slow goes to the hub (data\perf.jsonl): JS work, first screen update, hub answer,
  // first video frame after resuming. Nothing is sent for normal saves.
  function probeSave() {
    const t0 = performance.now(), m = { live: !!liveSrc, notes: notes.length, file: cur.rel };
    let pending = 3;
    const done = () => { if (--pending) return; const worst = Math.max(m.paintMs || 0, m.postMs || 0, m.videoMs || 0); if (worst > 400) fetch('/api/perf', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind: 'note-save', ...m }) }).catch(() => { }); };
    return {
      shown(resumed) {
        m.jsMs = Math.round(performance.now() - t0);
        requestAnimationFrame(() => requestAnimationFrame(t => { m.paintMs = Math.round(t - t0); done(); }));
        if (resumed && videoA.requestVideoFrameCallback && !liveSrc) { const to = setTimeout(() => { m.videoMs = 5000; done(); }, 5000); videoA.requestVideoFrameCallback(now => { clearTimeout(to); m.videoMs = Math.round(now - t0); done(); }); } else done();
      },
      post(ms) { m.postMs = Math.round(ms); done(); },
    };
  }
  // a canvas as a JPEG data URL, one task later so the list and playback update first
  // (toBlob looked better but its callback waited ~1 s whenever the window was not painting)
  const encodeJpeg = c => new Promise(ok => setTimeout(() => { try { ok(c.toDataURL('image/jpeg', 0.9)); } catch { ok(null); } }, 0));
  let saving = 0; const earlyNotes = new Map();   // SSE news about a note whose POST has not answered yet
  function selectNote(nid) { S.selected = nid; showNotes(); notesPanel.render(); notesPanel.scrollTo(nid); timeline.draw(); redraw(); }

  // ---------- overlay
  const octx = ov.getContext('2d');
  let live = null;   // shape being drawn
  let labelHits = [];   // note labels on the frame, in 0..1 coords, so a click can open the note
  const nextId = () => notes.reduce((m, n) => Math.max(m, n.id), 0) + 1;
  const numbered = (shapes, num) => shapes.map(s => s.type === 'pin' ? { ...s, num } : s);
  function redraw() {
    const W = ov.width, H = ov.height; octx.clearRect(0, 0, W, H);
    const t = noteTime(); labelHits = [];
    for (const n of notes) {
      if (!liveMode && n.file && n.file !== cur.rel && n.file !== '~live') continue;
      const at = n.at ?? n.t, near = Math.abs(t - at) < 0.35 || (n.t2 != null && t >= n.t && t <= n.t2);
      if (!near && n.id !== S.selected) continue;
      if (n.id === S.selected && !near && Math.abs(t - at) > 2) continue;
      const sh = numbered(n.drawing || [], n.id); paint(octx, sh, W, H, near ? 0.95 : 0.4);
      const b = sh.length ? bbox(sh) : [0.02, 0.04];
      octx.font = `600 ${Math.max(13, W * 0.013)}px Segoe UI`; const txt = `#${n.id} ${n.text.slice(0, 42)}`, tw = octx.measureText(txt).width;
      const lh = Math.max(22, W * 0.02), onlyPin = sh.length && sh.every(x => x.type === 'pin'), pr = pinR(W);
      // a point note: label beside the marker head; anything else: above the drawing
      const x = Math.min(W - tw - 20, b[0] * W + (onlyPin ? pr * 1.4 : 0)), y = Math.max(4, onlyPin ? b[1] * H - pr * PIN_HEAD - lh / 2 : b[1] * H - 30);
      octx.fillStyle = 'rgba(0,0,0,.72)'; octx.fillRect(x, y, tw + 14, lh); octx.fillStyle = '#fff'; octx.textBaseline = 'top'; octx.fillText(txt, x + 7, y + 4);
      if (near) labelHits.push({ n, x0: x / W, y0: y / H, x1: (x + tw + 14) / W, y1: (y + lh) / H });
    }
    if (S.draft && S.frame === S.draft.frame) paint(octx, numbered(S.draft.shapes, nextId()), W, H);
    if (live) paint(octx, [live], W, H);
    placeQuick();
  }
  const ptOf = e => { const r = ov.getBoundingClientRect(); return [Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)), Math.max(0, Math.min(1, (e.clientY - r.top) / r.height))]; };
  let textAt = null, down = null, panning = null, spaceDown = false, spaceUsed = false;
  ov.addEventListener('pointerdown', e => {
    if (e.button !== 0 && e.button !== 1) return;
    ov.setPointerCapture(e.pointerId);
    const pt = ptOf(e);
    const startPan = () => { panning = { x: e.clientX, y: e.clientY, zx: S.z.x, zy: S.z.y, moved: false }; };
    if (spaceDown || e.button === 1) { startPan(); spaceUsed = true; return; }
    const at = noteTime(), wasPlaying = !videoA.paused;
    if (S.tool === 'cursor') {
      down = { pt, at, wasPlaying };
      if (S.z.k > 1) startPan(); else freezeNoteFrame(at);
      return;
    }
    ensureDraft(at, false);   // drawing keeps keyboard focus on the page (tool keys, Ctrl+Z); click the note box to type
    if (S.frame !== S.draft.frame) return;
    if (S.tool === 'eraser') { const i = hit(S.draft.shapes, pt); if (i >= 0) { pushUndo(); S.draft.shapes.splice(i, 1); redraw(); notesPanel.updateComposer(); } return; }
    if (S.tool === 'text') { textAt = pt; return; }   // the box opens on pointerup, so the click can't steal its focus
    live = { type: S.tool, color: S.color, width: S.width, pts: [pt] };
    down = { pt, x: e.clientX, y: e.clientY };
    redraw();
  });
  ov.addEventListener('pointermove', e => {
    if (panning) { const dx = e.clientX - panning.x, dy = e.clientY - panning.y; if (Math.hypot(dx, dy) > 3) panning.moved = true; S.z.x = panning.zx + dx; S.z.y = panning.zy + dy; applyZoom(); return; }
    if (!live) return;
    const q = ptOf(e);
    if (live.type === 'pen') live.pts.push(q); else if (live.type !== 'pin') live.pts = [live.pts[0], q];
    redraw();
  });
  ov.addEventListener('pointerup', e => {
    if (panning) { const moved = panning.moved; panning = null; if (moved || spaceDown) { down = null; return; } }
    if (textAt) { const p = textAt; textAt = null; openTextInput(p, e); return; }
    if (live) {
      const q = ptOf(e), moved = Math.hypot(q[0] - live.pts[0][0], q[1] - live.pts[0][1]) > 0.006;
      if (!moved && live.type !== 'pin') { live.type = 'pin'; live.pts = [live.pts[0]]; }
      pushUndo(); S.draft.shapes.push(live); live = null; redraw(); notesPanel.updateComposer(); askNote(); return;
    }
    if (S.tool === 'cursor' && down) { const click = down; down = null; quickPoint(click.pt, click.at, click.wasPlaying); }
  });
  ov.addEventListener('pointercancel', () => { down = null; panning = null; live = null; textAt = null; redraw(); });

  // ---------- quick point: click → numbered point + a note box right there
  function noteAt(pt) {
    const l = labelHits.find(b => pt[0] >= b.x0 && pt[0] <= b.x1 && pt[1] >= b.y0 && pt[1] <= b.y1); if (l) return l.n;
    const t = noteTime();
    for (const n of notes) {
      if ((!liveMode && n.file && n.file !== cur.rel && n.file !== '~live') || !(n.drawing || []).length) continue;
      if (!(Math.abs(t - (n.at ?? n.t)) < 0.35 || (n.t2 != null && t >= n.t && t <= n.t2))) continue;
      if (hit(n.drawing, pt, 0.03) >= 0) return n;
    }
    return null;
  }
  function quickPoint(pt, at = noteTime(), wasPlaying = !videoA.paused) {
    freezeNoteFrame(at);
    const n = noteAt(pt);
    if (n && !(S.draft && S.frame === S.draft.frame)) { selectNote(n.id); return; }
    const previous = S.draft;
    const d = ensureDraft(at, false);
    if (d === previous) {   // same frame: move the lone quick point, or add a point to the drawing
      if (quickEmpty(d) && d.shapes.length === 1) d.shapes[0].pts = [pt];
      else { pushUndo(); d.shapes.push({ type: 'pin', color: S.color, width: S.width, pts: [pt] }); }
      redraw(); notesPanel.updateComposer();
      if (d.quick) openQuick(); else notesPanel.focusText();
      return;
    }
    d.quick = true; d.resume = wasPlaying;
    d.shapes.push({ type: 'pin', color: S.color, width: S.width, pts: [pt] });
    S.frame = d.frame; if (wasPlaying && !liveSrc) seekFrame(d.frame);
    redraw(); notesPanel.updateComposer(); openQuick();
  }
  // a mark was just drawn and nothing is written yet: open the note box beside it (the user asked: after a box, what now?)
  function askNote() { const d = S.draft; if (!d || (d.text || '').trim()) return; d.quick = true; openQuick(); }
  function openQuick() {
    if (!S.draft) return;
    quickOpen = true; quickText.value = S.draft.text || '';
    openQuickHead(); quick.hidden = false; placeQuick(); quickText.focus();
  }
  function openQuickHead() {
    const d = S.draft; if (!d) return;
    quickHead.textContent = `#${nextId()} · ${TC(d.frame / fps())} · frame ${d.frame}` + (d.useRange && rangeOk() ? ` · range ${S.range.a} → ${S.range.b}` : '');
  }
  function placeQuick() {
    const show = quickOpen && !!S.draft && S.frame === S.draft.frame;
    quick.hidden = !show; if (!show) return;
    // beside the newest mark: a point's head, or the top-right corner of a box / circle / line / label
    const last = S.draft.shapes[S.draft.shapes.length - 1], isPin = !last || last.type === 'pin';
    const pt = !last ? [0.5, 0.5] : isPin ? last.pts[0] : (b => [b[2], b[1]])(bbox([last]));
    const r = ov.getBoundingClientRect(), vr = view.getBoundingClientRect(), w = quick.offsetWidth || 270, qh = quick.offsetHeight || 110;
    const px = r.left - vr.left + pt[0] * r.width, py = r.top - vr.top + pt[1] * r.height;
    const pr = isPin ? pinR(r.width) : 0, gap = isPin ? pr * 1.5 + 8 : 12; let x = px + gap, y = isPin ? py - pr * PIN_HEAD - 22 : py - 10;
    if (x + w > vr.width - 6) x = px - gap - w;   // no room on the right: open on the left of the point
    quick.style.left = Math.max(6, x) + 'px'; quick.style.top = Math.max(6, Math.min(vr.height - qh - 6, y)) + 'px';
  }
  quickText.addEventListener('input', () => { if (S.draft) { S.draft.text = quickText.value; notesPanel.updateComposer(); } });
  quickText.addEventListener('keydown', e => {
    e.stopPropagation();
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); if (quickText.value.trim()) saveDraft(); else toast('Describe what is wrong first (or press Esc).'); return; }
    if (e.key === 'Escape') { e.preventDefault(); if (!(S.draft?.text || '').trim() && S.draft?.shapes.every(x => x.type === 'pin')) cancelDraft(); else { quickOpen = false; quick.hidden = true; } return; }   // a written note stays in the panel
    if (e.key === ' ' && !quickText.value) { e.preventDefault(); cancelDraft(); togglePlay(); }   // the click paused it, Space carries on
    if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && !quickText.value) {   // nothing written yet: arrows step frames, the point goes away
      e.preventDefault(); const dir = e.key === 'ArrowRight' ? 1 : -1; cancelDraft();
      if (e.shiftKey) seek(nowT() + 5 * dir); else step(dir);
    }
  });
  function openTextInput(pt, e) {
    const r = view.getBoundingClientRect();
    textInput.hidden = false; textInput.value = '';
    textInput.style.left = (e.clientX - r.left) + 'px'; textInput.style.top = (e.clientY - r.top - 14) + 'px'; textInput.style.color = S.color;
    textInput.focus();
    let done = false;
    const finish = keep => {
      if (done) return; done = true;
      const txt = textInput.value.trim(); textInput.hidden = true;
      if (keep && txt && S.draft) { pushUndo(); S.draft.shapes.push({ type: 'text', color: S.color, size: S.width, pts: [pt], text: txt }); redraw(); notesPanel.updateComposer(); askNote(); }
    };
    textInput.onkeydown = ev => {
      if (ev.key === 'Enter' || ev.key === 'Escape') { ev.preventDefault(); finish(ev.key === 'Enter'); }
      ev.stopPropagation();
    };
    textInput.onblur = () => finish(true);   // clicking away keeps what was typed
  }

  // ---------- compare
  function setCompare(rel) {
    const o = vids.find(v => v.rel === rel);
    S.cmp = o || null;
    if (o) { videoB.src = '/media?p=' + encodeURIComponent(o.path); videoB.addEventListener('loadedmetadata', () => { videoB.currentTime = videoA.currentTime; }, { once: true }); }
    else { videoB.removeAttribute('src'); videoB.load(); }
    applyCompare();
  }
  function applyCompare() {
    const on = !!S.cmp, m = S.cmpMode;
    modeSeg.hidden = !on; modeBtns.forEach(b => b.classList.toggle('on', b.dataset.m === m));
    frameB.hidden = !(on && m === 'side');
    if (on && m === 'side') frameB.append(videoB); else frameA.insertBefore(videoB, diffCv);
    videoB.hidden = !on || m === 'diff';
    videoB.classList.toggle('wiped', on && m === 'wipe');
    videoB.style.clipPath = on && m === 'wipe' ? `inset(0 0 0 ${S.wipe * 100}%)` : '';
    wipeHandle.hidden = !(on && m === 'wipe'); wipeHandle.style.left = (S.wipe * 100) + '%';
    diffCv.hidden = !(on && m === 'diff');
    tagA.hidden = tagB.hidden = !on; tagA.textContent = cur.rel; tagB.textContent = S.cmp?.rel || '';
    tagB.style.left = m === 'side' ? 'auto' : '';
    if (on && m === 'side') frameB.append(tagB); else frameA.append(tagB);
    layout();
  }
  wipeHandle.addEventListener('pointerdown', e => {
    e.stopPropagation(); wipeHandle.setPointerCapture(e.pointerId);
    const move = ev => { const r = frameA.getBoundingClientRect(); S.wipe = Math.max(0, Math.min(1, (ev.clientX - r.left) / r.width)); videoB.style.clipPath = `inset(0 0 0 ${S.wipe * 100}%)`; wipeHandle.style.left = (S.wipe * 100) + '%'; };
    wipeHandle.onpointermove = move; wipeHandle.onpointerup = () => { wipeHandle.onpointermove = null; };
  });
  const dctx = diffCv.getContext('2d');
  function drawDiff() {
    if (!S.cmp || S.cmpMode !== 'diff' || diffCv.hidden) return;
    try {
      dctx.globalCompositeOperation = 'source-over'; dctx.drawImage(videoA, 0, 0, diffCv.width, diffCv.height);
      dctx.globalCompositeOperation = 'difference'; dctx.drawImage(videoB, 0, 0, diffCv.width, diffCv.height);
    } catch { }
  }
  const diffTimer = setInterval(drawDiff, 120);

  // ---------- changed-only playback
  let changedRun = null;
  function playChanged() {
    const rs = (versionInfo()?.changedRanges || []).slice().sort((a, b) => a[0] - b[0]); if (!rs.length) return;
    let i = 0;
    changedRun = { check: t => { if (t > rs[i][1] + 0.5) { i++; if (i >= rs.length) { videoA.pause(); changedRun = null; return; } seek(Math.max(0, rs[i][0] - 1)); } } };
    seek(Math.max(0, rs[0][0] - 1)); videoA.play().catch(() => { });
  }

  // ---------- review copy (instant frame stepping)
  function proxyUi(st) {
    if (!st) return;
    proxyPill.className = 'pill ' + (st.state === 'ready' ? (S.usingProxy ? 'approved' : 'done') : st.state === 'failed' ? 'reopened' : 'review');
    proxyPill.textContent = st.state === 'ready' ? (S.usingProxy ? 'smooth frame stepping on' : 'original file') : st.state === 'running' ? `review copy ${Math.round((st.progress || 0) * 100)}%` : st.state === 'failed' ? 'could not create review copy' : `review copy queued${st.waiting ? ' (' + st.waiting + ')' : ''}`;
  }
  let proxyUrl = null, proxyKey = null;
  function useSource(url, isProxy) {
    S.resumeAt = videoA.currentTime; S.resumePlay = !videoA.paused;
    videoA.src = url; S.usingProxy = isProxy; proxyUi({ state: 'ready' });
  }
  proxyPill.onclick = () => { if (liveSrc) { liveSrc.reload(); return; } if (!proxyUrl) return; useSource(S.usingProxy ? '/media?p=' + encodeURIComponent(cur.path) : proxyUrl, !S.usingProxy); };
  if (!liveSrc) api('/api/media/proxy?p=' + encodeURIComponent(cur.path)).then(st => {
    proxyKey = st.key;
    if (st.state === 'ready') { proxyUrl = st.url; useSource(st.url, true); } else proxyUi(st);
  }).catch(() => { proxyPill.hidden = true; });
  // live preview: status in the pill, reload when Claude (or anyone) edits the film's code
  // scenes for the timeline's scene lane: from the live page when it is ready (stored for the rendered videos too),
  // else what the hub stored / the project's shots.json
  let scenesKey = '';
  function loadScenes(fromPage) {
    if (fromPage && liveSrc) {
      let r = { scenes: [] }; try { r = scenesFromPage(liveSrc.win, dur()); } catch { }
      if (r.scenes.length) {
        const k = JSON.stringify(r.scenes); if (k === scenesKey) return; scenesKey = k;
        timeline.setScenes(r.scenes);
        api(`/api/project/${id}/scenes`, { method: 'PUT', body: { scenes: r.scenes, source: r.source } }).catch(() => { });
        return;
      }
    }
    api(`/api/project/${id}/scenes`).then(r => { if (r?.scenes?.length) { scenesKey = JSON.stringify(r.scenes); timeline.setScenes(r.scenes); } }).catch(() => { });
  }
  function liveStatus(st) {
    if (st.state === 'ready') setTimeout(() => loadScenes(true), 0);
    proxyPill.title = 'Live preview: the film is drawn from its code, with no render. Reloads automatically when the code changes · click to reload now';
    if (st.state === 'loading') { proxyPill.className = 'pill inceleme'; proxyPill.textContent = 'live · loading…'; }
    else if (st.state === 'error') { proxyPill.className = 'pill hâlâ-var'; proxyPill.textContent = 'live · error'; toast('Preview page error: ' + st.error, true); }
    else { proxyPill.className = 'pill approved'; proxyPill.textContent = st.fps != null && st.state === 'playing' ? `live · ${st.fps} fps` : 'live · ready'; }
  }
  // ---------- narration text: timeline row + captions under the video
  api(`/api/project/${id}/transcript`).then(tr => { if (!tr?.ok) return; trData = tr; timeline.setTranscript(tr); transport.update(shownT()); updCaptions(); }).catch(() => { });
  function toggleCaptions() { if (!trData) return; ccOn = !ccOn; try { localStorage.setItem('vh-cc', ccOn ? '1' : '0'); } catch { } updCaptions(); transport.update(shownT()); }
  function updCaptions() {
    if (!trData || !ccOn) { capBar.hidden = true; return; }
    const t = noteTime(), ph = trData.phrases.find(([s, e]) => t >= s && t <= e + 0.15);
    capBar.hidden = !ph; if (ph && capBar.textContent !== ph[2]) capBar.textContent = ph[2];
  }

  // ---------- check tour: Claude's fixed notes one by one, before/after, approve or "still there"
  let tour = null;
  function startTour() {
    const ids = notes.filter(n => n.status === 'fixed').sort((a, b) => a.t - b.t).map(n => n.id);
    if (!ids.length) return toast('No fixed notes to check.');
    // fixes of a rendered film are in its newest version: check there
    if (!liveMode && p.latest && cur.rel !== p.latest && vids.some(v => v.rel === p.latest)) { location.hash = `#/review/${id}/${encodeURIComponent(p.latest)}?tour=1`; return; }
    tour = { ids, i: 0, ok: 0, again: 0 }; showTour();
  }
  function showBefore(on) {
    const n = tour && notes.find(x => x.id === tour.ids[tour.i]); const can = !!n?.images?.frame;
    S.before = on && can; beforeImg.hidden = beforeTag.hidden = !S.before;
    if (tour) tourBar.querySelector('.bbtn')?.classList.toggle('on', S.before);
    if (on && !can) toast('This note has no previous frame.');
  }
  function showTour() {
    const n = notes.find(x => x.id === tour.ids[tour.i]); if (!n) return endTour();
    selectNote(n.id); showBefore(false);
    beforeImg.src = n.images?.frame ? `/api/project/${id}/noteimg/${n.id}/frame` : '';
    if (n.t2 != null) playRange(n); else { S.loopOn = false; if (!videoA.paused) videoA.pause(); seek(n.at ?? n.t); }
    const again = h('input', { class: 'tourin', placeholder: 'What is still wrong? Enter', hidden: true });
    again.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter' && again.value.trim()) verdict('reopened', again.value.trim()); if (e.key === 'Escape') again.hidden = true; });
    tourBar.innerHTML = '';
    tourBar.append(
      h('b', {}, `Check ${tour.i + 1}/${tour.ids.length}`),
      h('span', { class: 'tnote' }, h('b', {}, `#${n.id} `), n.text || '(no text)', n.reply ? h('span', { class: 'treply' }, ` · ${agentName()}: ` + n.reply) : null),
      h('span', { class: 'spacer' }),
      h('button', { class: 'bbtn', title: 'Switch between the frame when the note was written and the current frame (B)', onclick: () => showBefore(!S.before) }, 'Before ⇄ After'),
      h('button', { class: 'primary', title: 'Fixed (Y)', onclick: () => verdict('approved') }, '✓ Approve'),
      h('button', { class: 'danger', onclick: () => { again.hidden = false; again.focus(); } }, 'Still there…'), again,
      h('button', { class: 'ghost', title: 'Previous', onclick: () => { if (tour.i > 0) { tour.i--; showTour(); } } }, '◀'),
      h('button', { class: 'ghost', title: 'Skip', onclick: () => next() }, '▶'),
      h('button', { class: 'ghost', onclick: () => endTour() }, 'Finish'));
    tourBar.hidden = false;
  }
  async function verdict(status, why) {
    const n = notes.find(x => x.id === tour.ids[tour.i]); if (!n) return next();
    const body = { status, ...(why ? { text: `${n.text}
— still there: ${why}` } : {}) };
    try { Object.assign(n, await api(`/api/project/${id}/note/${n.id}`, { method: 'POST', body })); } catch (e) { return toast('Could not save: ' + e.message, true); }
    if (status === 'approved') tour.ok++; else tour.again++;
    notesPanel.render(); timeline.draw(); next();
  }
  function next() { if (tour.i + 1 >= tour.ids.length) return endTour(); tour.i++; showTour(); }
  function endTour() {
    if (!tour) return;
    const { ok, again } = tour; tour = null; tourBar.hidden = true; showBefore(false); clearRange();   // the range was only for checking
    toast(`Review finished: ${ok} approved${again ? `, ${again} still there — use "Send to ${agentName()}" to send them back` : ''}.`);
  }

  // notes changed elsewhere (pictures ready, Claude's replies, another window): merge without reloading the list
  const offNote = onHubEvent('note', ev => {
    if (ev?.project !== id) return;
    if (ev.removed != null) { if (notes.some(n => n.id === ev.removed)) { notes = notes.filter(n => n.id !== ev.removed); notesPanel.render(); timeline.draw(); redraw(); } return; }
    if (ev.bulk) { notesPanel.reload(); return; }
    const n = ev.note; if (!n) return;
    const mine = notes.find(x => x.id === n.id && !x.local);
    if (mine) { if (JSON.stringify(mine) === JSON.stringify(n)) return; for (const k of Object.keys(mine)) delete mine[k]; Object.assign(mine, n); }
    else if (saving) { earlyNotes.set(n.id, n); return; }
    else notes.push(n);
    notesPanel.render(); timeline.draw(); redraw();
  });
  const offLive = onHubEvent('live-changed', ev => { if (liveSrc && ev?.project === id) { api('/api/project/' + id + '/live').then(fresh => {
        if (fresh.ok) liveSrc.reload(fresh);
      }).catch(e => toast('Could not reload code: ' + e.message, true)); toast('Code changed, preview reloaded' + (ev.files?.length ? ': ' + ev.files.slice(0, 3).join(', ') : '')); } });
  const offProxy = onHubEvent('proxy', ev => {
    if (!ev || ev.key !== proxyKey) return;
    if (ev.state === 'ready') api('/api/media/proxy?p=' + encodeURIComponent(cur.path)).then(st => { if (st.state === 'ready') { proxyUrl = st.url; useSource(st.url, true); } });
    else proxyUi(ev);
  });
  if (!liveSrc) api('/api/media/strip?p=' + encodeURIComponent(cur.path)).then(m => m?.url && timeline.setStrip(m)).catch(() => { });
  const wavePath = liveSrc ? liveInfo.audioPath : cur.path;
  // waveforms: peaks for the timeline rows (sharp when zoomed in); the PNG when the peaks route fails
  // (png = false for clip files: no PNG fallback there)
  async function loadWave(wid, file, png = true) {
    try {
      const r = await fetch('/api/media/peaks?p=' + encodeURIComponent(file));
      if (!r.ok) throw new Error('peaks ' + r.status);
      const data = new Int8Array(await r.arrayBuffer());
      timeline.setPeaks(wid, { rate: +r.headers.get('X-Peaks-Rate') || 100, dur: +r.headers.get('X-Duration') || data.length / 200, data });
    } catch {
      if (!png) return;
      const w = await api('/api/media/wave?p=' + encodeURIComponent(file)).catch(() => null);
      if (w?.url) { if (wid === 'mix') timeline.setWave(w.url); else timeline.setLayerImage(wid, w.url); }
    }
  }
  if (wavePath) loadWave('mix', wavePath);
  // after a sound build the live mix is a new file (new mtime → new peaks); a rendered video's sound never changes here
  // after a build the player's sound is the current state again: the mixer's engine can stop
  const soundBuilt = () => { liveSrc?.reloadAudio?.(); if (liveSrc && wavePath) loadWave('mix', wavePath); mixer?.built(); };
  // the live mixer: channel levels / M / S / master in the timeline headers and the Sounds tab's Channels section;
  // sound layers (voice / music / SFX stems, the SFX cue list) are loaded after the page settles, waveforms one at a
  // time (cached by the hub), so the preview never waits for them
  mixer = createMixer({
    media: videoA, projectId: id, live: !!liveSrc, dur: () => dur(), range: () => rangeOk() ? rangeSec() : null,
    clips: () => soundEd?.clips() || [], clipUrl: src => '/media?p=' + encodeURIComponent(p.path + '/' + src), applyQueue,
    history: { push: () => pushTag('sound') }, status: () => stSounds, onSaved: r => sceneEd?.syncSound(r.sound), scaleClips: f => soundEd?.scaleGains(f),
  });
  soundsHost.append(mixer.duckEl, mixer.el);
  // P4: the music-level bands on the Music row (ducks: select, drag edges, Delete)
  const bandOps = { select: s => { mixer?.selectDuck(s); if (s) side.show('sounds'); }, set: (s, patch) => mixer?.setDuck(s, patch) };
  mixer.onChange(() => { timeline.setBands(mixer.musicBands(), bandOps); refreshApply(); updMute(); });
  timeline.setBands(mixer.musicBands(), bandOps);
  timeline.setMixer(mixer);
  // added sounds (effects, music beds): their lanes on the timeline + the editing row in the Clip tab
  soundEd = createSoundEditor({ projectId: id, timeline, dur: () => dur(), time: () => nowT(), seek: t => seek(t), fps, applyQueue, status: () => stClip, onPush: () => pushTag('clips'), onSelect: cid => { if (cid) side.show('clip'); }, onClips: loaded => mixer?.clipsChanged(loaded) });
  clipHost.append(soundEd.el); setTimeout(() => soundEd?.init().catch(() => { }), 900);
  // P4: the sound library at the top of the Sounds tab (▶ listen, + at the playhead, drag onto the timeline)
  const library = createLibrary({ onAdd: item => soundEd?.dropAdd({ item, t: nowT() }), onFile: () => soundEd?.pickFile() });
  soundsHost.prepend(library.el);
  // files dragged from your file manager and dropped anywhere but the timeline would make the window open the file
  const dropGuard = e => { if (![...(e.dataTransfer?.types || [])].includes('Files') || e.target?.closest?.('.tl2-body')) return; e.preventDefault(); if (e.type === 'dragover') e.dataTransfer.dropEffect = 'none'; else toast('Drop the sound file onto the timeline'); };
  document.addEventListener('dragover', dropGuard); document.addEventListener('drop', dropGuard);
  setTimeout(() => Promise.all([api(`/api/project/${id}/layers`), api(`/api/project/${id}/sound-info`).catch(() => null), api(`/api/project/${id}/tweaks`).catch(() => ({}))]).then(async ([L, info, tw]) => {
    if (!mixer) return;
    layerLabels = L.layers.map(l => l.label).concat(L.cues && L.cues.length && !L.layers.some(l => l.id === 'sfx') ? ['Effects'] : []);
    // a 3D studio film mixes voice / music / effects on buses without stem files: placeholder rows (level only)
    const rowsL = info?.mode === 'studio' && !L.layers.some(l => ['vo', 'music', 'sfx'].includes(l.id))
      ? { ...L, layers: [{ id: 'vo', label: 'Voice', placeholder: true }, { id: 'music', label: 'Music', placeholder: true }, { id: 'sfx', label: 'Effects', placeholder: true }, ...L.layers] } : L;
    timeline.setLayers(rowsL); mixer.setLayers(rowsL, info, tw?.sound || []);
    for (const l of L.layers) await loadWave(l.id, l.file);
  }).catch(() => { }), 1200);
  if (!liveSrc) loadScenes(false);
  if (liveSrc) { cmpSel.hidden = true; changedBtn.hidden = true; }

  // ---------- misc actions
  async function saveFrame() {
    if (liveSrc) { const url = liveSrc.capture((S.frame + 0.5) / fps(), cur.w || 1920); if (!url) return toast('Could not capture frame', true); const a = h('a', { href: url, download: `${(p.title || p.name).replace(/[\\/:*?"<>|]/g, '')}_canli_kare${S.frame}.jpg` }); document.body.append(a); a.click(); a.remove(); return; }
    const r = await fetch(`/api/media/frame?p=${encodeURIComponent(cur.path)}&n=${S.frame}`); if (!r.ok) { toast('Could not capture frame', true); return; }
    const url = URL.createObjectURL(await r.blob()); const a = h('a', { href: url, download: `${cur.name.replace(/\.[^.]+$/, '')}_kare${S.frame}.png` }); document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 5000);
  }
  // "🖼 Thumbnail": a new thumbnail for this project whose tracing underlay and composition reference is the current frame
  async function frameToThumbnail() {
    try {
      let data;
      if (liveSrc) data = liveSrc.capture((S.frame + 0.5) / fps(), 1920);
      else {
        const r = await fetch(`/api/media/frame?p=${encodeURIComponent(cur.path)}&n=${S.frame}`); if (!r.ok) throw new Error('could not capture frame');
        const blob = await r.blob();
        data = await new Promise(res => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.readAsDataURL(blob); });
      }
      if (!data) throw new Error('could not capture frame');
      const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = data; });
      const format = img.naturalHeight > img.naturalWidth ? '9:16' : '16:9';
      const t = await api('/api/thumbstudio/new', { method: 'POST', body: { project: p.id, title: (p.title || p.name) + ' · frame ' + S.frame, format } });
      const base = `/api/thumbstudio/${t.pid}/${t.tid}`;
      const name = `kare_${S.frame}.${data.startsWith('data:image/png') ? 'png' : 'jpg'}`;
      const tr = await api(base + '/ref', { method: 'POST', body: { name, data, trace: true } });
      await api(base + '/ref', { method: 'POST', body: { name, data, role: 'composition', note: 'frame from the film (' + S.frame + ')' } });
      const b = await api(base);
      await api(base, { method: 'PUT', body: { ...b, layers: [{ id: 'L1', type: 'trace', name: 'Trace underlay: frame ' + S.frame, file: tr.file, opacity: 0.5, locked: true, x: 0, y: 0, w: 1, h: 1, depth: 100 }] } });
      location.hash = `#/thumbstudio/${t.pid}/${t.tid}`;
    } catch (e) { toast('Could not start thumbnail: ' + e.message, true); }
  }
  function fullscreen() { if (document.fullscreenElement) document.exitFullscreen(); else rv2.requestFullscreen().catch(() => { }); }   // the whole editor: timeline and side panel stay
  function toggleHelp(on) { helpBox.hidden = on === undefined ? !helpBox.hidden : !on; }
  function nextNote(dir) {
    const list = notes.slice().sort((a, b) => a.t - b.t), t = videoA.currentTime;
    const n = dir > 0 ? list.find(x => x.t > t + 0.05) : list.reverse().find(x => x.t < t - 0.05);
    if (n) { selectNote(n.id); seek(n.t); }
  }

  // ---------- keys
  const onKey = e => {
    // Alt+← / → would be the browser's Back / Forward: never let it leave the editor, also from a text field
    const altArrow = e.altKey && !e.ctrlKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight');
    if (altArrow) e.preventDefault();
    if (e.target.closest?.('textarea, select, input:not([type=range])')) return;   // a focused volume slider still lets arrows step frames
    // Alt+← / →: the selected added sound 1 frame earlier / later (Shift: 10)
    if (altArrow) { soundEd?.nudge((e.key === 'ArrowRight' ? 1 : -1) * (e.shiftKey ? 10 : 1)); return; }
    // the timeline is the active area: Delete removes the selected sound (one undo step), Esc lets go of it
    // a selected duck band (Music row): Delete removes it, Esc lets go of it
    if (area === 'timeline' && !e.ctrlKey && !e.altKey && !e.metaKey && mixer?.duckSelected()) {
      if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); mixer.removeDuck(mixer.duckSelected().shot); return; }
      if (e.key === 'Escape') { mixer.selectDuck(null); return; }
    }
    if (area === 'timeline' && !e.ctrlKey && !e.altKey && !e.metaKey && soundEd?.selected()) {
      if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); soundEd.remove(soundEd.selected().id); return; }
      if (e.key === 'Escape') { soundEd.select(null); return; }
    }
    // Turkish keyboards: the I key types 'ı' and Shift+I 'İ'; treat both as i
    const k = e.key, lk = k.length <= 2 ? k.toLowerCase().normalize('NFD').replace(/\u0307/g, '').replace('ı', 'i') : k.toLowerCase();
    if (tour && !e.ctrlKey && !e.altKey) {
      if (lk === 'y') { e.preventDefault(); verdict('approved'); return; }
      if (lk === 'b') { e.preventDefault(); showBefore(!S.before); return; }
      if (k === 'Escape') { endTour(); return; }
    }
    if (!e.ctrlKey && lk === 'c' && trData) { toggleCaptions(); return; }
    if (e.ctrlKey && !e.altKey && lk === 'z') { e.preventDefault(); e.shiftKey ? routeRedo() : routeUndo(); return; }
    if (e.ctrlKey && !e.altKey && lk === 'y') { e.preventDefault(); routeRedo(); return; }
    // Turkish Q types [ ] \ with AltGr, which Chrome reports as Ctrl+Alt: these run before the modifier check below
    const altGr = e.getModifierState?.('AltGraph') || (e.ctrlKey && e.altKey), plain = !e.ctrlKey && !e.altKey && !e.metaKey;
    if ((k === '[' || k === ']') && (plain || altGr)) { e.preventDefault(); speedStep(k === ']' ? 1 : -1); return; }
    if (k === '\\' && (plain || altGr)) { e.preventDefault(); toggleLoop(); return; }
    if (e.ctrlKey && !e.altKey && !e.metaKey && lk === 'l') { e.preventDefault(); toggleLoop(); return; }
    if (e.ctrlKey || e.altKey || e.metaKey) return;
    if (k === ' ') {
      e.preventDefault();
      // a running shuttle stops on Space, and the release must not start forward play
      if (shuttle.active()) { shuttle.stop(); spaceDown = true; spaceUsed = true; return; }
      if (!e.repeat) { spaceDown = true; spaceUsed = false; } return;
    }
    // frame keys take the playhead back from a running shuttle (a 1-frame step is under its "moved by someone else" check)
    if (k === 'ArrowLeft') { e.preventDefault(); shuttle.stop(); e.shiftKey ? seek(nowT() - 5) : step(-1); return; }
    if (k === 'ArrowRight') { e.preventDefault(); shuttle.stop(); e.shiftKey ? seek(nowT() + 5) : step(1); return; }
    if (k === 'Home') { e.preventDefault(); shuttle.stop(); seek(0); return; }
    if (k === 'End') { e.preventDefault(); shuttle.stop(); seek(dur() - 1 / fps()); return; }
    // Esc never throws away drawings or text: it closes help, then drops the tool, then closes an empty draft
    if (k === 'Escape') { if (!helpBox.hidden) toggleHelp(false); else if (S.tool !== 'cursor') setTool('cursor'); else if (S.draft && !S.draft.shapes.length && !(S.draft.text || '').trim()) cancelDraft(); return; }
    if (k === '?' || k === 'F1' || lk === 'h') { e.preventDefault(); toggleHelp(); return; }
    // J / K / L shuttle: back · stop (on this frame) · forward; pressing J or L again goes 2× 4× 8×
    if (lk === 'k') { if (!shuttle.stop()) togglePlay(); return; }
    if (lk === 'j') { if (!e.repeat) shuttle.reverse(); return; }
    if (lk === 'l') { if (!e.repeat) shuttle.forward(); return; }
    if (lk === 'z') { e.preventDefault(); zoomTimeline(e.shiftKey); return; }
    if (lk === 'i') { if (e.shiftKey) { if (S.range.a != null) seekFrame(S.range.a); } else setIn(S.frame); return; }
    if (lk === 'o') { if (e.shiftKey) { if (S.range.b != null) seekFrame(S.range.b); } else setOut(S.frame); return; }
    if (k === ',') { nextNote(-1); return; }
    if (k === '.') { nextNote(1); return; }
    if (lk === 'n') { e.preventDefault(); if (rangeOk() && !S.draft) noteForRange(); else { ensureDraft(); notesPanel.focusText(); } return; }
    if (lk === 'g') { e.preventDefault(); transport.focusTime(); return; }
    if (lk === 'f') { fullscreen(); return; }
    if (lk === 'u') { setMaster({ muted: !master().muted }); return; }
    if (k === '+' || k === '=') { zoomBy(1.5); return; }
    if (k === '-') { zoomBy(1 / 1.5); return; }
    if (k === '0') { zoomFit(); return; }
    if (k === '1') { zoom100(); return; }
    if (TOOL_KEYS[lk]) { setTool(TOOL_KEYS[lk]); return; }
  };
  // [ / ]: the speed select one step down / up
  function speedStep(d) {
    const i = SPEEDS.indexOf(transport.rate()), j = Math.max(0, Math.min(SPEEDS.length - 1, (i < 0 ? SPEEDS.indexOf(1) : i) + d));
    setRate(SPEEDS[j]); toast('Speed: ' + SPEEDS[j] + '×');
  }
  // Z: the timeline shows the I/O range (else ±5 s around the playhead); Shift+Z: the whole film
  function zoomTimeline(fitAll) {
    const V = timeline.view;
    if (fitAll) { V.fit(); return; }
    if (rangeOk()) { const [a, b] = rangeSec(); V.zoomToRange(a, b); } else { const t = nowT(); V.zoomToRange(t - 5, t + 5, 0); }
  }
  const onKeyUp = e => { if (e.key === ' ') { if (spaceDown && !spaceUsed && !e.target.closest?.('textarea, select, input:not([type=range])')) togglePlay(); spaceDown = false; } };
  document.addEventListener('keydown', onKey); document.addEventListener('keyup', onKeyUp);

  // a focused button would also react to Space; buttons give focus back after a click
  page.addEventListener('click', e => { const b = e.target.closest('button'); if (b) b.blur(); });
  // same for dropdowns: after a pick, arrow keys should step frames, not change the dropdown
  page.addEventListener('change', e => { if (e.target.tagName === 'SELECT') e.target.blur(); });
  refreshTools(); notesPanel.render(); updMute(); updRange(); tick();
  changedBtn.hidden = !(versionInfo()?.changedRanges?.length);
  if (S.selected) setTimeout(() => notesPanel.scrollTo(S.selected), 50);

  return () => {
    document.removeEventListener('keydown', onKey); document.removeEventListener('keyup', onKeyUp); document.removeEventListener('fullscreenchange', layout);
    document.removeEventListener('dragover', dropGuard); document.removeEventListener('drop', dropGuard); library.destroy();
    document.removeEventListener('fullscreenchange', onFs); document.removeEventListener('pointerdown', onPeekOutside, true); document.removeEventListener('pointerdown', onAreaDown, true); applyQueue.destroy();
    if (document.fullscreenElement === rv2) document.exitFullscreen().catch(() => { });
    if (toastEl && toastEl.parentNode !== document.body) document.body.append(toastEl);
    shuttle.stop({ pause: false }); transport.destroy();
    ro2.disconnect(); cancelAnimationFrame(clampRaf); topFit.destroy(); dockSplit.destroy(); sideSplit.destroy(); styleMenu?.close(); side.destroy();
    appEl?.classList.remove('app-editor', 'side-peek'); mainEl?.classList.remove('main-editor');
    offTips(); ro.disconnect(); timeline.destroy(); clearInterval(diffTimer); offProxy(); offLive(); offNote(); renderBtn?.destroy(); sceneEd?.destroy(); scanner?.destroy(); mixer?.destroy(); mixer = null; soundEd?.destroy(); soundEd = null; edit2d?.destroy(); liveCover?.destroy(); liveSrc?.destroy();
    videoA.pause(); videoA.removeAttribute('src'); videoA.load(); videoB.pause(); videoB.removeAttribute('src'); videoB.load();
    page.classList.remove('page-wide', 'page-editor');
  };
}
