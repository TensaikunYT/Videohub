import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

// Run the real source with a controlled frame scheduler and same-origin film iframe.
// No film rendering, browser, audio file or running VideoHub server is required.
const source = fs.readFileSync(new URL('./live.js', import.meta.url), 'utf8')
  .replace(/^import .+;\r?$/gm, '')
  .replace('export function createLiveSource', 'function createLiveSource');

function harness({ ready = true } = {}) {
  let now = 0, sequence = 0, renderFailure = null, canvasFailure = false, visibleAt = null;
  const timeouts = new Map(), intervals = new Map(), animationFrames = new Map();
  const draws = [], statuses = [], iframes = [];
  const filmCanvas = {
    width: 1920, height: 1080,
    getBoundingClientRect() {
      if (canvasFailure) throw new Error('Canvas geometry unavailable');
      return { left: 0, top: 0, width: 1920, height: 1080 };
    }
  };
  const film = {
    READY: false,
    renderOut(at) {
      draws.push(at);
      if (renderFailure?.(at)) throw new Error('Film drawing failed');
      visibleAt = at;
    },
    document: { querySelectorAll: () => [filmCanvas] },
    addEventListener() {},
  };
  const audio = {
    paused: true, ended: false, seeking: false, readyState: 4, currentTime: 0, duration: 120,
    volume: 1, muted: false, playbackRate: 1, playCount: 0,
    play() { this.paused = false; this.playCount++; return Promise.resolve(); },
    pause() { this.paused = true; }, removeAttribute() {}, load() {},
  };
  const h = (tag, attrs = {}) => {
    if (tag === 'audio') return Object.assign(audio, attrs);
    const element = { style: {}, append() {}, replaceWith() {}, remove() { this.removed = true; }, addEventListener() {} };
    if (tag === 'iframe') { element.contentWindow = film; iframes.push(element); }
    return element;
  };
  const document = {
    createElement(tag) {
      assert.equal(tag, 'canvas');
      const canvas = { width: 0, height: 0, sample: null, toDataURL: () => 'data:image/jpeg;base64,test' };
      canvas.getContext = () => ({ fillRect() {}, drawImage() { canvas.sample = visibleAt; } });
      return canvas;
    }
  };
  const sandbox = {
    h, document, EventTarget, Event, performance: { now: () => now },
    getComputedStyle: () => ({ display: 'block' }),
    setInterval: fn => { const id = ++sequence; intervals.set(id, fn); return id; },
    clearInterval: id => intervals.delete(id),
    setTimeout: (fn, delay = 0) => { const id = ++sequence; timeouts.set(id, { fn, at: now + delay }); return id; },
    clearTimeout: id => timeouts.delete(id),
    requestAnimationFrame: fn => { const id = ++sequence; animationFrames.set(id, fn); return id; },
    cancelAnimationFrame: id => animationFrames.delete(id),
  };
  vm.createContext(sandbox); vm.runInContext(source, sandbox);
  const src = sandbox.createLiveSource({ url: '/film/index.html', audio: '/film/mix.wav', w: 1920, h: 1080, dur: 120, fps: 60 }, { onStatus: s => statuses.push(s) });
  const makeReady = () => { film.READY = true; for (const fn of [...intervals.values()]) fn(); };
  const advance = (milliseconds, flush = false) => {
    now += milliseconds;
    if (flush) {
      while (true) {
        const next = [...timeouts].find(([, item]) => item.at <= now);
        if (!next) break;
        timeouts.delete(next[0]); next[1].fn();
      }
    }
  };
  const frame = () => { const callbacks = [...animationFrames.values()]; animationFrames.clear(); for (const fn of callbacks) fn(now); };
  if (ready) makeReady();
  return { src, film, audio, draws, statuses, makeReady, advance, frame, timeouts, intervals, animationFrames, iframes,
    get visibleAt() { return visibleAt; },
    failRender: predicate => { renderFailure = predicate; }, failCanvas: value => { canvasFailure = value; },
  };
}

