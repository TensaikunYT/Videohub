// Layer model, defaults, hit-testing, handles, and snapping

export const HANDLE_SIZE = 8;
export const ROTATE_HANDLE_OFFSET = 24;

export function generateLayerId(layers = []) {
  let max = 0;
  for (const l of layers) {
    const m = (l.id || '').match(/^L(\d+)$/);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return 'L' + (max + 1);
}

export function createObjectLayer(layers = [], overrides = {}) {
  return {
    id: generateLayerId(layers),
    type: 'object',
    name: overrides.name || 'New object',
    x: overrides.x ?? 0.35,
    y: overrides.y ?? 0.35,
    w: overrides.w ?? 0.3,
    h: overrides.h ?? 0.3,
    rot: overrides.rot ?? 0,
    flip: false,
    depth: overrides.depth ?? 40,
    importance: overrides.importance ?? 2,
    focus: 'auto',
    desc: overrides.desc || 'Featured object',
    color: overrides.color || '#f08a3c',
    hidden: false,
    locked: false,
    shape: overrides.shape || 'rect', // rect | ellipse | triangle
    material: overrides.material || '',
    refs: [],
    ...overrides
  };
}

export function createBackgroundLayer(layers = [], overrides = {}) {
  return {
    id: generateLayerId(layers),
    type: 'background',
    name: overrides.name || 'Background',
    x: 0,
    y: 0,
    w: 1,
    h: 1,
    rot: 0,
    flip: false,
    depth: 100, // always 100
    importance: 1,
    focus: 'auto',
    desc: overrides.desc || 'Dramatic background',
    color: overrides.color || '#1e2430',
    hidden: false,
    locked: true,
    kind: overrides.kind || 'scene', // scene | gradient | solid | blur
    refs: [],
    ...overrides
  };
}

export function createZoneLayer(layers = [], overrides = {}) {
  return {
    id: generateLayerId(layers),
    type: 'zone',
    name: overrides.name || 'Empty space',
    x: overrides.x ?? 0.05,
    y: overrides.y ?? 0.05,
    w: overrides.w ?? 0.4,
    h: overrides.h ?? 0.3,
    rot: 0,
    flip: false,
    depth: 0,
    importance: 1,
    focus: 'auto',
    desc: 'Keep this negative space clear for a title or face',
    color: overrides.color || '#a68cff',
    hidden: false,
    locked: false,
    purpose: overrides.purpose || 'title', // empty | title | face
    refs: [],
    ...overrides
  };
}

export function createSubjectLayer(layers = [], overrides = {}) {
  return {
    id: generateLayerId(layers),
    type: 'subject',
    name: overrides.name || 'Person / Character',
    x: overrides.x ?? 0.60,
    y: overrides.y ?? 0.15,
    w: overrides.w ?? 0.35,
    h: overrides.h ?? 0.80,
    rot: overrides.rot ?? 0,
    flip: false,
    depth: overrides.depth ?? 20,
    importance: overrides.importance ?? 3,
    focus: 'auto',
    desc: overrides.desc || 'Main character, surprised expression',
    color: overrides.color || '#6aa0ff',
    hidden: false,
    locked: false,
    pose: overrides.pose || 'ayakta',
    expression: overrides.expression || 'notr',
    facing: overrides.facing || 'camera',
    gaze: overrides.gaze || 'camera',
    crop: overrides.crop || 'full',
    refs: [],
    ...overrides
  };
}

export function createTextLayer(layers = [], overrides = {}) {
  return {
    id: generateLayerId(layers),
    type: 'text',
    name: overrides.name || 'Title text',
    x: overrides.x ?? 0.05,
    y: overrides.y ?? 0.15,
    w: overrides.w ?? 0.50,
    h: overrides.h ?? 0.25,
    rot: overrides.rot ?? 0,
    flip: false,
    depth: overrides.depth ?? 0,
    importance: 2,
    focus: 'sharp',
    desc: overrides.desc || '',
    color: overrides.color || '#e6c14d',
    hidden: false,
    locked: false,
    content: overrides.content || 'BIG TITLE\nGOES HERE',
    font: overrides.font || 'Impact',
    size: overrides.size ?? 0.14,
    fill: overrides.fill || '#ffffff',
    stroke: overrides.stroke || '#000000',
    strokeW: overrides.strokeW ?? 0.06,
    shadow: overrides.shadow !== false,
    align: overrides.align || 'center',
    lineHeight: overrides.lineHeight ?? 1.15,
    uppercase: overrides.uppercase !== false,
    highlightWords: overrides.highlightWords || [],
    bg: overrides.bg || null,
    refs: [],
    ...overrides
  };
}

export function createEffectLayer(layers = [], overrides = {}) {
  return {
    id: generateLayerId(layers),
    type: 'effect',
    name: overrides.name || 'Emphasis effect',
    x: overrides.x ?? 0.40,
    y: overrides.y ?? 0.40,
    w: overrides.w ?? 0.20,
    h: overrides.h ?? 0.20,
    rot: overrides.rot ?? 0,
    flip: false,
    depth: overrides.depth ?? 10,
    importance: 1,
    focus: 'auto',
    desc: overrides.desc || 'Eye-catching red mark',
    color: overrides.color || '#e85454',
    hidden: false,
    locked: false,
    kind: overrides.kind || 'arrow', // arrow | circle | x-mark | check | glow | split | light-rays | badge
    stroke: overrides.stroke || '#e85454',
    fill: overrides.fill || null,
    overlay: true,
    refs: [],
    ...overrides
  };
}

export function createSketchLayer(layers = [], overrides = {}) {
  return {
    id: generateLayerId(layers),
    type: 'sketch',
    name: overrides.name || 'Sketch',
    x: 0,
    y: 0,
    w: 1,
    h: 1,
    rot: 0,
    flip: false,
    depth: overrides.depth ?? 30,
    importance: 1,
    focus: 'auto',
    desc: overrides.desc || 'Rough sketch',
    color: overrides.color || '#ff4444',
    hidden: false,
    locked: false,
    strokes: [],
    refs: [],
    ...overrides
  };
}

export function createTraceLayer(layers = [], overrides = {}) {
  return {
    id: generateLayerId(layers),
    type: 'trace',
    name: overrides.name || 'Trace underlay',
    x: 0,
    y: 0,
    w: 1,
    h: 1,
    rot: 0,
    flip: false,
    depth: 100,
    importance: 1,
    focus: 'auto',
    desc: 'Reference image underlay',
    color: '#888888',
    hidden: false,
    locked: true,
    file: overrides.file || '',
    opacity: overrides.opacity ?? 0.4,
    refs: [],
    ...overrides
  };
}

// Convert normalized layer coords (0..1) to pixel bounding box and center
export function getLayerBox(layer, W, H) {
  // the background always fills the frame; templates may leave its box (and other boxes) out
  const full = layer.type === 'background';
  const n = (v, d) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
  const x = (full ? 0 : n(layer.x, 0.25)) * W;
  const y = (full ? 0 : n(layer.y, 0.25)) * H;
  const w = (full ? 1 : n(layer.w, 0.5)) * W;
  const h = (full ? 1 : n(layer.h, 0.5)) * H;
  const cx = x + w / 2;
  const cy = y + h / 2;
  return { x, y, w, h, cx, cy };
}

// Transform point (px, py) by inverse layer rotation around center
export function toLayerLocal(px, py, cx, cy, rotDeg) {
  const rad = (-rotDeg * Math.PI) / 180;
  const dx = px - cx;
  const dy = py - cy;
  const rx = dx * Math.cos(rad) - dy * Math.sin(rad);
  const ry = dx * Math.sin(rad) + dy * Math.cos(rad);
  return { x: rx + cx, y: ry + cy };
}

// Check if a point hits a layer (taking rotation into account)
export function pointInLayer(px, py, layer, W, H) {
  if (layer.hidden) return false;
  const { x, y, w, h, cx, cy } = getLayerBox(layer, W, H);
  const local = toLayerLocal(px, py, cx, cy, layer.rot || 0);
  return local.x >= x && local.x <= x + w && local.y >= y && local.y <= y + h;
}

// Find topmost layer under point
export function hitTestLayer(px, py, layers, W, H) {
  // Check from top to bottom (reverse order of drawing)
  for (let i = layers.length - 1; i >= 0; i--) {
    const l = layers[i];
    if (l.hidden || l.locked) continue;
    if (pointInLayer(px, py, l, W, H)) {
      return l;
    }
  }
  return null;
}

// Calculate the 8 resize handle positions + 1 rotate handle
export function getHandles(layer, W, H) {
  const { x, y, w, h, cx, cy } = getLayerBox(layer, W, H);
  const rad = ((layer.rot || 0) * Math.PI) / 180;

  // Unrotated points relative to (cx, cy)
  const pts = [
    { id: 'nw', x: -w / 2, y: -h / 2, cursor: 'nwse-resize' },
    { id: 'n',  x: 0,      y: -h / 2, cursor: 'ns-resize' },
    { id: 'ne', x: w / 2,  y: -h / 2, cursor: 'nesw-resize' },
    { id: 'e',  x: w / 2,  y: 0,      cursor: 'ew-resize' },
    { id: 'se', x: w / 2,  y: h / 2,  cursor: 'nwse-resize' },
    { id: 's',  x: 0,      y: h / 2,  cursor: 'ns-resize' },
    { id: 'sw', x: -w / 2, y: h / 2,  cursor: 'nesw-resize' },
    { id: 'w',  x: -w / 2, y: 0,      cursor: 'ew-resize' },
    { id: 'rot', x: 0,     y: -h / 2 - ROTATE_HANDLE_OFFSET, cursor: 'grab' },
  ];

  return pts.map(p => {
    // Rotate point around center
    const rx = p.x * Math.cos(rad) - p.y * Math.sin(rad);
    const ry = p.x * Math.sin(rad) + p.y * Math.cos(rad);
    return {
      id: p.id,
      x: cx + rx,
      y: cy + ry,
      cursor: p.cursor
    };
  });
}

// Hit-test handles of the selected layer
export function hitTestHandle(px, py, layer, W, H) {
  if (!layer || layer.hidden || layer.locked) return null;
  const handles = getHandles(layer, W, H);
  const thresh = HANDLE_SIZE + 4;

  for (const h of handles) {
    const dist = Math.hypot(px - h.x, py - h.y);
    if (dist <= thresh) {
      return h;
    }
  }
  return null;
}

// Snapping logic: returns adjusted (x, y) and active guide lines
export function snapLayerBounds(newX, newY, w, h, otherLayers, W, H, thresholdPx = 8) {
  const threshNormX = thresholdPx / W;
  const threshNormY = thresholdPx / H;

  let snappedX = newX;
  let snappedY = newY;
  const guides = [];

  // Important vertical snap points: 0, 1/3, 1/2, 2/3, 1
  const vPoints = [0, 1 / 3, 0.5, 2 / 3, 1];
  // Important horizontal snap points: 0, 1/3, 1/2, 2/3, 1
  const hPoints = [0, 1 / 3, 0.5, 2 / 3, 1];

  // Also snap to edges / centers of other layers
  for (const ol of otherLayers) {
    if (ol.hidden) continue;
    vPoints.push(ol.x, ol.x + ol.w / 2, ol.x + ol.w);
    hPoints.push(ol.y, ol.y + ol.h / 2, ol.y + ol.h);
  }

  // Check left, center, right edges
  const left = newX;
  const centerX = newX + w / 2;
  const right = newX + w;

  for (const vp of vPoints) {
    if (Math.abs(left - vp) < threshNormX) {
      snappedX = vp;
      guides.push({ type: 'v', pos: vp });
      break;
    } else if (Math.abs(centerX - vp) < threshNormX) {
      snappedX = vp - w / 2;
      guides.push({ type: 'v', pos: vp });
      break;
    } else if (Math.abs(right - vp) < threshNormX) {
      snappedX = vp - w;
      guides.push({ type: 'v', pos: vp });
      break;
    }
  }

  // Check top, center, bottom edges
  const top = newY;
  const centerY = newY + h / 2;
  const bottom = newY + h;

  for (const hp of hPoints) {
    if (Math.abs(top - hp) < threshNormY) {
      snappedY = hp;
      guides.push({ type: 'h', pos: hp });
      break;
    } else if (Math.abs(centerY - hp) < threshNormY) {
      snappedY = hp - h / 2;
      guides.push({ type: 'h', pos: hp });
      break;
    } else if (Math.abs(bottom - hp) < threshNormY) {
      snappedY = hp - h;
      guides.push({ type: 'h', pos: hp });
      break;
    }
  }

  return { snappedX, snappedY, guides };
}
