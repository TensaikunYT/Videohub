// Sound library at the top of the Sounds tab (P4): ready-made effects (made on this PC with the 3D studio's synth)
// and the user's sound folder (config.soundLibDir, default Documents\VideoHub\sounds). Search, ▶ listen (one at a time), "+" adds at the playhead,
// and every row can be dragged onto the timeline (application/x-vh-sound; timeline.js decides time, row and lane).
import { h, api, toast } from '../app.js';

const MAX_ROWS = 300;

export function createLibrary({ onAdd, onFile }) {
  const el = h('div', { class: 'lib' });
  const list = h('div', { class: 'lib-list' });
  const player = new Audio();
  let lib = null, tab = 'sfx', q = '', playing = null, building = false;
  player.addEventListener('ended', () => { playing = null; draw(); });

  const search = h('input', { type: 'search', class: 'lib-q', placeholder: 'Search sounds…', oninput: (e) => { q = e.target.value.toLocaleLowerCase('en-US'); draw(); } });
  const tabs = h('span', { class: 'segs' });
  el.append(h('div', { class: 'mx-head' }, h('b', { class: 'mx-title' }, '📚 Sound library'), tabs),
    h('div', { class: 'tl2-lrow' }, search, h('button', { class: 'ghost', title: 'Choose one or more sound files from your computer to add at the playhead', onclick: () => onFile?.() }, '📁 Add from file…')),
    list,
    h('div', { class: 'dim lib-hint' }, 'Drag a sound onto the timeline or click + to add it at the playhead. You can also drag sound files from your file manager.'));

  function stop() { player.pause(); playing = null; }
  function listen(x) {
    if (playing === x.file) { stop(); draw(); return; }
    player.src = '/api/sound-library/play?f=' + encodeURIComponent(x.file);
    player.play().then(() => { playing = x.file; draw(); }).catch(() => toast('Could not play sound', true));
  }
  async function build() {
    building = true; draw();
    try { lib = await api('/api/sound-library/build', { method: 'POST' }); } catch (e) { toast(e.message, true); }
    building = false; draw();
  }

  function draw() {
    const n = (k) => lib?.[k]?.length ?? 0;
    tabs.replaceChildren(...[['sfx', 'Built-in effects'], ['user', 'My folder']].map(([k, t]) =>
      h('button', { class: 'seg' + (tab === k ? ' on' : ''), onclick: () => { tab = k; draw(); } }, `${t} (${n(k)})`)));
    list.replaceChildren();
    if (!lib) { list.append(h('div', { class: 'dim' }, 'Loading…')); return; }
    if (tab === 'sfx' && lib.sfxReady === false) {
      list.append(h('div', { class: 'tl2-lrow' }, h('span', { class: 'dim' }, building ? 'Preparing effects (a few seconds)…' : 'Built-in effects are not available on this computer yet.'),
        building ? null : h('button', { class: 'primary', onclick: build }, 'Prepare effects')));
      return;
    }
    const all = (lib[tab] || []).filter((x) => !q || (x.name + ' ' + x.group).toLocaleLowerCase('en-US').includes(q));
    if (!all.length) { list.append(h('div', { class: 'dim' }, q ? 'No sounds match your search.' : tab === 'user' ? `No sounds in folder: ${lib.libDir || ''}` : 'No effects.')); return; }
    let last = null;
    for (const x of all.slice(0, MAX_ROWS)) {
      if (x.group !== last && tab === 'user') { list.append(h('div', { class: 'se-group' }, x.group || '/')); last = x.group; }
      const row = h('div', { class: 'se-item lib-item', draggable: 'true', title: 'Drag onto the timeline' },
        h('button', { class: 'ghost', title: playing === x.file ? 'Stop' : 'Listen', onclick: () => listen(x) }, playing === x.file ? '■' : '▶'),
        h('span', { class: 'se-name' }, x.name),
        h('span', { class: 'spacer' }),
        h('button', { class: 'ghost', title: 'Add at playhead', onclick: () => onAdd?.(x) }, '+'));
      row.addEventListener('dragstart', (e) => { e.dataTransfer.setData('application/x-vh-sound', JSON.stringify({ file: x.file, name: x.name, group: x.group })); e.dataTransfer.effectAllowed = 'copy'; });
      list.append(row);
    }
    if (all.length > MAX_ROWS) list.append(h('div', { class: 'dim' }, `+${all.length - MAX_ROWS} more sounds; narrow your search`));
  }

  async function reload() { lib = await api('/api/sound-library').catch(() => ({ sfx: [], user: [], sfxReady: true })); draw(); }
  draw(); reload();
  return { el, reload, destroy() { stop(); player.removeAttribute('src'); } };
}
