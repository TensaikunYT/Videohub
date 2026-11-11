// VideoHub 2D layers (Nov 6): what the user adds or changes in a 2D film from VideoHub's live editor ("🧩 2D layers"),
// with no code change and no Claude. Engine-neutral page side; master copy in VideoHub/engine-hooks/vh2d.js
// (installed as 3D studio engine/vh2d.js and spotlight template2d src/vh2d.js — update those from here).
//
// It lives in the film's tweaks.json next to the other scene tweaks:
//   "items2d": [ { id, kind: "image"|"text"|"rect"|"ellipse"|"arrow", name, t0, t1, fin, fout, anim: "none"|"pop",
//                  x, y (centre, frame px), w, h, rot (deg), op (0..1),
//                  text, font, size, color, stroke, strokeW, shadow, align, weight,     // text
//                  src (relative to tweaks.json), fill, line, lineW, radius,              // image / shapes
//                  hide } ]
//   "actors2d": { "<shot>|<key>": { dx, dy, s, hide } }   key = "<bot label>#<n>" (n-th draw of that bot in the frame);
//                                                          shot "*" = the whole film
// The engine calls, per frame:
//   VH2D.begin(t, shot)            before the shot draws (resets the per-frame actor list)
//   st = VH2D.actor(g, bot, st)    from its character draw call: returns the state with the user's move/scale, or null
//                                  (hidden); records where the actor is on screen for the editor
//   VH2D.draw(g, t, W, H)          at the end of the frame, on the final 2D canvas: the added items
// Data: VH2D.use(data, baseUrl) (the engine's own tweaks.json object) or VH2D.load(url); VH2D.ready() resolves when
// every image an item needs is decoded (renders must not grab a frame before).
const S = { data: null, base: null, imgs: new Map(), pending: new Set(), actors: [], seen: new Map(), shot: '', t: 0, redraw: null };

function waitImages() {
  return Promise.all([...S.pending]).then(() => { });
}
function imageOf(src) {
  if (!src) return null;
  let url; try { url = new URL(src, S.base || location.href).href; } catch { return null; }
  let rec = S.imgs.get(url);
  if (!rec) {
    const img = new Image();
    rec = { img, ok: false };
    const p = new Promise((res) => { img.onload = () => { rec.ok = true; S.pending.delete(p); res(); S.redraw?.(); }; img.onerror = () => { S.pending.delete(p); res(); }; });
    S.pending.add(p);
    img.src = url;
    S.imgs.set(url, rec);
  }
  return rec.ok ? rec.img : null;
}
function prime() { for (const it of S.data?.items2d || []) if (it && it.kind === 'image') imageOf(it.src); }

