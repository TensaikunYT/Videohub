import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { PassThrough } from 'node:stream';

// A notes.json that came with a downloaded project may point its pictures at any file on the PC: those files must never be
// deleted (single delete, bulk approve/remove) nor served by the picture route. Only files in .videohub\notes are the hub's.
fs.mkdirSync(path.resolve('.test-tmp'), { recursive: true });
const root = fs.mkdtempSync(path.join(path.resolve('.test-tmp'), 'notes-images-'));
const dir = path.join(root, 'film'), outside = path.join(root, 'precious.txt'), own = path.join(dir, '.videohub', 'notes', 'n001_frame.jpg');
const p = { id: 'notes-img-test', path: dir, name: 'film', title: 'film', outputs: [], render: {} };
const notesFile = path.join(dir, '.videohub', 'notes.json');
const note = (id, images) => ({ id, t: 1, t2: null, kind: 'general', text: 'x', images, status: 'open', history: [], createdAt: '2020-01-01T00:00:00.000Z' });
const seed = () => {
  fs.mkdirSync(path.dirname(own), { recursive: true }); fs.writeFileSync(outside, 'keep me'); fs.writeFileSync(own, 'jpg');
  fs.writeFileSync(notesFile, JSON.stringify([note(1, { frame: own, crop: outside }), note(2, { frame: outside, annotated: path.join(dir, '.videohub', 'notes', '..', '..', '..', 'precious.txt') })]));
};
test.after(() => { try { fs.rmSync(root, { recursive: true }); } catch { } });

test('pictures outside the notes folder survive remove and bulk, and are not served', async () => {
  const notes = await import('./notes.js'), { index } = await import('./scan.js');
  index().projects = [...(index().projects || []).filter(x => x.id !== p.id), p];
  seed(); assert.equal(notes.remove(p, 1), true); assert.ok(fs.existsSync(outside)); assert.ok(!fs.existsSync(own));
  for (const action of ['approve', 'remove']) { seed(); notes.bulk(p, action, [1, 2]); assert.ok(fs.existsSync(outside), action); assert.ok(!fs.existsSync(own), action); }
  seed();
  const routes = []; notes.routes((method, pattern, fn) => routes.push({ method, pattern, fn }), async () => ({}));
  const img = routes.find(r => r.pattern === '/api/project/:id/noteimg/:nid/:kind');
  const get = (nid, kind) => { const res = new PassThrough(); res.writeHead = c => { res.code = c; }; res.resume();
    img.fn({}, new URL('http://127.0.0.1/x'), { id: p.id, nid: String(nid), kind }, res); return res.code; };
  assert.equal(get(2, 'frame'), 404); assert.equal(get(2, 'annotated'), 404); assert.equal(get(1, 'crop'), 404);
  assert.equal(get(1, 'frame'), 200);
});
