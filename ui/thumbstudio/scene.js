// Scene renderer: drawScene(ctx, brief, mode, opts) — Unified drawing engine for editor & export
import { getLayerBox, getHandles, HANDLE_SIZE } from './layers.js';
import { drawFigure } from './figures.js';
import { drawEffect } from './shapes.js';
import { drawPerspectiveGrid } from './camera.js';
import { drawLightGizmo } from './light.js';
import { TEXT_PRESETS } from './catalog.js';

// effects drawn by code over the final image (never sent to the image model)
export const OVERLAY_EFFECTS = new Set(['arrow', 'circle', 'x-mark', 'check', 'badge']);
export const isOverlayLayer = l => l.type === 'text' || (l.type === 'effect' && OVERLAY_EFFECTS.has(l.kind) && l.overlay !== false);

export function drawScene(ctx, brief, mode = 'layout', opts = {}) {
  const W = ctx.canvas.width;
  const H = ctx.canvas.height;
  const isExport = !!opts.isExport;
  fileUrl = opts.fileUrl || fileUrl;
  if (mode === 'final') return drawFinal(ctx, brief, opts);

  // Clear canvas
  ctx.save();
  ctx.clearRect(0, 0, W, H);

  // Background base
  ctx.fillStyle = '#12141a';
  ctx.fillRect(0, 0, W, H);

  const layers = brief.layers || [];
  const focusLayer = layers.find(l => l.id === brief.camera?.focusLayer);
  const focusDepth = focusLayer ? (focusLayer.depth ?? 50) : 20;
  const dofAmount = brief.camera?.dof ?? 0.6;

  // Draw layers in order
  for (const layer of layers) {
    if (layer.hidden) continue;
    if (isExport && layer.type === 'zone') continue; // Zones are never drawn in AI layout export
    if (isExport && layer.type === 'trace') continue; // Trace layer never in AI export
    if (isExport && mode === 'layout' && isOverlayLayer(layer)) continue; // text + overlay marks come back in the final
    if (mode === 'depth' && layer.type === 'trace') continue;

    if (mode === 'preview' && layer.type !== 'background') {
      const dist = Math.abs((layer.depth ?? 50) - focusDepth);
      const blurPx = Math.round(dist * dofAmount * 0.16);
      ctx.filter = blurPx > 0 ? `blur(${blurPx}px)` : 'none';
    } else {
      ctx.filter = 'none';
    }

    // the layout sent to the image model is neutral: gray blocks, lighter = nearer (its colours must not leak into the result)
    const drawn = isExport && mode === 'layout' ? { ...layer, color: neutralGray(layer) } : layer;
    drawLayer(ctx, drawn, brief, mode, W, H, isExport);
    ctx.filter = 'none';
  }

  // Draw guides & UI overlays if in editor mode
  if (!isExport) {
    // 1. Perspective / horizon grid
    if (opts.showGrid && brief.camera) {
      drawPerspectiveGrid(ctx, brief.camera, W, H);
    }

    // 2. Safe guides (Thirds & Badge)
    if (opts.showThirds !== false && brief.safe?.thirds !== false) {
      drawThirdsGuides(ctx, W, H);
    }
    if (opts.showBadge !== false && brief.safe?.badge !== false && brief.format !== '9:16') {
      drawBadgeGuide(ctx, W, H);
    }
    if (brief.format === '9:16' && brief.safe?.shortsUi) drawShortsGuide(ctx, W, H);

    // 3. Active snapping guide lines
    if (opts.activeGuides && opts.activeGuides.length) {
      drawSnapGuides(ctx, opts.activeGuides, W, H);
    }

    // 4. Light gizmo (draggable sun)
    if (brief.light && opts.showLight !== false) {
      drawLightGizmo(ctx, brief.light, W, H);
    }

    // 5. Selection bounding box & handles
    if (opts.selectedLayerId) {
      const selectedLayer = layers.find(l => l.id === opts.selectedLayerId);
      if (selectedLayer && !selectedLayer.hidden) {
        drawSelectionHandles(ctx, selectedLayer, W, H);
      }
    }

    // 6. Sketch mode numbered annotations and HUD legend
    if (mode === 'sketch') {
      drawSketchOverlays(ctx, brief, W, H);
    }
  }

  ctx.restore();
}

