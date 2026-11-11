// Thumbnail prompt builder: brief -> English image prompt + English summary + ordered references.
// Pure and deterministic; shared by the editor (live preview) and the server (export, hub_thumb_brief).
import { STYLE_PRESETS, CAMERA_ANGLES, CAMERA_SHOTS, EXPRESSIONS, POSES, LIGHT_KEYS, LIGHT_TIMES } from './catalog.js';

export const PROMPT_MAX = 1200;

// Turkish words for unwanted elements -> English (anything else is passed through as typed)
const NEGATIVE_DICT = {
  'bulanık': 'blurry, out of focus',
  'bulanık yüz': 'blurry face',
  'düşük kalite': 'low quality, artifacts',
  'yazı': 'text, letters',
  'metin': 'text, letters',
  'filigran': 'watermark',
  'logo': 'logos',
  'çarpık el': 'deformed hands',
  'fazla parmak': 'extra fingers',
  'çirkin': 'ugly',
  'karanlık': 'too dark, underexposed',
  'patlak': 'blown out highlights',
  'kalabalık': 'cluttered, crowded',
  'kalabalık arka plan': 'cluttered background',
  'karikatür': 'cartoonish look',
  'gerçekçi olmayan': 'unrealistic',
  'insan': 'people',
  'yüz': 'faces',
  'kan': 'blood, gore',
};

const LIGHT_EN = { warm: 'warm', cool: 'cool', neutral: 'neutral', neon: 'neon-colored', fire: 'firelight', moon: 'moonlight' };
const TIME_EN = { day: 'daylight', 'golden-hour': 'golden hour', 'blue-hour': 'blue hour', night: 'night', studio: 'studio lighting', overcast: 'soft overcast light' };
const ROLE_EN = {
  character: 'is the character reference: keep the same face, hair and clothes',
  object: 'is the object reference: keep its exact shape and material',
  style: 'is the style reference: match its rendering style, colors and lighting',
  background: 'is the background/location reference',
  composition: 'is an extra composition reference',
};
const ROLE_TR = { character: 'character', object: 'object', style: 'style', background: 'background', composition: 'composition' };
const FACING_EN = { left: ', facing left', right: ', facing right', away: ', seen from behind, facing away from the camera' };
const CROP_EN = { head: ', head and shoulders only', chest: ', framed from the chest up', waist: ', framed from the waist up', knee: ', framed from the knees up' };

// box (0..1) -> "left third, top" / size words
export function describeSpatial(layer) {
  const x = num(layer.x, 0.1), y = num(layer.y, 0.1), w = num(layer.w, 0.8), h = num(layer.h, 0.8);
  const cx = x + w / 2, cy = y + h / 2, area = Math.max(0, Math.min(1, w) * Math.min(1, h));
  const hPos = cx < 0.38 ? 'left third' : cx > 0.62 ? 'right third' : 'center';
  const vPos = cy < 0.38 ? 'top' : cy > 0.62 ? 'bottom' : 'middle';
  const locStr = hPos === 'center' && vPos === 'middle' ? 'center of the frame' : `${hPos}, ${vPos}`;
  const sizeStr = area < 0.08 ? 'small' : area < 0.25 ? 'medium' : area < 0.5 ? 'large' : 'dominant, fills most of the frame';
  const cropped = x < 0.03 || y < 0.03 || x + w > 0.97 || y + h > 0.97;
  return { locStr, sizeStr, cropped, cx, cy, area };
}

// same position in plain English (for notes and summaries)
export function describeSpatialTr(x, y) {
  const hp = x < 0.38 ? 'left' : x > 0.62 ? 'right' : 'center';
  const vp = y < 0.38 ? 'top' : y > 0.62 ? 'bottom' : 'middle';
  return hp === 'center' && vp === 'middle' ? 'dead center' : `${vp} ${hp}`;
}

export function describeDepth(depth = 50) {
  if (depth < 34) return 'foreground';
  if (depth < 67) return 'midground';
  return 'background';
}
const PLAN_TR = { foreground: 'Foreground', midground: 'Midground', background: 'Background' };