test('annotation pause freezes the displayed frame when the live clock is five seconds ahead', async () => {
  const h = harness(); await h.src.play(); h.advance(10_000); h.frame(); h.advance(5_000);
  assert.equal(h.src.currentTime, 15); assert.equal(h.src.displayedTime, 10);
  assert.throws(() => { h.src.displayedTime = 3; }, TypeError);
  const frameTimes = []; h.src.requestVideoFrameCallback((_, meta) => frameTimes.push(meta.mediaTime));
  const beforeFreeze = h.draws.length;
  h.src.pauseAt(h.src.displayedTime);
  assert.equal(h.src.paused, true); assert.equal(h.src.currentTime, 10); assert.equal(h.visibleAt, 10);
  assert.equal(h.audio.currentTime, 10); assert.equal(h.audio.paused, true); assert.deepEqual(frameTimes, []);
  assert.equal(h.draws.length, beforeFreeze, 'Freezing an already visible frame must not render it again');
  const drawCount = h.draws.length;
  h.src.pauseAt(10); h.src.pauseAt(10);
  assert.equal(h.draws.length, drawCount, 'Repeated click-freeze calls must not redraw the expensive film');
  h.advance(4_000); h.frame(); assert.equal(h.src.currentTime, 10);
  h.src.pauseAt(-3); assert.equal(h.src.currentTime, 0);
  h.src.pauseAt(999); assert.equal(h.src.currentTime, 120);
  h.src.destroy();
});

test('repeated play does not rewind the clock or restart audio and ordinary pause retains the picture', async () => {
  const h = harness(); let plays = 0; h.src.addEventListener('play', () => plays++);
  await h.src.play(); h.advance(10_000); h.frame(); h.advance(5_000);
  await h.src.play(); await h.src.play();
  assert.equal(h.src.currentTime, 15); assert.equal(plays, 1); assert.equal(h.audio.playCount, 1);
  h.src.pause(); assert.equal(h.src.currentTime, 10); assert.equal(h.visibleAt, 10);
  await h.src.play(); h.advance(1_000); h.frame(); assert.equal(h.src.displayedTime, 11);
  h.src.destroy();
});

test('playing seeks and paused seeks followed immediately by play both finish on the next frame', async () => {
  const h = harness(); let seeks = 0; h.src.addEventListener('seeked', () => seeks++);
  await h.src.play(); h.src.currentTime = 25; assert.equal(h.src.seeking, true);
  h.advance(100); h.frame();
  assert.equal(h.src.seeking, false); assert.equal(h.src.displayedTime, 25.1); assert.equal(seeks, 1);
  h.src.pause(); h.src.currentTime = 40; await h.src.play(); h.advance(100); h.frame();
  assert.equal(h.src.seeking, false); assert.equal(h.src.displayedTime, 40.1); assert.equal(seeks, 2);
  h.advance(1_000, true); assert.equal(seeks, 2, 'Completed seek fallbacks cannot fire again');
  h.src.destroy();
});

test('background seek fallbacks present only the latest target, including while playing', async () => {
  const h = harness(); const times = []; h.src.addEventListener('seeked', () => times.push(h.src.displayedTime));
  h.src.currentTime = 15; h.advance(80); h.src.currentTime = 35; h.advance(150, true);
  assert.equal(h.src.seeking, false); assert.deepEqual(times, [35]);
  await h.src.play(); h.src.currentTime = 50; h.advance(150, true);
  assert.equal(h.src.seeking, false); assert.deepEqual(times, [35, 50.15]);
  h.src.destroy();
});

test('a frame callback starting another seek cannot be completed by the older draw', () => {
  const h = harness(); let seeks = 0; h.src.addEventListener('seeked', () => seeks++);
  h.src.currentTime = 20;
  h.src.requestVideoFrameCallback(() => { h.src.currentTime = 45; });
  h.frame(); assert.equal(h.src.displayedTime, 20); assert.equal(h.src.seeking, true); assert.equal(seeks, 0);
  h.frame(); assert.equal(h.src.displayedTime, 45); assert.equal(h.src.seeking, false); assert.equal(seeks, 1);
  h.src.destroy();
});

test('annotation freeze cancels older seeks and their delayed callbacks', () => {
  const h = harness(); h.src.currentTime = 12; h.frame(); h.src.currentTime = 60;
  h.src.pauseAt(h.src.displayedTime);
  assert.equal(h.src.seeking, false); assert.equal(h.src.currentTime, 12);
  h.advance(5_000, true); h.frame(); assert.equal(h.visibleAt, 12); assert.equal(h.src.currentTime, 12);
  h.src.destroy();
});

