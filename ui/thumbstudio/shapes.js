// Effect & Shape Library for Classic YouTube Highlights

export function drawEffect(ctx, layer, x, y, w, h, opts = {}) {
  ctx.save();
  const kind = layer.kind || 'arrow';
  const stroke = layer.stroke || '#ff2222';
  const fill = layer.fill || null;
  const lw = Math.max(2, Math.min(w, h) * 0.04);

  ctx.strokeStyle = stroke;
  ctx.fillStyle = fill || stroke;
  ctx.lineWidth = lw;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  switch (kind) {
    case 'arrow': {
      drawArrow(ctx, x, y, w, h, stroke, lw);
      break;
    }
    case 'circle': {
      // Classic YouTube highlight circle (thick, slightly tilted oval)
      ctx.beginPath();
      ctx.ellipse(x + w / 2, y + h / 2, w / 2 - lw, h / 2 - lw, -0.08, 0, Math.PI * 2);
      ctx.stroke();
      break;
    }
    case 'x-mark': {
      // Red X
      const pad = lw * 1.5;
      ctx.beginPath();
      ctx.moveTo(x + pad, y + pad);
      ctx.lineTo(x + w - pad, y + h - pad);
      ctx.moveTo(x + w - pad, y + pad);
      ctx.lineTo(x + pad, y + h - pad);
      ctx.stroke();
      break;
    }
    case 'check': {
      // Green check ✓
      ctx.strokeStyle = stroke || '#2ecc71';
      ctx.beginPath();
      ctx.moveTo(x + w * 0.15, y + h * 0.55);
      ctx.lineTo(x + w * 0.42, y + h * 0.82);
      ctx.lineTo(x + w * 0.88, y + h * 0.22);
      ctx.stroke();
      break;
    }
    case 'glow': {
      // Radial glow gradient
      const grad = ctx.createRadialGradient(x + w / 2, y + h / 2, 0, x + w / 2, y + h / 2, Math.max(w, h) / 2);
      grad.addColorStop(0, hexToRgba(stroke, 0.6));
      grad.addColorStop(0.6, hexToRgba(stroke, 0.2));
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = grad;
      ctx.fillRect(x, y, w, h);
      break;
    }
    case 'split': {
      // Before / After division line
      ctx.beginPath();
      ctx.moveTo(x + w / 2, y);
      ctx.lineTo(x + w / 2, y + h);
      ctx.stroke();
      break;
    }
    case 'light-rays': {
      // Sunburst rays from center
      const cx = x + w / 2;
      const cy = y + h / 2;
      const radius = Math.max(w, h);
      ctx.save();
      ctx.globalAlpha = 0.25;
      ctx.fillStyle = stroke || '#f1c40f';
      const numRays = 12;
      for (let i = 0; i < numRays; i++) {
        const a1 = (i / numRays) * Math.PI * 2;
        const a2 = a1 + (Math.PI / numRays) * 0.5;
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.arc(cx, cy, radius, a1, a2);
        ctx.closePath();
        ctx.fill();
      }
      ctx.restore();
      break;
    }
    case 'badge': {
      // Text badge / pill
      ctx.beginPath();
      const r = Math.min(w, h) * 0.25;
      ctx.roundRect ? ctx.roundRect(x, y, w, h, r) : ctx.rect(x, y, w, h);
      ctx.fill();
      ctx.stroke();
      break;
    }
    case 'blur-zone': {
      // Frosted blur zone indicator
      ctx.save();
      ctx.setLineDash([6, 6]);
      ctx.strokeRect(x, y, w, h);
      ctx.fillStyle = 'rgba(255, 255, 255, 0.15)';
      ctx.fillRect(x, y, w, h);
      ctx.restore();
      break;
    }
    default: {
      ctx.strokeRect(x, y, w, h);
      break;
    }
  }
  ctx.restore();
}

function drawArrow(ctx, x, y, w, h, color, lw) {
  ctx.save();
  // Draw an arched or straight arrow pointing towards the end
  const startX = x + w * 0.1;
  const startY = y + h * 0.9;
  const endX = x + w * 0.9;
  const endY = y + h * 0.15;
  const ctrlX = x + w * 0.2;
  const ctrlY = y + h * 0.2;

  // Arrow shaft (curved)
  ctx.beginPath();
  ctx.moveTo(startX, startY);
  ctx.quadraticCurveTo(ctrlX, ctrlY, endX, endY);
  ctx.stroke();

  // Arrow head
  const headAngle = Math.atan2(endY - ctrlY, endX - ctrlX);
  const headLen = Math.max(16, lw * 3.5);

  ctx.beginPath();
  ctx.moveTo(endX, endY);
  ctx.lineTo(
    endX - headLen * Math.cos(headAngle - Math.PI / 6),
    endY - headLen * Math.sin(headAngle - Math.PI / 6)
  );
  ctx.lineTo(
    endX - headLen * Math.cos(headAngle + Math.PI / 6),
    endY - headLen * Math.sin(headAngle + Math.PI / 6)
  );
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

function hexToRgba(hex, alpha) {
  if (!hex || !hex.startsWith('#')) return `rgba(255, 34, 34, ${alpha})`;
  let c = hex.slice(1);
  if (c.length === 3) c = c.split('').map(x => x + x).join('');
  const num = parseInt(c, 16);
  const r = (num >> 16) & 255;
  const g = (num >> 8) & 255;
  const b = num & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