// the references in the order they are sent: layout.png first, then character, object, style, background
export function orderRefs(brief = {}) {
  const prio = { character: 1, object: 2, style: 3, background: 4, composition: 5 };
  const refs = (brief.refs || []).filter(r => r && r.file);
  return [...refs].sort((a, b) => (prio[a.role] || 9) - (prio[b.role] || 9));
}

export function negativeTerms(brief = {}) {
  const raw = [brief.negative, brief.goal?.avoid].filter(Boolean).join(',');
  const out = [];
  for (const item of raw.split(/[,;\n]/).map(s => s.trim()).filter(Boolean)) {
    const en = NEGATIVE_DICT[item.toLocaleLowerCase('tr')] || item;
    if (!out.includes(en)) out.push(en);
  }
  return out;
}

export function generatePrompt(brief = {}, opts = {}) {
  const sorted = orderRefs(brief);
  const refsOrdered = ['layout.png', ...sorted.map(r => r.file)];
  const summaryTr = summary(brief, sorted);

  if (brief.promptOverride && !opts.ignoreOverride) {
    return { prompt: String(brief.promptOverride).trim(), summaryTr, refsOrdered, isOverride: true };
  }

  const camera = brief.camera || {}, light = brief.light || {}, style = brief.style || {};
  const layers = (brief.layers || []).filter(l => l && !l.hidden && l.type !== 'trace');
  const policy = brief.text?.policy === 'ai' ? 'ai' : 'overlay';
  const parts = [];

  // 1. how to read the references
  parts.push('The first reference image is a rough blocking sketch: follow its composition, camera angle, positions, sizes and depth layering exactly; ignore its flat gray shapes, simple colors and lack of detail.');
  sorted.forEach((r, i) => {
    const target = r.layer ? layers.find(l => l.id === r.layer) : null;
    parts.push(`Reference ${i + 2} ${ROLE_EN[r.role] || ROLE_EN.style}${target ? ` (for the ${target.desc || target.name || 'element'})` : ''}.`);
  });

  // 2. style + framing + angle + lens
  const styleObj = STYLE_PRESETS.find(s => s.id === style.preset) || STYLE_PRESETS[0];
  const shot = CAMERA_SHOTS.find(s => s.id === camera.shot);
  const angle = CAMERA_ANGLES.find(a => a.id === camera.angle);
  const cam = [];
  if (shot) cam.push(shot.promptEn);
  if (angle) cam.push(angle.promptEn.replace('{tilt}', String(Math.abs(Math.round(camera.tilt || 15)))));
  const lens = num(camera.lens, 50);
  cam.push(lens <= 24 ? `${lens}mm ultra-wide lens, exaggerated perspective` : lens >= 85 ? `${lens}mm telephoto lens, compressed background` : `${lens}mm lens, natural perspective`);
  parts.push(`${styleObj.prompt}${style.custom ? ', ' + style.custom.trim() : ''}. ${cap(cam.join(', '))}.`);
  if (style.mood) parts.push(`Mood: ${style.mood}.`);

  // 3. subjects and objects, most important first, nearer first
  const content = layers.filter(l => l.type === 'subject' || l.type === 'object' || l.type === 'sketch' && l.desc)
    .sort((a, b) => (b.importance ?? 1) - (a.importance ?? 1) || (a.depth ?? 50) - (b.depth ?? 50));
  for (const l of content) {
    const { locStr, sizeStr, cropped } = describeSpatial(l);
    const plan = describeDepth(l.depth ?? 50);
    const desc = (l.desc || l.name || (l.type === 'subject' ? 'a person' : 'an object')).trim();
    let s;
    if (l.type === 'subject') {
      const exp = EXPRESSIONS.find(e => e.id === l.expression);
      const showFace = l.facing !== 'away' && exp && exp.id !== 'notr';
      const pose = POSES.find(p => p.id === l.pose);
      s = `${cap(plan)}, ${locStr}: ${sizeStr} ${desc}${pose && pose.promptEn ? ', ' + pose.promptEn : ''}${showFace ? ', ' + exp.promptEn : ''}${FACING_EN[l.facing] || ''}${CROP_EN[l.crop] || ''}`;
    } else {
      s = `${cap(plan)}, ${locStr}: ${sizeStr} ${desc}${l.material ? ', made of ' + l.material : ''}`;
    }
    if (l.importance >= 3) s += ' (main focus)';
    if (cropped) s += ', cropped by the frame edge';
    parts.push(s + '.');
  }
  // relative depth: who is in front of whom
  const rel = relations(content);
  if (rel) parts.push(rel);

  for (const bg of layers.filter(l => l.type === 'background' && l.desc)) parts.push(`Background: ${bg.desc.trim()}.`);
  for (const e of layers.filter(l => l.type === 'effect')) {
    const { locStr } = describeSpatial(e);
    if (e.kind === 'split') parts.push('Split composition divided vertically down the middle.');
    else if (e.kind === 'glow') parts.push(`A strong glow at the ${locStr}.`);
    else if (e.kind === 'light-rays') parts.push(`Light rays beaming from the ${locStr}.`);
    else if (e.kind === 'blur-zone') parts.push(`The ${locStr} area is softly blurred.`);
    else if (e.kind === 'vignette') parts.push('Dark vignette around the edges.');
  }

  // 4. light, palette, depth of field
  const lt = [];
  if (light.key) lt.push(`${LIGHT_EN[light.key] || light.key} key light`);
  if (num(light.azimuth, -1) >= 0) lt.push(`from the ${lightSide(light.azimuth)}`);
  if (light.time) lt.push(TIME_EN[light.time] || light.time);
  if (light.rim) lt.push('strong rim light outlining the subjects');
  if (num(light.contrast, 0.5) > 0.65) lt.push('hard high-contrast shadows');
  else if (num(light.contrast, 0.5) < 0.3) lt.push('soft shadows');
  if (light.notes) lt.push(light.notes.trim());
  if (lt.length) parts.push(`Lighting: ${lt.join(', ')}.`);
  if (Array.isArray(style.palette) && style.palette.length) parts.push(`Color palette: ${style.palette.slice(0, 4).join(', ')}.`);

  const dof = num(camera.dof, 0.5);
  const focus = layers.find(l => l.id === camera.focusLayer);
  if (dof > 0.6) parts.push(`Shallow depth of field${focus ? `, sharp focus on the ${focus.desc || focus.name}` : ''}, background softly blurred (bokeh).`);
  else if (dof < 0.25) parts.push('Deep focus, everything sharp.');

  // 5. text policy + empty areas
  const texts = layers.filter(l => l.type === 'text');
  if (policy === 'overlay') {
    parts.push('No text, no letters, no words, no logos, no watermark.');
    if (brief.text?.reserve !== false && texts.length) {
      const regions = [...new Set(texts.map(t => describeSpatial(t).locStr))];
      parts.push(`Keep the ${regions.join(' and ')} area simple and uncluttered (negative space for a title).`);
    }
  } else {
    for (const t of texts) if (t.content) parts.push(`Bold title text "${t.content}" at the ${describeSpatial(t).locStr}.`);
  }
  const zones = layers.filter(l => l.type === 'zone');
  if (zones.length) parts.push(`Leave the ${[...new Set(zones.map(z => describeSpatial(z).locStr))].join(' and ')} area empty and plain.`);

  const neg = negativeTerms(brief);
  if (neg.length) parts.push(`Avoid: ${neg.join(', ')}.`);

  return { prompt: fit(parts), summaryTr, refsOrdered, isOverride: false };
}

// keep the prompt under PROMPT_MAX: drop the least important middle sentences first (never the first or the text rules)
function fit(parts) {
  const join = p => p.join(' ').replace(/\s+/g, ' ').trim();
  let out = [...parts];
  const protectedRe = /^(The first reference|No text|Keep the|Avoid:|Bold title)/;
  while (join(out).length > PROMPT_MAX) {
    let i = -1;
    for (let k = out.length - 1; k > 0; k--) if (!protectedRe.test(out[k]) && !/main focus/.test(out[k])) { i = k; break; }
    if (i < 0) break;
    out.splice(i, 1);
  }
  let s = join(out);
  if (s.length > PROMPT_MAX) s = s.slice(0, PROMPT_MAX - 1).replace(/\s+\S*$/, '') + '.';
  return s;
}

function relations(content) {
  const out = [];
  for (let i = 0; i < content.length; i++) for (let j = i + 1; j < content.length; j++) {
    const a = content[i], b = content[j];
    const overlapX = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
    if (overlapX <= 0 || Math.abs((a.depth ?? 50) - (b.depth ?? 50)) < 15) continue;
    const [near, far] = (a.depth ?? 50) < (b.depth ?? 50) ? [a, b] : [b, a];
    out.push(`the ${short(near)} stands in front of the ${short(far)}`);
    if (out.length >= 2) break;
  }
  return out.length ? cap(out.join('; ')) + '.' : '';
}
const short = l => (l.desc || l.name || 'element').split(/[,.]/)[0].trim().slice(0, 40);

function lightSide(az) {
  const a = ((az % 360) + 360) % 360;
  if (a < 22.5 || a >= 337.5) return 'right';
  if (a < 67.5) return 'lower right';
  if (a < 112.5) return 'front';
  if (a < 157.5) return 'lower left';
  if (a < 202.5) return 'left';
  if (a < 247.5) return 'upper left';
  if (a < 292.5) return 'top';
  return 'upper right';
}

function summary(brief, sortedRefs) {
  const cam = brief.camera || {}, light = brief.light || {}, style = brief.style || {};
  const styleObj = STYLE_PRESETS.find(s => s.id === style.preset) || STYLE_PRESETS[0];
  const shot = CAMERA_SHOTS.find(s => s.id === cam.shot), angle = CAMERA_ANGLES.find(a => a.id === cam.angle);
  const L = [];
  L.push(`### Thumbnail: ${brief.title || 'Untitled'} (${brief.format || '16:9'})`);
  const g = brief.goal || {};
  if (g.topic) L.push(`- **Topic:** ${g.topic}`);
  if (g.feeling) L.push(`- **Feeling:** ${g.feeling}`);
  if (g.hook) L.push(`- **Main idea:** ${g.hook}`);
  L.push(`- **Style:** ${styleObj.name}${style.custom ? ' + ' + style.custom : ''}`);
  L.push(`- **Camera:** ${shot?.name || 'Medium shot'}, ${angle?.name || 'Eye level'}, ${cam.lens || 50} mm, depth of field ${Math.round(num(cam.dof, 0.5) * 100)}%`);
  const key = LIGHT_KEYS.find(k => k.id === light.key)?.name, time = LIGHT_TIMES.find(t => t.id === light.time)?.name;
  L.push(`- **Light:** ${[key, time].filter(Boolean).join(' / ') || 'neutral'}${light.rim ? ', rim light' : ''}, direction: ${lightSideTr(light.azimuth)}`);
  L.push(`- **Text:** ${brief.text?.policy === 'ai' ? 'drawn by AI' : 'excluded from the generated image, overlaid later'}`);
  const neg = [brief.negative, brief.goal?.avoid].filter(Boolean).join(', ');
  if (neg) L.push(`- **Avoid:** ${neg}`);
  L.push('', '**Layers** (front to back):');
  const ls = (brief.layers || []).filter(l => l && !l.hidden && l.type !== 'trace').sort((a, b) => (a.depth ?? 50) - (b.depth ?? 50));
  for (const l of ls) {
    const sp = describeSpatial(l);
    const where = l.type === 'background' ? 'full frame' : describeSpatialTr(sp.cx, sp.cy);
    const what = l.type === 'text' ? `TEXT: "${l.content || ''}"` : l.desc || l.content || '';
    L.push(`- ${PLAN_TR[describeDepth(l.depth ?? 50)]} (depth ${Math.round(l.depth ?? 50)}) · ${where} · **${l.name || l.type}**${what ? ': ' + what : ''}`);
  }
  L.push('', '**References:**', '1. `layout.png`: composition guide (follow positions, sizes and depth exactly)');
  sortedRefs.forEach((r, i) => L.push(`${i + 2}. \`${r.file}\`: ${ROLE_TR[r.role] || 'style'}${r.note ? ' (' + r.note + ')' : ''}`));
  return L.join('\n');
}
function lightSideTr(az) {
  const m = { right: 'from the right', 'lower right': 'from the lower right', front: 'from the front', 'lower left': 'from the lower left', left: 'from the left', 'upper left': 'from the upper left', top: 'from above', 'upper right': 'from the upper right' };
  return m[lightSide(num(az, 220))];
}

const num = (v, d) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const cap = s => (s ? s[0].toUpperCase() + s.slice(1) : s);
