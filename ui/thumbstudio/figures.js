// Mannequin & Pose Library (Vector-drawn 15-joint skeleton, crops, and expressions)

// Standard joint positions normalized in a 1x1 bounding box for full body:
// Head, Neck, Shoulders (L, R), Elbows (L, R), Wrists (L, R),
// Pelvis, Hips (L, R), Knees (L, R), Ankles (L, R)

export const FIGURE_POSES = {
  'ayakta': {
    head: [0.5, 0.12], neck: [0.5, 0.20],
    shL: [0.38, 0.23], elL: [0.35, 0.38], wrL: [0.34, 0.52],
    shR: [0.62, 0.23], elR: [0.65, 0.38], wrR: [0.66, 0.52],
    pelvis: [0.5, 0.52],
    hipL: [0.43, 0.53], knL: [0.42, 0.73], anL: [0.42, 0.94],
    hipR: [0.57, 0.53], knR: [0.58, 0.73], anR: [0.58, 0.94]
  },
  'isaret-ediyor-sag': {
    head: [0.46, 0.12], neck: [0.47, 0.20],
    shL: [0.36, 0.23], elL: [0.34, 0.38], wrL: [0.33, 0.52],
    shR: [0.58, 0.23], elR: [0.72, 0.22], wrR: [0.92, 0.20], // Arm pointing right
    pelvis: [0.48, 0.52],
    hipL: [0.42, 0.53], knL: [0.40, 0.73], anL: [0.40, 0.94],
    hipR: [0.54, 0.53], knR: [0.56, 0.73], anR: [0.58, 0.94]
  },
  'isaret-ediyor-sol': {
    head: [0.54, 0.12], neck: [0.53, 0.20],
    shL: [0.42, 0.23], elL: [0.28, 0.22], wrL: [0.08, 0.20], // Arm pointing left
    shR: [0.64, 0.23], elR: [0.66, 0.38], wrR: [0.67, 0.52],
    pelvis: [0.52, 0.52],
    hipL: [0.46, 0.53], knL: [0.44, 0.73], anL: [0.42, 0.94],
    hipR: [0.58, 0.53], knR: [0.60, 0.73], anR: [0.60, 0.94]
  },
  'saskin-eller-yuzde': {
    head: [0.5, 0.14], neck: [0.5, 0.22],
    shL: [0.38, 0.25], elL: [0.32, 0.32], wrL: [0.42, 0.15], // Hand on left cheek
    shR: [0.62, 0.25], elR: [0.68, 0.32], wrR: [0.58, 0.15], // Hand on right cheek
    pelvis: [0.5, 0.54],
    hipL: [0.43, 0.55], knL: [0.42, 0.74], anL: [0.42, 0.94],
    hipR: [0.57, 0.55], knR: [0.58, 0.74], anR: [0.58, 0.94]
  },
  'dusunuyor-cene': {
    head: [0.5, 0.13], neck: [0.5, 0.21],
    shL: [0.38, 0.24], elL: [0.42, 0.38], wrL: [0.52, 0.38], // Left hand supporting
    shR: [0.62, 0.24], elR: [0.58, 0.32], wrR: [0.52, 0.18], // Right hand on chin
    pelvis: [0.5, 0.53],
    hipL: [0.43, 0.54], knL: [0.42, 0.73], anL: [0.42, 0.94],
    hipR: [0.57, 0.54], knR: [0.58, 0.73], anR: [0.58, 0.94]
  },
  'kollar-kavusuk': {
    head: [0.5, 0.12], neck: [0.5, 0.20],
    shL: [0.36, 0.23], elL: [0.34, 0.35], wrL: [0.56, 0.35], // Crossed arms
    shR: [0.64, 0.23], elR: [0.66, 0.35], wrR: [0.44, 0.35],
    pelvis: [0.5, 0.52],
    hipL: [0.43, 0.53], knL: [0.42, 0.73], anL: [0.42, 0.94],
    hipR: [0.57, 0.53], knR: [0.58, 0.73], anR: [0.58, 0.94]
  },
  'kosuyor': {
    head: [0.56, 0.13], neck: [0.53, 0.21],
    shL: [0.43, 0.24], elL: [0.32, 0.30], wrL: [0.25, 0.22],
    shR: [0.61, 0.24], elR: [0.70, 0.32], wrR: [0.78, 0.40],
    pelvis: [0.48, 0.50],
    hipL: [0.44, 0.52], knL: [0.30, 0.65], anL: [0.22, 0.82], // Left leg back
    hipR: [0.54, 0.52], knR: [0.66, 0.66], anR: [0.64, 0.90]  // Right leg forward bent
  },
  'oturuyor': {
    head: [0.48, 0.18], neck: [0.48, 0.27],
    shL: [0.38, 0.30], elL: [0.36, 0.44], wrL: [0.42, 0.56],
    shR: [0.58, 0.30], elR: [0.60, 0.44], wrR: [0.54, 0.56],
    pelvis: [0.48, 0.58],
    hipL: [0.42, 0.58], knL: [0.64, 0.60], anL: [0.64, 0.88], // Thigh horizontal, calf down
    hipR: [0.54, 0.58], knR: [0.72, 0.60], anR: [0.72, 0.88]
  },
  'comelmus': {
    head: [0.5, 0.32], neck: [0.5, 0.40],
    shL: [0.38, 0.43], elL: [0.34, 0.55], wrL: [0.42, 0.68],
    shR: [0.62, 0.43], elR: [0.66, 0.55], wrR: [0.58, 0.68],
    pelvis: [0.5, 0.65],
    hipL: [0.42, 0.65], knL: [0.32, 0.70], anL: [0.40, 0.92], // Deep crouch
    hipR: [0.58, 0.65], knR: [0.68, 0.70], anR: [0.60, 0.92]
  },
  'sirti-donuk': {
    head: [0.5, 0.12], neck: [0.5, 0.19],
    shL: [0.35, 0.22], elL: [0.33, 0.38], wrL: [0.34, 0.52], // Wider back shoulders
    shR: [0.65, 0.22], elR: [0.67, 0.38], wrR: [0.66, 0.52],
    pelvis: [0.5, 0.52],
    hipL: [0.42, 0.53], knL: [0.42, 0.73], anL: [0.42, 0.94],
    hipR: [0.58, 0.53], knR: [0.58, 0.73], anR: [0.58, 0.94]
  },
  'kollar-havada': {
    head: [0.5, 0.18], neck: [0.5, 0.25],
    shL: [0.40, 0.28], elL: [0.30, 0.18], wrL: [0.22, 0.06], // Arms up in victory V
    shR: [0.60, 0.28], elR: [0.70, 0.18], wrR: [0.78, 0.06],
    pelvis: [0.5, 0.54],
    hipL: [0.44, 0.55], knL: [0.40, 0.73], anL: [0.38, 0.94],
    hipR: [0.56, 0.55], knR: [0.60, 0.73], anR: [0.62, 0.94]
  },
  'korkmus-geri-cekilen': {
    head: [0.42, 0.15], neck: [0.44, 0.23], // Body leaning backwards left
    shL: [0.34, 0.25], elL: [0.36, 0.18], wrL: [0.44, 0.14], // Defensive hands up
    shR: [0.54, 0.26], elR: [0.62, 0.20], wrR: [0.68, 0.16],
    pelvis: [0.46, 0.54],
    hipL: [0.40, 0.55], knL: [0.34, 0.74], anL: [0.32, 0.94],
    hipR: [0.52, 0.55], knR: [0.54, 0.74], anR: [0.56, 0.94]
  },
  'bir-sey-tutuyor': {
    head: [0.5, 0.12], neck: [0.5, 0.20],
    shL: [0.38, 0.23], elL: [0.38, 0.38], wrL: [0.46, 0.44], // Both hands holding in front
    shR: [0.62, 0.23], elR: [0.62, 0.38], wrR: [0.54, 0.44],
    pelvis: [0.5, 0.52],
    hipL: [0.43, 0.53], knL: [0.42, 0.73], anL: [0.42, 0.94],
    hipR: [0.57, 0.53], knR: [0.58, 0.73], anR: [0.58, 0.94]
  },
  'fener-tutuyor': {
    head: [0.48, 0.12], neck: [0.49, 0.20],
    shL: [0.38, 0.23], elL: [0.36, 0.38], wrL: [0.36, 0.52],
    shR: [0.60, 0.23], elR: [0.72, 0.28], wrR: [0.82, 0.32], // Holding lantern forward
    pelvis: [0.49, 0.52],
    hipL: [0.43, 0.53], knL: [0.42, 0.73], anL: [0.42, 0.94],
    hipR: [0.56, 0.53], knR: [0.58, 0.73], anR: [0.58, 0.94]
  },
  'dizustu-bakiyor': {
    head: [0.54, 0.25], neck: [0.52, 0.32], // Kneeling, looking down
    shL: [0.42, 0.34], elL: [0.38, 0.46], wrL: [0.42, 0.58],
    shR: [0.60, 0.34], elR: [0.58, 0.46], wrR: [0.56, 0.58],
    pelvis: [0.48, 0.58],
    hipL: [0.44, 0.60], knL: [0.44, 0.82], anL: [0.34, 0.88], // On knees
    hipR: [0.52, 0.60], knR: [0.54, 0.82], anR: [0.44, 0.88]
  },
  'yuruyor': {
    head: [0.5, 0.12], neck: [0.5, 0.20],
    shL: [0.38, 0.23], elL: [0.32, 0.36], wrL: [0.28, 0.46],
    shR: [0.62, 0.23], elR: [0.68, 0.36], wrR: [0.72, 0.46],
    pelvis: [0.5, 0.52],
    hipL: [0.44, 0.53], knL: [0.36, 0.72], anL: [0.30, 0.94], // Stride legs
    hipR: [0.56, 0.53], knR: [0.64, 0.72], anR: [0.70, 0.94]
  }
};

