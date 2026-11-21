// A film's Plan tab (#/plan/<film id>): the agent's plan (hub_plan) as scene cards. The user approves the plan,
// approves built scenes or leaves a note on a scene; each of these goes to the agent at once (hub_wait).
// Frames: when the film plays from its code, one hidden copy of its page draws each built scene's start once (the
// review player's live source, never a render); other scenes show a numbered placeholder.
import { h, api, toast, TC, openProject, onHubEvent } from './app.js';
import { icon, ic } from './icons.js';
import { shellFilm, filmChannel, onFilmChannel, refreshChannel } from './shell.js';
import { agentName } from './agent.js';
import { SCENE_STATE, sceneState, planTitle, planCounts, planWaiting, mss } from './channel-view.js';
import { createLiveSource } from './review/live.js';

const enc = encodeURIComponent;
const frameCache = new Map();   // `${film}|${code revision}|${time}` → JPEG data URL (this window only)
const badge = st => h('span', { class: 'badge sc-' + st }, icon(SCENE_STATE[st].icon), SCENE_STATE[st].label);
const frameAt = sc => sc.start + Math.min(0.5, sc.seconds * 0.1);   // just after the cut: the scene, not the transition into it

export async function planPage(page, id) {
  const [p, liveInfo] = await Promise.all([api('/api/project/' + enc(id) + '?lite=1'), api(`/api/project/${enc(id)}/live?probe=1`).catch(() => null)]);
  const canLive = !!liveInfo?.ok;
  const W = canLive ? liveInfo.w : p.render?.w, H = canLive ? liveInfo.h : p.render?.h;
  const landscape = !(W && H && H > W);
  shellFilm(p, { tab: 'plan', review: () => openProject({ id, outputsCount: p.outputsCount ?? (p.outputs || []).length, latest: p.latest }) });
  page.classList.add('plan-page');
  let chan = filmChannel() || await api(`/api/project/${enc(id)}/channel`).catch(() => null);
  let notes = await api(`/api/project/${enc(id)}/notes`).catch(() => []);
  let sel = null, noteOpen = null, alive = true, busy = false;
  const drafts = new Map();   // scene number → note text being written (survives redraws)

  const head = h('div', { class: 'plan-head' }), wrap = h('div', { class: 'plan-wrap' }), cards = h('div', { class: 'plan-cards' + (landscape ? ' wide' : '') }), side = h('aside', { class: 'plan-side', hidden: true });
  wrap.append(cards, side);
  page.append(head, wrap);

  // ---------- frames from the film's own page (hidden), drawn once per code revision
  let live = null, liveReady = null;
  const rev = liveInfo?.revision || '';
  async function frame(sc) {
    const key = `${id}|${rev}|${frameAt(sc).toFixed(2)}`;
    if (frameCache.has(key)) return frameCache.get(key);
    if (!canLive || sceneState(sc) === 'planned') return null;
    if (!liveReady) liveReady = (async () => {
      if (!alive) return false;
      return await new Promise(res => {
        live = createLiveSource({ ...liveInfo, audio: null }, { onStatus: s => { if (s.state === 'ready') res(true); if (s.state === 'error') res(false); } });
        page.append(h('div', { class: 'plan-live', 'aria-hidden': 'true' }, live.el));
        setTimeout(() => res(false), 60e3);
      });
    })();
    if (!(await liveReady) || !alive || frameAt(sc) > live.duration) return null;
    await new Promise(r => requestAnimationFrame(r));
    let url = null;
    try { url = live.snap(frameAt(sc), landscape ? 480 : 300)?.toDataURL('image/jpeg', 0.82) || null; } catch { }
    if (url) frameCache.set(key, url);
    return url;
  }
  function frameBox(sc, big = false) {
    const box = h('div', { class: 'pc-frame' + (big ? ' big' : '') + (landscape ? ' wide' : ' tall') },
      h('div', { class: 'pc-ph' }, h('b', {}, String(sc.n).padStart(2, '0')), h('span', {}, sceneState(sc) === 'planned' ? 'Not built yet' : canLive ? 'Drawing…' : 'No preview')));
    frame(sc).then(url => { if (url && box.isConnected !== false) box.replaceChildren(h('img', { src: url, alt: `Scene ${sc.n} at ${TC(frameAt(sc))}` })); else { const s = box.querySelector('.pc-ph span'); if (s && sceneState(sc) !== 'planned') s.textContent = 'No preview'; } }).catch(() => { });
    return box;
  }

  // ---------- drawing
  const plan = () => chan?.plan || null;
  const sceneNotes = sc => notes.filter(n => n.t >= sc.start - 0.01 && n.t < sc.start + sc.seconds - 0.01);
  function draw() {
    const pl = plan();
    if (!pl) {
      head.replaceChildren(h('div', {}, h('h1', {}, 'Plan')));
      cards.replaceChildren(h('div', { class: 'panel plan-empty' }, icon('plan'), h('div', {}, h('b', {}, 'This film has no plan yet.'),
        h('p', {}, `When ${agentName()} plans a film with hub_plan, its scenes show here as cards: approve the plan, approve scenes, or leave a note on one. Each goes to ${agentName()} at once.`))));
      side.hidden = true; wrap.classList.remove('has-side'); return;
    }
    const c = planCounts(pl), waiting = planWaiting(chan);
    const approve = h('button', { class: waiting ? 'primary' : '', disabled: !waiting || busy, title: waiting ? `Tell ${agentName()} the plan is good: it starts building` : 'You approved this plan' },
      ...ic(waiting ? 'check' : 'approved', waiting ? 'Approve plan' : 'Plan approved'));
    approve.addEventListener('click', () => act(`/plan/approve`, { v: pl.v }, `Plan v${pl.v} approved. ${agentName()} gets it at once if it is waiting.`));
    head.replaceChildren(
      h('div', { class: 'plan-headtext' },
        h('h1', { class: 'plan-title' }, `Plan v${pl.v}`, h('span', { class: 'muted' }, ` · ${pl.scenes.length} scene${pl.scenes.length === 1 ? '' : 's'} · ${mss(pl.scenes.reduce((s, x) => s + x.seconds, 0))}`)),
        pl.summary ? h('p', { class: 'sub plan-summary' }, pl.summary) : null,
        h('div', { class: 'plan-counts' },
          waiting ? h('span', { class: 'wait-chip' }, icon('hand'), 'Waiting for your approval') : h('span', { class: 'ok-chip' }, icon('approved'), 'Approved by you'),
          ...['approved', 'ready', 'changes', 'planned'].filter(k => c[k]).map(k => h('span', {}, icon(SCENE_STATE[k].icon), `${c[k]} ${SCENE_STATE[k].label.toLowerCase()}`)),
          (chan.versions || []).length > 1 ? h('span', { class: 'dim', title: 'Earlier versions are kept in the film’s .videohub/plan.json' }, `${chan.versions.length - 1} earlier version${chan.versions.length === 2 ? '' : 's'}`) : null)),
      h('div', { class: 'spacer' }), approve);
    if (sel != null && !pl.scenes.some(s => s.n === sel)) sel = null;
    cards.replaceChildren(...pl.scenes.map(card));
    drawSide();
  }
  function card(sc) {
    const st = sceneState(sc), nCount = sceneNotes(sc).filter(n => !['approved', 'fixed'].includes(n.status)).length;
    const el = h('article', { class: `pcard st-${st}${sel === sc.n ? ' sel' : ''}`, tabindex: '0', 'data-n': sc.n, 'aria-label': `Scene ${sc.n}: ${sc.title}, ${SCENE_STATE[st].label}` },
      frameBox(sc),
      h('div', { class: 'pc-body' },
        h('div', { class: 'pc-top' }, h('span', { class: 'pc-num' }, String(sc.n).padStart(2, '0')), badge(st), h('span', { class: 'pc-dur' }, sc.seconds.toFixed(1) + ' s')),
        h('div', { class: 'pc-title' }, sc.title),
        sc.narration ? h('div', { class: 'pc-line' }, sc.narration) : null,
        h('div', { class: 'pc-foot' },
          st === 'ready' ? h('button', { class: 'pc-act ok', 'data-act': 'approve', title: 'This scene is good' }, icon('check'), 'Approve') : null,
          st === 'approved' ? h('span', { class: 'pc-act done' }, icon('approved'), 'Approved') : null,
          nCount ? h('span', { class: 'pc-note-count', title: 'Open notes on this scene' }, icon('note'), `${nCount} note${nCount === 1 ? '' : 's'}`) : null,
          h('span', { class: 'spacer' }),
          h('button', { class: 'pc-act', 'data-act': 'note', title: 'Leave a note on this scene' }, icon('pen'), 'Note'))),
      noteOpen === sc.n ? noteForm(sc) : null);
    el.addEventListener('click', e => {
      const b = e.target.closest('[data-act]');
      if (e.target.closest('.pc-note')) return;
      if (!b) { sel = sel === sc.n ? null : sc.n; draw(); return; }
      if (b.dataset.act === 'approve') act(`/plan/scene/${sc.n}/approve`, { v: plan().v }, `Scene ${sc.n} approved.`);
      if (b.dataset.act === 'note') { noteOpen = noteOpen === sc.n ? null : sc.n; draw(); setTimeout(() => cards.querySelector('.pc-note textarea')?.focus(), 30); }
    });
    el.addEventListener('keydown', e => { if ((e.key === 'Enter' || e.key === ' ') && e.target === el) { e.preventDefault(); sel = sel === sc.n ? null : sc.n; draw(); } });
    return el;
  }
  function noteForm(sc) {
    const ta = h('textarea', { class: 'inp', placeholder: `What should change in scene ${sc.n}?`, 'aria-label': `Note on scene ${sc.n}` });
    ta.value = drafts.get(sc.n) || '';
    ta.addEventListener('input', () => drafts.set(sc.n, ta.value));
    const save = h('button', { class: 'primary sm' }, ...ic('send', `Send to ${agentName()}`));
    const go = async () => {
      const text = ta.value.trim(); if (!text) { ta.focus(); return; }
      save.disabled = true;
      try {
        await api(`/api/project/${enc(id)}/plan/scene/${sc.n}/note`, { method: 'POST', body: { v: plan().v, text } });
        drafts.delete(sc.n); noteOpen = null; toast(`Note on scene ${sc.n} sent to ${agentName()}.`);
        notes = await api(`/api/project/${enc(id)}/notes`).catch(() => notes); refreshChannel();
      } catch (e) { toast('Could not send the note: ' + e.message, true); save.disabled = false; }
    };
    save.addEventListener('click', go);
    ta.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); go(); } if (e.key === 'Escape') { noteOpen = null; draw(); } });
    return h('div', { class: 'pc-note' }, ta, h('div', { class: 'row-end' }, h('button', { class: 'ghost sm', onclick: () => { noteOpen = null; draw(); } }, 'Cancel'), save));
  }
  function drawSide() {
    const pl = plan(), sc = pl?.scenes.find(s => s.n === sel);
    if (!sc) { side.hidden = true; wrap.classList.remove('has-side'); return; }
    side.hidden = false; wrap.classList.add('has-side');
    const st = sceneState(sc), ns = sceneNotes(sc);
    const close = h('button', { class: 'icon-btn sm', title: 'Close', 'aria-label': 'Close' }, icon('x'));
    close.addEventListener('click', () => { sel = null; draw(); });
    const watch = h('button', { class: 'sm', title: 'Open Review at the start of this scene' }, ...ic('play', 'Watch in Review'));
    watch.addEventListener('click', () => { location.hash = canLive ? `#/review/${enc(id)}/~live?t=${sc.start + 0.02}` : p.latest ? `#/review/${enc(id)}/${enc(p.latest)}?t=${sc.start + 0.02}` : `#/review/${enc(id)}/~live`; });
    const approve = st === 'ready' ? h('button', { class: 'sm accent-outline' }, ...ic('check', 'Approve scene')) : null;
    approve?.addEventListener('click', () => act(`/plan/scene/${sc.n}/approve`, { v: pl.v }, `Scene ${sc.n} approved.`));
    const note = h('button', { class: 'sm' }, ...ic('pen', 'Note'));
    note.addEventListener('click', () => { noteOpen = sc.n; draw(); setTimeout(() => cards.querySelector('.pc-note textarea')?.focus(), 30); });
    side.replaceChildren(...[
      h('div', { class: 'ps-head' }, h('span', { class: 'pc-num' }, `SCENE ${String(sc.n).padStart(2, '0')} · ${TC(sc.start)} to ${TC(sc.start + sc.seconds)}`), h('span', { class: 'spacer' }), close),
      frameBox(sc, true),
      h('div', { class: 'ps-title' }, sc.title), h('div', {}, badge(st)),
      sc.narration ? h('p', { class: 'ps-line' }, sc.narration) : null,
      sc.note ? h('div', { class: 'ps-agent' }, h('h4', {}, `${agentName()}’s note`), h('p', {}, sc.note)) : null,
      ns.length ? h('div', { class: 'ps-notes' }, h('h4', {}, 'Notes on this scene'), ...ns.map(n => h('div', { class: 'ps-note' }, h('span', { class: 'mono' }, TC(n.t)), h('span', {}, n.text), h('span', { class: 'ps-nst' }, n.status === 'claude' ? 'with ' + agentName() : n.status)))) : null,
      h('div', { class: 'ps-acts' }, watch, approve, note)].filter(Boolean));   // (replaceChildren prints null as text)
  }
  async function act(path, body, ok) {
    if (busy) return; busy = true;
    try { await api(`/api/project/${enc(id)}${path}`, { method: 'POST', body }); toast(ok); refreshChannel(); }
    catch (e) { toast(e.message, true); refreshChannel(); }
    finally { busy = false; }
  }
  // redraw when the channel changes, unless a note is being written (it is kept and drawn back after)
  const offChan = onFilmChannel(c => { chan = c; if (!cards.contains(document.activeElement) || !document.activeElement.matches('textarea')) draw(); });
  const offNote = onHubEvent('note', ev => { if (ev?.project !== id) return; api(`/api/project/${enc(id)}/notes`).then(n => { notes = n; if (!cards.contains(document.activeElement)) draw(); }).catch(() => { }); });
  draw();
  return () => { alive = false; offChan(); offNote(); live?.destroy(); };
}
