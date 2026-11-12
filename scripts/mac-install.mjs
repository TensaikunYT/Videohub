// The Mac side of setup / uninstall: setup.sh asks the questions, this file does the work that touches files (so it is
// unit-tested in scripts/mac-install.test.js). It never deletes a user's file outright: what it replaces is backed up
// (CLAUDE.md, ~/.claude.json) and what uninstall removes goes to the Trash. Only what belongs to THIS install is touched.
//
//   node scripts/mac-install.mjs skill [--dry-run] [--remove]            ~/.claude/skills/videohub with this install's path
//   node scripts/mac-install.mjs rule [--dry-run] [--remove]             the review-before-render block in ~/.claude/CLAUDE.md
//   node scripts/mac-install.mjs mcp-json [--remove]                     the MCP server in ~/.claude.json (when the claude CLI is missing)
//   node scripts/mac-install.mjs app [--dest <folder>] [--dry-run] [--remove]   VideoHub.app (default ~/Applications)
//   node scripts/mac-install.mjs login on|off [--dry-run]                open VideoHub (server only) at login: a LaunchAgent
//   node scripts/mac-install.mjs node                                    the node path to bake into launchers (stable across upgrades)
//   node scripts/mac-install.mjs answers [--set key=value]...            data/setup-answers.json
//   --home <folder>  another home folder than yours (tests)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { stableNode, setLoginItem, loginItemOn, loginPlistPath, trashStream } from '../server/mac.js';

export const HUB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const BEGIN = '<!-- videohub:begin (added by VideoHub setup; remove with uninstall.sh) -->', END = '<!-- videohub:end -->';
const RULE_RX = /\n?<!-- videohub:begin[^\n]*-->[\s\S]*?<!-- videohub:end -->\n?/;

// {{VIDEOHUB_DIR}}\docs\X.md → /path/to/VideoHub/docs/X.md (the texts are written with Windows paths)
export const fillPaths = (text, hub) => String(text).replace(/\{\{VIDEOHUB_DIR\}\}((?:\\[\w.\-]+)*)/g, (m, rest) => hub + rest.replace(/\\/g, '/'));
const say = (o) => process.stdout.write(JSON.stringify(o) + '\n');
const backup = f => { if (fs.existsSync(f)) fs.copyFileSync(f, f + '.videohub-backup'); };
const toTrash = async p => { let ok = false, err = null; await trashStream([{ path: p }], (i, code, e) => { ok = code === 0; err = e; }); return { ok, err }; };

// ---------- the skill Claude reads
export async function skill({ hub = HUB, home = os.homedir(), dryRun = false, remove = false } = {}) {
  const dir = path.join(home, '.claude', 'skills', 'videohub'), cur = path.join(dir, 'SKILL.md');
  const mine = !fs.existsSync(cur) || fs.readFileSync(cur, 'utf8').includes(hub);
  if (remove) {
    if (!fs.existsSync(dir)) return { action: 'none', dir };
    if (!mine) return { action: 'kept', dir, why: 'belongs to another VideoHub install' };
    if (dryRun) return { action: 'would move to the Trash', dir };
    const r = await toTrash(dir); return { action: r.ok ? 'moved to the Trash' : 'left: ' + r.err, dir };
  }
  if (dryRun) return { action: `would copy skill/videohub to ${dir} (with {{VIDEOHUB_DIR}} = ${hub})`, dir };
  fs.mkdirSync(dir, { recursive: true });
  for (const f of fs.readdirSync(path.join(hub, 'skill', 'videohub'))) {
    const src = path.join(hub, 'skill', 'videohub', f); if (!fs.statSync(src).isFile()) continue;
    fs.writeFileSync(path.join(dir, f), fillPaths(fs.readFileSync(src, 'utf8'), hub));
  }
  return { action: 'installed', dir };
}

// ---------- the global rule (between marker lines; replaced on a re-run, removed by uninstall)
export function rule({ hub = HUB, home = os.homedir(), dryRun = false, remove = false } = {}) {
  const file = path.join(home, '.claude', 'CLAUDE.md'), cur = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  const has = RULE_RX.test(cur);
  if (remove) {
    const m = RULE_RX.exec(cur); if (!m) return { action: 'none', file };
    if (!m[0].includes(hub)) return { action: 'kept', file, why: 'the block belongs to another VideoHub install' };
    if (dryRun) return { action: 'would remove the VideoHub block', file };
    const rest = cur.replace(RULE_RX, '\n').replace(/\n{3,}/g, '\n\n').replace(/^\n+/, '').replace(/\s+$/, '');
    backup(file); fs.writeFileSync(file, rest ? rest + '\n' : ''); return { action: 'removed', file };
  }
  const block = BEGIN + '\n' + fillPaths(fs.readFileSync(path.join(hub, 'claude', 'global-rule.md'), 'utf8'), hub).trim() + '\n' + END;
  const next = has ? cur.replace(RULE_RX, (m) => (m.startsWith('\n') ? '\n' : '') + block + (m.endsWith('\n') ? '\n' : '')) : cur.trim() ? cur.replace(/\s*$/, '') + '\n\n' + block + '\n' : block + '\n';
  if (dryRun) return { action: has ? 'would replace the VideoHub block' : 'would add the VideoHub block', file, block };
  fs.mkdirSync(path.dirname(file), { recursive: true }); backup(file); fs.writeFileSync(file, next);
  return { action: has ? 'replaced' : 'added', file, backup: file + '.videohub-backup' };
}
export const hasRule = ({ home = os.homedir() } = {}) => { try { return RULE_RX.test(fs.readFileSync(path.join(home, '.claude', 'CLAUDE.md'), 'utf8')); } catch { return false; } };

// ---------- the MCP server in ~/.claude.json (only when the claude CLI is not there to do it). A file that is not
// readable JSON is never replaced: exit 2, setup prints the command to run by hand instead.
export function mcpJson({ hub = HUB, home = os.homedir(), node = stableNode(), remove = false } = {}) {
  const file = path.join(home, '.claude.json'); let j = {};
  if (fs.existsSync(file)) { try { j = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, '')); } catch { return { action: 'unreadable', file }; } if (!j || typeof j !== 'object' || Array.isArray(j)) return { action: 'unreadable', file }; }
  const mcp = path.join(hub, 'server', 'mcp.js');
  if (remove) {
    if (!j.mcpServers?.videohub || !JSON.stringify(j.mcpServers.videohub).includes(mcp)) return { action: 'none', file };
    backup(file); delete j.mcpServers.videohub; fs.writeFileSync(file, JSON.stringify(j, null, 2)); return { action: 'removed', file };
  }
  backup(file); j.mcpServers = j.mcpServers || {}; j.mcpServers.videohub = { type: 'stdio', command: node, args: [mcp], env: {} };
  fs.writeFileSync(file, JSON.stringify(j, null, 2)); return { action: 'registered', file };
}

