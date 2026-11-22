import { trashName, setSystemCapabilities, sameFolder } from './system.js';
import { agentName, setAgentName } from './agent.js';
import { agentSettings } from './agent-panel.js';   // [REASONIX PATCH] Reasonix / DeepSeek providers
// VideoHub UI: hash router + pages. No build step.
import { reviewPage } from './review.js';
import { outputsPanel, outputActions } from './outputs-panel.js';
import { activeRenders, elapsedSeconds, timeText, remainingText } from './render-status.js';
import { NOTE_STATUS_LABEL, NOTE_KIND_LABEL, PROJECT_STATUS_LABEL } from './values.js';
import { icon, ic } from './icons.js';
import { initShell, shellRoute, shellFilm, forgetFilm, shellActivity, shellChannel, filmChannel, openAgentDrawer } from './shell.js';
import { planPage } from './plan.js';
import { nowPage } from './now.js';
import { filesPage } from './files.js';
import { openFinishDialog, openFinishAll } from './finish.js';
import { skillsPage } from './skills.js';
import { initLeftovers, headline, ruleLine } from './leftovers.js';
import { workingFilms } from './activity-view.js';
initShell();   // the rail and top bar exist before anything below writes into them

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
// the space an item really gives back (hard links counted by the hub); older lists have only the size
export const FREED = c => c.freed ?? c.size ?? 0;
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
export const pill = (cls, text, ico) => h('span', { class: 'pill ' + String(cls).replace(/\s/g, '-') }, ico ? icon(ico) : null, text);
// a project status as a badge: icon + label, never colour alone
const STATUS_ICON = { 'in-progress': 'hammer', review: 'eye', revision: 'pen', approved: 'approved', published: 'approved', archived: 'archive', done: 'ready' };
const statusPill = (p, auto = p.statusAuto) => pill(p.status, (PROJECT_STATUS_LABEL[p.status] || p.status) + (auto && p.status !== 'in-progress' ? '*' : ''), STATUS_ICON[p.status] || 'dashed');

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
export const onRenders = fn => { renderSubs.add(fn); return () => renderSubs.delete(fn); };
// agent activity (Now page, rail count, film cards, the film's agent pill): the hub sends it only when it changed
let activityCache = null; const activitySubs = new Set();
export const activityData = () => activityCache;
export const onActivity = fn => { activitySubs.add(fn); return () => activitySubs.delete(fn); };
function setActivity(d) { if (!d) return; activityCache = d; shellActivity(d); markWorkingFilms(); for (const f of activitySubs) f(d); }
es.addEventListener('activity', e => { try { setActivity(JSON.parse(e.data)); } catch { } });
// the agent channel (plan, questions, a waiting agent): the open film's top bar, drawer and tabs follow it; a new
// question on the film you have open says so once (the drawer is one click away)
es.addEventListener('channel', e => {
  let ev = null; try { ev = JSON.parse(e.data); } catch { } if (!ev) return;
  shellChannel(ev);
  if (ev.what === 'question' && ev.project === filmChannelId()) setTimeout(() => {
    const q = (filmChannel()?.questions || []).find(x => x.id === ev.id && x.state === 'open'); if (!q) return;
    const b = h('button', { class: 'primary sm', onclick: () => { b.closest('div')?.remove(); openAgentDrawer(); } }, 'Answer');
    longToast(h('span', {}, ic('help', `${agentName()} asks: ${q.question.length > 90 ? q.question.slice(0, 88) + '…' : q.question} `), b));
  }, 400);
});
const filmChannelId = () => { const [name, id] = location.hash.replace(/^#\/?/, '').split('/'); return ['review', 'plan', 'files', 'p'].includes(name) ? decodeURIComponent(id || '') : null; };
// the first activity read is asked for after the first page is drawn (it never holds up the Films cards)
const loadActivity = () => api('/api/activity').then(d => { if (!activityCache) setActivity(d); }).catch(() => { });
// the "agent working" mark on film cards follows the activity without redrawing the grid
function markWorkingFilms() {
  const on = workingFilms(activityCache);
  document.querySelectorAll('.card[data-film]').forEach(c => { const m = c.querySelector('.agent-mark'); if (m) m.hidden = !on.has(c.dataset.film); });
}
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
  if (ev?.type === 'failed' && j) longToast(h('span', {}, ic('warn', `Render failed: ${j.projectName} — ${j.error || ''} `), h('a', { href: '#/renders' }, 'Details')), true);
  if (ev && ['done', 'failed', 'cancelled'].includes(ev.type)) refreshNewCount();
});
function longToast(node, err) { const el = h('div', { class: err ? 'err' : '' }, node); $('#toast').append(el); setTimeout(() => el.remove(), 15000); }
// "new" (not yet watched) render outputs on the Projects and Renders tabs
function refreshNewCount(n) {
  const set = k => { for (const id of ['#newOutP', '#newOutR']) { const c = $(id); if (c) { c.hidden = !k; c.textContent = k ? String(k) : ''; c.title = k ? `${k} new render${k === 1 ? '' : 's'} not watched yet` : ''; } } };
  if (n != null) return set(n);
  api('/api/outputs?limit=1').then(r => set(r.unseen)).catch(() => { });
}
window.__vhNewCount = refreshNewCount;
refreshNewCount(); setInterval(() => refreshNewCount(), 60000);
// Claude asked to show a page (hub_live): go there, unless a note is being written
es.addEventListener('navigate', e => {
  let d = null; try { d = JSON.parse(e.data); } catch { } if (!d?.hash || location.hash === d.hash) return;
  if (busyWriting()) { toast(h('span', {}, `${agentName()} wants to open a page. After saving your note: `, h('a', { href: d.hash }, 'open'))); return; }
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
  // the top bar's protection chip: on/off, free RAM, a slowed render
  const live = $('#live'), slow = g?.running && g.renders?.some(r => r.slow);
  live.classList.toggle('on', !!g?.running);
  live.replaceChildren(icon(slow ? 'slow' : 'shield'),
    g?.running ? h('span', { class: 'txt' }, `RAM ${(g.ramAvailMB / 1024).toFixed(1)} GB free`) : h('span', { class: 'txt' }, 'Protection off'),
    ...(slow ? [h('span', { class: 'slow' }, 'render slowed')] : []));
  live.title = (g?.running ? 'Render protection is on' : 'Render protection is off') + (slow ? ' · a render is slowed down' : '') + ' · open Renders';
}

// ---------- router
const pages = { now: nowPage, skills: skillsPage, files: filesPage, plan: planPage, outputs: outputsPage, projects: projectsPage, p: projectPage, review: reviewPage, renders: rendersPage, disk: diskPage, settings: settingsPage };
let cleanup = null, renderGen = 0;
async function render() {
  await agentReady;
  const gen = ++renderGen;
  const [name = 'projects', ...args] = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  if (!pages[name]) return location.replace('#/');   // an old or unknown link (e.g. a removed page) lands on Films
  if (cleanup) { try { cleanup(); } catch { } cleanup = null; }
  shellRoute(name, args.map(decodeURIComponent));
  const main = $('#main'); main.innerHTML = '';
  const page = h('div', { class: 'page' }); main.append(page);
  try {
    const done = await (pages[name] || projectsPage)(page, ...args.map(decodeURIComponent)) || null;
    if (gen === renderGen) cleanup = done; else if (done) try { done(); } catch { }   // another page opened while this one loaded
  }
  catch (e) { page.append(h('div', { class: 'empty' }, 'Error: ' + e.message)); }
}
const agentReady = api('/api/config').then(c => { setAgentName(c.agentName); setSystemCapabilities(c.capabilities); }).catch(() => {});
window.addEventListener('hashchange', render);
render().finally(() => setTimeout(() => { loadActivity(); initLeftovers(); }, 0));

// ---------- first run: no projects yet → where films go, the example film, adding a folder
async function welcomePanel() {
  const c = await api('/api/config').catch(() => ({ roots: [] }));
  const on = (c.roots || []).filter(r => r.enabled !== false), ex = c.example || {};
  const box = h('div', { class: 'panel welcome' },
    h('h2', {}, h('span', { class: 'ph-icon' }, icon('films')), 'Welcome to VideoHub'),
    h('p', {}, `VideoHub lists the film projects in the folders it watches. Ask ${agentName()} for a video: it builds the film as code in one of these folders, opens it here in the live preview (no render), and you leave notes on the frames and press "Send to ${agentName()}".`),
    h('div', { class: 'sub' }, on.length ? 'Watched now:' : 'No folder is watched yet.'),
    on.length ? h('ul', { style: { margin: '4px 0 10px' } }, on.map(r => h('li', { class: 'mono', style: { fontSize: '12.5px' } }, r.path))) : null,
    h('div', { class: 'row', style: { gap: '8px', flexWrap: 'wrap' } },
      ex.available && !ex.installed ? h('button', { class: 'primary', onclick: async (e) => {
        const b = e.currentTarget; b.disabled = true; b.textContent = 'Adding…';
        try { const r = await api('/api/example/install', { method: 'POST' }); toast('Example film added: ' + r.path); render(); } catch (err) { toast('Could not add the example: ' + err.message, true); b.disabled = false; }
      } }, ic('play', 'Add the example film')) : null,
      ex.installed ? h('span', { class: 'dim' }, 'The example film is in ' + ex.target + ' (scanning…)') : null,
      h('button', { onclick: () => location.hash = '#/settings' }, ic('folder', 'Add a folder…'))),
    c.workspace ? h('div', { class: 'sub', style: { marginTop: '10px' } }, 'Your workspace (films, outputs, sounds, archive): ', h('span', { class: 'mono' }, c.workspace)) : null,
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
    sel.replaceChildren(...['auto', 'nvenc', 'amf', 'qsv', 'vaapi', 'videotoolbox', 'x264'].map(v => h('option', { value: v, selected: v === cur, disabled: v !== 'auto' && v !== cur && !has.has(v) },
      (L[v] || v) + (v !== 'auto' && v !== 'x264' && !has.has(v) ? ' (not on this PC)' : ''))));
    sel.disabled = false;
    note.textContent = e.best && e.best !== 'x264' ? `This PC can encode on its graphics card (${e.best}${e.gpus?.length ? ', ' + e.gpus[0] : ''}): same quality, usually faster.` : 'No graphics-card encoder found: renders use the processor (x264).';
  }).catch(() => { sel.disabled = false; note.textContent = ''; });
  sel.onchange = async () => { try { await api('/api/config', { method: 'POST', body: { render: { encoder: sel.value } } }); toast('Render speed saved: ' + sel.selectedOptions[0].textContent); } catch (err) { toast('Could not save: ' + err.message, true); } };
  return h('span', { class: 'row', style: { gap: '8px', alignItems: 'center', flexWrap: 'wrap' } }, sel, note);
}

