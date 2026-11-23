// One small set of inline SVG icons for the whole UI (no emoji as icons, no sprite file, no fonts).
// Stroke icons on a 24 px grid; they take the text colour. No imports and no DOM work at load time, so node tests
// can import modules that use it.
const NS = 'http://www.w3.org/2000/svg';
const F = 'fill="currentColor" stroke="none"';
const P = {
  films: '<rect x="3.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="3.5" y="13.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="13.5" width="7" height="7" rx="1.5"/>',
  renders: '<rect x="3" y="6" width="18" height="14" rx="2"/><path d="M3 10h18M7 6l2 4M12 6l2 4M17 6l2 4"/>',
  image: '<rect x="3.5" y="4.5" width="17" height="15" rx="2"/><circle cx="9" cy="10" r="1.6"/><path d="M4 18l5-5 4 4 2.5-2.5L20 19"/>',
  broom: '<path d="M14 4l-3.5 7M6.5 11.5h8l2 8.5h-12z"/><path d="M8.5 15v5M12.5 15v5"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M12 2.8v2.4M12 18.8v2.4M2.8 12h2.4M18.8 12h2.4M5.5 5.5l1.7 1.7M16.8 16.8l1.7 1.7M5.5 18.5l1.7-1.7M16.8 7.2l1.7-1.7"/>',
  play: `<path d="M8 5.5v13l10.5-6.5z" ${F}/>`,
  pause: `<rect x="7" y="5.5" width="3.4" height="13" rx="1" ${F}/><rect x="13.6" y="5.5" width="3.4" height="13" rx="1" ${F}/>`,
  stop: `<rect x="6.5" y="6.5" width="11" height="11" rx="1.5" ${F}/>`,
  skipb: `<path d="M6 6v12"/><path d="M18 6.5v11L9 12z" ${F}/>`,
  skipf: `<path d="M18 6v12"/><path d="M6 6.5v11l9-5.5z" ${F}/>`,
  rew: `<path d="M11.5 6.5v11L3.5 12zM20.5 6.5v11L12.5 12z" ${F}/>`,
  ffw: `<path d="M3.5 6.5v11l8-5.5zM12.5 6.5v11l8-5.5z" ${F}/>`,
  frameb: '<path d="M14.5 7l-5 5 5 5"/>',
  framef: '<path d="M9.5 7l5 5-5 5"/>',
  loop: '<path d="M4 12a6 6 0 0 1 6-6h8M15 3l3 3-3 3M20 12a6 6 0 0 1-6 6H6M9 21l-3-3 3-3"/>',
  volume: '<path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11"/>',
  mute: '<path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path d="M16 9.5l5 5M21 9.5l-5 5"/>',
  headphones: '<path d="M4 15v-3a8 8 0 0 1 16 0v3"/><rect x="3.5" y="14" width="4" height="6" rx="1.5"/><rect x="16.5" y="14" width="4" height="6" rx="1.5"/>',
  music: '<path d="M9 18V5.5l11-2V16"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="17.5" cy="16" r="2.5"/>',
  sliders: '<path d="M6 4v16M12 4v16M18 4v16"/><rect x="4" y="13" width="4" height="3" rx="1"/><rect x="10" y="7" width="4" height="3" rx="1"/><rect x="16" y="11" width="4" height="3" rx="1"/>',
  chev: '<path d="M7 9.5l5 5 5-5"/>',
  chevup: '<path d="M7 14.5l5-5 5 5"/>',
  chevr: '<path d="M9.5 7l5 5-5 5"/>',
  chevl: '<path d="M14.5 7l-5 5 5 5"/>',
  back: '<path d="M19 12H5M11 6l-6 6 6 6"/>',
  up: '<path d="M12 19V5M6 11l6-6 6 6"/>',
  down: '<path d="M12 5v14M6 13l6 6 6-6"/>',
  lower: '<path d="M6 6l12 12M18 9v9H9"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  pen: '<path d="M4 20l1-4.5L15.5 5a2.1 2.1 0 0 1 3 3L8 18.5z"/><path d="M13.5 7l3 3"/>',
  note: '<path d="M5 4.5h14v11l-4.5 4.5H5z"/><path d="M14.5 20v-4.5H19M8.5 9h7M8.5 12.5h4"/>',
  send: '<path d="M4.5 12L20 4.5 15 20l-3-6.5z"/><path d="M12 13.5L20 4.5"/>',
  file: '<path d="M6 3.5h8l4.5 4.5v12.5H6z"/><path d="M13.5 3.5V8.5h5"/>',
  code: '<path d="M8.5 7.5L4 12l4.5 4.5M15.5 7.5L20 12l-4.5 4.5M13.5 5l-3 14"/>',
  wave: '<path d="M3 12h2M7 8v8M11 5v14M15 9v6M19 7v10"/>',
  video: '<rect x="3" y="5.5" width="13" height="13" rx="2"/><path d="M16 10.5l5-3v9l-5-3z"/>',
  camera: '<path d="M4 8.5h3l1.5-2.5h7L17 8.5h3v10.5H4z"/><circle cx="12" cy="13.5" r="3.5"/>',
  box: '<path d="M3.5 7.5L12 3.5l8.5 4v9L12 20.5l-8.5-4z"/><path d="M3.5 7.5L12 11.5l8.5-4M12 11.5v9"/>',
  folder: '<path d="M3.5 6.5a1.5 1.5 0 0 1 1.5-1.5h4.5l2 2.5H19a1.5 1.5 0 0 1 1.5 1.5v8.5A1.5 1.5 0 0 1 19 19H5a1.5 1.5 0 0 1-1.5-1.5z"/>',
  upload: '<path d="M12 15V4.5M7.5 9L12 4.5 16.5 9M4.5 15v4.5h15V15"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  hourglass: '<path d="M6.5 3.5h11M6.5 20.5h11M7.5 3.5c0 5 9 6 9 8.5s-9 3.5-9 8.5M16.5 3.5c0 5-9 6-9 8.5s9 3.5 9 8.5"/>',
  slow: '<path d="M3 16.5h12.5a4.5 4.5 0 0 0 4.5-4.5v-1a2 2 0 0 0-2-2h-.5"/><path d="M5 16.5a6 6 0 0 1 11-3.3"/><path d="M6 16.5v2M14 16.5v2"/>',
  spark: '<path d="M12 3.5l1.9 5.2 5.1 1.8-5.1 1.9L12 17.5l-1.9-5.1L5 10.5l5.1-1.8z"/><path d="M18.5 16v4M16.5 18h4"/>',
  help: '<circle cx="12" cy="12" r="8.5"/><path d="M9.6 9.5a2.5 2.5 0 1 1 3.6 2.2c-.8.4-1.2 1-1.2 1.8v.5"/><circle cx="12" cy="16.8" r=".6" fill="currentColor"/>',
  info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5.5"/><circle cx="12" cy="7.8" r=".7" fill="currentColor"/>',
  warn: '<path d="M12 4l9 15.5H3z"/><path d="M12 10v4.5"/><circle cx="12" cy="17" r=".7" fill="currentColor"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  trash: '<path d="M4.5 7h15M10 7V4.5h4V7M6.5 7l1 13h9l1-13M10 11v5.5M14 11v5.5"/>',
  x: '<path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/>',
  flag: '<path d="M5.5 21V4M5.5 4.5h11l-2.5 4 2.5 4h-11"/>',
  hammer: '<path d="M13.5 6.5l4 4M11 9L4.5 15.5a1.8 1.8 0 0 0 2.5 2.5L13.5 11.5"/><path d="M10.5 5.5l3-2 7 7-2 3z"/>',
  ready: '<circle cx="12" cy="12" r="8.5"/><path d="M8.3 12.2l2.6 2.6 4.9-5"/>',
  approved: '<path d="M12 2.8l2.3 1.7 2.8-.1.9 2.7 2.3 1.6-.9 2.7.9 2.7-2.3 1.6-.9 2.7-2.8-.1L12 21.2l-2.3-1.7-2.8.1-.9-2.7-2.3-1.6.9-2.7-.9-2.7 2.3-1.6.9-2.7 2.8.1z"/><path d="M8.6 12.2l2.3 2.3 4.5-4.6"/>',
  dashed: '<circle cx="12" cy="12" r="8" stroke-dasharray="3 2.6"/>',
  archive: '<rect x="3.5" y="4.5" width="17" height="4" rx="1"/><path d="M5 8.5v11h14v-11M10 12.5h4"/>',
  reveal: '<path d="M14 4.5h5.5V10M19.5 4.5L11 13M17 14v4.5a1 1 0 0 1-1 1H5.5a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1H10"/>',
  reset: '<path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3L4.5 9"/><path d="M4.5 4.5V9H9"/>',
  refresh: '<path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3L19.5 9"/><path d="M19.5 4.5V9H15"/>',
  shield: '<path d="M12 3.5l7 2.5v5.5c0 4.4-3 7.8-7 9-4-1.2-7-4.6-7-9V6z"/><path d="M9 12l2.2 2.2L15.5 10"/>',
  eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="2.8"/>',
  eyeoff: '<path d="M4 4l16 16M9.9 6A9.5 9.5 0 0 1 12 5.5c6 0 9.5 6.5 9.5 6.5a17 17 0 0 1-2.6 3.4M6.4 7.6C3.9 9.3 2.5 12 2.5 12S6 18.5 12 18.5c1.5 0 2.9-.4 4.1-1"/><path d="M10 10.2a2.8 2.8 0 0 0 3.8 3.8"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/>',
  scan: '<path d="M4 8V5.5A1.5 1.5 0 0 1 5.5 4H8M16 4h2.5A1.5 1.5 0 0 1 20 5.5V8M20 16v2.5a1.5 1.5 0 0 1-1.5 1.5H16M8 20H5.5A1.5 1.5 0 0 1 4 18.5V16M4 12h16"/>',
  bolt: '<path d="M13 3L5 13.5h6L10.5 21 19 10h-6z"/>',
  dot: `<circle cx="12" cy="12" r="4" ${F}/>`,
  book: '<path d="M4.5 5.5A1.5 1.5 0 0 1 6 4h12.5v13H6a1.5 1.5 0 0 0-1.5 1.5z"/><path d="M4.5 18.5A1.5 1.5 0 0 0 6 20h12.5M8.5 8h6M8.5 11h4"/>',
  doc: '<path d="M6 3.5h8l4.5 4.5v12.5H6z"/><path d="M13.5 3.5V8.5h5M9 12h6M9 15h6M9 18h3.5"/>',
  save: '<path d="M5 3.5h11l3.5 3.5v13.5h-15z"/><path d="M8 3.5v5h7v-5M7.5 20.5v-6.5h9v6.5"/>',
  layers: '<path d="M12 3.5l8.5 4.5-8.5 4.5L3.5 8z"/><path d="M3.5 12l8.5 4.5 8.5-4.5M3.5 16l8.5 4.5 8.5-4.5"/>',
  text: '<path d="M5 6.5V4.5h14v2M12 4.5v15M9 19.5h6"/>',
  person: '<circle cx="12" cy="6" r="2.5"/><path d="M12 9v6.5M8 21l4-5.5 4 5.5M7 12h10"/>',
  pin: '<path d="M9 3.5h6M10 3.5v6L7 13h10l-3-3.5v-6M12 13v7.5"/>',
  cut: '<circle cx="6.5" cy="17.5" r="2.5"/><circle cx="17.5" cy="17.5" r="2.5"/><path d="M8.3 15.7L18 4M15.7 15.7L6 4"/>',
  lock: '<rect x="5" y="10.5" width="14" height="10" rx="2"/><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5"/>',
  unlock: '<rect x="5" y="10.5" width="14" height="10" rx="2"/><path d="M8 10.5V8a4 4 0 0 1 7.7-1.5"/>',
  fullscreen: '<path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5"/>',
  zoomin: '<circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5M8 11h6M11 8v6"/>',
  zoomout: '<circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5M8 11h6"/>',
  grid: '<rect x="3.5" y="3.5" width="17" height="17" rx="2"/><path d="M9.2 3.5v17M14.8 3.5v17M3.5 9.2h17M3.5 14.8h17"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2.5M12 19v2.5M2.5 12H5M19 12h2.5M5.3 5.3l1.8 1.8M16.9 16.9l1.8 1.8M5.3 18.7l1.8-1.8M16.9 7.1l1.8-1.8"/>',
  palette: '<path d="M12 3.5a8.5 8.5 0 0 0 0 17c1.2 0 1.8-.8 1.8-1.7 0-1.3-1.2-1.6-1.2-2.8 0-1 .8-1.6 1.8-1.6h2.4a3.7 3.7 0 0 0 3.7-3.7c0-4-3.8-7.2-8.5-7.2z"/><circle cx="8" cy="11" r="1"/><circle cx="11" cy="7.5" r="1"/><circle cx="15.5" cy="8.5" r="1"/>',
  chat: '<path d="M4.5 5.5h15v10h-8l-4.5 4v-4H4.5z"/>',
  swap: '<path d="M4 8h15M15 4l4 4-4 4M20 16H5M9 12l-4 4 4 4"/>',
  hand: '<path d="M8 11.5V6a1.5 1.5 0 0 1 3 0v5M11 10.5V4.8a1.5 1.5 0 0 1 3 0v5.7M14 10.5V6.3a1.5 1.5 0 0 1 3 0V14a6.5 6.5 0 0 1-6.5 6.5c-2.6 0-4-1.3-5.4-3.4L3.6 13a1.5 1.5 0 0 1 2.5-1.6L8 13.5"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  pulse: '<path d="M3 12.5h4l2.5-6.5 5 13 2.5-6.5H21"/>',
  spin: '<path d="M12 3.5a8.5 8.5 0 1 1-8.5 8.5"/>',
  moon: '<path d="M19.5 14.6A8 8 0 0 1 9.4 4.5a8 8 0 1 0 10.1 10.1z"/>',
  plan: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 11h18M9 11v9M15 11v9"/>',
  more: `<circle cx="6" cy="12" r="1.5" ${F}/><circle cx="12" cy="12" r="1.5" ${F}/><circle cx="18" cy="12" r="1.5" ${F}/>`,
};

