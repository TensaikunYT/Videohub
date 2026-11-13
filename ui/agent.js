// Presentation preference only; stored note/status values keep their compatibility names.
let name = 'Claude';
export const agentName = () => name;
export function setAgentName(value) { name = typeof value === 'string' && value.trim() ? value.trim().slice(0,40) : 'Claude'; return name; }
