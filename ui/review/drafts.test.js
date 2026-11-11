import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

// Exercise the real draft/click/save functions without starting the router, SSE,
// a film, a render or a real note request. Playback and DOM effects are observed.
const source = fs.readFileSync(new URL('../review.js', import.meta.url), 'utf8');
const draftFunctions = source.slice(source.indexOf('  // ---------- tools + drafts'), source.indexOf('  // The user felt'));
const clickFunction = source.slice(source.indexOf('  function quickPoint('), source.indexOf('  // a mark was just drawn'));
const quickEmpty = source.match(/^  const quickEmpty = .*$/m)?.[0];
const plain = value => JSON.parse(JSON.stringify(value));

function draft(frame, overrides = {}) {
  return { t: (frame + 0.5) / 30, frame, text: 'Keep this note', kind: 'visual',
    shapes: [{ type: 'pin', pts: [[0.2, 0.3]], color: '#ff4d4d', width: 1 }],
    quick: true, useRange: null, ...overrides };
}

function harness({ active = null, frame = 420, time = 14, paused = false, range = { a: null, b: null }, live = false, displayedTime = time } = {}) {
  const seeks = [], notices = [], calls = [], requests = [];
  const S = { draft: active, frame, range: { ...range }, parkedDrafts: [], undo: ['undo-snapshot'], redo: ['redo-snapshot'],
    tool: 'cursor', color: '#ff4d4d', width: 1, selected: null, loopOn: false };
  const node = (tag = 'div', attrs = {}, ...children) => ({
    tag, ...attrs, children, style: {}, hidden: false,
    append(...items) { this.children.push(...items); },
    replaceChildren(...items) { this.children = items; },
    set textContent(value) { this.text = value; },
    addEventListener() {}, remove() {}, focus() {},
    getContext() { return {}; }, toDataURL: () => 'data:image/png;base64,TEST',
  });
  const videoA = {
    currentTime: time, displayedTime, paused, videoWidth: 1920, videoHeight: 1080,
    pause() { this.paused = true; calls.push(['pause', this.currentTime]); },
    pauseAt(at) { this.currentTime = this.displayedTime = at; this.paused = true; calls.push(['pauseAt', at]); },
    play() { this.paused = false; calls.push(['play', this.currentTime]); return Promise.resolve(); },
  };
  const notesPanel = new Proxy({}, { get: (_, method) => (...args) => calls.push([method, ...args]) });
  const ctx = {
    S, videoA, videoB: { pause() {} }, liveSrc: live ? videoA : null, notesPanel, cur: { rel: '~live', w: 1920, h: 1080 }, id: 'test-project',
    pendingSeek: 8, target: 9,
    notes: [], saving: 0, earlyNotes: new Map(), quickOpen: false, quick: node(), textInput: node(),
    fps: () => 30, rangeOk: () => S.range.a != null && S.range.b != null,
    setRange: (a, b) => { S.range = { a, b }; }, updRange() {},
    clearRange: () => { S.range = { a: null, b: null }; },
    seekFrame: frame => { seeks.push(frame); videoA.currentTime = (frame + 0.5) / 30; S.frame = frame; },
    togglePlay: () => videoA.paused ? videoA.play() : videoA.pause(),
    refreshTools() {}, redraw() {}, openQuick: () => calls.push(['openQuick']),
    showNotes() {},   // P1: the side panel's Notes tab comes forward (no side panel in this harness)
    pushTag() {},     // P3b: drawing steps tell the undo router (no router in this harness)
    noteAt: () => null, selectNote: id => calls.push(['selectNote', id]),
    toast: (...args) => notices.push(args), TC: String, h: node, paint() {}, numbered: shapes => shapes,
    bbox: () => [0.2, 0.3, 0.2, 0.3], nextId: () => ctx.notes.reduce((id, note) => Math.max(id, note.id), 0) + 1,
    timeline: { draw() {} }, performance: { now: () => 0 },
    probeSave: () => ({ shown() {}, post() {} }), encodeJpeg: async () => 'data:image/jpeg;base64,TEST',
    api: (url, opts) => new Promise((resolve, reject) => requests.push({ url, opts, resolve, reject })),
  };
  vm.createContext(ctx);
  vm.runInContext(`${quickEmpty}\n${draftFunctions}\n${clickFunction}`, ctx);
  return { ...ctx, ctx, calls, notices, seeks, requests };
}

test('a new click keeps its captured frame and parks an older written draft without rewinding', () => {
  const old = draft(300);
  // Deliberately stale UI frame: the frozen click timestamp is authoritative.
  const h = harness({ active: old, frame: 300, time: 14 });
  h.ctx.quickPoint([0.7, 0.8], 14, true);
  assert.equal(h.S.draft.frame, 420);
  assert.notEqual(h.S.draft, old);
  assert.deepEqual(plain(h.S.draft.shapes[0].pts), [[0.7, 0.8]]);
  assert.equal(h.S.draft.resume, true);
  assert.equal(h.videoA.paused, true);
  assert.equal(h.S.parkedDrafts.length, 1);
  assert.equal(h.S.parkedDrafts[0].draft, old);
  assert.deepEqual(plain(h.S.parkedDrafts[0].undo), ['undo-snapshot']);
  assert.deepEqual(plain(h.S.parkedDrafts[0].redo), ['redo-snapshot']);
  assert.ok(!h.seeks.includes(300), 'A click elsewhere must not seek to the older draft');
  const closed = h.calls.findIndex(([name]) => name === 'closeComposer');
  const opened = h.calls.findIndex(([name]) => name === 'openComposer');
  assert.ok(closed >= 0 && opened > closed, 'Recreate composer callbacks for the new draft');
});

test('live annotation freezes the captured picture time even when playback has advanced several seconds', () => {
  const old = draft(300);
  const h = harness({ active: old, frame: 300, time: 19, displayedTime: 14, live: true });
  h.ctx.quickPoint([0.7, 0.8], 14, true);
  assert.equal(h.S.draft.frame, 420);
  assert.equal(h.videoA.currentTime, 14);
  assert.equal(h.videoA.paused, true);
  assert.equal(h.ctx.pendingSeek, null);
  assert.equal(h.ctx.target, null);
  assert.ok(h.calls.some(([name, time]) => name === 'pauseAt' && time === 14));
  assert.equal(h.S.parkedDrafts[0].draft, old);
  assert.deepEqual(h.seeks, [], 'Live annotation must not run an old queued seek');
});

test('a live note without an explicit timestamp uses the last displayed image, not the wall clock', () => {
  const h = harness({ time: 19, displayedTime: 14, live: true });
  h.ctx.quickPoint([0.7, 0.8]);
  assert.equal(h.S.draft.frame, 420);
  assert.equal(h.S.draft.resume, true);
  assert.equal(h.videoA.currentTime, 14);
});

test('a range draft is preserved with its own range when a later frame receives a note', () => {
  const old = draft(300, { useRange: true });
  const h = harness({ active: old, range: { a: 280, b: 330 } });
  h.ctx.quickPoint([0.7, 0.8], 14, true);
  assert.equal(h.S.draft.frame, 420);
  assert.equal(h.S.parkedDrafts[0].draft, old);
  assert.deepEqual(plain(h.S.parkedDrafts[0].range), { a: 280, b: 330 });
  h.S.range.a = 400;
  assert.equal(h.S.parkedDrafts[0].range.a, 280, 'Later range edits must not mutate the parked snapshot');
  assert.ok(!h.seeks.includes(300));
});

test('an untouched old quick point is discarded rather than adding a pending draft', () => {
  const h = harness({ active: draft(300, { text: '' }) });
  h.ctx.quickPoint([0.7, 0.8], 14, true);
  assert.equal(h.S.draft.frame, 420);
  assert.equal(h.S.parkedDrafts.length, 0);
  assert.ok(!h.seeks.includes(300));
});

test('an older drawing is preserved even when its text is still empty', () => {
  const old = draft(300, { text: '', quick: false, shapes: [{ type: 'rect', pts: [[0.2, 0.2], [0.4, 0.4]] }] });
  const h = harness({ active: old });
  h.ctx.quickPoint([0.7, 0.8], 14, true);
  assert.equal(h.S.draft.frame, 420);
  assert.equal(h.S.parkedDrafts[0].draft, old);
});

test('another click on the active draft frame reuses it rather than shelving it', () => {
  const old = draft(420);
  const h = harness({ active: old, paused: true });
  h.ctx.quickPoint([0.7, 0.8], 14.01, false);
  assert.equal(h.S.draft, old);
  assert.equal(h.S.parkedDrafts.length, 0);
  assert.equal(old.shapes.length, 2);
  assert.deepEqual(plain(old.shapes[1].pts), [[0.7, 0.8]]);
});

test('explicitly restoring a parked draft swaps the active note and restores range and history', () => {
  const old = draft(300, { useRange: true });
  const h = harness({ active: old, range: { a: 280, b: 330 } });
  h.ctx.quickPoint([0.7, 0.8], 14, true);
  const recent = h.S.draft;
  recent.text = 'The newer note';
  const entry = h.S.parkedDrafts[0];
  h.S.range = { a: 400, b: 430 };
  h.S.undo = ['new-undo']; h.S.redo = [];
  h.ctx.restoreDraft(entry);
  assert.equal(h.S.draft, old);
  assert.equal(h.S.frame, 300);
  assert.equal(h.videoA.paused, true);
  assert.deepEqual(plain(h.S.range), { a: 280, b: 330 });
  assert.deepEqual(plain(h.S.undo), ['undo-snapshot']);
  assert.deepEqual(plain(h.S.redo), ['redo-snapshot']);
  assert.equal(h.S.parkedDrafts.length, 1);
  assert.equal(h.S.parkedDrafts[0].draft, recent);
  assert.deepEqual(plain(h.S.parkedDrafts[0].undo), ['new-undo']);
  assert.equal(h.seeks.at(-1), 300, 'Only explicit restore should navigate back to this frame');
});

test('a delayed failed save parks its old draft and never overwrites a newer active note', async () => {
  const old = draft(300, { shapes: [], resume: true });
  const h = harness({ active: old, frame: 300, time: 10, paused: true });
  const saving = h.ctx.saveDraft();
  assert.equal(h.requests.length, 1);
  assert.equal(h.S.draft, null);
  const current = draft(420, { text: 'A newer unsaved note' });
  h.S.draft = current; h.S.frame = 420; h.videoA.currentTime = 14;
  h.requests[0].reject(new Error('temporary offline'));
  await saving;
  assert.equal(h.S.draft, current);
  assert.equal(h.S.parkedDrafts.length, 1);
  assert.equal(h.S.parkedDrafts[0].draft, old);
  assert.ok(!h.seeks.includes(300));
  assert.equal(h.ctx.notes.length, 0, 'Failed optimistic note must leave the saved-note list');
});

test('the real notes composer writes to the switched draft and its shelf exposes explicit restoration', () => {
  const panelSource = fs.readFileSync(new URL('./notes.js', import.meta.url), 'utf8')
    .replace(/^import .+;\r?$/gm, '')
    .replace('export function createNotesPanel', 'function createNotesPanel');
  function node(tag, attrs = {}, ...children) {
    return {
      tag, ...attrs, children: children.flat(Infinity).filter(child => child != null && child !== false),
      append(...items) { this.children.push(...items.flat(Infinity)); },
      replaceChildren(...items) { this.children = items; },
      set innerHTML(_) { this.children = []; },
      set textContent(value) { this.children = [String(value)]; },
      addEventListener() {}, focus() {},
    };
  }
  const find = (root, predicate) => {
    if (!root || typeof root !== 'object') return null;
    if (predicate(root)) return root;
    for (const child of root.children || []) { const found = find(child, predicate); if (found) return found; }
    return null;
  };
  const old = draft(300), newer = draft(420, { text: 'The new draft' });
  let active = old, restored = null;
  const entry = { draft: old, undo: [], redo: [], range: { a: null, b: null } };
  const context = {
    h: node, TC: String, document: { body: {}, activeElement: null },
    api: () => { throw new Error('This test must not send a note'); },
  };
  vm.createContext(context); vm.runInContext(panelSource, context);
  const panel = context.createNotesPanel({
    draft: () => active, fps: () => 30, chunkSec: () => null, atDraft: () => true,
    range: () => ({ a: null, b: null }), rangeOk: () => false, parkedDrafts: () => [entry],
    restoreDraft: chosen => { restored = chosen; },
  });
  panel.openComposer(false);
  assert.equal(find(panel.el, el => el.tag === 'textarea').value, old.text);
  panel.closeComposer(); active = newer; panel.openComposer(false);
  const input = find(panel.el, el => el.tag === 'textarea');
  assert.equal(input.value, newer.text);
  input.value = 'Edited newer note'; input.oninput();
  assert.equal(newer.text, 'Edited newer note');
  assert.equal(old.text, 'Keep this note', 'New composer input must not mutate the parked draft');
  panel.renderDrafts();
  const shelf = find(panel.el, el => el.class === 'rv2-drafts');
  assert.equal(shelf.hidden, false);
  find(shelf, el => el.tag === 'button').onclick();
  assert.equal(restored, entry);
});