export const VH2D = {
  version: 1,
  use(data, baseUrl) { S.data = data || {}; S.data.items2d = S.data.items2d || []; S.data.actors2d = S.data.actors2d || {}; S.base = baseUrl ? String(baseUrl) : S.base; prime(); return S.data; },
  async load(url) {
    let j = {};
    try { const r = await fetch(url, { cache: 'no-store' }); if (r.ok) j = await r.json(); } catch { }
    return VH2D.use(j && typeof j === 'object' ? j : {}, new URL(url, location.href).href);
  },
  ready() { return waitImages(); },
  data: () => S.data,
  onRedraw(fn) { S.redraw = fn; },
  begin(t, shot) { S.t = t; S.shot = shot || ''; S.actors = []; S.seen.clear(); },
  // a character about to be drawn: the user's move / scale / hide for it in this shot (or the whole film)
  // opt.record = false: an extra pass of the same character (its cast shadow, an arm drawn again over a prop): it gets
  // the same move as the character's first draw but is not counted or listed
  actor(g, bot, st, opt = {}) {
    const label = labelOf(bot);
    // st.s is the character's height in world units (film2d's QA reads it the same way); st.ground/st.y its feet
    let m = null; try { m = g.getTransform(); } catch { }
    const foot = (s) => (m ? m.transformPoint({ x: s.x || 0, y: s.ground ?? s.y ?? 0 }) : { x: 0, y: 0 });
    const p0 = foot(st);
    let key;
    // the same character drawn again at the same place in this frame (a second layer of it) is the same one
    const again = opt.record !== false && S.actors.find((a) => a.label === label && Math.abs(a.x0 - p0.x) < 3 && Math.abs(a.y0 - p0.y) < 3);
    if (again) key = again.key;
    else {
      const n = opt.record === false ? 1 : (S.seen.get(label) || 0) + 1;
      if (opt.record !== false) S.seen.set(label, n);
      key = `${label}#${Math.max(1, n)}`;
    }
    const A = S.data?.actors2d || {};
    const tw = A[`${S.shot}|${key}`] || A[`*|${key}`] || null;
    let out = st;
    if (tw) out = { ...st, x: (st.x || 0) + (+tw.dx || 0), y: (st.y || 0) + (+tw.dy || 0), ...(st.ground != null ? { ground: st.ground + (+tw.dy || 0) } : {}), s: (st.s ?? 1) * (+tw.s || 1) };
    // where it is on screen (for picking): its feet and its height; k = screen px per world unit (the editor's drag)
    if (opt.record !== false && !again && m) {
      const p = foot(out), hw = Math.abs(out.s ?? 100), q = m.transformPoint({ x: out.x || 0, y: (out.ground ?? out.y ?? 0) - hw });
      const h = Math.hypot(p.x - q.x, p.y - q.y);
      S.actors.push({ key, label, shot: S.shot, x: p.x, y: p.y, x0: p0.x, y0: p0.y, h, k: hw > 0 ? h / hw : 1, hidden: !!tw?.hide, tw });
    }
    return tw && tw.hide ? null : out;
  },
  actors: () => S.actors.slice(),
  itemsAt: (t) => (S.data?.items2d || []).filter((it) => it && !it.hide && t >= (+it.t0 || 0) && t <= (it.t1 == null ? Infinity : +it.t1)),
  draw(g, t, W, H) {
    const items = VH2D.itemsAt(t);
    if (!items.length) return;
    g.save();
    // whatever the engine left on this canvas (a blend mode, a filter, a clip from its last pass) must not touch these
    g.setTransform(1, 0, 0, 1, 0, 0); g.globalCompositeOperation = 'source-over'; g.filter = 'none'; g.globalAlpha = 1;
    g.shadowColor = 'transparent'; g.shadowBlur = 0; g.shadowOffsetX = 0; g.shadowOffsetY = 0; g.setLineDash?.([]);
    for (const it of items) { g.save(); drawItem(g, it, t, W, H); g.restore(); }
    g.restore();
  },
  // the editor: the box of an item on the frame (after its animation), in frame px
  box(it, t) { const k = animK(it, t ?? S.t); return { x: +it.x || 0, y: +it.y || 0, w: (+it.w || 100) * k.s, h: (+it.h || 100) * k.s, rot: +it.rot || 0 }; },
};

// a character's name: the engine's (spec.vhName / name / label), else "karakter N" in the order they first appear
const anon = new WeakMap(); let anonN = 0;
function labelOf(bot) {
  if (!bot) return 'karakter';
  const n = bot.vhName || bot.name || bot.label;
  if (n) return String(n);
  if (typeof bot !== 'object' && typeof bot !== 'function') return 'karakter';
  if (!anon.has(bot)) anon.set(bot, 'karakter ' + ++anonN);
  return anon.get(bot);
}

