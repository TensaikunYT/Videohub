import { norm } from './util.js';
// Live preview: play a film straight from its code, no render. Our films draw any moment with
// window.renderOut(t) on fixed-size canvases and set window.READY; render.js only screenshots that.
// Here the hub serves the project's page at /live/<id>/..., says where its audio is, and tells open
// players when the code changed so they can reload in place.
import fs from 'node:fs';
import path from 'node:path';
import { probe, isInside } from './util.js';
import { readMeta } from './legacy.js';
import { vhDir } from './notes.js';
import { recipe } from './jobs.js';
import { sourceRevision, invalidateSource, watchSource } from './source-revision.js';

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif',
  '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf', '.otf': 'font/otf', '.wav': 'audio/wav', '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.ogg': 'audio/ogg',
  '.glb': 'model/gltf-binary', '.gltf': 'model/gltf+json', '.bin': 'application/octet-stream', '.hdr': 'application/octet-stream', '.ktx2': 'image/ktx2',
  '.glsl': 'text/plain; charset=utf-8', '.txt': 'text/plain; charset=utf-8', '.wasm': 'application/wasm',
};
const AUDIO = /\.(wav|mp3|m4a|ogg|aac|flac)$/i;
// at any depth: a studio scene keeps its notes in scenes\<name>\.videohub, and saving a note reloaded the live preview
const SKIP = /(^|[\\/])(render|snaps|out|node_modules|\.videohub|chunks[^\\/]*|tmp|profiles?|\.git|vh2d|vhaudio)([\\/]|$)/i;   // vh2d/vhaudio: pictures and sounds added in VideoHub (the editors show them already)

const read = f => { try { return fs.readFileSync(f, 'utf8'); } catch { return ''; } };

