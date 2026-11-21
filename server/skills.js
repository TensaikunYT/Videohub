// The Skills page: the agents' skill folders, read-only. A skill is a folder with a SKILL.md.
//   Claude Code  ~/.claude/skills (and $CLAUDE_CONFIG_DIR/skills)
//   Codex        ~/.codex/skills (and $CODEX_HOME/skills; its own .system/<name> skills too)
//   OpenCode     $XDG_CONFIG_HOME/opencode/skills (~/.config/opencode/skills)
//   Shared       ~/.agents/skills (read by several agents)
// Skills are looked for up to DEPTH folders below a root (a folder with a SKILL.md is a skill and is not searched
// further), so nested layouts such as <root>/synced/<bucket>/<name> (the desktop app's synced skills) and Codex's
// <root>/.system/<name> are found. Plugin caches are not read.
// Every file path is resolved with realpath and must stay inside its skill folder: no "..", no absolute paths, no
// link or junction leading out. Nothing here writes to a skill.
import fsDefault from 'node:fs';
import pathDefault from 'node:path';
import osDefault from 'node:os';
import crypto from 'node:crypto';
import { pathKey as pathKeyDefault } from './platform.js';
import { parseFrontMatter } from '../ui/markdown.js';

export const SKILL_AGENTS = { claude: 'Claude Code', codex: 'Codex', opencode: 'OpenCode', shared: 'Shared' };
export const DEPTH = 3;                 // <root>/<name> is depth 1; <root>/synced/<bucket>/<name> is depth 3
export const TEXT_MAX = 256 * 1024;     // larger files get an info card, not their text
const TREE_MAX = 2000, COUNT_MAX = 5000, SKIP = new Set(['.git', 'node_modules', '__pycache__']);

export function skillRoots({ home = osDefault.homedir(), env = process.env, path = pathDefault, key = pathKeyDefault } = {}) {
  const roots = [];
  const add = (agent, dir) => { if (dir && !roots.some(r => key(r.dir) === key(dir))) roots.push({ agent, dir }); };
  add('claude', path.join(home, '.claude', 'skills'));
  if (env.CLAUDE_CONFIG_DIR) add('claude', path.join(env.CLAUDE_CONFIG_DIR, 'skills'));
  add('codex', path.join(home, '.codex', 'skills'));
  if (env.CODEX_HOME) add('codex', path.join(env.CODEX_HOME, 'skills'));
  add('opencode', path.join(env.XDG_CONFIG_HOME || path.join(home, '.config'), 'opencode', 'skills'));
  add('shared', path.join(home, '.agents', 'skills'));
  return roots;
}
// "anthropic-skills:docx" (a namespaced name in a Skill call) → "docx"
export const bareName = n => String(n || '').trim().replace(/^[\w.-]+:/, '');
export const skillHash = text => crypto.createHash('sha1').update(String(text).replace(/\r\n?/g, '\n').replace(/\s+$/, '')).digest('hex').slice(0, 12);
const isInsideKey = (k, base, path) => k === base || k.startsWith(base.endsWith(path.sep) ? base : base + path.sep);