test('snap restores the displayed picture and preserves pending playback state even when sampling fails', () => {
  const h = harness(); h.src.currentTime = 10; h.frame(); h.src.currentTime = 25;
  const sampled = h.src.snap(50);
  assert.equal(sampled.sample, 50); assert.equal(h.visibleAt, 10);
  assert.equal(h.src.currentTime, 25); assert.equal(h.src.displayedTime, 10); assert.equal(h.src.seeking, true);
  h.failRender(at => at === 50);
  assert.equal(h.src.snap(50), null); assert.equal(h.visibleAt, 10); assert.equal(h.src.currentTime, 25);
  h.failRender(null); h.failCanvas(true);
  assert.equal(h.src.snap(50), null); assert.equal(h.visibleAt, 10); assert.equal(h.src.currentTime, 25);
  h.failCanvas(false); h.frame(); assert.equal(h.src.displayedTime, 25); assert.equal(h.src.seeking, false);
  h.src.destroy();
});

test('displayed cover capture copies pixels without rendering, seeking or changing playback', async () => {
  const h = harness(); await h.src.play(); h.advance(10_000); h.frame(); h.advance(5_000);
  const draws = h.draws.length, clock = h.src.currentTime;
  const picture = h.src.snapDisplayed(480);
  assert.equal(picture.width, 480); assert.equal(picture.height, 270); assert.equal(picture.sample, 10);
  assert.equal(h.draws.length, draws); assert.equal(h.src.currentTime, clock);
  assert.equal(h.src.displayedTime, 10); assert.equal(h.src.paused, false);
  h.src.currentTime = 25;
  assert.equal(h.src.snapDisplayed().sample, 10); assert.equal(h.src.seeking, true);
  h.failCanvas(true); assert.equal(h.src.snapDisplayed(), null);
  assert.equal(h.draws.length, draws); assert.equal(h.src.currentTime, 25);
  h.src.destroy(); assert.equal(h.src.snapDisplayed(), null);
});

test('failed draws do not advertise a new displayed frame', () => {
  const h = harness(); h.src.currentTime = 10; h.frame(); h.failRender(at => at === 30);
  h.src.currentTime = 30; h.frame();
  assert.equal(h.src.displayedTime, 10); assert.equal(h.visibleAt, 10);
  assert.equal(h.statuses.at(-1).state, 'error');
  h.src.destroy();
});

test('metadata does not complete a seek started by its listener before the requested frame is drawn', () => {
  const h = harness({ ready: false }); let seeks = 0;
  h.src.addEventListener('loadedmetadata', () => { h.src.currentTime = 40; });
  h.src.addEventListener('seeked', () => seeks++);
  h.makeReady(); assert.equal(h.src.seeking, true); assert.equal(h.src.displayedTime, 0); assert.equal(seeks, 0);
  h.frame(); assert.equal(h.src.displayedTime, 40); assert.equal(h.src.seeking, false); assert.equal(seeks, 1);
  h.src.destroy();
});

test('newly ready sources publish their displayed time without pretending to complete a seek', () => {
  const h = harness({ ready: false }); const times = []; let seeks = 0;
  h.src.addEventListener('timeupdate', () => times.push(h.src.displayedTime));
  h.src.addEventListener('seeked', () => seeks++);
  h.makeReady();
  assert.deepEqual(times, [0]); assert.equal(h.src.displayedTime, 0); assert.equal(seeks, 0);
  h.src.destroy();
});

test('reload respects pausing during load and destroy cancels delayed play, seek and frame work', async () => {
  const h = harness(); await h.src.play(); h.advance(10_000); h.frame();
  h.src.reload(); h.src.pause(); h.makeReady(); h.advance(100, true); h.frame();
  assert.equal(h.src.paused, true); assert.equal(h.src.currentTime, 10); assert.equal(h.audio.playCount, 1);
  h.src.reload(); await h.src.play(); h.makeReady();
  assert.ok(h.timeouts.size > 0, 'Loading playback has a delayed start');
  h.src.currentTime = 60;
  const queuedFrames = [...h.animationFrames.values()]; const draws = h.draws.length;
  h.src.destroy(); h.advance(10_000, true); for (const fn of queuedFrames) fn();
  assert.equal(h.timeouts.size, 0); assert.equal(h.intervals.size, 0); assert.equal(h.animationFrames.size, 0);
  assert.equal(h.draws.length, draws); assert.equal(h.audio.playCount, 1); assert.equal(h.src.paused, true);
  assert.equal(h.src.snap(20), null); assert.equal(h.iframes.at(-1).removed, true);
});