// ---------- VideoHub.app: a tiny app bundle whose program is a shell script that runs open-mac.sh. Spotlight,
// Launchpad and the Dock find it in ~/Applications. Made on this Mac (never downloaded), so Gatekeeper does not stop it.
export function appFiles(hub = HUB, node = stableNode()) {
  const q = s => "'" + String(s).replace(/'/g, "'\\''") + "'";
  return {
    'Contents/Info.plist': `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key><string>VideoHub</string>
  <key>CFBundleDisplayName</key><string>VideoHub</string>
  <key>CFBundleIdentifier</key><string>local.videohub.app</string>
  <key>CFBundleExecutable</key><string>VideoHub</string>
  <key>CFBundleIconFile</key><string>VideoHub</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>${JSON.parse(fs.readFileSync(path.join(HUB, 'package.json'), 'utf8')).version}</string>
  <key>LSMinimumSystemVersion</key><string>11.0</string>
  <!-- the launcher only starts the server and opens the window, then quits: no Dock icon of its own -->
  <key>LSUIElement</key><true/>
</dict>
</plist>
`,
    'Contents/MacOS/VideoHub': `#!/bin/bash
# VideoHub launcher (made by setup.sh for ${hub.replace(/\n/g, ' ')})
export VIDEOHUB_NODE=${q(node)}
exec /bin/bash ${q(path.join(hub, 'open-mac.sh'))} "$@"
`,
  };
}
export const appPath = (dest = path.join(os.homedir(), 'Applications')) => path.join(dest, 'VideoHub.app');
export const appIsMine = (app, hub = HUB) => { try { return fs.readFileSync(path.join(app, 'Contents', 'MacOS', 'VideoHub'), 'utf8').includes(path.join(hub, 'open-mac.sh')); } catch { return false; } };
export async function app({ hub = HUB, dest = path.join(os.homedir(), 'Applications'), dryRun = false, remove = false, node = stableNode(), icon = true } = {}) {
  const a = appPath(dest);
  if (remove) {
    if (!fs.existsSync(a)) return { action: 'none', app: a };
    if (!appIsMine(a, hub)) return { action: 'kept', app: a, why: 'belongs to another VideoHub install' };
    if (dryRun) return { action: 'would move to the Trash', app: a };
    const r = await toTrash(a); return { action: r.ok ? 'moved to the Trash' : 'left: ' + r.err, app: a };
  }
  if (fs.existsSync(a) && !appIsMine(a, hub)) return { action: 'kept', app: a, why: 'a VideoHub.app of another install is there; open-mac.sh in this folder opens this one' };
  if (dryRun) return { action: `would create ${a}`, app: a };
  for (const [rel, text] of Object.entries(appFiles(hub, node))) { const f = path.join(a, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, text); }
  fs.chmodSync(path.join(a, 'Contents', 'MacOS', 'VideoHub'), 0o755);
  let iconDone = false;
  if (icon) { try { iconDone = await makeIcon(path.join(a, 'Contents', 'Resources', 'VideoHub.icns')); } catch { } }
  const now = new Date(); try { fs.utimesSync(a, now, now); } catch { }   // Finder picks up the new icon
  spawnSync('/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister', ['-f', a], { stdio: 'ignore' });
  return { action: 'created', app: a, icon: iconDone };
}

// the icon: VideoHub's gauge (the Windows agent draws the same one), on Apple's icon grid (824 px tile in 1024)
export const ICON_SVG = (() => {
  const s = 824, o = 100, cx = o + s / 2, cy = o + s * 0.62, rad = s * 0.33, pw = s * 0.085, P = a => [cx + rad * Math.cos(a * Math.PI / 180), cy + rad * Math.sin(a * Math.PI / 180)];
  const arc = (a0, a1) => { const [x0, y0] = P(a0), [x1, y1] = P(a1); return `M${x0.toFixed(1)} ${y0.toFixed(1)} A${rad} ${rad} 0 0 1 ${x1.toFixed(1)} ${y1.toFixed(1)}`; };
  const na = -140 * Math.PI / 180, len = rad * 0.82, d = s * 0.13;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2a2f3c"/><stop offset="1" stop-color="#171a22"/></linearGradient></defs>
<rect x="${o}" y="${o}" width="${s}" height="${s}" rx="${s * 0.225}" fill="url(#g)"/>
<path d="${arc(180, 300)}" fill="none" stroke="#ebebf0" stroke-width="${pw}" stroke-linecap="round"/>
<path d="${arc(300, 360)}" fill="none" stroke="#e8742c" stroke-width="${pw}" stroke-linecap="round"/>
<line x1="${cx}" y1="${cy}" x2="${(cx + len * Math.cos(na)).toFixed(1)}" y2="${(cy + len * Math.sin(na)).toFixed(1)}" stroke="#e8742c" stroke-width="${pw * 0.9}" stroke-linecap="round"/>
<circle cx="${cx}" cy="${cy}" r="${d / 2}" fill="#ebebf0"/>
</svg>`;
})();
// drawn by the browser renders use anyway (puppeteer-core + Chrome), sized by sips and packed by iconutil (both in macOS)
export async function makeIcon(out) {
  const { TOOLS } = await import('../server/util.js');
  const exe = TOOLS.chrome || TOOLS.edge; if (!exe) return false;
  const pptr = (await import('puppeteer-core')).default;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vh-icon-')), set = path.join(tmp, 'VideoHub.iconset');
  fs.mkdirSync(set);
  const br = await pptr.launch({ executablePath: exe, headless: true, args: ['--force-device-scale-factor=1'] });
  try {
    const page = await br.newPage(); await page.setViewport({ width: 1024, height: 1024 });
    await page.setContent(`<html><body style="margin:0;background:transparent">${ICON_SVG}</body></html>`);
    await page.screenshot({ path: path.join(tmp, 'icon.png'), omitBackground: true, clip: { x: 0, y: 0, width: 1024, height: 1024 } });
  } finally { await br.close(); }
  for (const z of [16, 32, 128, 256, 512]) for (const k of [1, 2]) {
    const px = z * k, name = `icon_${z}x${z}${k === 2 ? '@2x' : ''}.png`;
    spawnSync('sips', ['-z', String(px), String(px), path.join(tmp, 'icon.png'), '--out', path.join(set, name)], { stdio: 'ignore' });
  }
  fs.mkdirSync(path.dirname(out), { recursive: true });
  const r = spawnSync('iconutil', ['-c', 'icns', set, '-o', out], { stdio: 'ignore' });
  fs.rmSync(tmp, { recursive: true, force: true });
  return r.status === 0 && fs.existsSync(out);
}

// ---------- answers a re-run keeps (data/setup-answers.json)
export function answers({ hub = HUB, set = [] } = {}) {
  const f = path.join(hub, 'data', 'setup-answers.json'); let a = {};
  try { a = JSON.parse(fs.readFileSync(f, 'utf8')); } catch { }
  if (set.length) { for (const kv of set) { const i = kv.indexOf('='); if (i > 0) a[kv.slice(0, i)] = kv.slice(i + 1); } fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, JSON.stringify(a, null, 1)); }
  return a;
}

// ---------- command line (setup.sh, uninstall.sh)
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const a = process.argv.slice(2), cmd = a[0], flag = k => a.includes(k), val = k => { const i = a.indexOf(k); return i >= 0 ? a[i + 1] : null; };
  const home = val('--home') || os.homedir(), dryRun = flag('--dry-run'), remove = flag('--remove');
  try {
    if (cmd === 'skill') say(await skill({ home, dryRun, remove }));
    else if (cmd === 'rule') say(rule({ home, dryRun, remove }));
    else if (cmd === 'has-rule') say({ has: hasRule({ home }) });
    else if (cmd === 'mcp-json') { const r = mcpJson({ home, remove }); say(r); if (r.action === 'unreadable') process.exit(2); }
    else if (cmd === 'app') say(await app({ dest: val('--dest') || path.join(home, 'Applications'), dryRun, remove }));
    else if (cmd === 'login') {
      const on = a[1] === 'on', f = loginPlistPath(home);
      if (a[1] === 'status') say({ on: loginItemOn(HUB, home), file: f });
      else if (dryRun) say({ action: `would ${on ? 'add' : 'remove'} ${f}` });
      else say({ on: setLoginItem(on, HUB, home), file: f });
    }
    else if (cmd === 'node') process.stdout.write(stableNode() + '\n');
    else if (cmd === 'answers') say(answers({ set: a.flatMap((x, i) => x === '--set' && a[i + 1] ? [a[i + 1]] : []) }));
    else { process.stderr.write(fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').filter(l => /^\/\/ {3}/.test(l)).map(l => l.slice(3)).join('\n') + '\n'); process.exit(cmd ? 2 : 0); }
  } catch (e) { say({ error: e.message }); process.exit(1); }
}
