// "Render leftovers: 12.4 GB in 9 projects — Review · Clean now · Later": VideoHub looks for render leftovers by itself
// and asks; nothing moves before the user clicks (the banner on every page, ui/leftovers.js).
//
// When it looks (the hub calls check()): after the first scan settled, ~45 s after a render job finished (the rescan has
// seen the new film by then) and every 6 h while the hub runs. Never while a render runs or waits in the queue, render
// protection tracks a render, or a cleanup runs: then the last answer stays as it was.
// What it asks about: the janitor's PROMPT_RULES (silent intermediates, the render script's film_final copies, replaced
// chunks, Chrome profiles / temporary files, chunks of films not rendered for chunkDays), only what goes to the Recycle
// Bin / Trash, counted by the space it really frees (hard links counted). Below autoCleanMinMB it does not ask.
// "Later" keeps the same set quiet for 24 h (data/leftover-prompt.json, so a restart keeps it); a set with a new item, or
// one that frees at least the threshold more, asks again. "Clean now" moves exactly the asked-about items, and only items
// of these rules, through the janitor's one cleanup run (progress, results, janitor-log.jsonl, ciktilar.afterClean).
//
// deps: candidates(fresh) (the janitor's list), rules (Set), busy() (why not now, or null), startClean(ids, opts),
// config(), file (snooze state), readJson/writeJson, now(), onChange(state), notify(prompt) (no window open: a desktop
// notification, once per set)
import crypto from 'node:crypto';

export const SNOOZE_MS = 24 * 3600e3;
export const AFTER_RENDER_MS = 45e3;
export const EVERY_MS = 6 * 3600e3;
export const LABELS = { silent: 'Silent intermediate renders', renderCopy: 'Script copies (film_final)', oldChunks: 'Replaced chunks', leftover: 'Chrome profiles and temporary files', staleChunks: 'Chunks of films not rendered lately' };

const freedOf = c => c.freed ?? c.size ?? 0;

// what the banner would say about this candidate list (no threshold, no snooze)
export function summarize(cands, rules) {
  const items = (cands || []).filter(c => rules.has(c.rule) && c.action === 'recycle');
  const perRule = {}, films = new Map();
  let freed = 0, size = 0;
  for (const c of items) {
    const f = freedOf(c); freed += f; size += c.size || 0;
    const r = perRule[c.rule] ||= { count: 0, freed: 0, size: 0 }; r.count++; r.freed += f; r.size += c.size || 0;
    const k = c.project || c.projectName || '?', m = films.get(k) || { id: c.project || null, name: c.projectName || '', freed: 0 }; m.freed += f; films.set(k, m);
  }
  const ids = items.map(c => c.id).sort();
  return { ids, count: items.length, freed, size, projects: films.size, perRule, films: [...films.values()].sort((a, b) => b.freed - a.freed),
    key: crypto.createHash('sha1').update(ids.join(',')).digest('hex').slice(0, 16) };
}

export function createLeftovers(deps) {
  const now = deps.now || (() => Date.now());
  let state = { prompt: null, summary: null, checkedAt: 0, reason: null, skipped: null };
  let snooze = deps.readJson(deps.file, null) || {};
  const save = () => { try { deps.writeJson(deps.file, snooze); } catch { } };
  const minBytes = () => Math.max(0, +(deps.config().autoCleanMinMB ?? 500) || 0) * 1048576;
  const enabled = () => deps.config().autoCleanPrompt !== false;
  // "Later": the same set (or part of it) stays quiet until the snooze ends, unless it now frees the threshold more
  function snoozed(s) {
    const z = snooze.later; if (!z || !(z.until > now())) return false;
    const was = new Set(z.ids || []);
    return s.ids.every(id => was.has(id)) && s.freed < (z.freed || 0) + Math.max(minBytes(), 1);
  }
  const publicState = () => ({ prompt: state.prompt, summary: state.summary && { count: state.summary.count, freed: state.summary.freed, size: state.summary.size, projects: state.summary.projects, perRule: state.summary.perRule },
    checkedAt: state.checkedAt, reason: state.reason, skipped: state.skipped, enabled: enabled(), minMB: minBytes() / 1048576, snoozedUntil: snooze.later?.until > now() ? snooze.later.until : null, labels: LABELS });
  let running = null;
  // reason: 'start' | 'render' | 'interval' | 'scan' | 'settings' | 'manual'; fresh: count again now instead of using the
  // janitor's list of the last minute (a scan always clears that); raise: false only updates the numbers and an open question
  // (after a scan or a cleanup), it never raises a new one. Answers what the banner shows now.
  async function check(reason = 'manual', { fresh = false, raise = true } = {}) {
    if (running) return running;
    running = (async () => {
      const why = deps.busy();
      if (why) { state.skipped = { at: now(), why }; return publicState(); }   // never look while a render or cleanup runs
      const s = summarize(await deps.candidates(fresh), deps.rules);
      const before = state.prompt?.key || null;
      state = { ...state, summary: s, checkedAt: now(), reason, skipped: null };
      const ask = enabled() && s.count > 0 && s.freed >= minBytes() && !snoozed(s) && (raise || !!before);
      state.prompt = ask ? { key: s.key, at: now(), reason, freed: s.freed, size: s.size, count: s.count, projects: s.projects, perRule: s.perRule, films: s.films.slice(0, 12), ids: s.ids } : null;
      if ((state.prompt?.key || null) !== before) {
        deps.onChange?.(publicState());
        if (state.prompt && snooze.notified !== state.prompt.key) { snooze.notified = state.prompt.key; save(); try { deps.notify?.(state.prompt); } catch { } }
      }
      return publicState();
    })().finally(() => { running = null; });
    return running;
  }
  function later(key) {
    if (!state.prompt || state.prompt.key !== key) throw Object.assign(new Error('The leftovers changed meanwhile; look again.'), { code: 409 });
    snooze.later = { key, ids: state.prompt.ids, freed: state.prompt.freed, until: now() + SNOOZE_MS, at: now() };
    save(); state.prompt = null; deps.onChange?.(publicState());
    return publicState();
  }
  // "Clean now": exactly the items asked about, and only items of the prompt's rules
  async function clean(key) {
    if (!state.prompt || state.prompt.key !== key) throw Object.assign(new Error('The leftovers changed meanwhile; look again.'), { code: 409 });
    const why = deps.busy();
    if (why) throw Object.assign(new Error(`Not now: ${why}.`), { code: 409 });
    const st = await deps.startClean(state.prompt.ids, { rules: deps.rules, kind: 'leftovers', via: 'banner' });
    state.prompt = null; deps.onChange?.(publicState());
    return st;
  }
  // a scan (also the one after every cleanup) ended: the numbers follow; an open question changes or goes with them,
  // a new one waits for the next look
  const recheck = () => check('scan', { raise: false });
  // the Films page's tile: the numbers from the janitor's current list (it never raises the banner)
  async function peek() { state.summary = summarize(await deps.candidates(false), deps.rules); return publicState(); }
  return { check, later, clean, recheck, peek, state: publicState };
}
