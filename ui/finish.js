// "Finish film…": the review dialog for tidying a finished film (one film from its Files tab or Film details, or every
// finished film at once from the Cleanup page). Data: GET /api/project/:id/finish (server/finish.js classifies the
// folder). What goes to the Recycle Bin / Trash and to the archive is ticked; optional items are not; what stays is
// listed too. "Finish and tidy" marks the film approved and starts one cleanup run (progress at the bottom right).
import { h, api, toast, GB, startCleanRun, cleanIsRunning } from './app.js';
import { icon } from './icons.js';
import { trashName } from './system.js';

const DONE = new Set(['approved', 'published', 'archived', 'done']);
const SECTIONS = [
  ['remove', () => `To the ${trashName()}`, 'broom', 'Render leftovers, copies, check pictures and test files. You can restore them from there.'],
  ['archive', () => 'To the archive', 'archive', 'Older versions: copied to the archive folder, checked, then removed here.'],
  ['optional', () => 'Optional', 'layers', 'Can be made again but costs time: off unless you tick them.'],
  ['keep', () => 'Stays', 'check', 'The film’s code, inputs, voice-over, final mix and the newest video.'],
];

// one film's lists with tick boxes; returns { el, chosen(), sums() }
function filmLists(c, onChange, { compact = false } = {}) {
  const checked = new Set(c.items.filter(it => it.checked).map(it => it.id));
  const el = h('div', { class: 'fin-lists' });
  for (const [kind, title, ico, help] of SECTIONS) {
    const list = c.items.filter(it => it.kind === kind);
    if (!list.length) continue;
    const size = list.reduce((s, it) => s + it.size, 0);
    const box = h('div', { class: 'items', hidden: kind === 'keep' || (compact && kind !== 'remove') });
    for (const it of list) {
      const name = it.rel + (it.dir ? '/' : '');
      const meta = [it.dir && it.count ? `${it.count.toLocaleString('en-US')} file${it.count === 1 ? '' : 's'}` : null, it.reason, it.note].filter(Boolean).join(' · ');
      const cb = kind === 'keep' ? h('span') : h('input', { type: 'checkbox', checked: checked.has(it.id), 'aria-label': 'Include ' + name, onchange: e => { e.target.checked ? checked.add(it.id) : checked.delete(it.id); onChange(); } });
      box.append(h('label', { class: 'item' + (kind === 'keep' ? ' stays' : '') }, cb,
        h('div', {}, h('div', { class: 'ellip mono', title: name }, name), h('div', { class: 'why' }, meta)),
        h('div', { class: 'num' }, GB(it.size))));
    }
    const head = h('header', { class: 'fin-head', 'aria-expanded': String(!box.hidden) }, icon(ico), h('b', {}, title()), h('span', { class: 'muted' }, `${list.length} item${list.length === 1 ? '' : 's'}`),
      h('span', { class: 'dim fin-help' }, help), h('span', { class: 'size' }, GB(size)), h('span', { class: 'dim' }, icon('chev')));
    head.onclick = () => { box.hidden = !box.hidden; head.setAttribute('aria-expanded', String(!box.hidden)); };
    el.append(h('div', { class: 'rule fin-sec', 'data-kind': kind }, head, box));
  }
  const chosen = () => c.items.filter(it => it.kind !== 'keep' && checked.has(it.id));
  const sums = () => {
    const ch = chosen(), s = { remove: 0, archive: 0, optional: 0, moved: 0, freed: 0, n: ch.length };
    for (const it of ch) { s[it.kind] += it.size; s.moved += it.size; s.freed += it.freed; }
    return s;
  };
  return { el, chosen, sums };
}

function modal(title, wide = true) {
  const box = h('div', { class: 'modal' + (wide ? ' finish-modal' : ''), role: 'dialog', 'aria-label': title });
  const bg = h('div', { class: 'modal-bg' }, box);
  const close = () => { bg.remove(); document.removeEventListener('keydown', esc); };
  const esc = e => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', esc);
  bg.addEventListener('click', e => { if (e.target === bg) close(); });
  (document.fullscreenElement || document.body).append(bg);
  return { box, close };
}
const totalsLine = s => `${s.n} item${s.n === 1 ? '' : 's'} · moves ${GB(s.moved)} · frees ${GB(s.freed)}`;
const refusedBox = (title, why) => h('div', { class: 'fin-refused' }, icon('warn'), h('span', {}, h('b', {}, title + ': '), why));