// icon('folder') → <svg class="i">; opts: { cls, size, title }
export function icon(name, { cls = '', size = 0, title = '' } = {}) {
  const s = document.createElementNS(NS, 'svg');
  s.setAttribute('viewBox', '0 0 24 24');
  s.setAttribute('class', 'i' + (cls ? ' ' + cls : ''));
  if (title) { s.setAttribute('role', 'img'); s.setAttribute('aria-label', title); } else s.setAttribute('aria-hidden', 'true');
  if (size) { s.style.width = size + 'px'; s.style.height = size + 'px'; }
  s.innerHTML = P[name] || P.dot;
  return s;
}
// an icon in front of a label: [svg, text] for h() children
export const ic = (name, text) => text == null || text === '' ? icon(name) : [icon(name, { cls: 'il' }), text];
export const hasIcon = name => Object.prototype.hasOwnProperty.call(P, name);

// the agents' marks (their own colours, as in the approved mockup)
const AGENT_GLYPH = {
  claude: '<g stroke="#e08a5f" stroke-width="2.4" stroke-linecap="round" fill="none"><path d="M12 3.5v17M3.5 12h17M6 6l12 12M18 6L6 18"/></g>',
  codex: '<path d="M12 3l7.8 4.5v9L12 21l-7.8-4.5v-9z" fill="none" stroke="#e8eaee" stroke-width="2"/><circle cx="12" cy="12" r="3" fill="#e8eaee"/>',
  opencode: '<path d="M9 5H5v14h4M15 5h4v14h-4" fill="none" stroke="#9fd3ff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>',
  shared: '<g fill="none" stroke="#b6f067" stroke-width="2" stroke-linecap="round"><circle cx="7" cy="12" r="3"/><circle cx="17" cy="6.5" r="3"/><circle cx="17" cy="17.5" r="3"/><path d="M9.7 10.6l4.6-2.6M9.7 13.4l4.6 2.6"/></g>',
  reasonix: '<g fill="none" stroke="#8ee6b0" stroke-width="2" stroke-linecap="round"><circle cx="7" cy="12" r="3"/><circle cx="17" cy="6.5" r="3"/><circle cx="17" cy="17.5" r="3"/><path d="M9.7 10.6l4.6-2.6M9.7 13.4l4.6 2.6"/></g>',
};
export function agentIcon(agent, size = 16) {
  const s = document.createElementNS(NS, 'svg');
  s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('class', 'ag-glyph'); s.setAttribute('aria-hidden', 'true');
  s.style.width = size + 'px'; s.style.height = size + 'px';
  s.innerHTML = AGENT_GLYPH[agent] || AGENT_GLYPH.claude;
  return s;
}

// the VideoHub mark (ui/icon.svg)
export function logo(size = 34) {
  const s = document.createElementNS(NS, 'svg');
  s.setAttribute('viewBox', '0 0 128 128'); s.setAttribute('width', size); s.setAttribute('height', size); s.setAttribute('aria-hidden', 'true');
  s.innerHTML = '<rect width="128" height="128" rx="28" fill="#101824"/><rect x="18" y="27" width="92" height="74" rx="12" fill="#27384e"/><path d="M52 43L85 64 52 85Z" fill="#b6f067"/>';
  return s;
}
