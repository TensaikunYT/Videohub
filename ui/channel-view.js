// Plain helpers for the agent channel (plan, questions, hub_wait) as the UI shows it: the agent drawer, the Review
// tab's "waiting for you" line, the Plan tab and the notes panel. No DOM, no imports from app.js, so node tests can
// load them. The data is GET /api/project/:id/channel (server/channel.js).
export const SCENE_STATE = {
  planned: { label: 'Planned', icon: 'dashed' },
  ready: { label: 'Ready', icon: 'ready' },
  approved: { label: 'Approved', icon: 'approved' },
  changes: { label: 'Change requested', icon: 'flag' },
};
export const sceneState = s => SCENE_STATE[s?.state] ? s.state : 'planned';

// 42.5 → "0:43"; 3725 → "1:02:05"
export function mss(sec) {
  const s = Math.max(0, Math.round(+sec || 0)), m = Math.floor(s / 60);
  return m >= 60 ? `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}` : `${m}:${String(s % 60).padStart(2, '0')}`;
}
export const planSeconds = plan => (plan?.scenes || []).reduce((s, x) => s + (+x.seconds || 0), 0);
export const planTitle = plan => plan ? `Plan v${plan.v} · ${plan.scenes.length} scene${plan.scenes.length === 1 ? '' : 's'} · ${mss(planSeconds(plan))}` : '';
export function planCounts(plan) {
  const c = { planned: 0, ready: 0, approved: 0, changes: 0 };
  for (const s of plan?.scenes || []) c[sceneState(s)]++;
  return c;
}
export const openQuestions = chan => (chan?.questions || []).filter(q => q.state === 'open');
export const planWaiting = chan => !!(chan?.plan && !chan.plan.approvedAt);
// things waiting for the user: open questions and a plan to approve
export const needCount = chan => openQuestions(chan).length + (planWaiting(chan) ? 1 : 0);
// the agent is in hub_wait on this film right now
export const agentWaiting = chan => !!chan?.waiting;

// the Review tab's slim line: shown when the agent waits or a question is open; null hides it
export function waitLine(chan, agent = 'The agent') {
  const qs = openQuestions(chan).length, plan = planWaiting(chan), waiting = agentWaiting(chan);
  if (!waiting && !qs) return null;
  const who = chan?.waiting?.agent || agent;
  const parts = [];
  if (qs) parts.push(qs === 1 ? 'an answer to its question' : `answers to ${qs} questions`);
  if (plan) parts.push(`your OK on plan v${chan.plan.v}`);
  if (!parts.length) parts.push('your notes: press “Send to agent” when you are ready');
  const list = parts.length > 1 ? parts.slice(0, -1).join(', ') + ' and ' + parts.at(-1) : parts[0];
  return { lead: waiting ? `${who} is waiting for` : `${who} asked for`, text: list, button: qs ? (qs === 1 ? 'Answer the question' : `Answer ${qs} questions`) : 'Open agent', questions: qs };
}

// one inbox item (what the user did) as a line in the drawer's "Recent actions"
export function itemText(it) {
  switch (it?.type) {
    case 'notes': return { icon: 'send', text: `You sent ${it.ids?.length || 0} note${it.ids?.length === 1 ? '' : 's'}` };
    case 'scene-note': return { icon: 'note', text: `You left a note on scene ${it.n} · ${it.title}` };
    case 'answer': return { icon: 'check', text: `You answered: ${it.label != null ? it.label : 'in your words'}${it.changed ? ' (changed)' : ''}` };
    case 'plan-approved': return { icon: 'approved', text: `You approved plan v${it.v}` };
    case 'scene-approved': return { icon: 'approved', text: `You approved scene ${it.n} · ${it.title}` };
    default: return { icon: 'dot', text: 'Something you did' };
  }
}
// the notes panel: a note's place in the channel (null = not sent)
export function sentState(n, agent = 'agent') {
  if (n.status === 'claude') return { cls: 'claude', label: `With ${agent}` };
  if (n.sentAt && (n.status === 'open' || n.status === 'reopened')) return { cls: 'queued', label: 'Sent', title: `Sent: ${agent} gets it the next time it checks VideoHub` };
  return null;
}
export const unsentNotes = notes => (notes || []).filter(n => (n.status === 'open' || n.status === 'reopened') && !n.sentAt);
