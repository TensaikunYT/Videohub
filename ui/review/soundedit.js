// Added sounds under the timeline (Nov 6, the user: "removing music and adding sound effects should be possible from the UI").
// "➕ Add sound" picks a ready-made effect (made on this PC with the 3D studio's synth), a file from the user's sound
// folder (config.soundLibDir: music beds…) or any file from disk; it lands at the playhead. The clip lanes of
// the timeline show them (drag = move, edges = trim, top corners = fades, Alt+drag = copy; timeline.setClipOps); the
// Clip tab edits the selected one (level, fades, trim, length, loop, mute, copy, delete). Every change is one undo step
// (history.js), saved to tweaks.json "audio" with PATCH (only that key), then the sound is rebuilt through the review
// page's apply queue (stems/all: by itself a moment later; 3D studio: "💾 Apply to film").
import { h, api, toast, confirmBox } from '../app.js';
import { createHistory } from './history.js';
import { assignLane, clipLen } from './tracks.js';

const AUD = /\.(wav|mp3|m4a|ogg|flac|aac)$/i, BIG = 35 * 1024 * 1024;

const TC = (s) => { s = Math.max(0, +s || 0); const m = Math.floor(s / 60); return `${m}:${(s - m * 60).toFixed(2).padStart(5, '0')}`; };
const parseTC = (v) => { const m = /^(?:(\d+):)?(\d+(?:[.,]\d+)?)$/.exec(String(v).trim()); return m ? (+(m[1] || 0)) * 60 + +m[2].replace(',', '.') : null; };
const newId = () => 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);

// a clip from an audio-clip response: kind 'music' / 'sfx' as asked, else a file over 20 s is music
export function newClip(r, { kind = null, t = 0, lane } = {}) {
  const isMusic = kind === 'music' || (kind == null && r.dur > 20);
  return { id: newId(), name: r.name, src: r.src, kind: isMusic ? 'music' : 'sfx', t: +(+t || 0).toFixed(3), gain: isMusic ? 0.35 : 0.6, fin: isMusic ? 1.5 : 0, fout: isMusic ? 2 : 0, trim: 0, len: null, loop: false, mute: false, dur: r.dur || 0, ...(Number.isInteger(lane) ? { lane } : {}) };
}

