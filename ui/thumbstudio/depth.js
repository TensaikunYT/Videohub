// Side-view Depth Panel and Depth Mode Rendering
import { h } from '../app.js';

export function createDepthPanel(brief, { onLayerDepthChange, onSelectLayer }) {
  // Undo/redo replaces the brief object; always resolve the current editor state.
  const getBrief = typeof brief === 'function' ? brief : () => brief;
  const panel = h('div', { class: 'depth-panel' });

  const header = h('div', { class: 'depth-header row' },
    h('span', { style: { fontWeight: 600, fontSize: '11px', color: 'var(--dim)' } }, 'SIDE VIEW (DEPTH PLAN)'),
    h('span', { class: 'spacer' }),
    h('span', { class: 'dim', style: { fontSize: '11px' } }, '📷 Near (0) ────── Middle (50) ────── Far (100)')
  );
  panel.append(header);

  const canvas = document.createElement('canvas');
  canvas.height = 70;
  canvas.style.width = '100%';
  canvas.style.height = '70px';
  canvas.style.display = 'block';
  canvas.style.cursor = 'ew-resize';
  canvas.style.touchAction = 'none';
  panel.append(canvas);

  let isDragging = false;
  let draggedLayerId = null;
  let pointerId = null;
  let destroyed = false;

  function render() {
    if (destroyed) return;
    const brief = getBrief();
    canvas.width = Math.max(1, Math.round(canvas.clientWidth));
    const ctx = canvas.getContext('2d');
    const W = canvas.width;
    const H = canvas.height;

    ctx.clearRect(0, 0, W, H);

    // 1. Background zones (Foreground, Midground, Background)
    const leftPad = 40; // Camera icon area
    const trackW = Math.max(1, W - leftPad - 16);

    // Foreground 0..33
    ctx.fillStyle = 'rgba(255, 255, 255, 0.04)';
    ctx.fillRect(leftPad, 0, trackW * 0.33, H);

    // Midground 34..66
    ctx.fillStyle = 'rgba(255, 255, 255, 0.02)';
    ctx.fillRect(leftPad + trackW * 0.33, 0, trackW * 0.33, H);

    // Camera icon and FOV cone
    ctx.fillStyle = '#609cff';
    ctx.font = '14px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('📷◁', leftPad / 2, H / 2);

    // Shaded DoF cone if focusLayer is set
    const focusLayer = (brief.layers || []).find(l => l.id === brief.camera?.focusLayer);
    if (focusLayer) {
      const focusX = leftPad + ((focusLayer.depth ?? 50) / 100) * trackW;
      const dofRadius = Math.max(10, (1 - (brief.camera?.dof ?? 0.5)) * 60);

      ctx.fillStyle = 'rgba(240, 138, 60, 0.15)';
      ctx.fillRect(Math.max(leftPad, focusX - dofRadius), 0, dofRadius * 2, H);

      ctx.strokeStyle = '#f08a3c';
      ctx.setLineDash([2, 2]);
      ctx.strokeRect(focusX - dofRadius, 0, dofRadius * 2, H);
      ctx.setLineDash([]);
    }

    // 2. Draw each layer as vertical bar
    const layers = brief.layers || [];
    for (const l of layers) {
      if (l.hidden) continue;
      const depth = Math.max(0, Math.min(100, l.depth ?? 50));
      const barX = leftPad + (depth / 100) * trackW;

      // Vertical span from layer Y and H
      const topY = Math.max(6, (l.y || 0) * (H - 12) + 6);
      const barH = Math.max(16, (l.h || 0.3) * (H - 12));

      ctx.save();
      ctx.fillStyle = l.color || '#6aa0ff';
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.5;

      // Bar
      ctx.fillRect(barX - 4, topY, 8, barH);
      ctx.strokeRect(barX - 4, topY, 8, barH);

      // Focus layer ring
      if (focusLayer && focusLayer.id === l.id) {
        ctx.fillStyle = '#f08a3c';
        ctx.beginPath();
        ctx.arc(barX, topY - 5, 4, 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.restore();
    }
  }

  function getDepthFromEvent(e) {
    const rect = canvas.getBoundingClientRect();
    const leftPad = 40;
    const trackW = Math.max(1, rect.width - leftPad - 16);
    const clickX = e.clientX - rect.left - leftPad;
    const norm = Math.max(0, Math.min(1, clickX / trackW));
    return Math.round(norm * 100);
  }

  function getLayerUnderPointer(e) {
    const rect = canvas.getBoundingClientRect();
    const leftPad = 40;
    const trackW = Math.max(1, rect.width - leftPad - 16);
    const clickX = e.clientX - rect.left;

    for (const l of getBrief().layers || []) {
      if (l.hidden || l.locked || l.type === 'background') continue;
      const lx = leftPad + ((l.depth ?? 50) / 100) * trackW;
      if (Math.abs(clickX - lx) <= 12) {
        return l;
      }
    }
    return null;
  }

  const startDrag = e => {
    if (destroyed || (e.button != null && e.button !== 0) || isDragging) return;
    const hit = getLayerUnderPointer(e);
    if (hit) {
      e.preventDefault();
      pointerId = e.pointerId;
      canvas.setPointerCapture(pointerId);
      isDragging = true;
      draggedLayerId = hit.id;
      onSelectLayer && onSelectLayer(hit.id);
    }
  };

  const moveDrag = e => {
    if (destroyed || !isDragging || !draggedLayerId || e.pointerId !== pointerId) return;
    const newDepth = getDepthFromEvent(e);
    const layer = (getBrief().layers || []).find(l => l.id === draggedLayerId);
    if (!layer || layer.hidden || layer.locked || layer.type === 'background') {
      endDrag();
      return;
    }
    if (newDepth !== (layer.depth ?? 50)) {
      onLayerDepthChange && onLayerDepthChange(layer.id, newDepth);
      render();
    }
  };

  const endDrag = e => {
    if (e && pointerId != null && e.pointerId !== pointerId) return;
    const captured = pointerId;
    isDragging = false;
    draggedLayerId = null;
    pointerId = null;
    if (captured != null && canvas.hasPointerCapture(captured)) canvas.releasePointerCapture(captured);
  };
  canvas.addEventListener('pointerdown', startDrag);
  canvas.addEventListener('pointermove', moveDrag);
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);
  canvas.addEventListener('lostpointercapture', endDrag);

  // ResizeObserver to redraw on window resize
  const ro = new ResizeObserver(() => render());
  ro.observe(panel);

  const initialDraw = setTimeout(render, 50);

  return {
    el: panel,
    update: () => render(),
    destroy: () => {
      destroyed = true;
      clearTimeout(initialDraw);
      ro.disconnect();
      endDrag();
      canvas.removeEventListener('pointerdown', startDrag);
      canvas.removeEventListener('pointermove', moveDrag);
      canvas.removeEventListener('pointerup', endDrag);
      canvas.removeEventListener('pointercancel', endDrag);
      canvas.removeEventListener('lostpointercapture', endDrag);
    }
  };
}
