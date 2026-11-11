// Camera, Perspective Grid, Angle Calculations, and Framing Consistency Checks
import { CAMERA_ANGLES, CAMERA_SHOTS, LENSES } from './catalog.js';

// Calculate grid parameters from camera settings
export function getGridParams(camera, W, H) {
  const angle = camera.angle || 'eye';
  const angleDef = CAMERA_ANGLES.find(a => a.id === angle) || CAMERA_ANGLES[0];
  const horizon = camera.horizon != null ? camera.horizon : (angleDef.horizon != null ? angleDef.horizon : 0.5);
  const vanishX = camera.vanishX != null ? camera.vanishX : 0.5;
  const tilt = camera.tilt || 0;
  const lens = camera.lens || 50;

  // Grid density based on lens focal length: wider lens = more compressed lines at edges
  const lineCount = lens <= 24 ? 16 : lens <= 50 ? 10 : 6;

  return {
    angle,
    horizonY: horizon * H,
    vanishX: vanishX * W,
    tilt,
    lineCount,
    isBirdsEye: angle === 'birds-eye' || angle === 'overhead'
  };
}

// Draw dynamic perspective grid on canvas
export function drawPerspectiveGrid(ctx, camera, W, H) {
  ctx.save();
  const { angle, horizonY, vanishX, tilt, lineCount, isBirdsEye } = getGridParams(camera, W, H);

  // Apply dutch tilt if any
  if (tilt) {
    ctx.translate(W / 2, H / 2);
    ctx.rotate((tilt * Math.PI) / 180);
    ctx.translate(-W / 2, -H / 2);
  }

  if (isBirdsEye) {
    // Top-down square grid
    ctx.strokeStyle = 'rgba(96, 156, 255, 0.15)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    const step = W / 10;
    for (let x = 0; x <= W; x += step) {
      ctx.moveTo(x, 0); ctx.lineTo(x, H);
    }
    for (let y = 0; y <= H; y += step) {
      ctx.moveTo(0, y); ctx.lineTo(W, y);
    }
    ctx.stroke();
    ctx.restore();
    return;
  }

  // Horizon line
  ctx.strokeStyle = 'rgba(96, 156, 255, 0.45)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(0, horizonY);
  ctx.lineTo(W, horizonY);
  ctx.stroke();

  // Vanishing point dot
  ctx.fillStyle = '#609cff';
  ctx.beginPath();
  ctx.arc(vanishX, horizonY, 3, 0, Math.PI * 2);
  ctx.fill();

  // Perspective rays
  ctx.strokeStyle = 'rgba(96, 156, 255, 0.16)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let i = 0; i <= lineCount; i++) {
    const bottomX = (i / lineCount) * W;
    ctx.moveTo(vanishX, horizonY);
    ctx.lineTo(bottomX, H);
  }

  // Horizontal transversal ground lines (spaced with logarithmic perspective compression)
  const groundHeight = H - horizonY;
  if (groundHeight > 20) {
    for (let i = 1; i <= 6; i++) {
      const frac = Math.pow(i / 6, 2);
      const gy = horizonY + groundHeight * frac;
      ctx.moveTo(0, gy);
      ctx.lineTo(W, gy);
    }
  }
  ctx.stroke();

  ctx.restore();
}

// Framing consistency check: warns if shot size contradicts subject crop
export function checkFramingConsistency(brief) {
  const warnings = [];
  const shot = brief.camera?.shot || 'wide';
  const isWide = shot === 'wide' || shot === 'extreme-wide';
  const isClose = shot === 'close' || shot === 'extreme-close';

  for (const l of brief.layers || []) {
    if (l.type === 'subject' && !l.hidden) {
      const crop = l.crop || 'full';
      if (isWide && (crop === 'head' || crop === 'chest')) {
        warnings.push({
          layerId: l.id,
          text: `Shot '${shot}' is selected, but "${l.name}" is cropped to the head/chest. Use a full-body character in a wide shot, or switch to a close-up.`
        });
      }
      if (isClose && crop === 'full') {
        warnings.push({
          layerId: l.id,
          text: `A close-up shot is selected, but "${l.name}" is full-body.`
        });
      }
    }
  }
  return warnings;
}

// Perspective lock scale & position adjustment when depth changes
export function applyPerspectiveLock(layer, oldDepth, newDepth, camera) {
  const lens = camera?.lens || 50;
  // Closer lens (wide) has more extreme perspective scaling
  const fovFactor = lens <= 24 ? 1.8 : lens <= 50 ? 1.2 : 0.7;

  // Scale ratio based on depth change (closer = bigger, farther = smaller)
  const dDiff = (newDepth - oldDepth) / 100;
  const scale = 1 - dDiff * fovFactor;
  const clampedScale = Math.max(0.2, Math.min(3.0, scale));

  const newW = layer.w * clampedScale;
  const newH = layer.h * clampedScale;

  // Shift base anchor point towards horizon
  const horizon = camera?.horizon ?? 0.5;
  const shiftY = (horizon - (layer.y + layer.h)) * dDiff * 0.5;

  return {
    w: newW,
    h: newH,
    x: layer.x + (layer.w - newW) / 2,
    y: layer.y + (layer.h - newH) + shiftY,
    depth: newDepth
  };
}
