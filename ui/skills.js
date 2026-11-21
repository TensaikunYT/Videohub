// The Skills page (#/skills, #/skills/<agent>/<name>): the skills in the agents' skill folders, read-only. A list of
// skill cards (search, agents, films, last used, "in use now") and the selected skill: its folder, agents, file tree,
// a file viewer (Markdown rendered by ui/markdown.js as DOM nodes, other text as text, binaries as an info card) and the
// films that used it. Data: GET /api/skills, /api/skills/<agent>/<name>, …/file?path=.
import { h, api, toast, GB, openProject, onActivity, onHubEvent } from './app.js';
import { icon, agentIcon } from './icons.js';
import { renderMarkdown } from './markdown.js';

const AGENT_ORDER = ['claude', 'codex', 'opencode', 'shared'];
const AGENT_TITLE = { claude: 'Claude Code', codex: 'Codex', opencode: 'OpenCode', shared: 'Shared (~/.agents/skills)' };
const TEXT_EXT = /\.(md|markdown|txt|js|mjs|cjs|ts|tsx|jsx|py|json|jsonc|ya?ml|toml|ini|cfg|sh|ps1|cmd|bat|html?|css|scss|glsl|frag|vert|csv|xml|svg|srt|vtt|lua|rb|go|rs|c|h|cpp|cs|java|env)$/i;
const IMAGE_EXT = /\.(png|jpe?g|webp|gif|bmp|avif|ico|tiff?|psd|exr|hdr)$/i, MODEL_EXT = /\.(glb|gltf|fbx|obj|stl|ply|usdz?|blend)$/i;
const href = (agent, name) => '#/skills/' + encodeURIComponent(agent) + '/' + encodeURIComponent(name);
export function ago(t, now = Date.now()) {
  if (!t) return '—';
  const d = (now - t) / 1000;
  if (d < 60) return 'just now';
  if (d < 3600) return Math.floor(d / 60) + ' min ago';
  if (d < 86400) return Math.floor(d / 3600) + ' h ago';
  if (d < 86400 * 2) return 'yesterday';
  if (d < 86400 * 30) return Math.floor(d / 86400) + ' days ago';
  const d0 = new Date(t);
  return d0.toLocaleDateString('en-US', d0.getFullYear() === new Date(now).getFullYear() ? { month: 'short', day: 'numeric' } : { month: 'short', day: 'numeric', year: 'numeric' });
}
const chip = (agent, full = false) => h('span', { class: 'ag-chip', title: AGENT_TITLE[agent] || agent }, agentIcon(agent, 12), full ? (AGENT_TITLE[agent] || agent).replace(/ \(.*\)$/, '') : null);