function drawLayer(ctx, layer, brief, mode, W, H, isExport) {
  ctx.save();
  const { x, y, w, h, cx, cy } = getLayerBox(layer, W, H);

  // Apply rotation around center
  if (layer.rot) {
    ctx.translate(cx, cy);
    ctx.rotate((layer.rot * Math.PI) / 180);
    ctx.translate(-cx, -cy);
  }

  if (mode === 'depth') {
    // Depth mode: Closer = lighter white, Farther = darker gray, Background = black
    if (layer.type === 'background') {
      ctx.fillStyle = '#080808';
    } else {
      const depthVal = Math.max(0, Math.min(100, layer.depth ?? 50));
      const luma = Math.round(255 - (depthVal / 100) * 215);
      ctx.fillStyle = `rgb(${luma}, ${luma}, ${luma})`;
    }
    ctx.fillRect(x, y, w, h);
    ctx.restore();
    return;
  }

  switch (layer.type) {
    case 'background': {
      drawBackground(ctx, layer, x, y, w, h, isExport);
      break;
    }
    case 'zone': {
      drawZone(ctx, layer, x, y, w, h);
      break;
    }
    case 'object': {
      drawObject(ctx, layer, x, y, w, h, isExport);
      break;
    }
    case 'subject': {
      drawFigure(ctx, layer, x, y, w, h, { isExport });
      break;
    }
    case 'effect': {
      drawEffect(ctx, layer, x, y, w, h, { isExport });
      break;
    }
    case 'text': {
      drawTextBlock(ctx, layer, x, y, w, h, isExport);
      break;
    }
    case 'sketch': {
      drawSketch(ctx, layer, W, H);
      break;
    }
    case 'trace': {
      if (!isExport) drawTrace(ctx, layer, x, y, w, h);
      break;
    }
    default: {
      ctx.fillStyle = layer.color || '#6aa0ff';
      ctx.fillRect(x, y, w, h);
      break;
    }
  }

  ctx.restore();
}

function neutralGray(layer) {
  if (layer.type === 'background') return '#26282d';
  const d = Math.max(0, Math.min(100, layer.depth ?? 50));
  const v = Math.round(215 - d * 1.25);
  return '#' + [v, v, v].map(n => n.toString(16).padStart(2, '0')).join('');
}

function drawBackground(ctx, layer, x, y, w, h, isExport) {
  if (layer.kind === 'gradient') {
    const grad = ctx.createLinearGradient(x, y, x, y + h);
    grad.addColorStop(0, '#1a2233');
    grad.addColorStop(1, '#0d111a');
    ctx.fillStyle = grad;
  } else {
    ctx.fillStyle = layer.color || '#161922';
  }
  ctx.fillRect(x, y, w, h);

  if (isExport) return;   // no words in pictures that go to the image model
  // Subtle label in editor
  ctx.fillStyle = 'rgba(255, 255, 255, 0.15)';
  ctx.font = '13px sans-serif';
  ctx.fillText('Background: ' + (layer.desc || layer.name), x + 16, y + 26);
}

function drawZone(ctx, layer, x, y, w, h) {
  ctx.save();
  ctx.strokeStyle = layer.color || '#a68cff';
  ctx.lineWidth = 2;
  ctx.setLineDash([6, 6]);
  ctx.strokeRect(x, y, w, h);

  ctx.fillStyle = 'rgba(166, 140, 255, 0.12)';
  ctx.fillRect(x, y, w, h);

  ctx.fillStyle = layer.color || '#a68cff';
  ctx.font = 'bold 12px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const label = 'EMPTY SPACE (' + (layer.purpose === 'title' ? 'FOR TEXT' : layer.purpose === 'face' ? 'FOR A FACE' : 'CLEAR') + ')';
  ctx.fillText(label, x + w / 2, y + h / 2);
  ctx.restore();
}

function drawObject(ctx, layer, x, y, w, h, isExport) {
  ctx.save();
  const color = layer.color || '#f08a3c';

  // Semi-transparent fill + solid border
  ctx.fillStyle = hexToRgba(color, isExport ? 0.85 : 0.35);
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;

  const shape = layer.shape || 'rect';
  if (shape === 'ellipse') {
    ctx.beginPath();
    ctx.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  } else if (shape === 'triangle') {
    ctx.beginPath();
    ctx.moveTo(x + w / 2, y);
    ctx.lineTo(x + w, y + h);
    ctx.lineTo(x, y + h);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  } else {
    // Default rect
    ctx.fillRect(x, y, w, h);
    ctx.strokeRect(x, y, w, h);
  }

  // Label (only in editor, not in export)
  if (!isExport) {
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 13px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(layer.name || 'Object', x + w / 2, y + h / 2 - 8);

    if (layer.desc) {
      ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
      ctx.font = '11px sans-serif';
      ctx.fillText(truncate(layer.desc, 24), x + w / 2, y + h / 2 + 10);
    }
  }

  ctx.restore();
}

function drawSubjectBlock(ctx, layer, x, y, w, h, isExport) {
  ctx.save();
  const color = layer.color || '#6aa0ff';
  ctx.fillStyle = hexToRgba(color, isExport ? 0.75 : 0.35);
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;

  // Draw rounded mannequin shape
  const r = Math.min(w, h) * 0.1;
  ctx.beginPath();
  ctx.roundRect ? ctx.roundRect(x, y, w, h, r) : ctx.rect(x, y, w, h);
  ctx.fill();
  ctx.stroke();

  if (!isExport) {
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 13px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('🧍 ' + (layer.name || 'Person'), x + w / 2, y + h / 2 - 8);

    ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
    ctx.font = '11px sans-serif';
    const subtext = (layer.pose || 'standing') + ' · ' + (layer.crop || 'full');
    ctx.fillText(subtext, x + w / 2, y + h / 2 + 10);
  }
  ctx.restore();
}

function drawTextBlock(ctx, layer, x, y, w, h, isExport, clean = false) {
  ctx.save();
  let content = layer.content || 'TEXT GOES HERE';
  if (layer.uppercase) {
    content = content.toLocaleUpperCase();
  }

  let fontSize = Math.max(14, Math.round((layer.size ?? 0.12) * ctx.canvas.height));
  // layer.font is a text preset id or a font name
  const fontFamily = TEXT_PRESETS.find(p => p.id === layer.font)?.font || layer.font || 'Impact';
  ctx.font = `${fontFamily === 'Segoe UI' ? 900 : 'bold'} ${fontSize}px "${fontFamily}", "Arial Black", "Segoe UI", sans-serif`;
  ctx.textAlign = layer.align || 'center';
  ctx.textBaseline = 'middle';

  const lines = content.split('\n');
  // never wider than its box: shrink the font until the widest line fits (9:16 frames are narrow for their height)
  const widest0 = Math.max(...lines.map(l => ctx.measureText(l).width), 1);
  if (widest0 > w * 0.98 && w > 10) {
    fontSize = Math.max(10, Math.floor(fontSize * (w * 0.98) / widest0));
    ctx.font = `${fontFamily === 'Segoe UI' ? 900 : 'bold'} ${fontSize}px "${fontFamily}", "Arial Black", "Segoe UI", sans-serif`;
  }
  const lineHeight = fontSize * (layer.lineHeight || 1.15);
  const totalH = lines.length * lineHeight;
  const startY = y + h / 2 - totalH / 2 + lineHeight / 2;

  // Background box if set
  if (layer.bg) {
    ctx.fillStyle = layer.bg;
    const pad = fontSize * 0.25;
    const widest = Math.max(...lines.map(l => ctx.measureText(l).width));
    const bx = layer.align === 'left' ? x : layer.align === 'right' ? x + w - widest : x + w / 2 - widest / 2;
    ctx.fillRect(bx - pad, startY - lineHeight / 2 - pad * 0.4, widest + pad * 2, totalH + pad * 0.8);
  }

  // Draw each line
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineY = startY + i * lineHeight;
    const lineX = layer.align === 'left' ? x : layer.align === 'right' ? x + w : x + w / 2;

    // Drop shadow
    if (layer.shadow) {
      ctx.shadowColor = 'rgba(0, 0, 0, 0.85)';
      ctx.shadowBlur = Math.round(fontSize * 0.15);
      ctx.shadowOffsetX = Math.round(fontSize * 0.06);
      ctx.shadowOffsetY = Math.round(fontSize * 0.06);
    } else {
      ctx.shadowColor = 'transparent';
    }

    // Stroke
    if (layer.stroke && (layer.strokeW ?? 0.05) > 0) {
      ctx.strokeStyle = layer.stroke;
      ctx.lineWidth = Math.round(fontSize * (layer.strokeW ?? 0.05));
      ctx.lineJoin = 'miter';
      ctx.miterLimit = 2;
      ctx.strokeText(line, lineX, lineY);
    }

    // Fill (highlighted words in the accent colour)
    const hl = (layer.highlightWords || []).map(w => w.toLocaleLowerCase()).filter(Boolean);
    if (!hl.length) {
      ctx.fillStyle = layer.fill || '#ffffff';
      ctx.fillText(line, lineX, lineY);
    } else {
      const words = line.split(/(\s+)/);
      const total = ctx.measureText(line).width;
      let cx = (ctx.textAlign === 'left' ? lineX : ctx.textAlign === 'right' ? lineX - total : lineX - total / 2);
      const align = ctx.textAlign; ctx.textAlign = 'left';
      for (const wd of words) {
        const on = hl.includes(wd.toLocaleLowerCase().replace(/[.,!?;:…"'“”]/g, ''));
        ctx.fillStyle = on ? (layer.highlight || '#ffd400') : (layer.fill || '#ffffff');
        ctx.fillText(wd, cx, lineY);
        cx += ctx.measureText(wd).width;
      }
      ctx.textAlign = align;
    }
  }

  // Dashed outline in editor
  if (!isExport && !clean) {
    ctx.shadowColor = 'transparent';
    ctx.strokeStyle = 'rgba(230, 193, 77, 0.4)';
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.strokeRect(x, y, w, h);
  }

  ctx.restore();
}

function drawSketch(ctx, layer, W, H) {
  ctx.save();
  const strokes = layer.strokes || [];
  for (const s of strokes) {
    if (!s || !Array.isArray(s.pts) || s.pts.length < 2) continue;
    ctx.strokeStyle = s.color || '#ff0000';
    ctx.lineWidth = s.w || 3;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(s.pts[0][0] * W, s.pts[0][1] * H);
    for (let i = 1; i < s.pts.length; i++) {
      ctx.lineTo(s.pts[i][0] * W, s.pts[i][1] * H);
    }
    ctx.stroke();
  }
  ctx.restore();
}

const traceImageCache = new Map();
function drawTrace(ctx, layer, x, y, w, h) {
  if (!layer.file) return;
  ctx.save();
  ctx.globalAlpha = layer.opacity ?? 0.4;
  const src = /^(data:|blob:|\/|https?:)/.test(layer.file) ? layer.file : fileUrl(layer.file);
  let img = traceImageCache.get(src);
  if (!img) {
    img = new Image();
    img.onload = () => onImageLoad?.();
    img.src = src;
    traceImageCache.set(src, img);
  }
  if (img.complete && img.naturalWidth) {
    ctx.drawImage(img, x, y, w, h);
  } else {
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
    ctx.setLineDash([4, 4]);
    ctx.strokeRect(x, y, w, h);
    ctx.fillText('🖼 Loading trace underlay…', x + 10, y + 20);
  }
  ctx.restore();
}

function drawThirdsGuides(ctx, W, H) {
  ctx.save();
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.18)';
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 4]);

  // Vertical lines
  ctx.beginPath();
  ctx.moveTo(W / 3, 0); ctx.lineTo(W / 3, H);
  ctx.moveTo((2 * W) / 3, 0); ctx.lineTo((2 * W) / 3, H);
  // Horizontal lines
  ctx.moveTo(0, H / 3); ctx.lineTo(W, H / 3);
  ctx.moveTo(0, (2 * H) / 3); ctx.lineTo(W, (2 * H) / 3);
  ctx.stroke();
  ctx.restore();
}

function drawBadgeGuide(ctx, W, H) {
  ctx.save();
  // Bottom-right duration badge area (~14% width x 12% height)
  const bw = W * 0.15;
  const bh = H * 0.12;
  const bx = W - bw - 8;
  const by = H - bh - 8;

  ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
  ctx.fillRect(bx, by, bw, bh);
  ctx.strokeStyle = 'rgba(240, 138, 60, 0.5)';
  ctx.lineWidth = 1;
  ctx.strokeRect(bx, by, bw, bh);

  ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';
  ctx.font = '11px monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('12:34', bx + bw / 2, by + bh / 2);
  ctx.restore();
}

// Shorts player UI: the action buttons on the right and the title/caption block at the bottom cover the picture
function drawShortsGuide(ctx, W, H) {
  ctx.save();
  ctx.fillStyle = 'rgba(232, 84, 84, 0.16)';
  ctx.strokeStyle = 'rgba(232, 84, 84, 0.55)';
  ctx.setLineDash([6, 4]);
  const r = [W * 0.84, H * 0.42, W * 0.16, H * 0.46], b = [0, H * 0.8, W * 0.84, H * 0.2];
  for (const [x, y, w, h] of [r, b]) { ctx.fillRect(x, y, w, h); ctx.strokeRect(x, y, w, h); }
  ctx.fillStyle = 'rgba(255,255,255,0.6)'; ctx.font = `${Math.round(H * 0.013)}px "Segoe UI", sans-serif`;
  ctx.fillText('Shorts interface', b[0] + 12, b[1] + 22);
  ctx.restore();
}

function drawSnapGuides(ctx, guides, W, H) {
  ctx.save();
  ctx.strokeStyle = '#f08a3c';
  ctx.lineWidth = 1;
  ctx.setLineDash([2, 2]);

  ctx.beginPath();
  for (const g of guides) {
    if (g.type === 'v') {
      const px = g.pos * W;
      ctx.moveTo(px, 0);
      ctx.lineTo(px, H);
    } else if (g.type === 'h') {
      const py = g.pos * H;
      ctx.moveTo(0, py);
      ctx.lineTo(W, py);
    }
  }
  ctx.stroke();
  ctx.restore();
}

