// [REASONIX PATCH] Settings -> Agent provider, plus the "Send to <agent>" dispatch used by the review panel.
//
// This file is new and self-contained: it receives h/api/toast/confirmBox from the caller instead of importing
// app.js, so there is no import cycle and the original settings code only needs one guarded call site.
//
// Providers:
//   claude   : the original flow (copy the message; the agent reads the notes through the videohub MCP server)
//   reasonix : run the Reasonix CLI in the project folder. It has file tools, so it really applies the notes.
//   deepseek : call the DeepSeek API. It answers in a dialog; it cannot edit files.
const LABELS = { claude: 'Claude', reasonix: 'Reasonix', deepseek: 'DeepSeek' };
export const providerLabel = p => LABELS[p] || 'Claude';
// Which provider is saved right now. The review panel asks this before sending, so claude keeps the upstream
// inbox flow and only reasonix/deepseek go through the new dispatcher.
export async function providerNow({ api }) {
  try { const r = await api('/api/agent'); return r?.config?.provider || 'claude'; } catch { return 'claude'; }
}

export function agentSettings(c, { h, api, toast, confirmBox }) {
  const a = c.agent || {};
  const state = {
    provider: a.provider || 'claude',
    reasonixPath: a.reasonixPath || '',
    reasonixModel: a.reasonixModel || '',
    reasonixMaxSteps: a.reasonixMaxSteps || 80,
    deepseekBaseUrl: a.deepseekBaseUrl || 'https://api.deepseek.com',
    deepseekModel: a.deepseekModel || 'deepseek-chat',
  };
  let typedKey = '';                 // only a new key; a saved key stays on the server
  const field = (label, input, help) => h('div', { class: 'row', style: { margin: '6px 0', alignItems: 'center', gap: '8px' } },
    h('span', { style: { width: '150px', flex: 'none' } }, label), input, help ? h('span', { class: 'dim', style: { fontSize: '12px' } }, help) : null);
  const status = h('div', { class: 'sub', style: { marginTop: '8px' } });

  const provider = h('select', {}, [
    ['claude', 'Claude Code / OpenCode — copies the message (MCP)'],
    ['reasonix', 'Reasonix CLI (`reasonix` / `r`) — edits the film'],
    ['deepseek', 'DeepSeek API key — answers in the app'],
  ].map(([v, text]) => h('option', { value: v, selected: state.provider === v }, text)));
  provider.onchange = () => { state.provider = provider.value; sync(); };

  const rPath = h('input', { value: state.reasonixPath, placeholder: 'auto-detected — leave empty', style: { width: '360px' } });
  rPath.oninput = () => { state.reasonixPath = rPath.value; };
  const rModel = h('input', { value: state.reasonixModel, placeholder: 'default model from Reasonix config', style: { width: '250px' } });
  rModel.oninput = () => { state.reasonixModel = rModel.value; };
  const rSteps = h('input', { type: 'number', min: '1', max: '500', value: String(state.reasonixMaxSteps), style: { width: '90px' } });
  rSteps.oninput = () => { state.reasonixMaxSteps = +rSteps.value || 80; };
  const detectBtn = h('button', { type: 'button', class: 'ghost', onclick: async () => {
    detectBtn.disabled = true; const old = detectBtn.textContent; detectBtn.textContent = 'Looking…';
    try {
      const d = await api('/api/agent/detect', { method: 'POST', body: {} });
      if (d.ok) { state.reasonixPath = d.path; rPath.value = d.path; toast(`Reasonix found: ${d.version || d.path}`); }
      else toast(d.why || 'Reasonix CLI not found', true);
      status.textContent = d.ok ? `Detected ${d.version || ''} at ${d.path} (${d.from})` : (d.why || 'Not found');
    } catch (e) { toast('Could not look for Reasonix: ' + e.message, true); }
    finally { detectBtn.disabled = false; detectBtn.textContent = old; }
  } }, 'Detect');
  const reasonixBox = h('div', {},
    field('CLI path', rPath, detectBtn),
    field('Model (optional)', rModel),
    field('Max tool steps', rSteps, 'a hard stop for one run'),
    h('p', { class: 'dim', style: { fontSize: '12.5px' } }, 'The CLI is started in the project folder with --permission-mode auto. It reads the notes (also through the videohub MCP tools when available), edits files and stops. VideoHub never renders on its own.'));

  const key = h('input', { type: 'password', placeholder: a.deepseekApiKeySet ? 'a key is saved — leave blank to keep it' : 'sk-…', style: { width: '360px' }, autocomplete: 'off' });
  key.oninput = () => { typedKey = key.value; };
  const base = h('input', { value: state.deepseekBaseUrl, style: { width: '360px' } });
  base.oninput = () => { state.deepseekBaseUrl = base.value; };
  const model = h('input', { value: state.deepseekModel, style: { width: '250px' } });
  model.oninput = () => { state.deepseekModel = model.value; };
  const testBtn = h('button', { type: 'button', class: 'ghost', onclick: async () => {
    testBtn.disabled = true; const old = testBtn.textContent; testBtn.textContent = 'Testing…';
    try {
      const r = await api('/api/agent/test', { method: 'POST', body: { agent: values() } });
      status.textContent = r.models?.length ? `Connected. Models: ${r.models.join(', ')}` : 'Connected to DeepSeek.';
      toast('DeepSeek API works');
    } catch (e) { toast('DeepSeek test failed: ' + e.message, true); }
    finally { testBtn.disabled = false; testBtn.textContent = old; }
  } }, 'Test');
  const importBtn = h('button', { type: 'button', class: 'ghost', onclick: async () => {
    importBtn.disabled = true; const old = importBtn.textContent; importBtn.textContent = 'Importing…';
    try {
      const r = await api('/api/agent/import-key', { method: 'POST', body: {} });
      key.value = ''; typedKey = ''; key.placeholder = 'a key is saved — leave blank to keep it';
      toast(`Key imported from ${r.file}`);
    } catch (e) { toast('Could not import the key: ' + e.message, true); }
    finally { importBtn.disabled = false; importBtn.textContent = old; }
  } }, 'Import key from Reasonix');
  const deepseekBox = h('div', {},
    field('API key', key, h('span', {}, importBtn)),
    field('Base URL', base, 'OpenAI-compatible endpoint'),
    field('Model', model, testBtn),
    h('p', { class: 'dim', style: { fontSize: '12.5px' } }, 'The key is stored in data/config.json on this computer and is never sent back to the browser. This mode answers in a dialog; use Reasonix CLI when the agent must change files.'));

  const runsBox = h('div', { class: 'panel', style: { marginTop: '8px', padding: '6px 10px' } });
  const drawRuns = rs => {
    runsBox.replaceChildren(...(rs?.length ? rs.slice(0, 5).map(r => h('div', { class: 'row', style: { gap: '8px', alignItems: 'center' } },
      h('span', { class: 'pill ' + r.state }, r.state),
      h('b', {}, r.projectName || r.project), h('span', { class: 'dim' }, `${(r.notes || []).length} note(s) · ${r.startedAt || ''}`),
      r.state === 'running' ? h('button', { type: 'button', class: 'ghost danger', onclick: async () => { await api(`/api/agent/runs/${r.id}/cancel`, { method: 'POST' }).catch(e => toast(e.message, true)); refreshRuns(); } }, 'Cancel') : null,
      r.state === 'running' && r.log ? h('span', { class: 'dim mono', style: { fontSize: '11px', overflow: 'hidden', textOverflow: 'ellipsis' } }, r.log) : null)) : [h('div', { class: 'dim' }, 'No agent runs yet.')]));
  };
  const refreshRuns = () => api('/api/agent/runs').then(drawRuns).catch(() => { });
  refreshRuns();

  function sync() {
    reasonixBox.hidden = state.provider !== 'reasonix';
    deepseekBox.hidden = state.provider !== 'deepseek';
    status.textContent = state.provider === 'claude'
      ? 'The original flow: the message is copied and your Claude Code / OpenCode session reads the notes through the videohub MCP server.'
      : '';
  }
  sync();

  // The parent Settings page saves this object together with the rest of the settings.
  function values() {
    return {
      provider: state.provider,
      reasonixPath: state.reasonixPath.trim(),
      reasonixModel: state.reasonixModel.trim(),
      reasonixMaxSteps: state.reasonixMaxSteps,
      deepseekBaseUrl: state.deepseekBaseUrl.trim(),
      deepseekModel: state.deepseekModel.trim(),
      ...(typedKey.trim() ? { deepseekApiKey: typedKey.trim() } : {}),
    };
  }

  const el = h('div', {},
    h('h2', {}, 'Agent provider'), h('div', { class: 'sub' }, 'Which AI should receive the review notes. The original app uses Claude Code or OpenCode; Reasonix works without either.'),
    field('Provider', provider),
    reasonixBox, deepseekBox, status,
    h('h2', { style: { marginTop: '14px' } }, 'Agent runs'), runsBox);

  return { el, values, label: () => providerLabel(state.provider), refreshRuns };
}

// "Send to <agent>": what happens depends on the provider the server has saved.
export async function sendAgentNotes(projectId, { h, api, toast, confirmBox }) {
  let r;
  try { r = await api(`/api/project/${projectId}/agent`, { method: 'POST', body: {} }); }
  catch (e) { toast('Could not send to the agent: ' + e.message, true); return; }
  if (r.kind === 'clipboard') {
    try { await navigator.clipboard.writeText(r.text); toast('Message copied to the clipboard. Paste it into the project chat.'); }
    catch { await confirmBox('Paste into chat', h('textarea', { style: { width: '100%', minHeight: '90px' } }, r.text), 'OK'); }
    return;
  }
  if (r.kind === 'deepseek') {
    const answer = String(r.text || '');
    const copy = await confirmBox(`DeepSeek · ${r.noteCount} note${r.noteCount === 1 ? '' : 's'}`,
      h('div', {}, h('p', { class: 'dim', style: { fontSize: '12px' } }, `${r.model || ''}${r.tookMs ? ` · ${Math.round(r.tookMs / 1000)} s` : ''} · answers only, it cannot edit files`),
        h('pre', { style: { whiteSpace: 'pre-wrap', maxHeight: '55vh', overflow: 'auto', userSelect: 'text' } }, answer)), 'Copy answer');
    if (copy) try { await navigator.clipboard.writeText(answer); toast('Answer copied'); } catch { }
    return;
  }
  if (r.kind === 'run') {
    toast(`Sent ${r.noteCount} note${r.noteCount === 1 ? '' : 's'} to Reasonix. Working in the project folder…`);
    await watchRun(r.run.id, { h, api, toast, confirmBox });
  }
}

async function watchRun(id, { h, api, toast, confirmBox }) {
  const deadline = Date.now() + 20 * 60e3;
  while (Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 2500));
    let run;
    try { run = await api(`/api/agent/runs/${id}`); } catch { continue; }
    if (!['done', 'failed', 'cancelled'].includes(run.state)) continue;
    if (run.state === 'done') {
      const text = String(run.output || '').trim() || '(Reasonix gave no output.)';
      const copy = await confirmBox('Reasonix finished', h('pre', { style: { whiteSpace: 'pre-wrap', maxHeight: '60vh', overflow: 'auto', userSelect: 'text' } }, text), 'Copy output');
      if (copy) try { await navigator.clipboard.writeText(text); toast('Output copied'); } catch { }
    } else toast(`Reasonix ${run.state}${run.error ? ': ' + run.error : ''}`, true);
    return;
  }
  toast('Reasonix is still running. See Settings → Agent provider → Agent runs.', true);
}