// ---------- Films (route "projects": the catalog of film projects)
const state ={ q: '', status: '', family: '', root: '', sort: 'updated' };
async function projectsPage(page) {
  const recent = outputsPanel({ compact: true });
  const sub = h('p', { class: 'sub' }, 'Scanning…');
  const search = h('label', { class: 'search', title: 'Search by name or folder' }, icon('search'),
    h('input', { type: 'search', placeholder: 'Search films', value: state.q, oninput: e => { state.q = e.target.value; draw(); } }));
  page.append(h('div', { class: 'page-head' }, h('div', {}, h('h1', {}, 'Films'), sub), h('span', { class: 'spacer' }), search,
    h('button', { title: 'Look for new and changed films in the watched folders', onclick: async () => { markUserScan(); await api('/api/scan', { method: 'POST' }); toast('Scan started…'); } }, ic('refresh', 'Rescan'))));
  const data = await api('/api/projects');
  const ps = data.projects;
  const total = ps.reduce((s, p) => s + (p.sizes?.total || 0), 0);
  const open = ps.reduce((s, p) => s + (p.notesOpen || 0), 0);
  sub.textContent = (ps.length === 1 ? '1 film' : `${ps.length} films`) + (open ? ` · ${open} open note${open === 1 ? '' : 's'}` : '') + ' · ' + (data.at ? `last scan ${AGO(data.at)}` : 'scanning…');
  const tiles = h('div', { class: 'tiles film-stats' },
    tile('films', ps.length),
    tile('on disk', GB(total)),
    tile('render leftovers', h('span', { id: 'cleanTile', title: 'Space the render leftovers would free (silent renders, script copies, old chunks, temporary files); open them on the Cleanup page' }, '…'), () => location.hash = '#/disk/leftovers'),
    tile('open notes', open),
  );
  page.append(tiles);
  if (!ps.length && !data.scanning) page.append(await welcomePanel());
  api('/api/leftovers?summary=1').then(d => { const el = $('#cleanTile'); if (el) el.textContent = GB(d.summary?.freed || 0); }).catch(() => { });
  page.append(recent.el);

  const roots = [...new Set(ps.map(p => p.root))];
  const sel = (key, opts, title) => h('select', { title, onchange: e => { state[key] = e.target.value; draw(); } }, opts.map(([v, t]) => h('option', { value: v, selected: state[key] === v }, t)));
  page.append(h('h2', {}, 'All films'), h('div', { class: 'films-bar' },
    sel('status', [['', 'All statuses'], ...STATUSES.concat('done').map(s => [s, PROJECT_STATUS_LABEL[s] || s])], 'Status'),
    sel('family', [['', 'All types'], ...Object.entries(FAMILY)], 'Type'),
    sel('root', [['', 'All folders'], ...roots.map(r => [r, r.split(/[\\/]/).slice(-2).join('/')])], 'Watched folder'),
    h('span', { class: 'spacer' }),
    sel('sort', [['updated', 'Recently updated'], ['size', 'Largest'], ['bloat', 'Most bloated'], ['notes', 'With open notes'], ['name', 'By name']], 'Sort'),
  ));
  const grid = h('div', { class: 'grid' }); page.append(grid);
  function draw() {
    thumbObserver.disconnect();
    const q = state.q.toLocaleLowerCase('en-US');
    let list = ps.filter(p => (!q || (p.title + ' ' + p.label).toLocaleLowerCase('en-US').includes(q)) && (!state.status || p.status === state.status) && (!state.family || p.family === state.family) && (!state.root || p.root === state.root));
    const bloat = p => p.finalSize ? p.sizes.total / p.finalSize : 0;
    list.sort({ updated: (a, b) => b.updated - a.updated, size: (a, b) => b.sizes.total - a.sizes.total, bloat: (a, b) => bloat(b) - bloat(a), notes: (a, b) => b.notesOpen - a.notesOpen, name: (a, b) => a.title.localeCompare(b.title, 'en-US') }[state.sort]);
    grid.innerHTML = '';
    if (!list.length && ps.length) grid.append(h('div', { class: 'empty' }, 'No matching films.'));
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
  let cur = null; try { cur = JSON.parse(localStorage.getItem('vh-film') || 'null')?.id; } catch { }
  // the picture plays the film; the rest of the card opens it too (live preview, else the newest video, else its details)
  const thumb = h('div', { class: 'thumb' + (p.outputsCount ? ' playable' : ''), title: p.live ? 'Live preview from the latest code' : p.outputsCount ? 'Play the latest render' : null,
    onclick: e => { e.stopPropagation(); openProject(p); } },
    h('span', { class: 'fstatus' }, statusPill(p)),
    p.notesOpen ? h('span', { class: 'fnotes', title: p.notesOpen + (p.notesOpen === 1 ? ' open note' : ' open notes') }, icon('note'), p.notesOpen) : null,
    p.latestDur ? h('span', { class: 'dur' }, DUR(p.latestDur)) : null, p.outputsCount ? h('span', { class: 'play' }, icon('play')) : null,
    p.live ? h('span', { class: 'livebadge', title: 'Live preview available: plays from code, no render needed' }, icon('dot'), 'Live') : null);
  if (!p.outputsCount) thumb.append(h('div', { class: 'noimg' }, p.emptyNote || 'no video yet'));
  if (p.outputsCount || p.live) { thumb.dataset.thumb = p.id; thumb.dataset.version = p.thumbVersion || p.updated || ''; if (p.live) thumb.dataset.live = '1'; thumbObserver.observe(thumb); }
  const agentMark = h('a', { class: 'agent-mark', href: '#/now/' + encodeURIComponent(p.id), title: 'An agent is working on this film now · open Now', hidden: !workingFilms(activityCache).has(p.id), onclick: e => e.stopPropagation() }, icon('spin', { cls: 'spin' }), 'Agent working');
  return h('div', { class: 'card' + (cur === p.id ? ' current' : ''), 'data-film': p.id, onclick: () => openProject(p) }, thumb,
    h('div', { class: 'body' },
      h('div', { class: 't', title: p.label }, p.title),
      h('div', { class: 'meta' }, agentMark, pill('fam', FAMILY[p.family] || p.family), h('span', {}, GB(p.sizes?.total)), p.finalSize ? h('span', { class: ratio > 3 ? 'red' : '' }, `final ${GB(p.finalSize)}${ratio > 1.5 ? ` · ${ratio.toFixed(1)}×` : ''}`) : null,
        h('span', { class: 'spacer' }), h('span', { title: new Date(p.updated).toLocaleString('en-US') }, AGO(p.updated))),
      h('div', { class: 'cardfoot' },
        p.live ? h('button', { class: 'ghost cardlink', title: 'Open the live preview (from code, no render)', onclick: e => { e.stopPropagation(); openProject(p); } }, ic('code', 'Live code')) : null,
        p.latest ? h('button', { class: 'ghost cardlink', title: 'Latest saved MP4; may differ from the live code', onclick: e => { e.stopPropagation(); location.hash = `#/review/${p.id}/${encodeURIComponent(p.latest)}`; } }, ic('video', 'Latest MP4')) : null,
        p.notesTotal ? h('span', { class: 'dim', style: { fontSize: '11.5px', marginLeft: '4px' } }, `${p.notesTotal} notes`) : null,
        h('span', { class: 'spacer' }),
        h('button', { class: 'cardbtn', title: 'Film details: versions, notes, status, disk', onclick: e => { e.stopPropagation(); location.hash = '#/p/' + p.id; } }, icon('info')),
        h('button', { class: 'cardbtn', title: 'Open folder in file manager', onclick: e => { e.stopPropagation(); openFolder(p.id); } }, icon('folder')),
        h('button', { class: 'cardbtn rm', title: `Remove film… (from the list or to the ${trashName()})`, onclick: e => { e.stopPropagation(); removeProject(p, () => render()); } }, icon('trash'))),
      h('div', { class: 'bloat', title: `lime: videos ${GB(out)} · amber: intermediate files ${GB(junk)}` }, h('i', { style: { width: (100 * out / Math.max(1, p.sizes?.total)) + '%', background: 'var(--ok)' } }), h('i', { style: { width: (100 * junk / Math.max(1, p.sizes?.total)) + '%', background: 'var(--wait)' } })),
    ));
}

// a project opens where the work happens: its live preview, else its newest video, else the project page
export async function openProject(p) {
  const li = await api(`/api/project/${p.id}/live?probe=1`).catch(() => null);
  if (li?.ok) location.hash = `#/review/${p.id}/~live`;
  else if (p.outputsCount && p.latest) location.hash = `#/review/${p.id}/${encodeURIComponent(p.latest)}`;
  else location.hash = '#/p/' + p.id;
}
// "Remove": hide it from the list (no file touched, restore from Settings) or send its folder to the system Trash
export async function removeProject(p, after) {
  let mode = 'hide';
  const opt = (m, label, sub) => h('label', { class: 'row', style: { gap: '8px', alignItems: 'flex-start', margin: '8px 0' } },
    h('input', { type: 'radio', name: 'rmp', checked: mode === m, onchange: () => { mode = m; } }), h('div', {}, h('b', {}, label), h('div', { class: 'dim', style: { fontSize: '12.5px' } }, sub)));
  const where = p.group ? `${p.path} · ${(p.groupFiles || []).length} files` : p.path + (p.studio && p.outDir ? `  +  ${p.outDir}` : '');
  const ok = await confirmBox(`Remove "${p.title || p.name}"?`, h('div', {},
    h('div', { class: 'mono', style: { fontSize: '12.5px', wordBreak: 'break-all', margin: '4px 0 8px' } }, where),
    h('div', { class: 'muted' }, `Size: ${GB(p.sizes?.total || 0)}`),
    opt('hide', 'Remove from list', 'VideoHub will hide this project without changing any files. Restore it from Settings → Hidden projects.'),
    opt('delete', `Delete folder (${trashName()})`, p.group ? `This film’s files go to the ${trashName()}, where you can restore them.` : `The entire project folder goes to the ${trashName()}, where you can restore it. Unavailable while rendering.`)), 'Apply');
  if (!ok) return false;
  try {
    if (mode === 'hide') { await api(`/api/project/${p.id}/hide`, { method: 'POST' }); toast('Removed from list (Settings → Hidden projects)'); }
    else {
      toast(`Sending to ${trashName()}…`);
      const r = await api(`/api/project/${p.id}/delete-folder`, { method: 'POST' });
      if (r.ok) toast(`Sent to ${trashName()} · ${GB(p.sizes?.total || 0)} freed`); else toast('Could not delete: ' + (r.error || ''), true);
    }
  } catch (e) { toast(e.message, true); return false; }
  forgetFilm(p.id);   // the rail's film entry would lead nowhere now
  after && after(); return true;
}

// ---------- Project
// the project folder (or a video's folder with the video selected) in the file manager
export const openFolder = (id, file) => api(`/api/project/${id}/open-folder`, { method: 'POST', body: file ? { file } : {} }).catch(e => toast(e.message, true));
// A film's details (#/p/<id>): everything about the film that is not watching it. Its Review tab is in the top bar.
const DISK_PARTS = [['output', 'Videos', 'var(--ok)'], ['chunk', 'Render chunks', 'var(--wait)'], ['oldChunk', 'Old chunks', 'var(--chg)'], ['part', 'Part/segment', '#d9a35b'], ['profile', 'Chrome profiles', '#c0645a'], ['snap', 'Check frames', 'var(--work)'], ['audio', 'Audio', 'var(--violet)'], ['other', 'Code and other files', 'var(--t4)']];
async function projectPage(page, id) {
  const p = await api('/api/project/' + id);
  const latest = p.outputs.find(o => o.rel === p.latest);
  // where "Review" goes: the live preview (code is usually newer than the last render), else the latest video
  let liveOk = false;
  const openReview = () => { location.hash = liveOk ? `#/review/${id}/~live` : latest ? `#/review/${id}/${encodeURIComponent(latest.rel)}` : `#/review/${id}/~live`; };
  shellFilm(p, { tab: 'details', meta: [FAMILY[p.family] || p.family, p.filmDur ? DUR(p.filmDur) : null, `${p.outputs.length} video${p.outputs.length === 1 ? '' : 's'}`], review: openReview });
  // live preview: watch the film from its code, no render (shown only when the film page supports it)
  const liveBtn = h('button', { hidden: true, class: 'primary', title: `The film plays from its code and refreshes automatically when ${agentName()} updates it`, onclick: () => location.hash = `#/review/${id}/~live` }, ic('play', 'Live preview (no render)'));
  api(`/api/project/${id}/live?probe=1`).then(li => { if (li?.ok) { liveOk = true; liveBtn.hidden = false; } }).catch(() => { });
  const statusSel = h('select', { title: 'The film\'s status (also decides what cleanup may remove)', onchange: async e => { await api(`/api/project/${id}/meta`, { method: 'POST', body: { status: e.target.value } }); toast('Status saved'); } },
    (STATUSES.includes(p.status) ? STATUSES : [p.status, ...STATUSES]).map(s => h('option', { value: s, selected: s === p.status }, PROJECT_STATUS_LABEL[s] || s)));
  page.append(
    h('div', { class: 'fd-head' },
      h('div', {}, h('h1', {}, p.title, statusPill(p)), h('div', { class: 'sub mono', title: p.path }, p.label)),
      h('span', { class: 'spacer' }),
      h('div', { class: 'fd-actions' },
        liveBtn,
        latest ? h('button', { class: 'primary', title: 'Watch the latest video and leave notes', onclick: () => location.hash = `#/review/${id}/${encodeURIComponent(latest.rel)}` }, ic('eye', 'Review latest video')) : null,
        h('button', { title: p.path, onclick: () => openFolder(id) }, ic('folder', 'Open folder')),
        p.group || p.rootType === 'media' || p.studio ? null : h('button', { 'data-clean': '1', title: 'The film is done: review what it no longer needs and tidy its folder', onclick: () => openFinishDialog(id, { after: () => render() }) }, ic('broom', 'Finish film…')),
        h('button', { title: 'Measure this film again', onclick: async () => { await api(`/api/project/${id}/rescan`, { method: 'POST' }); render(); } }, ic('refresh', 'Rescan')),
        h('button', { class: 'ghost danger', title: `Remove from the list or send the folder to the ${trashName()}`, onclick: () => removeProject(p, () => { location.hash = '#/'; }) }, ic('trash', 'Remove…')))),
  );
  const main = h('div', { class: 'fd-main' }), side = h('aside', { class: 'fd-side' });
  page.append(h('div', { class: 'fd-grid' }, main, side));

  // ---- main column: versions, tidy up, notes, render history
  main.append(h('h2', {}, `Versions · ${p.outputs.length}`));
  if (!p.outputs.length) main.append(h('div', { class: 'empty' }, 'No videos in this film yet. The live preview plays it from its code.'));
  else main.append(h('div', { class: 'panel', style: { padding: '4px 6px' } }, h('table', { class: 't' },
    h('tr', {}, h('th', {}, 'File'), h('th', {}, 'Type'), h('th', { class: 'num' }, 'Duration'), h('th', { class: 'num' }, 'Resolution'), h('th', { class: 'num' }, 'Size'), h('th', { class: 'num' }, 'Date'), h('th', {})),
    p.outputs.map(o => h('tr', {},
      h('td', {}, h('span', { class: 'ellip', title: o.path }, o.rel), o.dupOf ? h('div', { class: 'dim', style: { fontSize: '12px' } }, 'copy of: ' + o.dupOf.split(/[\\/]/).slice(-2).join('/')) : null, o.role === 'silent' && o.coveredBy ? h('div', { class: 'dim', style: { fontSize: '12px' } }, 'video included in: ' + o.coveredBy) : null),
      h('td', {}, pill(o.role, ROLE[o.role] || o.role)),
      h('td', { class: 'num' }, DUR(o.dur)), h('td', { class: 'num muted' }, o.w ? `${o.w}×${o.h} ${Math.round(o.fps)}fps` : '—'),
      h('td', { class: 'num' }, GB(o.size)), h('td', { class: 'num muted' }, AGO(o.mtime)),
      h('td', { class: 'num' }, h('button', { class: 'ghost sm', onclick: () => location.hash = `#/review/${id}/${encodeURIComponent(o.rel)}` }, ic('eye', 'Watch / add notes')),
        h('button', { class: 'ghost sm', title: 'Show in folder (file selected)', onclick: () => openFolder(id, o.rel) }, ic('reveal', 'Show')))))),
  ));
  if (p.cleanup.length || p.busy || (p.sizes?.chunk || 0) > 0) main.append(tidyBlock(p, () => render()));
  else if (p.cleanupPending) main.append(h('div', { class: 'sub', style: { marginTop: '10px' } }, 'Preparing cleanup list… (refresh in a moment)'));
  const notes = p.notes || [];
  main.append(h('h2', {}, `Notes · ${notes.length}`),
    notes.length ? h('div', { class: 'panel', style: { padding: '4px 6px' } }, h('table', { class: 't' }, notes.slice().reverse().map(n => h('tr', { style: { cursor: 'pointer' }, title: 'Open this note in Review', onclick: () => location.hash = `#/review/${id}/${encodeURIComponent(n.file || p.latest)}?n=${n.id}` },
      h('td', { class: 'mono' }, '#' + n.id), h('td', { class: 'mono' }, TC(n.t)), h('td', {}, pill(n.status, NOTE_STATUS_LABEL[n.status] || n.status)), h('td', { class: 'muted' }, NOTE_KIND_LABEL[n.kind] || n.kind), h('td', {}, n.text), h('td', { class: 'num dim' }, AGO(n.createdAt))))))
      : h('div', { class: 'empty' }, 'No notes yet. Open the film in Review and click the picture to leave a note on a frame.'),
    h('h2', {}, 'Render history'),
    p.history.length ? h('div', { class: 'panel', style: { padding: '4px 6px' } }, h('table', { class: 't' }, p.history.slice(0, 25).map(x => h('tr', {}, h('td', { class: 'num muted' }, x.at.replace('T', ' ').slice(0, 16)), h('td', {}, x.event), h('td', {}, x.session), h('td', { class: 'muted' }, x.detail)))))
      : h('div', { class: 'empty' }, 'No render history for this film.'));

  // ---- side column: status and render settings, disk
  side.append(h('div', { class: 'panel' }, h('div', { class: 'fd-card-title' }, icon('settings'), 'Film'),
    h('div', { class: 'fd-status' }, h('span', { class: 'dim' }, 'Status'), statusSel),
    h('div', { class: 'kv' },
      h('div', { class: 'k' }, 'Folder'), h('div', { class: 'mono', style: { wordBreak: 'break-all' } }, p.path),
      h('div', { class: 'k' }, 'Type'), h('div', {}, FAMILY[p.family] || p.family),
      h('div', { class: 'k' }, 'Script'), h('div', {}, p.render?.script || '—'),
      h('div', { class: 'k' }, 'FPS / chunk'), h('div', {}, p.render?.fps ? `${p.render.fps} fps` : '—', p.render?.chunkSec ? ` · ${p.render.chunkSec} s chunks` : ''),
      h('div', { class: 'k' }, 'Partial render'), h('div', {}, p.render?.supportsOnly ? h('span', { class: 'green' }, 'supported (ONLY=)') : h('span', { class: 'muted' }, 'unavailable')),
      h('div', { class: 'k' }, 'File count'), h('div', {}, p.counts?.files ?? '—', p.counts?.chunks ? ` · ${p.counts.chunks} chunks` : ''))));
  const S = p.sizes || {};
  side.append(h('div', { class: 'panel' }, h('div', { class: 'fd-card-title' }, icon('box'), `Disk · ${GB(S.total)}`),
    h('div', { class: 'stack' }, DISK_PARTS.map(([k, , c]) => S[k] ? h('i', { style: { width: (100 * S[k] / S.total) + '%', background: c }, title: GB(S[k]) }) : null)),
    h('div', { class: 'legend' }, DISK_PARTS.filter(([k]) => S[k]).map(([k, t, c]) => h('span', {}, h('b', { style: { background: c } }), `${t} ${GB(S[k])}`)))));
}

// "Tidy up this project": what the films take vs what can go; the safe items and the deep ones the rules
// pre-select (chunks of a film marked finished by the user, old QA) are ticked
function tidyBlock(p, after) {
  const cands = p.cleanup, film = p.outputs.filter(o => o.role === 'final' || o.role === 'web').reduce((t, o) => t + (o.size || 0), 0);
  const left = cands.filter(c => c.preset).reduce((t, c) => t + c.size, 0);
  const inReview = !['approved', 'published', 'archived', 'done'].includes(p.status);
  return h('div', {},
    h('h2', {}, 'Tidy up this film'),
    h('div', { class: 'sub', style: { marginBottom: '8px' } }, `Videos ${GB(film)} · leftovers ${GB(left)}`,
      inReview && p.render?.chunkSec ? h('span', { class: 'dim' }, ' · film in review: render\\chunks are kept for partial renders (mark it "approved" to include them in cleanup)') : null),
    !p.busy && (p.sizes?.chunk || 0) > 0 && (inReview || p.statusAuto) ? h('div', { class: 'panel release-chunks' },
      h('b', {}, GB(p.sizes.chunk) + ' of render chunks kept for revision.'),
      h('p', { class: 'sub' }, 'Once review is finished, you can release the chunks for cleanup. Code, audio and final videos stay; later changes will need a full render.'),
      h('button', { disabled: p.notesOpen > 0, title: p.notesOpen > 0 ? 'Resolve the open revision notes first.' : '', onclick: async () => {
        if (await confirmBox('Is the review finished?', h('p', {}, `The project will be marked approved. You can then select the render chunks and send them to the ${trashName()}; this step does not delete files.`), 'Finish review')) {
          await api('/api/project/' + p.id + '/meta', { method: 'POST', body: { status: 'approved' } }); render();
        }
      } }, 'Review finished · release chunks for cleanup')) : null,
    p.busy ? h('div', { class: 'sub' }, ic('hourglass', `Render leftovers for this film are not listed right now: ${p.busy}.`)) : null,
    cleanupBlock(cands, after, c => c.preset === 'safe' || (c.preset === 'deep' && c.checked), false));
}
function cleanupBlock(cands, after, pre = c => c.checked, title = true) {
  const checked = new Set(cands.filter(pre).map(c => c.id));
  const sum = () => cands.filter(c => checked.has(c.id)).reduce((s, c) => s + FREED(c), 0);
  const btn = h('button', { class: 'primary', 'data-clean': '1' });
  const upd = () => { btn.textContent = `Clean selected (frees ${GB(sum())})`; btn.dataset.empty = checked.size ? '0' : '1'; lockCleanButtons(); };
  btn.onclick = () => runClean(cands.filter(c => checked.has(c.id)), after);
  upd();
  return h('div', {}, title ? h('h2', {}, `Available to clean · ${GB(cands.reduce((s, c) => s + FREED(c), 0))}`) : null, h('div', { class: 'rule' }, h('div', { class: 'items', style: { borderTop: 0 } },
    cands.map(c => h('label', { class: 'item' }, h('input', { type: 'checkbox', checked: checked.has(c.id), onchange: e => { e.target.checked ? checked.add(c.id) : checked.delete(c.id); upd(); } }),
      h('div', {}, h('div', { class: 'ellip', title: c.path }, c.path.split(/[\\/]/).slice(-3).join('/')), h('div', { class: 'why' }, (c.action === 'archive' ? 'Moves to archive · ' : `${trashName()} · `) + c.reason)),
      sizeCell(c))))), h('div', { class: 'row', style: { marginTop: '8px' } }, btn));
}
// what an item frees; when a hard link keeps part of it, what it moves too
function sizeCell(c) {
  const f = FREED(c);
  return h('div', { class: 'num', title: f < c.size ? `Moves ${GB(c.size)}; frees ${GB(f)} (another hard link keeps the rest)` : '' }, GB(f), f < c.size ? h('div', { class: 'dim', style: { fontSize: '11px' } }, `moves ${GB(c.size)}`) : null);
}

// Cleaning runs on the hub in the background, one run at a time. A panel shows its progress (SSE 'clean') and,
// at the end, what went where and what could not go and why. Clean buttons are locked while a run is going.
let cleanState = null, cleanBox = null, cleanAfter = null;
const cleanRunning = () => cleanState && cleanState.state === 'running';
const lockCleanButtons = () => document.querySelectorAll('button[data-clean]').forEach(b => { if (b.dataset.tip == null) b.dataset.tip = b.title || ''; b.disabled = cleanRunning() || b.dataset.empty === '1'; b.title = cleanRunning() ? 'Cleanup in progress' : b.dataset.tip; });
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
      h('div', { class: 'muted' }, `${GB(st.freed)} freed`, st.current ? h('div', { class: 'ellip dim', title: st.current }, st.current.split(/[\\/]/).slice(-3).join('/')) : null),
      h('div', { class: 'dim', style: { fontSize: '12px' } }, 'You can keep using VideoHub; cleanup continues even if you close the page.'));
  } else {
    const rs = st.results || [], bad = rs.filter(r => r.status === 'error'), other = rs.filter(r => r.status === 'skipped' || r.status === 'gone');
    const binned = rs.some(r => r.status === 'ok' && !r.to);   // (archived items have a destination)
    putClean(h('b', {}, `Cleanup finished · ${GB(st.freed)} freed`),
      h('div', { class: 'muted' }, `${st.ok} done${bad.length ? ` · ${bad.length} failed` : ''}${other.length ? ` · ${other.length} skipped / already gone` : ''}`),
      binned ? h('div', { class: 'sub' }, `Moved to the ${trashName()}. Empty the ${trashName()} to free the space.`) : null,
      bad.length || other.length ? h('div', { class: 'cleanres' }, [...bad, ...other].map(r => h('div', { class: 'item' + (r.status === 'error' ? ' red' : '') },
        h('div', {}, h('b', {}, STATUS_TR[r.status] + ' '), r.path ? h('span', { class: 'ellip', title: r.path }, (r.project ? r.project + ' · ' : '') + r.path.split(/[\\/]/).slice(-3).join('/')) : null),
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
    rec.length ? h('p', {}, `${rec.length} items (${GB(rec.reduce((s, c) => s + c.size, 0))}) will go to the ${trashName()}. You can restore them from there; the space comes back (${GB(rec.reduce((s, c) => s + FREED(c), 0))}) once the ${trashName()} is emptied.`) : null,
    arc.length ? h('p', {}, `${arc.length} old versions (${GB(arc.reduce((s, c) => s + c.size, 0))}) will move to the archive folder and be removed here after the copy is verified.`) : null,
    h('p', { class: 'dim' }, 'Runs in the background; progress appears at the bottom right.')), 'Clean');
  if (!ok) return;
  try { await startCleanRun('/api/disk/clean', { ids: items.map(c => c.id) }, after); }
  catch (e) { toast('Cleanup did not start: ' + e.message, true); }
}
// starts a cleanup run on the hub (the Cleanup lists, or "Finish film" with its own list) and follows it; after() runs
// when it ends, if the same page is still open
export const cleanIsRunning = () => !!cleanRunning();
export async function startCleanRun(url, body, after) {
  cleanAfter = after ? { fn: after, hash: location.hash } : null;
  try { onCleanState(await api(url, { method: 'POST', body })); }
  catch (e) { cleanAfter = null; throw e; }
}

// ---------- Renders
async function rendersPage(page) {
  page.append(h('div', { class: 'page-head' }, h('div', {}, h('h1', {}, 'Renders'), h('p', { class: 'sub' }, 'One render at a time. Running jobs, elapsed time and speed settings; finished videos are below.')),
    h('span', { class: 'spacer' }), h('a', { class: 'btn', href: '#/outputs' }, ic('video', 'All recent renders'))));
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
      tile('CPU limit', g.capabilities?.cpuAffinity === false ? h('span', { title: g.capabilities.cpuLimitReason }, 'unavailable') : g.running ? (g.capNow >= 100 ? 'unlimited' : g.capNow + '%') : '—'),
      tile('Running', active.filter(r => r.state === 'running').length),
    ));
    // slow every render down at once (and back): frees the computer for a moment without stopping anything
    if (g.running && (g.renders || []).length) live.append(h('div', { class: 'row', style: { gap: '8px', margin: '4px 0 8px' } },
      h('button', { title: 'Run every render at the lowest speed, so the computer is free for you', onclick: () => cmd('slow') }, ic('slow', 'Slow all down')),
      h('button', { title: 'Back to normal render speed', onclick: () => cmd('normal') }, ic('play', 'Normal speed for all'))));
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
          row.state === 'paused' ? h('span', { class: 'red' }, ic('pause', 'Paused')) :
          h('div', { class: 'row' }, r?.slow ? h('span', { class: 'accent' }, ic('slow', 'Slow')) : null,
            row.progress != null ? [h('div', { class: 'progress' }, h('i', { style: { width: Math.max(0, Math.min(100, row.progress * 100)) + '%' } })), Math.round(row.progress * 100) + '%'] : h('span', { class: 'dim' }, 'Waiting for progress'))),
        timerCell('elapsed', 'Time since the job actually started; excludes queue time and includes pauses.'),
        timerCell('remaining', 'Estimate based on the latest progress. Render speed, pauses and joining can change the remaining time.'),
        h('td', { class: 'num' }, r && r.cpu != null ? Math.round(r.cpu) + '%' : '—'),
        h('td', { class: 'num' }, r && r.ramMB != null ? GB(r.ramMB * 1048576) : '—'),
        h('td', { class: 'num render-controls' },
          r ? [
            h('button', { onclick: () => cmd(r.slow ? 'normal' : 'slow', r.rootPid) }, r.slow ? 'Normal speed' : 'Slow down'),
            h('button', { class: 'danger', onclick: async () => { if (await confirmBox('Stop this render?', h('p', {}, label), 'Stop')) { if (j) await api('/api/jobs/' + j.id + '/cancel', { method: 'POST' }).catch(e => toast(e.message, true)); else await cmd('kill', r.rootPid); } } }, 'Stop')
          ] : j ? [
            j.needsApproval ? h('button', { class: 'primary', title: `${agentName()} asked to run this command in the project folder. Run it only if you know what it does.`, onclick: async () => { if (await confirmBox('Run this command?', h('div', {}, h('p', {}, `${agentName()} asked VideoHub to run this command in the folder of "` + label + '":'), h('pre', { style: { whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' } }, j.cmd), h('p', { class: 'dim' }, 'A command can do anything on this computer. Approve it only if it is what you expected.')), 'Run it')) await api('/api/jobs/' + j.id + '/approve', { method: 'POST' }).catch(e => toast(e.message, true)); } }, 'Approve') : null,
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
  page.append(h('div', { class: 'page-head' }, h('div', {}, h('h1', {}, 'Recent renders'), h('p', { class: 'sub' }, 'Your finished videos, newest first. Open a video, find it in its folder or review it in VideoHub.')),
    h('span', { class: 'spacer' }), h('a', { class: 'btn', href: '#/renders' }, ic('back', 'Running renders'))), panel.el);
  return panel.dispose;
}

// ---------- render settings (RenderGuard): presets, a temporary full-power window, and the sliders
const PRESETS = [
  ['Full power', 'every core, normal priority', { CapActive: 100, LowPrio: false }],
  ['Balanced', '90% of the cores, low priority (default)', { CapActive: 90, LowPrio: true }],
  ['Quiet', 'half of the cores; keeps your computer responsive', { CapActive: 50, LowPrio: true }],
];
function guardPanel(gs, { full = false } = {}) {
  const box = h('div', { class: 'panel gpanel' });
  const redraw = async () => { const fresh = await api('/api/guard/settings').catch(() => null); if (fresh) box.replaceWith(guardPanel(fresh, { full })); };
  let timer = null; const pending = {};
  const save = (k, v) => { pending[k] = v; clearTimeout(timer); timer = setTimeout(async () => { const body = { ...pending }; for (const x in pending) delete pending[x]; try { await api('/api/guard/settings', { method: 'POST', body }); } catch (e) { toast('Could not save: ' + e.message, true); } }, 400); };
  const slider = (key, label, min, max, step, fmt, help) => {
    const out = h('b', { style: { minWidth: '150px', display: 'inline-block' } }, fmt(gs[key]));
    const inp = h('input', { type: 'range', 'data-guard-setting': key, min, max, step, value: gs[key], style: { width: '280px' }, oninput: e => { out.textContent = fmt(+e.target.value); save(key, +e.target.value); } });
    return h('div', { class: 'row', style: { margin: '6px 0' } }, h('span', { style: { width: '260px' } }, label), inp, out, help ? h('span', { class: 'dim', style: { fontSize: '12px' } }, help) : null);
  };
  const toggle = (key, label, help) => h('label', { class: 'row', style: { margin: '6px 0', cursor: 'pointer' } },
    h('input', { type: 'checkbox', 'data-guard-setting': key, checked: !!gs[key], onchange: e => save(key, e.target.checked) }), h('span', {}, label), help ? h('span', { class: 'dim', style: { fontSize: '12px' } }, help) : null);
  const affinity = gs.capabilities?.cpuAffinity !== false;
  const limitReason = gs.capabilities?.cpuLimitReason || 'CPU limit not available on this system. Renders still use priority and RAM protection.';
  const cores = gs.cores || navigator.hardwareConcurrency || 12;
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
    h('div', { class: 'sub', style: { marginBottom: '8px' } }, affinity ? 'Render protection is part of VideoHub: renders started from VideoHub get a CPU limit and low priority, and slow down when free RAM runs low.' : 'Render protection is part of VideoHub: renders started from VideoHub use low priority and slow down when available RAM runs low.'),
    ...(affinity ? [presets, tempRow, slider('CapActive', 'Render power', 10, 100, 5, pct)] : [h('p', { class: 'dim' }, limitReason)]),
    toggle('LowPrio', 'Run renders at low priority', 'keeps open apps responsive; rendering slows slightly'));
  const more = h('div', {},
    slider('PauseMB', 'Slow down when free RAM reaches', 300, Math.max(4000, Math.round((gs.ramTotalMB || 16384) / 4 / 100) * 100), 100, v => `${(v / 1024).toFixed(1)} GB free`, 'the newest render slows down; the oldest continues'),
    ...(affinity ? [slider('SlowCapPct', 'Speed in slow mode', 1, 30, 1, v => `${v}% CPU`, 'rendering continues at a lower speed')] : []),
    slider('CriticalMB', 'Critical RAM', 200, 2000, 100, v => `${(v / 1024).toFixed(1)} GB`, 'below this, the oldest render also slows down'),
    toggle('Startup', 'Start VideoHub at login and keep it running', 'opens no window and starts render protection immediately; when disabled, starts when you open VideoHub and exits 2 min after closing the window if no renders are running'));
  if (full) box.append(more);
  else { more.hidden = true; const link = h('button', { class: 'ghost', onclick: () => { more.hidden = !more.hidden; link.textContent = more.hidden ? 'RAM and other settings ▾' : 'Show less ▴'; } }, 'RAM and other settings ▾'); box.append(link, more); }
  return box;
}

// ---------- Disk
// #/disk/leftovers: the banner's "Review" (and the Films page's tile): exactly the render leftovers VideoHub asked about
// are selected (without a question open: every item of those rules), their groups open, one button above cleans them
async function diskPage(page, mode) {
  const asked = mode === 'leftovers';
  page.append(h('div', { class: 'page-head' }, h('div', {}, h('h1', {}, 'Cleanup'), h('p', { class: 'sub' }, `See what can be safely removed and why. Deleted files go to the ${trashName()}; old versions go to the archive. Final videos and source are never touched.`))));
  const askedBox = h('div', {}); page.append(askedBox);
  const finished = h('div', { class: 'fin-page' }); page.append(finished);
  const stopFinished = finishedFilms(finished);
  const wait = h('div', { class: 'empty' }, 'Measuring folders… (large projects may take 10–30 s)'); page.append(wait);
  let d, lo = null; try { [d, lo] = await Promise.all([api('/api/disk'), asked ? api('/api/leftovers').catch(() => null) : null]); } catch (e) { stopFinished(); throw e; }
  wait.remove();
  const loRules = new Set(Object.keys(lo?.labels || {})), loIds = lo?.prompt ? new Set(lo.prompt.ids) : null;
  const isAsked = c => asked && (loIds ? loIds.has(c.id) : loRules.has(c.rule) && c.action === 'recycle');
  const T = d.totals || {}, parts = DISK_PARTS;
  page.append(h('div', { class: 'panel', style: { marginTop: '14px' } }, h('div', { class: 'row' }, h('b', {}, `Watched folders: ${GB(T.total)}`), h('span', { class: 'spacer' }), h('span', { class: 'muted' }, `Archive: ${d.archiveDir}${d.archiveOk ? '' : ' (drive unavailable!)'}`)),
    h('div', { class: 'stack', style: { marginTop: '10px' } }, parts.map(([k, , c]) => T[k] ? h('i', { style: { width: (100 * T[k] / T.total) + '%', background: c }, title: GB(T[k]) }) : null)),
    h('div', { class: 'legend' }, parts.filter(([k]) => T[k]).map(([k, t, c]) => h('span', {}, h('b', { style: { background: c } }), `${t} ${GB(T[k])}`)))));
  const safeBytes = d.candidates.filter(c => c.preset === 'safe').reduce((n, c) => n + FREED(c), 0);
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
  const presetSum = k => d.candidates.filter(c => inPreset(c, k)).reduce((s, c) => s + FREED(c), 0);
  const checked = new Set(d.candidates.filter(c => asked ? isAsked(c) : inPreset(c, 'safe')).map(c => c.id));
  const setPreset = k => { checked.clear(); for (const c of d.candidates) if (inPreset(c, k)) checked.add(c.id); document.querySelectorAll('.items input[data-id]').forEach(i => { i.checked = checked.has(i.dataset.id); }); presetBtns.forEach(b => b.classList.toggle('primary', b.dataset.k === k)); upd(); };
  const presetBtns = [['safe', 'Safe (recommended)', 'No longer needed: replaced chunks (chunks_v*, chunks_prev*), Chrome profiles, ' + 3 + ' days or older check frames and test clips, silent copies and old previews. Chunks needed for partial renders of films in review are kept.'],
    ['deep', 'Deep', 'Safe cleanup plus recent check frames, old versions (moved to the archive) and render chunks of finished/approved films (partial rendering will no longer be available).']]
    .map(([k, t, help]) => h('button', { 'data-k': k, title: help, class: k === 'safe' && !asked ? 'primary' : '', onclick: () => setPreset(k) }, `${t} · ${GB(presetSum(k))}`));
  const allBtn = h('button', { class: 'primary', 'data-clean': '1', onclick: () => runClean(d.candidates.filter(c => checked.has(c.id)), () => render()) });
  const rows = (d.projects || []).filter(r => r.deep >= (50 << 20) || r.chunks >= (50 << 20));
  page.append(h('h2', {}, 'Render leftovers · all projects'),
    h('div', { class: 'panel' },
      h('div', { class: 'sub', style: { marginBottom: '8px' } }, `Cleanup sends files to the ${trashName()} (old versions to the archive). You can also change individual selections in the list below.`),
      h('div', { class: 'row' }, h('span', { class: 'muted' }, 'Preset:'), presetBtns, h('span', { class: 'spacer' }), allBtn),
      d.busy?.length ? h('div', { class: 'sub', style: { marginTop: '8px' } }, icon('hourglass', { cls: 'il' }), 'Films currently excluded: ', d.busy.map(b => `${b.name} (${b.reason})`).join(' · '), '. They will appear in the list when rendering finishes.') : null,
      rows.length ? h('table', { class: 't', style: { marginTop: '10px' } },
        h('tr', {}, h('th', {}, 'Project'), h('th', {}, 'Status'), h('th', { class: 'num' }, 'Films'), h('th', { class: 'num' }, 'Leftovers · safe'), h('th', { class: 'num' }, 'Leftovers · deep'), h('th', { class: 'num' }, 'Total'), h('th', {})),
        rows.map(r => h('tr', {}, h('td', {}, r.name), h('td', {}, pill(r.status, PROJECT_STATUS_LABEL[r.status] || r.status)), h('td', { class: 'num' }, GB(r.film)), h('td', { class: 'num' }, GB(r.safe)), h('td', { class: 'num' }, GB(r.deep)), h('td', { class: 'num muted' }, GB(r.total)),
          h('td', { class: 'num' }, h('button', { class: 'ghost', title: '"Tidy up this project" on the project page', onclick: () => location.hash = '#/p/' + r.id }, 'Tidy up'))))) : null));
  const groups = {}; for (const c of d.candidates) (groups[c.rule] ||= []).push(c);
  const bar = h('div', { class: 'stickybar' }); const btn = h('button', { class: 'primary', 'data-clean': '1' }); const info = h('span', {});
  const askedBtn = h('button', { class: 'primary', 'data-clean': '1', onclick: () => runClean(d.candidates.filter(c => checked.has(c.id)), () => render()) });
  const upd = () => { const sel = d.candidates.filter(c => checked.has(c.id)), size = GB(sel.reduce((s, c) => s + FREED(c), 0)); info.textContent = `${sel.length} items selected · frees ${size}`; btn.textContent = 'Clean selected'; allBtn.textContent = `Clean render leftovers in all projects (${size})`; askedBtn.textContent = `Clean selected (${sel.length} · frees ${size})`; btn.dataset.empty = allBtn.dataset.empty = askedBtn.dataset.empty = sel.length ? '0' : '1'; lockCleanButtons(); document.querySelectorAll('[data-rule]').forEach(el => { const g = groups[el.dataset.rule]; el.querySelector('.size').textContent = `${GB(g.filter(c => checked.has(c.id)).reduce((s, c) => s + FREED(c), 0))} / ${GB(g.reduce((s, c) => s + FREED(c), 0))}`; el.querySelector('input').checked = g.every(c => checked.has(c.id)); el.querySelector('input').indeterminate = !el.querySelector('input').checked && g.some(c => checked.has(c.id)); }); };
  btn.onclick = () => runClean(d.candidates.filter(c => checked.has(c.id)), () => render());
  page.append(h('h2', {}, 'Detailed list'));
  if (!d.candidates.length) page.append(h('div', { class: 'empty' }, 'Nothing to clean.'));
  for (const [rule, items] of Object.entries(groups).sort((a, b) => b[1].reduce((s, c) => s + c.size, 0) - a[1].reduce((s, c) => s + c.size, 0))) {
    const list = h('div', { class: 'items', hidden: !items.some(isAsked) });
    for (const c of items.sort((a, b) => b.size - a.size)) list.append(h('label', { class: 'item' },
      h('input', { type: 'checkbox', checked: checked.has(c.id), 'data-id': c.id, onchange: e => { e.target.checked ? checked.add(c.id) : checked.delete(c.id); upd(); } }),
      h('div', {}, h('div', {}, h('b', {}, c.projectName), ' ', h('span', { class: 'ellip muted', title: c.path }, c.path.split(/[\\/]/).slice(-3).join('/'))), h('div', { class: 'why' }, c.reason)),
      sizeCell(c)));
    const head = h('header', { 'data-rule': rule },
      h('input', { type: 'checkbox', onclick: e => { e.stopPropagation(); const on = e.target.checked; for (const c of items) on ? checked.add(c.id) : checked.delete(c.id); list.querySelectorAll('input').forEach(i => i.checked = on); upd(); } }),
      h('b', {}, d.rules[rule] || rule), h('span', { class: 'muted' }, `${items.length} items`), items[0]?.action === 'archive' ? pill('published', 'to archive') : null,
      h('span', { class: 'size' }), h('span', { class: 'dim' }, icon('chev')));
    head.onclick = () => { list.hidden = !list.hidden; };
    page.append(h('div', { class: 'rule' }, head, list));
  }
  if (asked) {
    const sel = d.candidates.filter(isAsked), films = new Set(sel.map(c => c.project || c.projectName)).size, freed = sel.reduce((s, c) => s + FREED(c), 0);
    const per = {}; for (const c of sel) { const r = per[c.rule] ||= { count: 0, freed: 0 }; r.count++; r.freed += FREED(c); }
    askedBox.append(h('div', { class: 'panel lo-review' },
      h('div', { class: 'row' }, h('b', {}, sel.length ? headline({ freed, projects: films }) : 'No render leftovers right now.'), h('span', { class: 'spacer' }), sel.length ? askedBtn : null),
      sel.length ? h('div', { class: 'sub' }, `Selected below: ${ruleLine(per, lo?.labels)}. They go to the ${trashName()}; the films, their code and sound stay. Untick anything you want to keep.`) : null));
  }
  bar.append(info, h('span', { class: 'spacer' }), btn);
  $('#main').append(bar); upd();
  return () => { bar.remove(); stopFinished(); };
}
// "Films with leftovers": every film with something to free, most space first (Bin + archive; optional apart), a tick
// box per film. Finished films (approved / published / done / archived) and films that look finished (a final video,
// nothing changed for 7 days) are badged and ticked; the others can be ticked. One button opens one combined review;
// nothing moves before it. The hub counts the films in the background; this asks again until all are counted.
function finishedFilms(box) {
  let alive = true, timer = null, d = null;
  const picked = new Map();   // film id -> ticked (a choice survives the list being redrawn)
  const off = onHubEvent('finish-list', () => { if (alive) { clearTimeout(timer); load(); } });
  const LOOKS = 'Looks finished: a final video and no file changed for 7 days.';
  const frees = f => f.totals.remove.freed + f.totals.archive.freed;
  const ticked = f => picked.has(f.id) ? picked.get(f.id) : !!f.state;
  async function load() {
    try { d = await api('/api/finish'); } catch (e) { if (alive) box.replaceChildren(h('h2', {}, 'Films with leftovers'), h('div', { class: 'empty' }, 'Could not count the films: ' + e.message)); return; }
    if (!alive) return;
    draw();
    if (d.pending) timer = setTimeout(load, 2500);
  }
  function draw() {
    const rows = d.films;
    const btn = h('button', { class: 'primary', 'data-clean': '1' });
    const upd = () => {
      const sel = rows.filter(ticked), size = sel.reduce((s, f) => s + frees(f), 0);
      btn.replaceChildren(icon('broom', { cls: 'il' }), `Review and tidy ${sel.length} film${sel.length === 1 ? '' : 's'}… (${GB(size)})`);
      btn.dataset.empty = sel.length ? '0' : '1'; btn.disabled = !sel.length || cleanIsRunning();
    };
    btn.onclick = () => openFinishAll(rows.filter(ticked).map(f => ({ id: f.id, title: f.title })), { after: () => render() });
    const all = h('input', { type: 'checkbox', 'aria-label': 'Tick every film', onchange: e => { for (const f of rows) picked.set(f.id, e.target.checked); draw(); } });
    all.checked = rows.length > 0 && rows.every(ticked); all.indeterminate = !all.checked && rows.some(ticked);
    const badge = f => f.state === 'finished' ? pill(f.status, PROJECT_STATUS_LABEL[f.status] || f.status, STATUS_ICON[f.status]) : f.state === 'looks' ? h('span', { title: LOOKS }, pill('review', 'looks finished', 'clock')) : h('span', { class: 'dim' }, PROJECT_STATUS_LABEL[f.status] || f.status);
    box.replaceChildren(...[   // (replaceChildren prints null as text)
      h('div', { class: 'row fin-title' }, h('h2', {}, `Films with leftovers · ${rows.length}`), h('span', { class: 'spacer' }), btn),
      h('p', { class: 'sub' }, `What each film no longer needs: render leftovers, copies and test pictures go to the ${trashName()}, older versions to the archive. Code, inputs, voice-over, final mix and the newest video stay. Finished films are ticked; every ticked film is reviewed in one list before anything moves, and a film is marked approved once it was tidied.`),
      d.pending ? h('div', { class: 'sub fin-counting' }, icon('spin', { cls: 'spin il' }), `Counting the films… ${d.counted} of ${d.total}`) : null,
      !rows.length ? h('div', { class: 'empty' }, d.pending ? 'Counting…' : 'No film has leftovers.') :
        h('div', { class: 'panel fin-panel' }, h('table', { class: 't fin-table' },
          h('tr', {}, h('th', { class: 'fin-cb' }, all), h('th', {}, 'Film'), h('th', {}, 'State'), h('th', { class: 'num' }, `To the ${trashName()}`), h('th', { class: 'num' }, 'To the archive'), h('th', { class: 'num' }, 'Frees'), h('th', { class: 'num' }, 'Optional'), h('th', {})),
          rows.map(f => h('tr', { class: ticked(f) ? 'on' : '' },
            h('td', { class: 'fin-cb' }, h('input', { type: 'checkbox', checked: ticked(f), 'aria-label': 'Include ' + f.title, onchange: e => { picked.set(f.id, e.target.checked); e.target.closest('tr').classList.toggle('on', e.target.checked); upd(); all.checked = rows.every(ticked); all.indeterminate = !all.checked && rows.some(ticked); } })),
            h('td', {}, h('a', { href: '#/files/' + encodeURIComponent(f.id) }, f.title)),
            h('td', {}, badge(f)),
            h('td', { class: 'num' }, GB(f.totals.remove.size)), h('td', { class: 'num' }, GB(f.totals.archive.size)), h('td', { class: 'num' }, h('b', {}, GB(frees(f)))), h('td', { class: 'num muted' }, GB(f.totals.optional.size)),
            h('td', { class: 'num' }, h('button', { class: 'ghost sm', 'data-clean': '1', disabled: cleanIsRunning(), onclick: () => openFinishDialog(f.id, { after: () => render() }) }, 'Review…'))))))].filter(Boolean));
    upd();
  }
  box.append(h('h2', {}, 'Films with leftovers'), h('div', { class: 'empty' }, icon('spin', { cls: 'spin' }), ' Counting the films…'));
  load();
  return () => { alive = false; clearTimeout(timer); off(); };
}

// ---------- Settings
async function settingsPage(page) {
  const [c, gs] = await Promise.all([api('/api/config'), api('/api/guard/settings').catch(() => null)]);
  setSystemCapabilities(c.capabilities);
  page.append(h('div', { class: 'page-head' }, h('div', {}, h('h1', {}, 'Settings'), h('p', { class: 'sub' }, 'Settings for this computer.'))));
  // ---- render protection (RenderGuard runs in the background; the same panel is on the Renders page)
  if (gs) page.append(h('h2', {}, 'Render protection'), guardPanel(gs, { full: true }));
  // ---- projects removed from the list ("Remove from list"), with their folders untouched
  const hidden = await api('/api/hidden').catch(() => []);
  if (hidden.length) page.append(h('h2', {}, `Hidden projects (${hidden.length})`), h('div', { class: 'panel', style: { padding: '4px 6px' } }, h('table', { class: 't' },
    hidden.map(x => h('tr', {}, h('td', {}, h('b', {}, x.name)), h('td', { class: 'muted mono', style: { fontSize: '12px', wordBreak: 'break-all' } }, x.path), h('td', { class: 'num dim' }, AGO(x.at)),
      h('td', { class: 'num' }, h('button', { onclick: async () => { await api('/api/hidden/restore', { method: 'POST', body: { key: x.key } }); toast(`"${x.name}" restored to the list`); render(); } }, 'Restore')))))));
  const agentIn = h('input', { value: c.agentName || 'Claude', maxlength: '40' });
  page.append(h('h2', {}, 'Agent name'), h('p', { class: 'sub' }, 'The name shown on review buttons.'), agentIn);
  // [REASONIX PATCH] the provider picker; rendered only when the server returned an agent block (older test contexts skip it)
  const agentBox = (typeof agentSettings === 'function' && c.agent) ? agentSettings(c, { h, api, toast, confirmBox }) : null;
  if (agentBox) page.append(agentBox.el);
  // ---- the Now page's source; saved at once
  const actBox = h('input', { type: 'checkbox', checked: c.agentActivity !== false, onchange: async e => {
    const on = e.target.checked;
    try { await api('/api/config', { method: 'POST', body: { agentActivity: on } }); toast(on ? 'Agent activity is on' : 'Agent activity is off: agent folders are no longer read'); }
    catch (err) { e.target.checked = !on; toast('Could not save: ' + err.message, true); }
  } });
  page.append(h('h2', {}, 'Agent activity'), h('label', { class: 'check-row' }, actBox, h('span', {}, h('b', {}, 'Show agent activity'),
    h('span', { class: 'dim' }, ' · The Now page and the Skills page’s “used in” films read the session files Claude Code and Codex already write on this computer. It never asks an agent anything, costs no tokens, and nothing leaves this PC.'))));
  // ---- render leftovers: the banner's question (server/leftovers.js) and when old chunks count; saved at once
  const saveNow = async (patch, ok, undo) => { try { await api('/api/config', { method: 'POST', body: patch }); toast(ok); } catch (err) { undo(); toast('Could not save: ' + err.message, true); } };
  const askBox = h('input', { type: 'checkbox', checked: c.autoCleanPrompt !== false, onchange: e => { const on = e.target.checked; saveNow({ autoCleanPrompt: on }, on ? 'VideoHub will ask about render leftovers' : 'VideoHub will no longer ask about render leftovers', () => { e.target.checked = !on; }); } });
  const days = h('input', { type: 'number', min: '1', max: '365', step: '1', value: String(c.chunkDays || 7), style: { width: '76px' }, 'aria-label': 'Days without a render before chunks count as leftovers',
    onchange: e => { const v = Math.round(+e.target.value); if (!(v >= 1 && v <= 365)) { e.target.value = String(c.chunkDays || 7); return; } const was = c.chunkDays; c.chunkDays = v; saveNow({ chunkDays: v }, `Chunks count as leftovers after ${v} day${v === 1 ? '' : 's'} without a render`, () => { c.chunkDays = was; e.target.value = String(was || 7); }); } });
  page.append(h('h2', {}, 'Render leftovers'),
    h('label', { class: 'check-row' }, askBox, h('span', {}, h('b', {}, 'Ask about render leftovers'),
      h('span', { class: 'dim' }, ` · After a scan, after each finished render and every 6 hours, VideoHub looks for silent intermediate renders, copies the render script made, replaced chunks, temporary files and old chunks, and asks with a strip at the top of the window when they would free ${c.autoCleanMinMB ?? 500} MB or more. Nothing is moved until you click; files go to the ${trashName()}.`))),
    h('div', { class: 'row', style: { marginTop: '10px', gap: '8px', alignItems: 'center', flexWrap: 'wrap' } }, h('span', {}, 'Chunks of a film count as leftovers after'), days, h('span', {}, 'days without a render'),
      h('span', { class: 'dim', style: { fontSize: '12.5px' } }, '(the film stays and a full render still works; a partial re-render needs them)')));
  const roots = c.roots.map(r => ({ ...r }));
  const list = h('div', {});
  const draw = () => {
    list.innerHTML = '';
    list.append(h('div', { class: 'panel', style: { padding: '4px 6px' } }, h('table', { class: 't' },
      h('tr', {}, h('th', {}, 'Enabled'), h('th', {}, 'Folder'), h('th', {}, 'Type'), h('th', {})),
      roots.map((r, i) => h('tr', {},
        h('td', {}, h('input', { type: 'checkbox', checked: r.enabled !== false, onchange: e => { r.enabled = e.target.checked; } })),
        h('td', { class: 'mono' }, r.path, ' ', folderButton(() => r.path, (p) => { r.path = p; draw(); }, 'Choose a folder to watch', '')),
        h('td', {}, h('select', { onchange: e => { r.type = e.target.value; } }, [['container', 'contains project folders'], ['project', 'single project'], ['media', 'finished videos']].map(([v, t]) => h('option', { value: v, selected: r.type === v }, t)))),
        h('td', { class: 'num' }, h('button', { class: 'ghost danger', onclick: () => { roots.splice(i, 1); draw(); } }, 'Remove')))))));
  };
  draw();
  const addIn = h('input', { placeholder: 'Absolute path to a folder', style: { width: '420px' } });
  const addRoot = value => {
    const folder = value.trim(); if (!folder) return;
    if (roots.some(r => sameFolder(r.path, folder))) { toast('This folder is already in the list.'); return; }
    roots.push({ path: folder, type: 'container', enabled: true }); addIn.value = ''; draw(); toast('Added: click Save to keep your changes');
  };
  const arch = h('input', { value: c.archiveDir, style: { width: '420px' } });
  const par = h('select', {}, [1, 2].map(n => h('option', { value: n, selected: c.maxParallelRenders === n }, n === 1 ? 'One render at a time (recommended)' : `2 renders if ${Math.round(c.secondRenderMinFreeMB / 1024)} GB+ RAM is free`)));
  // the other folders VideoHub writes to or reads from (defaults under Documents\VideoHub)
  const dirField = (label, value, help) => { const inp = h('input', { value: value || '', placeholder: 'not set', style: { width: '420px' } }); return { inp, row: h('div', { class: 'row', style: { margin: '6px 0' } }, h('span', { style: { width: '220px' } }, label), inp, folderButton(() => inp.value.trim(), (p) => { inp.value = p; }, label), help ? h('span', { class: 'dim', style: { fontSize: '12px' } }, help) : null) }; };
  const dOut = dirField('Outputs folder', c.outputsDir, 'every render as a hard link, one folder per day');
  const dSnd = dirField('Sound library', c.soundLibDir, 'your music beds and effects for "Add sound"');
  const dStu = dirField('3D studio engine (optional)', c.studioDir, 'only for ready-made sound effects and studio scenes');
  const skipIn = h('input', { value: (c.skipFolders || []).join(', '), style: { width: '420px' } });
  const I = c.integrations || {};
  const okRow = (name, ok, text) => [h('div', { class: 'k' }, name), h('div', {}, ok ? h('span', { class: 'green' }, icon('check', { cls: 'il' })) : h('span', { class: 'muted' }, '— '), text)];
  page.append(h('h2', {}, 'Optional parts on this computer'), h('div', { class: 'panel kv' },
    okRow('ffmpeg', I.ffmpeg, I.ffmpeg ? 'found (frame pictures, previews, renders)' : 'not found — see README installation instructions for your system'),
    okRow('Browser for renders', !!I.browser, I.browser || 'no Chrome, Chromium or Edge found — renders need a native browser (Snap/Flatpak browsers are not supported)'),
    okRow('Render protection', true, c.capabilities?.cpuAffinity === false ? (c.capabilities.cpuLimitReason || 'CPU limit not available on this system') + '; priority and RAM protection remain available' : 'built in (CPU limit, low priority, RAM slow mode)'),
    okRow('Ready-made sound effects', I.sfx?.ok, I.sfx?.ok ? 'available' : I.sfx?.why || 'not available')));
  page.append(h('h2', {}, 'Workspace'), h('div', { class: 'sub' }, 'The folder chosen in setup: the default home of every folder below (films, outputs, sounds, archive). Each folder can still be changed on its own here.'),
    h('div', { class: 'row', style: { marginTop: '6px' } }, h('span', { class: 'mono' }, c.workspace || '—')),
    h('h2', {}, 'Render speed'), h('div', { class: 'sub' }, 'The encoder for films whose render script reads VIDEOHUB_ENCODER (every film made from the template). Automatic uses the graphics card when it can, with the same picture quality as the processor. Saved at once; the render dialog can still pick another one for a single render.'),
    h('div', { style: { marginTop: '6px' } }, renderSpeedControl(c)));
  page.append(h('h2', {}, 'Watched folders'), list,
    h('div', { class: 'row', style: { marginTop: '10px' } }, addIn, folderButton(() => addIn.value.trim(), addRoot, 'Choose a folder to watch', 'Choose folder…'), h('button', { onclick: () => addRoot(addIn.value) }, 'Add')),
    h('div', { class: 'sub', style: { marginTop: '8px' } }, 'Helper folders inside a watched folder that are never listed as projects (unless they have their own render script):'),
    h('div', { class: 'row', style: { marginTop: '4px' } }, skipIn),
    h('h2', {}, 'Archive folder'), h('div', { class: 'sub' }, 'Old versions are moved here instead of being deleted.'), h('div', { class: 'row', style: { marginTop: '6px' } }, arch, folderButton(() => arch.value.trim(), (p) => { arch.value = p; }, 'Choose archive folder')),
    h('h2', {}, 'Other folders'), h('div', { class: 'panel' }, dOut.row, dSnd.row, dStu.row),
    h('h2', {}, 'Render queue'), par,
    h('h2', {}, 'Tools'), h('div', { class: 'panel kv' }, Object.entries(c.tools).map(([k, v]) => [h('div', { class: 'k' }, k), h('div', { class: 'mono' }, v || h('span', { class: 'red' }, 'not found'))])),
    h('div', { class: 'row', style: { marginTop: '20px' } }, h('button', { class: 'primary', onclick: async () => {
      const v = (i) => i.inp.value.trim() || null;
      try {
        const agent = agentBox ? agentBox.values() : null;
        // [REASONIX PATCH] if the name is still one of the automatic ones, follow the selected provider
        const automatic = ['', 'Claude', 'Reasonix', 'DeepSeek', 'OpenCode'].includes(agentIn.value.trim());
        const name = automatic && agent ? agentBox.label() : agentIn.value;
        const saved = await api('/api/config', { method: 'POST', body: { agentName: name, roots, archiveDir: arch.value.trim(), maxParallelRenders: +par.value,
          ...(agent ? { agent } : {}),
          outputsDir: v(dOut), soundLibDir: v(dSnd), studioDir: v(dStu), skipFolders: skipIn.value.split(',').map(s => s.trim()).filter(Boolean) } });
        agentIn.value = setAgentName(saved.agentName); toast('Saved, rescanning…');
        agentBox?.refreshRuns();
      } catch (err) { toast('Could not save: ' + err.message, true); }
    } }, 'Save')),
  );
}

// One picker serves Settings and the render dialog; desktops without a native picker use a text field.
export function folderButton(getStart, onPick, title = 'Choose folder', label = 'Choose…') {
  const b = h('button', { type: 'button', class: 'ghost', title: 'Choose folder on this computer', onclick: async (e) => {
    e.preventDefault(); e.stopPropagation();
    const old = [...b.childNodes]; b.disabled = true; b.replaceChildren(...[].concat(ic('hourglass', 'dialog open…')));
    try {
      const r = await api('/api/pick-folder', { method: 'POST', body: { start: getStart() || null, title } });
      if (r?.unsupported) {
        const input = h('input', { type: 'text', value: getStart() || '', placeholder: 'Absolute folder path', style: { width: '100%' } });
        const ok = await confirmBox(title, h('div', {}, h('p', {}, 'No folder dialog is available on this desktop. Enter the folder path below.'), input), 'Use folder');
        if (ok && input.value.trim()) onPick(input.value.trim());
      } else if (typeof r?.path === 'string' && r.path) onPick(r.path);
    }
    catch (err) { toast('Could not open folder dialog: ' + err.message, true); }
    finally { b.disabled = false; b.replaceChildren(...old); }
  } }, ic('folder', label));
  return b;
}
