// VideoHub UI: hash router + pages. No build step.
import { reviewPage } from './review.js';
import { outputsPanel, outputActions } from './outputs-panel.js';
import { activeRenders, elapsedSeconds, timeText, remainingText } from './render-status.js';
import { thumbnailStudioPage } from './thumbstudio/page.js';
import { NOTE_STATUS_LABEL, NOTE_KIND_LABEL, PROJECT_STATUS_LABEL, THUMB_STATUS_LABEL } from './values.js';
import { W, SPEED_PRESETS, tail } from './platform.js';

// ---------- tiny helpers
export const $ = (s, el = document) => el.querySelector(s);
export function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k === 'html') el.innerHTML = v;
    else if (k === 'value' && tag === 'textarea') el.value = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat(Infinity)) if (c != null && c !== false) el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  return el;
}
export async function api(path, opts = {}) {
  const r = await fetch(path, { ...opts, headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) }, body: opts.body && typeof opts.body !== 'string' ? JSON.stringify(opts.body) : opts.body });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || r.statusText);
  return j;
}
export const GB = b => !b ? '0' : b >= 1073741824 ? (b / 1073741824).toFixed(b >= 10737418240 ? 0 : 1) + ' GB' : b >= 1048576 ? Math.round(b / 1048576) + ' MB' : Math.max(1, Math.round(b / 1024)) + ' KB';
export const DUR = s => { if (!s && s !== 0) return '—'; s = Math.round(s); const m = Math.floor(s / 60); return m >= 60 ? `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}` : `${m}:${String(s % 60).padStart(2, '0')}`; };
export const TC = s => { const m = Math.floor(s / 60), r = s - m * 60; return `${m}:${r.toFixed(2).padStart(5, '0')}`; };
export function AGO(ms) {
  if (!ms) return '—'; const d = (Date.now() - (typeof ms === 'number' ? ms : Date.parse(ms))) / 1000;
  if (d < 60) return 'just now'; if (d < 3600) return Math.floor(d / 60) + ' min ago'; if (d < 86400) return Math.floor(d / 3600) + ' h ago';
  if (d < 86400 * 30) return Math.floor(d / 86400) + ' days ago';
  return new Date(typeof ms === 'number' ? ms : Date.parse(ms)).toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' });
}
export function toast(msg, err) { const el = h('div', { class: err ? 'err' : '' }, msg); $('#toast').append(el); setTimeout(() => el.remove(), err ? 7000 : 4000); }
export function confirmBox(title, body, okText = 'OK') {
  return new Promise(res => {
    const bg = h('div', { class: 'modal-bg' }, h('div', { class: 'modal' }, h('h1', {}, title), body,
      h('div', { class: 'row' }, h('span', { class: 'spacer' }), h('button', { onclick: () => { bg.remove(); res(false); } }, 'Cancel'), h('button', { class: 'primary', onclick: () => { bg.remove(); res(true); } }, okText))));
    (document.fullscreenElement || document.body).append(bg);   // in fullscreen only the fullscreen element shows
  });
}
const STATUSES = ['in-progress', 'review', 'revision', 'approved', 'published', 'archived'];
const FAMILY = { A: 'chunked', B: 'worker chunks', C: 'segmented', otomasyon: 'automation', snipp: 'Snipp', media: 'video folder', code: 'code', other: 'other' };
const ROLE = { final: 'final with audio', web: 'web copy', preview: 'preview', clip: 'test clip', silent: 'silent', broken: 'broken' };
export const pill = (cls, text) => h('span', { class: 'pill ' + String(cls).replace(/\s/g, '-') }, text);

