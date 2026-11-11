// One queue for rebuilding the film's sound after a level / clip / duck change (review.js creates it).
//   stems / all  request() debounces (1.2 s), then builds; changes while it builds cause exactly one more build after
//   studio       the engine's build takes minutes: request() only marks it dirty; "💾 Apply to film" calls applyNow()
//   none         nothing to build
// Pure apart from the injected apply() and timers (applyqueue.test.js).
export function createApplyQueue({ apply /* () => Promise<result> */, mode /* () => 'stems'|'all'|'studio'|'none'|null */, delay = 1200, onBuilt, onBusy, onError, timers = { set: (f, ms) => setTimeout(f, ms), clear: t => clearTimeout(t) } }) {
  let timer = 0, running = null, queued = null, dirty = false;
  const auto = () => ['stems', 'all'].includes(mode());
  const notify = () => onBusy?.({ busy: !!running || !!queued, dirty });
  function launch() {
    timers.clear(timer); timer = 0; dirty = false;
    const p = Promise.resolve().then(() => apply()).then(r => { onBuilt?.(r); return r; }, e => { onError?.(e); throw e; });
    running = p; notify();
    const done = () => {
      if (running === p) running = null;
      if (queued) return;
      notify();
      if (dirty && auto() && !timer) launchOrQueue().catch(() => { });   // changed while it built
    };
    p.then(done, done);
    return p;
  }
  // one build at a time; a request while one runs gets the single build queued after it
  function launchOrQueue() {
    if (queued) return queued;
    if (!running) return launch();
    queued = running.then(() => { }, () => { }).then(() => { queued = null; return launch(); });
    notify();
    return queued;
  }
  return {
    request(reason) {
      const m = mode();
      if (!m || m === 'none') return;
      dirty = true; notify();
      if (!auto()) return;
      timers.clear(timer);
      timer = timers.set(() => { timer = 0; launchOrQueue().catch(() => { }); }, delay);
    },
    applyNow() {
      const m = mode();
      if (!m || m === 'none') return Promise.reject(new Error('Cannot build audio for this film'));
      timers.clear(timer); timer = 0; dirty = true;
      return launchOrQueue();
    },
    dirty: () => dirty,
    busy: () => !!running || !!queued,
    destroy() { timers.clear(timer); timer = 0; },
  };
}