// Crop ratios: what fraction of height is kept from top
export const CROP_CONFIG = {
  'head':  { startY: 0.0, endY: 0.30, scale: 3.3 },
  'chest': { startY: 0.0, endY: 0.48, scale: 2.1 },
  'waist': { startY: 0.0, endY: 0.65, scale: 1.5 },
  'knee':  { startY: 0.0, endY: 0.85, scale: 1.18 },
  'full':  { startY: 0.0, endY: 1.00, scale: 1.0 }
};

export function drawFigure(ctx, layer, x, y, w, h, opts = {}) {
  ctx.save();

  // Clipping to layer bounding box
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();

  const poseName = layer.pose || 'ayakta';
  const poseData = FIGURE_POSES[poseName] || FIGURE_POSES['ayakta'];
  const isFacingAway = layer.facing === 'away' || poseName === 'sirti-donuk';
  const isFlipped = !!layer.flip;

  const cropKey = layer.crop || 'full';
  const crop = CROP_CONFIG[cropKey] || CROP_CONFIG['full'];

  // Base style
  const baseColor = layer.color || '#6aa0ff';
  const isExport = opts.isExport;

  ctx.strokeStyle = baseColor;
  ctx.fillStyle = baseColor;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  // Coordinate mapper from normalized (0..1) to cropped (x, y, w, h)
  const mapPoint = pt => {
    let px = pt[0];
    let py = pt[1];

    if (isFlipped) {
      px = 1 - px;
    }

    // Apply crop window
    const croppedNormY = (py - crop.startY) / (crop.endY - crop.startY);
    const croppedNormX = (px - 0.5) * crop.scale + 0.5;

    return {
      x: x + croppedNormX * w,
      y: y + croppedNormY * h
    };
  };

  // Convert all joints
  const J = {};
  for (const [k, pt] of Object.entries(poseData)) {
    J[k] = mapPoint(pt);
  }

  const boneWidth = Math.max(3, Math.min(w, h) * 0.045);
  ctx.lineWidth = boneWidth;

  // 1. Torso (Neck -> Shoulders -> Pelvis -> Hips)
  ctx.beginPath();
  ctx.moveTo(J.shL.x, J.shL.y);
  ctx.lineTo(J.shR.x, J.shR.y);
  ctx.lineTo(J.hipR.x, J.hipR.y);
  ctx.lineTo(J.hipL.x, J.hipL.y);
  ctx.closePath();
  ctx.globalAlpha = isExport ? 0.8 : 0.45;
  ctx.fill();
  ctx.globalAlpha = 1.0;
  ctx.stroke();

  // 2. Spine line
  ctx.beginPath();
  ctx.moveTo(J.neck.x, J.neck.y);
  ctx.lineTo(J.pelvis.x, J.pelvis.y);
  ctx.stroke();

  // 3. Arms (Shoulder -> Elbow -> Wrist)
  drawLine(ctx, J.shL, J.elL);
  drawLine(ctx, J.elL, J.wrL);
  drawLine(ctx, J.shR, J.elR);
  drawLine(ctx, J.elR, J.wrR);

  // 4. Legs (Hip -> Knee -> Ankle)
  drawLine(ctx, J.hipL, J.knL);
  drawLine(ctx, J.knL, J.anL);
  drawLine(ctx, J.hipR, J.knR);
  drawLine(ctx, J.knR, J.anR);

  // 5. Hands & Feet
  drawCircle(ctx, J.wrL.x, J.wrL.y, boneWidth * 0.9);
  drawCircle(ctx, J.wrR.x, J.wrR.y, boneWidth * 0.9);
  drawCircle(ctx, J.anL.x, J.anL.y, boneWidth * 1.1);
  drawCircle(ctx, J.anR.x, J.anR.y, boneWidth * 1.1);

  // 6. Head
  const headRadius = Math.max(12, Math.min(w, h) * 0.12 * crop.scale);
  ctx.beginPath();
  ctx.arc(J.head.x, J.head.y, headRadius, 0, Math.PI * 2);
  ctx.globalAlpha = isExport ? 0.9 : 0.6;
  ctx.fill();
  ctx.globalAlpha = 1.0;
  ctx.stroke();

  // 7. Lantern or Item if pose is fener-tutuyor
  if (poseName === 'fener-tutuyor') {
    ctx.fillStyle = '#f1c40f';
    ctx.beginPath();
    ctx.arc(J.wrR.x, J.wrR.y + 12, 10, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#e67e22';
    ctx.stroke();
  }

  // 8. Expression (if crop is close enough and not facing away)
  if (!isFacingAway && ['head', 'chest', 'waist'].includes(cropKey)) {
    drawExpression(ctx, layer.expression || 'notr', J.head.x, J.head.y, headRadius);
  }

  ctx.restore();
}

function drawLine(ctx, p1, p2) {
  ctx.beginPath();
  ctx.moveTo(p1.x, p1.y);
  ctx.lineTo(p2.x, p2.y);
  ctx.stroke();
}

function drawCircle(ctx, x, y, r) {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
}

function drawExpression(ctx, expr, cx, cy, r) {
  ctx.save();
  ctx.strokeStyle = '#ffffff';
  ctx.fillStyle = '#ffffff';
  ctx.lineWidth = Math.max(1.5, r * 0.08);

  const eyeY = cy - r * 0.18;
  const eyeOffset = r * 0.35;
  const mouthY = cy + r * 0.32;

  switch (expr) {
    case 'saskin': {
      // Wide open eyes + open mouth
      drawCircle(ctx, cx - eyeOffset, eyeY, r * 0.16);
      drawCircle(ctx, cx + eyeOffset, eyeY, r * 0.16);
      // Eyebrows up
      drawCurve(ctx, cx - eyeOffset - 6, eyeY - 10, cx - eyeOffset + 6, eyeY - 12);
      drawCurve(ctx, cx + eyeOffset - 6, eyeY - 12, cx + eyeOffset + 6, eyeY - 10);
      // Mouth O
      ctx.beginPath();
      ctx.ellipse(cx, mouthY, r * 0.22, r * 0.28, 0, 0, Math.PI * 2);
      ctx.stroke();
      break;
    }
    case 'korkmus': {
      // Fearful eyes + zigzag mouth
      drawCircle(ctx, cx - eyeOffset, eyeY, r * 0.18);
      drawCircle(ctx, cx + eyeOffset, eyeY, r * 0.18);
      ctx.beginPath();
      ctx.moveTo(cx - r * 0.25, mouthY);
      ctx.lineTo(cx - r * 0.10, mouthY + 4);
      ctx.lineTo(cx + r * 0.10, mouthY - 4);
      ctx.lineTo(cx + r * 0.25, mouthY);
      ctx.stroke();
      break;
    }
    case 'gulen': {
      // Happy eyes ^ ^ + smile
      drawCurve(ctx, cx - eyeOffset - 6, eyeY, cx - eyeOffset + 6, eyeY);
      drawCurve(ctx, cx + eyeOffset - 6, eyeY, cx + eyeOffset + 6, eyeY);
      // Big smile
      ctx.beginPath();
      ctx.arc(cx, mouthY - 4, r * 0.32, 0.2 * Math.PI, 0.8 * Math.PI);
      ctx.stroke();
      break;
    }
    case 'kizgin': {
      // Slanted angry brows + dots
      drawCircle(ctx, cx - eyeOffset, eyeY, r * 0.12);
      drawCircle(ctx, cx + eyeOffset, eyeY, r * 0.12);
      drawLine(ctx, { x: cx - eyeOffset - 8, y: eyeY - 10 }, { x: cx - eyeOffset + 8, y: eyeY - 4 });
      drawLine(ctx, { x: cx + eyeOffset - 8, y: eyeY - 4 }, { x: cx + eyeOffset + 8, y: eyeY - 10 });
      drawLine(ctx, { x: cx - r * 0.2, y: mouthY }, { x: cx + r * 0.2, y: mouthY });
      break;
    }
    case 'supheci': {
      // One raised brow
      drawCircle(ctx, cx - eyeOffset, eyeY, r * 0.12);
      drawCircle(ctx, cx + eyeOffset, eyeY, r * 0.14);
      drawLine(ctx, { x: cx - eyeOffset - 6, y: eyeY - 8 }, { x: cx - eyeOffset + 6, y: eyeY - 8 });
      drawCurve(ctx, cx + eyeOffset - 6, eyeY - 14, cx + eyeOffset + 6, eyeY - 16);
      drawLine(ctx, { x: cx - r * 0.15, y: mouthY }, { x: cx + r * 0.2, y: mouthY - 3 });
      break;
    }
    case 'uzgun': {
      // Sad eyes + downturned mouth
      drawCircle(ctx, cx - eyeOffset, eyeY, r * 0.12);
      drawCircle(ctx, cx + eyeOffset, eyeY, r * 0.12);
      ctx.beginPath();
      ctx.arc(cx, mouthY + 8, r * 0.25, 1.2 * Math.PI, 1.8 * Math.PI);
      ctx.stroke();
      break;
    }
    case 'heyecanli': {
      // Big eyes + huge grin
      drawCircle(ctx, cx - eyeOffset, eyeY, r * 0.18);
      drawCircle(ctx, cx + eyeOffset, eyeY, r * 0.18);
      ctx.beginPath();
      ctx.arc(cx, mouthY - 4, r * 0.36, 0.1 * Math.PI, 0.9 * Math.PI);
      ctx.fill();
      break;
    }
    case 'ciddi': {
      // Stern eyes + flat mouth
      drawCircle(ctx, cx - eyeOffset, eyeY, r * 0.11);
      drawCircle(ctx, cx + eyeOffset, eyeY, r * 0.11);
      drawLine(ctx, { x: cx - eyeOffset - 6, y: eyeY - 6 }, { x: cx - eyeOffset + 6, y: eyeY - 6 });
      drawLine(ctx, { x: cx + eyeOffset - 6, y: eyeY - 6 }, { x: cx + eyeOffset + 6, y: eyeY - 6 });
      drawLine(ctx, { x: cx - r * 0.22, y: mouthY }, { x: cx + r * 0.22, y: mouthY });
      break;
    }
    default: { // neutral
      drawCircle(ctx, cx - eyeOffset, eyeY, r * 0.12);
      drawCircle(ctx, cx + eyeOffset, eyeY, r * 0.12);
      drawLine(ctx, { x: cx - r * 0.18, y: mouthY }, { x: cx + r * 0.18, y: mouthY });
      break;
    }
  }
  ctx.restore();
}

function drawCurve(ctx, x1, y1, x2, y2) {
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.quadraticCurveTo((x1 + x2) / 2, Math.min(y1, y2) - 3, x2, y2);
  ctx.stroke();
}
