// Agent integration is shared by both installers. Never replace another install's entry or unreadable config.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { IS_WIN, trash } from '../server/platform.js';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const normal = s => { const p = String(s || '').replace(/\\/g, '/').replace(/\/$/, ''); return IS_WIN ? p.toLowerCase() : p; };
const same = (a, b) => normal(a) === normal(b);
// the same file after links are followed (a Desktop shortcut folder can be a junction to the install)
const real = p => { try { return fs.realpathSync.native(String(p)); } catch { return null; } };
const samePath = (a, b) => same(a, b) || (real(a) != null && real(a) === real(b)) || (real(a) != null && real(b) != null && same(real(a), real(b)));
export const AGENTS = { claude: 'Claude Code', codex: 'Codex', opencode: 'OpenCode' };
const object = j => j && typeof j === 'object' && !Array.isArray(j);
export function parseJsonc(text) {
  // Keep quoted URLs and escaped quotes intact while removing comments and trailing commas.
  let out = '', quoted = false, escaped = false;
  text = text.replace(/^\uFEFF/, '');
  for (let i = 0; i < text.length; i++) {
    const c = text[i], n = text[i + 1];
    if (quoted) { out += c; if (escaped) escaped = false; else if (c === '\\') escaped = true; else if (c === '"') quoted = false; continue; }
    if (c === '"') { quoted = true; out += c; continue; }
    if (c === '/' && n === '/') { while (i < text.length && text[i] !== '\n') i++; out += '\n'; continue; }
    if (c === '/' && n === '*') { out += ' '; i += 2; while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i++; if (i >= text.length) throw new Error('Unclosed JSONC comment'); i++; continue; }
    out += c;
  }
  // Comments may sit between a trailing comma and the closing bracket.
  let clean = ''; quoted = false; escaped = false;
  for (let i = 0; i < out.length; i++) {
    const c = out[i];
    if (quoted) { clean += c; if (escaped) escaped = false; else if (c === '\\') escaped = true; else if (c === '"') quoted = false; continue; }
    if (c === '"') quoted = true;
    if (c === ',' && /^\s*[}\]]/.test(out.slice(i + 1))) continue;
    clean += c;
  }
  const j = JSON.parse(clean); if (!object(j)) throw new Error('Expected a JSON object'); return j;
}
export function agentPaths(agent, { home = os.homedir(), env = process.env } = {}) {
  if (agent === 'codex') { const dir = env.CODEX_HOME || path.join(home, '.codex'); return { dir, config: path.join(dir, 'config.toml'), skill: path.join(dir, 'skills', 'videohub'), rule: path.join(dir, 'AGENTS.md') }; }
  const dir = agent === 'claude' ? path.join(home, '.claude') : path.join(env.XDG_CONFIG_HOME || path.join(home, '.config'), 'opencode');
  const json = agent === 'claude' ? path.join(home, '.claude.json') : path.join(dir, 'opencode.json');
  const config = agent === 'opencode' && fs.existsSync(path.join(dir, 'opencode.jsonc')) ? path.join(dir, 'opencode.jsonc') : json;
  return { dir, config, skill: path.join(dir, 'skills', 'videohub'), rule: path.join(dir, agent === 'claude' ? 'CLAUDE.md' : 'AGENTS.md') };
}
function executable(name, env = process.env) {
  for (const d of (env.PATH || '').split(path.delimiter)) for (const ext of IS_WIN ? ['.exe', '.cmd', '.bat', ''] : ['']) {
    const p = path.join(d, name + ext); if (d && fs.existsSync(p)) return p;
  }
  return null;
}
export function executeAgent(file, args, { env = process.env } = {}) {
  // Windows npm shims are batch files, which execFile cannot execute directly.
  if (IS_WIN && /\.(cmd|bat)$/i.test(file)) {
    const values = [file, ...args]; if (values.some(s => /["\r\n\0]/.test(String(s)))) throw new Error('Unsupported quote or control character in agent CLI argument');
    const commandEnv = { ...env }, names = values.map((value, i) => { const key = 'VIDEOHUB_CLI_ARG_' + i; commandEnv[key] = String(value); return '"%' + key + '%"'; });
    // Expand each argument once from env: literal %NAME%, &, and ! in paths survive cmd's parser.
    return spawnSync(env.ComSpec || process.env.ComSpec || 'cmd.exe', ['/d', '/v:off', '/s', '/c', '"' + names.join(' ') + '"'], { encoding: 'utf8', windowsHide: true, windowsVerbatimArguments: true, env: commandEnv });
  }
  return spawnSync(file, args, { encoding: 'utf8', windowsHide: true, env });
}
export function detectAgents(options = {}) {
  return ['claude', 'codex', 'opencode'].filter(a => (options.find || executable)(a, options.env) || fs.existsSync(agentPaths(a, options).dir));
}
function readConfig(file) { if (!fs.existsSync(file)) return {}; try { return parseJsonc(fs.readFileSync(file, 'utf8')); } catch (e) { throw new Error(`${file} is not readable JSON/JSONC; left unchanged (${e.message})`); } }
function entriesOf(agent, j) { return (agent === 'claude' ? [j.mcpServers?.videohub] : [j.mcp?.servers?.videohub, j.mcp?.videohub]).filter(e => e != null); }
function owns(entry, mcp) { return [...(Array.isArray(entry?.command) ? entry.command : []), ...(Array.isArray(entry?.args) ? entry.args : [])].some(p => samePath(p, mcp)); }

// ---------- Codex: ~/.codex/config.toml (or $CODEX_HOME), edited as text. Only our [mcp_servers.videohub] table (and its
// sub-tables) is ever added, changed or removed; every other line, comment and the file's line endings stay as they are.
// Codex stops a tool call after tool_timeout_sec (Codex 0.167 measured 300 s by default; older versions document 60 s);
// hub_wait and hub_job wait up to 9 minutes, so our entry asks for 10 (docs/AGENT-WAIT.md).
export const CODEX_TOOL_TIMEOUT = 600;
const HEADER = /^[ \t]*\[\[?([^\]]*)\]\]?[ \t]*(?:#.*)?$/;
const keyPath = h => h.split('.').map(k => k.trim().replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1'));
// TOML strings in an array (basic "…" with escapes, literal '…'), enough for `args = [ … ]`
function tomlStrings(text) {
  const out = []; let i = text.indexOf('['); if (i < 0) return null;
  for (i++; i < text.length;) {
    const c = text[i];
    if (c === ']') return out;
    if (/[\s,]/.test(c)) { i++; continue; }
    if (c === '#') { while (i < text.length && text[i] !== '\n') i++; continue; }
    if (c === "'") { const e = text.indexOf("'", i + 1); if (e < 0) return null; out.push(text.slice(i + 1, e)); i = e + 1; continue; }
    if (c === '"') {
      let v = ''; i++;
      for (; i < text.length && text[i] !== '"'; i++) {
        if (text[i] !== '\\') { v += text[i]; continue; }
        const n = text[++i], map = { b: '\b', t: '\t', n: '\n', f: '\f', r: '\r', '"': '"', '\\': '\\' };
        if (map[n] != null) v += map[n]; else if (n === 'u' || n === 'U') { const len = n === 'u' ? 4 : 8; v += String.fromCodePoint(parseInt(text.substr(i + 1, len), 16)); i += len; } else return null;
      }
      out.push(v); i++; continue;
    }
    return null;
  }
  return null;
}
// where our table is: { lines, eol, start, end (exclusive, our sub-tables included), args, timeout, other } or null
export function codexEntry(text) {
  const eol = /\r\n/.test(text) ? '\r\n' : '\n', lines = text.split(/\r?\n/);
  let start = -1, end = lines.length, other = false;
  for (let i = 0; i < lines.length; i++) {
    const m = HEADER.exec(lines[i]); if (!m) continue;
    const k = keyPath(m[1]);
    if (k[0] === 'mcp_servers' && k[1] === 'videohub') { if (k.length === 2 && start < 0) start = i; else if (start < 0) other = true; continue; }
    if (start >= 0 && end === lines.length) { end = i; }
  }
  // a videohub server written another way (inline table, dotted keys) is not ours to touch
  if (/^\s*(?:mcp_servers\s*\.\s*)?["']?videohub["']?\s*(?:\.|=)/m.test(start >= 0 ? [...lines.slice(0, start), ...lines.slice(end)].join('\n') : text)) other = true;
  if (start < 0) return { lines, eol, start: -1, end: -1, other };
  while (end > start + 1 && /^\s*(#.*)?$/.test(lines[end - 1])) end--;   // blank lines and comments before the next table are not ours
  const body = lines.slice(start + 1, end).join('\n');
  const am = /^\s*args\s*=\s*(\[[\s\S]*?\])\s*(?:#.*)?$/m.exec(body), cm = /^\s*command\s*=\s*(["'])(.*?)\1/m.exec(body), tm = /^\s*tool_timeout_sec\s*=\s*([\d.]+)/m.exec(body);
  return { lines, eol, start, end, other, command: cm ? cm[2] : null, args: am ? tomlStrings(am[1]) : null, timeout: tm ? +tm[1] : null };
}
const tomlString = s => /['\n\r]/.test(s) ? JSON.stringify(s) : `'${s}'`;
export const codexTable = mcp => ['[mcp_servers.videohub]', 'command = "node"', `args = [${tomlString(mcp)}]`, `tool_timeout_sec = ${CODEX_TOOL_TIMEOUT}`];
const codexOwns = (e, mcp) => !!e && e.start >= 0 && Array.isArray(e.args) && e.args.some(a => samePath(a, mcp));
// the new text, or null when nothing changes. action: add | timeout | remove
export function editCodex(text, mcp, action) {
  const e = codexEntry(text), { lines, eol } = e;
  if (action === 'add') {
    if (e.start >= 0 || e.other) return null;
    const head = text.replace(/(\r?\n)+$/, '');
    return (head ? head + eol + eol : '') + codexTable(mcp).join(eol) + eol;
  }
  if (!codexOwns(e, mcp)) return null;
  if (action === 'timeout') {
    if (e.timeout != null) return null;
    let at = e.end; while (at > e.start + 1 && /^\s*(#.*)?$/.test(lines[at - 1])) at--;
    return [...lines.slice(0, at), `tool_timeout_sec = ${CODEX_TOOL_TIMEOUT}`, ...lines.slice(at)].join(eol);
  }
  if (action === 'remove') {
    const before = lines.slice(0, e.start), after = lines.slice(e.end);
    while (before.length && /^\s*$/.test(before.at(-1)) && after.length && /^\s*$/.test(after[0])) after.shift();
    return [...before, ...after].join(eol);
  }
  return null;
}
function saveText(file, text) { fs.mkdirSync(path.dirname(file), { recursive: true }); if (fs.existsSync(file)) fs.copyFileSync(file, file + '.videohub-backup'); fs.writeFileSync(file, text); }
// register / refresh / remove our Codex MCP entry; true when the entry is ours afterwards (or was removed)
function codexMcp({ action, p, mcp, cli, run, env, dryRun, say }) {
  const text = fs.existsSync(p.config) ? fs.readFileSync(p.config, 'utf8') : '', e = codexEntry(text), mine = codexOwns(e, mcp);
  if ((e.start >= 0 && !mine) || (e.other && !mine)) { say(`leave Codex MCP entry belonging to another install unchanged`); return false; }
  if (action === 'uninstall') {
    if (!mine) return true;
    say(`remove Codex MCP server videohub (${p.config})`);
    if (!dryRun) {
      if (cli) { const r = run(cli, ['mcp', 'remove', 'videohub'], { env }); if (r.status !== 0) throw new Error(`Codex MCP removal failed: ${r.stderr || r.error?.message || r.status}`); }
      const now = fs.existsSync(p.config) ? fs.readFileSync(p.config, 'utf8') : '', next = editCodex(now, mcp, 'remove');
      if (next != null) saveText(p.config, next);
    }
    return true;
  }
  if (!mine && action === 'refresh') return true;   // nothing of ours to refresh; the skill and rule still are
  if (!mine) {
    say(`register Codex MCP server videohub (${p.config})`);
    if (!dryRun) {
      if (cli) {
        const r = run(cli, ['mcp', 'add', 'videohub', '--', 'node', mcp], { env }); if (r.status !== 0) throw new Error(`Codex MCP registration failed; run codex mcp add manually (${r.stderr || r.error?.message || r.status})`);
        const list = run(cli, ['mcp', 'list'], { env }); if (list.status !== 0 || !/videohub/i.test(String(list.stdout) + String(list.stderr))) throw new Error('Codex did not verify videohub in mcp list');
      } else { const next = editCodex(text, mcp, 'add'); if (next != null) saveText(p.config, next); }
    }
  }
  // our entry (new or existing) gets the longer tool time limit hub_wait needs
  const now = dryRun ? (mine ? text : editCodex(text, mcp, 'add') ?? text) : fs.existsSync(p.config) ? fs.readFileSync(p.config, 'utf8') : '';
  const next = editCodex(now, mcp, 'timeout');
  if (next != null) { say(`set tool_timeout_sec = ${CODEX_TOOL_TIMEOUT} for Codex MCP server videohub`); if (!dryRun) saveText(p.config, next); }
  return true;
}
function save(file, j) { fs.mkdirSync(path.dirname(file), { recursive: true }); if (fs.existsSync(file)) fs.copyFileSync(file, file + '.videohub-backup'); fs.writeFileSync(file, JSON.stringify(j, null, 2) + '\n'); }
function mutateEntry(agent, j, mcp, remove) {
  if (agent === 'claude') {
    if (!object(j.mcpServers) && j.mcpServers != null) throw new Error('mcpServers is not an object');
    j.mcpServers ||= {}; if (remove) delete j.mcpServers.videohub; else j.mcpServers.videohub = { type: 'stdio', command: 'node', args: [mcp], env: {} };
  } else {
    if (!object(j.mcp) && j.mcp != null) throw new Error('mcp is not an object'); j.mcp ||= {};
    if (!object(j.mcp.servers) && j.mcp.servers != null) throw new Error('mcp.servers is not an object'); j.mcp.servers ||= {};
    delete j.mcp.videohub;
    if (remove) delete j.mcp.servers.videohub; else j.mcp.servers.videohub = { type: 'local', command: ['node', mcp], disabled: false };
  }
}
const begin = '<!-- videohub:begin (added by VideoHub setup; remove with uninstall.ps1) -->', end = '<!-- videohub:end -->';
const blocks = /<!-- videohub:begin[^>]*-->[\s\S]*?<!-- videohub:end -->/g;
function ownedText(text, hub) { return new RegExp('(?:^|["\u0027`(\\s])' + normal(hub).replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?:/|["\u0027`\\s]|$)').test(normal(text)); }
export async function integrateAgents({ action = 'setup', agents = [], hub = ROOT, home = os.homedir(), env = process.env, globalRule = true, dryRun = false, find = executable, run = executeAgent, recycle = trash } = {}) {
  if (!['setup', 'refresh', 'uninstall'].includes(action)) throw new Error('Unknown agent action: ' + action);
  const actions = [], errors = [], mcp = path.join(hub, 'server', 'mcp.js');
  agents = [...new Set(agents.flatMap(a => String(a).split(',')).filter(Boolean))];
  if (agents.some(a => !AGENTS[a])) throw new Error('Agents must be claude, codex or opencode');
  const say = s => actions.push((dryRun ? 'would ' : '') + s);
  for (const agent of agents) {
    const p = agentPaths(agent, { home, env }), label = AGENTS[agent];
    try {
      if (agent === 'codex') { if (!codexMcp({ action, p, mcp, cli: find(agent, env), run, env, dryRun, say }) && action !== 'uninstall') continue; }
      else {
        const j = readConfig(p.config), current = entriesOf(agent, j), mine = current.length > 0 && current.every(e => owns(e, mcp)), cli = find(agent, env);
        if (current.length && !mine) { say(`leave ${label} MCP entry belonging to another install unchanged`); if (action !== 'uninstall') continue; }
        else if (action !== 'refresh' && (action !== 'uninstall' || mine)) {
          const remove = action === 'uninstall';
          say(`${remove ? 'remove' : 'register'} ${label} MCP server videohub (${p.config})`);
          if (!dryRun) {
            if (cli) {
              let useCli = true;
              if (remove && agent === 'opencode') { const help = run(cli, ['mcp', '--help'], { env }); useCli = /\bremove\b/.test(String(help.stdout) + String(help.stderr)); }
              if (useCli) {
                const removeArgs = agent === 'claude' ? ['mcp', 'remove', 'videohub', '--scope', 'user'] : ['mcp', 'remove', 'videohub', '--global'];
                if (remove || mine) { const r = run(cli, removeArgs, { env }); if (r.status !== 0) throw new Error(`${label} MCP removal failed: ${r.stderr || r.error?.message || r.status}`); }
                if (!remove) {
                  const args = agent === 'claude' ? ['mcp', 'add', '--scope', 'user', 'videohub', '--', 'node', mcp] : ['mcp', 'add', 'videohub', '--global', '--', 'node', mcp];
                  const r = run(cli, args, { env }); if (r.status !== 0) throw new Error(`${label} MCP registration failed; run ${agent} mcp add manually (${r.stderr || r.error?.message || r.status})`);
                  const list = run(cli, ['mcp', 'list'], { env }); if (list.status !== 0 || !/videohub/i.test(String(list.stdout) + String(list.stderr))) throw new Error(`${label} did not verify videohub in mcp list`);
                }
              } else { mutateEntry(agent, j, mcp, true); save(p.config, j); }
            } else { mutateEntry(agent, j, mcp, remove); save(p.config, j); }
          }
        }
      }
      const skillFile = path.join(p.skill, 'SKILL.md'), skillText = fs.existsSync(skillFile) ? fs.readFileSync(skillFile, 'utf8') : null;
      if (skillText != null && !ownedText(skillText, hub)) say(`leave ${label} skill belonging to another install unchanged`);
      else if (action === 'uninstall') {
        if (skillText != null) { say(`move ${label} skill folder to Trash: ${p.skill}`); if (!dryRun) { const result = await recycle([p.skill]); if (!result[0]?.ok) throw new Error(result[0]?.error || 'Could not move skill to Trash'); } }
      } else if (action !== 'refresh' || skillText != null) {
        say(`copy VideoHub skill to ${p.skill}`);
        if (!dryRun) { fs.mkdirSync(p.skill, { recursive: true }); for (const f of fs.readdirSync(path.join(hub, 'skill', 'videohub'), { withFileTypes: true }).filter(f => f.isFile())) fs.writeFileSync(path.join(p.skill, f.name), fs.readFileSync(path.join(hub, 'skill', 'videohub', f.name), 'utf8').replaceAll('{{VIDEOHUB_DIR}}', hub.replace(/\\/g, '/'))); }
      }
      const old = fs.existsSync(p.rule) ? fs.readFileSync(p.rule, 'utf8') : '', found = [...old.matchAll(blocks)];
      if (action !== 'uninstall' && found.some(b => !ownedText(b[0], hub))) { say(`leave ${label} rule belonging to another install unchanged`); continue; }
      if (action === 'uninstall') {
        if (found.some(b => ownedText(b[0], hub))) { say(`remove VideoHub rule from ${p.rule}`); if (!dryRun) { fs.copyFileSync(p.rule, p.rule + '.videohub-backup'); fs.writeFileSync(p.rule, old.replace(blocks, block => ownedText(block, hub) ? '' : block)); } }
      } else if ((action === 'refresh' && found.length) || (action === 'setup' && globalRule)) {
        if (/<!-- videohub:begin/.test(old) && !found.length) throw new Error('Incomplete VideoHub rule marker; left unchanged: ' + p.rule);
        const rule = fs.readFileSync(path.join(hub, 'claude', 'global-rule.md'), 'utf8').replaceAll('{{VIDEOHUB_DIR}}', hub.replace(/\\/g, '/')).trim();
        const block = `${begin}\n${rule}\n${end}`;
        say(`write VideoHub rule to ${p.rule}`);
        if (!dryRun) { fs.mkdirSync(p.dir, { recursive: true }); if (fs.existsSync(p.rule)) fs.copyFileSync(p.rule, p.rule + '.videohub-backup'); fs.writeFileSync(p.rule, found.length ? old.replace(blocks, () => block) : (old.trimEnd() ? old.trimEnd() + '\n\n' : '') + block + '\n'); }
        if (agent === 'opencode') actions.push('OpenCode reads its AGENTS.md instead of ~/.claude/CLAUDE.md; other rules were not copied.');
        if (agent === 'codex') actions.push('Codex reads its own AGENTS.md (' + p.rule + '); other rules were not copied.');
      }
    } catch (e) { errors.push(`${label}: ${e.message}`); }
  }
  return { agents, actions, errors, agentName: agents.length === 1 && agents[0] === 'opencode' ? 'OpenCode' : agents.length === 1 && agents[0] === 'codex' ? 'Codex' : 'Claude' };
}
export function parseAgentOptions(args) {
  const out = {};
  for (let i = 0; i < args.length; i++) {
    const key = args[i];
    if (['--detect', '--dry-run', '--set-agent-name', '--help'].includes(key)) out[key] = true;
    else if (['--action', '--agents', '--hub', '--global-rule'].includes(key)) { const value = args[++i]; if (!value || value.startsWith('--')) throw new Error('Missing value for ' + key); out[key] = value; }
    else throw new Error('Unknown option: ' + key);
  }
  if (out['--action'] && !['setup', 'refresh', 'uninstall'].includes(out['--action'])) throw new Error('Unknown agent action: ' + out['--action']);
  if (out['--global-rule'] && !['yes', 'no'].includes(out['--global-rule'])) throw new Error('--global-rule must be yes or no');
  return out;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const options = parseAgentOptions(process.argv.slice(2)), val = key => options[key];
    if (val('--help')) { console.log('Usage: node scripts/agents.mjs [--detect] [--action setup|refresh|uninstall] [--agents claude,codex,opencode] [--hub PATH] [--global-rule yes|no] [--dry-run]'); }
    else if (val('--detect')) console.log(JSON.stringify({ agents: detectAgents() }));
    else {
      const hub = val('--hub') || ROOT;
      const r = await integrateAgents({ action: val('--action') || 'setup', agents: (val('--agents') || 'claude,codex,opencode').split(','), hub, globalRule: val('--global-rule') !== 'no', dryRun: !!val('--dry-run') });
      if (val('--set-agent-name') && !val('--dry-run') && !r.errors.length) { const f = path.join(process.env.VIDEOHUB_DATA_DIR || path.join(hub, 'data'), 'config.json'); if (!fs.existsSync(f)) throw new Error('Set up the workspace before setting its agent name'); const j = readConfig(f); j.agentName = r.agentName; save(f, j); }
      console.log(JSON.stringify(r)); if (r.errors.length) process.exitCode = 1;
    }
  } catch (e) { console.log(JSON.stringify({ actions: [], errors: [e.message] })); process.exitCode = 1; }
}
