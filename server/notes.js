// Review notes: a moment (or range) in a video, a drawing on the frame, a text, and a status
// that goes  open → claude → fixed → approved  (or "reopened" back to Claude when a fix did not work).
// Stored with the project: <project>\.videohub\notes.json + notes\nNN_*.{jpg,png}
// Older notes.json files with Turkish statuses/kinds are read through legacy.js and saved back in English.
import fs from 'node:fs';
import path from 'node:path';
import { project, setNoteCounts } from './scan.js';
import { spokenAt } from './transcript.js';
import { readNotes, NOTE_STATUSES, NOTE_KINDS, noteStatus, noteKind, byWho, isOpenNote } from './legacy.js';
import { DATA_DIR, readJson, writeJson, now, run, TOOLS, isInside } from './util.js';

export const STATUSES = NOTE_STATUSES;
export const KINDS = NOTE_KINDS;

export const vhDir = p => p.group ? path.join(DATA_DIR, 'projects', p.id) : path.join(p.path, '.videohub');
const notesFile = p => path.join(vhDir(p), 'notes.json');
// a picture path read from notes.json is only deleted or served when it is inside the project's notes folder: a downloaded
// project could carry a notes.json whose pictures point at any file on the PC ("Remove all old notes" would delete them)
const notesDir = p => path.join(vhDir(p), 'notes');
const inNotes = (dir, f) => typeof f === 'string' && path.isAbsolute(f) && isInside(path.dirname(path.resolve(f)), dir);
const unlinkImg = (dir, f) => { if (inNotes(dir, f)) try { fs.unlinkSync(f); } catch { } };
export const list = p => readNotes(notesFile(p)).map(n => {
  if (n.images) for (const [k, f] of Object.entries(n.images)) if (!f || !fs.existsSync(f)) delete n.images[k];   // removed from Disk page
  return n;
});
export const versions = p => readJson(path.join(vhDir(p), 'versions.json'), []);
const save = (p, notes) => writeJson(notesFile(p), notes);

// Pictures are cut after the answer, one job at a time for the whole hub (ffmpeg is heavy);
// the note is saved at once with pending: true and an SSE 'note' event brings its pictures when ready.
const subs = new Set();
export const onNote = fn => { subs.add(fn); return () => subs.delete(fn); };
const emit = (p, note, extra) => { for (const fn of subs) try { fn({ project: p.id, note, ...extra }); } catch { } };
let chain = Promise.resolve();
let queued = 0;
export function later(fn) { queued++; const job = chain.then(fn).finally(() => { queued--; }); chain = job.catch(e => console.error('[notes] pictures:', e?.message || e)); return job; }
export const busyPictures = () => queued > 0;
export const settled = () => chain;   // tests: wait until every picture is cut
const counts = p => setNoteCounts(p.id, readNotes(notesFile(p)));
// change one stored note in place (re-read: the user may have edited or deleted it meanwhile)
function patch(p, id, fn) {
  const notes = readNotes(notesFile(p)), n = notes.find(x => x.id === id); if (!n) return null;
  if (fn(n) === false) return null; save(p, notes); return n;
}

function saveDataUrl(dataUrl, file) {
  const m = /^data:image\/(png|jpeg);base64,(.+)$/.exec(dataUrl || ''); if (!m) return null;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, Buffer.from(m[2], 'base64'));
  return file;
}

