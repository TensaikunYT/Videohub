// The agent drawer: opens from the film's agent pill (top bar) over any film page. What the agent is doing (read from
// its own session files, server/activity.js), its open questions as cards answered by click (hub_ask), the plan's
// state with a way to the Plan tab, and "waiting for you" while hub_wait is open (server/channel.js).
// No imports from app.js: the shell builds this while app.js is still loading.
import { icon, agentIcon } from './icons.js';
import { agentName } from './agent.js';
import { STATE, doingText, stepLabel, agoText, durText, elapsedOf } from './activity-view.js';
import { openQuestions, planTitle, planWaiting, itemText, planCounts } from './channel-view.js';

const el = (tag, cls, attrs = {}, ...kids) => {
  const e = document.createElement(tag); if (cls) e.className = cls;
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v === true ? '' : v);
  }
  for (const k of kids.flat()) if (k != null && k !== false) e.append(k);
  return e;
};
async function post(url, body) {
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || r.statusText);
  return j;
}
const enc = encodeURIComponent;
const sinceText = at => { const t = agoText(at); return t === 'just now' ? 'just now' : t.replace(/ ago$/, ''); };

export function createDrawer({ onClose = () => { } } = {}) {
  const scrim = el('div', 'scrim', { hidden: true });
  const sub = el('span', 'sh-sub');
  const closeBtn = el('button', 'icon-btn ghost', { type: 'button', title: 'Close (Esc)', 'aria-label': 'Close' }, icon('x'));
  const body = el('div', 'dr-body');
  const drawer = el('aside', 'drawer', { role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Agent', tabindex: '-1', hidden: true },
    el('header', 'dr-head', {}, icon('spark'), el('h3', '', {}, 'Agent'), sub, el('div', 'spacer'), closeBtn), body);
  document.body.append(scrim, drawer);

  let open = false, back = null, last = null, hideTimer = 0;
  const picks = new Map();   // question id → { option, text } while the user is choosing (survives redraws)
  const busy = new Set();

  function show(returnTo) {
    if (open) return;
    open = true; back = returnTo || document.activeElement;
    clearTimeout(hideTimer); scrim.hidden = false; drawer.hidden = false;
    requestAnimationFrame(() => { scrim.classList.add('on'); drawer.classList.add('open'); });
    draw(last);
    setTimeout(() => { if (open) (drawer.querySelector('.q-opt, .qcard textarea, .dr-body a, .dr-body button') || drawer).focus(); }, 40);
  }
  function hide() {
    if (!open) return;
    open = false; scrim.classList.remove('on'); drawer.classList.remove('open');
    hideTimer = setTimeout(() => { if (!open) { scrim.hidden = true; drawer.hidden = true; } }, 220);
    if (back && back.isConnected && back.focus) back.focus();
    onClose();
  }
  scrim.addEventListener('click', hide);
  closeBtn.addEventListener('click', hide);
  // Esc closes; Tab stays inside while open (capture: the review page's own keys do not see these)
  document.addEventListener('keydown', e => {
    if (!open) return;
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); hide(); return; }
    if (e.key === 'Tab') {
      const f = [...drawer.querySelectorAll('button, a[href], textarea, input, [tabindex="0"]')].filter(x => !x.disabled && x.offsetParent !== null);
      if (!f.length) { e.preventDefault(); return; }
      const first = f[0], lastEl = f[f.length - 1];
      if (!drawer.contains(document.activeElement)) { e.preventDefault(); first.focus(); }
      else if (e.shiftKey && document.activeElement === first) { e.preventDefault(); lastEl.focus(); }
      else if (!e.shiftKey && document.activeElement === lastEl) { e.preventDefault(); first.focus(); }
      e.stopPropagation();
    } else if (drawer.contains(document.activeElement)) e.stopPropagation();   // typing in a card is not a review shortcut
  }, true);

  // ---------- content
  function draw(state) {
    last = state;
    if (!open || !state) return;
    // never rebuild under the user's typing: the text is kept in `picks`, the box is refreshed when they leave it
    if (drawer.contains(document.activeElement) && document.activeElement.matches('textarea')) return;
    const { film, session: s, chan } = state, now = Date.now();
    const waiting = chan?.waiting, st = waiting ? 'waiting' : s?.state || 'idle', meta = STATE[st] || STATE.idle;
    const name = s?.agentName || waiting?.agent || agentName();
    sub.textContent = s?.title ? s.title : film?.title || '';
    const stateText = waiting ? 'Waiting for you in VideoHub' : s ? (st === 'idle' ? 'Finished' : meta.label) : 'Not seen in the last hours';
    const since = waiting ? waiting.since : s?.lastActivityAt;
    const kids = [];
    kids.push(el('div', 'ag-top', {}, el('div', 'ag-who', {},
      el('div', 'ag-avatar ' + st, {}, agentIcon(s?.agent || 'claude', 22)),
      el('div', '', {}, el('div', 'ag-name', {}, name), el('div', 'ag-state ' + st, {}, icon(meta.icon), stateText, since ? el('span', 'since', {}, ' · ' + sinceText(since)) : null)))));
    if (s?.skills?.length || film) kids.push(el('div', 'ag-skill-row', {},
      s?.skills?.length ? [el('span', 'k', {}, 'Skill'), ...s.skills.slice(0, 4).map(k => el('a', 'skill-chip', { href: `#/skills/${enc(s.agent)}/${enc(String(k).replace(/^[\w.-]+:/, ''))}`, title: 'Open this skill on the Skills page' }, icon('bolt'), k))] : null,
      film ? [el('span', 'k', {}, 'Film'), el('span', 'ag-film', {}, film.title || film.id)] : null));
    // doing now / needs you
    const qs = openQuestions(chan);
    const doing = waiting
      ? (qs.length ? `${name} is waiting for your answer${qs.length > 1 ? 's' : ''} below.` : planWaiting(chan) ? `${name} is waiting for your OK on the plan, or for your notes.` : `${name} is waiting for your notes: leave them on the frames and press “Send to ${agentName()}”.`)
      : s ? (s.hubWait ? 'Waiting for you in VideoHub' : doingText(s))
      : qs.length || planWaiting(chan) ? `${name} left ${[qs.length ? (qs.length === 1 ? 'a question' : qs.length + ' questions') : '', planWaiting(chan) ? 'a plan to approve' : ''].filter(Boolean).join(' and ')} for you. It reads your answers the next time it checks VideoHub.`
      : `No session of ${name} touched this film in the last hours.`;
    const elapsed = s ? elapsedOf(s, now) : null;
    kids.push(el('div', 'ag-now ' + st, {},
      el('div', 'k', {}, waiting ? 'Needs you' : st === 'working' ? 'Doing now' : 'Status', s?.step?.total ? el('em', '', {}, stepLabel(s.step)) : elapsed != null && st === 'working' ? el('em', '', {}, durText(elapsed)) : null),
      el('p', '', {}, doing),
      s?.step?.total && st !== 'idle' ? el('div', 'bar', {}, Object.assign(el('i'), { style: `width:${Math.round(100 * s.step.done / s.step.total)}%` })) : null));
    // questions
    const answered = (chan?.questions || []).filter(q => q.state === 'answered').slice(0, 3);
    if (qs.length || answered.length) kids.push(el('div', 'ag-question', {}, ...qs.map(q => questionCard(film, q)), ...answered.map(q => answeredCard(q))));
    // plan
    if (chan?.plan) {
      const c = planCounts(chan.plan);
      kids.push(el('div', 'ag-plan', {},
        el('div', 'ag-plan-top', {}, icon('plan'), el('b', '', {}, planTitle(chan.plan)), el('span', 'spacer'),
          el('a', 'btn sm', { href: '#/plan/' + enc(film.id) }, 'Open the Plan tab', icon('chevr'))),
        el('div', 'plan-counts', {},
          planWaiting(chan) ? el('span', 'wait-chip', {}, icon('hand'), 'Waiting for your approval') : el('span', 'ok-chip', {}, icon('approved'), 'Approved by you'),
          ...['approved', 'ready', 'changes'].filter(k => c[k]).map(k => el('span', '', {}, `${c[k]} ${k === 'changes' ? 'change requested' : k}`)))));
    }
    // steps (the agent's own todo list)
    if (s?.steps?.length) kids.push(el('div', 'ag-block', {}, el('h4', '', {}, 'Steps'), el('ol', 'steps' + (st === 'working' ? ' working' : ''), {},
      ...s.steps.map(x => el('li', x.status === 'completed' ? 'done' : x.status === 'in_progress' ? 'cur' : 'next', {},
        el('span', 'dot', {}, icon(x.status === 'completed' ? 'check' : x.status === 'in_progress' ? (st === 'working' ? 'spin' : 'hand') : 'dot')), el('span', 'st-t', {}, x.text))))));
    // recent actions: the agent's last one and what you did here
    const acts = [];
    if (s?.lastAction) acts.push({ who: 'agent', at: s.lastAction.at, icon: 'spark', text: s.lastAction.text });
    for (const it of chan?.recent || []) { const t = itemText(it); acts.push({ who: 'you', at: Date.parse(it.at) || 0, icon: t.icon, text: t.text }); }
    acts.sort((a, b) => b.at - a.at);
    if (acts.length) kids.push(el('div', 'ag-block', {}, el('h4', '', {}, 'Recent actions'), el('ul', 'actions', {},
      ...acts.slice(0, 8).map(a => el('li', a.who, {}, el('span', 'a-ic', {}, icon(a.icon)), el('span', '', {}, a.text), el('time', '', {}, agoText(a.at, now)))))));
    kids.push(el('div', 'ag-foot', {}, el('span', 'ag-foot-note', {}, `You answer ${name} here with cards, notes and buttons. Its first request is still typed in its own window.`)));
    body.replaceChildren(...kids);
  }

  function questionCard(film, q) {
    const pick = picks.get(q.id) || { option: null, text: '' };
    const visual = q.options.some(o => o.image);
    const send = el('button', 'primary sm', { type: 'button' }, icon('send'), 'Send');
    const refresh = () => { send.disabled = busy.has(q.id) || (pick.option == null && !pick.text.trim()); };
    const opts = q.options.map((o, i) => {
      const b = el('button', 'q-opt' + (pick.option === i ? ' on' : ''), { type: 'button', 'aria-pressed': pick.option === i ? 'true' : 'false', title: o.detail || o.label },
        o.image ? el('img', '', { src: `/api/project/${enc(film.id)}/question/${enc(q.id)}/image/${i}`, alt: o.label, loading: 'lazy' }) : null,
        el('b', '', {}, o.label),
        q.recommended === i ? el('small', 'rec', {}, icon('spark'), 'Suggested') : o.detail && visual ? el('small', '', {}, o.detail) : null);
      b.addEventListener('click', () => {
        pick.option = pick.option === i ? null : i; picks.set(q.id, pick);
        for (const [j, x] of opts.entries()) { x.classList.toggle('on', pick.option === j); x.setAttribute('aria-pressed', pick.option === j ? 'true' : 'false'); }
        refresh();
      });
      return b;
    });
    const ta = el('textarea', 'inp', { rows: '2', placeholder: q.options.length ? 'Add a few words (optional)' : 'Your answer', 'aria-label': 'Your answer in words' });
    ta.value = pick.text;
    ta.addEventListener('input', () => { pick.text = ta.value; picks.set(q.id, pick); refresh(); });
    ta.addEventListener('keydown', e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); send.click(); } });
    ta.addEventListener('blur', () => setTimeout(() => { if (open && !drawer.contains(document.activeElement)) draw(last); }, 0));
    const err = el('div', 'q-err', { hidden: true });
    send.addEventListener('click', async () => {
      if (send.disabled) return;
      busy.add(q.id); refresh(); err.hidden = true;
      try { await post(`/api/project/${enc(film.id)}/question/${enc(q.id)}/answer`, { option: pick.option, text: pick.text.trim() }); picks.delete(q.id); }
      catch (e) { err.textContent = 'Could not send: ' + e.message; err.hidden = false; }
      finally { busy.delete(q.id); refresh(); }
    });
    refresh();
    return el('div', 'qcard', { 'data-q': q.id },
      el('div', 'q-top', {}, icon('help'), el('div', '', {}, el('div', 'q-kicker', {}, 'Question · ' + agoText(Date.parse(q.at))), el('div', 'q-text', {}, q.question))),
      q.options.length ? el('div', 'q-opts' + (visual ? ' visual' : ' text'), {}, ...opts) : null,
      ta, err, el('div', 'row-end', {}, send));
  }
  function answeredCard(q) {
    const a = q.answer || {};
    const again = el('button', 'undo', { type: 'button', title: 'Answer this question again' }, 'Change');
    again.addEventListener('click', () => { q.state = 'open'; picks.set(q.id, { option: a.option ?? null, text: a.text || '' }); last.chan.questions = [q, ...last.chan.questions.filter(x => x !== q)]; draw(last); });
    return el('div', 'qcard answered', {}, el('div', 'q-ans', {}, icon('check'),
      el('span', '', {}, q.question, ': ', el('b', '', {}, a.label != null ? a.label : 'answered'), a.text ? ` · “${a.text}”` : ''), again));
  }

  return { el: drawer, show, hide, isOpen: () => open, draw };
}
