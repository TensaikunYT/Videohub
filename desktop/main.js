// VideoHub desktop shell (optional): one window on the local hub. It reuses a running hub or starts one the way
// open.cmd does (installed Node, detached, hidden) and never stops it: renders may be running, and the hub exits by
// itself when nothing uses it. Only the hub's own address opens inside the window; other web links go to the default
// browser. Run it with `npm install` and `npm start` in this folder.
import { app, BrowserWindow, Menu, dialog, nativeImage, screen, shell } from 'electron';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { hubPort, hubOrigin, isHubUrl, externalUrl, findNode, hubLaunch, ping, restoreBounds, backgroundColor } from './hub-link.js';

const HUB_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const log = (...a) => console.log('[VideoHub desktop]', ...a);
const delay = ms => new Promise(r => setTimeout(r, ms));

// Electron's own files (cache, window place) live in "VideoHub Desktop", apart from the hub's settings folders.
// --user-data-dir=<folder> points it elsewhere (tests); the single-instance lock belongs to that folder.
app.setName('VideoHub');
const userDir = app.commandLine.getSwitchValue('user-data-dir');
app.setPath('userData', userDir ? path.resolve(userDir) : path.join(app.getPath('appData'), 'VideoHub Desktop'));
const stateFile = () => path.join(app.getPath('userData'), 'window-state.json');

let win = null, origin = '';
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => {
    log('second launch: showing the open window');
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.show(); win.focus();
  });
  app.on('window-all-closed', () => app.quit());   // the hub keeps running; its idle exit stops it later
  app.on('web-contents-created', (_e, wc) => guard(wc));
  app.whenReady().then(start);
}

async function start() {
  let port;
  try { port = hubPort({ hubDir: HUB_DIR }); } catch (e) { return fail(e.message); }
  origin = hubOrigin(port);
  const bg = backgroundColor(readText(path.join(HUB_DIR, 'ui', 'style.css')));
  const place = restoreBounds(readJson(stateFile()), screen.getAllDisplays().map(d => d.workArea));
  win = new BrowserWindow({
    ...place, minWidth: 800, minHeight: 560, show: false, backgroundColor: bg, title: 'VideoHub', autoHideMenuBar: true,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: false },
  });
  if (place.maximized) win.maximize();
  win.once('ready-to-show', () => win.show());
  // the place is saved whenever it changes (a page's window.close() skips the 'close' event) and once more on close
  let saveTimer = null;
  const saveSoon = () => { clearTimeout(saveTimer); saveTimer = setTimeout(() => win && saveState(win), 500); };
  for (const ev of ['resize', 'move', 'maximize', 'unmaximize']) win.on(ev, saveSoon);
  win.on('close', () => { clearTimeout(saveTimer); saveState(win); });
  win.on('closed', () => { clearTimeout(saveTimer); win = null; });
  appIcon().then(img => { if (img && win) win.setIcon(img); }).catch(() => { });
  await win.loadURL(splash(bg, 'Starting VideoHub…'));
  try { await ensureHub(); }
  catch (e) { return fail(e.message); }
  if (win) win.loadURL(origin + '/');
}

// a running hub on the port, or start one and wait for it (20 s)
async function ensureHub() {
  let p = await ping(origin);
  if (p?.other) throw new Error(`Another program answers on ${origin}. Set "port" in VideoHub's data/config.json or close that program.`);
  if (p) return p;
  const node = findNode();
  if (!node) throw new Error('Node.js was not found on this computer. Install Node.js 22 or newer, or start VideoHub with open.cmd / open.sh first.');
  const l = hubLaunch({ hubDir: HUB_DIR, node });
  log('starting the hub:', l.args[0]);
  let failed = null;
  const child = spawn(l.file, l.args, l.options);
  child.on('error', e => { failed = e; });
  child.unref();
  for (let i = 0; i < 80 && !failed; i++) {
    await delay(250);
    p = await ping(origin);
    if (p?.other) throw new Error(`Another program took ${origin}.`);
    if (p) return p;
  }
  throw new Error('VideoHub did not start: ' + (failed?.message || 'check Node.js and data/config.json'));
}