export function chunkOf(p, t) {
  const cs = p.render?.chunkSec; return cs ? Math.floor(t / cs) : null;
}
function noteChunks(p, t, t2, at) {
  let a = t2 == null ? t - 0.5 : t, b = (t2 ?? t) + 0.5;
  if (at != null) { a = Math.min(a, at); b = Math.max(b, at + 0.5); }
  const lo = chunkOf(p, Math.max(0, a)), hi = chunkOf(p, b);
  return lo == null ? null : Array.from({ length: hi - lo + 1 }, (_, i) => lo + i);
}
const frameOf = (t, fps) => Math.floor(t * fps + 1e-6);
// a range note also gets its first and last frame as pictures, so Claude sees where it starts and ends
async function rangeImages(n, out, fps, dir, tag) {
  n.images = n.images || {};
  for (const k of ['start', 'end']) { if (n.images[k]) unlinkImg(dir, n.images[k]); delete n.images[k]; }
  if (n.t2 == null || !out) return;
  const e = await frameImages(out, n.t2, fps, null, null, dir, tag + '_end'); if (e?.frame) n.images.end = e.frame;
  if (n.frame != null && frameOf(n.t, fps) !== n.frame) { const s = await frameImages(out, n.t, fps, null, null, dir, tag + '_start'); if (s?.frame) n.images.start = s.frame; }
}
function liveRangeImages(n, images, dir, tag) {
  n.images = n.images || {};
  for (const k of ['start', 'end']) { if (n.images[k]) unlinkImg(dir, n.images[k]); delete n.images[k]; }
  if (n.t2 == null) return;
  const e = images?.end && saveDataUrl(images.end, path.join(dir, tag + '_end_frame.jpg')); if (e) n.images.end = e;
  const s = images?.start && saveDataUrl(images.start, path.join(dir, tag + '_start_frame.jpg')); if (s) n.images.start = s;
}
// after the range of a note was edited: frames, chunks and the start/end pictures again
// same picture files: same queue. It works on the note as stored when its turn comes and only writes the range
// fields back (a copy taken before the wait used to undo the add job's pictures and Claude's status changes)
export function refreshRange(p, n, images) { return later(async () => { const cur = readNotes(notesFile(p)).find(x => x.id === n.id); return cur ? refreshRangeNow(p, { ...cur, images: { ...(cur.images || {}) } }, images) : n; }); }
async function refreshRangeNow(p, n, images) {
  const out = p.outputs.find(o => o.rel === n.file) || null, fps = n.fps || out?.fps || p.render?.fps || 30;
  n.frames = n.t2 != null ? [frameOf(n.t, fps), frameOf(n.t2, fps)] : null;
  n.chunks = noteChunks(p, n.t, n.t2, n.at);
  n.say = spokenAt(p, n.at ?? n.t, n.t2) || null;
  const dir = path.join(vhDir(p), 'notes'), tag = 'n' + String(n.id).padStart(3, '0');
  if (out) await rangeImages(n, out, fps, dir, tag); else liveRangeImages(n, images, dir, tag);
  return patch(p, n.id, x => {
    x.frames = n.frames; x.chunks = n.chunks; x.say = n.say;
    const im = { ...(x.images || {}) }; delete im.start; delete im.end; if (n.images.start) im.start = n.images.start; if (n.images.end) im.end = n.images.end;
    x.images = im; x.imgV = Date.now();
  }) || n;
}

// The exact frame comes from ffmpeg (frame number -> time), not from the browser, whose
// canvas copy of a <video> can come back black. The browser only sends the drawing as a
// transparent PNG at 1280 px wide; ffmpeg lays it over the frame and cuts the close-up.
async function frameImages(out, t, fps, strokesPng, region, dir, tag) {
  const frameNo = Math.floor(t * fps + 1e-6), ss = (frameNo / fps).toFixed(6);
  const frame = path.join(dir, tag + '_frame.jpg');
  fs.mkdirSync(dir, { recursive: true });
  await run(TOOLS.ffmpeg, ['-v', 'error', '-y', '-ss', ss, '-i', out.path, '-frames:v', '1', '-vf', 'scale=1280:-2', '-q:v', '3', frame]);
  if (!fs.existsSync(frame)) return null;
  return { frameNo, ...(await annotate(frame, strokesPng, region, dir, tag)) };
}
// the drawing over a frame image + the close-up of the drawn region
async function annotate(frame, strokesPng, region, dir, tag) {
  const ann = path.join(dir, tag + '_ann.jpg'), crop = path.join(dir, tag + '_crop.jpg');   // JPEG: ~5x smaller than PNG
  const res = { frame };
  if (strokesPng) {
    const st = saveDataUrl(strokesPng, path.join(dir, tag + '_strokes.png'));
    await run(TOOLS.ffmpeg, ['-v', 'error', '-y', '-i', frame, '-i', st, '-filter_complex', '[1:v][0:v]scale2ref[s][f];[f][s]overlay=format=auto', '-frames:v', '1', '-q:v', '3', ann]);
    try { fs.unlinkSync(st); } catch { }
    if (fs.existsSync(ann)) res.annotated = ann;
  }
  if (region && res.annotated) {
    const pad = 0.08, [x0, y0, x1, y1] = region;
    const cx = Math.max(0, x0 - pad), cy = Math.max(0, y0 - pad), cw = Math.min(1, x1 + pad) - cx, ch = Math.min(1, y1 + pad) - cy;
    const f = `crop=max(64\\,iw*${cw.toFixed(4)}):max(64\\,ih*${ch.toFixed(4)}):iw*${cx.toFixed(4)}:ih*${cy.toFixed(4)},scale='min(640,iw)':-2`;
    await run(TOOLS.ffmpeg, ['-v', 'error', '-y', '-i', res.annotated, '-vf', f, '-frames:v', '1', '-q:v', '3', crop]);
    if (fs.existsSync(crop)) res.crop = crop;
  }
  return res;
}

