import { trashName } from '../system.js';
// VideoHub · Thumbnail Studio Home / List Page (#/thumbstudio)
import { h, api, toast, confirmBox, pill, AGO, onHubEvent } from '../app.js';
import { openTemplatePickerModal, openTemplateSlotsModal, renderTemplateCard } from './templates.js';

export async function thumbnailStudioPage(page, ...args) {
  // If editing an existing thumbnail: #/thumbstudio/<pid>/<tid>
  if (args.length >= 2) {
    const [pid, tid] = args;

    // Visual Pose & Expression Catalog Inspection: #/thumbstudio/_/catalog
    if (pid === '_' && tid === 'catalog') {
      const { renderCatalogPage } = await import('./figures-catalog.js');
      return renderCatalogPage(page);
    }

    const { renderEditor } = await import('./editor.js');
    return renderEditor(page, pid, tid);
  }

  // State
  const state = {
    q: '',
    project: '',
    status: '',
    format: '',
  };

  const container = h('div', { class: 'thumbstudio-page' });
  page.append(container);

  // Load project list and thumbnail list
  const [projectsRes, thumbsRes] = await Promise.all([
    api('/api/projects').catch(() => ({ projects: [] })),
    api('/api/thumbstudio/list').catch(() => []),
  ]);

  const projects = projectsRes.projects || [];
  let thumbnails = Array.isArray(thumbsRes) ? thumbsRes : [];

  // Header
  const header = h('div', { class: 'thumbstudio-header row' },
    h('h1', {}, 'Thumbnail Studio'),
    h('span', { class: 'spacer' }),
    h('button', { class: 'ghost', onclick: () => openTemplatePickerModal({ onApplyTemplate: (tpl, slots) => createFromTemplate(tpl, slots) }) }, '📐 Template gallery'),
    h('button', { class: 'primary', onclick: () => openNewDialog() }, '+ New thumbnail')
  );
  container.append(header);

  // Filters
  const sel = (key, opts) => h('select', {
    onchange: e => { state[key] = e.target.value; drawCards(); }
  }, opts.map(([v, t]) => h('option', { value: v, selected: state[key] === v }, t)));

  const projectOpts = [
    ['', 'All projects'],
    ['_', 'General (no project)'],
    ...projects.map(p => [p.id, p.title || p.name])
  ];

  const statusOpts = [
    ['', 'All statuses'],
    ['draft', 'Draft'],
    ['generating', 'Generating'],
    ['chosen', 'Chosen'],
    ['final', 'Final']
  ];

  const formatOpts = [
    ['', 'All formats'],
    ['16:9', 'YouTube 16:9'],
    ['9:16', 'Shorts 9:16']
  ];

  const filters = h('div', { class: 'filters row' },
    h('input', {
      type: 'search',
      placeholder: 'Search thumbnails…',
      value: state.q,
      oninput: e => { state.q = e.target.value; drawCards(); }
    }),
    sel('project', projectOpts),
    sel('status', statusOpts),
    sel('format', formatOpts),
  );
  container.append(filters);

  // Grid
  const grid = h('div', { class: 'thumbstudio-grid' });
  container.append(grid);

  // Templates section
  const tplGrid = h('div', { class: 'template-gallery-grid' });
  const tplSummary = h('div', { class: 'dim', style: { fontSize: '13px', marginTop: '2px' } }, 'Loading templates…');
  const tplSection = h('div', { style: { marginTop: '36px' } },
    h('div', { class: 'row', style: { justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' } },
      h('div', {},
        h('h2', { style: { margin: 0 } }, '📐 Ready-made templates'),
        tplSummary
      ),
      h('button', {
        class: 'primary small',
        onclick: () => openTemplatePickerModal({ collection: 'reference-picks', onApplyTemplate: (tpl, slots) => createFromTemplate(tpl, slots) })
      }, 'New · 15 reference templates'),
      h('button', {
        class: 'ghost small',
        onclick: () => openTemplatePickerModal({
          onApplyTemplate: (tpl, slots) => createFromTemplate(tpl, slots)
        })
      }, 'View all')
    ),
    tplGrid
  );
  container.append(tplSection);

  function drawCards() {
    grid.innerHTML = '';
    const q = state.q.trim().toLocaleLowerCase('en-US');
    const filtered = thumbnails.filter(t => {
      if (q && !t.title.toLocaleLowerCase('en-US').includes(q)) return false;
      if (state.project && t.pid !== state.project) return false;
      if (state.status && t.status !== state.status) return false;
      if (state.format && t.format !== state.format) return false;
      return true;
    });

    if (!filtered.length) {
      grid.append(h('div', { class: 'panel', style: { gridColumn: '1 / -1', padding: '32px', textAlign: 'center', color: 'var(--muted)' } },
        'No matching thumbnails found.'
      ));
      return;
    }

    for (const t of filtered) {
      grid.append(renderCard(t));
    }
  }

  function renderCard(t) {
    const is916 = t.format === '9:16';
    const preview = h('div', { class: 'preview-box' + (is916 ? ' ratio-916' : '') });

    // the final, else the chosen (or newest) variant, else the layout
    const cover = t.cover || (t.hasFinal ? 'final.jpg' : t.hasLayout ? 'layout.png' : null);
    if (cover && cover !== 'layout.png') {
      preview.style.backgroundImage = `url('/api/thumbstudio/${t.pid}/${t.id}/file?f=${encodeURIComponent(cover)}&v=${encodeURIComponent(t.updated || '')}')`;
      preview.style.backgroundSize = 'cover';
      preview.style.backgroundPosition = 'center';
    } else if (cover) {
      preview.style.backgroundImage = `url('/api/thumbstudio/${t.pid}/${t.id}/file?f=layout.png&v=${encodeURIComponent(t.updated || '')}')`;
      preview.style.backgroundSize = 'contain';
      preview.style.backgroundRepeat = 'no-repeat';
      preview.style.backgroundPosition = 'center';
    } else {
      preview.append(h('span', { class: 'dim', style: { fontSize: '13px' } }, is916 ? '9:16 Draft' : '16:9 Draft'));
    }

    const card = h('div', { class: 'thumbstudio-card', onclick: () => { location.hash = `#/thumbstudio/${t.pid}/${t.id}`; } },
      preview,
      h('div', { class: 'card-info' },
        h('div', { class: 'card-title', title: t.title }, t.title || 'Untitled'),
        h('div', { class: 'card-meta' },
          pill(t.status || 'draft', t.status || 'draft'),
          pill('fam', t.format || '16:9'),
          h('span', { class: 'spacer' }),
          h('span', { class: 'dim' }, AGO(t.updated || t.created))
        ),
        h('div', { class: 'card-meta', style: { marginTop: '4px' } },
          h('span', { class: 'ellip', style: { maxWidth: '160px' }, title: t.projectTitle }, t.projectTitle || 'Global'),
          h('span', { class: 'spacer' }),
          t.variantCount ? h('span', { class: 'muted' }, `${t.variantCount} variants`) : null,
          h('button', {
            class: 'ghost',
            title: 'Copy / Duplicate',
            style: { padding: '2px 6px', fontSize: '12px' },
            onclick: async e => {
              e.stopPropagation();
              try {
                const res = await api(`/api/thumbstudio/${t.pid}/${t.id}/duplicate`, { method: 'POST' });
                toast('Copy created');
                refreshList();
              } catch (err) {
                toast(err.message, true);
              }
            }
          }, '⧉'),
          h('button', {
            class: 'ghost',
            title: `Move to ${trashName()}`,
            style: { padding: '2px 6px', fontSize: '12px', color: 'var(--red)' },
            onclick: async e => {
              e.stopPropagation();
              const ok = await confirmBox(`Delete "${t.title}"?`, h('p', {}, `The thumbnail folder will be moved to the ${trashName()}.`));
              if (!ok) return;
              try {
                await api(`/api/thumbstudio/${t.pid}/${t.id}/delete`, { method: 'POST' });
                toast(`Moved to ${trashName()}`);
                refreshList();
              } catch (err) {
                toast(err.message, true);
              }
            }
          }, '🗑')
        )
      )
    );
    return card;
  }

  async function refreshList() {
    try {
      thumbnails = await api('/api/thumbstudio/list');
      drawCards();
    } catch { }
  }

  let allTemplates = [];
  async function loadTemplates() {
    try {
      allTemplates = await api('/api/thumbstudio/templates');
      if (!container.isConnected) return;
      const valid = allTemplates.filter(t => !t.error);
      const builtinCount = valid.filter(t => t.builtin).length;
      const userCount = valid.length - builtinCount;
      tplSummary.textContent = `${builtinCount} built-in${userCount ? ` + ${userCount} user templates` : ' templates'} · start by changing the title and topic`;
      allTemplates.sort((a, b) => Number(!!b.tags?.includes('reference-picks')) - Number(!!a.tags?.includes('reference-picks')));
      tplGrid.innerHTML = '';
      for (const tpl of allTemplates) {
        tplGrid.append(renderTemplateCard(tpl, {
          onApply: selected => {
            openTemplateSlotsModal(selected, {
              onConfirm: slots => createFromTemplate(selected, slots)
            });
          }
        }));
      }
    } catch { }
  }

  async function createFromTemplate(tpl, slots) {
    const title = slots.TITLE || tpl.name || 'New Thumbnail';
    try {
      const res = await api('/api/thumbstudio/new', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title,
          format: tpl.format || '16:9',
          project: state.project || '_',
          template: tpl.id,
          slots,
        })
      });
      toast(`Thumbnail created from the "${tpl.name}" template.`);
      location.hash = `#/thumbstudio/${res.pid}/${res.tid}`;
    } catch (err) {
      toast('Could not create: ' + err.message, true);
    }
  }

  drawCards();
  loadTemplates();

  // Listen to SSE updates
  const unsubs = [
    onHubEvent('thumbstudio', ev => {
      if (ev?.type === 'templates-changed') loadTemplates();
      else if (!['gen-progress', 'gen-queued', 'gen-start', 'note'].includes(ev?.type)) refreshList();
    })
  ];

  // Modal dialog for "+ New thumbnail"
  function openNewDialog() {
    let chosenFormat = '16:9';
    let chosenPid = '_';
    let chosenTemplate = '';
    let titleInput;

    const modalBody = h('div', { style: { display: 'flex', flexDirection: 'column', gap: '14px', margin: '12px 0' } },
      h('label', {},
        h('div', { style: { fontWeight: 600, marginBottom: '4px' } }, 'Title:'),
        titleInput = h('input', { type: 'text', placeholder: 'e.g. The Secret Chamber Beneath the Pyramids', style: { width: '100%' } })
      ),
      h('label', {},
        h('div', { style: { fontWeight: 600, marginBottom: '4px' } }, 'Template (optional):'),
        h('select', {
          style: { width: '100%' },
          onchange: e => {
            chosenTemplate = e.target.value;
            const t = allTemplates.find(x => x.id === chosenTemplate);
            if (t && t.format) {
              chosenFormat = t.format;
              const r = modalBody.querySelector(`input[name="thumb_format"][value="${t.format}"]`);
              if (r) r.checked = true;
            }
          }
        },
          h('option', { value: '' }, 'Blank canvas (no template)'),
          allTemplates.filter(t => !t.error).map(t => h('option', { value: t.id }, `${t.name} (${t.format || '16:9'})`))
        )
      ),
      h('label', {},
        h('div', { style: { fontWeight: 600, marginBottom: '4px' } }, 'Format:'),
        h('div', { class: 'row', style: { gap: '12px' } },
          h('label', { class: 'row', style: { gap: '6px', cursor: 'pointer' } },
            h('input', { type: 'radio', name: 'thumb_format', value: '16:9', checked: true, onchange: () => { chosenFormat = '16:9'; } }),
            h('span', {}, 'YouTube 16:9 (1280×720)')
          ),
          h('label', { class: 'row', style: { gap: '6px', cursor: 'pointer' } },
            h('input', { type: 'radio', name: 'thumb_format', value: '9:16', onchange: () => { chosenFormat = '9:16'; } }),
            h('span', {}, 'Shorts 9:16 (1080×1920)')
          )
        )
      ),
      h('label', {},
        h('div', { style: { fontWeight: 600, marginBottom: '4px' } }, 'Project:'),
        h('select', {
          style: { width: '100%' },
          onchange: e => { chosenPid = e.target.value; }
        },
          h('option', { value: '_' }, 'General (no project / global)'),
          projects.map(p => h('option', { value: p.id }, p.title || p.name))
        )
      )
    );

    confirmBox('Create New Thumbnail', modalBody, 'Create').then(async ok => {
      if (!ok) return;
      const title = titleInput.value.trim() || 'New Thumbnail';
      try {
        const payload = {
          title,
          format: chosenFormat,
          project: chosenPid === '_' ? null : chosenPid,
        };
        if (chosenTemplate) {
          payload.template = chosenTemplate;
        }
        const res = await api('/api/thumbstudio/new', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        toast('Thumbnail created');
        location.hash = `#/thumbstudio/${res.pid}/${res.tid}`;
      } catch (err) {
        toast('Could not create: ' + err.message, true);
      }
    });

    setTimeout(() => titleInput.focus(), 50);
  }

  return () => {
    for (const u of unsubs) u();
  };
}
