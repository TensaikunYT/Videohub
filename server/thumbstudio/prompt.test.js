import test from 'node:test';
import assert from 'node:assert/strict';
import { generatePrompt, describeSpatial, describeDepth } from './prompt.js';

test('describeSpatial: correctly maps coordinates to 3x3 grid and size categories', () => {
  // Top-left small element touching frame edge
  const s1 = describeSpatial({ x: 0.01, y: 0.01, w: 0.1, h: 0.1 });
  assert.equal(s1.locStr, 'left third, top');
  assert.equal(s1.sizeStr, 'small');
  assert.equal(s1.cropped, true);

  // Center large element well within boundaries
  const s2 = describeSpatial({ x: 0.25, y: 0.25, w: 0.5, h: 0.6 });
  assert.equal(s2.locStr, 'center of the frame');
  assert.equal(s2.sizeStr, 'large');
  assert.equal(s2.cropped, false);

  // Dominant element filling frame
  const s3 = describeSpatial({ x: 0.0, y: 0.0, w: 1.0, h: 1.0 });
  assert.equal(s3.sizeStr, 'dominant, fills most of the frame');
  assert.equal(s3.cropped, true);
});

test('describeDepth: maps 0..100 depth scale to plans', () => {
  assert.equal(describeDepth(10), 'foreground');
  assert.equal(describeDepth(30), 'foreground');
  assert.equal(describeDepth(50), 'midground');
  assert.equal(describeDepth(80), 'background');
});

test('generatePrompt: overlay policy adds "No text" and reserves negative space', () => {
  const brief = {
    title: 'Pyramid Test',
    camera: { shot: 'close', angle: 'eye', lens: 50 },
    style: { preset: 'cinematic-photo' },
    text: { policy: 'overlay', reserve: true },
    layers: [
      { type: 'text', name: 'Title', content: 'SECRET ROOM', x: 0.05, y: 0.05, w: 0.4, h: 0.2, depth: 0 },
      { type: 'subject', name: 'Explorer', desc: 'young explorer', x: 0.6, y: 0.2, w: 0.35, h: 0.7, depth: 15, importance: 3 }
    ]
  };

  const { prompt } = generatePrompt(brief);
  assert.ok(prompt.includes('No text'), 'Prompt must specify No text in overlay mode');
  assert.ok(prompt.includes('no letters'), 'Prompt must specify no letters');
  assert.ok(prompt.includes('negative space'), 'Prompt must request negative space reservation for text layer');
});

test('generatePrompt: references ordering ensures layout.png is first', () => {
  const brief = {
    camera: { shot: 'medium', angle: 'low', lens: 35 },
    refs: [
      { file: 'refs/style.png', role: 'style' },
      { file: 'refs/hero.png', role: 'character' },
      { file: 'refs/item.png', role: 'object' },
    ]
  };

  const { refsOrdered, prompt } = generatePrompt(brief);
  assert.equal(refsOrdered[0], 'layout.png', 'layout.png must be the first reference');
  assert.equal(refsOrdered[1], 'refs/hero.png', 'character reference should come before object and style');
  assert.equal(refsOrdered[2], 'refs/item.png');
  assert.equal(refsOrdered[3], 'refs/style.png');

  assert.ok(prompt.startsWith('The first reference image is a rough blocking sketch'));
});

