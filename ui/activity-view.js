// Plain helpers for the Now page, the rail count, the film cards and the film's agent pill. No DOM, no imports from
// app.js, so node tests can load them. The data is GET /api/activity / SSE 'activity' (server/activity.js).
export const STATE = {
  working: { label: 'Working', icon: 'spin' },
  waiting: { label: 'Waiting for you', icon: 'hand' },
  idle: { label: 'Finished', icon: 'moon' },
};
const RANK = { working: 0, waiting: 1, idle: 2 };

export const sessionsOf = data => (data?.enabled !== false && Array.isArray(data?.sessions) ? data.sessions : []);
export const workingCount = data => sessionsOf(data).filter(s => s.state === 'working').length;
export const workingFilms = data => new Set(sessionsOf(data).filter(s => s.state === 'working' && s.film).map(s => s.film.id));

// the Now page's sections; filmId narrows them to one film
export function groupSessions(data, filmId = null) {
  const list = sessionsOf(data).filter(s => !filmId || s.film?.id === filmId);
  const by = st => list.filter(s => s.state === st).sort((a, b) => (b.lastActivityAt || 0) - (a.lastActivityAt || 0));
  return { working: by('working'), waiting: by('waiting'), finished: by('idle') };
}
// the one session a film's pill shows: working before waiting before finished, then the most recent
export function filmSession(data, filmId) {
  const list = sessionsOf(data).filter(s => s.film?.id === filmId);
  list.sort((a, b) => (RANK[a.state] ?? 3) - (RANK[b.state] ?? 3) || (b.lastActivityAt || 0) - (a.lastActivityAt || 0));
  return list[0] || null;
}

export function durText(sec) {
  if (!Number.isFinite(sec) || sec < 0) return '';
  if (sec < 60) return Math.max(1, Math.round(sec)) + ' s';
  const m = Math.round(sec / 60);
  if (m < 60) return m + ' min';
  return Math.floor(m / 60) + ' h ' + String(m % 60).padStart(2, '0') + ' min';
}
export function agoText(at, now = Date.now()) {
  if (!at) return '';
  const d = (now - at) / 1000;
  if (d < 45) return 'just now';
  if (d < 3600) return Math.round(d / 60) + ' min ago';
  return Math.floor(d / 3600) + ' h ' + String(Math.round(d % 3600 / 60)).padStart(2, '0') + ' min ago';
}
export const stepText = step => step && step.total ? `${step.done} of ${step.total}` : '';
// where the agent is in its plan: the step in progress ("step 3 of 10"), or how many are done when none is
export const stepLabel = step => !step?.total ? '' : step.inProgress && step.current ? `step ${step.current} of ${step.total}` : `${step.done} of ${step.total} done`;
// elapsed time of the current turn, counted to now while it runs
export function elapsedOf(s, now = Date.now()) {
  if (!s.turnStartedAt) return null;
  if (s.state === 'working' || s.state === 'waiting' && !s.endedAt) return Math.max(0, (now - s.turnStartedAt) / 1000);
  return Number.isFinite(s.elapsedSec) ? s.elapsedSec : null;
}
// "about 20 min left": only when the server sent an estimate (working, at least 2 steps done); it counts down
export function estimateText(est, now = Date.now()) {
  if (!est || !est.estimate || !Number.isFinite(est.remainingSec)) return '';
  const left = est.remainingSec - Math.max(0, (now - (est.at || now)) / 1000);
  return left <= 60 ? 'almost done' : 'about ' + durText(left) + ' left';
}
// one sentence: what the session is doing (or did last)
export function doingText(s) {
  if (s.state === 'waiting' && s.hubWait) return 'Waiting for you in VideoHub: notes, answers or approvals';
  if (s.state === 'waiting') return s.step?.text ? `Needs your answer · ${s.step.text}` : `Needs your answer in ${s.agentName || 'the agent'}`;
  if (s.state === 'working') {
    if (s.step?.text) return s.step.text;
    if (s.helpers) return (s.helpers === 1 ? 'A helper agent is working' : `${s.helpers} helper agents are working`) + (s.helperTasks?.length ? ': ' + s.helperTasks.join(', ') : '');
    return s.lastAction?.text || 'Working';
  }
  return s.lastAction?.text ? 'Last: ' + s.lastAction.text : 'Finished';
}
// an icon for a last-action sentence (server/activity.js words them)
export function actionIcon(text = '') {
  const t = String(text).replace(/^Helper: /, '');
  return /^(Edited|Wrote|Created)/.test(t) ? 'pen' : /^Ran a /.test(t) ? 'code' : /^Loaded skill/.test(t) ? 'bolt' : /^Read /.test(t) ? 'file' : /live preview/.test(t) ? 'eye'
    : /render/i.test(t) ? 'renders' : /question|approve/.test(t) ? 'help' : /helper agent/.test(t) ? 'spark' : /browser|web/.test(t) ? 'search' : 'dot';
}
export const filesText = n => !n ? '' : n === 1 ? '1 file changed' : `${n} files changed`;
// the pill in a film's top bar
export function pillInfo(s) {
  if (!s) return null;
  const st = STATE[s.state] || STATE.idle;
  return { cls: s.state, name: s.agentName || 'Agent', label: s.state === 'idle' ? 'Finished' : st.label, icon: st.icon,
    title: `${s.agentName}: ${st.label.toLowerCase()} · ${s.title}${s.lastAction?.text ? ' · ' + s.lastAction.text : ''} · open Now` };
}
