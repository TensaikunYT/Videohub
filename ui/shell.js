// The app frame: a slim left rail (global pages + the film you have open) and a top bar (the page or film you are on,
// the film's tabs, page actions, render protection). Pages fill only the top bar's slots; the router sets the rest.
// No imports from app.js (the shell is built while app.js is still loading).
import { icon, ic, logo, agentIcon } from './icons.js';
import { filmSession, pillInfo, workingCount, STATE } from './activity-view.js';
import { agentName } from './agent.js';
import { needCount, agentWaiting, planWaiting } from './channel-view.js';
import { createDrawer } from './drawer.js';

const el = (tag, cls, attrs = {}, ...kids) => {
  const e = document.createElement(tag); if (cls) e.className = cls;
  for (const [k, v] of Object.entries(attrs)) if (v != null && v !== false) e.setAttribute(k, v === true ? '' : v);
  for (const k of kids.flat()) if (k != null && k !== false) e.append(k);
  return e;
};
const store = {
  get(k) { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch { return null; } },
  set(k, v) { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, JSON.stringify(v)); } catch { } },
};

// rail entries: only pages that work today
const NAV = [
  ['projects', '#/', 'films', 'Films', 'All your films'],
  ['now', '#/now', 'pulse', 'Now', 'What your agents and renders are doing now'],
  ['skills', '#/skills', 'book', 'Skills', 'The skills your agents use: their files and the films that used them'],
  ['renders', '#/renders', 'renders', 'Renders', 'Render queue and recent outputs'],
  ['disk', '#/disk', 'broom', 'Cleanup', 'Disk space and render leftovers'],
];
const PAGE_TITLE = { projects: 'Films', now: 'Now', skills: 'Skills', renders: 'Renders', outputs: 'Recent renders', disk: 'Cleanup', settings: 'Settings' };

let banner = null, railFilm = null, railSep = null, tbLeft = null, tbTabs = null, tbFilmLinks = null, tbActions = null, film = null, agentPill = null, activity = null;
// the open film's agent channel (GET /api/project/:id/channel: plan, questions, hub_wait) and who listens to it
let chan = null, chanFor = null, chanTimer = 0, filmTab = 'review', filmReview = null, drawer = null;
const chanSubs = new Set();

export function initShell() {
  const rail = document.querySelector('#rail'), top = document.querySelector('#topbar');
  rail.replaceChildren(
    el('a', 'rail-logo', { href: '#/', title: 'VideoHub' }, logo(34)),
    ...NAV.map(([key, href, ic0, label, tip]) => {
      const a = el('a', 'rail-btn', { href, 'data-nav': key, title: tip }, icon(ic0), el('span', '', {}, label));
      if (key === 'projects') a.append(el('b', 'rail-badge new', { id: 'newOutP', hidden: true }));
      if (key === 'now') a.append(el('b', 'rail-badge info', { id: 'nowCount', hidden: true, title: 'Agent sessions working now' }));
      if (key === 'renders') a.append(el('b', 'rail-badge info', { id: 'renderCount', hidden: true, title: 'Renders running now' }), el('b', 'rail-badge new low', { id: 'newOutR', hidden: true }));
      return a;
    }),
    railSep = el('div', 'rail-sep', { hidden: true }),
    railFilm = el('a', 'rail-btn rail-film', { 'data-nav': 'film', hidden: true }),
    el('div', 'rail-fill'),
    el('a', 'rail-btn', { href: '#/settings', 'data-nav': 'settings', title: 'Settings' }, icon('settings'), el('span', '', {}, 'Settings')),
  );
  tbLeft = el('div', 'tb-left'); tbTabs = el('nav', 'tabs', { 'aria-label': 'Film', hidden: true }); tbFilmLinks = el('div', 'tb-filmlinks'); tbActions = el('div', 'tb-actions');
  agentPill = el('button', 'agent-pill', { type: 'button', hidden: true, 'aria-haspopup': 'dialog', 'aria-expanded': 'false' });
  drawer = createDrawer({ onClose: () => { agentPill.setAttribute('aria-expanded', 'false'); agentPill.classList.remove('open'); } });
  agentPill.addEventListener('click', () => { if (drawer.isOpen()) drawer.hide(); else openAgentDrawer(); });
  top.replaceChildren(tbLeft, tbTabs, tbFilmLinks, el('div', 'spacer'), agentPill,
    el('a', 'tb-live', { id: 'live', href: '#/renders', title: 'Render protection · open Renders' }), tbActions);
  // a strip under the top bar on every page for things that wait for the user (the render-leftovers question,
  // ui/leftovers.js); empty, it takes no room
  banner = el('div', 'vh-banner', { role: 'region', 'aria-label': 'Notices' });
  top.after(banner);
  drawRailFilm(store.get('vh-film'));
}
export const shellBanner = () => banner;

