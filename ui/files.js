// A film's Files tab (#/files/<film id>): its files grouped (Source, Voice and sound, Images and models, Renders,
// Generated folders, Other files, Leftovers) with sizes, a "changed recently" filter, "show in folder" per row and the
// film's leftovers cleaned through the existing cleanup run (with its confirmation). Data: GET /api/project/:id/files.
import { h, api, toast, GB, DUR, openProject, runClean } from './app.js';
import { openFinishDialog } from './finish.js';
import { icon } from './icons.js';
import { shellFilm, shellTabCount } from './shell.js';
import { trashName } from './system.js';

const LOOK = {
  source: { icon: 'code', color: 'var(--work)' },
  voice: { icon: 'wave', color: 'var(--violet)' },
  images: { icon: 'image', color: 'var(--wait)' },
  renders: { icon: 'video', color: 'var(--ok)' },
  generated: { icon: 'layers', color: '#5f7f9e' },
  other: { icon: 'file', color: 'var(--t4)' },
  leftovers: { icon: 'broom', color: 'var(--chg)' },
};
const ROLE = { final: 'final', web: 'web copy', preview: 'preview', clip: 'test clip', silent: 'silent', broken: 'broken' };
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { } },
};
const timeOf = t => new Date(t).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
const dayTime = t => { const d = new Date(t), today = new Date(); return d.toDateString() === today.toDateString() ? 'today ' + timeOf(t) : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + ' ' + timeOf(t); };

