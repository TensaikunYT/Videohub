// The agent channel: the user answers the agent by clicking in VideoHub instead of copying text into its chat.
// Per film, next to the notes in its .videohub folder:
//   plan.json       every plan the agent wrote (hub_plan); the newest is the current one, older versions are kept
//   questions.json  the agent's questions (hub_ask) with their options and the user's answers
//   inbox.json      what the user did for the agent: notes sent, answers, plan / scene approvals, scene notes.
//                   hub_wait long-polls GET /api/project/:id/wait and gets each item once (a cursor in the file).
// Nothing here talks to an agent: the agent asks (hub_wait), the hub answers when the user has done something.
import fs from 'node:fs';
import path from 'node:path';
import * as notesApi from './notes.js';
import { readJson, writeJson, now, isInside } from './util.js';
import { isOpenNote, normalizeNote } from './legacy.js';

const { vhDir } = notesApi;
const fail = (code, msg) => Object.assign(new Error(msg), { code });
const str = (v, max) => typeof v === 'string' ? v.trim().slice(0, max) : '';

// ---------- changes: the hub turns them into SSE 'channel' events (the UI asks for the film's state again)
const subs = new Set();
export const onChannel = fn => { subs.add(fn); return () => subs.delete(fn); };
const emit = ev => { for (const fn of subs) try { fn(ev); } catch { } };

// ---------- inbox: the user's actions, each delivered once
const inboxFile = p => path.join(vhDir(p), 'inbox.json');
function readInbox(p) {
  const b = readJson(inboxFile(p), null);
  return b && Array.isArray(b.items) ? { seq: +b.seq || 0, delivered: +b.delivered || 0, items: b.items } : { seq: 0, delivered: 0, items: [] };
}
const KEEP_DELIVERED = 60;   // delivered items kept for a while (the drawer's "recent actions"), the rest dropped
function saveInbox(p, b) {
  const undelivered = b.items.filter(i => i.id > b.delivered), old = b.items.filter(i => i.id <= b.delivered).slice(-KEEP_DELIVERED);
  b.items = [...old, ...undelivered];
  writeJson(inboxFile(p), b);
}
export function push(p, item) {
  const b = readInbox(p), it = { id: b.seq + 1, at: now(), ...item };
  b.seq = it.id; b.items.push(it); saveInbox(p, b);
  emit({ project: p.id, what: 'inbox', type: it.type });
  wake(p.id);
  return it;
}
export const undelivered = p => { const b = readInbox(p); return b.items.filter(i => i.id > b.delivered); };
export const recent = (p, n = 12) => readInbox(p).items.slice(-n).reverse();

// Hand the undelivered items to the agent and move the cursor. Sent notes go with their full text, and are marked
// "with the agent" (status claude) as hub_notes does; notes the agent already took with hub_notes are not sent again.
export function deliver(p, by = 'claude') {
  const b = readInbox(p), items = b.items.filter(i => i.id > b.delivered);
  if (!items.length) return [];
  b.delivered = b.seq;
  const out = [];
  let all = null;
  for (const it of items) {
    if (it.type === 'notes' || it.type === 'scene-note') {
      all = all || notesApi.list(p);
      const ids = it.type === 'notes' ? it.ids || [] : [it.note];
      const notes = all.filter(n => ids.includes(n.id) && isOpenNote(n));
      if (!notes.length) continue;   // taken with hub_notes meanwhile (or deleted)
      for (const n of notes) { const u = notesApi.update(p, n.id, { status: 'claude' }, by); n.status = 'claude'; notesApi.noteChanged(p, u, { by: 'claude' }); }
      out.push({ ...it, notes: notes.map(n => normalizeNote({ ...n })) });
    } else out.push(it);
  }
  saveInbox(p, b);
  emit({ project: p.id, what: 'inbox', delivered: true });
  return out;
}

// ---------- waiting agents (hub_wait's open requests)
const waiters = new Map();          // film id -> Set of { agent, since, wake }
const lastEnd = new Map();          // film id -> when its last wait ended (short gaps between two polls are no change)
const GRACE_MS = 2500;   // hub_wait polls again at once; the UI does not blink between two polls
export const waitCount = () => [...waiters.values()].reduce((s, set) => s + set.size, 0);
export function waitingOn(id) {
  const set = waiters.get(id);
  if (set && set.size) { const ws = [...set]; return { since: Math.min(...ws.map(w => w.since)), agent: ws.find(w => w.agent)?.agent || null, open: true }; }
  const end = lastEnd.get(id);
  return end && Date.now() - end.at < GRACE_MS ? { since: end.since, agent: end.agent, open: false } : null;
}
export function waitingAll() {
  const out = {};
  for (const id of new Set([...waiters.keys(), ...lastEnd.keys()])) { const w = waitingOn(id); if (w) out[id] = w; }
  return out;
}
function wake(id) { for (const w of [...(waiters.get(id) || [])]) w.wake(); }
function addWaiter(id, w) {
  const was = waitingOn(id);
  if (!waiters.has(id)) waiters.set(id, new Set());
  waiters.get(id).add(w); lastEnd.delete(id);
  if (!was) emit({ project: id, what: 'wait', waiting: true, agent: w.agent });
}
function dropWaiter(id, w) {
  const set = waiters.get(id); if (!set || !set.delete(w)) return;
  if (set.size) return;
  waiters.delete(id); lastEnd.set(id, { at: Date.now(), since: w.since, agent: w.agent });
  setTimeout(() => {
    const end = lastEnd.get(id);
    if (waiters.get(id)?.size || !end || Date.now() - end.at < GRACE_MS - 50) return;
    lastEnd.delete(id); emit({ project: id, what: 'wait', waiting: false });
  }, GRACE_MS).unref?.();
}
// One long-poll: answers at once when something is waiting, else when the user acts or after `seconds`.
// `done` is called once with the items ([] on timeout) or with null when the client went away first.
export function wait(getProject, id, { seconds = 50, agent = null } = {}, done) {
  const p0 = getProject(id); if (!p0) throw fail(404, 'Project not found');
  const now0 = deliver(p0);
  if (now0.length) return done(now0);
  const w = { agent, since: Date.now(), finished: false };
  const finish = items => { if (w.finished) return; w.finished = true; clearTimeout(timer); dropWaiter(id, w); done(items); };
  w.wake = () => { const p = getProject(id); if (!p) return finish([]); const items = deliver(p); if (items.length) finish(items); };
  const timer = setTimeout(() => finish([]), Math.max(1, Math.min(+seconds || 50, 290)) * 1000);
  addWaiter(id, w);
  return () => finish(null);   // the caller's "client gone"
}

// ---------- plan
const planFile = p => path.join(vhDir(p), 'plan.json');
export function readPlan(p) { const b = readJson(planFile(p), null); return b && Array.isArray(b.versions) ? b : { versions: [] }; }
export const currentPlan = p => readPlan(p).versions.at(-1) || null;
export const planSeconds = v => (v?.scenes || []).reduce((s, x) => s + (+x.seconds || 0), 0);
export function writePlan(p, body) {
  const scenes = Array.isArray(body?.scenes) ? body.scenes : null;
  if (!scenes || !scenes.length) throw fail(400, 'scenes: give at least one scene ({title, seconds, narration})');
  if (scenes.length > 200) throw fail(400, 'scenes: at most 200');
  let start = 0;
  const list = scenes.map((s, i) => {
    const title = str(s?.title, 120), seconds = +s?.seconds;
    if (!title) throw fail(400, `scene ${i + 1}: title is required`);
    if (!Number.isFinite(seconds) || seconds <= 0 || seconds > 3600) throw fail(400, `scene ${i + 1}: seconds must be a number above 0`);
    const sc = { n: i + 1, title, seconds: Math.round(seconds * 100) / 100, start: Math.round(start * 1000) / 1000, narration: str(s?.narration, 4000), note: str(s?.note, 1000) || null, state: 'planned' };
    start += seconds; return sc;
  });
  const book = readPlan(p), v = (book.versions.at(-1)?.v || 0) + 1;
  const version = { v, at: now(), summary: str(body.summary, 2000), scenes: list, approvedAt: null };
  book.versions.push(version); writeJson(planFile(p), book);
  emit({ project: p.id, what: 'plan', v });
  return version;
}
function editCurrent(p, v, fn) {
  const book = readPlan(p), cur = book.versions.at(-1);
  if (!cur) throw fail(404, 'This film has no plan');
  if (v != null && +v !== cur.v) throw fail(409, `The plan changed meanwhile: it is v${cur.v} now`);
  const r = fn(cur); writeJson(planFile(p), book);
  emit({ project: p.id, what: 'plan', v: cur.v });
  return r ?? cur;
}
const sceneOf = (cur, n) => { const sc = cur.scenes.find(s => s.n === +n); if (!sc) throw fail(404, `Plan v${cur.v} has no scene ${n}`); return sc; };
// the agent built these scenes: they can be watched now (an approved scene stays approved)
export function markBuilt(p, ns) {
  return editCurrent(p, null, cur => { for (const n of ns || []) { const sc = sceneOf(cur, n); if (sc.state !== 'approved') { sc.state = 'ready'; sc.builtAt = now(); } } });
}
export function approvePlan(p, v) {
  let cur;
  editCurrent(p, v, c => { cur = c; if (!c.approvedAt) c.approvedAt = now(); });
  return push(p, { type: 'plan-approved', v: cur.v, scenes: cur.scenes.length, seconds: planSeconds(cur) });
}
export function approveScene(p, v, n) {
  let sc, ver;
  editCurrent(p, v, c => { ver = c.v; sc = sceneOf(c, n); sc.state = 'approved'; sc.approvedAt = now(); });
  return push(p, { type: 'scene-approved', v: ver, n: sc.n, title: sc.title });
}
// a note on one scene: a regular review note over the scene's time range (so it shows in Review and goes through the
// usual fixed / approved steps), sent to the agent at once, and the scene marked "change requested"
export async function sceneNote(p, v, n, text, { file = null, fps = null } = {}) {
  const t = str(text, 4000); if (!t) throw fail(400, 'Write the note first');
  const cur = currentPlan(p); if (!cur) throw fail(404, 'This film has no plan');
  if (v != null && +v !== cur.v) throw fail(409, `The plan changed meanwhile: it is v${cur.v} now`);
  const sc = sceneOf(cur, n);
  const note = await notesApi.add(p, { t: sc.start, t2: Math.max(sc.start, sc.start + sc.seconds - 0.01), file, fps, kind: 'general', text: `Scene ${sc.n} (${sc.title}): ${t}` });
  notesApi.markSent(p, [note.id]);
  editCurrent(p, cur.v, c => { const s = sceneOf(c, n); s.state = 'changes'; s.changedAt = now(); });
  push(p, { type: 'scene-note', v: cur.v, n: sc.n, title: sc.title, note: note.id });
  return note;
}

