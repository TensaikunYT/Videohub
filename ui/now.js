// The Now page (#/now, #/now/<film id>): agent sessions working, waiting for you and finished recently, and the
// render queue. Everything comes from the hub's passive reader of the agents' own session files (no tokens).
import { h, api, openProject, activityData, onActivity, onRenders } from './app.js';
import { icon, agentIcon } from './icons.js';
import { STATE, actionIcon, groupSessions, durText, agoText, stepText, stepLabel, elapsedOf, estimateText, doingText, filesText } from './activity-view.js';
import { nowRenders, remainingText, timeText, elapsedSeconds } from './render-status.js';

const PHASE = { prepare: 'Preparing', render: 'Drawing frames', validate: 'Checking chunks', concat: 'Joining video', audio: 'Adding audio', register: 'Saving output' };

export async function nowPage(page, filmId = null) {
  let data = activityData() || await api('/api/activity').catch(() => null);
  data = activityData() || data;   // the merged live-run activity may arrive while the request is in flight
  let renders = data?.renders || [];
  const sub = h('p', { class: 'sub' }, 'What your agents and renders are doing right now. Read from the session files the agents already write on this computer: no tokens, nothing leaves this PC.');
  const filmTitle = () => (data?.sessions || []).find(s => s.film?.id === filmId)?.film?.title || 'this film';
  const filter = filmId ? h('div', { class: 'now-filter' }) : null;
  page.append(h('div', { class: 'page-head' }, h('div', {}, h('h1', {}, 'Now'), sub)));
  if (filter) page.append(filter);   // (append(null) would print "null")
  const body = h('div', { class: 'now' }), rendersBox = h('div', { class: 'queue' });
  page.append(body);

  function draw() {
    const now = Date.now();
    if (filter) filter.replaceChildren(icon('films'), h('span', {}, 'Showing ', h('b', {}, filmTitle())), h('a', { href: '#/now', class: 'btn ghost sm' }, icon('x'), 'Show all'));
    body.replaceChildren();
    if (data && data.enabled === false) {
      body.append(h('div', { class: 'panel now-off' }, icon('eyeoff'), h('div', {}, h('b', {}, 'Agent activity is off.'), ' VideoHub does not read the agents’ session files. ', h('a', { href: '#/settings' }, 'Turn it on in Settings'), '.')));
    } else if (!data) {
      body.append(h('div', { class: 'empty' }, 'Could not read agent activity.'));
    } else {
      const g = groupSessions(data, filmId), hours = data.windowHours || 3;
      const any = g.working.length + g.waiting.length + g.finished.length;
      if (!any) body.append(data.ready === false ? h('div', { class: 'panel now-empty' }, h('div', { class: 'ne-icon' }, icon('spin', { cls: 'spin' })), h('div', {}, h('b', {}, 'Reading the agents’ session files…'), h('p', {}, 'The first look after VideoHub starts can take a few seconds.'))) : emptyState(filmId, hours));
      const section = (title, list, hint) => list.length ? [h('h2', {}, title, h('span', { class: 'count' }, String(list.length)), hint ? h('span', { class: 'h2-hint' }, hint) : null), h('div', { class: 'now-grid' }, list.map(s => card(s, now)))] : [];
      body.append(...section('Working', g.working), ...section('Waiting for you', g.waiting, 'Answer in VideoHub or in the agent’s own window'), ...section('Finished recently', g.finished, `last ${hours} h`));
      const off = (data.unsupported || []).filter(u => !u.supported).map(u => u.agent === 'opencode' ? 'OpenCode' : u.agent);
      if (off.length) body.append(h('p', { class: 'dim now-foot' }, `${off.join(', ')} sessions are not shown yet.`));
    }
    const rs = renders.filter(r => !filmId || r.project === filmId);
    body.append(h('h2', {}, 'Renders', rs.length ? h('span', { class: 'count' }, String(rs.length)) : null, h('span', { class: 'spacer' }), h('a', { href: '#/renders', class: 'h2-link' }, 'Render queue →')), rendersBox);
    drawRenders(now);
  }
  function drawRenders(now = Date.now()) {
    const rs = renders.filter(r => !filmId || r.project === filmId);
    rendersBox.replaceChildren(...(rs.length ? rs.map(r => renderRow(r, now)) : [h('div', { class: 'empty' }, 'No renders are running or waiting.')]));
  }
  draw();
  const offA = onActivity(d => { data = d; if (d?.renders && !renders.length) renders = d.renders; draw(); });
  const offR = onRenders(d => { if (d) { renders = nowRenders(d); drawRenders(); } });
  // times tick on the page; the hub only sends real changes
  const clock = setInterval(() => { if (document.activeElement?.closest?.('.now')) return; draw(); }, 5000);
  return () => { offA(); offR(); clearInterval(clock); };
}

function emptyState(filmId, hours) {
  return h('div', { class: 'panel now-empty' }, h('div', { class: 'ne-icon' }, icon('pulse')),
    h('div', {}, h('b', {}, filmId ? `No agent session worked on this film in the last ${hours} hours.` : 'Nothing is running right now.'),
      h('p', {}, 'When Claude Code or Codex works on a film, it appears here: what it is doing, its steps (“4 of 7”), how long it has been working, its last action and the skills it loaded. Renders show their progress and time left.'),
      h('p', { class: 'dim' }, 'VideoHub only reads the session files the agents already write on this computer. It never asks an agent anything, so it costs no tokens, and nothing leaves this PC.')));
}

