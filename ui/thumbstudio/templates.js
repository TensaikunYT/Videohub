// VideoHub · Thumbnail Studio Template Gallery, Slot Form and Save Template
import { h, api, toast, confirmBox, pill, onHubEvent } from '../app.js';
import { drawScene } from './scene.js';

// Client-side slot substitution
export function applyClientTemplateSlots(template, slotValues = {}) {
  const cloned = JSON.parse(JSON.stringify(template));
  const slotsMap = {};

  if (cloned.slots && typeof cloned.slots === 'object') {
    for (const [k, def] of Object.entries(cloned.slots)) {
      if (def && typeof def === 'object' && def.default !== undefined) {
        slotsMap[k] = def.default;
      }
    }
  }

  for (const [k, v] of Object.entries(slotValues)) {
    if (v !== undefined && v !== null && String(v).trim() !== '') {
      slotsMap[k] = v;
    }
  }

  function replaceSlots(val) {
    if (typeof val === 'string') {
      return val.replace(/\{\{([A-Z0-9_\-]+)\}\}/g, (match, key) => {
        if (key in slotsMap && slotsMap[key] !== undefined && slotsMap[key] !== null) {
          return String(slotsMap[key]);
        }
        return match;
      });
    }
    if (Array.isArray(val)) return val.map(replaceSlots);
    if (val && typeof val === 'object') {
      const res = {};
      for (const [k, v] of Object.entries(val)) res[k] = replaceSlots(v);
      return res;
    }
    return val;
  }

  const camera = replaceSlots(cloned.camera || {});
  const light = replaceSlots(cloned.light || {});
  const style = replaceSlots(cloned.style || {});
  const text = replaceSlots(cloned.text || {});
  const rawLayers = replaceSlots(cloned.layers || []);

  let seq = 1;
  const layerIds = new Map();
  const layers = rawLayers.map(l => ({
    ...l,
    id: `l_${Date.now()}_${seq++}`,
  }));
  rawLayers.forEach((layer, i) => { if (layer.id) layerIds.set(layer.id, layers[i].id); });
  if (camera.focusLayer) camera.focusLayer = layerIds.get(camera.focusLayer) || null;

  return {
    format: cloned.format || '16:9',
    camera,
    light,
    style,
    text,
    layers,
  };
}

// Render a single template card
export function renderTemplateCard(tpl, { onApply }) {
  if (tpl.error) {
    // Red error card for corrupted or invalid template JSON
    return h('div', { class: 'template-card error-card' },
      h('div', { class: 'error-header' },
        h('span', { class: 'error-icon' }, '⚠'),
        h('div', { style: { flex: 1, minWidth: 0 } },
          h('div', { class: 'error-title' }, tpl.name || tpl.file || 'Corrupted Template'),
          h('div', { class: 'error-file' }, tpl.file || tpl.id)
        ),
        pill('err', 'Invalid')
      ),
      h('div', { class: 'error-desc' }, tpl.error)
    );
  }

  const is916 = tpl.format === '9:16';
  const width = 320;
  const height = is916 ? Math.round((320 * 16) / 9) : Math.round((320 * 9) / 16);

  const canvas = h('canvas', {
    class: 'template-canvas',
    width,
    height,
  });

  // Render preview immediately
  const ctx = canvas.getContext('2d');
  try {
    drawScene(ctx, { ...tpl, ...applyClientTemplateSlots(tpl) }, 'layout', { isExport: false, showGrid: false, showThirds: false, showLight: false, showHandles: false, showBadge: false });
  } catch (err) {
    console.error('Template drawScene error:', err);
  }

  const tags = Array.isArray(tpl.tags) ? tpl.tags : [];

  const card = h('div', {
    class: 'template-card',
    onclick: () => { if (onApply) onApply(tpl); }
  },
    h('div', { class: 'template-preview-wrapper' + (is916 ? ' ratio-916' : '') }, canvas),
    h('div', { class: 'template-info' },
      h('div', { class: 'row', style: { justifyContent: 'space-between', alignItems: 'flex-start' } },
        h('div', { class: 'template-title' }, tpl.name),
        pill('fam', tpl.format || '16:9')
      ),
      tpl.desc ? h('div', { class: 'template-desc' }, tpl.desc) : '',
      tags.length ? h('div', { class: 'template-tags' },
        tags.map(t => h('span', { class: 'template-tag' }, '#' + t))
      ) : '',
      h('div', { class: 'template-actions' },
        h('button', {
          class: 'primary small',
          style: { width: '100%' },
          onclick: e => {
            e.stopPropagation();
            if (onApply) onApply(tpl);
          }
        }, 'Apply Template')
      )
    )
  );

  return card;
}

// Open slots form modal
export function openTemplateSlotsModal(template, { onConfirm }) {
  const slots = template.slots || {};
  const slotKeys = Object.keys(slots);

  if (slotKeys.length === 0) {
    // No slots to fill, confirm directly
    onConfirm({});
    return;
  }

  const slotValues = {};
  for (const k of slotKeys) {
    slotValues[k] = slots[k]?.default || '';
  }

  const is916 = template.format === '9:16';
  const previewCanvas = h('canvas', {
    width: 360,
    height: is916 ? Math.round((360 * 16) / 9) : Math.round((360 * 9) / 16),
    style: {
      maxWidth: '100%',
      maxHeight: is916 ? '240px' : '180px',
      borderRadius: '8px',
      border: '1px solid var(--border)',
      background: '#12141a',
      objectFit: 'contain',
    }
  });

  function updatePreview() {
    const applied = applyClientTemplateSlots(template, slotValues);
    const ctx = previewCanvas.getContext('2d');
    drawScene(ctx, applied, 'layout', { isExport: false, showGrid: false, showThirds: false, showLight: false, showHandles: false, showBadge: false });
  }

  const inputsContainer = h('div', { style: { display: 'flex', flexDirection: 'column', gap: '12px' } });

  for (const key of slotKeys) {
    const def = slots[key] || {};
    const input = h('input', {
      type: 'text',
      value: slotValues[key],
      placeholder: def.default || '',
      style: { width: '100%' },
      oninput: e => {
        slotValues[key] = e.target.value;
        updatePreview();
      }
    });

    inputsContainer.append(
      h('label', { style: { display: 'flex', flexDirection: 'column', gap: '4px' } },
        h('div', { style: { fontWeight: 600, fontSize: '13px' } }, def.label || key),
        input
      )
    );
  }

  const modalBody = h('div', { class: 'template-slots-body', style: { display: 'flex', flexDirection: 'column', gap: '16px', margin: '10px 0' } },
    h('div', { style: { textAlign: 'center' } }, previewCanvas),
    inputsContainer
  );

  updatePreview();

  confirmBox(`Apply "${template.name}" Template`, modalBody, 'Apply').then(ok => {
    if (ok) {
      onConfirm(slotValues);
    }
  });
}

// Open full Template Picker Modal
export function openTemplatePickerModal({ currentBrief, onApplyTemplate, collection = '' }) {
  let allTemplates = [];
  let filterText = '';
  let filterFormat = '';
  let filterCollection = collection;

  const modalBg = h('div', { class: 'modal-bg' });
  const modal = h('div', { class: 'modal modal-wide' });
  modalBg.append(modal);

  const header = h('div', { class: 'row', style: { justifyContent: 'space-between', alignItems: 'center' } },
    h('h1', { style: { margin: 0, fontSize: '18px' } }, '📐 Template Gallery'),
    h('button', { class: 'ghost', onclick: () => close() }, '✕ Close')
  );
  modal.append(header);

  // Filters
  const searchInput = h('input', {
    type: 'search',
    placeholder: 'Search templates (title, description, tag)…',
    style: { flex: 1 },
    oninput: e => {
      filterText = e.target.value.trim().toLocaleLowerCase('en-US');
      renderGrid();
    }
  });

  const formatSelect = h('select', {
    onchange: e => {
      filterFormat = e.target.value;
      renderGrid();
    }
  },
    h('option', { value: '' }, 'All Formats'),
    h('option', { value: '16:9' }, 'YouTube 16:9'),
    h('option', { value: '9:16' }, 'Shorts 9:16')
  );

  const collectionSelect = h('select', {
    'aria-label': 'Template collection',
    onchange: e => { filterCollection = e.target.value; renderGrid(); }
  },
    h('option', { value: '', selected: !filterCollection }, 'All templates'),
    h('option', { value: 'reference-picks', selected: filterCollection === 'reference-picks' }, 'New · 15 reference templates')
  );

  const filterRow = h('div', { class: 'row', style: { gap: '10px', margin: '12px 0 6px' } },
    searchInput,
    collectionSelect,
    formatSelect
  );
  modal.append(filterRow);

  const grid = h('div', { class: 'template-gallery-grid' });
  const scrollWrapper = h('div', { class: 'template-gallery-scroll' }, grid);
  modal.append(scrollWrapper);

  function renderGrid() {
    grid.innerHTML = '';

    const filtered = allTemplates.filter(t => {
      if (filterCollection && !t.tags?.includes(filterCollection)) return false;
      if (filterFormat && t.format && t.format !== filterFormat) return false;
      if (!filterText) return true;
      const haystack = `${t.name || ''} ${t.desc || ''} ${(t.tags || []).join(' ')} ${t.file || ''}`.toLocaleLowerCase('en-US');
      return haystack.includes(filterText);
    });

    if (filtered.length === 0) {
      grid.append(h('div', { class: 'dim', style: { gridColumn: '1 / -1', padding: '30px', textAlign: 'center' } }, 'No matching templates found.'));
      return;
    }

    for (const tpl of filtered) {
      const card = renderTemplateCard(tpl, {
        onApply: selected => {
          handleSelectTemplate(selected);
        }
      });
      grid.append(card);
    }
  }

  async function handleSelectTemplate(tpl) {
    if (tpl.error) return;

    openTemplateSlotsModal(tpl, {
      onConfirm: async slotValues => {
        if (currentBrief && currentBrief.layers && currentBrief.layers.length > 0) {
          const proceed = await confirmBox(
            'Replace Current Layers?',
            h('p', {}, 'Applying this template will replace the current layers and settings. You can undo this with Undo.'),
            'Apply Template'
          );
          if (!proceed) return;
        }

        close();
        if (onApplyTemplate) {
          onApplyTemplate(tpl, slotValues);
        }
      }
    });
  }

  async function loadTemplates() {
    try {
      allTemplates = await api('/api/thumbstudio/templates');
      if (!modalBg.isConnected) return;
      renderGrid();
    } catch (err) {
      toast('Could not load templates: ' + err.message, true);
    }
  }

  // Subscribe to changes
  const unsub = onHubEvent('thumbstudio', ev => {
    if (ev && ev.type === 'templates-changed') {
      loadTemplates();
    }
  });

  function close() { unsub(); modalBg.remove(); }
  document.body.append(modalBg);
  loadTemplates();
}

// Open "Save as Template" dialog
export function openSaveTemplateModal(currentBrief) {
  let nameInput;
  let overwriteCheck;

  const defaultName = currentBrief.title || 'New Template';

  const modalBody = h('div', { style: { display: 'flex', flexDirection: 'column', gap: '14px', margin: '12px 0' } },
    h('label', { style: { display: 'flex', flexDirection: 'column', gap: '4px' } },
      h('div', { style: { fontWeight: 600 } }, 'Template Name:'),
      nameInput = h('input', { type: 'text', value: defaultName, style: { width: '100%' } })
    ),
    h('label', { class: 'row', style: { gap: '8px', cursor: 'pointer' } },
      overwriteCheck = h('input', { type: 'checkbox' }),
      h('span', {}, 'Overwrite any template with the same name')
    )
  );

  confirmBox('Save as Template', modalBody, 'Save').then(async ok => {
    if (!ok) return;

    const name = nameInput.value.trim();
    if (!name) {
      toast('Please enter a valid template name.', true);
      return;
    }

    try {
      await api('/api/thumbstudio/templates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          brief: currentBrief,
          overwrite: overwriteCheck.checked,
        })
      });
      toast(`"${name}" saved as a template.`);
    } catch (err) {
      toast(err.message, true);
    }
  });
}
