import { agentName } from '../agent.js';
// "Render" in the live preview: the user decides to render (their rule: no render before they say so).
// The render goes through VideoHub's queue (one at a time, RAM protection). Full film, or, when the project can
// re-render parts and there are notes Claude fixed, only the parts those notes touch. Progress shows on the button.
import { h, api, toast, confirmBox, onHubEvent, folderButton } from '../app.js';

const FIXED = ['fixed', 'claude'];

export function createRenderButton(p, { notes }) {
  const id = p.id;
  const btn = h('button', { class: 'primary rv2-render', title: 'Render the film through the VideoHub queue' }, '🎬 Render');
  let job = null;   // this project's queued/running job
  let choosing = false;
  const show = () => {
    if (choosing) { btn.disabled = true; return; }
    if (!job || ['done', 'failed', 'cancelled'].includes(job.state)) { btn.disabled = false; btn.textContent = '🎬 Render'; return; }
    btn.disabled = true;
    btn.textContent = job.state === 'queued' ? `⏳ Render queued${job.waiting ? ' (waiting)' : ''}`
      : `⏳ Render ${Math.round((job.progress || 0) * 100)}%${job.etaSec ? ` · ${Math.max(1, Math.round(job.etaSec / 60))} min` : ''}`;
    btn.title = job.waiting || 'Rendering';
  };
  // a job of this project already in the queue (started by Claude or another window)
  api('/api/jobs').then(js => { job = js.find(j => j.project === id && ['queued', 'running'].includes(j.state)) || null; show(); }).catch(() => { });
  const off = onHubEvent('job', ev => {
    const j = ev?.job; if (!j || j.project !== id) return;
    const was = job; job = j; show();
    if (j.state === 'done' && was?.state !== 'done') toast(h('span', {}, `Render finished: ${j.output}${j.copiedTo ? ` · copy: ${j.copiedTo}` : ''} `, h('a', { href: `#/review/${id}/${encodeURIComponent(j.output)}` }, 'watch')));
    if (j.state === 'done' && j.copyError && was?.state !== 'done') toast('Could not copy: ' + j.copyError, true);
    if (j.state === 'failed' && was?.state !== 'failed') toast('Render failed: ' + (j.error || ''), true);
  });

  async function chooseRender() {
    const rc = await api(`/api/project/${id}/recipe`).catch(() => ({}));
    const ro = await api(`/api/project/${id}/render-options`).catch(() => ({}));
    const canFull = !!(p.studio || ro.script || rc.script);
    if (!canFull) { toast(`This project has no render script (render.js) that VideoHub can run. Ask ${agentName()} to render it.`, true); return; }
    const fixed = notes().filter(n => FIXED.includes(n.status)).map(n => n.id);
    const canPart = !!rc.chunkSec && fixed.length > 0 && (p.studio || p.family === 'A');
    // settings: only what this project's render understands, defaults from its recipe
    const set = { workers: ro.workers?.default || 2, fps: ro.fps?.default || null, codec: ro.codecDefault || 'auto' };
    const sel = (label, help, values, cur, onch, fmt = v => v) => h('label', { class: 'rset', title: help }, h('span', { class: 'dim' }, label),
      h('select', { onchange: e => onch(e.target.value) }, values.map(v => h('option', { value: v, selected: String(v) === String(cur) }, fmt(v)))));
    const fpsSel = ro.fps ? sel('FPS', 'Frames per second (fixed for partial renders: chunks must match)', [24, 25, 30, 50, 60].concat(ro.fps.default).filter((v, i, a) => a.indexOf(v) === i).sort((a, b) => a - b), set.fps, v => { set.fps = +v; updInfo(); }) : null;
    const settings = h('div', { class: 'rsets' },
      sel(p.studio ? 'Chrome instances' : 'Parallel', 'Render workers running at once (more workers need more RAM)', Array.from({ length: ro.workers?.max || 4 }, (_, i) => i + 1), set.workers, v => { set.workers = +v; }),
      fpsSel,
      ro.codecs ? sel('Encoder', ro.codecEnv ? 'auto: the graphics card when this PC has one that can encode video (same quality, usually faster), else the processor (x264). Default: Settings → Render speed.' : 'auto: NVENC with NVIDIA, otherwise x264 (AMD AMF is offered too, but it lost detail in tests)', ro.codecs, set.codec, v => { set.codec = v; }, v => ro.codecLabels?.[v] || v) : null);
    const mins = rc.env?.DUR ? Math.round(+rc.env.DUR / 60 * 10) / 10 : null;
    let mode = canPart ? 'partial' : 'full';
    const opt = (m, label, sub) => h('label', { class: 'row', style: { gap: '8px', alignItems: 'flex-start', margin: '6px 0' } },
      h('input', { type: 'radio', name: 'rmode', checked: mode === m, onchange: () => { mode = m; updInfo(); } }), h('div', {}, h('b', {}, label), h('div', { class: 'dim', style: { fontSize: '12.5px' } }, sub)));
    // what comes out and where
    const inf = ro.info || {}, next = inf.next || {};
    const MMSS = s => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;
    const fileEl = h('b', { class: 'mono' }), dirEl = h('span', { class: 'mono dim', style: { fontSize: '12px', wordBreak: 'break-all' } }), infoEl = h('div', { class: 'rfacts' });
    function updInfo() {
      const prev = mode === 'preview', fps = prev ? 30 : (mode === 'full' && set.fps) || inf.fps;
      const w = inf.w && (prev ? Math.round(inf.w / 2) : inf.w), hh = inf.h && (prev ? Math.round(inf.h / 2) : inf.h);
      const facts = [];
      if (w && hh) facts.push(['Size', `${w}×${hh}${hh > w ? ' · vertical' : hh === w ? ' · square' : ''}`]);
      if (fps) facts.push(['FPS', String(fps)]);
      if (inf.dur) facts.push(['Duration', MMSS(inf.dur) + (fps ? ` · ${Math.round(inf.dur * fps).toLocaleString('en-US')} frames` : '')]);
      let sec = null;
      if (mode === 'full' && inf.fullSec) sec = inf.fullSec * (fps && inf.fullFps ? fps / inf.fullFps : 1);
      if (mode === 'partial' && inf.partSecPerChunk && inf.chunkSec) sec = null;   // depends on the notes' parts: shown as per part
      if (sec) facts.push(['Estimated render', `~${Math.max(1, Math.round(sec / 60))} min (based on the last full render)`]);
      if (mode === 'partial' && inf.partSecPerChunk) facts.push(['Estimated render', `~${Math.max(1, Math.round(inf.partSecPerChunk))} s per chunk`]);
      if (inf.bytesPerSec && inf.dur) facts.push(['Estimated file size', `~${Math.max(1, Math.round(inf.bytesPerSec * inf.dur * (prev ? 0.3 : 1) * (fps && inf.fps ? fps / inf.fps : 1) / 1048576))} MB`]);
      infoEl.replaceChildren(...facts.map(([k, v]) => h('div', {}, h('span', { class: 'dim' }, k), h('b', {}, v))));
      fileEl.textContent = (prev ? next.preview : next.file) || '';
      dirEl.textContent = (prev ? next.previewDir : inf.dir) || '';
    }
    let copyTo = ''; try { copyTo = localStorage.getItem('vh-copyto-' + id) || ''; } catch { }
    let lastDir = ''; try { lastDir = localStorage.getItem('vh-copyto-last') || ''; } catch { }
    const copyIn = h('input', { type: 'text', value: copyTo, placeholder: 'not selected (project folder only)', oninput: e => { copyTo = e.target.value.trim(); }, style: { flex: '1', minWidth: '0' } });
    const pick = folderButton(() => copyTo || lastDir || null, (p) => { copyTo = p; copyIn.value = p; }, 'Which folder should the MP4 be saved to?', '📂 Choose folder…');
    const outBox = h('div', { class: 'rout' },
      h('div', {}, h('span', { class: 'dim' }, 'Output file: '), fileEl), h('div', {}, h('span', { class: 'dim', style: { fontSize: '12px' } }, 'Folder: '), dirEl),
      h('div', { class: 'row', style: { gap: '6px', marginTop: '6px', alignItems: 'center' } }, h('span', { class: 'dim', style: { fontSize: '12.5px', whiteSpace: 'nowrap' } }, 'Also save the MP4 to:'), copyIn, pick, h('button', { type: 'button', class: 'ghost', title: 'Do not copy', onclick: () => { copyTo = ''; copyIn.value = ''; } }, '✕')));
    updInfo();
    const ok = await confirmBox('Render', h('div', { class: 'rdialog' },
      canPart ? opt('partial', `Only the fixed parts (${fixed.length} note${fixed.length === 1 ? '' : 's'})`, 'Re-render the 2-second chunks touched by notes, then join the film. Review just the changes in the new version.') : null,
      opt('full', 'Full film', `Render the whole film again${mins ? ` (${mins} min film)` : ''}.`),
      ro.preview ? opt('preview', 'Quick preview', 'Half resolution, 30 fps: a faster render for checking the film before the final version.') : null,
      h('div', { class: 'rsec' }, 'Output'), infoEl,
      h('div', { class: 'rsec' }, 'Settings'), settings,
      h('div', { class: 'rsec' }, 'Save to'), outBox,
      h('p', { class: 'dim', style: { fontSize: '12.5px' } }, 'Added to the VideoHub queue (one render at a time, with RAM protection). Progress appears on this button.')), 'Render');
    if (!ok) return;
    try {
      const env = {};
      if (set.fps && mode === 'full' && set.fps !== ro.fps?.default) env.FPS = String(set.fps);
      if (ro.codecs && set.codec !== (ro.codecDefault || 'auto')) env[ro.codecEnv || 'CODEC'] = set.codec;
      job = await api('/api/jobs', { method: 'POST', body: { project: id, mode, notes: mode === 'partial' ? fixed : [], workers: set.workers, env, copyTo: copyTo || undefined } });
      try { if (copyTo) { localStorage.setItem('vh-copyto-' + id, copyTo); localStorage.setItem('vh-copyto-last', copyTo); } else localStorage.removeItem('vh-copyto-' + id); } catch { }
      show(); toast(mode === 'partial' ? `Partial render queued: ${job.chunks?.length || ''} chunks` : mode === 'preview' ? 'Preview render queued' : 'Full render queued');
      if (job.ramNote) toast(job.ramNote);
    } catch (e) { toast('Could not start render: ' + e.message, true); }
  }
  btn.onclick = async () => {
    if (choosing || btn.disabled) return;
    choosing = true;
    btn.disabled = true;
    try { await chooseRender(); }
    catch (e) { toast('Could not open render settings: ' + e.message, true); }
    finally { choosing = false; show(); }
  };
  return { el: btn, destroy: off };
}