export async function skillsPage(page, agentArg = null, nameArg = null) {
  page.classList.add('skills-page');
  let data = null, q = '', sel = null, detail = null, file = 'SKILL.md', alive = true;
  const closed = new Set(), texts = new Map();
  const search = h('input', { type: 'search', placeholder: 'Search skills', 'aria-label': 'Search skills', oninput: e => { q = e.target.value; drawList(); } });
  const count = h('span', { class: 'count' });
  page.append(h('div', { class: 'page-head' },
    h('div', {}, h('h1', {}, 'Skills', count), h('p', { class: 'sub' }, 'How each look is made. Agents read these files; here you can see them. Read-only.')),
    h('span', { class: 'spacer' }),
    h('label', { class: 'search' }, icon('search'), search)));
  const list = h('div', { class: 'skill-list', role: 'list' }), view = h('div', { class: 'skill-detail' });
  page.append(h('div', { class: 'skills-layout' }, list, view));

  async function loadList() {
    try { data = await api('/api/skills'); } catch (e) { list.replaceChildren(h('div', { class: 'empty' }, 'Could not read the skill folders: ' + e.message)); return; }
    if (!alive || !page.isConnected) return;   // the user went to another page while the list was read: leave the address alone
    if (!sel) {
      // the route's skill (any copy of that name when this agent has none), else the most recently used one
      const byName = nameArg && data.skills.find(r => r.name.toLowerCase() === nameArg.toLowerCase());
      const r = byName || [...data.skills].sort((a, b) => (b.usage?.last || 0) - (a.usage?.last || 0) || (b.inUse.length - a.inUse.length))[0];
      if (r) sel = { name: r.name, agent: byName && r.agents.some(a => a.agent === agentArg) ? agentArg : r.agents[0].agent };
      if (sel && location.hash !== href(sel.agent, sel.name)) history.replaceState(null, '', href(sel.agent, sel.name));
    }
    drawList();
    list.querySelector('.sk-item.on')?.scrollIntoView({ block: 'nearest' });
    if (sel && !detail) await loadDetail();
  }
  function rowsShown() {
    const s = q.trim().toLowerCase();
    return (data?.skills || []).filter(r => !s || r.name.toLowerCase().includes(s) || (r.description || '').toLowerCase().includes(s));
  }
  function filmsText(r) {
    const u = data.usage;
    if (!u.enabled) return null;
    if (!r.usage) return h('span', { class: 'counting', title: u.total ? `Reading the agents’ session files: ${u.done} of ${u.total}` : 'Reading the agents’ session files' }, 'counting…');
    return h('span', {}, `${r.usage.filmsCount} film${r.usage.filmsCount === 1 ? '' : 's'}`);
  }
  function drawList() {
    if (!data) return;
    const rows = rowsShown();
    count.textContent = String(data.skills.length);
    list.replaceChildren(...rows.map(r => {
      const on = sel && r.name === sel.name;
      return h('button', { class: 'sk-item' + (on ? ' on' : ''), role: 'listitem', 'aria-current': on ? 'true' : null, onclick: () => select(r.name, r.agents[0].agent) },
        h('div', { class: 'sk-top' }, h('span', { class: 'sk-name' }, r.name), r.inUse.length ? h('span', { class: 'badge approved', title: r.inUse.map(x => `${x.agentName}: ${x.title}`).join('\n') }, icon('spark'), 'In use now') : null),
        r.description ? h('div', { class: 'sk-desc' }, r.description) : null,
        h('div', { class: 'sk-meta' },
          h('span', { class: 'sk-agents', 'aria-label': 'Agents: ' + r.agents.map(a => AGENT_TITLE[a.agent]).join(', ') }, r.agents.map(a => chip(a.agent))),
          r.differs ? h('span', { class: 'sk-differs', title: 'The SKILL.md of these copies are not the same' }, 'differ') : null,
          filmsText(r), h('span', { class: 'spacer' }), r.usage ? h('span', { title: r.usage.last ? 'Last used ' + new Date(r.usage.last).toLocaleString('en-US') : 'Not used in a session VideoHub can read' }, r.usage.last ? ago(r.usage.last) : 'not used') : null));
    }));
    if (!rows.length) list.append(h('div', { class: 'n-empty' }, icon('search'), data.skills.length ? `No skill matches “${q}”.` : 'No skills found.', data.skills.length ? null : rootsNote()));
  }
  function rootsNote() {
    return h('div', { class: 'roots-note' }, 'VideoHub looks in:', (data.roots || []).map(r => h('div', { class: 'mono' }, `${r.label}: ${r.short}${r.exists ? '' : ' (not there)'}`)));
  }
  async function select(name, agent) {
    if (sel && sel.name === name && sel.agent === agent) return;
    sel = { name, agent }; file = 'SKILL.md'; detail = null;
    history.replaceState(null, '', href(agent, name));
    drawList(); view.scrollTop = 0;
    await loadDetail();
  }
  async function loadDetail() {
    const want = sel;
    view.replaceChildren(h('div', { class: 'sd-loading dim' }, icon('spin', { cls: 'spin' }), 'Opening ', want.name, '…'));
    try { detail = await api('/api/skills/' + encodeURIComponent(want.agent) + '/' + encodeURIComponent(want.name)); }
    catch (e) { if (sel === want) view.replaceChildren(h('div', { class: 'empty' }, 'Could not open this skill: ' + e.message)); return; }
    if (!alive || sel !== want) return;
    drawDetail();
    await showFile(file);
  }
  const viewerBody = h('div', { class: 'fv-body' }), viewerHead = h('div', { class: 'fv-head' });
  function drawDetail() {
    const d = detail, u = d.usage, us = d.usageState;
    const inUse = d.inUse || [];
    const copies = (d.copies.length ? d.copies : [{ agent: d.agent }]).slice().sort((a, b) => AGENT_ORDER.indexOf(a.agent) - AGENT_ORDER.indexOf(b.agent));
    const agentsBox = h('b', { class: 'sd-agents' }, copies.map(c => copies.length > 1
      ? h('button', { class: 'ag-chip ag-pick' + (c.agent === d.agent ? ' on' : ''), title: `Show ${AGENT_TITLE[c.agent]}’s copy (${c.where ? c.where + '/' : ''}${d.name})`, 'aria-pressed': String(c.agent === d.agent), onclick: () => select(d.name, c.agent) }, agentIcon(c.agent, 12), (AGENT_TITLE[c.agent] || c.agent).replace(/ \(.*\)$/, ''))
      : chip(c.agent, true)));
    const usedText = !us.enabled ? 'off' : !u ? 'counting…' : String(u.filmsCount);
    view.replaceChildren(
      h('div', { class: 'sd-head' },
        h('div', { class: 'sd-title' },
          h('span', { class: 'sd-icon' }, icon('bolt')),
          h('div', { class: 'sd-name' }, h('h2', {}, d.name, d.version ? h('span', { class: 'ver' }, 'v' + d.version) : null,
            inUse.length ? h('span', { class: 'badge approved', title: inUse.map(x => `${x.agentName}: ${x.title}`).join('\n') }, icon('spark'), 'In use now · ' + [...new Set(inUse.map(x => x.agentName))].join(', ')) : null),
          d.description ? h('p', { title: d.description }, d.description) : null),
          h('span', { class: 'spacer' }),
          h('button', { class: 'sm', title: d.dir, onclick: () => openSkill('folder') }, icon('reveal', { cls: 'il' }), 'Open folder'),
          h('button', { class: 'sm', title: 'Open SKILL.md with its default app', onclick: () => openSkill('editor') }, icon('code', { cls: 'il' }), 'Open in editor')),
        h('div', { class: 'sd-meta' },
          h('div', {}, h('span', {}, 'Agents'), agentsBox),
          h('div', {}, h('span', {}, 'Films'), h('b', { title: u ? `${u.uses} use${u.uses === 1 ? '' : 's'} in ${u.sessions} session${u.sessions === 1 ? '' : 's'}${u.outside ? `, ${u.outside} outside any film` : ''}` : '' }, usedText)),
          h('div', {}, h('span', {}, 'Last used'), h('b', {}, u?.last ? ago(u.last) : u ? 'never' : '—')),
          h('div', { class: 'sd-folder' }, h('span', {}, 'Folder'), h('b', { class: 'mono', title: d.dir }, d.short))),
        d.differs ? h('div', { class: 'sd-differs' }, icon('info'), `The SKILL.md in ${copies.map(c => AGENT_TITLE[c.agent].replace(/ \(.*\)$/, '')).join(', ')} are not the same; this is ${AGENT_TITLE[d.agent].replace(/ \(.*\)$/, '')}’s copy.`) : null),
      h('div', { class: 'sd-body' },
        h('div', { class: 'sd-left' },
          h('h4', {}, 'Files', h('span', {}, `${d.files}${d.treeCapped ? '+' : ''} · ${GB(d.size)}`)),
          h('div', { class: 'tree', role: 'tree' }, tree()),
          d.treeCapped ? h('div', { class: 'dim tree-cap' }, 'Large folder: only the first 2,000 entries are listed.') : null,
          h('h4', {}, 'Used in', u?.filmsCount ? h('span', {}, String(u.filmsCount)) : null),
          usedIn()),
        h('div', { class: 'sd-viewer' }, viewerHead, viewerBody)));
  }
  function usedIn() {
    const u = detail.usage, us = detail.usageState;
    if (!us.enabled) return h('div', { class: 'sd-films-empty' }, 'Usage is off: VideoHub reads the agents’ session files only while ', h('a', { href: '#/settings' }, 'Show agent activity'), ' is on.');
    if (!u) return h('div', { class: 'sd-films-empty' }, icon('spin', { cls: 'spin' }), us.total ? ` Counting… ${us.done} of ${us.total} sessions read.` : ' Counting…');
    if (!u.films.length) return h('div', { class: 'sd-films-empty' }, u.uses ? `Used ${u.uses} time${u.uses === 1 ? '' : 's'}, not in a film VideoHub knows.` : 'No session VideoHub can read used this skill.');
    return h('div', { class: 'sd-films' }, u.films.map(f => h('button', { class: 'sd-film', title: 'Open this film', onclick: () => openProject({ id: f.id, outputsCount: f.outputs || 0, latest: f.latest || null }) },
      h('span', { class: 'sd-film-ph' }, icon('video')), h('span', { class: 'sd-film-t' }, h('b', {}, f.title), h('small', {}, `${ago(f.last)}${f.uses > 1 ? ` · ${f.uses} uses` : ''}`)), icon('chevr'))),
      u.filmsCount > u.films.length ? h('div', { class: 'dim' }, `and ${u.filmsCount - u.films.length} more`) : null,
      u.outside ? h('div', { class: 'dim sd-outside' }, `${u.outside} use${u.outside === 1 ? '' : 's'} outside any film`) : null);
  }
  // the file tree: SKILL.md first, then folders (collapsible), then the other files
  function tree() {
    const entries = detail.tree, kids = new Map([['', []]]);
    for (const e of entries) { const parent = e.rel.includes('/') ? e.rel.slice(0, e.rel.lastIndexOf('/')) : ''; if (!kids.has(parent)) kids.set(parent, []); kids.get(parent).push(e); if (e.kind === 'dir' && !kids.has(e.rel)) kids.set(e.rel, []); }
    const sizeOf = rel => entries.filter(e => e.kind === 'file' && e.rel.startsWith(rel + '/')).reduce((s, e) => s + (e.size || 0), 0);
    const out = [];
    const at = (depth, e) => { e.style.setProperty('--d', String(depth)); return e; };   // (a custom property cannot be set through Object.assign)
    const walk = (dir, depth) => {
      const list = (kids.get(dir) || []).slice().sort((a, b) => (b.rel === 'SKILL.md') - (a.rel === 'SKILL.md') || (b.kind === 'dir') - (a.kind === 'dir') || a.rel.localeCompare(b.rel));
      for (const e of list) {
        const name = e.rel.split('/').pop(), key = detail.agent + '/' + detail.name + '/' + e.rel;
        if (e.kind === 'dir') {
          const isClosed = closed.has(key);
          out.push(at(depth, h('button', { class: 'tr-row tr-dir' + (isClosed ? ' closed' : ''), 'aria-expanded': String(!isClosed), onclick: () => { isClosed ? closed.delete(key) : closed.add(key); drawDetailKeepFile(); } },
            icon('chev', { cls: 'chev' }), icon('folder'), h('span', { class: 'tr-name' }, name + '/'), h('span', { class: 'tr-size' }, GB(sizeOf(e.rel))))));
          if (!isClosed) walk(e.rel, depth + 1);
        } else if (e.kind === 'link') {
          out.push(at(depth, h('div', { class: 'tr-row tr-link', title: e.outside ? 'A link that leads outside the skill folder: not shown' : 'A linked folder: not opened here' }, icon('warn'), h('span', { class: 'tr-name' }, name), h('span', { class: 'tr-size' }, e.outside ? 'outside' : 'link'))));
        } else {
          const ic = name === 'SKILL.md' ? 'book' : IMAGE_EXT.test(name) ? 'image' : MODEL_EXT.test(name) ? 'box' : /\.(m?js|cjs|ts|py|json|sh|ps1|mjs)$/i.test(name) ? 'code' : TEXT_EXT.test(name) ? 'doc' : 'file';
          out.push(at(depth, h('button', { class: 'tr-row' + (e.rel === file ? ' on' : ''), title: e.rel, 'aria-current': e.rel === file ? 'true' : null, onclick: () => showFile(e.rel) },
            icon(ic), h('span', { class: 'tr-name' }, name), h('span', { class: 'tr-size' }, GB(e.size || 0)))));
        }
      }
    };
    walk('', 0);
    return out;
  }
  function drawDetailKeepFile() { const y = view.scrollTop; drawDetail(); view.scrollTop = y; showFile(file, false); }
  async function showFile(rel, scroll = true) {
    file = rel;
    view.querySelectorAll('.tr-row[title]').forEach(b => { const on = b.title === rel; b.classList.toggle('on', on); if (on) b.setAttribute('aria-current', 'true'); else b.removeAttribute('aria-current'); });
    const entry = detail.tree.find(e => e.rel === rel);
    const k = detail.agent + '/' + detail.name + '/' + rel;
    viewerHead.replaceChildren(icon(/\.md$/i.test(rel) ? 'doc' : 'file'), h('span', { class: 'mono fv-path' }, rel), h('span', { class: 'spacer' }), entry ? h('span', { class: 'fv-size' }, GB(entry.size || 0)) : null, h('span', { class: 'fv-ro' }, icon('eye'), 'Read-only'));
    if (!entry) { viewerBody.replaceChildren(h('div', { class: 'dim' }, 'This skill has no ', rel, '.')); return; }
    let f = texts.get(k);
    if (!f) {
      viewerBody.replaceChildren(h('div', { class: 'dim' }, icon('spin', { cls: 'spin' }), ' Loading…'));
      try { f = await api('/api/skills/' + encodeURIComponent(detail.agent) + '/' + encodeURIComponent(detail.name) + '/file?path=' + encodeURIComponent(rel)); texts.set(k, f); }
      catch (e) { if (file === rel) viewerBody.replaceChildren(h('div', { class: 'empty' }, 'Could not read this file: ' + e.message)); return; }
    }
    if (file !== rel || !alive) return;
    if (f.kind === 'text' && /\.(md|markdown)$/i.test(rel)) viewerBody.replaceChildren(renderMarkdown(f.text));
    else if (f.kind === 'text') viewerBody.replaceChildren(h('pre', { class: 'plain' }, f.text));
    else {
      const what = IMAGE_EXT.test(f.name) ? ['image', 'Image'] : MODEL_EXT.test(f.name) ? ['box', '3D model'] : ['file', f.ext ? f.ext.toUpperCase() + ' file' : 'File'];
      viewerBody.replaceChildren(h('div', { class: 'bin-card' }, h('div', { class: 'bin-ic' }, icon(what[0])), h('div', {}, h('b', {}, f.name), h('span', {}, `${what[1]} · ${GB(f.size)}`), h('span', {}, f.reason || 'Not shown as text.'))));
    }
    if (scroll) viewerBody.scrollTop = 0;
  }
  async function openSkill(what) {
    try { await api('/api/skills/' + encodeURIComponent(detail.agent) + '/' + encodeURIComponent(detail.name) + '/open', { method: 'POST', body: { what } }); }
    catch (e) { toast(e.message, true); }
  }

  await loadList();
  // usage counts arrive when the background index finishes; "in use now" follows the agents' activity
  let t = null;
  const refresh = () => { clearTimeout(t); t = setTimeout(async () => {
    if (!alive || document.activeElement === search && q) return;
    try { data = await api('/api/skills'); } catch { return; }
    if (!alive) return;
    drawList();
    if (detail && sel) { const r = data.skills.find(x => x.name === sel.name); if (r) { detail.usage = r.usage; detail.inUse = r.inUse; detail.usageState = data.usage; const y = view.scrollTop; drawDetail(); view.scrollTop = y; showFile(file, false); } }
  }, 1500); };
  const offS = onHubEvent('skills', refresh), offA = onActivity(refresh);
  // while the first count runs, look again now and then
  const poll = setInterval(() => { if (data?.usage?.enabled && !data.usage.ready) refresh(); }, 8000);
  return () => { alive = false; offS(); offA(); clearInterval(poll); clearTimeout(t); };
}