function drawSelectionHandles(ctx, layer, W, H) {
  ctx.save();
  const { x, y, w, h, cx, cy } = getLayerBox(layer, W, H);
  const rot = layer.rot || 0;

  ctx.translate(cx, cy);
  ctx.rotate((rot * Math.PI) / 180);
  ctx.translate(-cx, -cy);

  // Selection outline
  ctx.strokeStyle = '#f08a3c';
  ctx.lineWidth = 1.5;
  ctx.setLineDash([]);
  ctx.strokeRect(x, y, w, h);

  // Rotate stalk line
  ctx.strokeStyle = '#f08a3c';
  ctx.beginPath();
  ctx.moveTo(cx, y);
  ctx.lineTo(cx, y - 24);
  ctx.stroke();

  // Rotate handle circle
  ctx.fillStyle = '#f08a3c';
  ctx.beginPath();
  ctx.arc(cx, y - 24, 5, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // 8 Resize handles
  const hs = HANDLE_SIZE;
  const handleCoords = [
    [x, y], [cx, y], [x + w, y],
    [x + w, cy], [x + w, y + h], [cx, y + h],
    [x, y + h], [x, cy]
  ];

  ctx.fillStyle = '#ffffff';
  ctx.strokeStyle = '#f08a3c';
  ctx.lineWidth = 1.5;

  for (const [hx, hy] of handleCoords) {
    ctx.fillRect(hx - hs / 2, hy - hs / 2, hs, hs);
    ctx.strokeRect(hx - hs / 2, hy - hs / 2, hs, hs);
  }

  ctx.restore();
}

function hexToRgba(hex, alpha) {
  if (!hex || !hex.startsWith('#')) return `rgba(240, 138, 60, ${alpha})`;
  let c = hex.slice(1);
  if (c.length === 3) c = c.split('').map(x => x + x).join('');
  const num = parseInt(c, 16);
  const r = (num >> 16) & 255;
  const g = (num >> 8) & 255;
  const b = num & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function truncate(str, max) {
  if (!str || str.length <= max) return str;
  return str.slice(0, max - 1) + '…';
}

// ---------- shared image loading (trace layers, final image): the editor redraws when one arrives
let fileUrl = f => f;
let onImageLoad = null;
export function setImageLoadHandler(fn) { onImageLoad = fn; }
const imageCache = new Map();
export function loadImage(src) {
  let img = imageCache.get(src);
  if (!img) { img = new Image(); img.onload = () => onImageLoad?.(); img.src = src; imageCache.set(src, img); }
  return img.complete && img.naturalWidth ? img : null;
}

// ---------- final: the chosen variant cover-cropped + adjustments + text and marks drawn by code
export const FINAL_DEFAULTS = { x: 0.5, y: 0.5, zoom: 1, brightness: 1, contrast: 1, saturation: 1, vignette: 0, shade: 0 };
export function drawFinal(ctx, brief, opts = {}) {
  const W = ctx.canvas.width, H = ctx.canvas.height;
  const fe = { ...FINAL_DEFAULTS, ...(brief.finalEdit || {}) };
  ctx.save();
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = '#0b0c10'; ctx.fillRect(0, 0, W, H);
  const v = (brief.variants || []).find(x => x.id === (opts.variantId || brief.chosen));
  const img = opts.image || (v ? loadImage(fileUrl(v.file)) : null);
  if (img) {
    // cover crop: zoom >= 1, x/y = which part of the image stays in view
    const s = Math.max(W / img.naturalWidth, H / img.naturalHeight) * Math.max(1, fe.zoom);
    const dw = img.naturalWidth * s, dh = img.naturalHeight * s;
    const dx = (W - dw) * fe.x, dy = (H - dh) * fe.y;
    ctx.filter = `brightness(${fe.brightness}) contrast(${fe.contrast}) saturate(${fe.saturation})`;
    ctx.drawImage(img, dx, dy, dw, dh);
    ctx.filter = 'none';
  } else if (!opts.isExport) {
    ctx.fillStyle = 'rgba(255,255,255,0.55)'; ctx.font = '22px "Segoe UI", sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(v ? 'Loading image…' : 'Choose a variant for the final image from the strip below', W / 2, H / 2);
  }
  if (fe.vignette > 0) {
    const g = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.35, W / 2, H / 2, Math.hypot(W, H) / 2);
    g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, `rgba(0,0,0,${0.85 * fe.vignette})`);
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  }
  const layers = (brief.layers || []).filter(l => !l.hidden && isOverlayLayer(l));
  // readability: a soft dark gradient behind each text block
  if (fe.shade > 0) for (const l of layers.filter(l => l.type === 'text')) {
    const b = getLayerBox(l, W, H);
    const g = ctx.createRadialGradient(b.cx, b.cy, 0, b.cx, b.cy, Math.max(b.w, b.h) * 0.75);
    g.addColorStop(0, `rgba(0,0,0,${0.75 * fe.shade})`); g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g; ctx.fillRect(b.x - b.w * 0.3, b.y - b.h * 0.5, b.w * 1.6, b.h * 2);
  }
  for (const l of layers) {
    ctx.save();
    const { x, y, w, h, cx, cy } = getLayerBox(l, W, H);
    if (l.rot) { ctx.translate(cx, cy); ctx.rotate((l.rot * Math.PI) / 180); ctx.translate(-cx, -cy); }
    if (l.type === 'text') drawTextBlock(ctx, l, x, y, w, h, !!opts.isExport, true);
    else drawEffect(ctx, l, x, y, w, h, { isExport: true });
    ctx.restore();
  }
  if (!opts.isExport) {
    if (opts.showBadge !== false && brief.safe?.badge !== false && brief.format !== '9:16') drawBadgeGuide(ctx, W, H);
    if (brief.format === '9:16' && brief.safe?.shortsUi) drawShortsGuide(ctx, W, H);
    if (opts.selectedLayerId) {
      const sel = layers.find(l => l.id === opts.selectedLayerId);
      if (sel) drawSelectionHandles(ctx, sel, W, H);
    }
  }
  ctx.restore();
}

