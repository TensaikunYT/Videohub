// Hello, VideoHub — a 10-second example film written as code.
//
// The VideoHub contract (docs/PROJECT-CONTRACT.md) in three lines:
//   window.renderOut(t)  draws second t of the film, synchronously, on the fixed-size canvas (1920x1080)
//   window.READY = true  once everything the drawing needs is loaded
//   window.VH_SCENES     (optional) the film's scenes, shown on VideoHub's timeline
// The same page is what VideoHub's live preview plays and what render.js screenshots frame by frame,
// so a fix in this file shows up in the open preview at once and in the next render exactly the same.
(function () {
  'use strict';
  const W = 1920, H = 1080, DUR = 10;
  const cv = document.getElementById('c'), g = cv.getContext('2d');

  // the scenes, in seconds (also drive the drawing below)
  const SCENES = [
    { name: 'Title', t0: 0, t1: 3.5 },
    { name: 'Shapes', t0: 3.5, t1: 7 },
    { name: 'Outro', t0: 7, t1: DUR },
  ];
  window.VH_SCENES = SCENES;

  // ---- small helpers: everything is a pure function of t (no Date.now(), no Math.random()), so any frame can be drawn
  // in any order — that is what makes live preview, frame stepping and partial re-renders possible
  const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
  const ease = x => { x = clamp(x); return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2; };
  const back = x => { x = clamp(x); const c = 1.70158; return 1 + (c + 1) * Math.pow(x - 1, 3) + c * Math.pow(x - 1, 2); };
  const lerp = (a, b, k) => a + (b - a) * k;
  const seeded = n => { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };   // stable "random"

  const C = { ink: '#14161f', paper: '#f3efe6', accent: '#ff7a3d', blue: '#3d7bff', green: '#2fbf8f', pink: '#ff4f8b' };

  function background(t) {
    const k = clamp(t / DUR);
    const grd = g.createLinearGradient(0, 0, 0, H);
    grd.addColorStop(0, `hsl(${lerp(228, 262, k)}, 45%, ${lerp(14, 20, k)}%)`);
    grd.addColorStop(1, `hsl(${lerp(250, 20, k)}, 55%, ${lerp(24, 30, k)}%)`);
    g.fillStyle = grd; g.fillRect(0, 0, W, H);
    // drifting stars
    for (let i = 0; i < 90; i++) {
      const x = (seeded(i) * W + t * (8 + seeded(i + 9) * 30)) % W, y = seeded(i + 3) * H * 0.75;
      const tw = 0.45 + 0.55 * Math.sin(t * (1 + seeded(i + 5) * 3) + i);
      g.globalAlpha = 0.25 + 0.5 * tw; g.fillStyle = '#fff';
      g.beginPath(); g.arc(x, y, 1 + seeded(i + 7) * 2, 0, Math.PI * 2); g.fill();
    }
    g.globalAlpha = 1;
    // a slow sun
    const sx = lerp(W * 0.15, W * 0.85, k), sy = H * 0.86 - Math.sin(k * Math.PI) * H * 0.5;
    const sun = g.createRadialGradient(sx, sy, 10, sx, sy, 260);
    sun.addColorStop(0, 'rgba(255,190,120,0.95)'); sun.addColorStop(0.25, 'rgba(255,140,80,0.45)'); sun.addColorStop(1, 'rgba(255,120,60,0)');
    g.fillStyle = sun; g.fillRect(sx - 260, sy - 260, 520, 520);
    // ground
    g.fillStyle = C.ink; g.beginPath(); g.moveTo(0, H);
    for (let x = 0; x <= W; x += 40) g.lineTo(x, H * 0.84 + Math.sin(x / 180 + t * 0.6) * 18 + Math.sin(x / 67) * 8);
    g.lineTo(W, H); g.closePath(); g.fill();
  }

  function title(t) {
    const text = 'Hello, VideoHub', shown = Math.floor(clamp((t - 0.3) / 1.6) * text.length);
    const out = clamp((t - 3.0) / 0.5);   // leaves at the end of its scene
    g.save();
    g.globalAlpha = 1 - out;
    g.translate(W / 2, H * 0.45 - out * 80);
    g.font = '800 150px "Segoe UI", system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillStyle = C.paper; g.fillText(text.slice(0, shown), 0, 0);
    if (shown < text.length && Math.floor(t * 4) % 2 === 0) { const w = g.measureText(text.slice(0, shown)).width; g.fillStyle = C.accent; g.fillRect(w / 2 + 12, -70, 14, 140); }
    g.globalAlpha = (1 - out) * ease((t - 1.9) / 0.6);
    g.font = '500 46px "Segoe UI", system-ui, sans-serif'; g.fillStyle = '#c9cbe0';
    g.fillText('a film written as code · previewed live · rendered once', 0, 120);
    g.restore();
  }

  function shapes(t) {
    const s = t - 3.5;   // seconds into the scene
    const items = [
      { c: C.accent, x: 0.25, kind: 'circle' },
      { c: C.blue, x: 0.5, kind: 'square' },
      { c: C.green, x: 0.75, kind: 'triangle' },
    ];
    items.forEach((it, i) => {
      const inK = back((s - i * 0.25) / 0.7), outK = ease((s - 2.9 - i * 0.08) / 0.5);
      if (inK <= 0) return;
      const bounce = Math.abs(Math.sin((s - i * 0.25) * 3.2)) * 120 * (1 - clamp(s / 3));
      const x = W * it.x, y = H * 0.58 - bounce + outK * 700, r = 120 * inK;
      g.save(); g.translate(x, y); g.rotate((s + i) * (it.kind === 'square' ? 0.8 : 0));
      g.fillStyle = it.c; g.shadowColor = 'rgba(0,0,0,0.35)'; g.shadowBlur = 40; g.shadowOffsetY = 18;
      g.beginPath();
      if (it.kind === 'circle') g.arc(0, 0, r, 0, Math.PI * 2);
      else if (it.kind === 'square') g.rect(-r * 0.85, -r * 0.85, r * 1.7, r * 1.7);
      else { g.moveTo(0, -r); g.lineTo(r * 0.95, r * 0.7); g.lineTo(-r * 0.95, r * 0.7); g.closePath(); }
      g.fill(); g.restore();
    });
    g.save(); g.globalAlpha = ease(s / 0.5) * (1 - ease((s - 3) / 0.4));
    g.font = '700 64px "Segoe UI", system-ui, sans-serif'; g.textAlign = 'center'; g.fillStyle = C.paper;
    g.fillText('Leave a note on any frame', W / 2, H * 0.2);
    g.restore();
  }

  function outro(t) {
    const s = t - 7, k = back(s / 0.8);
    g.save(); g.translate(W / 2, H * 0.47); g.scale(lerp(0.6, 1, k), lerp(0.6, 1, k)); g.globalAlpha = clamp(s / 0.4) * (1 - clamp((s - 2.6) / 0.4));
    g.fillStyle = C.accent; g.beginPath(); g.roundRect(-430, -110, 860, 220, 110); g.fill();
    g.font = '800 96px "Segoe UI", system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = C.ink;
    g.fillText('Fix it in code', 0, 4);
    g.restore();
    g.save(); g.globalAlpha = ease((s - 0.8) / 0.6) * (1 - clamp((s - 2.6) / 0.4));
    g.font = '500 44px "Segoe UI", system-ui, sans-serif'; g.textAlign = 'center'; g.fillStyle = '#e4e5f2';
    g.fillText('…and render only when it is right.', W / 2, H * 0.47 + 190);
    g.restore();
  }

  function timecode(t) {
    g.save(); g.font = '600 26px Consolas, monospace'; g.fillStyle = 'rgba(255,255,255,0.55)'; g.textAlign = 'right';
    g.fillText(`${t.toFixed(2)} s`, W - 40, H - 36); g.restore();
  }

  // ---- the contract
  window.renderOut = function (t) {
    t = clamp(+t || 0, 0, DUR);
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, W, H);
    background(t);
    if (t < 3.5) title(t); else if (t < 7) shapes(t); else outro(t);
    timecode(t);
  };
  // nothing to load here (no images or fonts beyond system ones); a real film awaits its assets, then sets READY
  window.renderOut(0);
  window.READY = true;
})();
