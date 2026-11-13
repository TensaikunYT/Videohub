import { agentName } from '../agent.js';
// VideoHub · Thumbnail Studio Editor Shell (#/thumbstudio/<pid>/<tid>)
import { h, api, toast, confirmBox, pill, onHubEvent } from '../app.js';
import { History } from './history.js';
import { drawScene, renderExportCanvases, setImageLoadHandler, isOverlayLayer } from './scene.js';
import { generatePrompt } from './prompt.js';
import { createVariantStrip, openVariantViewer, markedImage, fileUrl as tsFileUrl } from './gen.js';
import { renderFinalPanel } from './compose.js';
import {
  createObjectLayer,
  createZoneLayer,
  createBackgroundLayer,
  createSubjectLayer,
  createTextLayer,
  createEffectLayer,
  createSketchLayer,
  createTraceLayer,
  hitTestHandle,
  hitTestLayer,
  snapLayerBounds,
  getLayerBox,
  toLayerLocal
} from './layers.js';
import { renderInspector } from './inspector.js';
import { openReferencesModal } from './refs.js';
import { createDepthPanel } from './depth.js';
import { hitTestLightGizmo, computeAzimuthFromPointer } from './light.js';
import { applyPerspectiveLock } from './camera.js';
import { openTemplatePickerModal, openSaveTemplateModal, applyClientTemplateSlots } from './templates.js';