function animK(it, t) {
  const t0 = +it.t0 || 0, t1 = it.t1 == null ? Infinity : +it.t1, fin = Math.max(0, +it.fin || 0), fout = Math.max(0, +it.fout || 0);
  let a = 1;
  if (fin > 0) a = Math.min(a, Math.max(0, (t - t0) / fin));
  if (fout > 0 && Number.isFinite(t1)) a = Math.min(a, Math.max(0, (t1 - t) / fout));
  const sm = a * a * (3 - 2 * a);
  let s = 1;
  if (it.anim === 'pop' && fin > 0) { const u = Math.min(1, Math.max(0, (t - t0) / fin)), c = 1.70158; s = 1 + (c + 1) * (u - 1) ** 3 + c * (u - 1) ** 2; s = Math.max(0.01, s); }
  return { a: sm, s };
}

function drawItem(g, it, t, W, H) {
  const k = animK(it, t), op = Math.max(0, Math.min(1, it.op == null ? 1 : +it.op)) * k.a;
  if (op <= 0.001) return;
  const w = +it.w || 100, h = +it.h || 100;
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.translate(+it.x || W / 2, +it.y || H / 2);
  if (it.rot) g.rotate((+it.rot * Math.PI) / 180);
  if (k.s !== 1) g.scale(k.s, k.s);
  g.globalAlpha = op;
  if (it.shadow) { g.shadowColor = 'rgba(0,0,0,.55)'; g.shadowBlur = Math.max(4, (+it.size || 60) * 0.18); g.shadowOffsetY = Math.max(2, (+it.size || 60) * 0.05); }
  if (it.kind === 'image') {
    const img = imageOf(it.src);
    if (img) g.drawImage(img, -w / 2, -h / 2, w, h);
  } else if (it.kind === 'text') {
    const size = +it.size || 72, lines = String(it.text ?? '').split('\n');
    g.font = `${it.weight || 800} ${size}px ${it.font ? `"${it.font}", ` : ''}"Montserrat", "Segoe UI", sans-serif`;
    g.textAlign = it.align || 'center'; g.textBaseline = 'middle'; g.lineJoin = 'round'; g.miterLimit = 2;
    const lh = size * 1.12, x = it.align === 'left' ? -w / 2 : it.align === 'right' ? w / 2 : 0;
    lines.forEach((ln, i) => {
      const y = (i - (lines.length - 1) / 2) * lh;
      if (it.stroke && (+it.strokeW || 0) > 0) { g.strokeStyle = it.stroke; g.lineWidth = size * +it.strokeW; g.strokeText(ln, x, y); g.shadowColor = 'transparent'; }
      g.fillStyle = it.color || '#ffffff'; g.fillText(ln, x, y);
    });
  } else if (it.kind === 'rect' || it.kind === 'ellipse') {
    g.beginPath();
    if (it.kind === 'ellipse') g.ellipse(0, 0, w / 2, h / 2, 0, 0, Math.PI * 2);
    else if (g.roundRect && +it.radius) g.roundRect(-w / 2, -h / 2, w, h, +it.radius); else g.rect(-w / 2, -h / 2, w, h);
    if (it.fill) { g.fillStyle = it.fill; g.fill(); }
    if (it.line && (+it.lineW || 0) > 0) { g.shadowColor = 'transparent'; g.strokeStyle = it.line; g.lineWidth = +it.lineW; g.stroke(); }
  } else if (it.kind === 'arrow') {
    // from the left edge to the right edge of its box, head on the right; rotate the item to aim it
    const lw = +it.lineW || Math.max(6, h * 0.18), head = Math.min(w * 0.45, lw * 3.2);
    g.strokeStyle = g.fillStyle = it.line || it.fill || '#ff3b3b'; g.lineWidth = lw; g.lineCap = 'round';
    g.beginPath(); g.moveTo(-w / 2, 0); g.lineTo(w / 2 - head * 0.8, 0); g.stroke();
    g.beginPath(); g.moveTo(w / 2, 0); g.lineTo(w / 2 - head, -head * 0.6); g.lineTo(w / 2 - head, head * 0.6); g.closePath(); g.fill();
  }
}

if (typeof window !== 'undefined') window.VH2D = VH2D;
export default VH2D;