export async function add(p, body) {
  const notes = list(p), seqFile = path.join(vhDir(p), 'notes-seq.json');
  const id = Math.max(notes.reduce((m, n) => Math.max(m, n.id), 0), readJson(seqFile, {}).last || 0) + 1;   // never reused
  writeJson(seqFile, { last: id });
  const dir = path.join(vhDir(p), 'notes'), tag = 'n' + String(id).padStart(3, '0');
  // t..t2 = the range (or just t, a moment); at = the frame the drawing is on, when that is not t
  const t = +body.t || 0, t2 = body.t2 != null ? +body.t2 : null, at = body.at != null ? +body.at : null;
  const out = p.outputs.find(o => o.rel === body.file) || null;
  const fps = out?.fps || +body.fps || p.render?.fps || 30;
  // a live note's frame comes from the browser: writing it is quick, so it is there right away
  const liveShot = !out && body.images?.frame ? saveDataUrl(body.images.frame, path.join(dir, tag + '_frame.jpg')) : null;
  const kind = noteKind(body.kind);
  const note = {
    id, t, t2, at, kind: KINDS.includes(kind) ? kind : 'general', layer: typeof body.layer === 'string' && body.layer ? body.layer.slice(0, 24) : null, text: String(body.text || '').trim(),
    region: body.region || null, drawing: body.drawing || null,
    file: body.file || null, fileMtime: out ? Math.round(out.mtime) : null, fps: out?.fps || (+body.fps || null), frame: out || liveShot ? frameOf(at ?? t, fps) : null,
    frames: t2 != null ? [frameOf(t, fps), frameOf(t2, fps)] : null,
    chunks: noteChunks(p, t, t2, at),
    say: spokenAt(p, at ?? t, t2) || null,   // the sentence being narrated at the note
    images: {},
    status: 'open', reply: null, fixedIn: null, history: [{ at: now(), status: 'open', by: 'user' }], createdAt: now(),
  };
  if (liveShot) note.images.frame = liveShot;
  else if (!out) {   // the video is gone from disk: keep whatever the browser captured
    const fr = saveDataUrl(body.images?.frame, path.join(dir, tag + '_frame.jpg')), an = saveDataUrl(body.images?.annotated, path.join(dir, tag + '_ann.png'));
    if (fr) note.images.frame = fr; if (an) note.images.annotated = an;
  }
  if (t2 != null && !out) liveRangeImages(note, body.images, dir, tag);
  const work = out || (liveShot && body.images?.strokes);
  if (work) note.pending = true;
  notes.push(note); save(p, notes);
  if (work) later(async () => {
    const imgs = {};
    if (out) {
      const fx = await frameImages(out, at ?? t, fps, body.images?.strokes, body.region, dir, tag);
      if (fx) Object.assign(imgs, { frame: fx.frame, annotated: fx.annotated, crop: fx.crop });
      if (t2 != null) { const tmp = { t, t2, frame: note.frame, images: {} }; await rangeImages(tmp, out, fps, dir, tag); Object.assign(imgs, tmp.images); }
    } else {
      const lx = await annotate(liveShot, body.images.strokes, body.region, dir, tag);
      Object.assign(imgs, { annotated: lx.annotated, crop: lx.crop });
    }
    const done = patch(p, id, n => { if (n.createdAt !== note.createdAt) return false; const im = { ...n.images }; for (const [k, v] of Object.entries(imgs)) if (v) im[k] = v; n.images = im; delete n.pending; n.imgV = Date.now(); });
    if (!done) { for (const v of Object.values(imgs)) if (v) try { fs.unlinkSync(v); } catch { } }   // deleted (or replaced) while its pictures were cut
    else emit(p, done);
  });
  return note;
}

