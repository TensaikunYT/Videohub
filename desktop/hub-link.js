// The desktop shell's logic that needs no Electron, so `npm test` can check it: which port the hub uses, how to start
// it, which addresses stay inside the window, where the installed Node is, the window's remembered place and the
// background colour from the design tokens.
import fs from 'node:fs';
import path from 'node:path';

// the same order as server/tools.js: VIDEOHUB_PORT, then "port" in <data>/config.json, then 7788
export function dataDir(hubDir, env = process.env) {
  return env.VIDEOHUB_DATA_DIR ? path.resolve(env.VIDEOHUB_DATA_DIR) : path.join(hubDir, 'data');
}
export function hubPort({ hubDir, env = process.env, readFile = f => fs.readFileSync(f, 'utf8') }) {
  let cfg = {};
  try { cfg = JSON.parse(readFile(path.join(dataDir(hubDir, env), 'config.json'))) || {}; } catch { }
  const n = +env.VIDEOHUB_PORT || +cfg.port || 7788;
  if (!Number.isInteger(n) || n < 1 || n > 65535) throw new Error('Invalid VideoHub port: ' + (env.VIDEOHUB_PORT || cfg.port));
  return n;
}
export const hubOrigin = port => `http://127.0.0.1:${port}`;

// navigation inside the window: only the hub itself (same scheme, host and port)
export function isHubUrl(url, origin) {
  try { return new URL(url).origin === new URL(origin).origin; } catch { return false; }
}
// everything else may go to the default browser, but only plain web addresses (no file:, javascript:, custom schemes)
export function externalUrl(url) {
  try { const u = new URL(url); return u.protocol === 'http:' || u.protocol === 'https:' ? u.href : null; } catch { return null; }
}

// the installed Node.js (the shell runs inside Electron, whose own executable is not Node)
export function findNode({ env = process.env, platform = process.platform, exists = f => { try { return fs.statSync(f).isFile(); } catch { return false; } } } = {}) {
  const win = platform === 'win32', sep = win ? ';' : ':', p = win ? path.win32 : path.posix;
  const pathVar = env.PATH ?? env.Path ?? Object.entries(env).find(([k]) => k.toUpperCase() === 'PATH')?.[1] ?? '';
  const dirs = pathVar.split(sep).map(d => d.trim().replace(/^"(.*)"$/, '$1')).filter(Boolean);
  if (win) dirs.push(p.join(env.ProgramFiles || 'C:\\Program Files', 'nodejs'));
  else dirs.push('/opt/homebrew/bin', '/usr/local/bin', '/usr/bin');   // a shell started from the Dock or a menu has a short PATH
  const names = win ? ['node.exe'] : ['node'];
  for (const d of dirs) for (const n of names) { const f = p.join(d, n); if (exists(f)) return f; }
  return null;
}

// how the hub is started: like open.cmd / scripts/install.mjs open (installed Node, detached, no console window)
export function hubLaunch({ hubDir, node, env = process.env }) {
  const clean = Object.fromEntries(Object.entries(env).filter(([k]) => !/^ELECTRON_/i.test(k)));
  return { file: node, args: [path.join(hubDir, 'server', 'hub.js')], options: { cwd: hubDir, detached: true, stdio: 'ignore', windowsHide: true, env: clean } };
}

// /api/ping answers { ok, app: 'videohub', pid }; anything else on the port is another program
export async function ping(origin, fetchFn = fetch) {
  try {
    const r = await fetchFn(origin + '/api/ping', { signal: AbortSignal.timeout(1500) });
    if (!r.ok) return { other: true };
    const j = await r.json().catch(() => null);
    return j?.app === 'videohub' ? j : { other: true };
  } catch { return null; }
}

// the remembered window place, used only when it is still on a screen (a monitor may have been unplugged)
export const DEFAULT_SIZE = { width: 1440, height: 900 };
export function restoreBounds(saved, workAreas) {
  const s = saved && typeof saved === 'object' ? saved : {};
  const width = Math.max(800, Math.round(+s.width) || DEFAULT_SIZE.width), height = Math.max(560, Math.round(+s.height) || DEFAULT_SIZE.height);
  const out = { width, height, maximized: s.maximized === true };
  if (Number.isFinite(+s.x) && Number.isFinite(+s.y)) {
    const x = Math.round(+s.x), y = Math.round(+s.y);
    // at least 120 x 60 px of the title bar area must be on one screen
    const visible = (workAreas || []).some(a => x + width - 120 >= a.x && x + 120 <= a.x + a.width && y >= a.y - 10 && y + 60 <= a.y + a.height);
    if (visible) Object.assign(out, { x, y });
  }
  return out;
}

// the page background (--bg in ui/style.css), so the window is dark before the page paints
export function backgroundColor(css) {
  const m = /--bg:\s*(#[0-9a-f]{6})\b/i.exec(String(css || ''));
  return m ? m[1] : '#08090b';
}