// one film
export async function openFinishDialog(id, { after } = {}) {
  if (cleanIsRunning()) { toast('A cleanup is running; try again when it finishes.', true); return; }
  const { box, close } = modal('Finish film');
  box.append(h('h1', {}, 'Finish film'), h('div', { class: 'empty fin-wait' }, icon('spin', { cls: 'spin' }), ' Looking at the film folder…'));
  let c; try { c = await api(`/api/project/${encodeURIComponent(id)}/finish?fresh=1`); } catch (e) { close(); toast('Could not look at the film: ' + e.message, true); return; }
  box.replaceChildren(h('h1', {}, 'Finish film · ', c.film.title));
  box.append(h('p', { class: 'sub' }, `When a film is done, what it no longer needs leaves its folder: to the ${trashName()}, or (older versions) to the archive. Its code, inputs, voice-over, final mix and newest video stay. Nothing is deleted outright.`));
  if (c.refused) {
    box.append(refusedBox('Not tidied', c.refused), h('div', { class: 'row' }, h('span', { class: 'spacer' }), h('button', { onclick: close }, 'Close')));
    return;
  }
  const notDone = !(DONE.has(c.film.status) && !c.film.statusAuto);
  const tiles = h('div', { class: 'tiles fin-tiles' });
  const go = h('button', { class: 'primary', 'data-clean': '1' });
  const info = h('span', { class: 'muted' });
  const lists = filmLists(c, () => upd());
  function upd() {
    const s = lists.sums();
    tiles.replaceChildren(tile(`To the ${trashName()}`, GB(s.remove)), tile('To the archive', GB(s.archive)), tile('Optional, ticked', GB(s.optional)), tile('Frees', GB(s.freed), 'Space that really comes back: a file with another hard link (e.g. in the outputs folder) frees nothing until that link goes too.'));
    info.textContent = totalsLine(s);
    go.replaceChildren(icon('broom', { cls: 'il' }), 'Finish and tidy'); go.disabled = !s.n;
  }
  go.onclick = async () => {
    const ids = lists.chosen().map(it => it.id); if (!ids.length) return;
    go.disabled = true;
    try { await startCleanRun(`/api/project/${encodeURIComponent(id)}/finish`, { ids }, after); close(); toast(`Tidying “${c.film.title}”… progress at the bottom right.`); }
    catch (e) { go.disabled = false; toast('Did not start: ' + e.message, true); }
  };
  box.append(...[tiles,   // (Element.append prints null as text)
    notDone ? h('div', { class: 'sub fin-note' }, icon('approved', { cls: 'il' }), 'Once tidied, the film is marked “approved”. A later change then needs a full render again.') : null,
    lists.el,
    h('div', { class: 'row fin-foot' }, info, h('span', { class: 'spacer' }), h('button', { onclick: close }, 'Cancel'), go)].filter(Boolean));
  upd();
}
function tile(k, v, title) { return h('div', { class: 'tile', title }, h('div', { class: 'k' }, k), h('div', { class: 'v' }, v)); }

// several films at once (the Cleanup page's "Review and tidy N films…"): one combined review before anything moves
export async function openFinishAll(films, { after } = {}) {
  if (cleanIsRunning()) { toast('A cleanup is running; try again when it finishes.', true); return; }
  const { box, close } = modal('Tidy films');
  const wait = h('div', { class: 'empty fin-wait' }, icon('spin', { cls: 'spin' }), ' Looking at the film folders…');
  box.append(h('h1', {}, `Tidy ${films.length} film${films.length === 1 ? '' : 's'}`), wait);
  const blocks = [];
  for (const f of films) {
    wait.lastChild.textContent = ` Looking at “${f.title}” (${blocks.length + 1}/${films.length})…`;
    try { const c = await api(`/api/project/${encodeURIComponent(f.id)}/finish`); blocks.push({ f, c }); } catch (e) { blocks.push({ f, c: { refused: e.message, items: [] } }); }
  }
  wait.remove();
  const info = h('span', { class: 'muted' }), go = h('button', { class: 'primary', 'data-clean': '1' });
  const parts = [];
  const body = h('div', { class: 'fin-films' });
  for (const { f, c } of blocks) {
    if (c.refused) { body.append(refusedBox(f.title, c.refused)); continue; }
    const on = h('input', { type: 'checkbox', checked: true, 'aria-label': 'Include ' + f.title, onchange: () => upd() });
    const lists = filmLists(c, () => upd(), { compact: true });
    const sum = h('span', { class: 'size' });
    parts.push({ f, c, on, lists, sum });
    const det = h('div', { class: 'fin-film' }, h('label', { class: 'fin-film-head' }, on, h('b', {}, f.title), sum), lists.el);
    body.append(det);
  }
  function upd() {
    const all = { n: 0, moved: 0, freed: 0 };
    for (const x of parts) { const s = x.lists.sums(); x.sum.textContent = `${GB(s.moved)} · frees ${GB(s.freed)}`; x.lists.el.classList.toggle('off', !x.on.checked); if (x.on.checked) { all.n += s.n; all.moved += s.moved; all.freed += s.freed; } }
    info.textContent = `${parts.filter(x => x.on.checked).length} film${parts.length === 1 ? '' : 's'} · ` + totalsLine(all);
    go.replaceChildren(icon('broom', { cls: 'il' }), 'Finish and tidy'); go.disabled = !all.n;
  }
  go.onclick = async () => {
    const req = parts.filter(x => x.on.checked).map(x => ({ id: x.f.id, ids: x.lists.chosen().map(it => it.id) })).filter(x => x.ids.length);
    if (!req.length) return; go.disabled = true;
    try { await startCleanRun('/api/finish', { films: req }, after); close(); toast(`Tidying ${req.length} film${req.length === 1 ? '' : 's'}… progress at the bottom right.`); }
    catch (e) { go.disabled = false; toast('Did not start: ' + e.message, true); }
  };
  box.append(h('p', { class: 'sub' }, `Everything below is reviewed here before anything moves: the ticked items go to the ${trashName()} (older versions to the archive). Each film that gets tidied is marked approved.`),
    parts.length || blocks.length ? body : h('div', { class: 'empty' }, 'Nothing to tidy.'),
    h('div', { class: 'row fin-foot' }, info, h('span', { class: 'spacer' }), h('button', { onclick: close }, 'Cancel'), go));
  upd();
}