export function resumePending(projects) {
  for (const p of projects) {
    let ns = []; try { ns = readNotes(notesFile(p)); } catch { }
    for (const n of ns.filter(x => x.pending)) later(async () => {
      const out = p.outputs?.find(o => o.rel === n.file), fps = n.fps || out?.fps || 30, dir = path.join(vhDir(p), 'notes'), tag = 'n' + String(n.id).padStart(3, '0');
      const imgs = {};
      if (out && fs.existsSync(out.path)) {
        const fx = await frameImages(out, n.at ?? n.t, fps, null, null, dir, tag); if (fx?.frame) imgs.frame = fx.frame;
        if (n.t2 != null) { const tmp = { t: n.t, t2: n.t2, frame: n.frame, images: {} }; await rangeImages(tmp, out, fps, dir, tag); Object.assign(imgs, tmp.images); }
      }
      const done = patch(p, n.id, x => { if (x.createdAt !== n.createdAt) return false; x.images = { ...(x.images || {}), ...imgs }; delete x.pending; x.imgV = Date.now(); });
      if (done) emit(p, done);
    });
  }
}

export function update(p, id, patch, by = 'user') {
  const notes = list(p), n = notes.find(x => x.id === +id);
  if (!n) throw Object.assign(new Error('Note not found'), { code: 404 });
  if (patch.kind !== undefined) patch = { ...patch, kind: noteKind(patch.kind) };
  for (const k of ['text', 'kind', 'layer', 'reply', 'fixedIn', 't', 't2', 'at']) if (patch[k] !== undefined) n[k] = patch[k];
  const st = patch.status ? noteStatus(patch.status) : null;   // legacy (Turkish) words are accepted too
  if (st && STATUSES.includes(st) && st !== n.status) { n.status = st; n.history.push({ at: now(), status: n.status, by: byWho(by), note: patch.reply || patch.comment || undefined }); }
  save(p, notes); return n;
}

export function remove(p, id) {
  const notes = list(p), n = notes.find(x => x.id === +id); if (!n) return false;
  for (const f of Object.values(n.images || {})) unlinkImg(notesDir(p), f);
  save(p, notes.filter(x => x.id !== +id)); return true;
}

// notes written before the newest version (all notes when the project has no version yet)
export function oldNotes(p) {
  const versions = readJson(path.join(vhDir(p), 'versions.json'), []);
  const last = versions.reduce((m, v) => Math.max(m, Date.parse(v.created || 0) || 0), 0);
  return list(p).filter(n => !last || (Date.parse(n.createdAt || 0) || 0) < last);
}
// many notes at once (after a new version): "approve" marks them approved; "remove" takes them off the list into
// .videohub/notes-archive.json (text only) and deletes their pictures, like a single note's "Delete" (the pictures are
// cut from the video and can be made again)
export function bulk(p, action, ids) {
  const notes = list(p), pick = new Set((ids || oldNotes(p).map(n => n.id)).map(Number));
  const hit = notes.filter(n => pick.has(n.id));
  if (action === 'approve') {
    // approved notes keep their text, their frame pictures are deleted (frees the space)
    let freed = 0;
    for (const n of hit) {
      if (n.status !== 'approved') { n.status = 'approved'; n.history.push({ at: now(), status: n.status, by: 'user', note: 'bulk approval' }); }
      for (const f of Object.values(n.images || {})) if (inNotes(notesDir(p), f)) try { freed += fs.statSync(f).size; fs.unlinkSync(f); } catch { }
      n.images = {};
    }
    save(p, notes);
    return { ok: true, count: hit.length, freed };
  } else if (action === 'remove') {
    const af = path.join(vhDir(p), 'notes-archive.json'), arch = readJson(af, []);
    arch.push(...hit.map(n => ({ ...n, images: {}, archivedAt: now() })));
    writeJson(af, arch); save(p, notes.filter(n => !pick.has(n.id)));
    let freed = 0;
    for (const n of hit) for (const f of Object.values(n.images || {})) if (inNotes(notesDir(p), f)) try { freed += fs.statSync(f).size; fs.unlinkSync(f); } catch { }
    return { ok: true, count: hit.length, freed };
  } else throw Object.assign(new Error('action: approve | remove'), { code: 400 });
}

