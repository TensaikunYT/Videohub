// The render-leftovers question (server/leftovers.js) as a strip under the top bar on every page:
//   "Render leftovers: 12.4 GB in 9 projects — Review · Clean now · Later"
// It stays until answered or until the leftovers are gone. Review opens the Cleanup page with exactly these items
// selected (this window then stops asking about this set); Clean now moves exactly them through the usual cleanup run
// (progress at the bottom right); Later keeps this set quiet for 24 h. Nothing moves without one of these clicks.
import { h, api, toast, GB, onHubEvent, startCleanRun, cleanIsRunning } from './app.js';
import { icon } from './icons.js';
import { shellBanner } from './shell.js';
import { trashName } from './system.js';

const REVIEWED = 'vh-leftovers-reviewed';
const session = { get: () => { try { return sessionStorage.getItem(REVIEWED); } catch { return null; } }, set: v => { try { sessionStorage.setItem(REVIEWED, v); } catch { } } };
let state = null, done = null, cleaningKey = null, started = false;

export const leftoversState = () => state;
// one line of what the set is made of, biggest first
export function ruleLine(perRule, labels = {}) {
  return Object.entries(perRule || {}).sort((a, b) => b[1].freed - a[1].freed).filter(([, r]) => r.freed > 0 || r.count)
    .map(([k, r]) => `${labels[k] || k} ${GB(r.freed)}`).join(' · ');
}
export const headline = p => `Render leftovers: ${GB(p.freed)} in ${p.projects} project${p.projects === 1 ? '' : 's'}`;

function draw() {
  const slot = shellBanner(); if (!slot) return;
  const p = state?.prompt;
  if (done) {
    const bin = trashName();
    slot.replaceChildren(h('div', { class: 'lo-bar done', role: 'status' }, icon('check'),
      h('div', { class: 'lo-text' }, h('b', {}, done.freed ? `Render leftovers cleaned · ${GB(done.freed)}` : 'Render leftovers cleaned'),
        h('span', { class: 'dim' }, `Moved to the ${bin}. Empty the ${bin} to free the space.${done.failed ? ` ${done.failed} item${done.failed === 1 ? '' : 's'} could not be moved (details at the bottom right).` : ''}`)),
      h('div', { class: 'lo-actions' }, h('button', { onclick: () => { done = null; draw(); } }, 'Close'))));
    return;
  }
  if (!p || session.get() === p.key || cleaningKey === p.key || cleanIsRunning()) { slot.replaceChildren(); return; }
  const busy = b => { for (const x of slot.querySelectorAll('button')) x.disabled = b; };
  const review = h('button', { title: 'Open the Cleanup page with exactly these items selected', onclick: () => {
    session.set(p.key); draw();
    if (location.hash === '#/disk/leftovers') location.reload(); else location.hash = '#/disk/leftovers';
  } }, 'Review');
  const now = h('button', { class: 'primary', title: `Move these ${p.count} items to the ${trashName()} now`, onclick: async () => {
    busy(true);
    try { cleaningKey = p.key; await startCleanRun('/api/leftovers/clean', { key: p.key }); draw(); }
    catch (e) { cleaningKey = null; busy(false); toast('Cleanup did not start: ' + e.message, true); refresh(); }
  } }, 'Clean now');
  const later = h('button', { class: 'ghost', title: 'Ask again in 24 hours (or sooner if more leftovers appear)', onclick: async () => {
    busy(true);
    try { state = await api('/api/leftovers/later', { method: 'POST', body: { key: p.key } }); draw(); }
    catch (e) { busy(false); toast(e.message, true); refresh(); }
  } }, 'Later');
  const detail = ruleLine(p.perRule, state.labels);
  slot.replaceChildren(h('div', { class: 'lo-bar', role: 'region', 'aria-label': 'Render leftovers' }, icon('broom'),
    h('div', { class: 'lo-text' }, h('b', {}, headline(p)),
      h('span', { class: 'dim', title: detail }, `${p.count} item${p.count === 1 ? '' : 's'} to the ${trashName()} · ${detail}`)),
    h('div', { class: 'lo-actions' }, review, now, later)));
}

async function refresh() {
  try { state = await api('/api/leftovers'); } catch { return; }
  draw();
}

// started once the first page is drawn (it never holds up the Films cards)
export function initLeftovers() {
  if (started) return; started = true;
  onHubEvent('leftovers', st => { if (st) { state = st; draw(); } });
  onHubEvent('clean', st => {
    if (!st) return;
    if (st.kind === 'leftovers' && st.state === 'done') {
      const rs = st.results || [];
      done = { freed: st.freed || 0, failed: rs.filter(r => r.status === 'error').length };
      cleaningKey = null; refresh();
    } else draw();
  });
  refresh();
}