// the page render.js opens (PAGE env, a goto(.../x.html) or path.resolve('x.html')), else index.html
function pageOf(p, rc, meta) {
  if (meta.live?.page) return meta.live.page;
  if (rc.env?.PAGE) return rc.env.PAGE;
  const js = read(path.join(p.path, rc.script || 'render.js'));
  const m = js.match(/PAGE\s*=\s*process\.env\.PAGE\s*\|\|\s*['"]([\w.\-/]+\.html)['"]/) || js.match(/goto\([^)]*?\/([\w\-]+\.html)/) || js.match(/resolve\(\s*['"]([\w\-]+\.html)['"]/);
  if (m && fs.existsSync(path.join(p.path, m[1]))) return m[1];
  return fs.existsSync(path.join(p.path, 'index.html')) ? 'index.html' : null;
}

// does the page (or the scripts next to it) define window.renderOut?
function hasHook(p, page) {
  const html = read(path.join(p.path, page)); if (html.includes('renderOut')) return true;
  // scripts the page loads from its own folder (e.g. <script type=module src=main.js>)
  for (const m of html.matchAll(/<script[^>]*\ssrc=["']([^"':?#]+\.m?js)["']/gi)) if (read(path.join(p.path, path.dirname(page), m[1])).includes('window.renderOut')) return true;
  const stack = [path.join(p.path, 'src')]; let n = 0;
  while (stack.length && n < 400) {
    const d = stack.pop(); let es = []; try { es = fs.readdirSync(d, { withFileTypes: true }); } catch { continue; }
    for (const e of es) {
      const f = path.join(d, e.name);
      if (e.isDirectory()) stack.push(f);
      else if (/\.m?js$/.test(e.name) && ++n < 400 && read(f).includes('window.renderOut')) return true;
    }
  }
  return false;
}

// newest code file of a project (its folder, src/; a studio scene's own folder): a live thumbnail older than this is redrawn
export const codeStamp = p => sourceRevision(p).stamp;
export const codeRevision = (p, opts) => sourceRevision(p, opts).revision;   // { fresh: true } walks now (cards use the cached one)
// can this project play live? A cheap check for the cards, cached until its code changes
const capCache = new Map();
export function liveCapable(p) {
  if (p.group || p.rootType === 'media') return false;
  const stamp = codeRevision(p), c = capCache.get(p.id);
  if (c && c.stamp === stamp) return c.ok;
  let ok = false;
  try {
    if (p.studio) ok = read(path.join(p.studio, 'engine', 'runtime.js')).includes('window.renderOut');
    else {
      const meta = readMeta(path.join(vhDir(p), 'project.json'), {});
      const page = pageOf(p, { script: meta.render?.script || p.render?.script || 'render.js', env: meta.render?.env || {} }, meta);
      ok = !!page && hasHook(p, page);
    }
  } catch { }
  capCache.set(p.id, { stamp, ok }); return ok;
}

// the film's sound: a mix in audio/, else the inputs of render.mux, else any audio file, else the last render's track
export function audioOf(p, meta) {
  if (meta.live?.audio) { const f = path.resolve(p.path, meta.live.audio); if (fs.existsSync(f)) return f; }
  for (const c of ['audio/mix.wav', 'audio/mix.mp3', 'audio/final.wav', 'audio/master.wav', 'mix.wav', 'audio/mix.m4a']) { const f = path.join(p.path, c); if (fs.existsSync(f)) return f; }
  const mux = meta.render?.mux;
  if (Array.isArray(mux)) for (let i = 0; i < mux.length - 1; i++) if (mux[i] === '-i' && AUDIO.test(mux[i + 1])) { const f = path.resolve(p.path, mux[i + 1]); if (fs.existsSync(f)) return f; }
  const pool = [];
  for (const dir of ['audio', '.']) { let es = []; try { es = fs.readdirSync(path.join(p.path, dir)); } catch { } for (const e of es) if (AUDIO.test(e)) { const f = path.join(p.path, dir, e); try { pool.push({ f, size: fs.statSync(f).size, mix: /mix|final|master/i.test(e) ? 2 : /vo|voice|narration|ses/i.test(e) ? 1 : 0 }); } catch { } } }
  pool.sort((a, b) => b.mix - a.mix || b.size - a.size);
  if (pool.length) return pool[0].f;
  const fin = (p.outputs || []).filter(o => o.role === 'final' || o.role === 'web').sort((a, b) => b.mtime - a.mtime)[0];
  return fin?.path || null;
}

function sizeOf(p, rc, page) {
  // the page's own data (otomasyon films: data.js window.DATA = {"width":1080,"height":1920,...})
  if (page) for (const f of ['data.js', 'data.json']) {
    const m = read(path.join(p.path, path.dirname(page), f)).match(/"width"\s*:\s*(\d{3,4})\s*,\s*"height"\s*:\s*(\d{3,4})/);
    if (m) return { w: +m[1], h: +m[2] };
  }
  const js = read(path.join(p.path, rc.script || 'render.js'));
  const w = js.match(/\bVW\s*=\s*(\d{3,4})/), h = js.match(/\bVH\s*=\s*(\d{3,4})/);
  return { w: w ? +w[1] : 1920, h: h ? +h[1] : 1080 };
}

const rootOf = p => p.studio || p.path;   // where the page's files are served from
async function studioInfo(p) {
  const engine = read(path.join(p.studio, 'engine', 'runtime.js'));
  if (!engine.includes('window.renderOut')) return { ok: false, reason: 'The studio engine (engine/runtime.js) does not define window.renderOut.' };
  const audio = path.join(p.outDir, 'audio.wav'), hasAudio = fs.existsSync(audio);
  let dur = 0, durFrom = 'page';
  if (hasAudio) { try { dur = (await probe(audio)).dur || 0; durFrom = 'audio'; } catch { } }
  // fps, length and size come from the page itself (window.__config) once it loads
  return { ok: true, page: 'engine/index.html', url: `/live/${p.id}/engine/index.html?scene=${encodeURIComponent(p.name)}`, fps: 60, dur: dur || 10, durFrom, w: 1920, h: 1080,
    audio: hasAudio ? '/media?p=' + encodeURIComponent(audio) : null, audioPath: hasAudio ? audio : null, audioName: hasAudio ? `out/${p.name}/audio.wav` : null, chunkSec: null, studio: true };
}
export async function liveInfo(p) {
  if (p.studio) return { ...await studioInfo(p), revision: codeRevision(p, { fresh: true }) };
  const meta = readMeta(path.join(vhDir(p), 'project.json'), {});
  const rc = await recipe(p);
  const page = pageOf(p, rc, meta);
  if (!page) return { ok: false, reason: 'This project has no page to play (index.html, or the page its render script opens).' };
  if (!hasHook(p, page)) return { ok: false, page, reason: `"${page}" does not define window.renderOut(t); the live preview needs that hook (see docs/PROJECT-CONTRACT.md).` };
  const js = read(path.join(p.path, rc.script || 'render.js'));
  const fpsM = js.match(/\bFPS\s*=\s*(\d+)/);
  const fps = +(meta.live?.fps || (rc.fps !== 60 ? rc.fps : null) || (fpsM ? fpsM[1] : 0) || 60);
  const audio = audioOf(p, meta);
  let dur = +(meta.live?.dur || rc.env?.DUR || 0), durFrom = dur ? 'saved' : null;
  if (!dur && audio) { try { dur = (await probe(audio)).dur || 0; durFrom = 'audio'; } catch { } }
  if (!dur) { const last = (p.outputs || []).filter(o => o.dur).sort((a, b) => b.mtime - a.mtime)[0]; if (last) { dur = last.dur; durFrom = 'last video'; } }
  if (!dur) { dur = 60; durFrom = 'default'; }
  const { w, h } = sizeOf(p, rc, page);
  return { ok: true, revision: codeRevision(p, { fresh: true }), page, url: `/live/${p.id}/${page.split('/').map(encodeURIComponent).join('/')}`, fps, dur: +(+dur).toFixed(3), durFrom, w, h,
    audio: audio ? '/media?p=' + encodeURIComponent(audio) : null, audioPath: audio, audioName: audio ? path.relative(p.path, audio) : null, chunkSec: rc.chunkSec || null };
}

// GET /live/<id>/<file>: the project's own files, never cached (a reload must pick up Claude's edits)
export function serve(req, res, p, rel) {
  const base = rootOf(p), f = path.resolve(base, decodeURIComponent(rel || 'index.html'));
  if (!isInside(f, base)) { res.writeHead(403); return res.end(); }
  let st; try { st = fs.statSync(f); } catch { res.writeHead(404); return res.end('404'); }
  const file = st.isDirectory() ? path.join(f, 'index.html') : f;
  if (!fs.existsSync(file)) { res.writeHead(404); return res.end('404'); }
  const type = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
  // pages may use absolute paths (an importmap to /node_modules/...): point them into this project, and remember
  // the project in a cookie so other absolute requests from the page (fetch('/data/..')) still find their files
  const head = { 'Content-Type': type, 'Cache-Control': 'no-store', 'Set-Cookie': `vhlive=${p.id}; Path=/; SameSite=Strict` };
  if (/\.html?$/i.test(file)) {
    const pre = `/live/${p.id}/`;
    let html = fs.readFileSync(file, 'utf8');
    html = html.replace(/(<script[^>]*type=["']importmap["'][^>]*>)([\s\S]*?)(<\/script>)/gi, (m, a, json, c) => a + json.replace(/"\/(?!\/)/g, '"' + pre) + c)
      .replace(/(\s(?:src|href)=["'])\/(?!\/)/gi, '$1' + pre);
    res.writeHead(200, head); return res.end(html);
  }
  res.writeHead(200, head);
  fs.createReadStream(file).on('error', () => res.destroy()).pipe(res);
}

// code changes → open live players reload. One watcher per project, started when a player asks for the info.
const watchers = new Map();
// files VideoHub writes itself (the mix with the scene editor's sound levels): not a code change, for a few seconds
const quiet = new Map();
export function quietFile(file, ms = 4000) { quiet.set(norm(file), Date.now() + ms); }
export function watch(p, onChange) {
  if (watchers.has(p.id)) return;
  let timer = null, files = new Set();
  // On Windows fs.watch also reports files being READ (last-access time): serving the page's own files made the
  // preview reload itself ("Code changed" with nothing changed). Only a newer modification time counts.
  const root = rootOf(p), since = Date.now(), mtimes = new Map();
  const reallyChanged = name => {
    let m; try { m = fs.statSync(path.join(root, name)).mtimeMs; } catch { return true; }   // deleted or renamed: a change
    const prev = mtimes.has(name) ? mtimes.get(name) : since; mtimes.set(name, m);
    return m > prev;
  };
  try {
    const w = fs.watch(root, { recursive: true }, (ev, name) => {
      if (!name || SKIP.test(name) || /(^|[\\/])tweaks\.json$/i.test(name) || !/\.(m?js|html|css|json|glsl|frag|vert|png|jpe?g|webp|svg|wav|mp3|woff2?|ttf|otf|glb|gltf|bin)$/i.test(name)) return;
      if (/\.(vhtmp|vhorig\.wav)$/i.test(name) || (quiet.get(norm(path.resolve(root, name))) || 0) > Date.now()) return;
      if (!reallyChanged(name)) return;
      invalidateSource(p);
      files.add(name.replace(/\\/g, '/')); clearTimeout(timer);
      timer = setTimeout(() => { onChange({ project: p.id, files: [...files].slice(0, 20) }); files = new Set(); }, 600);
    });
    w.on('error', () => { watchers.delete(p.id); watchSource(p, false); invalidateSource(p); });
    watchers.set(p.id, w); watchSource(p);
  } catch { }
}