// ---------- questions
const qFile = p => path.join(vhDir(p), 'questions.json');
export function readQuestions(p) { const b = readJson(qFile(p), null); return b && Array.isArray(b.list) ? b : { seq: 0, list: [] }; }
const IMG = /\.(png|jpe?g|webp|gif)$/i;
// a picture option: a file inside the film folder (after links are followed); stored relative to the film
export function questionImage(p, rel) {
  if (typeof rel !== 'string' || !rel.trim() || p.group) return null;
  const abs = path.resolve(p.path, rel.trim());
  let real; try { real = fs.realpathSync(abs); } catch { return null; }
  let root; try { root = fs.realpathSync(p.path); } catch { return null; }
  if (!isInside(real, root) || !IMG.test(real) || !fs.statSync(real).isFile()) return null;
  return { rel: path.relative(root, real).split(path.sep).join('/'), abs: real };
}
export function ask(p, body) {
  const question = str(body?.question, 600); if (!question) throw fail(400, 'question is required');
  const raw = Array.isArray(body?.options) ? body.options : [];
  if (raw.length > 8) throw fail(400, 'options: at most 8');
  const bad = [];
  const options = raw.map((o, i) => {
    const label = str(typeof o === 'string' ? o : o?.label, 120); if (!label) throw fail(400, `option ${i + 1}: label is required`);
    let image = null;
    if (o?.image) { const im = questionImage(p, o.image); if (!im) bad.push(`option ${i + 1}: "${o.image}" is not a picture inside the film folder`); else image = im.rel; }
    return { label, detail: str(o?.detail, 400) || null, image };
  });
  if (bad.length) throw fail(400, bad.join('; ') + ' (use a .png/.jpg/.webp/.gif path relative to the film folder)');
  let rec = null;
  if (body?.recommended != null && body.recommended !== '') {
    const r = body.recommended, byLabel = options.findIndex(o => o.label.toLowerCase() === String(r).trim().toLowerCase());
    rec = byLabel >= 0 ? byLabel : Number.isInteger(+r) && +r >= 1 && +r <= options.length ? +r - 1 : null;
    if (rec == null) throw fail(400, 'recommended: the label of one of the options (or its number, 1 = first)');
  }
  const book = readQuestions(p), q = { id: 'q' + (book.seq + 1), at: now(), question, options, recommended: rec, state: 'open', answer: null };
  book.seq++; book.list.push(q);
  if (book.list.length > 200) book.list = book.list.filter(x => x.state === 'open').concat(book.list.filter(x => x.state !== 'open').slice(-100));
  writeJson(qFile(p), book);
  emit({ project: p.id, what: 'question', id: q.id });
  return q;
}
export function answer(p, qid, body) {
  const book = readQuestions(p), q = book.list.find(x => x.id === qid);
  if (!q) throw fail(404, 'No such question');
  const text = str(body?.text, 2000);
  const idx = body?.option == null || body.option === '' ? null : +body.option;
  if (idx != null && !(Number.isInteger(idx) && idx >= 0 && idx < q.options.length)) throw fail(400, 'No such option');
  if (idx == null && !text) throw fail(400, q.options.length ? 'Pick an option (or write an answer)' : 'Write an answer');
  const changed = q.state === 'answered';
  q.state = 'answered'; q.answer = { option: idx, label: idx != null ? q.options[idx].label : null, text: text || null, at: now() };
  writeJson(qFile(p), book);
  emit({ project: p.id, what: 'question', id: q.id });
  return push(p, { type: 'answer', q: q.id, question: q.question, option: idx, label: q.answer.label, text: q.answer.text, changed });
}

