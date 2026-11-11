import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
const cache = new Map(), gens = new Map(), watched = new Set();
const skip = /^(node_modules|\.git|\.videohub|render|out|chunks.*|snaps|qa|profiles?|tmp|audio|fonts|vh2d|vhaudio)$/i;
const code = /\.(?:m?js|html|css|json|glsl|frag|vert)$/i;
// tweaks.json is edited live by the review page without a reload (live.watch ignores it too); counting it made
// the open page's revision stale after every edit, so its cover save got a 409.
const notCode = /^tweaks\.json$/i;
// Walking every project's code on each /api/projects took ~0.5 s for 184 projects (it was cached 1 s). Now a revision
// stays until something says it changed: the live watcher (watched projects never go stale), rescanProject, a full
// scan (refreshSources, in the background). Unwatched projects are re-walked in the background once older than STALE.
// Callers that must be right (live info, live-thumb uploads) pass { fresh: true }.
const STALE = 5 * 60e3;
const keyOf = p => p.id || p.path;
export function invalidateSource(p) { const k = keyOf(p); cache.delete(k); gens.set(k, (gens.get(k) || 0) + 1); }
export function watchSource(p, on = true) { on ? watched.add(keyOf(p)) : watched.delete(keyOf(p)); }
// the walk, as a generator that pauses every 300 entries (the background refresh yields there, the sync path runs through)
function* collect(p) {
  const roots = [p.path, ...(p.studio ? [path.join(p.studio, 'engine')] : [])];
  const parts = []; let stamp = 0, count = 0, n = 0;
  const add = f => { try { const st = fs.statSync(f); if (!st.isFile()) return; parts.push(f + ':' + st.size + ':' + st.mtimeMs); stamp = Math.max(stamp, st.mtimeMs); } catch {} };
  for (const root of roots) {
    count = 0;
    const stack = [root];
    while (stack.length && count < 4000) {
      const dir = stack.pop(); let entries = [];
      try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
      for (const e of entries) {
        if (++count > 4000) break;
        if (++n % 300 === 0) yield;
        if (e.isSymbolicLink()) continue;
        const f = path.join(dir, e.name);
        if (e.isDirectory()) { if (!skip.test(e.name)) stack.push(f); }
        else if (code.test(e.name) && !notCode.test(e.name)) add(f);
      }
    }
  }
  add(path.join(p.path, '.videohub', 'project.json'));
  return { at: Date.now(), stamp: Math.round(stamp), revision: crypto.createHash('sha1').update(parts.sort().join('\n')).digest('hex').slice(0, 16) };
}
function computeSync(p) { const it = collect(p); let r; do r = it.next(); while (!r.done); cache.set(keyOf(p), r.value); return r.value; }
export function sourceRevision(p, { fresh = false } = {}) {
  const hit = !fresh && cache.get(keyOf(p));
  if (!hit) return computeSync(p);
  if (!watched.has(keyOf(p)) && Date.now() - hit.at > STALE) refreshSources([p]);
  return hit;
}
// background refresh, one project after another, yielding to requests; a change seen meanwhile (gen) wins
const queue = new Map(); let running = false;
export function refreshSources(list) {
  for (const p of list) if (!p.group && p.rootType !== 'media') queue.set(keyOf(p), p);
  if (running || !queue.size) return;
  running = true;
  (async () => {
    try {
      while (queue.size) {
        const [k, p] = queue.entries().next().value; queue.delete(k);
        const gen = gens.get(k) || 0, it = collect(p); let r;
        while (!(r = it.next()).done) await new Promise(res => setImmediate(res));
        if ((gens.get(k) || 0) === gen) cache.set(k, r.value);
        await new Promise(res => setImmediate(res));
      }
    } finally { running = false; }
  })();
}