// the router: which rail entry is lit, and a plain page title until a film page says more
export function shellRoute(name, args) {
  const filmRoute = name === 'p' || name === 'review' || name === 'files' || name === 'plan';
  const key = filmRoute ? 'film' : name === 'outputs' ? 'renders' : PAGE_TITLE[name] ? name : 'projects';
  document.querySelectorAll('.rail [data-nav]').forEach(a => a.classList.toggle('on', a.dataset.nav === key));
  tbActions.replaceChildren(); tbFilmLinks.replaceChildren(); tbTabs.replaceChildren(); tbTabs.hidden = true; film = null; drawPill();
  if (!filmRoute || chanFor !== args[0]) { chan = null; chanFor = null; drawer?.hide(); }
  if (filmRoute) {
    const known = store.get('vh-film');
    tbLeft.replaceChildren(filmTitle(known && known.id === args[0] ? known.title : '…', ''));
  } else tbLeft.replaceChildren(el('div', 'tb-page', {}, PAGE_TITLE[name] || 'Films'));
}

// (no cover picture here: a film without a cached cover would only print a 404 in the console)
function filmTitle(title, meta) {
  const box = el('a', 'tb-film', { href: '#/', title: 'All films' });
  const pic = el('span', 'tb-thumb', {}, icon('video'));
  box.append(pic, el('div', 'tb-film-text', {}, el('div', 'tb-title', {}, title), meta ? el('div', 'tb-meta', {}, ...[].concat(meta).filter(Boolean).map(m => el('span', '', {}, m))) : null));
  return box;
}
// A film page (Review, Files or the film's details) fills the top bar: the film, its tabs, its actions.
// opts: { tab: 'review' | 'plan' | 'files' | 'details', meta: [..strings / nodes], live: bool, review: () => void, actions: [nodes] }
export function shellFilm(p, { tab = 'review', meta = [], live = false, review = null, actions = [] } = {}) {
  film = p; filmTab = tab; filmReview = review;
  const title = p.title || p.name || 'Film';
  const live0 = live ? el('span', 'tb-livetag', {}, icon('dot'), 'Live from code') : null;
  tbLeft.replaceChildren(filmTitle(title, [live0, ...meta]));
  drawTabs(); tbTabs.hidden = false;
  if (chanFor !== p.id) { chan = null; chanFor = p.id; }
  loadChannel();
  const details = el('a', 'btn ghost sm tb-details' + (tab === 'details' ? ' on' : ''), { href: '#/p/' + p.id, title: 'Versions, notes list, status, disk and folder of this film' }, ...[].concat(ic('info', 'Film details')));
  tbFilmLinks.replaceChildren(details); tbActions.replaceChildren(...actions.filter(Boolean));
  // remember it for the rail: the last film route you were on
  const entry = { id: p.id, title, hash: tab !== 'details' ? location.hash : (store.get('vh-film')?.id === p.id ? store.get('vh-film').hash : location.hash), notes: p.notesOpen || 0 };
  store.set('vh-film', entry); drawRailFilm(entry); drawPill();
  document.querySelectorAll('.rail [data-nav]').forEach(a => a.classList.toggle('on', a.dataset.nav === 'film'));
}
// Review / Plan (when the film has a plan) / Files
function drawTabs() {
  if (!film) return;
  const p = film, tab = filmTab, keepFiles = tbTabs.querySelector('#tabCountFiles');
  const reviewTab = el('button', 'tab' + (tab === 'review' ? ' on' : ''), { type: 'button', title: 'Watch the film and leave notes' }, icon('eye'), 'Review');
  reviewTab.addEventListener('click', () => { if (tab !== 'review') filmReview?.(); });
  const planTab = chan?.plan || tab === 'plan' ? el('a', 'tab' + (tab === 'plan' ? ' on' : ''), { href: '#/plan/' + encodeURIComponent(p.id), title: 'The agent’s plan: scenes to approve or comment on' }, icon('plan'), 'Plan',
    planWaiting(chan) ? el('b', 'tab-count ask', { title: `Plan v${chan.plan.v} waits for your approval` }, 'OK?') : null) : null;
  const filesTab = el('a', 'tab' + (tab === 'files' ? ' on' : ''), { href: '#/files/' + encodeURIComponent(p.id), title: 'The film’s files: source, sound, images, renders and leftovers' }, icon('folder'), 'Files', keepFiles || el('b', 'tab-count', { id: 'tabCountFiles', hidden: true }));
  tbTabs.replaceChildren(...[reviewTab, planTab, filesTab].filter(Boolean));
}
// ---------- the agent channel of the open film
async function loadChannel() {
  const id = chanFor; if (!id) return;
  try {
    const r = await fetch('/api/project/' + encodeURIComponent(id) + '/channel');
    if (!r.ok || chanFor !== id) return;
    chan = await r.json();
  } catch { return; }
  drawTabs(); drawPill(); drawDrawer();
  for (const f of chanSubs) try { f(chan); } catch { }
}
// SSE 'channel' (app.js): the open film's plan, questions, inbox or waiting agent changed
export function shellChannel(ev) {
  if (!ev || ev.project !== chanFor) return;
  clearTimeout(chanTimer); chanTimer = setTimeout(loadChannel, 120);
}
export const filmChannel = () => chan;
export function onFilmChannel(fn) { chanSubs.add(fn); return () => chanSubs.delete(fn); }
export const refreshChannel = () => loadChannel();
export function openAgentDrawer() {
  if (!film || !drawer) return;
  agentPill.setAttribute('aria-expanded', 'true'); agentPill.classList.add('open');
  drawer.show(agentPill); drawDrawer();
}
function drawDrawer() { if (drawer && film) drawer.draw({ film: { id: film.id, title: film.title || film.name }, session: filmSession(activity, film.id), chan }); }