// every page and popup: the hub's address stays inside, web links go to the default browser, nothing else opens
function guard(wc) {
  wc.on('will-navigate', (e, url) => { if (!isHubUrl(url, origin)) { e.preventDefault(); openOutside(url); } });
  wc.on('will-redirect', (e, url) => { if (!isHubUrl(url, origin)) e.preventDefault(); });
  wc.on('will-attach-webview', e => e.preventDefault());
  wc.setWindowOpenHandler(({ url }) => {
    if (isHubUrl(url, origin)) return { action: 'allow', overrideBrowserWindowOptions: { autoHideMenuBar: true, webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true } } };
    openOutside(url);
    return { action: 'deny' };
  });
  wc.on('context-menu', (_e, p) => {
    const items = p.isEditable ? [{ role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { type: 'separator' }, { role: 'selectAll' }] : p.selectionText ? [{ role: 'copy' }] : [];
    if (items.length) Menu.buildFromTemplate(items).popup();
  });
  let retryAt = 0;
  wc.on('did-fail-load', async (_e, code, _desc, url, mainFrame) => {
    // the hub went away (stopped while idle, or crashed): start it again and reload, at most every 10 s
    if (!mainFrame || code === -3 || !isHubUrl(url, origin) || Date.now() < retryAt) return;
    retryAt = Date.now() + 10e3;
    try { await ensureHub(); if (!wc.isDestroyed()) wc.loadURL(url); } catch (e) { log(e.message); }
  });
}
// only from the hub's own pages: clipboard, full screen and notifications; everything else is refused
const ALLOWED = new Set(['clipboard-read', 'clipboard-sanitized-write', 'fullscreen', 'notifications']);
app.on('session-created', s => {
  s.setPermissionRequestHandler((wc, perm, done) => done(ALLOWED.has(perm) && isHubUrl(wc.getURL(), origin)));
  s.setPermissionCheckHandler((_wc, perm, requestingOrigin) => ALLOWED.has(perm) && isHubUrl(requestingOrigin, origin));
});

function openOutside(url) {
  const ok = externalUrl(url);
  if (!ok) { log('blocked a link:', String(url).slice(0, 80)); return; }
  log('opened in the default browser:', ok);
  shell.openExternal(ok).catch(e => log('could not open the browser:', e.message));
}

function saveState(w) {
  try {
    const b = w.getNormalBounds();
    fs.mkdirSync(path.dirname(stateFile()), { recursive: true });
    fs.writeFileSync(stateFile(), JSON.stringify({ ...b, maximized: w.isMaximized() }));
  } catch (e) { log('could not save the window place:', e.message); }
}

// the app icon from ui/icon.svg, drawn once in a hidden off-screen page (no PNG file is shipped)
async function appIcon() {
  const svg = readText(path.join(HUB_DIR, 'ui', 'icon.svg'));
  if (!svg) return null;
  const pic = new BrowserWindow({ width: 256, height: 256, show: false, frame: false, transparent: true, backgroundColor: '#00000000',
    webPreferences: { offscreen: true, sandbox: true, contextIsolation: true, nodeIntegration: false, javascript: false } });
  try {
    const src = 'data:image/svg+xml;base64,' + Buffer.from(svg).toString('base64');
    await pic.loadURL('data:text/html;base64,' + Buffer.from(`<!doctype html><style>html,body{margin:0;overflow:hidden;background:transparent}img{display:block}</style><img src="${src}" width="256" height="256">`).toString('base64'));
    await delay(150);
    const img = await pic.webContents.capturePage();
    return img.isEmpty() ? null : nativeImage.createFromBuffer(img.toPNG());
  } finally { pic.destroy(); }
}

function splash(bg, text) {
  const html = `<!doctype html><meta charset="utf-8"><title>VideoHub</title><body style="margin:0;height:100vh;display:grid;place-items:center;background:${bg};color:#8a8f9c;font:14px system-ui,sans-serif">${text}</body>`;
  return 'data:text/html;base64,' + Buffer.from(html).toString('base64');
}
function fail(message) {
  log(message);
  dialog.showErrorBox('VideoHub', message);
  app.quit();
}
function readText(f) { try { return fs.readFileSync(f, 'utf8'); } catch { return ''; } }
function readJson(f) { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } }
