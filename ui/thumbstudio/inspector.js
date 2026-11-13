// Right panel: Inspector for selected layer or overall scene
import { h } from '../app.js';
import { checkFramingConsistency } from './camera.js';
import { CAMERA_SHOTS, CAMERA_ANGLES, LENSES, LIGHT_KEYS, LIGHT_TIMES, STYLE_PRESETS, MOODS, TEXT_PRESETS } from './catalog.js';

export function renderInspector(container, brief, selectedLayerId, { onLayerChange, onBriefChange, onDuplicate, onDelete }) {
  container.innerHTML = '';

  // Framing consistency warnings
  const warnings = checkFramingConsistency(brief);
  if (warnings.length) {
    const warnBox = h('div', {
      class: 'inspector-warning',
      style: {
        background: 'var(--yellow-bg)',
        color: 'var(--yellow)',
        padding: '8px 12px',
        fontSize: '11.5px',
        borderBottom: '1px solid var(--yellow)',
        display: 'flex',
        alignItems: 'center',
        gap: '6px'
      }
    }, '⚠ ' + warnings[0].text);
    container.append(warnBox);
  }

  const selectedLayer = brief.layers?.find(l => l.id === selectedLayerId);

  if (selectedLayer) {
    renderLayerInspector(container, selectedLayer, brief, { onLayerChange, onDuplicate, onDelete });
  } else {
    renderSceneInspector(container, brief, { onBriefChange });
  }
}

function renderLayerInspector(container, layer, brief, { onLayerChange, onDuplicate, onDelete }) {
  const isLocked = !!layer.locked;
  const isBg = layer.type === 'background';

  // Header row
  const header = h('div', { class: 'inspector-header row' },
    h('b', { style: { fontSize: '15px' } }, 'Layer: ' + layer.name),
    h('span', { class: 'spacer' }),
    h('button', {
      class: 'ghost',
      title: layer.hidden ? 'Show' : 'Hide',
      onclick: () => onLayerChange({ hidden: !layer.hidden })
    }, layer.hidden ? '🙈' : '👁'),
    h('button', {
      class: 'ghost',
      title: layer.locked ? 'Unlock' : 'Lock',
      onclick: () => onLayerChange({ locked: !layer.locked })
    }, layer.locked ? '🔒' : '🔓'),
    !isBg ? h('button', {
      class: 'ghost',
      title: 'Duplicate',
      onclick: () => onDuplicate(layer.id)
    }, '⧉') : null,
    !isBg ? h('button', {
      class: 'ghost',
      title: 'Delete',
      style: { color: 'var(--red)' },
      onclick: () => onDelete(layer.id)
    }, '🗑') : null
  );
  container.append(header);

  const form = h('div', { class: 'inspector-body' });
  container.append(form);

  // Name
  form.append(field('Layer Name', h('input', {
    type: 'text',
    value: layer.name || '',
    disabled: isLocked,
    oninput: e => onLayerChange({ name: e.target.value })
  })));

  // Description for AI
  form.append(field('AI Description (desc)', h('textarea', {
    rows: 3,
    placeholder: 'What is in this layer? (e.g. An ancient gold goblet with patina and hieroglyphs)',
    value: layer.desc || '',
    disabled: isLocked,
    oninput: e => onLayerChange({ desc: e.target.value })
  })));

  // Geometry
  const xIn = numInput(Math.round(layer.x * 100), -50, 150, 1, isLocked, v => onLayerChange({ x: v / 100 }));
  const yIn = numInput(Math.round(layer.y * 100), -50, 150, 1, isLocked, v => onLayerChange({ y: v / 100 }));
  const wIn = numInput(Math.round(layer.w * 100), 1, 300, 1, isLocked || isBg, v => onLayerChange({ w: v / 100 }));
  const hIn = numInput(Math.round(layer.h * 100), 1, 300, 1, isLocked || isBg, v => onLayerChange({ h: v / 100 }));

  form.append(h('div', { class: 'inspector-section' },
    h('div', { class: 'section-title' }, 'Position and Size (%)'),
    h('div', { class: 'grid-2x2' },
      h('label', {}, 'X %', xIn),
      h('label', {}, 'Y %', yIn),
      h('label', {}, 'W %', wIn),
      h('label', {}, 'H %', hIn)
    )
  ));

  // Rotation
  if (!isBg) {
    const rotVal = h('span', { class: 'dim', style: { width: '40px', textAlign: 'right' } }, (layer.rot || 0) + '°');
    const rotSlider = h('input', {
      type: 'range',
      min: -180,
      max: 180,
      value: layer.rot || 0,
      disabled: isLocked,
      oninput: e => {
        const val = parseInt(e.target.value, 10);
        rotVal.textContent = val + '°';
        onLayerChange({ rot: val });
      }
    });
    form.append(field('Rotation', h('div', { class: 'row' }, rotSlider, rotVal)));
  }

  // Depth & Plane
  const depthText = layer.depth <= 33 ? 'Foreground' : layer.depth <= 66 ? 'Midground' : 'Background';
  const depthLabel = h('span', { class: 'dim' }, `${layer.depth ?? 50} (${depthText})`);
  const depthSlider = h('input', {
    type: 'range',
    min: 0,
    max: 100,
    value: layer.depth ?? 50,
    disabled: isLocked || isBg,
    oninput: e => {
      const d = parseInt(e.target.value, 10);
      const txt = d <= 33 ? 'Foreground' : d <= 66 ? 'Midground' : 'Background';
      depthLabel.textContent = `${d} (${txt})`;
      onLayerChange({ depth: d });
    }
  });
  form.append(field('Depth (0: Near - 100: Far)', h('div', { class: 'row' }, depthSlider, depthLabel)));

  // Importance
  if (!isBg) {
    const impSelect = h('select', {
      disabled: isLocked,
      onchange: e => onLayerChange({ importance: parseInt(e.target.value, 10) })
    },
      h('option', { value: '1', selected: layer.importance === 1 }, '1 - Secondary detail'),
      h('option', { value: '2', selected: layer.importance === 2 }, '2 - Important element'),
      h('option', { value: '3', selected: layer.importance === 3 }, '3 - Main focus (Hero)')
    );
    form.append(field('Emphasis Order (Prompt Priority)', impSelect));
  }

  // Color
  const colorPicker = h('input', {
    type: 'color',
    value: layer.color || '#6aa0ff',
    disabled: isLocked,
    oninput: e => onLayerChange({ color: e.target.value })
  });
  form.append(field('Block Color (Layout mode)', colorPicker));

  // Type specific controls
  if (layer.type === 'object') {
    const shapeSel = h('select', {
      disabled: isLocked,
      onchange: e => onLayerChange({ shape: e.target.value })
    },
      h('option', { value: 'rect', selected: layer.shape === 'rect' }, 'Rectangle'),
      h('option', { value: 'ellipse', selected: layer.shape === 'ellipse' }, 'Ellipse / Circle'),
      h('option', { value: 'triangle', selected: layer.shape === 'triangle' }, 'Triangle')
    );
    form.append(field('Geometric Shape', shapeSel));

    form.append(field('Material / Texture', h('input', {
      type: 'text',
      placeholder: 'e.g. Rusty metal, gold leaf, matte plastic',
      value: layer.material || '',
      disabled: isLocked,
      oninput: e => onLayerChange({ material: e.target.value })
    })));
  }

  if (layer.type === 'zone') {
    const purposeSel = h('select', {
      disabled: isLocked,
      onchange: e => onLayerChange({ purpose: e.target.value })
    },
      h('option', { value: 'title', selected: layer.purpose === 'title' }, 'For a Large Title'),
      h('option', { value: 'face', selected: layer.purpose === 'face' }, 'For a Face / Character'),
      h('option', { value: 'empty', selected: layer.purpose === 'empty' }, 'Clear negative space')
    );
    form.append(field('Space Purpose', purposeSel));
  }

  if (layer.type === 'subject') {
    // Pose selector
    const poses = [
      ['ayakta', 'Standing'], ['isaret-ediyor-sag', 'Pointing (Right)'], ['isaret-ediyor-sol', 'Pointing (Left)'],
      ['saskin-eller-yuzde', 'Surprised (Hands on Face)'], ['dusunuyor-cene', 'Thinking (Hand on Chin)'], ['kollar-kavusuk', 'Arms Crossed'],
      ['kosuyor', 'Running'], ['oturuyor', 'Sitting'], ['comelmus', 'Crouching'],
      ['sirti-donuk', 'Facing Away'], ['kollar-havada', 'Arms Raised (Victory)'], ['korkmus-geri-cekilen', 'Scared (Recoiling)'],
      ['bir-sey-tutuyor', 'Holding Something'], ['fener-tutuyor', 'Holding a Flashlight'], ['dizustu-bakiyor', 'Kneeling, looking down'], ['yuruyor', 'Walking']
    ];
    const poseSel = h('select', {
      disabled: isLocked,
      onchange: e => onLayerChange({ pose: e.target.value })
    }, poses.map(([v, t]) => h('option', { value: v, selected: layer.pose === v }, t)));
    form.append(field('Pose (Mannequin Skeleton)', poseSel));

    // Expression selector
    const exprs = [
      ['notr', 'Neutral'], ['saskin', 'Surprised'], ['korkmus', 'Scared'],
      ['gulen', 'Smiling / Happy'], ['ciddi', 'Serious / Stern'], ['kizgin', 'Angry'],
      ['supheci', 'Skeptical'], ['uzgun', 'Sad'], ['heyecanli', 'Excited']
    ];
    const exprSel = h('select', {
      disabled: isLocked,
      onchange: e => onLayerChange({ expression: e.target.value })
    }, exprs.map(([v, t]) => h('option', { value: v, selected: layer.expression === v }, t)));
    form.append(field('Facial Expression', exprSel));

    // Crop (Framing)
    const crops = [
      ['full', 'Full Body (Full)'], ['knee', 'Knees Up (Knee)'], ['waist', 'Waist Up (Waist)'],
      ['chest', 'Chest / Shoulders (Chest)'], ['head', 'Head Only (Head/Close-up)']
    ];
    const cropSel = h('select', {
      disabled: isLocked,
      onchange: e => onLayerChange({ crop: e.target.value })
    }, crops.map(([v, t]) => h('option', { value: v, selected: layer.crop === v }, t)));
    form.append(field('Subject Framing (Crop)', cropSel));

    // Flip & Facing
    const facingSel = h('select', {
      disabled: isLocked,
      onchange: e => onLayerChange({ facing: e.target.value })
    },
      h('option', { value: 'camera', selected: layer.facing === 'camera' }, 'Facing Camera'),
      h('option', { value: 'left', selected: layer.facing === 'left' }, 'Looking Left'),
      h('option', { value: 'right', selected: layer.facing === 'right' }, 'Looking Right'),
      h('option', { value: 'away', selected: layer.facing === 'away' }, 'Facing Away')
    );
    const flipCheck = h('label', { class: 'row', style: { gap: '6px', fontSize: '12px', marginTop: '6px' } },
      h('input', {
        type: 'checkbox',
        checked: !!layer.flip,
        disabled: isLocked,
        onchange: e => onLayerChange({ flip: e.target.checked })
      }),
      'Flip Horizontally'
    );
    form.append(field('Direction & Gaze', h('div', {}, facingSel, flipCheck)));
  }

  if (layer.type === 'text') {
    // Content input
    const contentIn = h('textarea', {
      rows: 2,
      value: layer.content || '',
      disabled: isLocked,
      oninput: e => onLayerChange({ content: e.target.value })
    });
    // Quick Turkish chars buttons
    const trBtns = h('div', { class: 'row', style: { gap: '4px', marginTop: '4px' } },
      ['İ', 'Ğ', 'Ü', 'Ş', 'Ö', 'Ç', 'ı'].map(ch => h('button', {
        class: 'ghost',
        style: { padding: '2px 6px', fontSize: '11px' },
        onclick: () => {
          contentIn.value += ch;
          onLayerChange({ content: contentIn.value });
        }
      }, ch))
    );
    form.append(field('Text content', h('div', {}, contentIn, trBtns)));

    // Text preset (font + colours + stroke) and the font itself (common font families; unavailable fonts use the browser fallback)
    const presetSel = h('select', {
      disabled: isLocked,
      onchange: e => {
        const p = TEXT_PRESETS.find(x => x.id === e.target.value); e.target.blur(); if (!p) return;
        onLayerChange({ font: p.font, fill: p.fill, stroke: p.stroke || layer.stroke, strokeW: p.strokeW, shadow: !!p.shadow, uppercase: !!p.uppercase, bg: p.bg || null });
      }
    }, h('option', { value: '' }, 'Apply preset…'), TEXT_PRESETS.map(p => h('option', { value: p.id }, p.name)));
    form.append(field('Text Preset', presetSel));
    const fonts = ['Impact', 'Arial Black', 'Segoe UI', 'Bahnschrift', 'Georgia', 'Cambria', 'Consolas', 'Arial', 'Helvetica Neue', 'DejaVu Sans', 'Liberation Sans', 'sans-serif', 'serif', 'monospace'];
    const family = TEXT_PRESETS.find(p => p.id === layer.font)?.font || layer.font || 'Impact';
    const fontSel = h('select', {
      disabled: isLocked,
      onchange: e => { onLayerChange({ font: e.target.value }); e.target.blur(); }
    }, fonts.map(f => h('option', { value: f, selected: family === f, style: { fontFamily: f } }, f)));
    form.append(field('Font (installed fonts may vary)', fontSel));
    form.append(field('Alignment', h('select', { disabled: isLocked, onchange: e => { onLayerChange({ align: e.target.value }); e.target.blur(); } },
      [['left', 'Left'], ['center', 'Center'], ['right', 'Right']].map(([v, t]) => h('option', { value: v, selected: (layer.align || 'center') === v }, t)))));

    // Size
    const sizeSlider = h('input', {
      type: 'range',
      min: 4,
      max: 30,
      value: Math.round((layer.size ?? 0.12) * 100),
      disabled: isLocked,
      oninput: e => onLayerChange({ size: parseInt(e.target.value, 10) / 100 })
    });
    form.append(field('Text Size (%)', sizeSlider));

    // Colors: Fill, Stroke
    const fillIn = h('input', { type: 'color', value: layer.fill || '#ffffff', oninput: e => onLayerChange({ fill: e.target.value }) });
    const strokeIn = h('input', { type: 'color', value: layer.stroke || '#000000', oninput: e => onLayerChange({ stroke: e.target.value }) });
    form.append(field('Text Color & Outline Color', h('div', { class: 'row', style: { gap: '10px' } },
      h('label', { class: 'row', style: { gap: '4px', fontSize: '11px' } }, fillIn, 'Fill'),
      h('label', { class: 'row', style: { gap: '4px', fontSize: '11px' } }, strokeIn, 'Outline')
    )));

    // Outline Width & Shadow
    const strokeWSlider = h('input', {
      type: 'range',
      min: 0,
      max: 15,
      value: Math.round((layer.strokeW ?? 0.05) * 100),
      oninput: e => onLayerChange({ strokeW: parseInt(e.target.value, 10) / 100 })
    });
    const shadowCheck = h('label', { class: 'row', style: { gap: '6px', fontSize: '12px', marginTop: '6px' } },
      h('input', { type: 'checkbox', checked: layer.shadow !== false, onchange: e => onLayerChange({ shadow: e.target.checked }) }),
      'Drop Shadow'
    );
    const upperCheck = h('label', { class: 'row', style: { gap: '6px', fontSize: '12px', marginTop: '4px' } },
      h('input', { type: 'checkbox', checked: layer.uppercase !== false, onchange: e => onLayerChange({ uppercase: e.target.checked }) }),
      'Convert to Uppercase (UPPERCASE)'
    );
    form.append(field('Outline Width & Effects', h('div', {}, strokeWSlider, shadowCheck, upperCheck)));

    // highlighted words + the box behind the text
    form.append(field('Highlighted words (comma-separated)', h('div', { class: 'row', style: { gap: '6px' } },
      h('input', { type: 'text', style: { flex: 1 }, placeholder: 'e.g. NEVER, SECRET', value: (layer.highlightWords || []).join(', '), disabled: isLocked,
        oninput: e => onLayerChange({ highlightWords: e.target.value.split(',').map(w => w.trim()).filter(Boolean) }) }),
      h('input', { type: 'color', title: 'Highlight color', value: layer.highlight || '#ffd400', oninput: e => onLayerChange({ highlight: e.target.value }) }))));
    form.append(field('Background box', h('div', { class: 'row', style: { gap: '6px' } },
      h('label', { class: 'row', style: { gap: '6px', fontSize: '12px' } }, h('input', { type: 'checkbox', checked: !!layer.bg, onchange: e => onLayerChange({ bg: e.target.checked ? (layer.bg || '#f08a3c') : null }) }), 'Colored box behind text'),
      layer.bg ? h('input', { type: 'color', value: layer.bg, oninput: e => onLayerChange({ bg: e.target.value }) }) : null)));
  }

  if (layer.type === 'effect') {
    const kinds = [
      ['arrow', 'Arrow'], ['circle', 'Highlight Circle'], ['x-mark', 'X Mark'],
      ['check', 'Check Mark (✓)'], ['glow', 'Glow'], ['split', 'Before / After Divider'],
      ['light-rays', 'Light Rays'], ['blur-zone', 'Blur Zone'], ['badge', 'Badge']
    ];
    const kindSel = h('select', {
      disabled: isLocked,
      onchange: e => onLayerChange({ kind: e.target.value })
    }, kinds.map(([v, t]) => h('option', { value: v, selected: layer.kind === v }, t)));
    form.append(field('Highlight / Effect Type', kindSel));

    const strokeIn = h('input', { type: 'color', value: layer.stroke || '#ff2222', oninput: e => onLayerChange({ stroke: e.target.value }) });
    form.append(field('Effect Color', strokeIn));
  }
}

function renderSceneInspector(container, brief, { onBriefChange }) {
  container.append(h('div', { class: 'inspector-header' },
    h('b', { style: { fontSize: '15px' } }, 'Scene & Shot Settings'),
    h('div', { class: 'dim', style: { fontSize: '11.5px' } }, 'Click a layer to open its settings.')
  ));

  const form = h('div', { class: 'inspector-body' });
  container.append(form);
  const cam = brief.camera || {}, light = brief.light || {}, style = brief.style || {}, text = brief.text || {}, safe = brief.safe || {};
  const goal = brief.goal || {};
  const sel = (value, items, onPick) => h('select', { onchange: e => { onPick(e.target.value); e.target.blur(); } },
    items.map(([v, t]) => h('option', { value: v, selected: String(value) === String(v) }, t)));
  const range = (value, min, max, onPick, fmt = v => v + '%') => {
    const out = h('span', { class: 'dim', style: { minWidth: '38px', textAlign: 'right' } }, fmt(value));
    return h('div', { class: 'row' }, h('input', { type: 'range', min, max, value, style: { flex: 1 }, oninput: e => { out.textContent = fmt(+e.target.value); onPick(+e.target.value); } }), out);
  };
  const check = (on, label, onPick) => h('label', { class: 'row', style: { gap: '6px', fontSize: '12.5px' } }, h('input', { type: 'checkbox', checked: !!on, onchange: e => onPick(e.target.checked) }), label);

  // goal
  form.append(h('div', { class: 'inspector-section' },
    h('div', { class: 'section-title' }, 'Goal & Emotion'),
    field('Topic / Event', h('textarea', { rows: 2, placeholder: 'What is the video about? (1-2 sentences)', value: goal.topic || '',
      oninput: e => onBriefChange({ goal: { ...(brief.goal || {}), topic: e.target.value } }) })),
    field('Target emotion', h('input', { type: 'text', placeholder: 'Curiosity, surprise, horror, excitement…', value: goal.feeling || '',
      oninput: e => onBriefChange({ goal: { ...(brief.goal || {}), feeling: e.target.value } }) })),
    field('One main idea', h('input', { type: 'text', placeholder: 'The single idea in the thumbnail (e.g. "a person smaller than an ant")', value: goal.hook || '',
      oninput: e => onBriefChange({ goal: { ...(brief.goal || {}), hook: e.target.value } }) }))
  ));

  // camera
  const setCam = patch => onBriefChange({ camera: { ...(brief.camera || {}), ...patch } });
  form.append(h('div', { class: 'inspector-section' },
    h('div', { class: 'section-title' }, 'Camera & Framing'),
    field('Framing', sel(cam.shot, CAMERA_SHOTS.map(s => [s.id, s.name]), v => setCam({ shot: v }))),
    field('Angle', sel(cam.angle, CAMERA_ANGLES.map(a => [a.id, a.name]), v => {
      const a = CAMERA_ANGLES.find(x => x.id === v);
      setCam({ angle: v, ...(a && a.horizon != null ? { horizon: a.horizon } : {}), ...(v === 'dutch' && !cam.tilt ? { tilt: 15 } : {}), ...(v !== 'dutch' ? { tilt: 0 } : {}) });
    })),
    cam.angle === 'dutch' ? field('Tilt (degrees)', range(Math.round(cam.tilt || 0), -30, 30, v => setCam({ tilt: v }), v => v + '°')) : null,
    field('Lens', sel(cam.lens || 50, LENSES.map(l => [l, `${l} mm · ${l <= 14 ? 'ultra-wide, exaggerated' : l <= 24 ? 'wide, cinematic' : l <= 35 ? 'natural surroundings' : l <= 50 ? 'natural perspective' : l <= 85 ? 'portrait' : 'telephoto, compressed background'}`]), v => setCam({ lens: +v }))),
    field('Depth of field (background blur)', range(Math.round((cam.dof ?? 0.5) * 100), 0, 100, v => setCam({ dof: v / 100 }))),
    field('Focus layer', sel(cam.focusLayer || '', [['', 'Automatic'], ...(brief.layers || []).filter(l => l.type !== 'background' && l.type !== 'trace').map(l => [l.id, l.name || l.id])], v => setCam({ focusLayer: v || null }))),
    field('Horizon', range(Math.round((cam.horizon ?? 0.5) * 100), 0, 100, v => setCam({ horizon: v / 100 }), v => v + '% down')),
    field('Vanishing point (horizontal)', range(Math.round((cam.vanishX ?? 0.5) * 100), 0, 100, v => setCam({ vanishX: v / 100 }), v => v + '%'))
  ));

  // light
  const setLight = patch => onBriefChange({ light: { ...(brief.light || {}), ...patch } });
  form.append(h('div', { class: 'inspector-section' },
    h('div', { class: 'section-title' }, 'Light'),
    h('div', { class: 'dim', style: { fontSize: '11.5px', marginBottom: '6px' } }, 'Drag the ☀ icon on the canvas to change the direction.'),
    field('Light color', sel(light.key || 'warm', LIGHT_KEYS.map(k => [k.id, k.name]), v => setLight({ key: v }))),
    field('Time of day', sel(light.time || 'day', LIGHT_TIMES.map(t => [t.id, t.name]), v => setLight({ time: v }))),
    field('Light elevation', range(Math.round(light.elevation ?? 35), 0, 90, v => setLight({ elevation: v }), v => v + '°')),
    field('Shadow hardness', range(Math.round((light.contrast ?? 0.5) * 100), 0, 100, v => setLight({ contrast: v / 100 }))),
    check(light.rim, 'Rim light from behind', v => setLight({ rim: v })),
    field('Light note', h('input', { type: 'text', placeholder: 'e.g. blue light spilling through a door', value: light.notes || '', oninput: e => setLight({ notes: e.target.value }) }))
  ));

  // style
  const setStyle = patch => onBriefChange({ style: { ...(brief.style || {}), ...patch } });
  const palette = Array.isArray(style.palette) && style.palette.length ? style.palette : [];
  form.append(h('div', { class: 'inspector-section' },
    h('div', { class: 'section-title' }, 'Visual Style'),
    field('Style', sel(style.preset || 'cinematic-photo', STYLE_PRESETS.map(p => [p.id, p.name]), v => {
      const p = STYLE_PRESETS.find(x => x.id === v);
      setStyle({ preset: v, ...(p?.defaultPalette && !palette.length ? { palette: p.defaultPalette } : {}) });
    })),
    field('Additional style description', h('input', { type: 'text', placeholder: 'e.g. foggy, vintage photo grain', value: style.custom || '', oninput: e => setStyle({ custom: e.target.value }) })),
    field('Mood', sel(style.mood || '', [['', '—'], ...MOODS.map(m => [m, MOOD_TR[m] || m])], v => setStyle({ mood: v }))),
    field('Color palette (dominant → accent)', h('div', { class: 'row', style: { gap: '6px' } },
      [0, 1, 2].map(i => h('input', { type: 'color', value: palette[i] || ['#1b2a3a', '#f08a3c', '#ffe9b0'][i], title: ['Dominant', 'Accent', 'Light'][i],
        onchange: e => { const p = [...(palette.length ? palette : ['#1b2a3a', '#f08a3c', '#ffe9b0'])]; p[i] = e.target.value; setStyle({ palette: p }); } })),
      palette.length ? h('button', { class: 'ghost', title: 'Remove palette from prompt', onclick: () => setStyle({ palette: [] }) }, '✕') : h('span', { class: 'dim', style: { fontSize: '11px' } }, '(not included in prompt)')))
  ));

  // text policy, negatives, guides
  form.append(h('div', { class: 'inspector-section' },
    h('div', { class: 'section-title' }, 'Text & Exclusions'),
    field('Text policy', sel(text.policy || 'overlay', [['overlay', 'Add text as an overlay later (recommended)'], ['ai', 'Generate text with AI (Turkish letters may be incorrect)']], v => onBriefChange({ text: { ...text, policy: v } }))),
    check(text.reserve !== false, 'Keep text area clear (negative space)', v => onBriefChange({ text: { ...text, reserve: v } })),
    field('Exclusions', h('input', { type: 'text', placeholder: 'e.g. busy background, blurry face, watermark', value: brief.negative || '', oninput: e => onBriefChange({ negative: e.target.value }) }))
  ));
  form.append(h('div', { class: 'inspector-section' },
    h('div', { class: 'section-title' }, 'Guides'),
    check(safe.thirds !== false, 'Rule of thirds lines', v => onBriefChange({ safe: { ...safe, thirds: v } })),
    brief.format !== '9:16' ? check(safe.badge !== false, 'Duration badge area (bottom right)', v => onBriefChange({ safe: { ...safe, badge: v } })) : null,
    brief.format === '9:16' ? check(safe.shortsUi, 'Shorts UI areas', v => onBriefChange({ safe: { ...safe, shortsUi: v } })) : null
  ));
}
const MOOD_TR = { mysterious: 'Mysterious', epic: 'Epic', scary: 'Scary', funny: 'Funny', peaceful: 'Peaceful', dramatic: 'Dramatic', intense: 'Intense', nostalgic: 'Nostalgic', curious: 'Intriguing', exciting: 'Exciting' };

function field(label, inputNode) {
  return h('div', { class: 'inspector-field' },
    h('div', { class: 'field-label' }, label),
    inputNode
  );
}

function numInput(val, min, max, step, disabled, onChange) {
  return h('input', {
    type: 'number',
    value: val,
    min,
    max,
    step,
    disabled,
    oninput: e => {
      const v = parseFloat(e.target.value);
      if (!isNaN(v)) onChange(v);
    }
  });
}