// ---------- "Send to agent": the open notes not sent yet go into the inbox (a waiting agent gets them at once)
export function sendNotes(p, ids) {
  const want = Array.isArray(ids) && ids.length ? new Set(ids.map(Number)) : null;
  const notes = notesApi.list(p).filter(n => isOpenNote(n) && !n.sentAt && (!want || want.has(n.id)));
  if (!notes.length) return { count: 0, ids: [], waiting: waitingOn(p.id) };
  const w = waitingOn(p.id), waiting = w?.open ? w : null;   // before the push: an open wait takes them at once
  notesApi.markSent(p, notes.map(n => n.id));
  push(p, { type: 'notes', ids: notes.map(n => n.id) });
  return { count: notes.length, ids: notes.map(n => n.id), waiting };
}

// ---------- the film's channel for the UI (drawer, Plan tab, notes panel)
export function state(p) {
  const book = readPlan(p), plan = book.versions.at(-1) || null, qs = readQuestions(p).list;
  return {
    plan, versions: book.versions.map(v => ({ v: v.v, at: v.at, scenes: v.scenes.length, seconds: planSeconds(v), approvedAt: v.approvedAt })),
    questions: [...qs.filter(q => q.state === 'open'), ...qs.filter(q => q.state !== 'open').slice(-10).reverse()],
    waiting: waitingOn(p.id), queued: undelivered(p).length, recent: recent(p),
  };
}

export function routes(route, readBody, { project, fileFor = () => null, fps = () => null }) {
  const need = id => { const p = project(id); if (!p) throw fail(404, 'Project not found'); return p; };
  route('GET', '/api/project/:id/channel', (req, url, { id }) => state(need(id)));
  route('GET', '/api/channel', () => ({ waiting: waitingAll() }));
  // the agent's side (hub_plan, hub_ask, hub_wait)
  route('POST', '/api/project/:id/plan', async (req, url, { id }) => { const p = need(id); const b = await readBody(req); return b.scenes ? writePlan(p, b) : markBuilt(p, b.built); });
  route('POST', '/api/project/:id/questions', async (req, url, { id }) => ask(need(id), await readBody(req)));
  route('GET', '/api/project/:id/wait', (req, url, { id }, res) => new Promise((resolve, reject) => {
    const agent = str(url.searchParams.get('agent') || '', 40) || null;
    let gone = null, settled = false;
    const done = items => { if (settled) return; settled = true; if (items === null) return resolve(undefined); resolve({ items, waiting: waitingOn(id), at: now() }); };
    try { gone = wait(project, id, { seconds: +url.searchParams.get('seconds') || 50, agent }, done); } catch (e) { return reject(e); }
    // the agent gave up (tool timeout, cancelled, process ended): forget the wait, keep the items for the next one
    res.on('close', () => { if (!settled && typeof gone === 'function') gone(); });
  }));
  // the user's side (VideoHub's UI)
  route('POST', '/api/project/:id/plan/approve', async (req, url, { id }) => { const b = await readBody(req); return approvePlan(need(id), b.v); });
  route('POST', '/api/project/:id/plan/scene/:n/approve', async (req, url, { id, n }) => { const b = await readBody(req); return approveScene(need(id), b.v, n); });
  route('POST', '/api/project/:id/plan/scene/:n/note', async (req, url, { id, n }) => { const p = need(id), b = await readBody(req); return sceneNote(p, b.v, n, b.text, { file: fileFor(p), fps: fps(p) }); });
  route('POST', '/api/project/:id/question/:qid/answer', async (req, url, { id, qid }) => answer(need(id), qid, await readBody(req)));
  route('POST', '/api/project/:id/notes/send', async (req, url, { id }) => { const b = await readBody(req); return sendNotes(need(id), b.ids); });
  route('GET', '/api/project/:id/question/:qid/image/:i', (req, url, { id, qid, i }, res) => {
    const p = need(id), q = readQuestions(p).list.find(x => x.id === qid), im = q?.options?.[+i]?.image ? questionImage(p, q.options[+i].image) : null;
    if (!im) { res.writeHead(404); return res.end(); }
    const ext = path.extname(im.abs).toLowerCase(), type = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : ext === '.gif' ? 'image/gif' : 'image/jpeg';
    res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-cache' }); fs.createReadStream(im.abs).on('error', () => res.destroy()).pipe(res);
  });
}
