// A new film, written as code. Start here; see docs/PROJECT-CONTRACT.md (VideoHub folder) for the rules.
//
//   window.renderOut(t)  must draw second t of the film synchronously on the fixed-size canvas (#c, 1920x1080)
//   window.READY = true  once every asset is loaded (images, fonts, …)
//   window.VH_SCENES     the film's scenes [{name, t0, t1}] — they show up on VideoHub's timeline
//
// Golden rule: the picture is a pure function of t (no Date.now(), no state carried from frame to frame, no unseeded
// Math.random()). Then the live preview can jump anywhere, frame stepping works, and a partial re-render of one chunk
// matches its neighbours exactly.
(function () {
  'use strict';
  const W = 1920, H = 1080;
  const DUR = 10;                      // keep in step with render.env.DUR (hub_project) and the length of audio/mix.wav
  const cv = document.getElementById('c'), g = cv.getContext('2d');

  const SCENES = [
    { name: 'Opening', t0: 0, t1: 5 },
    { name: 'Ending', t0: 5, t1: DUR },
  ];
  window.VH_SCENES = SCENES;

  const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
  const ease = x => { x = clamp(x); return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2; };

  // ---- assets: load everything before READY (example: const img = await loadImage('assets/logo.png'))
  const loadImage = src => new Promise((ok, no) => { const i = new Image(); i.onload = () => ok(i); i.onerror = no; i.src = src; });

  function opening(t) {
    g.fillStyle = '#101320'; g.fillRect(0, 0, W, H);
    g.globalAlpha = ease(t / 0.8);
    g.fillStyle = '#f3efe6'; g.font = '800 120px "Segoe UI", system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('Your film starts here', W / 2, H / 2 - (1 - ease(t / 0.8)) * 40);
    g.globalAlpha = 1;
  }
  function ending(t) {
    const s = t - 5;
    g.fillStyle = '#ff7a3d'; g.fillRect(0, 0, W, H);
    g.fillStyle = '#101320'; g.font = '700 90px "Segoe UI", system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('The end', W / 2, H / 2 + Math.sin(s * 2) * 10);
  }

  window.renderOut = function (t) {
    t = clamp(+t || 0, 0, DUR);
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, W, H);
    if (t < 5) opening(t); else ending(t);
  };

  (async () => {
    // await loadImage(...), document.fonts.load('700 90px MyFont'), …
    await document.fonts.ready;
    window.renderOut(0);
    window.READY = true;
  })();
})();
