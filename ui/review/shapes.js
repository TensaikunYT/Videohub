// Drawing shapes in 0..1 frame coordinates: pen, arrow, rect, ellipse, pin, text.
export const COLORS = ['#ff4d4d', '#ffb02e', '#3ee089', '#5aa9ff', '#ffffff'];
export const WIDTHS = [1, 2, 3.5];

export function bbox(shapes) {
  let x0 = 1, y0 = 1, x1 = 0, y1 = 0;
  for (const s of shapes) {
    for (const [x, y] of s.pts) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
    if (s.type === 'text') { x1 = Math.max(x1, s.pts[0][0] + 0.012 * (s.text || '').length * (s.size || 1)); y1 = Math.max(y1, s.pts[0][1] + 0.04 * (s.size || 1)); }
  }
  return [Math.max(0, x0), Math.max(0, y0), Math.min(1, x1), Math.min(1, y1)];
}

function path(c, s, W, H) {
  const P = s.pts.map(([x, y]) => [x * W, y * H]); c.beginPath();
  if (s.type === 'pin') { c.arc(P[0][0], P[0][1], Math.max(9, W * 0.011), 0, 7); return; }
  if (s.type === 'pen') { P.forEach(([x, y], i) => i ? c.lineTo(x, y) : c.moveTo(x, y)); return; }
  const [a, b] = [P[0], P[P.length - 1]];
  if (s.type === 'rect') c.rect(Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1]));
  if (s.type === 'ellipse') c.ellipse((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, Math.abs(b[0] - a[0]) / 2 + 1, Math.abs(b[1] - a[1]) / 2 + 1, 0, 0, 7);
  if (s.type === 'arrow') {
    c.moveTo(a[0], a[1]); c.lineTo(b[0], b[1]);
    const ang = Math.atan2(b[1] - a[1], b[0] - a[0]), L = Math.max(12, W * 0.02);
    c.moveTo(b[0], b[1]); c.lineTo(b[0] - L * Math.cos(ang - 0.45), b[1] - L * Math.sin(ang - 0.45));
    c.moveTo(b[0], b[1]); c.lineTo(b[0] - L * Math.cos(ang + 0.45), b[1] - L * Math.sin(ang + 0.45));
  }
}

// a solid numbered dot with a white ring, readable on any background
const DARK_TEXT = new Set(['#ffb02e', '#3ee089', '#ffffff']);
export const pinR = (W, w = 1) => Math.max(10, W * 0.012) * (0.9 + 0.1 * w);
export const PIN_HEAD = 2.1;   // head centre sits this many radii above the point
// a map-pin marker: numbered head above, tip on the exact spot, so the spot itself stays visible
function pin(c, s, W, H) {
  const x = s.pts[0][0] * W, y = s.pts[0][1] * H, r = pinR(W, s.width || 1), hy = y - r * PIN_HEAD;
  const shape = () => { c.beginPath(); c.moveTo(x, y - r * 0.15); c.lineTo(x - r * 0.62, hy + r * 0.78); c.arc(x, hy, r, Math.PI * 0.76, Math.PI * 0.24); c.closePath(); };
  c.save(); c.shadowColor = 'rgba(0,0,0,.6)'; c.shadowBlur = r * 0.7; shape(); c.fillStyle = s.color; c.fill(); c.restore();
  shape(); c.lineWidth = Math.max(1.6, r * 0.14); c.strokeStyle = '#fff'; c.stroke();
  c.beginPath(); c.arc(x, y, Math.max(2.2, r * 0.2), 0, 7); c.fillStyle = '#fff'; c.fill(); c.lineWidth = 1.2; c.strokeStyle = '#000'; c.stroke();
  if (s.num != null) {
    c.fillStyle = DARK_TEXT.has(s.color) ? '#111' : '#fff'; c.font = `700 ${Math.round(r * (String(s.num).length > 2 ? 0.8 : 1.05))}px "Segoe UI", sans-serif`;
    c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(String(s.num), x, hy + r * 0.06); c.textAlign = 'start';
  }
}

export function paint(c, shapes, W, H, alpha = 1) {
  c.save(); c.globalAlpha = alpha; c.lineCap = 'round'; c.lineJoin = 'round';
  for (const s of shapes) {
    if (s.type === 'text') {
      const fs = Math.max(14, W * 0.022) * (s.size || 1), [x, y] = [s.pts[0][0] * W, s.pts[0][1] * H];
      c.font = `600 ${fs}px "Segoe UI", sans-serif`; const w = c.measureText(s.text || '').width;
      c.fillStyle = 'rgba(0,0,0,.72)'; c.fillRect(x - 6, y - 4, w + 12, fs * 1.35 + 8);
      c.fillStyle = s.color; c.textBaseline = 'top'; c.fillText(s.text || '', x, y + 2);
      continue;
    }
    if (s.type === 'pin') { pin(c, s, W, H); continue; }
    c.strokeStyle = s.color; c.lineWidth = Math.max(2.5, W * 0.0035) * (s.width || 1);
    path(c, s, W, H); c.stroke();
  }
  c.restore();
}

// index of the shape nearest to a point (for the eraser), or -1
export function hit(shapes, pt, tol = 0.025) {
  let best = -1, bd = tol;
  shapes.forEach((s, i) => {
    let d = Infinity;
    if (s.type === 'text') { const [x0, y0, x1, y1] = bbox([s]); if (pt[0] >= x0 && pt[0] <= x1 && pt[1] >= y0 && pt[1] <= y1) d = 0; }
    else if (s.type === 'rect' || s.type === 'ellipse') { const [x0, y0, x1, y1] = bbox([s]); if (pt[0] >= x0 - tol && pt[0] <= x1 + tol && pt[1] >= y0 - tol && pt[1] <= y1 + tol) d = Math.min(Math.abs(pt[0] - x0), Math.abs(pt[0] - x1), Math.abs(pt[1] - y0), Math.abs(pt[1] - y1)); }
    else if (s.type === 'pin') { const [x, y] = s.pts[0]; d = Math.min(Math.hypot(x - pt[0], y - pt[1]), Math.hypot(x - pt[0], y - 0.04 - pt[1])); }
    else for (const [x, y] of s.pts) d = Math.min(d, Math.hypot(x - pt[0], y - pt[1]));
    if (d < bd) { bd = d; best = i; }
  });
  return best;
}
