// Live source: plays a film from its own code instead of a video file. The film page (served by the hub at
// /live/<id>/...) draws any moment with window.renderOut(t) on fixed-size canvases. This object looks enough
// like an HTMLVideoElement (currentTime, play/pause, events, requestVideoFrameCallback) for the review player.
// While playing, the project's audio is the clock; frames that take too long are skipped, never slowed down.
import { h } from '../app.js';

export function createLiveSource(info, { onStatus } = {}) {
  const box = h('div', { class: 'livebox' });
  let waitTimer = 0, iframe = null, win = null, ready = false, t = 0, paused = true, rate = 1, seeking = false;
  let displayedTime = 0, destroyed = false, loadVersion = 0, seekVersion = 0, seekTimer = 0, playTimer = 0;
  let wantPlay = false;   // play asked for while the page was loading: start once it is ready
  let base = { t: 0, at: 0 }, raf = 0, need = false, rvfc = [], frames = 0, fpsAt = performance.now(), drawMs = 0, scale = 1;
  const audio = info.audio ? h('audio', { src: info.audio, preload: 'auto' }) : null;
  const src = new EventTarget();
  const fire = type => src.dispatchEvent(new Event(type));
  const status = s => onStatus && onStatus(s);
  const clampTime = value => Math.max(0, Math.min(info.dur, +value || 0));

  function clearSeek() {
    ++seekVersion; clearTimeout(seekTimer); seekTimer = 0;
    seeking = false; need = false;
  }

  function load() {
    if (destroyed) return;
    const version = ++loadVersion;
    clearTimeout(playTimer); playTimer = 0; rvfc = [];
    ready = false; status({ state: 'loading' });
    const f = h('iframe', { class: 'live', src: `${info.url}${info.url.includes('?') ? '&' : '?'}vh=${Date.now()}`, scrolling: 'no', tabindex: '-1' });
    f.style.width = info.w + 'px'; f.style.height = info.h + 'px'; f.style.transform = `scale(${scale})`;
    if (iframe) iframe.replaceWith(f); else box.append(f);
    iframe = f;
    const t0 = performance.now();
    clearInterval(waitTimer);
    const wait = waitTimer = setInterval(() => {
      if (destroyed || version !== loadVersion) return;
      try { win = iframe.contentWindow; } catch { win = null; }
      const err = win && win.__vhError;
      if (err) { clearInterval(wait); status({ state: 'error', error: err }); return; }
      if (win && win.READY === true && typeof win.renderOut === 'function') {
        clearInterval(wait); ready = true; status({ state: 'ready', ms: Math.round(performance.now() - t0) });
        if (wantPlay) playTimer = setTimeout(() => { playTimer = 0; if (!destroyed && version === loadVersion && wantPlay) play(); }, 50);
        // the page may know its own timing and size better (the 3D studio sets window.__config)
        let c = win.__config || win.VH_CONFIG;
        // no config: the page's DATA size, else its biggest canvas when its shape differs (a 9:16 film shown as 16:9
        // showed only its top square, Oct 28)
        if (!c && +win.DATA?.width && +win.DATA?.height) c = { width: +win.DATA.width, height: +win.DATA.height };
        if (!c) {
          const cv = [...win.document.querySelectorAll('canvas')].sort((a, b) => b.width * b.height - a.width * a.height)[0];
          if (cv && cv.width >= 64 && cv.height >= 64 && Math.abs(cv.width / cv.height - info.w / info.h) > 0.01) c = { width: cv.width, height: cv.height };
        }
        if (c) {
          if (+c.fps) info.fps = +c.fps; if (+c.duration) info.dur = +c.duration;
          const w = +(c.outWidth || c.width), hh = +(c.outHeight || c.height); if (w && hh) { info.w = w; info.h = hh; iframe.style.width = w + 'px'; iframe.style.height = hh + 'px'; }
        }
        present(); fire('loadedmetadata'); fire('timeupdate');
      } else if (performance.now() - t0 > 120000) { clearInterval(wait); status({ state: 'error', error: 'The page was not ready within 2 minutes (no READY signal).' }); }
    }, 100);
    f.addEventListener('load', () => { try { f.contentWindow.addEventListener('error', e => { f.contentWindow.__vhError = e.message; }); } catch { } });
    // keys pressed while the focus is inside the film page (a click that landed on it) still drive VideoHub (Space = play)
    f.addEventListener('load', () => { try {
      const fw = (e) => {
        if (e.target?.closest?.('input, textarea, select, [contenteditable]')) return;
        e.preventDefault(); e.stopPropagation();
        document.dispatchEvent(new KeyboardEvent(e.type, { key: e.key, code: e.code, shiftKey: e.shiftKey, ctrlKey: e.ctrlKey, altKey: e.altKey, metaKey: e.metaKey, repeat: e.repeat, bubbles: true, cancelable: true }));
      };
      f.contentWindow.addEventListener('keydown', fw, true); f.contentWindow.addEventListener('keyup', fw, true);
    } catch { } });
  }

  function draw() {
    if (!ready || destroyed) return;
    const a = performance.now();
    const at = t;
    try { win.renderOut(at); displayedTime = at; } catch (e) { status({ state: 'error', error: e.message }); return; }
    drawMs = drawMs * 0.8 + (performance.now() - a) * 0.2;
    frames++;
    const cbs = rvfc; rvfc = []; for (const cb of cbs) try { cb(performance.now(), { mediaTime: at }); } catch { }
  }

  function present() {
    const pending = seeking, version = seekVersion;
    draw();
    // A frame callback can request another seek; only complete the one just presented.
    if (pending && version === seekVersion && ready) {
      seeking = false; need = false; clearTimeout(seekTimer); seekTimer = 0;
      fire('seeked'); fire('timeupdate');
    }
  }
  // the film's clock: its own, unless the sound is really playing (loaded, not seeking); a sound still loading or stalled
  // used to hold the picture at its time (0) — now the picture goes on and the sound is brought to it once it can play
  // the film's clock is the picture's own: the sound never sets it (a big WAV in Edge "played" at 0 for seconds, then
  // jumped). The sound follows: moved to the picture when it drifts more than 0.2 s, checked twice a second.
  const clock = () => base.t + (performance.now() - base.at) / 1000 * rate;
  let syncAt = 0;
  function syncAudio() {
    const now = performance.now(); if (!audio || now - syncAt < 500) return; syncAt = now;
    if (audio.paused || audio.ended || audio.seeking || audio.readyState < 2) return;
    if (t < (audio.duration || Infinity) - 0.3 && Math.abs(audio.currentTime - t) > 0.2) try { audio.currentTime = t; } catch { }
  }
  function loop() {
    if (destroyed) return;
    raf = requestAnimationFrame(loop);
    if (!paused) {
      t = Math.min(info.dur, clock()); syncAudio();
      present(); if (frames % 6 === 0) fire('timeupdate');
      if (t >= info.dur - 1e-3) { pause(); fire('ended'); }
    } else if (need) { present(); }
    const now = performance.now();
    if (now - fpsAt > 1000) { status({ state: paused ? 'paused' : 'playing', fps: Math.round(frames * 1000 / (now - fpsAt)), drawMs: Math.round(drawMs) }); frames = 0; fpsAt = now; }
  }
  raf = requestAnimationFrame(loop);

  function play() {
    if (destroyed) return Promise.resolve();
    if (!ready) { const asked = wantPlay; wantPlay = true; status({ state: 'loading', note: 'will play when ready' }); if (!asked) fire('play'); return Promise.resolve(); }
    if (!paused) return Promise.resolve();   // HTMLVideoElement.play() is idempotent; never rewind to the last rendered frame.
    wantPlay = false;
    if (t >= info.dur - 1e-3) t = 0;
    paused = false; base = { t, at: performance.now() };
    if (audio) { try { audio.currentTime = t; audio.playbackRate = rate; } catch { } audio.play().catch(() => { }); }
    fire('play'); return Promise.resolve();
  }
  function pause() {
    const waited = wantPlay; wantPlay = false;
    if (paused) { if (waited) fire('pause'); return; }
    pauseAt(seeking ? t : displayedTime);
  }
  // Notes freeze the frame the user actually saw, even if a slow render left the clock several seconds ahead.
  function pauseAt(at) {
    if (destroyed) return;
    at = clampTime(at);
    if (paused && !wantPlay && !seeking && !need && t === at && displayedTime === at) return;
    const wasPlaying = !paused || wantPlay; wantPlay = false;
    t = at; paused = true; base = { t, at: performance.now() }; clearSeek();
    audio?.pause(); if (audio) try { audio.currentTime = t; } catch { }
    if (displayedTime !== t) draw();
    if (wasPlaying) fire('pause');
    fire('timeupdate');
  }

  // Copy the picture already on screen, without running the film or changing its time.
  function copyPicture(width) {
    const c = document.createElement('canvas'); c.width = width; c.height = Math.round(width * info.h / info.w);
    const g = c.getContext('2d'); g.fillStyle = '#000'; g.fillRect(0, 0, c.width, c.height);
    const k = c.width / info.w;
    for (const cv of win.document.querySelectorAll('canvas')) {
      const r = cv.getBoundingClientRect(); if (!r.width || !r.height || getComputedStyle(cv).display === 'none') continue;
      try { g.drawImage(cv, r.left * k, r.top * k, r.width * k, r.height * k); } catch { }
    }
    return c;
  }
  function snapDisplayed(width = 480) {
    if (!ready || destroyed) return null;
    try { return copyPicture(width); } catch { return null; }
  }
  // every frame of the page's canvases, stacked in page order, as one picture: snap() draws it into a canvas now
  // (the page must show that moment), encode() turns it into a JPEG data URL off the main thread
  function snap(at, width = 1280) {
    if (!ready || destroyed) return null;
    const keep = displayedTime;
    try {
      win.renderOut(clampTime(at));
      return copyPicture(width);
    } catch (e) { status({ state: 'error', error: e.message }); return null; }
    finally { try { win.renderOut(keep); } catch (e) { status({ state: 'error', error: e.message }); } }
  }
  const capture = (at, width) => snap(at, width)?.toDataURL('image/jpeg', 0.9) || null;

  Object.defineProperties(src, {
    displayedTime: { get: () => displayedTime },
    currentTime: { get: () => paused ? t : Math.min(info.dur, clock()), set: v => {
      if (destroyed) return;
      t = clampTime(v); base = { t, at: performance.now() };
      if (audio) try { audio.currentTime = t; } catch { }
      seeking = true; need = true; const version = ++seekVersion; clearTimeout(seekTimer);
      // Background windows may receive no animation frames; playing and paused seeks must both settle.
      seekTimer = setTimeout(() => {
        seekTimer = 0;
        if (destroyed || version !== seekVersion || !need || !ready) return;
        if (!paused) t = Math.min(info.dur, clock());
        present();
      }, 150);
      fire('seeking');
    } },
    paused: { get: () => paused && !wantPlay },
    win: { get: () => win },   // the page itself (scene editor: window.VH_EDIT)
    seeking: { get: () => seeking },
    ended: { get: () => t >= info.dur - 1e-3 },
    duration: { get: () => info.dur },
    videoWidth: { get: () => info.w }, videoHeight: { get: () => info.h },
    playbackRate: { get: () => rate, set: v => { const now = src.currentTime; rate = +v || 1; base = { t: now, at: performance.now() }; if (audio) audio.playbackRate = rate; } },
    volume: { get: () => audio ? audio.volume : 1, set: v => { if (audio) audio.volume = v; } },
    muted: { get: () => audio ? audio.muted : true, set: v => { if (audio) audio.muted = v; } },
  });
  Object.assign(src, {
    el: box, isLive: true, info, play, pause, pauseAt, capture, snap, snapDisplayed,
    requestVideoFrameCallback: cb => { if (destroyed) return 0; rvfc.push(cb); return rvfc.length; },
    // the film's sound file was rebuilt (scene editor sound levels): load it again, same moment
    // a fresh mix after a sound build; while playing it carries on from the clock (a new src pauses the element)
    reloadAudio() {
      if (!audio || !info.audio) return;
      audio.src = info.audio + (info.audio.includes('?') ? '&' : '?') + 'v=' + Date.now();
      const sync = () => { try { audio.currentTime = src.currentTime; audio.playbackRate = rate; } catch { } if (!paused && !destroyed) audio.play().catch(() => { }); };
      audio.addEventListener('loadedmetadata', sync, { once: true }); sync();
    },
    // the hub saw the code change: reload the page and come back to the same moment
    reload(nextInfo) {
      if (destroyed) return;
      const wasPlaying = !paused || wantPlay; pause(); clearSeek();
      if (nextInfo) {
        Object.assign(info, nextInfo);
        if (audio && info.audio) audio.src = info.audio + (info.audio.includes('?') ? '&' : '?') + 'v=' + Date.now();
      }
      load(); wantPlay = wasPlaying;
    },
    fit(w) { scale = w / info.w; if (iframe) iframe.style.transform = `scale(${scale})`; },
    destroy() { destroyed = true; ready = false; paused = true; wantPlay = false; ++loadVersion; clearInterval(waitTimer); clearTimeout(playTimer); clearSeek(); cancelAnimationFrame(raf); rvfc = []; audio?.pause(); if (audio) { audio.removeAttribute('src'); audio.load(); } iframe?.remove(); win = null; },
    // the review player calls these on <video>; nothing to do here
    removeAttribute() { }, load() { },
  });
  load();
  return src;
}