export function createSkills({ home = osDefault.homedir(), env = process.env, fs = fsDefault, path = pathDefault, key = pathKeyDefault, ttlMs = 30e3,
  now = () => Date.now(), breather = () => new Promise(r => setImmediate(r)) } = {}) {
  const roots = skillRoots({ home, env, path, key });
  let cache = null, building = null;
  // Sync calls with a yield every 300 entries or 12 ms, like scan.js: right after the hub starts, the cleanup scan holds the event
  // loop in chunks and every await waits for one of them (an await per file took ~30 s for ~100 skills there).
  let n = 0, t = performance.now();
  const yieldSome = async () => { if (++n >= 300 || performance.now() - t >= 12) { n = 0; await breather(); t = performance.now(); } };
  const statOf = f => { try { return fs.statSync(f); } catch { return null; } };
  const readHead = (file, max) => {
    const fd = fs.openSync(file, 'r');
    try { const st = fs.fstatSync(fd); const buf = Buffer.alloc(Math.min(st.size, max)); const got = fs.readSync(fd, buf, 0, buf.length, 0); return { buf: buf.subarray(0, got), size: st.size, mtime: st.mtimeMs }; }
    finally { fs.closeSync(fd); }
  };
  const realOf = f => { try { return fs.realpathSync.native(f); } catch (e) { if (e.code === 'ENOENT' || e.code === 'ENOTDIR') throw e; return fs.realpathSync(f); } };
  // the skill folders under one root (breadth first, so a shallow skill wins over a deeper one of the same name)
  async function findIn(root) {
    const out = [], seen = new Set();
    let queue = [{ dir: root.dir, depth: 0 }], visited = 0;
    while (queue.length && visited < 3000) {
      const next = [];
      for (const { dir, depth } of queue) {
        let ents; try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
        visited++;
        for (const e of ents) {
          await yieldSome();
          if (!(e.isDirectory() || e.isSymbolicLink()) || SKIP.has(e.name)) continue;
          const full = path.join(dir, e.name);
          if (!e.isDirectory() && !statOf(full)?.isDirectory()) continue;   // a linked skill folder is allowed
          const md = statOf(path.join(full, 'SKILL.md'));
          if (md?.isFile()) {
            if (seen.has(e.name.toLowerCase())) continue;
            seen.add(e.name.toLowerCase());
            const where = path.relative(root.dir, dir).split(path.sep).filter(Boolean).join('/');
            out.push({ agent: root.agent, name: e.name, dir: full, root: root.dir, where, mdSize: md.size, mdMtime: md.mtimeMs });
          } else if (depth + 1 < DEPTH) next.push({ dir: full, depth: depth + 1 });
        }
      }
      queue = next;
    }
    return out;
  }
  // file count and size of a skill folder (links are not followed)
  async function measure(dir) {
    let files = 0, size = 0, seen = 0, capped = false; const stack = [dir];
    while (stack.length) {
      const d = stack.pop(); let ents; try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch { continue; }
      for (const e of ents) {
        if (++seen > COUNT_MAX) { capped = true; stack.length = 0; break; }
        await yieldSome();
        const full = path.join(d, e.name);
        if (e.isDirectory()) { if (!SKIP.has(e.name)) stack.push(full); }
        else if (e.isFile()) { const st = statOf(full); if (st) { size += st.size; files++; } }
      }
    }
    return { files, size, capped };
  }
  async function build() {
    const t0 = now(), list = [], rootInfo = [];
    for (const r of roots) {
      const exists = !!statOf(r.dir)?.isDirectory();
      const found = exists ? await findIn(r) : [];
      rootInfo.push({ agent: r.agent, dir: r.dir, exists, count: found.length });
      for (const s of found) {
        try {
          const { buf } = readHead(path.join(s.dir, 'SKILL.md'), TEXT_MAX);
          const text = buf.toString('utf8'), fm = parseFrontMatter(text).data || {};
          s.description = typeof fm.description === 'string' ? fm.description.slice(0, 600) : '';
          s.title = typeof fm.name === 'string' ? fm.name.slice(0, 80) : '';
          s.version = typeof fm.version === 'string' || typeof fm.version === 'number' ? String(fm.version).slice(0, 20) : (fm.metadata && typeof fm.metadata.version === 'string' ? fm.metadata.version.slice(0, 20) : '');
          s.hash = skillHash(text);
        } catch { s.description = ''; s.hash = null; }
        Object.assign(s, await measure(s.dir));
        list.push(s);
      }
    }
    cache = { at: now(), ms: now() - t0, list, roots: rootInfo };
    return cache;
  }
  // cached; an older list is answered at once while a fresh one is built in the background
  async function all() {
    if (cache && now() - cache.at < ttlMs) return cache;
    if (!building) building = build().finally(() => { building = null; });
    return cache || building;
  }
  // one row per skill name; same name in several roots = one row with several agents (and whether their SKILL.md differ)
  function rows(c) {
    const by = new Map();
    for (const s of c.list) {
      const k = s.name.toLowerCase();
      if (!by.has(k)) by.set(k, { name: s.name, copies: [] });
      by.get(k).copies.push(s);
    }
    const order = Object.keys(SKILL_AGENTS);
    return [...by.values()].map(r => {
      r.copies.sort((a, b) => order.indexOf(a.agent) - order.indexOf(b.agent));
      const main = r.copies[0];
      return { name: r.name, description: main.description || r.copies.find(x => x.description)?.description || '', version: main.version || '',
        agents: r.copies.map(x => ({ agent: x.agent, label: SKILL_AGENTS[x.agent], where: x.where, files: x.files, size: x.size, hash: x.hash, mtime: x.mdMtime })),
        differs: new Set(r.copies.map(x => x.hash)).size > 1, files: main.files, size: main.size, mtime: Math.max(...r.copies.map(x => x.mdMtime || 0)) };
    }).sort((a, b) => a.name.localeCompare(b.name));
  }
  async function find(agent, name) {
    const c = await all();
    const low = String(name || '').toLowerCase();
    return c.list.find(s => s.agent === agent && s.name.toLowerCase() === low) || null;
  }
  // the folder's real location, and a path inside it from the client (relative, no "..", no links leading out)
  async function resolve(skill, rel) {
    if (typeof rel !== 'string' || !rel || rel.length > 1024 || /[\0\r\n:*?"<>|]/.test(rel)) throw Object.assign(new Error('Invalid path'), { code: 400 });
    if (path.isAbsolute(rel) || /^[\\/]/.test(rel) || /^[a-z]:/i.test(rel)) throw Object.assign(new Error('Only paths inside the skill folder'), { code: 400 });
    const parts = rel.split(/[\\/]+/).filter(Boolean);
    if (!parts.length || parts.some(p => p === '..' || p === '.')) throw Object.assign(new Error('Only paths inside the skill folder'), { code: 400 });
    let base, real;
    try { base = realOf(skill.dir); } catch { throw Object.assign(new Error('The skill folder is gone'), { code: 404 }); }
    try { real = realOf(path.join(skill.dir, ...parts)); } catch { throw Object.assign(new Error('Not found'), { code: 404 }); }
    if (!isInsideKey(key(real), key(base), path) || key(real) === key(base)) throw Object.assign(new Error('This path leads outside the skill folder'), { code: 403 });
    return real;
  }
  // the folder's files (capped); links leading outside are listed but not readable, linked folders are not entered
  async function tree(skill) {
    let base; try { base = realOf(skill.dir); } catch { return { entries: [], capped: false }; }
    const entries = []; let capped = false; const stack = [{ dir: skill.dir, rel: '', depth: 0 }];
    while (stack.length) {
      const { dir, rel, depth } = stack.pop();
      let ents; try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
      for (const e of ents) {
        if (entries.length >= TREE_MAX) { capped = true; break; }
        await yieldSome();
        const full = path.join(dir, e.name), r = rel ? rel + '/' + e.name : e.name;
        if (e.isDirectory()) { if (SKIP.has(e.name)) continue; entries.push({ rel: r, kind: 'dir' }); if (depth < 12) stack.push({ dir: full, rel: r, depth: depth + 1 }); continue; }
        if (e.isSymbolicLink()) {
          let real = null, st = null; try { real = realOf(full); st = fs.statSync(real); } catch { }
          const inside = real && isInsideKey(key(real), key(base), path);
          if (inside && st?.isFile()) entries.push({ rel: r, kind: 'file', size: st.size, mtime: st.mtimeMs, link: true });
          else entries.push({ rel: r, kind: 'link', outside: !inside, dir: !!st?.isDirectory() });
          continue;
        }
        if (e.isFile()) { const st = statOf(full); if (st) entries.push({ rel: r, kind: 'file', size: st.size, mtime: st.mtimeMs }); }
      }
      if (capped) break;
    }
    entries.sort((a, b) => a.rel.localeCompare(b.rel));
    return { entries, capped };
  }
  // a file's text (UTF-8, up to TEXT_MAX), or an info object for binaries and big files
  async function file(skill, rel) {
    const real = await resolve(skill, rel);
    const st = statOf(real); if (!st) throw Object.assign(new Error('Not found'), { code: 404 });
    const name = path.basename(real), ext = path.extname(name).slice(1).toLowerCase();
    const info = { path: rel.split(/[\\/]+/).filter(Boolean).join('/'), name, ext, size: st.size, mtime: st.mtimeMs };
    if (!st.isFile()) return { ...info, kind: 'folder' };
    if (st.size > TEXT_MAX) return { ...info, kind: 'large', reason: `Larger than ${TEXT_MAX / 1024} KB: not shown here.` };
    const { buf } = readHead(real, TEXT_MAX);
    if (buf.subarray(0, 8000).includes(0)) return { ...info, kind: 'binary', reason: 'Not a text file.' };
    let text; try { text = new TextDecoder('utf-8', { fatal: true }).decode(buf); } catch { return { ...info, kind: 'binary', reason: 'Not UTF-8 text.' }; }
    return { ...info, kind: 'text', text: text.replace(/^﻿/, '') };
  }
  return { roots, all, rows, find, tree, file, resolve, invalidate: () => { cache = null; } };
}
