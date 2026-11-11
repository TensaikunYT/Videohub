// Shared by the live render page and sidebar; one queued job/native root is one render.
export function activeRenders(data) {
  const guard = data?.guard || {};
  const native = guard.running === false ? [] : guard.renders || [];
  const jobs = (data?.jobs || []).filter(j => ['running', 'queued'].includes(j.state));
  const used = new Set();
  const make = (job, render) => ({
    key: job ? 'job:' + job.id : 'pid:' + render.rootPid,
    job, native: render,
    state: job?.state === 'queued' ? 'queued' : render?.paused ? 'paused' : 'running',
    startedAt: job?.startedAt || render?.start || null,
    progress: Number.isFinite(render?.progress) ? render.progress : Number.isFinite(job?.progress) ? job.progress : null,
    etaSec: Number.isFinite(render?.etaSec) && render.etaSec >= 0 ? render.etaSec : job?.etaSec,
    etaAt: Number.isFinite(render?.etaSec) && render.etaSec >= 0 ? guard.updated : job?.progressAt,
  });
  const rows = jobs.map(j => {
    const r = j.state === 'running' ? native.find(r => r.rootPid === j.pid) : null;
    if (r) used.add(r.rootPid);
    return make(j, r);
  });
  for (const r of native) if (!used.has(r.rootPid)) rows.push(make(null, r));
  return rows.sort((a, b) => {
    const rank = { running: 0, paused: 1, queued: 2 };
    if (a.state !== b.state) return rank[a.state] - rank[b.state];
    if (a.state === 'queued' || b.state === 'queued') return a.state === b.state ? (a.job.position || 0) - (b.job.position || 0) : a.state === 'queued' ? 1 : -1;
    return (Date.parse(a.startedAt) || 0) - (Date.parse(b.startedAt) || 0);
  });
}
export const timestamp = value => typeof value === 'number' ? value : Date.parse(value || '');
export function elapsedSeconds(row, now = Date.now()) {
  const start = timestamp(row.startedAt);
  return row.state === 'queued' || !Number.isFinite(start) ? null : Math.max(0, Math.floor((now - start) / 1000));
}
export function timeText(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return '—';
  seconds = Math.floor(seconds);
  const h = Math.floor(seconds / 3600), m = Math.floor(seconds % 3600 / 60), s = seconds % 60;
  return (h ? h + ' h ' : '') + (m || h ? (h ? String(m).padStart(2, '0') : m) + ' min ' : '') + s + ' s';
}
export function remainingText(row, now = Date.now()) {
  if (row.state === 'queued') return 'Not started yet';
  if (row.state === 'paused') return 'Paused';
  if (row.progress >= 1 || row.etaSec === 0) return 'Finishing up';
  if (!Number.isFinite(row.etaSec) || row.etaSec < 0) return 'Calculating…';
  const sample = timestamp(row.etaAt);
  const age = Number.isFinite(sample) ? Math.max(0, (now - sample) / 1000) : 0;
  if (age > 60 || row.etaSec - age <= 0) return 'Updating estimate…';
  return '≈ ' + timeText(Math.ceil(row.etaSec - age));
}