// onClips(loaded): the clip list changed (loaded = first load from tweaks.json); the live mixer plays them until built
export function createSoundEditor({ projectId, timeline, dur, time, seek, fps = () => 60, applyQueue, status, onSelect, onPush, onClips }) {
  const el = h('div', { class: 'tl2-layers se-row' });
  let info = null, clips = [], sel = null, saveTimer = 0, saving = false, pending = false, lastSaved = '[]', disabled = '';
  const byId = (id) => clips.find((c) => c.id === id);
  const history = createHistory({
    snapshot: () => JSON.stringify(clips),
    restore: (s) => { clips = JSON.parse(s); if (sel && !byId(sel)) { sel = null; onSelect?.(null); } changed(); },
    onPush: () => onPush?.(),
  });
  const edit = (fn) => { history.push(); fn(); changed(); };

  function paint() {
    el.innerHTML = '';
    if (disabled) { el.append(h('span', { class: 'dim' }, disabled)); return; }
    const head = h('div', { class: 'tl2-lrow' },
      h('span', { class: 'dim' }, 'Added sounds:'), h('b', {}, String(clips.length)),
      h('button', { class: 'ghost', title: 'Add a sound effect or music at the playhead', onclick: () => openPicker() }, '➕ Add sound'),
      pending || saving ? h('span', { class: 'dim' }, 'saving…') : null,
      status?.() || null);
    el.append(head);
    const c = sel && byId(sel);
    if (!c) { if (clips.length) el.append(h('div', { class: 'tl2-lrow dim' }, 'Click a sound in the timeline’s "Added" row to open its settings here. Drag: move · edges: trim · top corners: fade in/out · Alt+drag: copy · Delete: delete · Alt+← →: move 1 frame.')); return; }
    const num = (label, key, step, min, max, fmt, title) => {
      const inp = h('input', { type: 'number', step, min, max, value: c[key] ?? 0, title, style: { width: '64px' },
        onchange: (e) => { const v = +e.target.value; if (Number.isFinite(v)) edit(() => { c[key] = Math.max(min, Math.min(max, v)); }); } });
      return h('label', { class: 'se-f' }, label, inp, fmt ? h('span', { class: 'dim' }, fmt) : null);
    };
    const gainOut = h('span', { class: 'tl2-lval' }, Math.round((c.gain ?? 1) * 100) + '%');
    let sliding = false;
    const startIn = h('input', { type: 'text', value: TC(c.t), style: { width: '78px' }, title: 'Start (min:s)', onchange: (e) => { const v = parseTC(e.target.value); if (v != null) edit(() => { c.t = v; }); else e.target.value = TC(c.t); } });
    el.append(h('div', { class: 'tl2-lrow se-sel' },
      h('b', {}, (c.kind === 'music' ? '♪ ' : '') + c.name),
      h('label', { class: 'se-f' }, 'Start', startIn),
      h('button', { class: 'ghost', title: 'Move to playhead', onclick: () => edit(() => { c.t = +time().toFixed(3); }) }, '⇤ here'),
      h('button', { class: 'ghost', title: 'Go to the start of the sound', onclick: () => seek(c.t + 0.001) }, '▶ start'),
      h('label', { class: 'se-f' }, 'Level', h('input', { type: 'range', min: 0, max: 200, step: 5, value: Math.round((c.gain ?? 1) * 100),
        oninput: (e) => { if (!sliding) { history.push(); sliding = true; } c.gain = +e.target.value / 100; gainOut.textContent = e.target.value + '%'; }, onchange: () => { sliding = false; changed(); } }), gainOut),
      num('Fade in', 'fin', 0.05, 0, 30, 's', 'Fade-in duration'),
      num('Fade out', 'fout', 0.05, 0, 30, 's', 'Fade-out duration'),
      num('Trim start', 'trim', 0.05, 0, 9999, 's', 'Amount to skip at the start of the file'),
      h('label', { class: 'se-f', title: 'Blank = whole file (when looping: until the end of the film)' }, 'Length',
        h('input', { type: 'number', step: 0.1, min: 0, value: c.len ?? '', placeholder: 'whole file', style: { width: '70px' }, onchange: (e) => edit(() => { c.len = e.target.value === '' ? null : Math.max(0.05, +e.target.value); }) }), h('span', { class: 'dim' }, 's')),
      h('label', { class: 'se-f' }, h('input', { type: 'checkbox', checked: !!c.loop, onchange: (e) => edit(() => { c.loop = e.target.checked; }) }), 'Loop'),
      h('label', { class: 'se-f' }, h('input', { type: 'checkbox', checked: !!c.mute, onchange: (e) => edit(() => { c.mute = e.target.checked; }) }), 'Mute'),
      h('button', { class: 'ghost', title: 'Add a copy at the playhead', onclick: () => duplicateAtPlayhead(c.id) }, '⧉ duplicate'),
      h('button', { class: 'ghost danger', onclick: async () => { if (!await confirmBox('Remove sound', h('div', {}, `Remove "${c.name}" from the film? (The file stays in the film’s vhaudio folder.)`), 'Remove')) return; remove(c.id); } }, '🗑 remove')));
  }

  // ---- P4: sounds dropped on the timeline (library item or files from Explorer / Finder) or added from the library list
  // one file from the user's disk → the film's vhaudio/ (as a dataURL up to 35 MB, streamed raw above)
  async function uploadFile(f) {
    if (f.size > BIG) {
      const r = await fetch(`/api/project/${projectId}/audio-upload?name=${encodeURIComponent(f.name)}&size=${f.size}`, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: f });
      const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || r.statusText); return j;
    }
    const data = await new Promise((ok, no) => { const rd = new FileReader(); rd.onload = () => ok(rd.result); rd.onerror = () => no(rd.error); rd.readAsDataURL(f); });
    return api(`/api/project/${projectId}/audio-clip`, { method: 'POST', body: { name: f.name, data } });
  }
  // several files go one after another from t; the whole batch is one undo step
  async function dropAdd({ item, files, t, kind = null, lane }) {
    if (disabled) { toast(disabled, true); return; }
    let jobs;
    if (item?.file) jobs = [{ lib: item }];
    else {
      const ok = (files || []).filter((f) => AUD.test(f.name));
      if (!ok.length) { toast('Audio files only: wav, mp3, m4a, ogg, flac, aac', true); return; }
      if (ok.length < files.length) toast('Skipped non-audio files', true);
      jobs = ok.map((f) => ({ f }));
    }
    const added = []; let at = +t || 0;
    for (const j of jobs) {
      try {
        if (j.f && j.f.size > 4 * 1024 * 1024) toast(`Uploading "${j.f.name}"…`);
        const r = j.lib ? await api(`/api/project/${projectId}/audio-clip`, { method: 'POST', body: { file: j.lib.file } }) : await uploadFile(j.f);
        const k = kind || (j.lib && /music|m\u00fczik|bg|bed/i.test(j.lib.group || '') ? 'music' : null);
        const c = newClip(r, { kind: k, t: at });
        if (Number.isInteger(lane) && c.kind === kind) c.lane = lane;
        added.push(c); at = c.t + Math.max(0.05, clipLen(c, dur()));
      } catch (e) { toast('Could not add sound: ' + e.message, true); }
    }
    if (!added.length) return;
    history.push();
    for (const c of added) { if (!Number.isInteger(c.lane)) c.lane = assignLane(clips, c, dur()); clips.push(c); }
    sel = added[added.length - 1].id; changed(); onSelect?.(sel);
    toast(added.length === 1 ? `Added "${added[0].name}" at ${TC(added[0].t)}` : `Added ${added.length} sounds`);
  }

  function duplicateAtPlayhead(id) {
    const c = byId(id); if (!c) return null;
    history.push();
    const d = { ...c, id: newId(), t: +time().toFixed(3) }; delete d.lane; d.lane = assignLane(clips, d, dur());
    clips.push(d); sel = d.id; changed(); onSelect?.(d.id);
    return d.id;
  }
  function remove(id) {
    const c = byId(id); if (!c) return false;
    history.push(); clips = clips.filter((x) => x !== c);
    if (sel === id) { sel = null; onSelect?.(null); }
    changed(); return true;
  }
  function select(id) { sel = id && byId(id) ? id : null; timeline.selectClip(sel); paint(); onSelect?.(sel); }

  // ---- saving: tweaks.json "audio" (PATCH, only this key), then the apply queue rebuilds the sound
  function changed() { timeline.setClips(clips, hooks); timeline.selectClip(sel); clearTimeout(saveTimer); pending = true; paint(); saveTimer = setTimeout(save, 400); onClips?.(false); }
  async function save() {
    saveTimer = 0;
    if (saving) return;   // the running save looks again when it ends
    const want = JSON.stringify(clips);
    if (want === lastSaved) { pending = false; paint(); return; }
    saving = true; pending = false; paint();
    try {
      await api(`/api/project/${projectId}/tweaks`, { method: 'PATCH', body: { audio: { clips } } });
      lastSaved = want;
      applyQueue?.request('clips');
    } catch (e) { toast('Could not save sound: ' + e.message, true); lastSaved = want; }
    saving = false; paint();
    if (!saveTimer && JSON.stringify(clips) !== lastSaved) save();
  }
  const hooks = {
    select: (id) => { sel = id; paint(); onSelect?.(id); },
    moving: () => { },
    moved: () => changed(),
  };
  // the timeline's clip gestures: one undo step per gesture (armed at press, pushed on the first real change)
  const ops = {
    begin: () => history.arm(),
    move: (id, patch) => { const c = byId(id); if (!c) return; history.touch(); Object.assign(c, patch); },
    end: () => changed(),
    remove: (id) => remove(id),
    pick: (kind) => { if (!disabled) openPicker(kind); },
    duplicate: (id) => { const c = byId(id); if (!c) return null; history.touch(); const d = { ...c, id: newId() }; clips.push(d); sel = d.id; onSelect?.(d.id); return d.id; },
  };

  // ---- the picker: ready-made effects, the user's sound folder, a file from disk
  async function openPicker(pickKind = null) {   // pickKind: a row header's ➕ (music / sfx) decides the kind
    const bg = h('div', { class: 'modal-bg' }), box = h('div', { class: 'modal se-picker' });
    bg.append(box); (document.fullscreenElement || document.body).append(bg);   // in fullscreen only the fullscreen element shows
    const close = () => { player.pause(); bg.remove(); };
    bg.addEventListener('mousedown', (e) => { if (e.target === bg) close(); });
    const player = new Audio();
    let lib = null, tab = 'sfx', q = '';
    const list = h('div', { class: 'se-list' }), search = h('input', { type: 'search', placeholder: 'Search…', oninput: (e) => { q = e.target.value.toLocaleLowerCase('en-US'); draw(); } });
    const fileIn = h('input', { type: 'file', accept: 'audio/*,.wav,.mp3,.m4a,.ogg,.flac,.aac', hidden: true, onchange: () => upload(fileIn.files[0]) });
    const tabs = h('div', { class: 'row', style: { gap: '6px' } });
    async function load() {
      lib = await api('/api/sound-library').catch(() => ({ sfx: [], user: [] }));
      if (!lib.sfxReady) { list.innerHTML = ''; list.append(h('div', { class: 'dim' }, 'Preparing built-in effects (first time, a few seconds)…')); try { lib = await api('/api/sound-library/build', { method: 'POST' }); } catch (e) { toast(e.message, true); } }
      draw();
    }
    function draw() {
      tabs.innerHTML = '';
      for (const [k, t] of [['sfx', `Built-in effects (${lib?.sfx.length ?? 0})`], ['user', `My sounds folder (${lib?.user.length ?? 0})`]]) tabs.append(h('button', { class: tab === k ? 'primary' : '', onclick: () => { tab = k; draw(); } }, t));
      tabs.append(h('button', { onclick: () => fileIn.click() }, '📁 Upload file…'));
      list.innerHTML = '';
      const rows = (lib ? lib[tab] : []).filter((x) => !q || (x.name + ' ' + x.group).toLocaleLowerCase('en-US').includes(q));
      if (!rows.length) list.append(h('div', { class: 'dim' }, tab === 'user' ? `No sounds in folder: ${lib?.libDir || ''}` : 'No effects.'));
      let lastGroup = null;
      for (const x of rows) {
        if (x.group !== lastGroup && tab === 'user') { list.append(h('div', { class: 'se-group' }, x.group || '/')); lastGroup = x.group; }
        list.append(h('div', { class: 'se-item' },
          h('button', { class: 'ghost', title: 'Listen', onclick: () => { player.src = '/api/sound-library/play?f=' + encodeURIComponent(x.file); player.play().catch(() => { }); } }, '▶'),
          h('span', { class: 'se-name' }, x.name),
          h('span', { class: 'spacer' }),
          h('button', { class: 'primary', onclick: () => add({ file: x.file }, pickKind || (/music|m\u00fczik|bg|bed/i.test(x.group || '') ? 'music' : null)) }, 'Add')));
      }
    }
    async function add(body, kind) {
      try {
        const r = await api(`/api/project/${projectId}/audio-clip`, { method: 'POST', body });
        const c = newClip(r, { kind, t: time() });
        c.lane = assignLane(clips, c, dur());
        history.push(); clips.push(c); sel = c.id; close(); changed(); onSelect?.(c.id);
        toast(`Added "${c.name}" at ${TC(c.t)}`);
      } catch (e) { toast('Could not add sound: ' + e.message, true); }
    }
    function upload(f) {
      if (!f) return;
      if (f.size > 500 * 1024 * 1024) return toast('File is larger than 500 MB', true);
      close(); dropAdd({ files: [f], t: time(), kind: pickKind });   // > 35 MB goes through audio-upload
    }
    box.append(h('div', { class: 'row' }, h('h1', {}, '➕ Add sound'), h('span', { class: 'spacer' }), h('button', { class: 'ghost', onclick: close }, '✕')),
      h('div', { class: 'sub' }, `The sound is added at the playhead (${TC(time())}); you can then drag it in the timeline. The file is copied to the film’s folder.`),
      tabs, search, list, fileIn);
    load();
  }

  return {
    el,
    async init() {
      [info] = await Promise.all([api(`/api/project/${projectId}/sound-info`).catch(() => null)]);
      if (!info || info.mode === 'none') { disabled = 'Cannot add sound: ' + (info?.reason || 'film audio not found'); paint(); return; }
      const tw = await api(`/api/project/${projectId}/tweaks`).catch(() => ({}));
      clips = Array.isArray(tw.audio?.clips) ? tw.audio.clips : [];
      lastSaved = JSON.stringify(clips);
      timeline.setClips(clips, hooks); timeline.setClipOps?.(ops); paint(); onClips?.(true);
    },
    refresh: () => paint(),
    dropAdd, pickFile: () => { const fi = h('input', { type: 'file', multiple: true, accept: 'audio/*,.wav,.mp3,.m4a,.ogg,.flac,.aac', onchange: () => dropAdd({ files: [...fi.files], t: time() }) }); fi.click(); },
    undo: () => history.undo(),
    redo: () => history.redo(),
    canUndo: () => history.canUndo(),
    remove, select, add(c) { history.push(); if (!Number.isInteger(c.lane)) c.lane = assignLane(clips, c, dur()); clips.push(c); sel = c.id; changed(); onSelect?.(c.id); },
    clips: () => clips,
    selected: () => (sel && byId(sel)) || null,
    duplicateAtPlayhead,
    // Alt+← / →: the selected clip n frames earlier / later (one undo step each)
    nudge(frames) { const c = sel && byId(sel); if (!c) return false; edit(() => { c.t = Math.max(0, +(c.t + frames / (fps() || 60)).toFixed(4)); }); return true; },
    // the Added sounds level (mixer): every clip's gain × f, one undo step
    scaleGains(f) { if (!clips.length || !(f >= 0) || Math.abs(f - 1) < 0.004) return false; edit(() => { for (const c of clips) c.gain = Math.max(0, Math.min(4, +((c.gain ?? 1) * f).toFixed(3))); }); toast(`All added sounds turned ${f < 1 ? 'down' : 'up'} to ${Math.round(f * 100)}% of their previous level`); return true; },
    flush() { if (saveTimer) { clearTimeout(saveTimer); save(); } },
    destroy() { if (saveTimer) { clearTimeout(saveTimer); save(); } },
  };
}