function card(s, now) {
  const st = STATE[s.state] || STATE.idle;
  const ended = s.state !== 'working' && !!s.endedAt;   // (a session whose helper agents work counts as running)
  const elapsed = elapsedOf(s, now), est = s.state === 'working' ? estimateText(s.estimate, now) : '';
  const filmLink = s.film ? h('a', { href: '#/review/' + encodeURIComponent(s.film.id) + '/~live', title: 'Open this film', onclick: e => { e.preventDefault(); openProject({ id: s.film.id, outputsCount: s.film.outputs, latest: s.film.latest }); } }, icon('films'), s.film.title) : h('span', { class: 'dim' }, 'No film');
  const folder = s.cwd ? s.cwd.split(/[\\/]/).filter(Boolean).pop() : '';
  const steps = s.step && s.step.total ? h('div', { class: 'bar', title: stepText(s.step) + ' steps done' }, h('i', { style: { width: Math.round(100 * s.step.done / s.step.total) + '%' } })) : null;
  return h('article', { class: 'now-card ' + s.state, 'data-session': s.id },
    h('header', { class: 'nc-head' },
      h('span', { class: 'nc-agent' }, agentIcon(s.agent, 15), s.agentName),
      h('span', { class: 'nc-state ' + s.state }, icon(st.icon, { cls: s.state === 'working' ? 'spin' : '' }), st.label),
      h('span', { class: 'spacer' }),
      s.lastActivityAt ? h('time', { title: new Date(s.lastActivityAt).toLocaleString('en-US') }, agoText(s.lastActivityAt, now)) : null),
    h('h3', { class: 'nc-title', title: s.title }, s.title),
    h('div', { class: 'nc-film' }, filmLink, folder ? h('span', { class: 'mono dim', title: s.cwd }, folder) : null),
    h('div', { class: 'ag-now ' + s.state }, h('div', { class: 'k' }, s.state === 'idle' ? 'Done' : s.state === 'waiting' ? 'Waiting' : 'Doing now', s.step?.total ? h('em', {}, stepLabel(s.step)) : null), h('p', {}, doingText(s)), steps),
    h('div', { class: 'nc-stats' },
      s.step?.total ? h('span', { title: 'Steps done in the agent’s plan' }, icon('check'), stepText(s.step) + ' done') : null,
      elapsed != null ? h('span', { title: ended ? 'How long the last request took' : 'Time since your last request to the agent' }, icon('clock'), (ended ? 'took ' : '') + durText(elapsed)) : null,
      est ? h('span', { class: 'est', title: s.estimate.basis ? 'Estimate from the pace so far: ' + s.estimate.basis : 'Estimate from the pace so far' }, icon('hourglass'), est, h('small', {}, 'estimate')) : null),
    s.lastAction ? h('div', { class: 'nc-last', title: 'Last action' }, icon(actionIcon(s.lastAction.text)), h('span', { class: 'nc-last-t', title: s.lastAction.text }, s.lastAction.text), h('time', {}, agoText(s.lastAction.at, now))) : null,
    (s.skills?.length || s.filesChanged || s.helpers) ? h('div', { class: 'nc-chips' },
      (s.skills || []).map(k => h('a', { class: 'skill-chip sm', href: '#/skills/' + encodeURIComponent(s.agent) + '/' + encodeURIComponent(String(k).replace(/^[\w.-]+:/, '')), title: 'Skill used in this session · open it on the Skills page' }, icon('bolt'), k)),
      s.filesChanged ? h('span', { class: 'nc-chip' }, icon('file'), filesText(s.filesChanged)) : null,
      s.helpers ? h('span', { class: 'nc-chip', title: (s.helperTasks || []).join(', ') }, icon('spark'), s.helpers === 1 ? '1 helper agent' : s.helpers + ' helper agents') : null) : null);
}

function renderRow(r, now) {
  const pct = r.progress != null ? Math.max(0, Math.min(100, Math.round(r.progress * 100))) : null;
  const state = r.state === 'queued' ? (r.needsApproval ? 'Needs your approval' : 'Waiting in queue' + (r.position ? ` (${r.position})` : '')) : r.state === 'paused' ? 'Paused' : (PHASE[r.phase] || 'Rendering') + (r.slow ? ' · slowed' : '');
  const el = elapsedSeconds(r, now);
  const left = remainingText(r, now);
  return h('div', { class: 'qrow ' + r.state },
    h('div', { class: 'q-ic' }, icon(r.state === 'queued' ? 'hourglass' : r.state === 'paused' ? 'pause' : 'renders')),
    h('div', {}, h('div', { class: 'q-name' }, r.project ? h('a', { href: '#/p/' + encodeURIComponent(r.project) }, r.name) : r.name), h('div', { class: 'q-sub' }, h('span', {}, state), el != null ? h('span', {}, 'running ' + timeText(el)) : null)),
    h('div', { class: 'q-prog' }, h('div', { class: 'q-bar' }, h('i', { style: { width: (pct ?? 0) + '%' } })), h('span', {}, h('b', {}, pct != null ? pct + '%' : '—'), h('span', { title: r.etaSource === 'rate' ? 'Estimated from the progress made so far' : 'From the render’s own progress' }, left))));
}