// ---------- live data (SSE)
let rendersCache = null; const renderSubs = new Set();
const es = new EventSource('/api/events');
// VideoHub closes itself when unused; if this window outlived it, say how to bring it back (EventSource keeps retrying)
let downTimer = null;
const downBar = h('div', { class: 'downbar', hidden: true }, 'The VideoHub server is off (it shut down because it was idle). Click the VideoHub shortcut on your desktop; this window will reconnect automatically.');
document.body.append(downBar);
es.addEventListener('error', () => { if (!downTimer) downTimer = setTimeout(() => { downBar.hidden = false; }, 4000); });
es.addEventListener('open', () => { clearTimeout(downTimer); downTimer = null; if (!downBar.hidden) location.reload(); });
// no pop-up messages for things the user did not just do: lists and badges update silently
let userScan = false, uiVersion = null, reloadPending = false;
export const markUserScan = () => { userScan = true; };
const busyWriting = () => !!document.querySelector('.composer, .rv2-composer, .rv2-drafts:not([hidden]), .nc textarea, .textin:not([hidden])');
function reloadWhenIdle() {
  if (busyWriting()) { reloadPending = true; return; }   // never lose a note being written
  location.reload();
}
setInterval(() => { if (reloadPending && !busyWriting()) location.reload(); }, 3000);
es.addEventListener('hello', e => { const v = JSON.parse(e.data).v; if (uiVersion && v && v !== uiVersion) reloadWhenIdle(); uiVersion = v; });
es.addEventListener('version', e => { const v = JSON.parse(e.data).v; if (v !== uiVersion) reloadWhenIdle(); });
es.addEventListener('renders', e => { rendersCache = JSON.parse(e.data); updateLive(); for (const f of renderSubs) f(rendersCache); });
es.addEventListener('scan', e => {
  const ev = JSON.parse(e.data);
  if (ev.phase === 'done') { if (userScan) toast(`Scan complete: ${ev.count} projects`); userScan = false; refreshProjectList(); }
  if (ev.phase === 'error' && userScan) { toast('Scan error: ' + ev.error, true); userScan = false; }
});
es.addEventListener('job', e => {
  // a render ended: a notice that stays a while, with the way to the video; the "new" counts follow
  let ev = null; try { ev = JSON.parse(e.data); } catch { }
  const j = ev?.job;
  if (j && rendersCache) {
    const jobs = [...(rendersCache.jobs || [])], at = jobs.findIndex(x => x.id === j.id);
    if (at >= 0) jobs[at] = j; else jobs.unshift(j);
    rendersCache = { ...rendersCache, jobs }; updateLive();
  }
  for (const f of renderSubs) f(rendersCache);
  if (ev?.type === 'done' && j) longToast(h('div', { class: 'render-finished' },
    h('b', {}, 'Render finished: ' + j.projectName + (j.version ? ' v' + j.version : '')),
    j.outputPath ? outputActions({ file: j.outputPath, exists: true, projectId: j.project, rel: j.output }) : null,
    h('a', { href: '#/outputs' }, 'View recent renders →')));
  if (ev?.type === 'failed' && j) longToast(h('span', {}, `❌ Render failed: ${j.projectName} — ${j.error || ''} `, h('a', { href: '#/renders' }, 'Details')), true);
  if (ev && ['done', 'failed', 'cancelled'].includes(ev.type)) refreshNewCount();
});
function longToast(node, err) { const el = h('div', { class: err ? 'err' : '' }, node); $('#toast').append(el); setTimeout(() => el.remove(), 15000); }
// "new" (not yet watched) render outputs on the Projects and Renders tabs
function refreshNewCount(n) {
  const set = k => { for (const id of ['#newOutP', '#newOutR', '#newOutO']) { const c = $(id); if (c) { c.hidden = !k; c.textContent = k ? k + ' new' : ''; } } };
  if (n != null) return set(n);
  api('/api/outputs?limit=1').then(r => set(r.unseen)).catch(() => { });
}
window.__vhNewCount = refreshNewCount;
refreshNewCount(); setInterval(() => refreshNewCount(), 60000);
// Claude asked to show a page (hub_live): go there, unless a note is being written
es.addEventListener('navigate', e => {
  let d = null; try { d = JSON.parse(e.data); } catch { } if (!d?.hash || location.hash === d.hash) return;
  if (busyWriting()) { toast(h('span', {}, 'Claude wants to open a page. After saving your note: ', h('a', { href: d.hash }, 'open'))); return; }
  location.hash = d.hash; try { window.focus(); } catch { }
});
// new projects from other chats: rescan when the window comes back to the front (the hub skips it if it scanned < 1 min ago)
const softScan = () => { if (document.visibilityState === 'visible') fetch('/api/scan?soft=1', { method: 'POST' }).catch(() => { }); };
window.addEventListener('focus', softScan); document.addEventListener('visibilitychange', softScan);
// redraw the project list after a scan, unless the user is typing in it; keep the scroll position
async function refreshProjectList() {
  const name = location.hash.replace(/^#\/?/, '').split('/')[0] || 'projects';
  if (name !== 'projects' || document.activeElement?.matches('input, textarea, select')) return;
  const main = $('#main'), y = main.scrollTop; await render(); main.scrollTop = y;
}
// pages subscribe to other server events (e.g. 'proxy') through this
const hubSubs = {};
export function onHubEvent(type, fn) {
  if (!hubSubs[type]) { hubSubs[type] = new Set(); es.addEventListener(type, e => { let d = null; try { d = JSON.parse(e.data); } catch { } for (const f of hubSubs[type]) f(d); }); }
  hubSubs[type].add(fn); return () => hubSubs[type].delete(fn);
}
function updateLive() {
  const g = rendersCache?.guard, n = activeRenders(rendersCache).filter(r => r.state !== 'queued').length;
  const c = $('#renderCount'); c.hidden = !n; c.textContent = n;
  $('#live').innerHTML = '';
  $('#live').append(
    g?.running ? h('div', {}, `RAM ${(g.ramAvailMB / 1024).toFixed(1)} GB free · CPU ${Math.round(g.cpu || 0)}%`) : h('div', { class: 'dim' }, 'Render protection is off'),
    g?.running && g.renders?.some(r => r.paused) ? h('div', { class: 'red' }, '⏸ a render is paused') : '',
  );
}

// ---------- router
const pages = { outputs: outputsPage, projects: projectsPage, p: projectPage, review: reviewPage, renders: rendersPage, disk: diskPage, settings: settingsPage, thumbstudio: thumbnailStudioPage };
let cleanup = null;
async function render() {
  const [name = 'projects', ...args] = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  document.querySelectorAll('[data-nav]').forEach(a => a.classList.toggle('on', a.dataset.nav === (name === 'p' || name === 'review' ? 'projects' : name)));
  if (cleanup) { try { cleanup(); } catch { } cleanup = null; }
  const main = $('#main'); main.innerHTML = '';
  const page = h('div', { class: 'page' }); main.append(page);
  try { cleanup = await (pages[name] || projectsPage)(page, ...args.map(decodeURIComponent)) || null; }
  catch (e) { page.append(h('div', { class: 'empty' }, 'Error: ' + e.message)); }
}
window.addEventListener('hashchange', render);
render();

// ---------- first run: no projects yet → where films go, the example film, adding a folder
async function welcomePanel() {
  const c = await api('/api/config').catch(() => ({ roots: [] }));
  const on = (c.roots || []).filter(r => r.enabled !== false), ex = c.example || {};
  const box = h('div', { class: 'panel', style: { marginTop: '14px', maxWidth: '860px' } },
    h('h2', { style: { marginTop: 0 } }, 'Welcome to VideoHub'),
    h('p', {}, 'VideoHub lists the film projects in the folders it watches. Ask Claude Code for a video: it builds the film as code in one of these folders, opens it here in the live preview (no render), and you leave notes on the frames and press "Send to Claude".'),
    h('div', { class: 'sub' }, on.length ? 'Watched now:' : 'No folder is watched yet.'),
    on.length ? h('ul', { style: { margin: '4px 0 10px' } }, on.map(r => h('li', { class: 'mono', style: { fontSize: '12.5px' } }, r.path))) : null,
    h('div', { class: 'row', style: { gap: '8px', flexWrap: 'wrap' } },
      ex.available && !ex.installed ? h('button', { class: 'primary', onclick: async (e) => {
        e.target.disabled = true; e.target.textContent = 'Adding…';
        try { const r = await api('/api/example/install', { method: 'POST' }); toast('Example film added: ' + r.path); render(); } catch (err) { toast('Could not add the example: ' + err.message, true); e.target.disabled = false; }
      } }, '▶ Add the example film') : null,
      ex.installed ? h('span', { class: 'dim' }, 'The example film is in ' + ex.target + ' (scanning…)') : null,
      h('button', { onclick: () => location.hash = '#/settings' }, '📂 Add a folder…')),
    c.workspace ? h('div', { class: 'sub', style: { marginTop: '10px' } }, 'Your workspace (films, outputs, sounds, thumbnails, archive): ', h('span', { class: 'mono' }, c.workspace)) : null,
    h('div', { class: 'row', style: { gap: '8px', marginTop: '8px', alignItems: 'center' } }, h('span', { class: 'sub' }, 'Render speed:'), renderSpeedControl(c)),
    h('p', { class: 'dim', style: { fontSize: '12.5px', marginBottom: 0 } }, 'The example (examples\\hello-film) is a 10-second film that shows the whole loop: live preview, notes, a chunked render with sound, partial re-renders. What a film folder needs is described in docs\\PROJECT-CONTRACT.md.'));
  return box;
}

// the encoder renders use (config render.encoder → VIDEOHUB_ENCODER for render scripts): a select that saves at once,
// with what this PC can use (GET /api/encoders probes once, then it is cached)
function renderSpeedControl(c) {
  const cur = c.render?.encoder || 'auto';
  const sel = h('select', { disabled: true, title: 'Which encoder turns the frames into the MP4' }, h('option', { value: cur }, cur));
  const note = h('span', { class: 'dim', style: { fontSize: '12.5px' } }, 'checking this PC…');
  api('/api/encoders').then(e => {
    const has = new Set(e.available || []), L = e.labels || {};
    sel.replaceChildren(...['auto', 'nvenc', 'amf', 'qsv', 'x264'].map(v => h('option', { value: v, selected: v === cur, disabled: v !== 'auto' && v !== cur && !has.has(v) },
      (L[v] || v) + (v !== 'auto' && v !== 'x264' && !has.has(v) ? ' (not on this PC)' : ''))));
    sel.disabled = false;
    note.textContent = e.best && e.best !== 'x264' ? `This ${W.pc} can encode on its ${W.gpu} (${e.best}${e.gpus?.length ? ', ' + e.gpus[0] : ''}): same quality, usually faster.` : W.noGpu;
  }).catch(() => { sel.disabled = false; note.textContent = ''; });
  sel.onchange = async () => { try { await api('/api/config', { method: 'POST', body: { render: { encoder: sel.value } } }); toast('Render speed saved: ' + sel.selectedOptions[0].textContent); } catch (err) { toast('Could not save: ' + err.message, true); } };
  return h('span', { class: 'row', style: { gap: '8px', alignItems: 'center', flexWrap: 'wrap' } }, sel, note);
}

// ---------- Projects
const state ={ q: '', status: '', family: '', root: '', sort: 'updated' };
async function projectsPage(page) {
  const recent = outputsPanel({ compact: true });
  page.append(h('div', { class: 'row' }, h('h1', {}, 'Projects'), h('span', { class: 'spacer' }),
    h('button', { onclick: async () => { markUserScan(); await api('/api/scan', { method: 'POST' }); toast('Scan started…'); } }, 'Rescan')), recent.el);
  const data = await api('/api/projects');
  const ps = data.projects;
  const total = ps.reduce((s, p) => s + (p.sizes?.total || 0), 0);
  const open = ps.reduce((s, p) => s + (p.notesOpen || 0), 0);
  const tiles = h('div', { class: 'tiles' },
    tile('Projects', ps.length),
    tile('Total size', GB(total)),
    tile('Render leftovers', h('span', { id: 'cleanTile', title: 'Space recoverable with safe cleanup (Disk page)' }, '…'), () => location.hash = '#/disk'),
    tile('Open notes', open),
  );
  page.append(h('div', { class: 'sub' }, data.at ? `Last scan ${AGO(data.at)}` : 'Scanning…'), tiles);
  if (!ps.length && !data.scanning) page.append(await welcomePanel());
  api('/api/disk').then(d => { const s = d.candidates.filter(c => c.preset === 'safe').reduce((a, c) => a + c.size, 0); const el = $('#cleanTile'); if (el) el.textContent = GB(s); }).catch(() => { });

  const roots = [...new Set(ps.map(p => p.root))];
  const sel = (key, opts) => h('select', { onchange: e => { state[key] = e.target.value; draw(); } }, opts.map(([v, t]) => h('option', { value: v, selected: state[key] === v }, t)));
  page.append(h('div', { class: 'filters' },
    h('input', { type: 'search', placeholder: 'Search…', value: state.q, oninput: e => { state.q = e.target.value; draw(); } }),
    sel('status', [['', 'All statuses'], ...STATUSES.concat('done').map(s => [s, PROJECT_STATUS_LABEL[s] || s])]),
    sel('family', [['', 'All types'], ...Object.entries(FAMILY)]),
    sel('root', [['', 'All folders'], ...roots.map(r => [r, tail(r, 2)])]),
    sel('sort', [['updated', 'Recently updated'], ['size', 'Largest'], ['bloat', 'Most bloated'], ['notes', 'With open notes'], ['name', 'By name']]),
  ));
  const grid = h('div', { class: 'grid' }); page.append(grid);
  function draw() {
    thumbObserver.disconnect();
    const q = state.q.toLocaleLowerCase('en-US');
    let list = ps.filter(p => (!q || (p.title + ' ' + p.label).toLocaleLowerCase('en-US').includes(q)) && (!state.status || p.status === state.status) && (!state.family || p.family === state.family) && (!state.root || p.root === state.root));
    const bloat = p => p.finalSize ? p.sizes.total / p.finalSize : 0;
    list.sort({ updated: (a, b) => b.updated - a.updated, size: (a, b) => b.sizes.total - a.sizes.total, bloat: (a, b) => bloat(b) - bloat(a), notes: (a, b) => b.notesOpen - a.notesOpen, name: (a, b) => a.title.localeCompare(b.title, 'en-US') }[state.sort]);
    grid.innerHTML = '';
    if (!list.length) grid.append(h('div', { class: 'empty' }, 'No matching projects.'));
    for (const p of list.slice(0, 300)) grid.append(projectCard(p));
  }
  draw();
  return () => { thumbObserver.disconnect(); recent.dispose(); };
}
// load a card's picture only when it scrolls into view
const thumbObserver = new IntersectionObserver(entries => {
  for (const e of entries) {
    if (!e.isIntersecting) continue;
    const el = e.target; thumbObserver.unobserve(el);
    if (!el.isConnected) continue;
    const img = new Image();
    img.onload = () => { if (el.isConnected) { el.style.backgroundImage = `url(${img.src})`; el.querySelector('.noimg')?.remove(); } };
    img.onerror = () => { if (el.isConnected && !el.querySelector('.noimg')) el.append(h('div', { class: 'noimg' }, el.dataset.live ? 'Open live preview' : 'Cover is not ready yet')); };
    // Cached live cover, or a frame from the last video. Loading a card never starts the film engine.
    img.src = `/api/thumb/${el.dataset.thumb}?${el.dataset.live ? 'source=live&' : ''}v=${encodeURIComponent(el.dataset.version || '')}`;
  }
}, { rootMargin: '200px' });
function tile(k, v, onclick) { return h('div', { class: 'tile' + (onclick ? ' click' : ''), onclick }, h('div', { class: 'k' }, k), h('div', { class: 'v' }, v)); }
function projectCard(p) {
  const out = p.sizes?.output || 0, junk = (p.sizes?.total || 0) - out;
  const ratio = p.finalSize ? p.sizes.total / p.finalSize : 0;
  // the picture plays the film; the rest of the card opens the project page
  const thumb = h('div', { class: 'thumb' + (p.outputsCount ? ' playable' : ''), title: p.live ? 'Live preview from the latest code' : p.outputsCount ? 'Play the latest render' : null,
    onclick: e => { e.stopPropagation(); openProject(p); } },
    p.latestDur ? h('span', { class: 'dur' }, DUR(p.latestDur)) : null, p.outputsCount ? h('span', { class: 'play' }, '▶') : null,
    p.live ? h('span', { class: 'livebadge', title: 'Live preview available: plays from code, no render needed' }, '● live') : null);
  if (!p.outputsCount) thumb.append(h('div', { class: 'noimg' }, p.emptyNote || 'no video yet'));
  if (p.outputsCount || p.live) { thumb.dataset.thumb = p.id; thumb.dataset.version = p.thumbVersion || p.updated || ''; if (p.live) thumb.dataset.live = '1'; thumbObserver.observe(thumb); }
  return h('div', { class: 'card', onclick: () => openProject(p) }, thumb,
    h('div', { class: 'body' },
      h('div', { class: 't', title: p.label }, p.title),
      h('div', { class: 'meta' }, pill(p.status, (PROJECT_STATUS_LABEL[p.status] || p.status) + (p.statusAuto && p.status !== 'in-progress' ? '*' : '')), pill('fam', FAMILY[p.family] || p.family), p.notesOpen ? pill('open', p.notesOpen + (p.notesOpen === 1 ? ' note' : ' notes')) : null),
      h('div', { class: 'meta' }, h('span', {}, GB(p.sizes?.total)), p.finalSize ? h('span', { class: ratio > 3 ? 'red' : 'muted' }, `final ${GB(p.finalSize)}${ratio > 1.5 ? ` · ${ratio.toFixed(1)}×` : ''}`) : null, h('span', { class: 'spacer' }), h('span', { class: 'dim' }, AGO(p.updated)),
        ),
      h('div', { class: 'cardfoot' },
        h('span', { class: 'dim' }, p.notesTotal ? `${p.notesTotal} notes` : ''),
        p.live ? h('button', { class: 'ghost cardlink', onclick: e => { e.stopPropagation(); openProject(p); } }, 'Live code') : null,
        p.latest ? h('button', { class: 'ghost cardlink', title: 'Latest saved MP4; may differ from the live code', onclick: e => { e.stopPropagation(); location.hash = `#/review/${p.id}/${encodeURIComponent(p.latest)}`; } }, 'Latest MP4') : null,
        h('span', { class: 'spacer' }),
        h('button', { class: 'cardbtn', title: `Open folder (${W.files})`, onclick: e => { e.stopPropagation(); openFolder(p.id); } }, '📂'),
        h('button', { class: 'cardbtn', title: `Remove project… (from the list or to the ${W.bin})`, onclick: e => { e.stopPropagation(); removeProject(p, () => render()); } }, '🗑')),
      h('div', { class: 'bloat', title: 'green: videos, orange: intermediate files' }, h('i', { style: { width: (100 * out / Math.max(1, p.sizes?.total)) + '%', background: 'var(--green)' } }), h('i', { style: { width: (100 * junk / Math.max(1, p.sizes?.total)) + '%', background: 'var(--accent)' } })),
    ));
}

// a project opens where the work happens: its live preview, else its newest video, else the project page
async function openProject(p) {
  const li = await api(`/api/project/${p.id}/live?probe=1`).catch(() => null);
  if (li?.ok) location.hash = `#/review/${p.id}/~live`;
  else if (p.outputsCount && p.latest) location.hash = `#/review/${p.id}/${encodeURIComponent(p.latest)}`;
  else location.hash = '#/p/' + p.id;
}
// "Remove": hide it from the list (no file touched, restore from Settings) or send its folder to the Recycle Bin
export async function removeProject(p, after) {
  let mode = 'hide';
  const opt = (m, label, sub) => h('label', { class: 'row', style: { gap: '8px', alignItems: 'flex-start', margin: '8px 0' } },
    h('input', { type: 'radio', name: 'rmp', checked: mode === m, onchange: () => { mode = m; } }), h('div', {}, h('b', {}, label), h('div', { class: 'dim', style: { fontSize: '12.5px' } }, sub)));
  const where = p.group ? `${p.path} · ${(p.groupFiles || []).length} files` : p.path + (p.studio && p.outDir ? `  +  ${p.outDir}` : '');
  const ok = await confirmBox(`Remove "${p.title || p.name}"?`, h('div', {},
    h('div', { class: 'mono', style: { fontSize: '12.5px', wordBreak: 'break-all', margin: '4px 0 8px' } }, where),
    h('div', { class: 'muted' }, `Size: ${GB(p.sizes?.total || 0)}`),
    opt('hide', 'Remove from list', 'VideoHub will hide this project without changing any files. Restore it from Settings → Hidden projects.'),
    opt('delete', `Delete folder (${W.bin})`, p.group ? `This film’s files go to the ${W.bin}, where you can restore them.` : `The entire project folder goes to the ${W.bin}, where you can restore it. Unavailable while rendering.`)), 'Apply');
  if (!ok) return false;
  try {
    if (mode === 'hide') { await api(`/api/project/${p.id}/hide`, { method: 'POST' }); toast('Removed from list (Settings → Hidden projects)'); }
    else {
      toast(`Sending to ${W.bin}…`);
      const r = await api(`/api/project/${p.id}/delete-folder`, { method: 'POST' });
      if (r.ok) toast(`Sent to ${W.bin} · ${GB(p.sizes?.total || 0)} freed`); else toast('Could not delete: ' + (r.error || ''), true);
    }
  } catch (e) { toast(e.message, true); return false; }
  after && after(); return true;
}

// ---------- Project
// the project folder (or a video's folder with the video selected) in Explorer
export const openFolder = (id, file) => api(`/api/project/${id}/open-folder`, { method: 'POST', body: file ? { file } : {} }).catch(e => toast(e.message, true));
// "🖼 Thumbnail" on a project: its newest thumbnail, or a new one for it
async function openProjectThumbnail(p) {
  try {
    const list = await api('/api/thumbstudio/list?project=' + encodeURIComponent(p.id));
    if (list.length) { location.hash = `#/thumbstudio/${list[0].pid}/${list[0].id}`; return; }
    const t = await api('/api/thumbstudio/new', { method: 'POST', body: { project: p.id, title: p.title || p.name, format: '16:9' } });
    location.hash = `#/thumbstudio/${t.pid}/${t.tid}`;
  } catch (e) { toast('Could not open thumbnail: ' + e.message, true); }
}

async function projectPage(page, id) {
  const p = await api('/api/project/' + id);
  const latest = p.outputs.find(o => o.rel === p.latest);
  // live preview: watch the film from its code, no render (shown only when the film page supports it)
  const liveBtn = h('button', { hidden: true, title: 'The film plays from its code and refreshes automatically when Claude updates it', onclick: () => location.hash = `#/review/${id}/~live` }, "▶ Live preview (no render)");
  api(`/api/project/${id}/live?probe=1`).then(li => { if (li?.ok) { liveBtn.hidden = false; liveBtn.classList.add('primary'); /* always prominent: the code is usually newer than the last render */ } }).catch(() => { });
  const statusSel = h('select', { onchange: async e => { await api(`/api/project/${id}/meta`, { method: 'POST', body: { status: e.target.value } }); toast('Status saved'); } },
    (STATUSES.includes(p.status) ? STATUSES : [p.status, ...STATUSES]).map(s => h('option', { value: s, selected: s === p.status }, PROJECT_STATUS_LABEL[s] || s)));
  page.append(
    h('div', { class: 'sub' }, h('a', { href: '#/' }, 'Projects'), ' / ', p.label),
    h('div', { class: 'row', style: { marginTop: '6px' } }, h('h1', {}, p.title), pill('fam', FAMILY[p.family] || p.family), h('span', { class: 'spacer' }),
      latest ? h('button', { class: 'primary', onclick: () => location.hash = `#/review/${id}/${encodeURIComponent(latest.rel)}` }, 'Review') : null,
      liveBtn,
      h('button', { title: 'Thumbnails for this project (Thumbnail Studio)', onclick: () => openProjectThumbnail(p) }, '🖼 Thumbnail'),
      h('button', { title: p.path, onclick: () => openFolder(id) }, '📂 Open folder'),
      h('button', { onclick: async () => { await api(`/api/project/${id}/rescan`, { method: 'POST' }); render(); } }, 'Rescan'),
      h('button', { class: 'ghost', title: `Remove from the list or send the folder to the ${W.bin}`, onclick: () => removeProject(p, () => { location.hash = '#/'; }) }, '🗑 Remove…'),
      h('span', { class: 'muted' }, 'Status'), statusSel),
  );
  // this project's thumbnails (Thumbnail Studio), filled in when the list arrives
  const thumbsBox = h('div', { class: 'ts-project-thumbs', hidden: true });
  page.append(thumbsBox);
  api('/api/thumbstudio/list?project=' + encodeURIComponent(id)).then(list => {
    if (!list?.length) return;
    thumbsBox.hidden = false;
    thumbsBox.append(h('h2', {}, `Thumbnails (${list.length})`), h('div', { class: 'row', style: { gap: '10px', flexWrap: 'wrap' } },
      list.map(t => h('a', { href: `#/thumbstudio/${t.pid}/${t.id}`, class: 'ts-project-thumb', title: t.title },
        t.cover ? h('img', { src: `/api/thumbstudio/${t.pid}/${t.id}/file?f=${encodeURIComponent(t.cover)}&v=${encodeURIComponent(t.updated || '')}`, loading: 'lazy' }) : h('div', { class: 'dim' }, 'draft'),
        h('div', {}, h('b', {}, t.title), ' ', h('span', { class: 'dim' }, THUMB_STATUS_LABEL[t.status] || t.status))))));
  }).catch(() => { });
  // videos
  page.append(h('h2', {}, `Videos (${p.outputs.length})`));
  if (!p.outputs.length) page.append(h('div', { class: 'empty' }, 'No videos in this project yet.'));
  else page.append(h('div', { class: 'panel', style: { padding: '4px 6px' } }, h('table', { class: 't' },
    h('tr', {}, h('th', {}, 'File'), h('th', {}, 'Type'), h('th', { class: 'num' }, 'Duration'), h('th', { class: 'num' }, 'Resolution'), h('th', { class: 'num' }, 'Size'), h('th', { class: 'num' }, 'Date'), h('th', {})),
    p.outputs.map(o => h('tr', {},
      h('td', {}, h('span', { class: 'ellip', title: o.path }, o.rel), o.dupOf ? h('div', { class: 'dim', style: { fontSize: '12px' } }, 'copy of: ' + tail(o.dupOf, 2)) : null, o.role === 'silent' && o.coveredBy ? h('div', { class: 'dim', style: { fontSize: '12px' } }, 'video included in: ' + o.coveredBy) : null),
      h('td', {}, pill(o.role, ROLE[o.role] || o.role)),
      h('td', { class: 'num' }, DUR(o.dur)), h('td', { class: 'num muted' }, o.w ? `${o.w}×${o.h} ${Math.round(o.fps)}fps` : '—'),
      h('td', { class: 'num' }, GB(o.size)), h('td', { class: 'num muted' }, AGO(o.mtime)),
      h('td', { class: 'num' }, h('button', { class: 'ghost', onclick: () => location.hash = `#/review/${id}/${encodeURIComponent(o.rel)}` }, 'Watch / add notes'),
        h('button', { class: 'ghost', title: 'Show in folder (file selected)', onclick: () => openFolder(id, o.rel) }, 'Show')))),
  )));
  // disk
  const S = p.sizes || {}, parts = [['output', 'Videos', 'var(--green)'], ['chunk', 'Render chunks', 'var(--accent)'], ['oldChunk', 'Old chunks', 'var(--red)'], ['part', 'Part/segment', 'var(--yellow)'], ['profile', 'Chrome profiles', 'var(--red)'], ['snap', 'Check frames', 'var(--blue)'], ['audio', 'Audio', 'var(--violet)'], ['other', 'Code and other files', 'var(--dim)']];
  page.append(h('h2', {}, `Disk · ${GB(S.total)}`), h('div', { class: 'panel' },
    h('div', { class: 'stack' }, parts.map(([k, , c]) => S[k] ? h('i', { style: { width: (100 * S[k] / S.total) + '%', background: c }, title: GB(S[k]) }) : null)),
    h('div', { class: 'legend' }, parts.filter(([k]) => S[k]).map(([k, t, c]) => h('span', {}, h('b', { style: { background: c } }), `${t} ${GB(S[k])}`))),
  ));
  if (p.cleanup.length || p.busy || (p.sizes?.chunk || 0) > 0) page.append(tidyBlock(p, () => render()));
  else if (p.cleanupPending) page.append(h('div', { class: 'sub', style: { marginTop: '10px' } }, 'Preparing cleanup list… (refresh in a moment)'));
  // notes + render info + history
  const notes = p.notes || [];
  page.append(h('div', { class: 'split' },
    h('div', {},
      h('h2', {}, `Notes (${notes.length})`),
      notes.length ? h('div', { class: 'panel', style: { padding: '4px 6px' } }, h('table', { class: 't' }, notes.slice().reverse().map(n => h('tr', { style: { cursor: 'pointer' }, onclick: () => location.hash = `#/review/${id}/${encodeURIComponent(n.file || p.latest)}?n=${n.id}` },
        h('td', { class: 'mono' }, '#' + n.id), h('td', { class: 'mono' }, TC(n.t)), h('td', {}, pill(n.status, NOTE_STATUS_LABEL[n.status] || n.status)), h('td', { class: 'muted' }, NOTE_KIND_LABEL[n.kind] || n.kind), h('td', {}, n.text), h('td', { class: 'num dim' }, AGO(n.createdAt))))))
        : h('div', { class: 'empty' }, 'No notes yet. Open the video with "Review" to leave a note on a frame.'),
      h('h2', {}, 'Render history'),
      p.history.length ? h('div', { class: 'panel', style: { padding: '4px 6px' } }, h('table', { class: 't' }, p.history.slice(0, 25).map(x => h('tr', {}, h('td', { class: 'num muted' }, x.at.replace('T', ' ').slice(0, 16)), h('td', {}, x.event), h('td', {}, x.session), h('td', { class: 'muted' }, x.detail)))))
        : h('div', { class: 'empty' }, 'No render history for this project.'),
    ),
    h('div', {}, h('h2', {}, 'Render info'), h('div', { class: 'panel kv' },
      h('div', { class: 'k' }, 'Folder'), h('div', { class: 'mono', style: { wordBreak: 'break-all' } }, p.path),
      h('div', { class: 'k' }, 'Type'), h('div', {}, FAMILY[p.family] || p.family),
      h('div', { class: 'k' }, 'Script'), h('div', {}, p.render?.script || '—'),
      h('div', { class: 'k' }, 'FPS / chunk'), h('div', {}, p.render?.fps ? `${p.render.fps} fps` : '—', p.render?.chunkSec ? ` · ${p.render.chunkSec} s chunks` : ''),
      h('div', { class: 'k' }, 'Partial render'), h('div', {}, p.render?.supportsOnly ? h('span', { class: 'green' }, 'supported (ONLY=)') : h('span', { class: 'muted' }, 'unavailable')),
      h('div', { class: 'k' }, 'File count'), h('div', {}, p.counts?.files ?? '—', p.counts?.chunks ? ` · ${p.counts.chunks} chunks` : ''),
    )),
  ));
}

// "Tidy up this project": what the films take vs what can go; the safe items and the deep ones the rules
// pre-select (chunks of a film marked finished by the user, old QA) are ticked
function tidyBlock(p, after) {
  const cands = p.cleanup, film = p.outputs.filter(o => o.role === 'final' || o.role === 'web').reduce((t, o) => t + (o.size || 0), 0);
  const left = cands.filter(c => c.preset).reduce((t, c) => t + c.size, 0);
  const inReview = !['approved', 'published', 'archived', 'done'].includes(p.status);
  return h('div', {},
    h('h2', {}, 'Tidy up this project'),
    h('div', { class: 'sub', style: { marginBottom: '8px' } }, `Videos ${GB(film)} · leftovers ${GB(left)}`,
      inReview && p.render?.chunkSec ? h('span', { class: 'dim' }, ' · film in review: render\\chunks are kept for partial renders (mark it "approved" to include them in cleanup)') : null),
    !p.busy && (p.sizes?.chunk || 0) > 0 && (inReview || p.statusAuto) ? h('div', { class: 'panel release-chunks' },
      h('b', {}, GB(p.sizes.chunk) + ' of render chunks kept for revision.'),
      h('p', { class: 'sub' }, 'Once review is finished, you can release the chunks for cleanup. Code, audio and final videos stay; later changes will need a full render.'),
      h('button', { disabled: p.notesOpen > 0, title: p.notesOpen > 0 ? 'Resolve the open revision notes first.' : '', onclick: async () => {
        if (await confirmBox('Is the review finished?', h('p', {}, `The project will be marked approved. You can then select the render chunks and send them to the ${W.bin}; this step does not delete files.`), 'Finish review')) {
          await api('/api/project/' + p.id + '/meta', { method: 'POST', body: { status: 'approved' } }); render();
        }
      } }, 'Review finished · release chunks for cleanup')) : null,
    p.busy ? h('div', { class: 'sub' }, `⏳ Render leftovers for this project are not listed right now: ${p.busy}.`) : null,
    cleanupBlock(cands, after, c => c.preset === 'safe' || (c.preset === 'deep' && c.checked), false));
}
function cleanupBlock(cands, after, pre = c => c.checked, title = true) {
  const checked = new Set(cands.filter(pre).map(c => c.id));
  const sum = () => cands.filter(c => checked.has(c.id)).reduce((s, c) => s + c.size, 0);
  const btn = h('button', { class: 'primary', 'data-clean': '1' });
  const upd = () => { btn.textContent = `Clean selected (${GB(sum())})`; btn.dataset.empty = checked.size ? '0' : '1'; lockCleanButtons(); };
  btn.onclick = () => runClean(cands.filter(c => checked.has(c.id)), after);
  upd();
  return h('div', {}, title ? h('h2', {}, `Available to clean · ${GB(cands.reduce((s, c) => s + c.size, 0))}`) : null, h('div', { class: 'rule' }, h('div', { class: 'items', style: { borderTop: 0 } },
    cands.map(c => h('label', { class: 'item' }, h('input', { type: 'checkbox', checked: checked.has(c.id), onchange: e => { e.target.checked ? checked.add(c.id) : checked.delete(c.id); upd(); } }),
      h('div', {}, h('div', { class: 'ellip', title: c.path }, tail(c.path, 3)), h('div', { class: 'why' }, (c.action === 'archive' ? 'Moves to archive · ' : W.bin + ' · ') + c.reason)),
      h('div', { class: 'num' }, GB(c.size)))))), h('div', { class: 'row', style: { marginTop: '8px' } }, btn));
}

// Cleaning runs on the hub in the background, one run at a time. A panel shows its progress (SSE 'clean') and,
// at the end, what went where and what could not go and why. Clean buttons are locked while a run is going.
let cleanState = null, cleanBox = null, cleanAfter = null;
const cleanRunning = () => cleanState && cleanState.state === 'running';
const lockCleanButtons = () => document.querySelectorAll('button[data-clean]').forEach(b => { b.disabled = cleanRunning() || b.dataset.empty === '1'; b.title = cleanRunning() ? 'Cleanup in progress' : ''; });
const STATUS_TR = { ok: 'done', error: 'failed', skipped: 'skipped', gone: 'already gone' };
// Element.append prints null as text: skip empty parts
const putClean = (...kids) => cleanBox.append(...kids.filter(k => k != null && k !== false));
function drawCleanBox() {
  const st = cleanState; if (!st || st.state === 'none') { cleanBox?.remove(); cleanBox = null; return; }
  if (!cleanBox) { cleanBox = h('div', { class: 'cleanbox' }); document.body.append(cleanBox); }
  cleanBox.innerHTML = '';
  if (st.state === 'running') {
    const pct = st.total ? Math.round(100 * st.done / st.total) : 0;
    putClean(h('b', {}, st.phase === 'list' ? 'Preparing cleanup…' : `Cleaning · ${st.done}/${st.total}`),
      h('div', { class: 'bar' }, h('i', { style: { width: pct + '%' } })),
      h('div', { class: 'muted' }, `${GB(st.freed)} freed`, st.current ? h('div', { class: 'ellip dim', title: st.current }, tail(st.current, 3)) : null),
      h('div', { class: 'dim', style: { fontSize: '12px' } }, 'You can keep using VideoHub; cleanup continues even if you close the page.'));
  } else {
    const rs = st.results || [], bad = rs.filter(r => r.status === 'error'), other = rs.filter(r => r.status === 'skipped' || r.status === 'gone');
    putClean(h('b', {}, `Cleanup finished · ${GB(st.freed)} freed`),
      h('div', { class: 'muted' }, `${st.ok} done${bad.length ? ` · ${bad.length} failed` : ''}${other.length ? ` · ${other.length} skipped / already gone` : ''}`),
      bad.length || other.length ? h('div', { class: 'cleanres' }, [...bad, ...other].map(r => h('div', { class: 'item' + (r.status === 'error' ? ' red' : '') },
        h('div', {}, h('b', {}, STATUS_TR[r.status] + ' '), r.path ? h('span', { class: 'ellip', title: r.path }, (r.project ? r.project + ' · ' : '') + tail(r.path, 3)) : null),
        h('div', { class: 'why' }, r.error || '')))) : null,
      h('div', { class: 'row' }, h('span', { class: 'spacer' }), h('button', { onclick: () => { cleanBox.remove(); cleanBox = null; } }, 'Close')));
  }
}
function onCleanState(st) {
  if (st && cleanState && st.id === cleanState.id && cleanState.state === 'done' && st.state !== 'done') return;
  const was = cleanRunning(); cleanState = st; drawCleanBox(); lockCleanButtons();
  if (was && st?.state === 'done') { const f = cleanAfter; cleanAfter = null; if (f && location.hash === f.hash && !busyWriting()) f.fn(); }
}
onHubEvent('clean', onCleanState);
api('/api/disk/clean').then(st => { if (st?.state === 'running') onCleanState(st); }).catch(() => { });

export async function runClean(items, after) {
  if (cleanRunning()) { toast('Cleanup is already running; try again when it finishes.', true); return; }
  if (!items.length) return;
  const rec = items.filter(c => c.action === 'recycle'), arc = items.filter(c => c.action === 'archive');
  const ok = await confirmBox('Cleanup', h('div', { class: 'sub', style: { fontSize: '14px' } },
    rec.length ? h('p', {}, `${rec.length} items (${GB(rec.reduce((s, c) => s + c.size, 0))}) will go to the ${W.bin}. You can restore them from there.`) : null,
    arc.length ? h('p', {}, `${arc.length} old versions (${GB(arc.reduce((s, c) => s + c.size, 0))}) will move to the archive folder and be removed here after the copy is verified.`) : null,
    h('p', { class: 'dim' }, 'Runs in the background; progress appears at the bottom right.')), 'Clean');
  if (!ok) return;
  try {
    cleanAfter = after ? { fn: after, hash: location.hash } : null;
    onCleanState(await api('/api/disk/clean', { method: 'POST', body: { ids: items.map(c => c.id) } }));
  } catch (e) { cleanAfter = null; toast('Cleanup did not start: ' + e.message, true); }
}

// ---------- Renders
async function rendersPage(page) {
  page.append(h('h1', {}, "Renders"), h('div', { class: 'sub' }, 'Running jobs, elapsed time and speed settings. Finished videos are below.'));
  const live = h('div', { class: 'current-renders' }), hist = h('div', {}), settings = h('div', { class: 'current-render-settings' });
  let timedRows = new Map();
  const tickTimers = () => {
    const now = Date.now();
    for (const cell of live.querySelectorAll('[data-render-timer]')) {
      const row = timedRows.get(cell.dataset.rowKey); if (!row) continue;
      cell.textContent = cell.dataset.renderTimer === 'elapsed' ? timeText(elapsedSeconds(row, now)) : remainingText(row, now);
    }
  };
  const clock = setInterval(tickTimers, 1000);
  const outs = outputsPanel();
  page.append(h('h2', {}, 'Current renders'), live, h('h2', {}, 'Render speed and protection'), settings);
  page.append(h('div', { class: 'row recent-heading' }, h('h2', {}, 'Recent renders'), h('span', { class: 'spacer' }), h('a', { href: '#/outputs' }, 'Open list →')), outs.el, h('h2', {}, 'History'), hist);
  api('/api/guard/settings').then(gs => settings.append(guardPanel(gs))).catch(() => settings.append(h('div', { class: 'empty' }, 'Could not load render settings.')));
  const draw = d => {
    if (!d) return;
    const g = d.guard || {}, active = activeRenders(d);
    timedRows = new Map(active.map(r => [r.key, r]));
    live.innerHTML = '';
    live.append(h('div', { class: 'tiles' },
      tile('Render protection', g.running ? h('span', { class: 'green' }, 'on') : h('span', { class: 'muted', title: g.reason }, 'off')),
      tile('Free RAM', g.running ? `${(g.ramAvailMB / 1024).toFixed(1)} GB` : '—'),
      tile('CPU limit', g.running ? (g.capNow >= 100 ? 'unlimited' : g.capNow + '%') : '—'),
      tile('Running', active.filter(r => r.state === 'running').length),
    ));
    // the emergency stop for every render (same as the Ctrl+Alt+End / Ctrl+Alt+Home hotkeys; ⌃⌥⌘P / ⌃⌥⌘R on a Mac); lived in the old tray menu
    if (g.running && (g.renders || []).length) live.append(h('div', { class: 'row', style: { gap: '8px', margin: '4px 0 8px' } },
      h('button', { title: `Pause all renders (shortcut: ${W.pauseKey})`, onclick: () => cmd('pauseAll') }, '⏸ Pause all'),
      h('button', { title: `Resume all paused renders (shortcut: ${W.resumeKey})`, onclick: () => cmd('resumeAll') }, '▶ Resume all'),
      h('span', { class: 'dim', style: { fontSize: '12px' } }, `Shortcuts: ${W.pauseKey} pauses, ${W.resumeKey} resumes (even when this window is closed).`)));
    // programs that hold RAM next to the renders (only shown; closing them is the user's call)
    const hogs = (d.hogs || []).filter(x => x.bytes >= 1024 ** 3);
    if (hogs.length) live.append(h('div', { class: 'panel hogs' },
      h('b', {}, 'Programs using RAM: '), hogs.map((x, i) => [i ? ', ' : '', h('span', { class: x.bytes >= 3 * 1024 ** 3 ? 'red' : 'accent' }, `${x.name} ${GB(x.bytes)}`)]),
      h('div', { class: 'dim' }, 'Closing these while rendering can speed up the render and keep your computer responsive. On a 16 GB computer, an Android emulator alone can use 8 GB.')));
    const rows = active.map(row => {
      const r = row.native, j = row.job;
      const label = j?.projectName || r?.project || r?.cwd || 'Render';
      const session = j?.session?.title || r?.session?.title || '';
      const started = row.startedAt ? new Date(row.startedAt) : null;
      const startText = started && Number.isFinite(started.getTime()) ? 'Started ' + started.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '';
      const timerCell = (kind, title) => h('td', { class: 'num render-time', 'data-render-timer': kind, 'data-row-key': row.key, title },
        kind === 'elapsed' ? timeText(elapsedSeconds(row)) : remainingText(row));
      return h('tr', { 'data-active-render': row.key },
        h('td', {}, h('b', {}, label), h('div', { class: 'dim' }, session), h('div', { class: 'dim render-start' }, row.state === 'queued' ? 'Waiting in queue' : startText)),
        h('td', { class: 'muted' }, r?.what || (j?.mode + (j?.chunks?.length ? ' · ' + j.chunks.length + ' chunks' : '')),
          j?.phase ? h('div', { class: 'dim' }, ({ prepare: 'Preparing', render: 'Drawing frames', validate: 'Checking chunks', concat: 'Joining video', audio: 'Adding audio', register: 'Saving output' })[j.phase] || '') : null),
        h('td', {}, row.state === 'queued' ? (j.needsApproval ? h('div', {}, h('span', { class: 'accent' }, 'Needs your approval'), h('div', { class: 'dim', title: j.cmd, style: { fontFamily: 'var(--mono)', fontSize: '11.5px', maxWidth: '420px', overflowWrap: 'anywhere' } }, j.cmd)) : h('span', { class: 'muted' }, j.waiting || 'Queued (' + (j.position || '—') + ')')) :
          row.state === 'paused' ? h('span', { class: 'red' }, '⏸ Paused') :
          h('div', { class: 'row' }, r?.slow ? h('span', { class: 'accent' }, '🐢 Slow') : null,
            row.progress != null ? [h('div', { class: 'progress' }, h('i', { style: { width: Math.max(0, Math.min(100, row.progress * 100)) + '%' } })), Math.round(row.progress * 100) + '%'] : h('span', { class: 'dim' }, 'Waiting for progress'))),
        timerCell('elapsed', 'Time since the job actually started; excludes queue time and includes pauses.'),
        timerCell('remaining', 'Estimate based on the latest progress. Render speed, pauses and joining can change the remaining time.'),
        h('td', { class: 'num' }, r ? Math.round(r.cpu || 0) + '%' : '—'),
        h('td', { class: 'num' }, r ? GB((r.ramMB || 0) * 1048576) : '—'),
        h('td', { class: 'num render-controls' },
          r ? [
            h('button', { onclick: () => cmd(r.slow ? 'normal' : 'slow', r.rootPid) }, r.slow ? 'Normal speed' : 'Slow down'),
            h('button', { onclick: () => cmd(r.paused ? 'resume' : 'pause', r.rootPid) }, r.paused ? 'Resume' : 'Pause'),
            h('button', { class: 'danger', onclick: async () => { if (await confirmBox('Stop this render?', h('p', {}, label), 'Stop')) { if (j) await api('/api/jobs/' + j.id + '/cancel', { method: 'POST' }).catch(e => toast(e.message, true)); else await cmd('kill', r.rootPid); } } }, 'Stop')
          ] : j ? [
            j.needsApproval ? h('button', { class: 'primary', title: 'Claude asked to run this command in the project folder. Run it only if you know what it does.', onclick: async () => { if (await confirmBox('Run this command?', h('div', {}, h('p', {}, 'Claude asked VideoHub to run this command in the folder of "' + label + '":'), h('pre', { style: { whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' } }, j.cmd), h('p', { class: 'dim' }, 'A command can do anything on this computer. Approve it only if it is what you expected.')), 'Run it')) await api('/api/jobs/' + j.id + '/approve', { method: 'POST' }).catch(e => toast(e.message, true)); } }, 'Approve') : null,
            h('button', { class: 'danger', onclick: () => api('/api/jobs/' + j.id + '/cancel', { method: 'POST' }).catch(e => toast(e.message, true)) }, 'Cancel')] : null));
    });
    live.append(rows.length ? h('div', { class: 'panel active-render-table' }, h('table', { class: 't' },
      h('tr', {}, h('th', {}, 'Project / session'), h('th', {}, 'Running task'), h('th', {}, 'Progress'), h('th', { class: 'num' }, 'Elapsed'), h('th', { class: 'num' }, 'Estimated remaining'), h('th', { class: 'num' }, 'CPU'), h('th', { class: 'num' }, 'RAM'), h('th', {})), rows))
      : h('div', { class: 'empty' }, 'No renders are running.'));
    const sn = (d.snipp || []).filter(s => s.state === 'running' || Date.now() - s.updated < 864e5);
    if (sn.length) live.append(h('h2', {}, 'Snipp exports'), h('div', { class: 'panel', style: { padding: '4px 6px' } }, h('table', { class: 't' }, sn.map(s => h('tr', {}, h('td', {}, s.name), h('td', {}, pill(s.state === 'done' ? 'approved' : s.state === 'running' ? 'revision' : 'done', s.state)), h('td', {}, s.progress != null ? `${Math.round(s.progress * 100)}%` : ''), h('td', { class: 'num dim' }, AGO(s.updated)))))));
  };
  const cmd = async (action, rootPid) => { const r = await api('/api/renders/cmd', { method: 'POST', body: { action, rootPid } }); if (r.note) toast(r.note, true); };
  const d = await api('/api/renders').catch(e => { clearInterval(clock); outs.dispose(); throw e; }); draw(d);
  const jobsDone = (d.jobs || []).filter(j => !['queued', 'running'].includes(j.state)).slice(0, 15);
  const hrows = [...jobsDone.map(j => ({ at: j.finishedAt || j.createdAt, event: j.state === 'done' ? 'FINISHED' : j.state.toUpperCase(), session: j.session?.title || '', project: j.projectName, detail: `VideoHub ${j.mode}${j.chunks?.length ? ' · ' + j.chunks.length + ' chunks' : ''}${j.durationSec ? ' · ' + DUR(j.durationSec) : ''}` })), ...(d.history || [])].sort((a, b) => String(b.at).localeCompare(String(a.at)));
  hist.append(hrows.length ? h('div', { class: 'panel', style: { padding: '4px 6px' } }, h('table', { class: 't' },
    h('tr', {}, h('th', {}, 'Time'), h('th', {}, 'Event'), h('th', {}, 'Session'), h('th', {}, 'Project'), h('th', {}, 'Details')),
    hrows.slice(0, 200).map(x => h('tr', {}, h('td', { class: 'num muted' }, String(x.at).replace('T', ' ').slice(0, 16)), h('td', {}, x.event), h('td', {}, x.session), h('td', { class: 'muted' }, x.project), h('td', { class: 'muted' }, x.detail))))) : h('div', { class: 'empty' }, 'No history yet.'));
  const sub = x => draw(x); renderSubs.add(sub);
  return () => { clearInterval(clock); renderSubs.delete(sub); outs.dispose(); };
}

// ---------- dedicated recent-render history
async function outputsPage(page) {
  const panel = outputsPanel();
  page.append(h('div', { class: 'row' }, h('h1', {}, 'Recent renders'), h('span', { class: 'spacer' }), h('a', { href: '#/renders' }, 'Running renders →')),
    h('p', { class: 'sub' }, 'Your finished videos, newest first. Open a video, find it in its folder or review it in VideoHub.'), panel.el);
  return panel.dispose;
}

// ---------- render settings (RenderGuard): presets, a temporary full-power window, and the sliders
const PRESETS = SPEED_PRESETS;   // ui/platform.js (a Mac's Balanced keeps every core)
function guardPanel(gs, { full = false } = {}) {
  const box = h('div', { class: 'panel gpanel' });
  const redraw = async () => { const fresh = await api('/api/guard/settings').catch(() => null); if (fresh) box.replaceWith(guardPanel(fresh, { full })); };
  let timer = null; const pending = {};
  const save = (k, v) => { pending[k] = v; clearTimeout(timer); timer = setTimeout(async () => { const body = { ...pending }; for (const x in pending) delete pending[x]; try { await api('/api/guard/settings', { method: 'POST', body }); } catch (e) { toast('Could not save: ' + e.message, true); } }, 400); };
  const slider = (key, label, min, max, step, fmt, help) => {
    const out = h('b', { style: { minWidth: '150px', display: 'inline-block' } }, fmt(gs[key]));
    const inp = h('input', { type: 'range', min, max, step, value: gs[key], style: { width: '280px' }, oninput: e => { out.textContent = fmt(+e.target.value); save(key, +e.target.value); } });
    return h('div', { class: 'row', style: { margin: '6px 0' } }, h('span', { style: { width: '260px' } }, label), inp, out, help ? h('span', { class: 'dim', style: { fontSize: '12px' } }, help) : null);
  };
  const toggle = (key, label, help) => h('label', { class: 'row', style: { margin: '6px 0', cursor: 'pointer' } },
    h('input', { type: 'checkbox', checked: !!gs[key], onchange: e => save(key, e.target.checked) }), h('span', {}, label), help ? h('span', { class: 'dim', style: { fontSize: '12px' } }, help) : null);
  const cores = navigator.hardwareConcurrency || 12;
  const pct = v => v >= 100 ? '100% · unlimited' : `${v}% · ≈${(v * cores / 100).toFixed(1)} cores`;
  const same = p => Object.entries(p).every(([k, v]) => (typeof v === 'boolean' ? !!gs[k] === v : +gs[k] === v));
  const presets = h('div', { class: 'row', style: { gap: '8px', margin: '2px 0 10px' } }, h('span', { class: 'muted', style: { width: '120px' } }, 'Speed'),
    PRESETS.map(([name, help, p]) => h('button', { class: same(p) ? 'primary' : '', title: help, onclick: async () => { await api('/api/guard/settings', { method: 'POST', body: p }); toast(`Render speed: ${name}`); redraw(); } }, name)));
  // full power for a while, then the current settings come back by themselves (also after a restart)
  const temp = gs.temp && Date.parse(gs.temp.until) > Date.now() ? gs.temp : null;
  const hhmm = iso => new Date(iso).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
  const tempRow = h('div', { class: 'row', style: { gap: '8px', margin: '0 0 10px' } }, h('span', { class: 'muted', style: { width: '120px' } }, 'Temporary'),
    temp ? [h('span', { class: 'accent' }, `Full power until ${hhmm(temp.until)}, then previous settings`), h('button', { onclick: async () => { await api('/api/guard/temp', { method: 'POST', body: { cancel: true } }); toast('Previous settings restored'); redraw(); } }, 'End now')]
      : [h('span', { class: 'dim' }, 'Full power, then automatically restore previous settings:'), [1, 2, 4, 8].map(hr => h('button', { onclick: async () => { const r = await api('/api/guard/temp', { method: 'POST', body: { hours: hr } }); toast(`Full power until ${hhmm(r.until)}`); redraw(); } }, `${hr} h`))]);
  box.append(
    h('div', { class: 'sub', style: { marginBottom: '8px' } }, gs.exe ? `Render protection is part of VideoHub and runs in the background. Emergency pause: ${W.pauseKey}, resume: ${W.resumeKey}.` : W.agentMissing),
    presets, tempRow,
    slider('CapActive', 'Render power while using the computer', 10, 100, 5, pct),
    slider('CapIdle', 'Render power while idle', 10, 100, 5, pct),
    toggle('LowPrio', ...W.lowPrio));
  const more = h('div', {},
    slider('IdleMin', 'Consider idle after', 1, 30, 1, v => `${v} min of inactivity`),
    slider('PauseMB', 'Slow down when free RAM reaches', 300, Math.max(4000, Math.round((gs.ramTotalMB || 16384) / 4 / 100) * 100), 100, v => `${(v / 1024).toFixed(1)} GB free`, 'the newest render slows down; the oldest continues'),
    slider('SlowCapPct', 'Speed in slow mode', 1, 30, 1, v => `${v}% CPU`, 'rendering continues at a lower speed'),
    slider('CriticalMB', 'Critical RAM', 200, 2000, 100, v => `${(v / 1024).toFixed(1)} GB`, 'below this, the oldest render also slows down'),
    toggle('Startup', ...W.startup));
  if (full) box.append(more);
  else { more.hidden = true; const link = h('button', { class: 'ghost', onclick: () => { more.hidden = !more.hidden; link.textContent = more.hidden ? 'RAM and other settings ▾' : 'Show less ▴'; } }, 'RAM and other settings ▾'); box.append(link, more); }
  return box;
}

// ---------- Disk
async function diskPage(page) {
  page.append(h('h1', {}, 'Disk'), h('div', { class: 'sub' }, `See what can be safely removed and why. Deleted files go to the ${W.bin}; old versions go to the archive.`));
  const wait = h('div', { class: 'empty' }, 'Measuring folders… (large projects may take 10–30 s)'); page.append(wait);
  const d = await api('/api/disk'); wait.remove();
  const T = d.totals || {}, parts = [['output', 'Videos', 'var(--green)'], ['chunk', 'Render chunks', 'var(--accent)'], ['oldChunk', 'Old chunks', 'var(--red)'], ['part', 'Part/segment', 'var(--yellow)'], ['profile', 'Chrome profiles', 'var(--red)'], ['snap', 'Check frames', 'var(--blue)'], ['audio', 'Audio', 'var(--violet)'], ['other', 'Code and other files', 'var(--dim)']];
  page.append(h('div', { class: 'panel', style: { marginTop: '14px' } }, h('div', { class: 'row' }, h('b', {}, `Watched folders: ${GB(T.total)}`), h('span', { class: 'spacer' }), h('span', { class: 'muted' }, `Archive: ${d.archiveDir}${d.archiveOk ? '' : ' (drive unavailable!)'}`)),
    h('div', { class: 'stack', style: { marginTop: '10px' } }, parts.map(([k, , c]) => T[k] ? h('i', { style: { width: (100 * T[k] / T.total) + '%', background: c }, title: GB(T[k]) }) : null)),
    h('div', { class: 'legend' }, parts.filter(([k]) => T[k]).map(([k, t, c]) => h('span', {}, h('b', { style: { background: c } }), `${t} ${GB(T[k])}`)))));
  const safeBytes = d.candidates.filter(c => c.preset === 'safe').reduce((n,c) => n+c.size,0);
  const heldChunks = (d.projects || []).filter(p => p.chunksKept).reduce((n,p) => n+(p.chunks || 0),0);
  page.append(h('div', { class: 'tiles storage-tiles' },
    tile('Safe to clean', GB(safeBytes)),
    tile('Chunks kept for revision', GB(heldChunks)),
    tile('Videos', GB(T.output))),
    h('div', { class: 'panel storage-help' },
      h('b', {}, 'Two options after rendering'),
      h('p', { class: 'sub' }, 'If revisions are ongoing, clean silent copies, old chunks and temporary files; keep the current chunks. When the film is finished, complete the review on its project page, then clean the chunks too.'),
      h('span', { class: 'dim' }, 'Final videos, source code and audio are kept. Review the file list before confirming each action.')));
  // presets: "Safe" (never needed again), "Deep" (+ recent QA, old versions to the archive, chunks of finished films), "Custom"
  const inPreset = (c, k) => k === 'safe' ? c.preset === 'safe' : (c.preset === 'safe' || c.preset === 'deep');
  const presetSum = k => d.candidates.filter(c => inPreset(c, k)).reduce((s, c) => s + c.size, 0);
  const checked = new Set(d.candidates.filter(c => inPreset(c, 'safe')).map(c => c.id));
  const setPreset = k => { checked.clear(); for (const c of d.candidates) if (inPreset(c, k)) checked.add(c.id); document.querySelectorAll('.items input[data-id]').forEach(i => { i.checked = checked.has(i.dataset.id); }); presetBtns.forEach(b => b.classList.toggle('primary', b.dataset.k === k)); upd(); };
  const presetBtns = [['safe', 'Safe (recommended)', 'No longer needed: replaced chunks (chunks_v*, chunks_prev*), Chrome profiles, ' + 3 + ' days or older check frames and test clips, silent copies and old previews. Chunks needed for partial renders of films in review are kept.'],
    ['deep', 'Deep', 'Safe cleanup plus recent check frames, old versions (moved to the archive) and render chunks of finished/approved films (partial rendering will no longer be available).']]
    .map(([k, t, help]) => h('button', { 'data-k': k, title: help, class: k === 'safe' ? 'primary' : '', onclick: () => setPreset(k) }, `${t} · ${GB(presetSum(k))}`));
  const allBtn = h('button', { class: 'primary', 'data-clean': '1', onclick: () => runClean(d.candidates.filter(c => checked.has(c.id)), () => render()) });
  const rows = (d.projects || []).filter(r => r.deep >= (50 << 20) || r.chunks >= (50 << 20));
  page.append(h('h2', {}, 'Render leftovers · all projects'),
    h('div', { class: 'panel' },
      h('div', { class: 'sub', style: { marginBottom: '8px' } }, `Cleanup sends files to the ${W.bin} (old versions to the archive). You can also change individual selections in the list below.`),
      h('div', { class: 'row' }, h('span', { class: 'muted' }, 'Preset:'), presetBtns, h('span', { class: 'spacer' }), allBtn),
      d.busy?.length ? h('div', { class: 'sub', style: { marginTop: '8px' } }, '⏳ Projects currently excluded: ', d.busy.map(b => `${b.name} (${b.reason})`).join(' · '), '. They will appear in the list when rendering finishes.') : null,
      rows.length ? h('table', { class: 't', style: { marginTop: '10px' } },
        h('tr', {}, h('th', {}, 'Project'), h('th', {}, 'Status'), h('th', { class: 'num' }, 'Films'), h('th', { class: 'num' }, 'Leftovers · safe'), h('th', { class: 'num' }, 'Leftovers · deep'), h('th', { class: 'num' }, 'Total'), h('th', {})),
        rows.map(r => h('tr', {}, h('td', {}, r.name), h('td', {}, pill(r.status, PROJECT_STATUS_LABEL[r.status] || r.status)), h('td', { class: 'num' }, GB(r.film)), h('td', { class: 'num' }, GB(r.safe)), h('td', { class: 'num' }, GB(r.deep)), h('td', { class: 'num muted' }, GB(r.total)),
          h('td', { class: 'num' }, h('button', { class: 'ghost', title: '"Tidy up this project" on the project page', onclick: () => location.hash = '#/p/' + r.id }, 'Tidy up'))))) : null));
  const groups = {}; for (const c of d.candidates) (groups[c.rule] ||= []).push(c);
  const bar = h('div', { class: 'stickybar' }); const btn = h('button', { class: 'primary', 'data-clean': '1' }); const info = h('span', {});
  const upd = () => { const sel = d.candidates.filter(c => checked.has(c.id)), size = GB(sel.reduce((s, c) => s + c.size, 0)); info.textContent = `${sel.length} items selected · ${size}`; btn.textContent = 'Clean selected'; allBtn.textContent = `Clean render leftovers in all projects (${size})`; btn.dataset.empty = allBtn.dataset.empty = sel.length ? '0' : '1'; lockCleanButtons(); document.querySelectorAll('[data-rule]').forEach(el => { const g = groups[el.dataset.rule]; el.querySelector('.size').textContent = `${GB(g.filter(c => checked.has(c.id)).reduce((s, c) => s + c.size, 0))} / ${GB(g.reduce((s, c) => s + c.size, 0))}`; el.querySelector('input').checked = g.every(c => checked.has(c.id)); el.querySelector('input').indeterminate = !el.querySelector('input').checked && g.some(c => checked.has(c.id)); }); };
  btn.onclick = () => runClean(d.candidates.filter(c => checked.has(c.id)), () => render());
  page.append(h('h2', {}, 'Detailed list'));
  if (!d.candidates.length) page.append(h('div', { class: 'empty' }, 'Nothing to clean.'));
  for (const [rule, items] of Object.entries(groups).sort((a, b) => b[1].reduce((s, c) => s + c.size, 0) - a[1].reduce((s, c) => s + c.size, 0))) {
    const list = h('div', { class: 'items', hidden: true });
    for (const c of items.sort((a, b) => b.size - a.size)) list.append(h('label', { class: 'item' },
      h('input', { type: 'checkbox', checked: checked.has(c.id), 'data-id': c.id, onchange: e => { e.target.checked ? checked.add(c.id) : checked.delete(c.id); upd(); } }),
      h('div', {}, h('div', {}, h('b', {}, c.projectName), ' ', h('span', { class: 'ellip muted', title: c.path }, tail(c.path, 3))), h('div', { class: 'why' }, c.reason)),
      h('div', { class: 'num' }, GB(c.size))));
    const head = h('header', { 'data-rule': rule },
      h('input', { type: 'checkbox', onclick: e => { e.stopPropagation(); const on = e.target.checked; for (const c of items) on ? checked.add(c.id) : checked.delete(c.id); list.querySelectorAll('input').forEach(i => i.checked = on); upd(); } }),
      h('b', {}, d.rules[rule] || rule), h('span', { class: 'muted' }, `${items.length} items`), items[0]?.action === 'archive' ? pill('published', 'to archive') : null,
      h('span', { class: 'size' }), h('span', { class: 'dim' }, '▾'));
    head.onclick = () => { list.hidden = !list.hidden; };
    page.append(h('div', { class: 'rule' }, head, list));
  }
  bar.append(info, h('span', { class: 'spacer' }), btn);
  $('#main').append(bar); upd();
  return () => bar.remove();
}

// ---------- Settings
async function settingsPage(page) {
  const [c, gs] = await Promise.all([api('/api/config'), api('/api/guard/settings').catch(() => null)]);
  page.append(h('h1', {}, 'Settings'), h('div', { class: 'sub' }, 'Settings for this computer.'));
  // ---- render protection (RenderGuard runs in the background; the same panel is on the Renders page)
  if (gs) page.append(h('h2', {}, 'Render protection'), guardPanel(gs, { full: true }));
  // ---- projects removed from the list ("Remove from list"), with their folders untouched
  const hidden = await api('/api/hidden').catch(() => []);
  if (hidden.length) page.append(h('h2', {}, `Hidden projects (${hidden.length})`), h('div', { class: 'panel', style: { padding: '4px 6px' } }, h('table', { class: 't' },
    hidden.map(x => h('tr', {}, h('td', {}, h('b', {}, x.name)), h('td', { class: 'muted mono', style: { fontSize: '12px', wordBreak: 'break-all' } }, x.path), h('td', { class: 'num dim' }, AGO(x.at)),
      h('td', { class: 'num' }, h('button', { onclick: async () => { await api('/api/hidden/restore', { method: 'POST', body: { key: x.key } }); toast(`"${x.name}" restored to the list`); render(); } }, 'Restore')))))));
  const roots = c.roots.map(r => ({ ...r }));
  const list = h('div', {});
  const draw = () => {
    list.innerHTML = '';
    list.append(h('div', { class: 'panel', style: { padding: '4px 6px' } }, h('table', { class: 't' },
      h('tr', {}, h('th', {}, 'Enabled'), h('th', {}, 'Folder'), h('th', {}, 'Type'), h('th', {})),
      roots.map((r, i) => h('tr', {},
        h('td', {}, h('input', { type: 'checkbox', checked: r.enabled !== false, onchange: e => { r.enabled = e.target.checked; } })),
        h('td', { class: 'mono' }, r.path, ' ', folderButton(() => r.path, (p) => { r.path = p; draw(); }, 'Choose a folder to watch', '📂')),
        h('td', {}, h('select', { onchange: e => { r.type = e.target.value; } }, [['container', 'contains project folders'], ['project', 'single project'], ['media', 'finished videos']].map(([v, t]) => h('option', { value: v, selected: r.type === v }, t)))),
        h('td', { class: 'num' }, h('button', { class: 'ghost danger', onclick: () => { roots.splice(i, 1); draw(); } }, 'Remove')))))));
  };
  draw();
  const addIn = h('input', { placeholder: 'C:\\Users\\…\\Desktop\\new-folder', style: { width: '420px' } });
  const arch = h('input', { value: c.archiveDir, style: { width: '420px' } });
  const par = h('select', {}, [1, 2].map(n => h('option', { value: n, selected: c.maxParallelRenders === n }, n === 1 ? 'One render at a time (recommended)' : `2 renders if ${Math.round(c.secondRenderMinFreeMB / 1024)} GB+ RAM is free`)));
  // the other folders VideoHub writes to or reads from (defaults under Documents\VideoHub)
  const ts = c.thumbstudio || {};
  const dirField = (label, value, help) => { const inp = h('input', { value: value || '', placeholder: 'not set', style: { width: '420px' } }); return { inp, row: h('div', { class: 'row', style: { margin: '6px 0' } }, h('span', { style: { width: '220px' } }, label), inp, folderButton(() => inp.value.trim(), (p) => { inp.value = p; }, label), help ? h('span', { class: 'dim', style: { fontSize: '12px' } }, help) : null) }; };
  const dOut = dirField('Outputs folder', c.outputsDir, 'every render as a hard link, one folder per day');
  const dSnd = dirField('Sound library', c.soundLibDir, 'your music beds and effects for "Add sound"');
  const dTh = dirField('Thumbnails (shared)', ts.globalDir, 'thumbnails not tied to a project');
  const dTpl = dirField('Your thumbnail templates', ts.templatesDir);
  const dSty = dirField('Thumbnail style references', ts.styleRefsDir);
  const dStu = dirField('3D studio engine (optional)', c.studioDir, 'only for ready-made sound effects and studio scenes');
  const skipIn = h('input', { value: (c.skipFolders || []).join(', '), style: { width: '420px' } });
  const I = c.integrations || {};
  const okRow = (name, ok, text) => [h('div', { class: 'k' }, name), h('div', {}, ok ? h('span', { class: 'green' }, '✓ ') : h('span', { class: 'muted' }, '— '), text)];
  page.append(h('h2', {}, 'Optional parts on this computer'), h('div', { class: 'panel kv' },
    okRow('ffmpeg', I.ffmpeg, I.ffmpeg ? 'found (frame pictures, previews, renders)' : 'not found — install it: ' + W.installFfmpeg),
    okRow('Browser for renders', !!I.browser, I.browser || W.noBrowser),
    okRow('Render protection agent', I.agent?.ok, I.agent?.ok ? 'installed (CPU caps, RAM slow mode, pause hotkeys)' : I.agent?.why || 'not installed'),
    okRow('Ready-made sound effects', I.sfx?.ok, I.sfx?.ok ? 'available' : I.sfx?.why || 'not available')));
  page.append(h('h2', {}, 'Workspace'), h('div', { class: 'sub' }, 'The folder chosen in setup: the default home of every folder below (films, outputs, sounds, thumbnails, archive). Each folder can still be changed on its own here.'),
    h('div', { class: 'row', style: { marginTop: '6px' } }, h('span', { class: 'mono' }, c.workspace || '—')),
    h('h2', {}, 'Render speed'), h('div', { class: 'sub' }, `The encoder for films whose render script reads VIDEOHUB_ENCODER (every film made from the template). Automatic uses the ${W.gpu} when it can, with the same picture quality as the processor. Saved at once; the render dialog can still pick another one for a single render.`),
    h('div', { style: { marginTop: '6px' } }, renderSpeedControl(c)));
  page.append(h('h2', {}, 'Watched folders'), list,
    h('div', { class: 'row', style: { marginTop: '10px' } }, addIn, folderButton(() => addIn.value.trim(), (p) => { if (!roots.some((r) => r.path.toLowerCase() === p.toLowerCase())) roots.push({ path: p, type: 'container', enabled: true }); addIn.value = ''; draw(); toast('Added: click Save to keep your changes'); }, 'Choose a folder to watch', '📂 Choose folder…'), h('button', { onclick: () => { if (addIn.value.trim()) { roots.push({ path: addIn.value.trim(), type: 'container', enabled: true }); addIn.value = ''; draw(); } } }, 'Add')),
    h('div', { class: 'sub', style: { marginTop: '8px' } }, 'Helper folders inside a watched folder that are never listed as projects (unless they have their own render script):'),
    h('div', { class: 'row', style: { marginTop: '4px' } }, skipIn),
    h('h2', {}, 'Archive folder'), h('div', { class: 'sub' }, 'Old versions are moved here instead of being deleted.'), h('div', { class: 'row', style: { marginTop: '6px' } }, arch, folderButton(() => arch.value.trim(), (p) => { arch.value = p; }, 'Choose archive folder')),
    h('h2', {}, 'Other folders'), h('div', { class: 'panel' }, dOut.row, dSnd.row, dTh.row, dTpl.row, dSty.row, dStu.row),
    h('h2', {}, 'Render queue'), par,
    h('h2', {}, 'Tools'), h('div', { class: 'panel kv' }, Object.entries(c.tools).map(([k, v]) => [h('div', { class: 'k' }, k), h('div', { class: 'mono' }, v || h('span', { class: 'red' }, 'not found'))])),
    h('div', { class: 'row', style: { marginTop: '20px' } }, h('button', { class: 'primary', onclick: async () => {
      const v = (i) => i.inp.value.trim() || null;
      await api('/api/config', { method: 'POST', body: { roots, archiveDir: arch.value.trim(), maxParallelRenders: +par.value,
        outputsDir: v(dOut), soundLibDir: v(dSnd), studioDir: v(dStu), skipFolders: skipIn.value.split(',').map(s => s.trim()).filter(Boolean),
        thumbstudio: { ...ts, globalDir: v(dTh) || ts.globalDir, templatesDir: v(dTpl) || ts.templatesDir, styleRefsDir: v(dSty) || ts.styleRefsDir } } });
      toast('Saved, rescanning…'); } }, 'Save')),
  );
}

// a "📂" button: Windows' folder window opens on this PC (in front of everything); the chosen folder goes to onPick
export function folderButton(getStart, onPick, title = 'Choose folder', label = '📂 Choose…') {
  const b = h('button', { type: 'button', class: 'ghost', title: W.folderDialog, onclick: async (e) => {
    e.preventDefault(); e.stopPropagation();
    const old = b.textContent; b.disabled = true; b.textContent = '⏳ dialog open…';
    try { const r = await api('/api/pick-folder', { method: 'POST', body: { start: getStart() || null, title } }); if (r?.path) onPick(r.path); }
    catch (err) { toast('Could not open folder dialog: ' + err.message, true); }
    finally { b.disabled = false; b.textContent = old; }
  } }, label);
  return b;
}
