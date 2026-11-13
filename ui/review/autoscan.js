import { agentName } from '../agent.js';
// Automatic check of a live film, frame by frame, in the preview page that is already open: no render, no extra
// Chrome, no Claude, no tokens. Pages with window.qaFrame (3D studio engine/runtime.js) also report the camera inside
// a mesh, characters sunk into things and 2D labels without depth; every other live page gets the picture checks
// (black / white frames, flicker, one-frame pops, frozen picture, long holds, hard cuts). Same rules as engine/qa.mjs.
import { h, api, toast } from '../app.js';

const KIND = {
  lens: ['Camera inside an object', '#ff6b6b'], bones: ['Character embedded / underground', '#ff6b6b'],
  overlay: ['Text in front of 3D objects', '#ffb547'], acting: ['Character in default pose', '#ffb547'],
  flicker: ['Flicker', '#ffb547'], pop: ['One-frame pop', '#ffb547'],
  frozen: ['Frozen image', '#58a6ff'], hold: ['Still for 1.6 s+', '#58a6ff'],
  white: ['White / overexposed frame', '#d2a8ff'], black: ['Black frame', '#d2a8ff'], cut: ['Hard cut', '#8b949e'],
};
const TC = (s) => { const m = Math.floor(s / 60), r = s - m * 60; return `${m}:${r.toFixed(2).padStart(5, '0')}`; };
const N = 160 * 90;
const mad = (a, b) => { let s = 0; for (let i = 0; i < N; i++) s += Math.abs(a[i] - b[i]); return s / N; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function createAutoScan({ src, projectId, frame, panelHost, onOpen, onClose, reloadNotes }) {
  const btn = h('button', { hidden: true, title: 'Check the film frame by frame: camera inside objects, embedded characters, flicker, black frames… (no render, no tokens)', onclick: () => shown ? hide() : show() }, '🔍 Scan');
  const panel = h('div', { class: 'ascan-panel' });
  let shown = false, running = false, stop = false, report = null, prog = null, added = new Set();
  const win = () => { try { return src.win || null; } catch { return null; } };
  const fps = () => src.info?.fps || 30, dur = () => src.duration || src.info?.dur || 0;

  function check() { const w = win(); btn.hidden = !(w && typeof w.renderOut === 'function'); }
  async function show() {
    shown = true; btn.classList.add('on'); (panelHost || frame).append(panel); onOpen?.();
    if (!report) report = await api(`/api/project/${projectId}/autoscan`).catch(() => null);
    paint();
  }
  function hide() { if (running) stop = true; shown = false; btn.classList.remove('on'); panel.remove(); onClose?.(); }

  // one frame: the engine's own QA numbers, or a 160x90 luma picture of the page
  const thumb = h('canvas', { width: 160, height: 90 }), tg = thumb.getContext('2d', { willReadFrequently: true });
  function sample(t) {
    const w = win();
    if (typeof w.qaFrame === 'function') {
      const r = w.qaFrame(t), [p, q] = r.lum.split('|'), s = atob(p) + atob(q), buf = new Uint8Array(N);
      for (let i = 0; i < N; i++) buf[i] = s.charCodeAt(i);
      delete r.lum; r.lumBuf = buf; return r;
    }
    const cv = src.snap(t, 320); if (!cv) return null;
    tg.drawImage(cv, 0, 0, 160, 90);
    const px = tg.getImageData(0, 0, 160, 90).data, buf = new Uint8Array(N); let sum = 0;
    for (let i = 0; i < N; i++) { buf[i] = Math.round(px[i * 4] * 0.299 + px[i * 4 + 1] * 0.587 + px[i * 4 + 2] * 0.114); sum += buf[i]; }
    return { t, mean: sum / N, lumBuf: buf, bones: [], inside: 0, near: -1, shot: w.__qaShot ? w.__qaShot() : '' };
  }

  // the range to scan: whole film, or the shot on screen (from cut to cut, VH_EDIT.findCut)
  function shotRange() {
    const E = win()?.VH_EDIT, t = src.currentTime;
    if (E?.findCut) { const a = E.findCut(-1, t), b = E.findCut(1, t); return [a ? a.film : Math.max(0, t - 5), b ? b.film - 1 / fps() : Math.min(dur(), t + 5)]; }
    return [Math.max(0, t - 5), Math.min(dur(), t + 5)];
  }
  async function run(mode) {
    if (running) return;
    const jobs = await api('/api/jobs').catch(() => []);
    if (jobs.some((j) => j.state === 'running')) toast('A render is running: scanning may be slow');
    const F = fps(), [a, b] = mode === 'shot' ? shotRange() : [0, dur()], step = mode === 'quick' ? Math.max(1, Math.round(F / 4)) : 1;
    const frames = []; for (let f = Math.round(a * F); f <= Math.min(Math.round(b * F), Math.round(dur() * F) - 1); f += step) frames.push(f);
    if (!frames.length) return;
    const keep = src.currentTime; src.pause(); win()?.VH_EDIT?.freeStop?.();
    running = true; stop = false; prog = { done: 0, total: frames.length, t0: performance.now() }; paint();
    const res = [];
    try {
      // warm the state that carries from frame to frame (faces, marks), like a chunk render does
      const w = win(); for (let f = Math.max(0, frames[0] - Math.round(2 * F)); f < frames[0]; f += 2) w.renderOut(f / F);
      for (let i = 0; i < frames.length && !stop; i++) {
        const r = sample(frames[i] / F); if (r) { r.f = frames[i]; res.push(r); }
        prog.done = i + 1;
        if (i % 4 === 3) { paintProgress(); await sleep(0); }
      }
    } catch (e) { toast('Scan stopped: ' + e.message, true); }
    running = false;
    const cut = stop; stop = false;
    report = { at: new Date().toISOString(), mode, a, b: res.length ? res[res.length - 1].f / F : a, step, frames: res.length, partial: cut, qa: typeof win()?.qaFrame === 'function', ranges: analyze(res, step, F) };
    added = new Set();
    api(`/api/project/${projectId}/autoscan`, { method: 'PUT', body: report }).catch(() => { });
    src.currentTime = keep; paint();
    toast(`Scan finished: ${report.ranges.filter((r) => r.kind !== 'cut').length} ranges with issues${cut ? ' (stopped early)' : ''}`);
  }

  // engine/qa.mjs rules, merged into ranges per kind and shot
  function analyze(res, step, F) {
    const flags = [], flag = (kind, r, info = '') => flags.push({ kind, t: r.f / F, shot: r.shot || '', info });
    for (let k = 0; k < res.length; k++) {
      const r = res[k];
      if (r.inside > 0) flag('lens', r, `${r.insideName} (${r.inside}/35)`);
      else if (r.near >= 0 && r.near < 0.06) flag('lens', r, `surface is ${r.near} m from the lens (${r.nearName})`);
      for (const b of r.bones || []) flag('bones', r, `${b.name} ${b.kind === 'under' ? 'underground' : 'inside'}: ${b.mesh} (${b.d} m)`);
      if (r.mean > 228) flag('white', r, `brightness ${r.mean.toFixed(0)}`);
      if (r.mean < 6) flag('black', r, `brightness ${r.mean.toFixed(1)}`);
      if (r.extra && r.extra.rawPose) flag('acting', r, 'No act() key');
      if (r.overlay && r.overlay.noDepth > 0) flag('overlay', r, `${r.overlay.noDepth} items without depth`);
      if (k < 2) continue;
      const a = res[k - 2].lumBuf, b = res[k - 1].lumBuf, c = r.lumBuf;
      const dab = mad(a, b), dbc = mad(b, c), dac = mad(a, c);
      r.motion = dbc;
      if (dbc > 28) flag('cut', r, `change ${dbc.toFixed(0)}`);
      if (step !== 1) continue;
      if (dab > 6 && dbc > 6 && dac < Math.min(dab, dbc) * 0.35) flag('pop', res[k - 1], `${dab.toFixed(1)}/${dbc.toFixed(1)} → ${dac.toFixed(1)}`);
      if (k >= 3 && dab < 18 && dbc < 18) {
        const z = res[k - 3].lumBuf; let cnt = 0;
        for (let i = 0; i < N; i++) { const d0 = a[i] - z[i], d1 = b[i] - a[i], d2 = c[i] - b[i]; if (d0 * d1 < 0 && d1 * d2 < 0 && Math.min(Math.abs(d0), Math.abs(d1), Math.abs(d2)) > 6) cnt++; }
        if (cnt > 6) flag('flicker', res[k - 1], `${cnt} px`);
      }
    }
    if (step === 1) {
      let run = 0, low = 0;
      for (let k = 1; k < res.length; k++) {
        const m = res[k].motion ?? mad(res[k - 1].lumBuf, res[k].lumBuf);
        run = m < 0.02 ? run + 1 : 0; if (run === Math.round(0.2 * F)) flag('frozen', res[k], 'Same frame for 0.2 s+');
        low = m < 0.35 ? low + 1 : 0; if (low === Math.round(1.6 * F)) flag('hold', res[k], 'No motion for 1.6 s');
      }
    }
    const gap = Math.max(0.25, step / F * 1.5), ranges = [];
    for (const kind of Object.keys(KIND)) {
      for (const x of flags.filter((f) => f.kind === kind).sort((p, q) => p.t - q.t)) {
        const last = ranges[ranges.length - 1];
        if (last && last.kind === kind && x.shot === last.shot && x.t - last.t1 <= gap) { last.t1 = x.t; last.n++; if (!last.infos.includes(x.info) && last.infos.length < 3) last.infos.push(x.info); }
        else ranges.push({ kind, shot: x.shot, t0: +x.t.toFixed(3), t1: +x.t.toFixed(3), n: 1, infos: [x.info] });
      }
    }
    return ranges;
  }

  async function toNote(r, i) {
    const t = (r.t0 + r.t1) / 2, img = src.capture ? src.capture(t, 1280) : null;
    try {
      await api(`/api/project/${projectId}/notes`, { method: 'POST', body: { t: r.t0, t2: r.t1 > r.t0 ? r.t1 : null, at: t, file: '~live', fps: fps(), kind: 'visual', text: `Auto scan: ${KIND[r.kind][0]}${r.shot ? ' (' + r.shot + ')' : ''} — ${r.infos.join(' | ')}`, images: img ? { frame: img } : undefined } });
      added.add(i); paint(); toast('Note added'); reloadNotes?.();
    } catch (e) { toast('Could not add note: ' + e.message, true); }
  }

  // ---- panel
  const bar = h('div', { class: 'ascan-prog' }, h('i'));
  function paintProgress() {
    if (!prog) return;
    const el = (performance.now() - prog.t0) / 1000, left = prog.done ? (prog.total - prog.done) * el / prog.done : 0;
    bar.firstChild.style.width = (100 * prog.done / prog.total).toFixed(1) + '%';
    bar.title = `${prog.done}/${prog.total} frames · ~${Math.ceil(left)} s remaining`;
    const lab = panel.querySelector('.ascan-run'); if (lab) lab.textContent = `Scanning ${prog.done}/${prog.total} frames · ~${Math.ceil(left)} s remaining`;
  }
  const b = (label, title, fn, cls) => h('button', { class: cls || '', title, onclick: (e) => { e.stopPropagation(); fn(); } }, label);
  let showCuts = false;
  function paint() {
    if (!shown) return;
    panel.innerHTML = '';
    const head = h('div', { class: 'ascan-head' }, h('b', {}, '🔍 Auto scan'), h('span', { class: 'spacer' }), b('✕', 'Close', () => hide(), 'ghost'));
    if (running) { panel.append(head, h('div', { class: 'ascan-run dim' }, 'Scanning…'), bar, h('div', { class: 'ascan-row' }, b('■ Stop', 'Stop scanning here (keep results so far)', () => { stop = true; }, 'danger'))); paintProgress(); return; }
    const qa = typeof win()?.qaFrame === 'function';
    panel.append(head,
      h('div', { class: 'dim ascan-hint' }, qa ? 'Camera, character, text depth and image checks (engine QA rules).' : 'Image checks: black/white frames, flicker, pops, freezing.', ' No render, no tokens.'),
      h('div', { class: 'ascan-row' },
        b('Quick · full film', '4 frames per second: camera, characters, black/white frames, hard cuts', () => run('quick'), 'primary'),
        b('This scene · every frame', 'Every frame of the current scene, from cut to cut: also checks flicker, pops and freezing', () => run('shot')),
        b('Full · every frame', 'Every frame of the full film (takes longer)', () => run('full'))));
    if (!report) { panel.append(h('div', { class: 'dim' }, 'No scans yet.')); return; }
    const list = report.ranges.filter((r) => showCuts || r.kind !== 'cut'), nCut = report.ranges.length - report.ranges.filter((r) => r.kind !== 'cut').length;
    panel.append(h('div', { class: 'dim ascan-sum' },
      `${new Date(report.at).toLocaleString('en-US', { dateStyle: 'short', timeStyle: 'short' })} · ${report.mode === 'quick' ? 'quick' : report.mode === 'shot' ? 'single scene' : 'full'} · ${TC(report.a)}–${TC(report.b)} · ${report.frames} frames${report.partial ? ' · stopped early' : ''} · `,
      h('b', {}, `${list.filter((r) => r.kind !== 'cut').length} issues`),
      nCut ? h('label', { class: 'ascan-cuts' }, h('input', { type: 'checkbox', checked: showCuts, onchange: (e) => { showCuts = e.target.checked; paint(); } }), ` ${nCut} hard cuts`) : null));
    // a strip of the whole film with a tick per range
    const strip = h('canvas', { class: 'ascan-strip', width: 600, height: 26, title: 'Click to jump to that time' });
    const D = dur() || 1, g = strip.getContext('2d');
    g.fillStyle = 'rgba(255,255,255,.06)'; g.fillRect(0, 0, 600, 26);
    g.fillStyle = 'rgba(255,255,255,.12)'; g.fillRect(report.a / D * 600, 0, Math.max(2, (report.b - report.a) / D * 600), 26);
    for (const r of list) { g.fillStyle = KIND[r.kind][1]; g.fillRect(r.t0 / D * 600 - 1, 3, Math.max(2, (r.t1 - r.t0) / D * 600 + 2), 20); }
    g.fillStyle = '#fff'; g.fillRect(src.currentTime / D * 600 - 1, 0, 2, 26);
    strip.onclick = (e) => { const rc = strip.getBoundingClientRect(); src.currentTime = (e.clientX - rc.left) / rc.width * D; setTimeout(paint, 200); };
    panel.append(strip);
    if (!list.length) { panel.append(h('div', { class: 'ascan-ok' }, '✓ No issues found in this range.')); return; }
    panel.append(h('div', { class: 'ascan-list' }, list.map((r) => {
      const i = report.ranges.indexOf(r);
      return h('div', { class: 'ascan-item', onclick: () => { src.currentTime = r.t0 + 0.5 / fps(); } },
        h('span', { class: 'ascan-dot', style: { background: KIND[r.kind][1] } }),
        h('div', { class: 'ascan-txt' },
          h('div', {}, h('b', {}, KIND[r.kind][0]), h('span', { class: 'dim' }, ` · ${TC(r.t0)}${r.t1 > r.t0 ? '–' + TC(r.t1) : ''}${r.shot ? ' · ' + r.shot : ''}${r.n > 1 ? ' · ×' + r.n : ''}`)),
          h('div', { class: 'dim mono ascan-info', title: r.infos.join('\n') }, r.infos.join(' | '))),
        added.has(i) ? h('span', { class: 'dim' }, '✓ note') : b('→ note', `Create a VideoHub note (you can send it to ${agentName()})`, () => toNote(r, i), 'ghost'));
    })));
  }

  src.addEventListener('loadedmetadata', check);
  return { el: btn, check, destroy() { stop = true; panel.remove(); src.removeEventListener('loadedmetadata', check); } };
}