export async function renderEditor(page, pid, tid) {
  // Load brief from server
  let brief;
  try {
    brief = await api(`/api/thumbstudio/${pid}/${tid}`);
  } catch (err) {
    page.append(h('div', { class: 'thumbstudio-page' },
      h('div', { class: 'empty' }, 'Could not load thumbnail: ' + err.message),
      h('button', { onclick: () => { location.hash = '#/thumbstudio'; } }, '← Back to list')
    ));
    return;
  }

  // fields only the server changes (undo must not bring back an old variant list)
  const SERVER_KEYS = ['variants', 'chosen', 'final', 'status', 'exported'];
  const serverFields = Object.fromEntries(SERVER_KEYS.map(k => [k, brief[k]]));

  // Editor state
  const state = {
    brief,
    selectedLayerId: brief.layers?.[0]?.id || null,
    viewMode: 'layout', // layout | depth | preview | final
    tool: 'select',     // select | object | zone
    zoom: 1.0,
    pan: { x: 0, y: 0 },
    activeGuides: [],
    saveStatus: 'saved', // saved | saving | error
  };

  const history = new History();

  // Create UI layout
  page.classList.add('thumbstudio-editor-page');
  page.parentElement.scrollTop = 0;
  const root = h('div', { class: 'thumbstudio-editor' });
  page.append(root);

  // 1. Header
  const titleText = h('span', { class: 'editor-title' }, brief.title || 'Untitled Thumbnail');
  const saveIndicator = h('span', { class: 'save-badge' }, '✓ Saved');
  const undoBtn = h('button', { class: 'ghost', title: 'Undo (Ctrl+Z)', disabled: true }, '↶');
  const redoBtn = h('button', { class: 'ghost', title: 'Redo (Ctrl+Y)', disabled: true }, '↷');

  undoBtn.onclick = () => history.undo();
  redoBtn.onclick = () => history.redo();

  history.onChange((canUndo, canRedo) => {
    undoBtn.disabled = !canUndo;
    redoBtn.disabled = !canRedo;
  });

  const modeSel = h('div', { class: 'viewmode-group row' },
    modeBtn('layout', 'Layout (1)'),
    modeBtn('depth', 'Depth (2)'),
    modeBtn('preview', 'Camera (3)'),
    modeBtn('final', 'Final (4)')
  );

  function modeBtn(mode, label) {
    return h('button', {
      class: 'mode-btn' + (state.viewMode === mode ? ' on' : ''),
      'data-mode': mode,
      onclick: () => setViewMode(mode)
    }, label);
  }

  function setViewMode(mode) {
    state.viewMode = mode;
    root.querySelectorAll('.mode-btn').forEach(b => b.classList.toggle('on', b.dataset.mode === mode));
    if (mode === 'final') {
      const sel = state.brief.layers.find(l => l.id === state.selectedLayerId);
      if (sel && !isOverlayLayer(sel)) state.selectedLayerId = null;
    }
    redrawCanvas();
    updateInspector(true);
  }

  function applyTemplateToBrief(tpl, slots) {
    const applied = applyClientTemplateSlots(tpl, slots);
    state.selectedLayerId = null;
    updateBrief(applied);
    toast(`Template "${tpl.name}" applied.`);
  }

  const header = h('header', { class: 'editor-header' },
    h('div', { class: 'row', style: { gap: '10px' } },
      h('button', { class: 'ghost', onclick: () => { location.hash = '#/thumbstudio'; } }, '← Thumbnails'),
      titleText,
      pill('fam', brief.format),
      saveIndicator
    ),
    h('div', { class: 'row', style: { gap: '8px' } },
      undoBtn, redoBtn,
      h('span', { class: 'sep' }),
      modeSel
    ),
    h('div', { class: 'row', style: { gap: '8px' } },
      h('button', {
        class: 'ghost',
        title: 'Choose and apply a template from the gallery',
        onclick: () => openTemplatePickerModal({
          currentBrief: state.brief,
          onApplyTemplate: (tpl, slots) => applyTemplateToBrief(tpl, slots)
        })
      }, '📐 Template'),
      h('button', {
        class: 'ghost',
        title: 'Save the current composition as a custom template',
        onclick: () => openSaveTemplateModal(state.brief)
      }, '💾 Save template'),
      h('button', { class: 'ghost', onclick: () => openReferencesModal(pid, tid, state.brief, { onUpdated: () => onStateChanged() }) }, 'References'),
      h('button', { class: 'ghost', title: 'Writes layout.png, sketch.png, depth.png, prompt.txt and brief.md (Ctrl+S)', onclick: () => doExport(true) }, '⤓ Export'),
      h('button', { class: 'primary', title: `Exports and copies a message to paste into a ${agentName()} chat`, onclick: () => sendToClaude() }, `💬 Send to ${agentName()}`)
    )
  );
  root.append(header);

  // 2. Main 3-column workspace
  const workspace = h('div', { class: 'editor-workspace' });
  root.append(workspace);

  // 2.1 Left column: Toolbar & Layers Panel
  const leftCol = h('div', { class: 'editor-left-col' });
  const toolbar = h('div', { class: 'editor-toolbar' });
  leftCol.append(toolbar);

  toolBtn('select', '▢ Select', 'Select and move');
  toolBtn('subject', '🧍 Person', 'New person / character (posed mannequin)');
  toolBtn('object', '📦 Object', 'Add an object layer');
  toolBtn('text', '🅣 Text', 'Add a large title / text layer');
  toolBtn('effect', '➜ Effects', 'Highlight arrow / circle / badge');
  toolBtn('pen', '✎ Draw', 'Freehand drawing pen');
  toolBtn('zone', '▭ Empty space', 'Negative space (for a title / face)');
  toolBtn('trace', '🖼 Trace underlay', 'Add a reference thumbnail underlay');
  toolBtn('background', '🌄 Background', 'Add a background');

  function toolBtn(toolId, label, tooltip) {
    const btn = h('button', {
      class: 'tool-btn' + (state.tool === toolId ? ' on' : ''),
      title: tooltip,
      onclick: () => {
        if (toolId === 'subject') {
          addLayer(createSubjectLayer(state.brief.layers));
        } else if (toolId === 'object') {
          addLayer(createObjectLayer(state.brief.layers));
        } else if (toolId === 'text') {
          addLayer(createTextLayer(state.brief.layers));
        } else if (toolId === 'effect') {
          addLayer(createEffectLayer(state.brief.layers));
        } else if (toolId === 'zone') {
          addLayer(createZoneLayer(state.brief.layers));
        } else if (toolId === 'trace') {
          promptTraceUnderlay();
        } else if (toolId === 'background') {
          const hasBg = state.brief.layers.some(l => l.type === 'background');
          if (hasBg) toast('A background already exists');
          else addLayer(createBackgroundLayer(state.brief.layers), true);
        } else if (toolId === 'pen') {
          state.tool = 'pen';
          toolbar.querySelectorAll('.tool-btn').forEach(b => b.classList.remove('on'));
          btn.classList.add('on');
          toast('Freehand mode: draw on the canvas');
        } else {
          state.tool = 'select';
          toolbar.querySelectorAll('.tool-btn').forEach(b => b.classList.remove('on'));
          btn.classList.add('on');
        }
      }
    }, label);
    toolbar.append(btn);
  }

  function promptTraceUnderlay() {
    const input = h('input', { type: 'file', accept: 'image/png, image/jpeg, image/webp', style: { display: 'none' } });
    document.body.append(input);
    input.onchange = () => {
      const file = input.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = async () => {
        input.remove();
        try {
          const r = await api(`/api/thumbstudio/${pid}/${tid}/ref`, { method: 'POST', body: { name: file.name, data: reader.result, trace: true } });
          addLayer(createTraceLayer(state.brief.layers, { file: r.file, name: 'Trace underlay: ' + file.name }), true);
          toast('Trace underlay added (not sent to AI)');
        } catch (e) { toast('Could not load trace underlay: ' + e.message, true); }
      };
      reader.readAsDataURL(file);
    };
    input.click();
  }

  // Layers list panel
  const layersPanel = h('div', { class: 'editor-layers-panel' });
  leftCol.append(layersPanel);
  workspace.append(leftCol);

  // 2.2 Center Canvas Area & Depth Panel
  const centerCol = h('div', { class: 'editor-center-col', style: { display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' } });
  const canvasViewport = h('div', { class: 'editor-canvas-viewport' });
  const canvasContainer = h('div', { class: 'editor-canvas-container' });
  const canvas = document.createElement('canvas');
  canvas.tabIndex = 0;
  canvas.setAttribute('aria-label', 'Thumbnail canvas');
  const ctx = canvas.getContext('2d');
  canvasContainer.append(canvas);
  canvasViewport.append(canvasContainer);
  centerCol.append(canvasViewport);

  // Depth panel
  const depthPanelObj = createDepthPanel(() => state.brief, {
    onLayerDepthChange: (lid, d) => mutateLayer(lid, { depth: d }),
    onSelectLayer: lid => {
      state.selectedLayerId = lid;
      redrawCanvas();
      updateInspector();
      renderLayersList();
    }
  });
  centerCol.append(depthPanelObj.el);
  workspace.append(centerCol);

  // Fit the canvas to the actual free space, including wrapped headers and variant strips.
  function sizeCanvas() {
    const is916 = state.brief.format === '9:16';
    const width = is916 ? 1080 : 1280, height = is916 ? 1920 : 720;
    if (canvas.width !== width) canvas.width = width;
    if (canvas.height !== height) canvas.height = height;
    const style = getComputedStyle(canvasViewport);
    const availableW = Math.max(1, canvasViewport.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight) - 2);
    const availableH = Math.max(1, canvasViewport.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom) - 2);
    const scale = Math.min(availableW / width, availableH / height);
    canvasContainer.style.width = `${Math.floor(width * scale)}px`;
    canvasContainer.style.height = `${Math.floor(height * scale)}px`;
  }
  const canvasResize = new ResizeObserver(() => redrawCanvas());
  canvasResize.observe(canvasViewport);

  // 2.3 Right Column: Inspector
  const inspectorPanel = h('div', { class: 'editor-inspector' });
  const inspectorBody = h('div', { class: 'editor-inspector-body' });
  const promptText = h('pre', { class: 'ts-prompt-text' });
  const promptLen = h('span', { class: 'dim' });
  const promptEdit = h('textarea', { rows: 9, class: 'ts-prompt-edit', hidden: true });
  const promptEditBtn = h('button', { class: 'ghost' }, 'Edit manually');
  const promptAutoBtn = h('button', { class: 'ghost', hidden: true }, 'Use automatic prompt');
  const promptBox = h('details', { class: 'ts-prompt-box' },
    h('summary', {}, 'Prompt preview ', promptLen),
    promptText, promptEdit,
    h('div', { class: 'row', style: { gap: '6px' } }, promptEditBtn, promptAutoBtn, h('span', { class: 'spacer' }),
      h('button', { class: 'ghost', title: 'Copy prompt to clipboard', onclick: async () => { try { await navigator.clipboard.writeText(generatePrompt(state.brief).prompt); toast('Prompt copied'); } catch { toast('Could not copy', true); } } }, '⧉')));
  try { promptBox.open = localStorage.getItem('ts-prompt-open') === '1'; } catch { }
  promptBox.addEventListener('toggle', () => { try { localStorage.setItem('ts-prompt-open', promptBox.open ? '1' : '0'); } catch { } updatePromptPreview(); });
  promptEditBtn.onclick = () => { promptEdit.value = generatePrompt(state.brief).prompt; promptEdit.hidden = false; promptText.hidden = true; promptEdit.focus(); };
  promptEdit.addEventListener('input', () => { state.brief.promptOverride = promptEdit.value.trim() || null; promptAutoBtn.hidden = !state.brief.promptOverride; promptLen.textContent = `(${promptEdit.value.length} characters · manual)`; triggerAutosave(); });
  promptAutoBtn.onclick = () => { updateBrief({ promptOverride: null }); promptEdit.hidden = true; promptText.hidden = false; };
  inspectorPanel.append(inspectorBody, promptBox);
  workspace.append(inspectorPanel);

  function updatePromptPreview() {
    const r = generatePrompt(state.brief);
    promptLen.textContent = `(${r.prompt.length} characters${r.isOverride ? ' · manually edited' : ''})`;
    promptAutoBtn.hidden = !r.isOverride;
    if (!promptBox.open) return;
    if (document.activeElement !== promptEdit) { promptText.textContent = r.prompt; promptText.hidden = !promptEdit.hidden ? true : false; }
  }

  // variants strip under the canvas (filled from the server: Claude adds to it)
  const strip = createVariantStrip({
    pid, tid,
    getBrief: () => state.brief,
    onOpen: vid => openViewer(vid),
  });
  centerCol.append(strip.el);
  let viewer = null;
  function openViewer(vid) {
    viewer = openVariantViewer({
      pid, tid, vid,
      getBrief: () => state.brief,
      onChanged: refreshServerState,
      onChoose: async v => { const b = await api(`/api/thumbstudio/${pid}/${tid}/choose`, { method: 'POST', body: { vid: v } }); mergeServer(b); toast(v + ' chosen'); },
      onFinal: () => setViewMode('final'),
      onFix: async (v, notes) => {
        try {
          const marked = await markedImage(tsFileUrl(pid, tid, v.file, v.hash || v.at), notes);
          await api(`/api/thumbstudio/${pid}/${tid}/variant/${v.id}/marked`, { method: 'POST', body: { data: marked } });
          await sendToClaude();   // exports, then copies the message: Claude fixes this variant from its notes
          return true;
        } catch (e) { toast('Could not prepare the fix: ' + e.message, true); return false; }
      },
    });
  }

  // server-owned fields (variants, choice, final, status) come from the server, the rest stays the editor's
  function mergeServer(b) {
    if (!b) return;
    for (const k of SERVER_KEYS) serverFields[k] = b[k];
    Object.assign(state.brief, serverFields);
    strip.draw();
    viewer?.redraw?.();
    if (state.viewMode === 'final') { redrawCanvas(); updateInspector(true); }
  }
  async function refreshServerState() {
    try { mergeServer(await api(`/api/thumbstudio/${pid}/${tid}`)); } catch { }
  }
  const unsubHub = onHubEvent('thumbstudio', ev => {
    if (!ev || ev.tid !== tid) return;
    if (['variant', 'variant-removed', 'note', 'final', 'exported'].includes(ev.type) || (ev.type === 'saved' && ev.brief)) {
      if (ev.type === 'saved' && ev.brief) mergeServer(ev.brief); else refreshServerState();
    }
  });
  // pictures (variants, trace layers) arrive after the first draw
  setImageLoadHandler(() => { redrawCanvas(); if (state.viewMode === 'final') finalPanel?.refresh(); });

  // ---------- export (layout/sketch/depth PNGs + prompt.txt + brief.md)
  const fileUrlOf = f => tsFileUrl(pid, tid, f);
  async function flushSave() {
    clearTimeout(saveTimer);
    await api(`/api/thumbstudio/${pid}/${tid}`, { method: 'PUT', body: state.brief });
  }
  async function doExport(say) {
    try {
      await flushSave();
      await document.fonts?.ready;
      const imgs = await renderExportCanvases(state.brief, { fileUrl: fileUrlOf });
      const r = await api(`/api/thumbstudio/${pid}/${tid}/export`, { method: 'POST', body: imgs });
      if (r.brief) state.brief.exported = r.brief.exported;
      if (say) toast('Exported: layout.png, sketch.png, depth.png, prompt.txt, brief.md');
      return r;
    } catch (e) { toast('Could not export: ' + e.message, true); throw e; }
  }
  async function sendToClaude() {
    try {
      await doExport(false);
      const { message } = await api(`/api/thumbstudio/${pid}/${tid}/claude-message`, { method: 'POST' });
      try { await navigator.clipboard.writeText(message); toast(`Message copied: paste it into a ${agentName()} chat`); }
      catch { await confirmBox(`Send to ${agentName()}`, h('textarea', { rows: 8, style: { width: '100%' }, readonly: true }, message), 'OK'); }
    } catch { }
  }

  // ---------- Redraw / Render loop
  function redrawCanvas() {
    sizeCanvas();
    drawScene(ctx, state.brief, state.viewMode, {
      fileUrl: fileUrlOf,
      selectedLayerId: state.selectedLayerId,
      activeGuides: state.activeGuides,
      showThirds: state.brief.safe?.thirds !== false,
      showBadge: state.brief.safe?.badge !== false,
      showGrid: true,
      isExport: false
    });
  }

  let finalPanel = null, inspectorKey = '';
  function updateInspector(force) {
    const scrollTop = inspectorPanel.scrollTop;
    const scrollLeft = inspectorPanel.scrollLeft;
    const active = document.activeElement;
    promptBox.hidden = state.viewMode === 'final';   // the final has its own panel; the prompt does not change there
    updatePromptPreview();
    // Continuous editing keeps its DOM node; selects and checkboxes must refresh dependent fields.
    const typing = inspectorBody.contains(active) && active.matches('textarea, input:not([type=checkbox]):not([type=radio]):not([type=button])');
    const key = state.viewMode === 'final' ? 'final' : 'edit:' + state.selectedLayerId;
    if (typing && !force && key === inspectorKey) return;
    const focusIndex = key === inspectorKey && inspectorBody.contains(active)
      ? [...inspectorBody.querySelectorAll('input, textarea, select, button')].indexOf(active) : -1;
    inspectorKey = key;
    try {
      if (state.viewMode === 'final') {
        finalPanel = renderFinalPanel(inspectorBody, { pid, tid, getBrief: () => state.brief, onEdit: patch => { Object.assign(state.brief, patch); redrawCanvas(); finalPanel?.refresh(); triggerAutosave(); }, onSaved: b => mergeServer(b) });
        return;
      }
      finalPanel = null;
      renderInspector(inspectorBody, state.brief, state.selectedLayerId, {
        onLayerChange: patch => updateSelectedLayer(patch),
        onBriefChange: patch => updateBrief(patch),
        onDuplicate: lid => duplicateLayer(lid),
        onDelete: lid => deleteLayer(lid)
      });
    } finally {
      if (focusIndex >= 0) inspectorBody.querySelectorAll('input, textarea, select, button')[focusIndex]?.focus({ preventScroll: true });
      inspectorPanel.scrollTop = scrollTop;
      inspectorPanel.scrollLeft = scrollLeft;
    }
  }

  function renderLayersList() {
    const scrollTop = layersPanel.querySelector('.layers-list')?.scrollTop || 0;
    layersPanel.innerHTML = '';
    const lHeader = h('div', { class: 'layers-header row' },
      h('b', {}, 'LAYERS'),
      h('span', { class: 'spacer' }),
      h('button', {
        class: 'ghost',
        title: 'Sort by depth (far -> near)',
        onclick: () => sortByDepth()
      }, '↕ Depth')
    );
    layersPanel.append(lHeader);

    const list = h('div', { class: 'layers-list' });
    layersPanel.append(list);

    const layers = state.brief.layers || [];
    // Show top-to-bottom (reverse of drawing array, so topmost visual layer is first)
    for (let i = layers.length - 1; i >= 0; i--) {
      const layer = layers[i];
      const isSelected = layer.id === state.selectedLayerId;

      const row = h('div', {
        class: 'layer-row' + (isSelected ? ' selected' : ''),
        onclick: () => {
          state.selectedLayerId = layer.id;
          redrawCanvas();
          updateInspector();
          renderLayersList();
        }
      },
        h('span', {
          class: 'layer-color-dot',
          style: { background: layer.color || '#6aa0ff' }
        }),
        h('span', {
          class: 'layer-title ellip',
          title: layer.name,
          ondblclick: e => {
            e.stopPropagation();
            renameLayerPrompt(layer);
          }
        }, layer.name),
        h('span', { class: 'spacer' }),
        h('button', {
          class: 'layer-btn',
          title: layer.hidden ? 'Show' : 'Hide',
          onclick: e => {
            e.stopPropagation();
            mutateLayer(layer.id, { hidden: !layer.hidden });
          }
        }, layer.hidden ? '🙈' : '👁'),
        h('button', {
          class: 'layer-btn',
          title: layer.locked ? 'Unlock' : 'Lock',
          onclick: e => {
            e.stopPropagation();
            mutateLayer(layer.id, { locked: !layer.locked });
          }
        }, layer.locked ? '🔒' : '🔓')
      );
      list.append(row);
    }
    list.scrollTop = scrollTop;
  }

  function renameLayerPrompt(layer) {
    const input = h('input', { type: 'text', value: layer.name });
    confirmBox('Rename layer', input, 'Save').then(ok => {
      if (ok && input.value.trim()) {
        mutateLayer(layer.id, { name: input.value.trim() });
      }
    });
  }

  // ---------- Mutation & History Helpers
  function addLayer(newLayer, atBottom = false) {
    const prev = JSON.parse(JSON.stringify(state.brief.layers));
    const next = [...prev];
    if (atBottom) next.unshift(newLayer);
    else next.push(newLayer);

    history.push({
      undo: () => {
        state.brief.layers = prev;
        state.selectedLayerId = prev[prev.length - 1]?.id || null;
        onStateChanged();
      },
      redo: () => {
        state.brief.layers = next;
        state.selectedLayerId = newLayer.id;
        onStateChanged();
      }
    });

    state.brief.layers = next;
    state.selectedLayerId = newLayer.id;
    onStateChanged();
  }

  function mutateLayer(layerId, patch) {
    const prevLayer = state.brief.layers.find(l => l.id === layerId);
    if (!prevLayer) return;

    const prevClone = { ...prevLayer };
    const nextClone = { ...prevLayer, ...patch };

    history.push({
      undo: () => {
        const l = state.brief.layers.find(x => x.id === layerId);
        if (l) Object.assign(l, prevClone);
        onStateChanged();
      },
      redo: () => {
        const l = state.brief.layers.find(x => x.id === layerId);
        if (l) Object.assign(l, nextClone);
        onStateChanged();
      }
    });

    Object.assign(prevLayer, patch);
    onStateChanged();
  }

  function updateSelectedLayer(patch) {
    if (!state.selectedLayerId) return;
    mutateLayer(state.selectedLayerId, patch);
  }

  function duplicateLayer(layerId) {
    const orig = state.brief.layers.find(l => l.id === layerId);
    if (!orig || orig.type === 'background') return;

    const copy = JSON.parse(JSON.stringify(orig));
    copy.id = 'L' + Date.now().toString(36).slice(-4);
    copy.name = copy.name + ' (copy)';
    copy.x = Math.min(0.8, copy.x + 0.04);
    copy.y = Math.min(0.8, copy.y + 0.04);
    addLayer(copy);
  }

  function deleteLayer(layerId) {
    const layer = state.brief.layers.find(l => l.id === layerId);
    if (!layer || layer.type === 'background' || layer.locked) return;

    const prev = JSON.parse(JSON.stringify(state.brief.layers));
    const next = prev.filter(l => l.id !== layerId);

    history.push({
      undo: () => {
        state.brief.layers = prev;
        state.selectedLayerId = layerId;
        onStateChanged();
      },
      redo: () => {
        state.brief.layers = next;
        state.selectedLayerId = next[next.length - 1]?.id || null;
        onStateChanged();
      }
    });

    state.brief.layers = next;
    state.selectedLayerId = next[next.length - 1]?.id || null;
    onStateChanged();
  }

  function updateBrief(patch) {
    const prev = JSON.parse(JSON.stringify(state.brief));
    const next = { ...state.brief, ...patch };

    history.push({
      undo: () => {
        state.brief = prev;
        onStateChanged();
      },
      redo: () => {
        state.brief = next;
        onStateChanged();
      }
    });

    Object.assign(state.brief, patch);
    onStateChanged();
  }

  function sortByDepth() {
    const prev = JSON.parse(JSON.stringify(state.brief.layers));
    const next = [...prev].sort((a, b) => (b.depth ?? 50) - (a.depth ?? 50));

    history.push({
      undo: () => {
        state.brief.layers = prev;
        onStateChanged();
      },
      redo: () => {
        state.brief.layers = next;
        onStateChanged();
      }
    });

    state.brief.layers = next;
    onStateChanged();
  }

  // ---------- Autosave logic (800ms debounce)
  let saveTimer = null;
  function triggerAutosave() {
    saveIndicator.textContent = '⏳ Saving…';
    saveIndicator.style.color = 'var(--accent)';
    clearTimeout(saveTimer);
    saveTimer = setTimeout(async () => {
      try {
        await api(`/api/thumbstudio/${pid}/${tid}`, {
          method: 'PUT',
          body: state.brief
        });
        saveIndicator.textContent = '✓ Saved';
        saveIndicator.style.color = 'var(--green)';
        saveTimer = null;
      } catch (e) {
        saveIndicator.textContent = '⚠ Save failed';
        saveIndicator.style.color = 'var(--red)';
      }
    }, 800);
  }

  function onStateChanged() {
    Object.assign(state.brief, serverFields);
    redrawCanvas();
    updateInspector();
    renderLayersList();
    depthPanelObj?.update();
    triggerAutosave();
  }

  // ---------- Canvas Interactive Drag / Resize / Rotate
  let isInteracting = false;
  let interactionMode = null; // 'move' | 'resize' | 'rotate' | 'pen'
  let activeHandle = null;
  let activeStroke = null;
  let dragStart = { x: 0, y: 0 };
  let initialLayerSnapshot = null;
  let initialLayersArray = null;
  let initialLight = null;
  let activePointerId = null;

  function getCanvasCoords(e) {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY
    };
  }

  canvas.addEventListener('pointerdown', e => {
    if (e.button !== 0 || isInteracting) return;
    e.preventDefault();
    canvas.focus({ preventScroll: true });
    activePointerId = e.pointerId;
    canvas.setPointerCapture(e.pointerId);
    const { x, y } = getCanvasCoords(e);
    dragStart = { x, y };

    if (state.tool === 'pen') {
      isInteracting = true;
      interactionMode = 'pen';
      activeStroke = {
        pts: [[x / canvas.width, y / canvas.height]],
        w: 4,
        color: '#ff4444'
      };
      return;
    }

    // Hit test light gizmo (sun)
    if (state.viewMode !== 'final' && hitTestLightGizmo(x, y, state.brief.light, canvas.width, canvas.height)) {
      isInteracting = true;
      interactionMode = 'light';
      initialLight = JSON.parse(JSON.stringify(state.brief.light || {}));
      return;
    }

    const selectedLayer = state.brief.layers.find(l => l.id === state.selectedLayerId);
    const handle = hitTestHandle(x, y, selectedLayer, canvas.width, canvas.height);

    if (handle) {
      // Start handle interaction
      isInteracting = true;
      activeHandle = handle;
      interactionMode = handle.id === 'rot' ? 'rotate' : 'resize';
      initialLayerSnapshot = JSON.parse(JSON.stringify(selectedLayer));
      initialLayersArray = JSON.parse(JSON.stringify(state.brief.layers));
      return;
    }

    // Hit test layers
    const pickable = state.viewMode === 'final' ? state.brief.layers.filter(isOverlayLayer) : state.brief.layers;
    const hit = hitTestLayer(x, y, pickable, canvas.width, canvas.height);
    if (hit) {
      state.selectedLayerId = hit.id;
      isInteracting = true;
      interactionMode = 'move';
      initialLayerSnapshot = JSON.parse(JSON.stringify(hit));
      initialLayersArray = JSON.parse(JSON.stringify(state.brief.layers));
      redrawCanvas(); updateInspector(); renderLayersList();
    } else {
      // Clicked on empty space -> deselect
      state.selectedLayerId = null;
      redrawCanvas(); updateInspector(); renderLayersList();
    }
  });

  canvas.addEventListener('pointermove', e => {
    if (isInteracting && e.pointerId !== activePointerId) return;
    const { x, y } = getCanvasCoords(e);

    if (interactionMode === 'pen') {
      activeStroke.pts.push([x / canvas.width, y / canvas.height]);
      ctx.save();
      ctx.strokeStyle = activeStroke.color;
      ctx.lineWidth = activeStroke.w;
      ctx.lineCap = 'round';
      const pts = activeStroke.pts;
      const p1 = pts[pts.length - 2];
      const p2 = pts[pts.length - 1];
      ctx.beginPath();
      ctx.moveTo(p1[0] * canvas.width, p1[1] * canvas.height);
      ctx.lineTo(p2[0] * canvas.width, p2[1] * canvas.height);
      ctx.stroke();
      ctx.restore();
      return;
    }

    if (interactionMode === 'light') {
      const az = computeAzimuthFromPointer(x, y, canvas.width, canvas.height);
      state.brief.light.azimuth = az;
      redrawCanvas();
      updateInspector();
      return;
    }

    if (!isInteracting) {
      // Update cursor based on hover
      const selectedLayer = state.brief.layers.find(l => l.id === state.selectedLayerId);
      const handle = hitTestHandle(x, y, selectedLayer, canvas.width, canvas.height);
      if (handle) {
        canvas.style.cursor = handle.cursor;
      } else if (hitTestLightGizmo(x, y, state.brief.light, canvas.width, canvas.height)) {
        canvas.style.cursor = 'grab';
      } else {
        const hit = hitTestLayer(x, y, state.brief.layers, canvas.width, canvas.height);
        canvas.style.cursor = hit ? 'move' : 'default';
      }
      return;
    }

    const currentLayer = state.brief.layers.find(l => l.id === state.selectedLayerId);
    if (!currentLayer) return;

    const dx = (x - dragStart.x) / canvas.width;
    const dy = (y - dragStart.y) / canvas.height;

    if (interactionMode === 'move') {
      let nextX = initialLayerSnapshot.x + dx;
      let nextY = initialLayerSnapshot.y + dy;

      // Snapping (Alt disables snap)
      if (!e.altKey) {
        const others = state.brief.layers.filter(l => l.id !== currentLayer.id);
        const snap = snapLayerBounds(nextX, nextY, currentLayer.w, currentLayer.h, others, canvas.width, canvas.height);
        nextX = snap.snappedX;
        nextY = snap.snappedY;
        state.activeGuides = snap.guides;
      } else {
        state.activeGuides = [];
      }

      currentLayer.x = nextX;
      currentLayer.y = nextY;
      redrawCanvas();
      updateInspector();
    } else if (interactionMode === 'resize') {
      const init = initialLayerSnapshot;
      let newW = init.w;
      let newH = init.h;
      let newX = init.x;
      let newY = init.y;

      const hid = activeHandle.id;
      if (hid.includes('e')) newW = Math.max(0.02, init.w + dx);
      if (hid.includes('s')) newH = Math.max(0.02, init.h + dy);
      if (hid.includes('w')) {
        const delta = Math.min(dx, init.w - 0.02);
        newX = init.x + delta;
        newW = init.w - delta;
      }
      if (hid.includes('n')) {
        const delta = Math.min(dy, init.h - 0.02);
        newY = init.y + delta;
        newH = init.h - delta;
      }

      // Shift preserves aspect ratio
      if (e.shiftKey) {
        const origRatio = init.w / init.h;
        newH = newW / origRatio;
      }

      currentLayer.x = newX;
      currentLayer.y = newY;
      currentLayer.w = newW;
      currentLayer.h = newH;
      redrawCanvas();
      updateInspector();
    } else if (interactionMode === 'rotate') {
      const box = getLayerBox(currentLayer, canvas.width, canvas.height);
      const angleRad = Math.atan2(y - box.cy, x - box.cx);
      let angleDeg = Math.round((angleRad * 180) / Math.PI + 90);

      // Shift steps in 15 degrees
      if (e.shiftKey) {
        angleDeg = Math.round(angleDeg / 15) * 15;
      }

      // Normalize to -180..180
      if (angleDeg > 180) angleDeg -= 360;
      if (angleDeg < -180) angleDeg += 360;

      currentLayer.rot = angleDeg;
      redrawCanvas();
      updateInspector();
    }
  });

  const endInteraction = e => {
    if (activePointerId !== null && e.pointerId !== activePointerId) return;
    const wasInteracting = isInteracting;
    const mode = interactionMode, stroke = activeStroke, prevArr = initialLayersArray, prevLight = initialLight;
    const pointerId = activePointerId;
    isInteracting = false;
    interactionMode = null;
    activeStroke = null;
    activeHandle = null;
    activePointerId = null;
    initialLayerSnapshot = null;
    initialLayersArray = null;
    initialLight = null;
    state.activeGuides = [];
    canvas.style.cursor = 'default';
    if (pointerId !== null && canvas.hasPointerCapture(pointerId)) canvas.releasePointerCapture(pointerId);
    if (!wasInteracting) return;

    if (mode === 'pen') {
      if (stroke && stroke.pts.length > 1) {
        let sketchLayer = state.brief.layers.find(l => l.id === state.selectedLayerId && l.type === 'sketch');
        if (!sketchLayer) {
          sketchLayer = state.brief.layers.find(l => l.type === 'sketch');
        }
        if (!sketchLayer) {
          sketchLayer = createSketchLayer(state.brief.layers);
          addLayer(sketchLayer);
        }
        const prevStrokes = [...(sketchLayer.strokes || [])];
        const nextStrokes = [...prevStrokes, stroke];
        mutateLayer(sketchLayer.id, { strokes: nextStrokes });
      }
      return;
    }

    if (mode === 'light') {
      const nextLight = JSON.parse(JSON.stringify(state.brief.light));
      if (JSON.stringify(prevLight) === JSON.stringify(nextLight)) return;
      history.push({
        undo: () => { state.brief.light = prevLight; onStateChanged(); },
        redo: () => { state.brief.light = nextLight; onStateChanged(); }
      });
      onStateChanged();
      return;
    }

    const currentLayer = state.brief.layers.find(l => l.id === state.selectedLayerId);
    if (!currentLayer) return;

    // Push history command for entire drag operation
    const nextArr = JSON.parse(JSON.stringify(state.brief.layers));
    if (!prevArr || JSON.stringify(prevArr) === JSON.stringify(nextArr)) { redrawCanvas(); return; }

    history.push({
      undo: () => {
        state.brief.layers = prevArr;
        onStateChanged();
      },
      redo: () => {
        state.brief.layers = nextArr;
        onStateChanged();
      }
    });

    onStateChanged();
  };

  canvas.addEventListener('pointerup', endInteraction);
  canvas.addEventListener('pointercancel', endInteraction);
  canvas.addEventListener('lostpointercapture', endInteraction);

  // ---------- Keyboard Shortcuts (§9.7)
  const onKeyDown = e => {
    // Crucial rule: If typing in an input, textarea or select, ignore all shortcuts!
    if (document.activeElement?.matches('input, textarea, select') || document.activeElement?.isContentEditable) {
      return;
    }
    if (document.querySelector('.modal-bg')) return;   // a dialog / the variant viewer has the keys

    // any keyboard: a Turkish layout types 'ı' / 'İ' for the I key, both count as i
    const key = e.key.length <= 2 ? e.key.toLowerCase().normalize('NFD').replace(/̇/g, '').replace('ı', 'i') : e.key.toLowerCase();
    if ((e.ctrlKey || e.metaKey) && key === 's') { e.preventDefault(); doExport(true).catch(() => { }); return; }

    // Undo / Redo
    if ((e.ctrlKey || e.metaKey) && key === 'z') {
      e.preventDefault();
      if (e.shiftKey) history.redo();
      else history.undo();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && key === 'y') {
      e.preventDefault();
      history.redo();
      return;
    }

    // Duplicate
    if ((e.ctrlKey || e.metaKey) && key === 'd') {
      e.preventDefault();
      if (state.selectedLayerId) duplicateLayer(state.selectedLayerId);
      return;
    }

    // Delete
    if (key === 'delete' || key === 'backspace') {
      if (state.selectedLayerId) {
        e.preventDefault();
        deleteLayer(state.selectedLayerId);
      }
      return;
    }

    // Nudge with arrow keys
    if (['arrowleft', 'arrowright', 'arrowup', 'arrowdown'].includes(key) && state.selectedLayerId) {
      e.preventDefault();
      const stepPx = e.shiftKey ? 10 : 1;
      const stepX = stepPx / canvas.width;
      const stepY = stepPx / canvas.height;
      const layer = state.brief.layers.find(l => l.id === state.selectedLayerId);
      if (layer && !layer.locked) {
        let dx = 0, dy = 0;
        if (key === 'arrowleft') dx = -stepX;
        if (key === 'arrowright') dx = stepX;
        if (key === 'arrowup') dy = -stepY;
        if (key === 'arrowdown') dy = stepY;
        mutateLayer(layer.id, { x: layer.x + dx, y: layer.y + dy });
      }
      return;
    }

    // Depth [ and ]
    if (key === '[' && state.selectedLayerId) {
      e.preventDefault();
      const layer = state.brief.layers.find(l => l.id === state.selectedLayerId);
      if (layer) mutateLayer(layer.id, { depth: Math.max(0, (layer.depth ?? 50) - 5) });
      return;
    }
    if (key === ']' && state.selectedLayerId) {
      e.preventDefault();
      const layer = state.brief.layers.find(l => l.id === state.selectedLayerId);
      if (layer) mutateLayer(layer.id, { depth: Math.min(100, (layer.depth ?? 50) + 5) });
      return;
    }

    // Hide / Lock toggles
    if (key === 'h' && state.selectedLayerId) {
      e.preventDefault();
      const layer = state.brief.layers.find(l => l.id === state.selectedLayerId);
      if (layer) mutateLayer(layer.id, { hidden: !layer.hidden });
      return;
    }
    if (key === 'l' && state.selectedLayerId) {
      e.preventDefault();
      const layer = state.brief.layers.find(l => l.id === state.selectedLayerId);
      if (layer) mutateLayer(layer.id, { locked: !layer.locked });
      return;
    }

    // View modes 1..4
    if (key === '1') { setViewMode('layout'); return; }
    if (key === '2') { setViewMode('depth'); return; }
    if (key === '3') { setViewMode('preview'); return; }
    if (key === '4') { setViewMode('final'); return; }
  };

  const onPaste = e => {
    if (document.activeElement?.matches('input, textarea, select')) return;
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const item of items) {
      if (item.type.startsWith('image/')) {
        const file = item.getAsFile();
        if (file) {
          openReferencesModal(pid, tid, state.brief, { onUpdated: () => onStateChanged() });
          break;
        }
      }
    }
  };

  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('paste', onPaste);
  const onLeave = e => { if (saveTimer) { e.preventDefault(); e.returnValue = ''; } };
  window.addEventListener('beforeunload', onLeave);

  // Initial draw (no save: nothing changed yet)
  redrawCanvas(); updateInspector(true); renderLayersList(); depthPanelObj?.update(); strip.draw();

  // Cleanup on page unload / navigation
  return () => {
    window.removeEventListener('keydown', onKeyDown);
    window.removeEventListener('paste', onPaste);
    window.removeEventListener('beforeunload', onLeave);
    unsubHub(); strip.dispose(); setImageLoadHandler(null); viewer?.close?.();
    canvasResize.disconnect(); depthPanelObj.destroy();
    // leaving with an unsaved change: save it now
    if (saveTimer) { clearTimeout(saveTimer); api(`/api/thumbstudio/${pid}/${tid}`, { method: 'PUT', body: state.brief }).catch(() => { }); }
  };
}
