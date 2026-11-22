// Machine-local settings in data/config.json. Created on first run (or by setup: scripts/init-config.mjs), so the same
// code works on any PC. Every folder VideoHub writes to has a default inside one workspace folder (baseDir: films,
// outputs, sounds, archive; Documents\VideoHub unless setup chose another) and can be changed in Settings
// or in data/config.json. See docs/MIGRATING.md for older installs.
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR, DESKTOP, DOCUMENTS, norm, readJson, writeJson } from './util.js';
import { ENCODERS } from './encoders.js';

const FILE = path.join(DATA_DIR, 'config.json');

// root types:
//   container : every sub-folder is a project (a "films" folder)
//   project   : the folder itself is one project
//   media     : finished videos lying around (an export folder)
const SKIP = new Set(['node_modules', '.git', '.claude', 'VideoHub', '$RECYCLE.BIN']);

// the workspace: the base folder for everything VideoHub creates by default. VIDEOHUB_BASE_DIR (tests and test hubs
// point it at a scratch folder) → config.baseDir (chosen in setup) → Documents\VideoHub. Installs from before baseDir
// existed have no key and keep Documents\VideoHub; their explicit folders are kept anyway (see config()).
const okBase = b => typeof b === 'string' && path.isAbsolute(b) ? b : null;
export const DEFAULT_BASE = () => path.join(DOCUMENTS, 'VideoHub');
export const baseDir = () => process.env.VIDEOHUB_BASE_DIR || okBase(cfg ? cfg.baseDir : savedBase) || DEFAULT_BASE();
export const defaultFilmsDir = () => path.join(baseDir(), 'films');
// container sub-folders never listed as projects (helpers next to films) unless they have their own render script.
// Overridable with config.skipFolders.
export const DEFAULT_SKIP_FOLDERS = ['tools', 'fonts', 'test', 'render', 'videos', 'thumbnails', 'assets'];

// [REASONIX PATCH] Agent provider settings: Claude Code (the original MCP/clipboard flow), the Reasonix CLI that
// applies edits itself, or a direct DeepSeek API chat. Kept in data/config.json like every other local setting.
export const AGENT_PROVIDERS = ['claude', 'reasonix', 'deepseek'];
export const AGENT_KEY_MASK = '********';
export const DEFAULT_AGENT = () => ({
  provider: 'claude',
  reasonixPath: '',
  reasonixModel: '',
  reasonixMaxSteps: 80,
  deepseekApiKey: '',
  deepseekBaseUrl: 'https://api.deepseek.com',
  deepseekModel: 'deepseek-chat',
});

function hasRenderCode(dir) {
  try { return fs.readdirSync(dir).some(f => /^(render\.(m?js|py)|anim_render\.\w+|manifest\.json|index\.html|.*\.snipp)$/i.test(f)); } catch { return false; }
}
function countMp4(dir) { try { return fs.readdirSync(dir).filter(f => /\.mp4$/i.test(f)).length; } catch { return 0; } }

// Desktop / Documents folders that look like video work: suggested in Settings, switched off until the user turns
// them on. The default films folder (Documents\VideoHub\films) is a root from the start and is on.
export function discoverRoots() {
  const roots = [];
  const add = (p, type, enabled) => { if (fs.existsSync(p) && !roots.some(r => norm(r.path) === norm(p))) roots.push({ path: p, type, enabled }); };
  const lower = norm;
  for (const top of [DESKTOP, DOCUMENTS]) {
    let entries = []; try { entries = fs.readdirSync(top, { withFileTypes: true }); } catch { }
    for (const e of entries) {
      if (!e.isDirectory() || SKIP.has(e.name) || e.name.startsWith('.')) continue;
      const p = path.join(top, e.name), lp = lower(p);
      if (lp === lower(baseDir())) continue;
      // skip folders that are a root, sit inside one, or contain one
      if (roots.some(r => lower(r.path) === lp || lp.startsWith(lower(r.path) + path.sep) || lower(r.path).startsWith(lp + path.sep))) continue;
      if (fs.existsSync(path.join(p, 'server', 'hub.js'))) continue;   // a VideoHub install
      if (hasRenderCode(p)) { add(p, 'project', false); continue; }
      let subs = []; try { subs = fs.readdirSync(p, { withFileTypes: true }).filter(s => s.isDirectory() && !SKIP.has(s.name)); } catch { }
      if (subs.filter(s => hasRenderCode(path.join(p, s.name))).length >= 2) add(p, 'container', false);
      else if (countMp4(p) >= 3) add(p, 'media', false);
    }
  }
  return roots;
}

// the workspace's sub-folders (setup creates them and a README.txt that says what each is for)
export const WORKSPACE_FOLDERS = { films: 'films', outputs: 'outputs', sounds: 'sounds', archive: 'archive' };
// every key but the roots (roots are found once, on the very first run)
export const DEFAULTS = (base = baseDir()) => ({
  port: 7788,
  agentName: 'Claude',
  outputsDir: path.join(base, 'outputs'),
  soundLibDir: path.join(base, 'sounds'),
  archiveDir: path.join(base, 'archive'),
  studioDir: null,
  skipFolders: DEFAULT_SKIP_FOLDERS,
  maxParallelRenders: 1,
  secondRenderMinFreeMB: 8000,
  snapsMaxAgeDays: 14,
  tempMaxAgeDays: 14,
  bloatWarnRatio: 3,
  // render.encoder: auto | nvenc | amf | qsv | x264, passed to render scripts as VIDEOHUB_ENCODER (server/encoders.js)
  render: { encoder: 'auto' },
  // the Now page reads the agents' own session files on this PC (server/activity.js); off = never touched
  agentActivity: true,
  // render leftovers (server/leftovers.js): ask about them by itself (a banner, nothing moves without a click), not below
  // autoCleanMinMB; render chunks of a film not rendered for chunkDays count as leftovers (janitor rule staleChunks)
  autoCleanPrompt: true,
  autoCleanMinMB: 500,
  chunkDays: 7,
  agent: DEFAULT_AGENT(),   // [REASONIX PATCH] see AGENT_PROVIDERS above
});
function firstRoots() {
  const films = defaultFilmsDir();
  try { fs.mkdirSync(films, { recursive: true }); } catch { }
  return [{ path: films, type: 'container', enabled: true }, ...discoverRoots()];
}