// the Files tab's count of recently changed files (0 hides it)
export function shellTabCount(n, title = '') { const c = document.querySelector('#tabCountFiles'); if (c) { c.hidden = !n; c.textContent = n ? String(n) : ''; c.title = title; } }
export function shellActions(...nodes) { tbActions.append(...nodes.flat().filter(Boolean)); }
export function forgetFilm(id) { const f = store.get('vh-film'); if (f && f.id === id) { store.set('vh-film', null); drawRailFilm(null); } }

// the agent activity (GET /api/activity, SSE 'activity'): the rail count and the open film's agent pill
export function shellActivity(data) {
  activity = data;
  const c = document.querySelector('#nowCount'), n = workingCount(data);
  if (c) { c.hidden = !n; c.textContent = n ? String(n) : ''; c.title = n ? `${n} agent session${n === 1 ? '' : 's'} working now` : ''; }
  drawPill(); drawDrawer();
}
// shown when a session touched this film or the film has a plan, a question or a waiting agent; a click opens the drawer
function drawPill() {
  if (!agentPill) return;
  const s = film ? filmSession(activity, film.id) : null, info = pillInfo(s);
  const waiting = agentWaiting(chan), need = needCount(chan);
  if (!film || (!info && !waiting && !chan?.plan && !(chan?.questions || []).length)) { agentPill.hidden = true; return; }
  agentPill.hidden = false;
  const st = waiting ? 'waiting' : info ? info.cls : 'idle';
  const name = s?.agentName || chan?.waiting?.agent || agentName();
  const label = waiting ? 'Waiting for you' : need && (!info || info.cls !== 'working') ? 'Needs you' : info ? info.label : 'Agent';
  agentPill.className = 'agent-pill ' + st + (drawer?.isOpen() ? ' open' : '');
  agentPill.title = (info ? info.title.replace(/ · open Now$/, '') : name) + (waiting ? ' · waiting for you in VideoHub' : '') + (need ? ` · ${need} thing${need === 1 ? '' : 's'} for you` : '') + ' · open the agent drawer';
  agentPill.setAttribute('aria-label', `${name}: ${label}${need ? `, ${need} waiting for you` : ''}. Open the agent drawer.`);
  agentPill.replaceChildren(...[el('span', 'ap-icon', {}, icon(waiting ? 'hand' : info ? info.icon : STATE.idle.icon)), el('span', 'ap-text', {}, el('b', '', {}, agentIcon(s?.agent || 'claude', 11), name), el('span', '', {}, label)),
    need ? el('b', 'ap-count', { title: `${need} thing${need === 1 ? '' : 's'} waiting for you` }, String(need)) : null].filter(Boolean));
}

function drawRailFilm(f) {
  if (!railFilm) return;
  railFilm.hidden = !f; if (railSep) railSep.hidden = !f;
  if (!f) return;
  railFilm.href = f.hash || '#/p/' + f.id;
  railFilm.title = f.title + ' · open again';
  const pic = el('span', 'rail-thumb', {}, icon('video'));
  const short = f.title.length > 9 ? f.title.slice(0, 8) + '…' : f.title;
  railFilm.replaceChildren(...[pic, el('span', '', {}, short), f.notes ? el('b', 'rail-badge', { title: f.notes + ' open notes' }, String(f.notes)) : null].filter(Boolean));
}
