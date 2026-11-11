// Recent render files, shared by the home page and the full history page.
import { h, api, toast, AGO, DUR, GB, onHubEvent } from './app.js';

const MODE = { full: 'Full film', partial: 'Partial render', preview: 'Preview', final: 'Final', web: 'Web copy', manual: 'Saved manually', command: 'Custom render' };
const SRC = { kuyruk: 'VideoHub queue', sohbet: 'Saved by chat', tarama: 'Found in folder', RenderGuard: 'Outside VideoHub' };
const filename = file => String(file || '').split(/[\\/]/).pop();
const dateText = value => {
  const d = new Date(value);
  return Number.isFinite(d.getTime()) ? d.toLocaleString('en-US', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : 'Unknown date';
};

// Use the same explicit actions on completion notices and in the persistent list.
export function outputActions(it, { compact = false, seen = async it => {
  const r = await api('/api/outputs/seen', { method: 'POST', body: { key: it.key || it.file } });
  window.__vhNewCount?.(r.unseen);
} } = {}) {
  const actions = h('div', { class: 'output-actions' });
  const button = (label, task, cls = '') => {
    const b = h('button', { class: cls, onclick: async () => {
      if (b.disabled) return;
      b.disabled = true;
      try { await task(); } catch (e) { toast(e.message, true); }
      finally { b.disabled = false; }
    } }, label);
    actions.append(b);
  };
  if (it.file && it.exists) {
    button('▶ Open video', async () => {
      await api('/api/open', { method: 'POST', body: { path: it.file, how: 'file' } });
      await seen(it);
    }, 'primary');
    button('Show in folder', () => api('/api/open', { method: 'POST', body: { path: it.file, how: 'folder' } }));
    if (!compact && it.projectId && it.rel) button('Review in VideoHub', () => {
      location.hash = '#/review/' + it.projectId + '/' + encodeURIComponent(it.rel);
    }, 'ghost');
  }
  if (!compact && it.file) button('Copy path', async () => {
    await navigator.clipboard.writeText(it.file); toast('File path copied');
  }, 'ghost');
  if (!compact && it.projectId) button('See leftovers', () => { location.hash = '#/p/' + it.projectId; }, 'ghost');
  if (!compact && it.log) button('Show log', () => api('/api/open', { method: 'POST', body: { path: it.log, how: 'folder' } }), 'ghost');
  return actions;
}

export function outputsPanel({ compact = false } = {}) {
  let data = null, filter = 'done', query = '', visible = 30, stopped = false, pending = null;
  const el = h('section', { class: 'recent-outputs' + (compact ? ' compact' : ''), 'aria-label': 'Recent renders' });
  const list = h('div', { class: 'output-list', 'aria-live': 'polite' });
  const count = h('span', { class: 'sub' });
  const search = h('input', { type: 'search', placeholder: 'Search projects or files…', 'aria-label': 'Search recent renders', oninput: e => { query = e.target.value; visible = 30; draw(); } });
  const select = h('select', { 'aria-label': 'Filter by render status', onchange: e => { filter = e.target.value; visible = 30; draw(); } },
    [['done', 'Completed'], ['all', 'All jobs'], ['new', 'Unwatched'], ['bad', 'Failed / cancelled']].map(([v, label]) => h('option', { value: v, selected: v === filter }, label)));
  const seenButton = h('button', { class: 'ghost', hidden: true, onclick: async () => {
    try { await api('/api/outputs/seen', { method: 'POST', body: { all: true } }); await refresh(); }
    catch (e) { toast(e.message, true); }
  } }, 'Mark all as watched');
  const more = h('button', { hidden: true, onclick: () => { visible += 30; draw(); } }, 'Show more');
  // the global outputs folder: every render as a hard link (the same file, no extra space)
  const cikBtn = h('button', { class: 'ghost', title: 'Folder containing all renders', onclick: () => api('/api/ciktilar/open', { method: 'POST' }).catch(e => toast(e.message, true)) }, '📂 Outputs folder');
  const cikInfo = () => api('/api/ciktilar').then(c => {
    cikBtn.title = c.dir + '\nEvery render appears here automatically. Hard link: the same file, with no extra space used; deleting one leaves the other intact.';
    cikBtn.textContent = `📂 Outputs folder · ${c.count} videos · extra space ${c.extra < 1048576 ? '~0 MB' : GB(c.extra)}`;
  }).catch(() => { });
  if (compact) el.append(h('div', { class: 'row recent-heading' }, h('h2', {}, 'Recent renders'), h('span', { class: 'spacer' }), cikBtn, h('a', { href: '#/outputs' }, 'View all →')));
  else el.append(h('div', { class: 'filters output-filters' }, search, select, cikBtn, h('span', { class: 'spacer' }), seenButton,
    h('button', { onclick: () => refresh(true) }, 'Refresh')), count);
  el.append(list, more);
  list.append(h('div', { class: 'empty' }, 'Loading recent renders…'));
  async function seen(it) {
    const r = await api('/api/outputs/seen', { method: 'POST', body: { key: it.key || it.file } });
    it.isNew = false; window.__vhNewCount?.(r.unseen); draw();
  }
  function row(it) {
    const ready = it.state === 'done' && it.file && it.exists;
    const label = it.state === 'cancelled' ? 'Cancelled' : it.state !== 'done' ? 'Failed' : !it.file ? 'Output not found' : !it.exists ? 'File moved or deleted' : it.isNew ? 'New' : 'Done';
    return h('article', { class: 'output-card' + (it.isNew ? ' isnew' : ''), 'data-output-key': it.key },
      h('div', { class: 'output-icon', 'aria-hidden': 'true' }, ready ? '▶' : it.state === 'done' ? '—' : '!'),
      h('div', { class: 'output-body' },
        h('div', { class: 'row output-title' }, h('b', {}, it.projectName || 'Untitled project'),
          it.version ? h('span', { class: 'dim' }, 'v' + it.version) : null,
          h('span', { class: 'pill ' + (ready ? 'approved' : it.state === 'done' ? '' : 'reopened') }, label)),
        h('div', { class: 'output-filename', title: it.file || '' }, filename(it.file) || it.error || it.detail || 'No video file was saved for this job.'),
        h('div', { class: 'output-meta' }, h('time', { datetime: it.finishedAt || '', title: dateText(it.finishedAt) }, AGO(it.finishedAt) + ' · ' + dateText(it.finishedAt)),
          h('span', {}, MODE[it.mode] || it.mode || SRC[it.source] || ''), it.dur ? h('span', {}, DUR(it.dur)) : null, it.size ? h('span', {}, GB(it.size)) : null,
          !compact && it.durationSec ? h('span', {}, 'Took ' + DUR(it.durationSec)) : null),
        !compact && it.session ? h('div', { class: 'sub' }, it.session) : null,
        !compact && it.file ? h('div', { class: 'mono dim outpath', title: it.file }, it.file) : null,
        !compact && it.copiedTo ? h('div', { class: 'mono dim outpath', title: it.copiedTo }, 'Copy: ' + it.copiedTo) : null,
        outputActions(it, { seen, compact })));
  }
  function draw() {
    if (!data || stopped) return;
    const q = query.trim().toLocaleLowerCase('en-US');
    const rows = data.items.filter(it => (compact ? it.state === 'done' && it.exists : filter === 'all' || (filter === 'done' ? it.state === 'done' : filter === 'new' ? it.isNew : it.state !== 'done'))
      && (!q || [it.projectName, it.file, it.session].join(' ').toLocaleLowerCase('en-US').includes(q)));
    list.replaceChildren(...rows.slice(0, compact ? 3 : visible).map(row));
    if (!rows.length) list.append(h('div', { class: 'empty' }, q ? 'No renders match your search.' : filter === 'new' ? 'No unwatched renders.' : 'No completed renders yet. Videos will appear here when they finish.'));
    more.hidden = compact || rows.length <= visible;
    seenButton.hidden = !data.unseen;
    count.textContent = rows.length + ' records · newest first' + (data.unseen ? ' · ' + data.unseen + ' unwatched' : '');
  }
  async function refresh(manual = false) {
    if (stopped) return;
    if (pending) return pending;
    pending = (async () => {
      try {
        const r = await api('/api/outputs?limit=' + (compact ? '30' : '1000'));
        if (stopped) return;
        data = r; window.__vhNewCount?.(r.unseen); draw(); cikInfo();
      } catch (e) {
        if (!stopped && !data) list.replaceChildren(h('div', { class: 'empty' }, 'Could not load the render list. Click Refresh to try again.'));
        if (!stopped && manual) toast(e.message, true);
      } finally { pending = null; }
    })();
    return pending;
  }
  const offJob = onHubEvent('job', ev => { if (['done', 'failed', 'cancelled'].includes(ev?.type)) refresh(); });
  const offScan = onHubEvent('scan', ev => { if (ev?.phase === 'done' || ev?.type === 'project') refresh(); });
  const timer = setInterval(() => { if (!document.hidden) refresh(); }, 15000);
  refresh();
  return { el, refresh, dispose: () => { stopped = true; offJob(); offScan(); clearInterval(timer); } };
}