test('generatePrompt: produces concise prompt within length limit', () => {
  const brief = {
    title: 'Epic Temple Discovery',
    goal: { oneLiner: 'Discovering a mysterious ancient temple', avoid: 'bulanık, çirkin, yazı' },
    camera: { shot: 'wide', angle: 'worms-eye', lens: 24, dof: 0.7 },
    light: { key: 'warm', time: 'golden-hour', rim: true, contrast: 0.8 },
    style: { preset: 'cinematic-photo', palette: ['#1b2a3a', '#f08a3c'] },
    text: { policy: 'overlay', reserve: true },
    layers: [
      { type: 'background', desc: 'misty mountains and sky', depth: 100 },
      { type: 'object', desc: 'massive ancient temple door', importance: 3, depth: 80, x: 0.1, y: 0.1, w: 0.8, h: 0.8 },
      { type: 'subject', desc: 'researcher', expression: 'saskin', importance: 2, depth: 20, x: 0.45, y: 0.6, w: 0.15, h: 0.35 },
      { type: 'text', content: 'NOBODY KNEW', x: 0.05, y: 0.05, w: 0.9, h: 0.2, depth: 0 }
    ]
  };

  const { prompt, summaryTr } = generatePrompt(brief);
  assert.ok(prompt.length < 1300, `Prompt length (${prompt.length}) should stay under 1300 characters`);
  assert.ok(prompt.includes('Avoid: blurry, out of focus'), 'Negative avoid terms should be mapped to English');
  assert.ok(summaryTr.includes('Epic Temple Discovery'), 'Summary must include title');
  assert.ok(summaryTr.includes('massive ancient temple door'), 'Summary must include layers');
});

test('generatePrompt: promptOverride is honored unless ignored', () => {
  const custom = 'My custom prompt override for Claude';
  const brief = { promptOverride: custom };

  const res1 = generatePrompt(brief);
  assert.equal(res1.prompt, custom);
  assert.equal(res1.isOverride, true);

  const res2 = generatePrompt(brief, { ignoreOverride: true });
  assert.notEqual(res2.prompt, custom);
  assert.equal(res2.isOverride, false);
});

test('generatePrompt: effect kinds, negative field, zones and reference sentences', () => {
  const brief = {
    negative: 'kalabalık arka plan, filigran, purple',
    refs: [{ id: 'R1', file: 'refs/adam.png', role: 'character', layer: 'L1' }],
    layers: [
      { id: 'L1', type: 'subject', desc: 'elderly explorer', x: 0.6, y: 0.1, w: 0.3, h: 0.85, depth: 10, importance: 3, facing: 'away' },
      { id: 'L2', type: 'effect', kind: 'light-rays', x: 0.1, y: 0.0, w: 0.3, h: 0.4, depth: 80 },
      { id: 'L3', type: 'zone', purpose: 'empty', x: 0.0, y: 0.7, w: 0.3, h: 0.3, depth: 0 },
    ],
  };
  const { prompt } = generatePrompt(brief);
  assert.ok(prompt.includes('Light rays beaming'), 'effect kind must be read from kind');
  assert.ok(prompt.includes('Avoid: cluttered background, watermark, purple'), prompt);
  assert.ok(prompt.includes('Reference 2 is the character reference'), 'reference sentence');
  assert.ok(prompt.includes('facing away'), 'facing');
  assert.ok(prompt.includes('area empty and plain'), 'zone becomes empty space');
  assert.ok(prompt.includes('(main focus)'));
});

test('generatePrompt: hard length cap keeps the protected sentences', () => {
  const layers = [];
  for (let i = 0; i < 40; i++) layers.push({ id: 'L' + i, type: 'object', desc: 'a very detailed long object description number ' + i, x: (i % 5) / 5, y: 0.3, w: 0.15, h: 0.2, depth: i * 2 });
  layers.push({ id: 'T', type: 'text', content: 'TITLE', x: 0.05, y: 0.05, w: 0.4, h: 0.2, depth: 0 });
  const { prompt } = generatePrompt({ layers, negative: 'bulanık', text: { policy: 'overlay', reserve: true } });
  assert.ok(prompt.length <= 1200, String(prompt.length));
  assert.ok(prompt.startsWith('The first reference image'));
  assert.ok(prompt.includes('No text'));
  assert.ok(prompt.includes('Avoid: blurry'));
});

test('generatePrompt: summary is English and lists layers front to back', () => {
  const { summaryTr } = generatePrompt({ title: 'Scale', goal: { topic: 'Pyramid', hook: 'huge' }, layers: [
    { type: 'background', desc: 'desert', depth: 100 }, { type: 'subject', name: 'Person', desc: 'tiny person', x: 0.45, y: 0.6, w: 0.05, h: 0.2, depth: 20 }] });
  assert.ok(summaryTr.indexOf('tiny person') < summaryTr.indexOf('desert'));
  assert.ok(summaryTr.includes('**Main idea:** huge'));
});