// #/files/<id>/finish opens the Finish film dialog at once (hub_finish with dryRun:false asks for it)
export async function filesPage(page, id, then) {
  const p = await api('/api/project/' + encodeURIComponent(id) + '?lite=1');
  const fmt = p.render?.w && p.render?.h ? (p.render.w > p.render.h ? '16:9' : p.render.w < p.render.h ? '9:16' : '1:1') : null;
  shellFilm(p, { tab: 'files', meta: [fmt, p.filmDur ? DUR(p.filmDur) : null, `${p.outputs.length} video${p.outputs.length === 1 ? '' : 's'}`].filter(Boolean),
    review: () => openProject({ id, outputsCount: p.outputs.length, latest: p.latest }) });

  let data = null, onlyChanged = !!store.get('vh-files-changed', false), timer = null, alive = true;
  const open = store.get('vh-files-open', { source: true, voice: true, images: true, renders: true, generated: false, other: false, leftovers: true });
  const sub = h('p', { class: 'sub' }, p.label || p.path);
  const sw = h('input', { type: 'checkbox', checked: onlyChanged, onchange: e => { onlyChanged = e.target.checked; store.set('vh-files-changed', onlyChanged); draw(); } });
  const ruleNote = h('span', { class: 'files-rule' });
  const refreshBtn = h('button', { class: 'ghost sm', title: 'Look at the folder again', onclick: () => load(true) }, icon('refresh'));
  page.classList.add('files-page');
  page.append(h('div', { class: 'page-head' },
    h('div', {}, h('h1', {}, 'Files'), sub),
    h('div', { class: 'files-switch' }, h('label', { class: 'switch', title: 'Show only files changed recently' }, sw, h('span', { class: 'sw' }), 'Changed recently'), ruleNote),
    refreshBtn,
    h('button', { title: 'Open the film folder in your file manager', onclick: () => reveal(null) }, icon('reveal', { cls: 'il' }), 'Open folder'),
    p.group || p.rootType === 'media' || p.studio ? null : h('button', { class: 'primary', 'data-clean': '1', title: 'The film is done: review what it no longer needs and tidy its folder', onclick: () => finish() }, icon('broom', { cls: 'il' }), 'Finish film…')));
  const finish = () => openFinishDialog(id, { after: () => load(true) });
  const notice = h('div', { class: 'files-notice', hidden: true });
  const summary = h('div', { class: 'files-summary' }, h('div', { class: 'files-total dim' }, icon('spin', { cls: 'spin' }), 'Looking at the folder…'));
  const groupsBox = h('div', { class: 'files-groups' });
  page.append(notice, summary, groupsBox);

  async function reveal(rel) {
    try { await api(`/api/project/${encodeURIComponent(id)}/open-folder`, { method: 'POST', body: rel ? { rel } : {} }); }
    catch (e) { toast(e.message, true); }
  }
  async function load(fresh = false) {
    clearTimeout(timer);
    try { data = await api(`/api/project/${encodeURIComponent(id)}/files${fresh ? '?fresh=1' : ''}`); }
    catch (e) { if (alive) summary.replaceChildren(h('div', { class: 'empty' }, 'Could not list the files: ' + e.message)); return; }
    if (!alive) return;
    draw();
    // janitor's list was still being prepared: ask again shortly
    if (data.leftoversPending) timer = setTimeout(() => load(true), 3000);
  }

  function draw() {
    if (!data) return;
    const since = data.changedRule?.since, changedTotal = data.groups.reduce((s, g) => s + g.changed, 0);
    shellTabCount(changedTotal, changedTotal ? `${changedTotal} file${changedTotal === 1 ? '' : 's'} changed ${ruleText(data.changedRule, true)}` : '');
    sub.replaceChildren(h('span', { class: 'mono', title: data.path }, data.label), ' · ', GB(data.total.size), ' · ', `${changedTotal} changed ${ruleText(data.changedRule, true)}`);
    ruleNote.textContent = ruleText(data.changedRule);
    ruleNote.title = data.changedRule?.kind === 'session' ? `Files modified since ${data.changedRule.agent}’s session “${data.changedRule.title}” started (${new Date(since).toLocaleString('en-US')})` : 'No agent session on this film right now: files modified in the last 24 hours';
    const notes = [];
    if (data.truncated) notes.push(h('div', {}, icon('warn'), `This folder is very large: only the first ${data.maxEntries.toLocaleString('en-US')} files and folders were looked at, so the totals are incomplete.`));
    notice.replaceChildren(...notes); notice.hidden = !notes.length;

    // total, size bar and legend
    const total = data.total.size || 0, shown = data.groups.filter(g => g.size > 0);
    summary.replaceChildren(
      h('div', { class: 'files-total' }, h('span', {}, 'Total on disk'), h('b', {}, GB(total)), h('span', { class: 'spacer' }), h('span', {}, `${data.total.count.toLocaleString('en-US')} files`)),
      h('div', { class: 'size-bar', role: 'img', 'aria-label': shown.map(g => `${g.name} ${GB(g.size)}`).join(', ') }, shown.map(g => h('i', { style: { flex: String(Math.max(g.size / (total || 1), 0.012)), background: LOOK[g.key].color }, title: `${g.name} · ${GB(g.size)}` }))),
      h('div', { class: 'size-legend' }, data.groups.filter(g => g.count || g.key !== 'generated' && g.key !== 'other').map(g => h('span', {}, h('i', { style: { background: LOOK[g.key].color } }), `${g.name} ${GB(g.size)}`))));

    groupsBox.replaceChildren(...data.groups.filter(g => g.rows.length || g.count || ['source', 'renders', 'leftovers'].includes(g.key)).map(group));
  }
  function group(g) {
    const look = LOOK[g.key], isOpen = open[g.key] !== false;
    const rows = onlyChanged ? g.rows.filter(r => r.changed) : g.rows;
    const head = h('button', { class: 'fg-head', 'aria-expanded': String(isOpen), onclick: () => { open[g.key] = !isOpen; store.set('vh-files-open', open); draw(); } },
      icon('chev', { cls: 'chev' }), h('span', { class: 'gi', style: { color: look.color } }, icon(look.icon)), h('span', { class: 'gname' }, g.name),
      h('span', { class: 'gcount' }, countText(g)), h('span', { class: 'gsize' }, GB(g.size)));
    const body = h('div', { class: 'fg-rows' });
    if (g.key === 'leftovers') body.append(...leftovers(g, rows));
    else {
      body.append(...rows.map(r => row(g, r)));
      if (!rows.length) body.append(h('div', { class: 'frow empty-row' }, h('span'), h('span', { class: 'fname plain' }, onlyChanged ? 'Nothing changed here' : g.key === 'renders' ? 'No videos yet. The live preview plays the film from its code.' : 'Nothing here')));
    }
    if (g.more) body.append(h('div', { class: 'frow more-row' }, h('span'), h('span', { class: 'fname plain' }, `and ${g.more.toLocaleString('en-US')} more not listed`), h('span'), h('span')));
    return h('div', { class: 'fgroup' + (isOpen ? '' : ' closed'), 'data-g': g.key }, head, body);
  }
  function countText(g) {
    const n = g.key === 'generated' || g.key === 'leftovers' ? `${g.rows.length} item${g.rows.length === 1 ? '' : 's'}` : `${g.count.toLocaleString('en-US')} file${g.count === 1 ? '' : 's'}`;
    return n + (g.changed ? ` · ${g.changed} changed` : '');
  }
  function row(g, r) {
    const folder = r.kind === 'folder';
    const note = folder ? [`${r.count.toLocaleString('en-US')} file${r.count === 1 ? '' : 's'}`, r.hint].filter(Boolean).join(' · ')
      : g.key === 'renders' ? [r.role ? ROLE[r.role] || r.role : null, r.dur ? DUR(r.dur) : null, r.mtime ? dayTime(r.mtime) : null, r.latest ? 'latest' : null].filter(Boolean).join(' · ') : '';
    return h('div', { class: 'frow' + (r.changed ? ' is-changed' : ''), title: r.rel + (r.mtime ? ' · modified ' + new Date(r.mtime).toLocaleString('en-US') : '') },
      icon(folder ? 'folder' : LOOK[g.key].icon),
      h('span', { class: 'fname' }, r.version != null ? h('span', { class: 'vtag' }, 'v' + r.version) : null, folder ? r.rel + '/' : r.rel, note ? h('small', {}, note) : null),
      r.changed ? h('span', { class: 'chg', title: folder ? `${r.changedCount} file${r.changedCount === 1 ? '' : 's'} inside changed ${ruleText(data.changedRule, true)}` : 'Changed ' + ruleText(data.changedRule, true) }, folder && r.changedCount > 1 ? r.changedCount + ' changed' : 'changed') : h('span', { class: 'ghost-slot' }),
      h('span', { class: 'fsize' }, GB(r.size)),
      h('button', { class: 'reveal', title: 'Show in folder', 'aria-label': 'Show ' + r.rel + ' in its folder', onclick: () => reveal(r.rel) }, icon('reveal')));
  }
  // janitor's leftovers for this film: ticked like the film details' "Tidy up" list; cleaned by the existing cleanup run
  function leftovers(g, rows) {
    const out = [];
    if (data.busy) { out.push(h('div', { class: 'fg-clean' }, icon('hourglass'), h('span', {}, `Leftovers are not listed right now: ${data.busy}.`))); return out; }
    if (data.leftoversPending) { out.push(h('div', { class: 'fg-clean' }, icon('spin', { cls: 'spin' }), h('span', {}, 'Preparing the cleanup list…'))); return out; }
    if (!g.rows.length) { out.push(h('div', { class: 'fg-clean done' }, icon('check'), h('span', {}, h('b', {}, 'No leftovers.'), ' Nothing in this film is listed for cleanup.'))); return out; }
    const picked = new Set(g.rows.filter(r => r.leftover.preset === 'safe' || (r.leftover.preset === 'deep' && r.leftover.checked)).map(r => r.leftover.id));
    const btn = h('button', { class: 'sm primary', 'data-clean': '1' });
    const sum = () => g.rows.filter(r => picked.has(r.leftover.id)).reduce((s, r) => s + (r.leftover.size || r.size), 0);
    const upd = () => { btn.replaceChildren(icon('broom', { cls: 'il' }), `Clean selected (${GB(sum())})`); btn.dataset.empty = picked.size ? '0' : '1'; btn.disabled = !picked.size; };
    btn.onclick = () => runClean(g.rows.filter(r => picked.has(r.leftover.id)).map(r => ({ id: r.leftover.id, action: r.leftover.action, size: r.leftover.size || r.size })), () => load(true));
    for (const r of rows) {
      const L = r.leftover, cb = h('input', { type: 'checkbox', checked: picked.has(L.id), 'aria-label': 'Select ' + r.rel, onchange: e => { e.target.checked ? picked.add(L.id) : picked.delete(L.id); upd(); } });
      const what = (L.action === 'archive' ? 'Moves to the archive · ' : `${trashName()} · `) + L.reason;
      const count = r.count ? `${r.count.toLocaleString('en-US')} file${r.count === 1 ? '' : 's'}` + (L.partial ? ' (scripts stay)' : '') : '';
      out.push(h('div', { class: 'frow lrow' + (r.changed ? ' is-changed' : ''), title: r.rel },
        cb, h('span', { class: 'fname' }, r.kind === 'folder' ? r.rel + '/' : r.rel, h('small', { class: 'why' }, [count, what].filter(Boolean).join(' · '))),
        r.changed ? h('span', { class: 'chg' }, 'changed') : h('span', { class: 'ghost-slot' }),
        h('span', { class: 'fsize' }, GB(L.size || r.size)),
        h('button', { class: 'reveal', title: 'Show in folder', 'aria-label': 'Show ' + r.rel + ' in its folder', onclick: () => reveal(r.rel) }, icon('reveal'))));
    }
    if (onlyChanged && !rows.length) out.push(h('div', { class: 'frow empty-row' }, h('span'), h('span', { class: 'fname plain' }, 'Nothing changed here')));
    out.push(h('div', { class: 'fg-clean' }, h('span', {}, `Safe to remove: render leftovers, test pictures and old copies, as the cleanup rules list them. Selected items go to the ${trashName()} (old versions to the archive); code, sound and the latest videos stay.`), h('span', { class: 'spacer' }), btn));
    upd();
    return out;
  }
  await load();
  if (then === 'finish' && alive) { history.replaceState(null, '', '#/files/' + encodeURIComponent(id)); finish(); }
  return () => { alive = false; clearTimeout(timer); };
}

// "since the Claude Code session started at 14:02" / "in the last 24 h"
export function ruleText(rule, short = false) {
  if (!rule) return '';
  if (rule.kind === 'session') return short ? `since the ${rule.agent} session started` : `Since ${rule.agent}’s session started, ${dayTime(rule.since)}`;
  return short ? 'in the last 24 h' : 'In the last 24 hours';
}
