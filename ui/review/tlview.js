// Timeline view state (P2): which part of the film the timeline shows, zoom/pan, and "follow the playhead".
// Pure (no DOM); kept by the P3 timeline rewrite. The view is null (= the whole film) when its span reaches the film.
import { ls } from './dock.js';

const MIN_SPAN = 2;
const mmss = s => { s = Math.max(0, s); const m = Math.floor(s / 60), r = Math.floor(s % 60); return `${m}:${String(r).padStart(2, '0')}`; };

export function createView({ dur, key = 'vh-tl-follow' }) {
  let view = null, followOn = ls.get(key, true) !== false;
  const subs = new Set();
  const D = () => Math.max(1e-3, +dur() || 1);
  const emit = () => { for (const cb of subs) try { cb(); } catch { } };
  // set [a, a + span], clamped into the film; a span reaching the film means "no zoom"
  function setView(a, span) {
    const d = D(); span = Math.max(Math.min(MIN_SPAN, d), Math.min(d, span));
    const nv = span >= d - 1e-6 ? null : (a => [a, a + span])(Math.max(0, Math.min(d - span, a)));
    if (JSON.stringify(nv) === JSON.stringify(view)) return;
    view = nv; emit();
  }
  const get = () => {
    if (!view) return [0, D()];
    const d = D(); if (view[1] > d + 1e-6) setView(view[0], view[1] - view[0]);   // the film got shorter (live reload)
    return view ? view.slice() : [0, d];
  };
  // a new span that keeps `at` under the same x (default: the middle of the view)
  function zoomTo(span, at) {
    const [a, b] = get(), s = b - a; if (at == null || !Number.isFinite(at)) at = (a + b) / 2;
    const d = D(), ns = Math.max(Math.min(MIN_SPAN, d), Math.min(d, span));
    setView(at - (at - a) * ns / s, ns);
  }
  return {
    get,
    isZoomed: () => { get(); return !!view; },
    span: () => { const [a, b] = get(); return b - a; },
    zoomTo,
    zoomBy(k, at) { const [a, b] = get(); zoomTo((b - a) * k, at); },
    fit() { if (view) { view = null; emit(); } },
    // show a..b with a small margin on both sides (pad = share of the range)
    zoomToRange(a, b, pad = 0.05) {
      if (!(b > a)) return; const len = b - a, span = len * (1 + 2 * pad), mid = (a + b) / 2;
      const d = D(), ns = Math.max(Math.min(MIN_SPAN, d), Math.min(d, span));
      setView(mid - ns / 2, ns);
    },
    panBy(sec) { if (!view) return; setView(view[0] + sec, view[1] - view[0]); },
    setFollow(on) { followOn = !!on; ls.set(key, followOn); emit(); },
    followOn: () => followOn,
    // page jump: while playing and zoomed, a playhead leaving the view (or nearing its right edge) turns the page
    follow(t, playing = true) {
      if (!followOn || !playing || !view || !Number.isFinite(t)) return false;
      const [a, b] = view, s = b - a;
      if (t >= a && t <= b - 0.05 * s) return false;
      setView(t - 0.15 * s, s); return true;
    },
    label() { if (!view) return 'whole film'; const [a, b] = view, s = b - a; return `visible: ${mmss(a)}–${mmss(b)} (${s < 60 ? s.toFixed(1) + ' s' : mmss(s)})`; },
    onChange(cb) { subs.add(cb); return () => subs.delete(cb); },
  };
}