let cfg = null, savedBase = null;
export function config() {
  if (cfg) return cfg;
  const saved = readJson(FILE, null);
  savedBase = saved && typeof saved === 'object' ? saved.baseDir : null;
  // an existing config keeps every value it has; keys it lacks get the defaults. Roots are never discovered again
  // for an existing config, so an older install keeps exactly its folders.
  cfg = { ...DEFAULTS(), roots: [], ...(saved || {}) };
  if (!saved) { cfg.roots = firstRoots(); if (!process.env.VIDEOHUB_BASE_DIR) cfg.baseDir = baseDir(); }
  // older installs without an outputs setting used a Desktop folder "VideoHub <Turkish for outputs>": keep using it
  if (saved && !saved.outputsDir) { const legacy = path.join(DESKTOP, 'VideoHub çıktılar'); if (fs.existsSync(legacy)) cfg.outputsDir = legacy; }
  normalise(cfg, DEFAULTS().port);
  if (!saved) writeJson(FILE, cfg);
  return cfg;
}
// the shapes every route relies on (a "roots" that is not a list used to break every request until config.json was fixed by hand)
function normalise(c, port) {
  c.agentName = typeof c.agentName === 'string' && c.agentName.trim() ? c.agentName.trim().slice(0, 40) : 'Claude';
  c.roots = (Array.isArray(c.roots) ? c.roots : []).filter(r => r && typeof r.path === 'string' && r.path)
    .map(r => ({ ...r, type: ['container', 'project', 'media'].includes(r.type) ? r.type : 'container', enabled: r.enabled !== false }));
  c.port = /^\d{1,5}$/.test(String(c.port)) && +c.port > 0 && +c.port < 65536 ? +c.port : port;
  const r = c.render && typeof c.render === 'object' && !Array.isArray(c.render) ? c.render : {};
  c.render = { ...r, encoder: ENCODERS.includes(r.encoder) ? r.encoder : 'auto' };
  c.agentActivity = c.agentActivity !== false;
  c.autoCleanPrompt = c.autoCleanPrompt !== false;
  c.chunkDays = Number.isFinite(+c.chunkDays) && +c.chunkDays >= 1 ? Math.min(365, Math.round(+c.chunkDays)) : 7;
  c.autoCleanMinMB = Number.isFinite(+c.autoCleanMinMB) && +c.autoCleanMinMB >= 0 ? Math.min(1e6, Math.round(+c.autoCleanMinMB)) : 500;
  // [REASONIX PATCH] agent provider settings (see DEFAULT_AGENT)
  const a = c.agent && typeof c.agent === 'object' && !Array.isArray(c.agent) ? c.agent : {};
  const da = DEFAULT_AGENT();
  c.agent = { ...da, ...a };
  c.agent.provider = AGENT_PROVIDERS.includes(c.agent.provider) ? c.agent.provider : 'claude';
  for (const k of ['reasonixPath', 'reasonixModel', 'deepseekApiKey', 'deepseekBaseUrl', 'deepseekModel']) {
    c.agent[k] = typeof c.agent[k] === 'string' ? c.agent[k].trim() : da[k];
  }
  c.agent.reasonixMaxSteps = Math.max(1, Math.min(500, parseInt(c.agent.reasonixMaxSteps, 10) || da.reasonixMaxSteps));
  if (!/^https?:\/\//i.test(c.agent.deepseekBaseUrl)) c.agent.deepseekBaseUrl = da.deepseekBaseUrl;
  c.agent.deepseekBaseUrl = c.agent.deepseekBaseUrl.replace(/\/+$/, '');
  if (!c.agent.deepseekModel) c.agent.deepseekModel = da.deepseekModel;
  return c;
}
export function saveConfig(patch) {
  const prev = config(); if (!patch || typeof patch !== 'object' || Array.isArray(patch)) patch = {};
  if ('roots' in patch && !Array.isArray(patch.roots)) { const { roots, ...rest } = patch; patch = rest; }   // not a list: keep the folders there are
  if ('baseDir' in patch) { const { baseDir: b, ...rest } = patch; patch = rest; }   // the workspace is chosen in setup only (it never moves folders)
  if (patch.render && typeof patch.render === 'object') patch = { ...patch, render: { ...prev.render, ...patch.render } };
  // [REASONIX PATCH] merge agent settings; an empty key or the mask means "keep the key that is already saved"
  if (patch.agent && typeof patch.agent === 'object' && !Array.isArray(patch.agent)) {
    const { deepseekApiKey, ...rest } = patch.agent;
    const keepKey = deepseekApiKey === undefined || deepseekApiKey === null || deepseekApiKey === '' || deepseekApiKey === AGENT_KEY_MASK;
    patch = { ...patch, agent: { ...prev.agent, ...rest, ...(keepKey ? {} : { deepseekApiKey }) } };
  }
  cfg = normalise({ ...prev, ...patch }, prev.port); writeJson(FILE, cfg); return cfg;
}