// the short message the user pastes into the chat ("Send to Claude")
export function prompt(p, ids) {
  const open = list(p).filter(n => ids ? ids.includes(n.id) : isOpenNote(n));
  return `VideoHub: ${open.length} note${open.length === 1 ? '' : 's'} on "${p.title || p.name}" (${open.map(n => '#' + n.id).join(', ')}).\n`
    + `Project folder: ${p.path}\n`
    + `Get them with hub_notes({project: ${JSON.stringify(p.path)}}), fix the code (the open live preview reloads itself) and mark each note with hub_note_update. DO NOT RENDER: render only with hub_render when the user asks for a render. `
    + `If this chat does not know the project yet, first read the STATE.md / CLAUDE.md / README files in its folder.`;
}

export function routes(route, readBody) {
  const need = id => { const p = project(id); if (!p) throw Object.assign(new Error('Project not found'), { code: 404 }); return p; };
  route('GET', '/api/project/:id/notes', (req, url, { id }) => list(need(id)));
  // a note change only moves the project's note counts: no rescan (that walks every file of a big project, once per note)
  route('POST', '/api/project/:id/notes', async (req, url, { id }) => { const p = need(id); const n = await add(p, await readBody(req)); counts(p); return n; });
  route('POST', '/api/project/:id/note/:nid', async (req, url, { id, nid }) => {
    const p = need(id); const b = await readBody(req); let n = update(p, nid, b, b.by || 'user');
    if (['t', 't2', 'at'].some(k => b[k] !== undefined)) n = await refreshRange(p, n, b.images);
    counts(p); emit(p, n, { by: byWho(b.by || 'user') }); return n;
  });
  route('POST', '/api/project/:id/note/:nid/delete', (req, url, { id, nid }) => { const p = need(id); const ok = remove(p, nid); counts(p); emit(p, null, { removed: +nid }); return { ok }; });
  route('GET', '/api/project/:id/notes/old', (req, url, { id }) => oldNotes(need(id)).map(n => n.id));
  route('POST', '/api/project/:id/notes/bulk', async (req, url, { id }) => { const p = need(id); const b = await readBody(req); const r = bulk(p, b.action, b.ids); counts(p); emit(p, null, { bulk: true }); return r; });
  route('POST', '/api/project/:id/prompt', async (req, url, { id }) => { const b = await readBody(req); return { text: prompt(need(id), b.ids) }; });
  route('GET', '/api/project/:id/noteimg/:nid/:kind', (req, url, { id, nid, kind }, res) => {
    const p = need(id), n = readJson(notesFile(p), []).find(x => x.id === +nid), f = n?.images?.[kind];   // no existence check of every note's pictures
    if (!inNotes(notesDir(p), f) || !fs.existsSync(f)) { res.writeHead(404); return res.end(); }
    // the UI adds ?v=<imgV>: a recut picture gets a new URL, so the browser may keep it
    res.writeHead(200, { 'Content-Type': f.endsWith('.png') ? 'image/png' : 'image/jpeg', 'Cache-Control': url.searchParams.get('v') ? 'private, max-age=31536000, immutable' : 'no-cache' }); fs.createReadStream(f).on('error', () => res.destroy()).pipe(res);
  });
}
