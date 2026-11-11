// Final composition panel (view mode "Final"): crop of the chosen variant, adjustments, text/marks drawn by code,
// small-size readability test, a generic video-feed mock (light/dark, A/B) and the < 2 MB JPEG export.
import { h, api, toast } from '../app.js';
import { drawFinal, FINAL_DEFAULTS, getLayerBoxSafe } from './scene.js';

export const FINAL_LIMIT = 2 * 1024 * 1024;
const SIZES = [{ w: 360, label: 'Mobile feed' }, { w: 246, label: 'Home page' }, { w: 168, label: 'Sidebar suggestion' }];

// render the final at its real size (1280x720 / 1080x1920)
export function renderFinalCanvas(brief, variantId) {
  const c = document.createElement('canvas');
  [c.width, c.height] = brief.format === '9:16' ? [1080, 1920] : [1280, 720];
  drawFinal(c.getContext('2d'), brief, { isExport: true, variantId });
  return c;
}

// JPEG under 2 MB: quality 0.92 down by 0.05 (lowest 0.6)
export async function encodeUnderLimit(canvas) {
  for (let q = 0.92; q >= 0.6 - 1e-9; q -= 0.05) {
    const url = canvas.toDataURL('image/jpeg', q);
    const bytes = Math.floor((url.length - url.indexOf(',') - 1) * 3 / 4);
    if (bytes <= FINAL_LIMIT) return { url, bytes, q: Math.round(q * 100) / 100 };
  }
  throw new Error('Could not reduce the image below 2 MB');
}

// readability checks for each text layer at the smallest size
export function readabilityWarnings(brief, canvas) {
  const out = [];
  const H = canvas.height, W = canvas.width, scale = 168 / W;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  for (const l of (brief.layers || []).filter(l => l.type === 'text' && !l.hidden && l.content)) {
    const px = (l.size ?? 0.12) * H * scale;
    if (px < 9) out.push(`"${short(l.content)}" is ${px.toFixed(1)} px tall in the 168 px preview: too small to read. Enlarge or shorten it.`);
    // contrast: text fill vs the average of the pixels behind the box
    try {
      const b = getLayerBoxSafe(l, W, H);
      const x = Math.max(0, Math.round(b.x)), y = Math.max(0, Math.round(b.y));
      const w = Math.min(W - x, Math.round(b.w)), hh = Math.min(H - y, Math.round(b.h));
      if (w > 4 && hh > 4 && !l.bg) {
        const d = ctx.getImageData(x, y, w, hh).data;
        let sum = 0, n = 0;
        for (let i = 0; i < d.length; i += 16) { sum += lum(d[i], d[i + 1], d[i + 2]); n++; }
        const bgL = sum / n, fg = hexLum(l.fill || '#ffffff');
        const ratio = (Math.max(bgL, fg) + 0.05) / (Math.min(bgL, fg) + 0.05);
        if (ratio < 3 && !(l.stroke && (l.strokeW ?? 0) >= 0.03)) out.push(`"${short(l.content)}" has low contrast against the background (${ratio.toFixed(1)}:1). Add an outline, shadow, or "Text backdrop".`);
      }
    } catch { }
  }
  return out;
}
const short = s => (s.length > 24 ? s.slice(0, 23) + '…' : s).replace(/\n/g, ' ');
const lin = c => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
const lum = (r, g, b) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
const hexLum = hex => { const m = /^#?([0-9a-f]{6})$/i.exec(hex || ''); if (!m) return 1; const n = parseInt(m[1], 16); return lum(n >> 16, (n >> 8) & 255, n & 255); };

export function renderFinalPanel(container, { pid, tid, getBrief, onEdit, onSaved }) {
  container.innerHTML = '';
  const brief = getBrief();
  const fe = { ...FINAL_DEFAULTS, ...(brief.finalEdit || {}) };
  const chosen = (brief.variants || []).find(v => v.id === brief.chosen);
  container.append(h('div', { class: 'inspector-header' }, h('b', { style: { fontSize: '15px' } }, 'Final')));
  const body = h('div', { class: 'inspector-body' });
  container.append(body);
  if (!chosen) {
    body.append(h('div', { class: 'ts-warn' }, 'Open a variant from the strip below and click "✓ Choose this".'));
    return;
  }
  const set = (k, v) => onEdit({ finalEdit: { ...(getBrief().finalEdit || FINAL_DEFAULTS), [k]: v } });
  const slider = (k, label, min, max, step, fmt) => {
    const val = h('span', { class: 'dim' }, fmt(fe[k]));
    return h('div', { class: 'inspector-field' }, h('div', { class: 'field-label row' }, label, h('span', { class: 'spacer' }), val),
      h('input', { type: 'range', min, max, step, value: fe[k], oninput: e => { val.textContent = fmt(+e.target.value); set(k, +e.target.value); } }));
  };
  const pct = v => Math.round(v * 100) + '%';
  body.append(
    h('div', { class: 'inspector-section' }, h('div', { class: 'section-title' }, `Image: ${chosen.id}`),
      slider('zoom', 'Zoom', 1, 2.5, 0.01, v => v.toFixed(2) + '×'),
      slider('x', 'Horizontal pan', 0, 1, 0.01, pct),
      slider('y', 'Vertical pan', 0, 1, 0.01, pct),
      h('button', { class: 'ghost', onclick: () => onEdit({ finalEdit: { ...FINAL_DEFAULTS } }) }, '↺ Reset crop and adjustments')),
    h('div', { class: 'inspector-section' }, h('div', { class: 'section-title' }, 'Fine-tune'),
      slider('brightness', 'Brightness', 0.5, 1.5, 0.01, pct),
      slider('contrast', 'Contrast', 0.5, 1.6, 0.01, pct),
      slider('saturation', 'Saturation', 0, 2, 0.01, pct),
      slider('vignette', 'Vignette', 0, 1, 0.01, pct),
      slider('shade', 'Text backdrop', 0, 1, 0.01, pct)),
    h('div', { class: 'dim', style: { fontSize: '12px', padding: '0 4px 8px' } }, 'Drag text and marks on the canvas to adjust them; these are the same layers as in layout mode. With text selected, switch to "Layout" for text settings in the right panel.'));

  // small sizes + warnings
  const sizes = h('div', { class: 'ts-sizes' });
  const warnBox = h('div', {});
  const feed = h('div', { class: 'ts-feed' });
  const info = h('div', { class: 'dim', style: { fontSize: '12px' } });
  body.append(h('div', { class: 'inspector-section' }, h('div', { class: 'section-title' }, 'Readable at a small size?'), sizes, warnBox),
    h('div', { class: 'inspector-section' }, h('div', { class: 'section-title row' }, 'Feed preview', h('span', { class: 'spacer' }),
      h('select', { onchange: e => { feedTheme = e.target.value; drawFeed(); e.target.blur(); } }, h('option', { value: 'dark' }, 'Dark'), h('option', { value: 'light' }, 'Light')),
      h('select', { title: 'A/B: compare with another variant', onchange: e => { abVariant = e.target.value || null; drawFeed(); e.target.blur(); } },
        h('option', { value: '' }, 'No A/B comparison'), (brief.variants || []).filter(v => v.id !== chosen.id).map(v => h('option', { value: v.id }, 'B: ' + v.id)))), feed));

  const exportBtn = h('button', { class: 'primary', style: { width: '100%' } }, '💾 Save final (JPG)');
  const actions = h('div', { class: 'row', style: { gap: '6px', flexWrap: 'wrap' } });
  body.append(h('div', { class: 'inspector-section' }, exportBtn, info, actions));
  const drawActions = b => {
    actions.innerHTML = '';
    if (!b.final) return;
    info.textContent = `Last saved: ${(b.final.bytes / 1048576).toFixed(2)} MB · ${b.final.w}×${b.final.h}${b.final.copy ? ' · Also in the Outputs folder' : ''}${b.final.copyError ? ' · Could not copy to the Outputs folder: ' + b.final.copyError : ''}`;
    actions.append(
      h('button', { class: 'ghost', onclick: () => api(`/api/thumbstudio/${pid}/${tid}/open-folder`, { method: 'POST', body: { file: 'final.jpg' } }).catch(e => toast(e.message, true)) }, '📂 Show in folder'),
      h('button', { class: 'ghost', onclick: async () => { const t = await api(`/api/thumbstudio/find/${tid}`); const p = t.dir + '\\final.jpg'; try { await navigator.clipboard.writeText(p); toast('Path copied'); } catch { toast(p); } } }, '⧉ Copy path'),
      b.final.copy ? h('button', { class: 'ghost', title: b.final.copy, onclick: async () => { try { await navigator.clipboard.writeText(b.final.copy); toast('Outputs folder path copied'); } catch { toast(b.final.copy); } } }, '⧉ Output path') : null);
  };
  drawActions(brief);
  exportBtn.onclick = async () => {
    exportBtn.disabled = true; exportBtn.textContent = 'Preparing…';
    try {
      await document.fonts?.ready;
      const c = renderFinalCanvas(getBrief());
      const enc = await encodeUnderLimit(c);
      const r = await api(`/api/thumbstudio/${pid}/${tid}/final`, { method: 'POST', body: { data: enc.url } });
      toast(`Final saved: ${(enc.bytes / 1048576).toFixed(2)} MB (quality ${Math.round(enc.q * 100)})`);
      drawActions(r.brief); onSaved?.(r.brief);
    } catch (e) { toast('Could not save final: ' + e.message, true); }
    exportBtn.disabled = false; exportBtn.textContent = '💾 Save final (JPG)';
  };

  let feedTheme = 'dark', abVariant = null, full = null;
  function drawSizes() {
    full = renderFinalCanvas(getBrief());
    sizes.innerHTML = '';
    for (const s of SIZES) {
      const c = document.createElement('canvas');
      c.width = s.w; c.height = Math.round(s.w * full.height / full.width);
      const x = c.getContext('2d'); x.imageSmoothingQuality = 'high'; x.drawImage(full, 0, 0, c.width, c.height);
      sizes.append(h('div', { class: 'ts-size' }, c, h('div', { class: 'dim' }, `${s.label} · ${s.w} px`)));
    }
    const w = readabilityWarnings(getBrief(), full);
    warnBox.innerHTML = '';
    warnBox.append(w.length ? h('div', {}, w.map(t => h('div', { class: 'ts-warn' }, '⚠ ' + t))) : h('div', { class: 'green', style: { fontSize: '12px' } }, '✓ Text appears readable at a small size too.'));
  }
  function card(canvas, title) {
    const c = document.createElement('canvas'); c.width = 280; c.height = Math.round(280 * canvas.height / canvas.width);
    c.getContext('2d').drawImage(canvas, 0, 0, c.width, c.height);
    return h('div', { class: 'ts-feedcard' }, h('div', { class: 'ts-feedthumb' }, c, getBrief().format !== '9:16' ? h('span', { class: 'ts-duration' }, '12:34') : null),
      h('div', { class: 'ts-feedtitle' }, title), h('div', { class: 'ts-feedsub' }, 'Channel name · 12K views · 2 days ago'));
  }
  function drawFeed() {
    if (!full) return;
    feed.className = 'ts-feed ' + feedTheme;
    feed.innerHTML = '';
    feed.append(card(full, getBrief().title || 'Video title'));
    if (abVariant) {
      const b = renderFinalCanvas(getBrief(), abVariant);
      feed.append(card(b, (getBrief().title || 'Video title') + ' (B)'));
    }
  }
  let t = null;
  const refresh = () => { clearTimeout(t); t = setTimeout(() => { drawSizes(); drawFeed(); }, 150); };
  refresh();
  return { refresh };
}