function drawSketchOverlays(ctx, brief, W, H) {
  const layers = brief.layers || [];
  const contentLayers = layers.filter(l => !l.hidden && (l.type === 'subject' || l.type === 'object' || l.type === 'effect'));

  let idx = 1;
  const legend = [];

  for (const layer of contentLayers) {
    const { x, y } = getLayerBox(layer, W, H);
    const plan = (layer.depth ?? 50) < 33 ? 'Foreground' : (layer.depth ?? 50) < 67 ? 'Midground' : 'Background';
    const label = `${idx}. ${layer.name || layer.type} (${plan})`;
    legend.push(label);

    // Number badge
    ctx.save();
    ctx.fillStyle = '#ef4444';
    ctx.beginPath();
    ctx.arc(x + 14, y + 14, 12, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 12px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(idx), x + 14, y + 14);

    // Bounding label box
    ctx.font = '11px sans-serif';
    const textWidth = ctx.measureText(label).width;
    ctx.fillStyle = 'rgba(0, 0, 0, 0.75)';
    ctx.fillRect(x + 30, y + 2, textWidth + 12, 22);
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'left';
    ctx.fillText(label, x + 36, y + 14);
    ctx.restore();

    idx++;
  }

  // Text layers dashed outline
  for (const layer of layers.filter(l => !l.hidden && l.type === 'text')) {
    const { x, y, w, h } = getLayerBox(layer, W, H);
    ctx.save();
    ctx.strokeStyle = '#f59e0b';
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 4]);
    ctx.strokeRect(x, y, w, h);
    ctx.fillStyle = 'rgba(245, 158, 11, 0.9)';
    ctx.font = 'bold 11px sans-serif';
    ctx.fillText(`[TEXT AREA: "${layer.content || ''}"]`, x + 6, y - 6);
    ctx.restore();
  }

  // HUD summary box in bottom-left
  ctx.save();
  const hudW = Math.min(320, W * 0.45);
  const hudLines = [
    `Camera: ${brief.camera?.shot || 'medium'} · ${brief.camera?.angle || 'eye level'} · ${brief.camera?.lens || 50}mm`,
    `Light: ${brief.light?.key || 'warm'} / ${brief.light?.time || 'day'}${brief.light?.rim ? ' (rim)' : ''}`,
    `Style: ${brief.style?.preset || 'cinematic-photo'}`,
  ];
  if (legend.length) {
    hudLines.push('---');
    hudLines.push(...legend.slice(0, 6));
  }
  const hudH = hudLines.length * 16 + 16;
  const hudX = 14;
  const hudY = H - hudH - 14;

  ctx.fillStyle = 'rgba(15, 23, 42, 0.88)';
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
  ctx.lineWidth = 1;
  ctx.fillRect(hudX, hudY, hudW, hudH);
  ctx.strokeRect(hudX, hudY, hudW, hudH);

  ctx.fillStyle = '#e2e8f0';
  ctx.font = '11px sans-serif';
  ctx.textAlign = 'left';
  let curY = hudY + 16;
  for (const line of hudLines) {
    if (line === '---') {
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
      ctx.beginPath();
      ctx.moveTo(hudX + 8, curY - 4);
      ctx.lineTo(hudX + hudW - 8, curY - 4);
      ctx.stroke();
      curY += 8;
      continue;
    }
    ctx.fillText(line, hudX + 10, curY);
    curY += 16;
  }
  ctx.restore();
}

// Generate high quality data URLs for layout.png, sketch.png, depth.png
export async function renderExportCanvases(brief, { fileUrl: fu } = {}) {
  if (fu) fileUrl = fu;
  const is916 = brief.format === '9:16';

  // 1. layout.png (1672x941 or 941x1672)
  const lW = is916 ? 941 : 1672;
  const lH = is916 ? 1672 : 941;
  const layoutCanvas = document.createElement('canvas');
  layoutCanvas.width = lW;
  layoutCanvas.height = lH;
  const lCtx = layoutCanvas.getContext('2d');
  drawScene(lCtx, brief, 'layout', { isExport: true, showGrid: true });

  // 2. sketch.png (1280 wide: 1280x720 or 720x1280)
  const sW = is916 ? 720 : 1280;
  const sH = is916 ? 1280 : 720;
  const sketchCanvas = document.createElement('canvas');
  sketchCanvas.width = sW;
  sketchCanvas.height = sH;
  const sCtx = sketchCanvas.getContext('2d');
  drawScene(sCtx, brief, 'sketch', { isExport: false, showThirds: false, showBadge: false });

  // 3. depth.png (640 wide: 640x360 or 360x640)
  const dW = is916 ? 360 : 640;
  const dH = is916 ? 640 : 360;
  const depthCanvas = document.createElement('canvas');
  depthCanvas.width = dW;
  depthCanvas.height = dH;
  const dCtx = depthCanvas.getContext('2d');
  drawScene(dCtx, brief, 'depth', { isExport: true });

  return {
    layout: layoutCanvas.toDataURL('image/png'),
    sketch: sketchCanvas.toDataURL('image/png'),
    depth: depthCanvas.toDataURL('image/png'),
  };
}

// layer boxes for other modules (final panel checks)
export { getLayerBox as getLayerBoxSafe };
