// Files written by older (Turkish) versions are read with English values (server/legacy.js, ui/values.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { readNotes, readMeta, noteStatus, noteKind, projectStatus, thumbStatus, thumbNoteStatus, byWho, isOpenNote, NOTE_STATUSES, PROJECT_STATUSES } from './legacy.js';
import { normalizeBrief } from './thumbstudio/schema.js';

const dir = path.resolve('.test-tmp', 'legacy-' + process.pid);
fs.mkdirSync(dir, { recursive: true });
const tr = s => JSON.parse(`"${s}"`);   // keeps this file free of Turkish letters: 'ç' etc.

test('legacy note statuses, kinds and authors map to English', () => {
  assert.equal(noteStatus(tr('a\\u00e7\\u0131k')), 'open');
  assert.equal(noteStatus(tr('d\\u00fczeltildi')), 'fixed');
  assert.equal(noteStatus(tr('onayland\\u0131')), 'approved');
  assert.equal(noteStatus(tr('h\\u00e2l\\u00e2 var')), 'reopened');
  assert.equal(noteStatus('claude'), 'claude');
  assert.equal(noteKind(tr('g\\u00f6rsel')), 'visual');
  assert.equal(noteKind('zamanlama'), 'timing');
  assert.equal(noteKind('ses'), 'sound');
  assert.equal(byWho(tr('kullan\\u0131c\\u0131')), 'user');
  for (const s of NOTE_STATUSES) assert.equal(noteStatus(s), s);   // English values stay as they are
  assert.equal(noteStatus('something-else'), 'something-else');      // unknown values are not touched
});

test('legacy project and thumbnail statuses map to English', () => {
  assert.equal(projectStatus(tr('yap\\u0131m')), 'in-progress');
  assert.equal(projectStatus('inceleme'), 'review');
  assert.equal(projectStatus(tr('yay\\u0131nland\\u0131')), 'published');
  assert.equal(projectStatus(tr('tamamland\\u0131')), 'done');
  assert.equal(projectStatus(tr('ar\\u015fiv')), 'archived');
  for (const s of PROJECT_STATUSES) assert.equal(projectStatus(s), s);
  assert.equal(thumbStatus('taslak'), 'draft');
  assert.equal(thumbStatus(tr('se\\u00e7ildi')), 'chosen');
  assert.equal(thumbNoteStatus(tr('d\\u00fczeltildi')), 'fixed');
});

test('an old notes.json and project.json are read with English values', () => {
  const nf = path.join(dir, 'notes.json'), mf = path.join(dir, 'project.json');
  fs.writeFileSync(nf, JSON.stringify([
    { id: 1, t: 1, status: tr('a\\u00e7\\u0131k'), kind: tr('g\\u00f6rsel'), history: [{ status: tr('a\\u00e7\\u0131k'), by: tr('kullan\\u0131c\\u0131') }] },
    { id: 2, t: 2, status: tr('h\\u00e2l\\u00e2 var'), kind: 'genel', history: [] },
    { id: 3, t: 3, status: 'open', kind: 'timing' },
  ]));
  fs.writeFileSync(mf, '﻿' + JSON.stringify({ title: 'Old film', status: tr('onayland\\u0131'), render: { env: { DUR: '12' } } }));
  const notes = readNotes(nf);
  assert.deepEqual(notes.map(n => n.status), ['open', 'reopened', 'open']);
  assert.deepEqual(notes.map(n => n.kind), ['visual', 'general', 'timing']);
  assert.deepEqual(notes[0].history[0], { status: 'open', by: 'user' });
  assert.equal(notes.filter(isOpenNote).length, 3);
  const meta = readMeta(mf);
  assert.equal(meta.status, 'approved');
  assert.equal(meta.render.env.DUR, '12');
  assert.deepEqual(readNotes(path.join(dir, 'missing.json')), []);
  assert.deepEqual(readMeta(path.join(dir, 'missing.json')), {});
});

test('an old thumbnail brief is read with English statuses and font ids', () => {
  const b = normalizeBrief({ id: '20261104-abcd', status: tr('\\u00fcretiliyor'), layers: [{ type: 'text', content: 'HI', font: tr('youtube-kal\\u0131n') }],
    variants: [{ id: 'v1_1', file: 'variants/v1_1.png', notes: [{ id: 1, status: tr('a\\u00e7\\u0131k') }, { id: 2, status: tr('d\\u00fczeltildi') }] }] });
  assert.equal(b.status, 'generating');
  assert.deepEqual(b.variants[0].notes.map(n => n.status), ['open', 'fixed']);
  assert.equal(b.layers.find(l => l.type === 'text').font, 'youtube-bold');
});

test.after(() => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch { } });
