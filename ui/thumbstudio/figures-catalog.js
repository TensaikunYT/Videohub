// Pose & Expression Visual Inspection Catalog (#/thumbstudio/_/catalog)
import { h } from '../app.js';
import { FIGURE_POSES, drawFigure } from './figures.js';
import { POSES, EXPRESSIONS } from './catalog.js';

export function renderCatalogPage(page) {
  const container = h('div', { class: 'thumbstudio-page', style: { paddingBottom: '60px' } });
  page.append(container);

  // Header
  const header = h('div', { class: 'thumbstudio-header row' },
    h('h1', {}, 'Pose and Expression Catalog (Visual Check)'),
    h('span', { class: 'spacer' }),
    h('button', { onclick: () => { location.hash = '#/thumbstudio'; } }, '← Back to list')
  );
  container.append(header);

  // 1. Poses Grid
  container.append(h('h2', { style: { marginTop: '20px' } }, `All Poses (${Object.keys(FIGURE_POSES).length})`));
  const poseGrid = h('div', {
    style: {
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
      gap: '16px',
      marginTop: '10px'
    }
  });
  container.append(poseGrid);

  for (const p of POSES) {
    const card = h('div', {
      class: 'panel',
      style: {
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        padding: '12px',
        gap: '8px'
      }
    });

    const canvas = document.createElement('canvas');
    canvas.width = 180;
    canvas.height = 240;
    canvas.style.width = '100%';
    canvas.style.aspectRatio = '3 / 4';
    canvas.style.background = '#12141a';
    canvas.style.borderRadius = '6px';
    const ctx = canvas.getContext('2d');

    const fakeLayer = {
      type: 'subject',
      name: p.name,
      pose: p.id,
      expression: 'notr',
      crop: 'full',
      color: '#6aa0ff'
    };
    drawFigure(ctx, fakeLayer, 10, 10, 160, 220);

    card.append(canvas, h('b', { style: { fontSize: '13px', textAlign: 'center' } }, p.name));
    poseGrid.append(card);
  }

  // 2. Expressions Grid
  container.append(h('h2', { style: { marginTop: '32px' } }, `Facial Expressions (${EXPRESSIONS.length})`));
  const exprGrid = h('div', {
    style: {
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))',
      gap: '14px',
      marginTop: '10px'
    }
  });
  container.append(exprGrid);

  for (const exp of EXPRESSIONS) {
    const card = h('div', {
      class: 'panel',
      style: {
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        padding: '10px',
        gap: '6px'
      }
    });

    const canvas = document.createElement('canvas');
    canvas.width = 140;
    canvas.height = 140;
    canvas.style.width = '100%';
    canvas.style.aspectRatio = '1 / 1';
    canvas.style.background = '#12141a';
    canvas.style.borderRadius = '6px';
    const ctx = canvas.getContext('2d');

    const fakeLayer = {
      type: 'subject',
      name: exp.name,
      pose: 'ayakta',
      expression: exp.id,
      crop: 'head',
      color: '#f08a3c'
    };
    drawFigure(ctx, fakeLayer, 10, 10, 120, 120);

    card.append(canvas, h('b', { style: { fontSize: '12px' } }, exp.name));
    exprGrid.append(card);
  }

  // 3. Turkish Typography & Font Test
  container.append(h('h2', { style: { marginTop: '32px' } }, 'Special characters & font check (İĞÜŞÖÇı)'));
  const typoBox = h('div', { class: 'panel', style: { padding: '20px', display: 'flex', flexDirection: 'column', gap: '16px' } });
  container.append(typoBox);

  const sampleFonts = ['Impact', 'Arial Black', 'Segoe UI', 'Bahnschrift', 'Georgia', 'Cambria', 'Consolas'];
  for (const font of sampleFonts) {
    const canvas = document.createElement('canvas');
    canvas.width = 900;
    canvas.height = 65;
    canvas.style.width = '100%';
    canvas.style.maxHeight = '65px';
    canvas.style.background = '#181b24';
    canvas.style.borderRadius = '4px';

    const ctx = canvas.getContext('2d');
    ctx.font = `bold 36px "${font}", sans-serif`;
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = '#f08a3c';
    ctx.lineWidth = 3;
    ctx.shadowColor = 'rgba(0,0,0,0.8)';
    ctx.shadowBlur = 6;
    ctx.shadowOffsetX = 3;
    ctx.shadowOffsetY = 3;

    const testText = `${font}: İĞÜŞÖÇı - How Is This Possible?`;
    ctx.strokeText(testText, 20, 44);
    ctx.fillText(testText, 20, 44);

    typoBox.append(canvas);
  }
}
