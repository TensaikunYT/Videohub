// Reference Image Management Panel (#/thumbstudio/<pid>/<tid> -> References)
import { h, api, toast, confirmBox } from '../app.js';

export function openReferencesModal(pid, tid, brief, { onUpdated }) {
  const modalBg = h('div', { class: 'modal-bg' });
  const modal = h('div', { class: 'modal', style: { maxWidth: '750px', width: '90%' } });
  modalBg.append(modal);

  const title = h('h1', {}, 'Reference Images');
  const closeBtn = h('button', { class: 'ghost', onclick: () => modalBg.remove() }, '✕');
  modal.append(h('div', { class: 'row' }, title, h('span', { class: 'spacer' }), closeBtn));

  const content = h('div', { style: { display: 'flex', flexDirection: 'column', gap: '16px', margin: '14px 0' } });
  modal.append(content);

  // Upload area
  const fileInput = h('input', { type: 'file', accept: 'image/png, image/jpeg, image/webp', style: { display: 'none' } });
  const dropZone = h('div', {
    class: 'ref-drop-zone',
    style: {
      border: '2px dashed var(--border)',
      borderRadius: 'var(--r)',
      padding: '24px',
      textAlign: 'center',
      cursor: 'pointer',
      background: 'var(--card)'
    },
    onclick: () => fileInput.click()
  },
    h('div', { style: { fontSize: '24px', marginBottom: '6px' } }, '📷'),
    h('b', {}, 'Upload an image or drag it here'),
    h('div', { class: 'dim', style: { fontSize: '12px', marginTop: '4px' } }, 'PNG, JPG or WebP (paste from the clipboard with Ctrl+V)')
  );
  content.append(dropZone, fileInput);

  fileInput.onchange = e => {
    const file = e.target.files[0];
    if (file) handleUpload(file);
  };

  dropZone.ondragover = e => { e.preventDefault(); dropZone.style.borderColor = 'var(--accent)'; };
  dropZone.ondragleave = () => { dropZone.style.borderColor = 'var(--border)'; };
  dropZone.ondrop = e => {
    e.preventDefault();
    dropZone.style.borderColor = 'var(--border)';
    const file = e.dataTransfer.files[0];
    if (file) handleUpload(file);
  };

  // References list container
  const refsList = h('div', { style: { display: 'flex', flexDirection: 'column', gap: '12px', maxHeight: '400px', overflowY: 'auto' } });
  content.append(refsList);

  function renderList() {
    refsList.innerHTML = '';
    const refs = brief.refs || [];
    if (!refs.length) {
      refsList.append(h('div', { class: 'dim', style: { textAlign: 'center', padding: '16px' } }, 'No reference images yet.'));
      return;
    }

    for (const ref of refs) {
      const card = h('div', {
        class: 'row',
        style: {
          background: 'var(--card)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--r)',
          padding: '10px 12px',
          gap: '14px',
          alignItems: 'flex-start'
        }
      },
        h('img', {
          src: `/api/thumbstudio/${pid}/${tid}/file?f=${encodeURIComponent(ref.file)}`,
          style: { width: '80px', height: '80px', objectFit: 'cover', borderRadius: '4px', background: '#000' }
        }),
        h('div', { style: { flex: 1, display: 'flex', flexDirection: 'column', gap: '8px' } },
          h('div', { class: 'row', style: { gap: '8px' } },
            h('b', { class: 'mono' }, ref.id),
            h('select', {
              style: { fontSize: '12px' },
              onchange: async e => {
                ref.role = e.target.value;
                await api(`/api/thumbstudio/${pid}/${tid}`, { method: 'PUT', body: { refs } });
                onUpdated && onUpdated(brief);
              }
            },
              h('option', { value: 'style', selected: ref.role === 'style' }, 'Role: Style'),
              h('option', { value: 'character', selected: ref.role === 'character' }, 'Role: Character'),
              h('option', { value: 'object', selected: ref.role === 'object' }, 'Role: Object'),
              h('option', { value: 'composition', selected: ref.role === 'composition' }, 'Role: Composition'),
              h('option', { value: 'background', selected: ref.role === 'background' }, 'Role: Background')
            ),
            h('select', {
              style: { fontSize: '12px' },
              onchange: async e => {
                ref.layer = e.target.value || null;
                await api(`/api/thumbstudio/${pid}/${tid}`, { method: 'PUT', body: { refs } });
                onUpdated && onUpdated(brief);
              }
            },
              h('option', { value: '' }, 'Linked Layer: (None)'),
              (brief.layers || []).map(l => h('option', { value: l.id, selected: ref.layer === l.id }, l.name + ' (' + l.id + ')'))
            ),
            h('span', { class: 'spacer' }),
            h('button', {
              class: 'ghost',
              style: { color: 'var(--red)', fontSize: '13px' },
              title: 'Remove',
              onclick: async () => {
                const ok = await confirmBox('Remove Reference', h('p', {}, `Delete reference "${ref.id}"?`));
                if (!ok) return;
                brief.refs = refs.filter(r => r.id !== ref.id);
                await api(`/api/thumbstudio/${pid}/${tid}`, { method: 'PUT', body: { refs: brief.refs } });
                renderList();
                onUpdated && onUpdated(brief);
              }
            }, '🗑')
          ),
          h('input', {
            type: 'text',
            placeholder: 'Add a note (e.g. use the colors and background lighting from this image)',
            value: ref.note || '',
            style: { width: '100%', fontSize: '12px' },
            onchange: async e => {
              ref.note = e.target.value;
              await api(`/api/thumbstudio/${pid}/${tid}`, { method: 'PUT', body: { refs } });
              onUpdated && onUpdated(brief);
            }
          })
        )
      );
      refsList.append(card);
    }
  }

  async function handleUpload(file) {
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const res = await api(`/api/thumbstudio/${pid}/${tid}/ref`, {
          method: 'POST',
          body: {
            name: file.name,
            data: reader.result,
            role: 'style'
          }
        });
        toast('Reference image uploaded');
        brief.refs = res.brief.refs;
        renderList();
        onUpdated && onUpdated(brief);
      } catch (err) {
        toast('Upload failed: ' + err.message, true);
      }
    };
    reader.readAsDataURL(file);
  }

  renderList();
  document.body.append(modalBg);
}
