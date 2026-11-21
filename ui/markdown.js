// A small, safe Markdown renderer for the Skills page. It builds DOM nodes with createElement / textContent only:
// file text never reaches innerHTML, raw HTML in a file shows as text, and links are shown as text with their URL
// (nothing in a skill file can navigate the page). Covers what skill files use: front matter (a small key/value strip),
// headings, paragraphs, bold / italic / strikethrough / inline code, nested lists, fenced and indented code blocks,
// block quotes, tables and horizontal rules.
// No imports and no DOM work at load time: the server imports parseFrontMatter, node tests import everything.

// ---------- front matter (a YAML subset: scalars, quoted strings, block scalars, lists, one level of maps)
const unquote = v => {
  v = v.trim();
  if (/^".*"$/s.test(v)) return v.slice(1, -1).replace(/\\(["\\nt])/g, (m, c) => c === 'n' ? '\n' : c === 't' ? '\t' : c);
  if (/^'.*'$/s.test(v)) return v.slice(1, -1).replace(/''/g, "'");
  return v.replace(/\s+#.*$/, '');
};
const inlineList = v => { const m = /^\[(.*)\]$/s.exec(v.trim()); return m ? (m[1].trim() ? m[1].split(',').map(unquote).filter(x => x !== '') : []) : null; };
export function parseYamlLite(text) {
  const lines = String(text || '').split('\n'), data = {};
  const indent = l => l.length - l.trimStart().length;
  for (let i = 0; i < lines.length; i++) {
    const m = /^([A-Za-z0-9_][\w.\- ]*?)\s*:(?:\s+(.*)|\s*)$/.exec(lines[i]);
    if (!m || indent(lines[i]) > 0) continue;
    const k = m[1].trim(); let v = (m[2] || '').trim();
    const block = [];
    while (i + 1 < lines.length && (lines[i + 1].trim() === '' || indent(lines[i + 1]) > 0)) block.push(lines[++i]);
    while (block.length && !block[block.length - 1].trim()) block.pop();
    const body = block.map(l => l.trim());
    if (/^[|>][+-]?$/.test(v)) {   // block scalar: literal keeps lines, folded joins them
      data[k] = v[0] === '|' ? block.map(l => l.slice(Math.min(...block.filter(x => x.trim()).map(indent)))).join('\n').trim() : body.join('\n').replace(/([^\n])\n(?=[^\n])/g, '$1 ').replace(/\n+/g, '\n').trim();
    } else if (!v && body.length && body.every(l => !l || l.startsWith('- ') || l === '-')) {
      data[k] = body.filter(Boolean).map(l => unquote(l.replace(/^-\s*/, '')));
    } else if (!v && body.length && body.every(l => !l || /^[\w.-]+\s*:/.test(l))) {
      const o = {}; for (const l of body.filter(Boolean)) { const mm = /^([\w.-]+)\s*:\s*(.*)$/.exec(l); o[mm[1]] = inlineList(mm[2]) || unquote(mm[2]); } data[k] = o;
    } else {
      // a plain or quoted scalar, maybe continued on indented lines
      const all = [v, ...body].filter(Boolean).join(' ');
      data[k] = inlineList(all) || unquote(all);
    }
  }
  return data;
}
// { data: {…} | null, body } (CRLF and a BOM are normalised first)
export function parseFrontMatter(src) {
  const s = String(src ?? '').replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  if (!/^---[ \t]*\n/.test(s)) return { data: null, body: s };
  const lines = s.split('\n');
  for (let j = 1; j < lines.length; j++) if (/^(---|\.\.\.)[ \t]*$/.test(lines[j])) return { data: parseYamlLite(lines.slice(1, j).join('\n')), body: lines.slice(j + 1).join('\n') };
  return { data: null, body: s };
}

// ---------- inline: text, strong, em, del, code, link (text + url), image (alt + url), br
export function parseInline(src) {
  const s = String(src ?? ''), out = [];
  let buf = '';
  const flush = () => { if (buf) { out.push({ t: 'text', v: buf }); buf = ''; } };
  for (let i = 0; i < s.length;) {
    const c = s[i];
    if (c === '\\' && i + 1 < s.length) {
      if (s[i + 1] === '\n') { flush(); out.push({ t: 'br' }); i += 2; continue; }
      if (/[\\`*_{}\[\]()#+\-.!|~<>"']/.test(s[i + 1])) { buf += s[i + 1]; i += 2; continue; }
    }
    if (c === '`') {
      let n = 0; while (s[i + n] === '`') n++;
      const fence = '`'.repeat(n);
      let j = s.indexOf(fence, i + n);
      while (j >= 0 && s[j + n] === '`') { let k = j; while (s[k] === '`') k++; j = s.indexOf(fence, k); }
      if (j >= 0) { flush(); let code = s.slice(i + n, j).replace(/\n/g, ' '); if (/^ .* $/.test(code) && code.trim()) code = code.slice(1, -1); out.push({ t: 'code', v: code }); i = j + n; continue; }
      buf += fence; i += n; continue;
    }
    if (c === '!' && s[i + 1] === '[') { const l = linkAt(s, i + 1); if (l) { flush(); out.push({ t: 'image', alt: l.text, url: l.url }); i = l.end; continue; } }
    if (c === '[') { const l = linkAt(s, i); if (l) { flush(); out.push({ t: 'link', kids: parseInline(l.text), url: l.url }); i = l.end; continue; } }
    if (c === '<') { const m = /^<((?:https?|mailto|ftp):[^\s<>]+)>/i.exec(s.slice(i)); if (m) { flush(); out.push({ t: 'link', kids: [{ t: 'text', v: m[1] }], url: m[1] }); i += m[0].length; continue; } }
    if (c === '\n') {
      // two trailing spaces: a hard line break
      if (/ {2,}$/.test(buf)) { buf = buf.replace(/ +$/, ''); flush(); out.push({ t: 'br' }); i++; continue; }
      buf += '\n'; i++; continue;
    }
    if (c === '*' || c === '_' || c === '~') {
      const e = emphasisAt(s, i);
      if (e) { flush(); out.push({ t: e.t, kids: parseInline(e.inner) }); i = e.end; continue; }
    }
    buf += c; i++;
  }
  flush();
  return out;
}
// [text](url "title") starting at s[i] === '['
function linkAt(s, i) {
  let depth = 0, j = i;
  for (; j < s.length; j++) {
    if (s[j] === '\\') { j++; continue; }
    if (s[j] === '[') depth++;
    else if (s[j] === ']' && --depth === 0) break;
  }
  if (j >= s.length || s[j + 1] !== '(') return null;
  let k = j + 2, d = 1;
  for (; k < s.length; k++) { if (s[k] === '\\') { k++; continue; } if (s[k] === '(') d++; else if (s[k] === ')' && --d === 0) break; if (s[k] === '\n' && s[k + 1] === '\n') return null; }
  if (k >= s.length) return null;
  let url = s.slice(j + 2, k).trim();
  const tm = /^(\S+)\s+(".*"|'.*'|\(.*\))$/s.exec(url); if (tm) url = tm[1];
  if (/^<.*>$/.test(url)) url = url.slice(1, -1);
  return { text: s.slice(i + 1, j), url, end: k + 1 };
}
// **strong**, __strong__, *em*, _em_, ~~del~~ (no intraword underscores; no opening before a space)
function emphasisAt(s, i) {
  const c = s[i];
  const two = s[i + 1] === c;
  if (c === '~' && !two) return null;
  const d = two ? c + c : c;
  const after = s[i + d.length];
  if (!after || /\s/.test(after) || (c !== '~' && after === c && !two)) return null;
  if (c === '_' && /[A-Za-z0-9]/.test(s[i - 1] || '')) return null;
  for (let j = s.indexOf(d, i + d.length); j >= 0; j = s.indexOf(d, j + 1)) {
    if (s[j - 1] === '\\' || /\s/.test(s[j - 1])) continue;
    if (!two && s[j + 1] === c) { j++; continue; }   // part of a ** run, not a closing *
    if (c === '_' && /[A-Za-z0-9]/.test(s[j + d.length] || '')) continue;
    const inner = s.slice(i + d.length, j);
    if (!inner.trim() || /\n\s*\n/.test(inner)) return null;
    return { t: c === '~' ? 'del' : two ? 'strong' : 'em', inner, end: j + d.length };
  }
  return null;
}

// ---------- blocks
const FENCE = /^( {0,3})(`{3,}|~{3,})[ \t]*([^`\s]*)[^`]*$/;
const HEADING = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?(?:[ \t]+#+)?[ \t]*$/;
const HR = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/;
const QUOTE = /^ {0,3}>/;
const ITEM = /^( *)([-*+]|\d{1,9}[.)])([ \t]+|$)/;
const TABLE_SEP = /^ *\|?(?: *:?-+:? *\|)+ *:?-+:? *\|? *$|^ *\|? *:?-+:? *\| *$/;
const expandTabs = l => l.replace(/^\t+/, t => '    '.repeat(t.length));
const indentOf = l => l.length - l.trimStart().length;
const isBlank = l => !l || !l.trim();
const startsBlock = (l, next) => FENCE.test(l) || HEADING.test(l) || HR.test(l) || QUOTE.test(l) || ITEM.test(l) && !/^ *\d/.test(l) || /^ {0,3}1[.)][ \t]/.test(l) || (l.includes('|') && next != null && TABLE_SEP.test(next));
function splitRow(l) {
  let s = l.trim(); if (s.startsWith('|')) s = s.slice(1); if (s.endsWith('|') && !s.endsWith('\\|')) s = s.slice(0, -1);
  const cells = []; let cur = '', code = 0;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '\\' && s[i + 1] === '|') { cur += '|'; i++; continue; }
    if (s[i] === '`') code ^= 1;
    if (s[i] === '|' && !code) { cells.push(cur.trim()); cur = ''; continue; }
    cur += s[i];
  }
  cells.push(cur.trim());
  return cells;
}
export function parseBlocks(lines) {
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const l = lines[i];
    if (isBlank(l)) { i++; continue; }
    let m;
    if ((m = FENCE.exec(l))) {
      const ind = m[1].length, mark = m[2], body = [];
      i++;
      while (i < lines.length && !(new RegExp('^ {0,3}' + (mark[0] === '`' ? '`' : '~') + '{' + mark.length + ',}[ \\t]*$').test(lines[i]))) { body.push(lines[i].replace(new RegExp('^ {0,' + ind + '}'), '')); i++; }
      i++;   // the closing fence (or the end of the file)
      out.push({ t: 'code', lang: m[3] || '', v: body.join('\n') });
      continue;
    }
    if ((m = HEADING.exec(l))) { out.push({ t: 'heading', level: m[1].length, kids: parseInline(m[2] || '') }); i++; continue; }
    if (HR.test(l)) { out.push({ t: 'hr' }); i++; continue; }
    if (indentOf(l) >= 4) {   // indented code
      const body = [];
      while (i < lines.length && (indentOf(lines[i]) >= 4 || isBlank(lines[i]))) { body.push(lines[i].slice(4)); i++; }
      while (body.length && isBlank(body[body.length - 1])) body.pop();
      out.push({ t: 'code', lang: '', v: body.join('\n') });
      continue;
    }
    if (QUOTE.test(l)) {
      const body = [];
      while (i < lines.length && !isBlank(lines[i]) && (QUOTE.test(lines[i]) || !startsBlock(lines[i], lines[i + 1]))) { body.push(lines[i].replace(/^ {0,3}> ?/, '')); i++; }
      out.push({ t: 'quote', kids: parseBlocks(body) });
      continue;
    }
    if ((m = ITEM.exec(l))) { const r = parseList(lines, i); out.push(r.list); i = r.end; continue; }
    if (l.includes('|') && i + 1 < lines.length && TABLE_SEP.test(lines[i + 1])) {
      const head = splitRow(l), align = splitRow(lines[i + 1]).map(c => /^:-+:$/.test(c) ? 'center' : /-:$/.test(c) ? 'right' : /^:-/.test(c) ? 'left' : '');
      const rows = []; i += 2;
      while (i < lines.length && !isBlank(lines[i]) && lines[i].includes('|')) { rows.push(splitRow(lines[i]).map(parseInline)); i++; }
      out.push({ t: 'table', align, head: head.map(parseInline), rows });
      continue;
    }
    const body = [l.trim()]; i++;
    while (i < lines.length && !isBlank(lines[i]) && !startsBlock(lines[i], lines[i + 1]) && !(lines[i].includes('|') && i + 1 < lines.length && TABLE_SEP.test(lines[i + 1]))) { body.push(lines[i].replace(/^ +/, '')); i++; }
    out.push({ t: 'p', kids: parseInline(body.join('\n')) });
  }
  return out;
}
function parseList(lines, i) {
  const first = ITEM.exec(lines[i]), base = first[1].length, ordered = /\d/.test(first[2]);
  const list = { t: 'list', ordered, start: ordered ? parseInt(first[2], 10) : 1, loose: false, items: [] };
  while (i < lines.length) {
    const m = ITEM.exec(lines[i]);
    if (!m || m[1].length !== base || /\d/.test(m[2]) !== ordered) break;
    const contentIndent = m[0].length && m[3] ? m[0].length : m[1].length + m[2].length + 1;
    const body = [lines[i].slice(m[0].length)]; i++;
    let blankInside = false;
    while (i < lines.length) {
      const l = lines[i];
      if (isBlank(l)) {
        let j = i + 1; while (j < lines.length && isBlank(lines[j])) j++;
        if (j < lines.length && indentOf(lines[j]) >= contentIndent) { body.push(''); blankInside = true; i++; continue; }
        break;
      }
      const ind = indentOf(l);
      if (ind >= contentIndent) { body.push(l.slice(contentIndent)); i++; continue; }
      if (ind > base && (ITEM.test(l) || FENCE.test(l))) { body.push(l.slice(ind)); i++; continue; }   // a nested list indented less than the text
      if (ITEM.test(l) || startsBlock(l, lines[i + 1])) break;
      body.push(l.trim()); i++;   // a lazy continuation line
    }
    if (blankInside) list.loose = true;   // blocks inside an item separated by a blank line
    list.items.push({ kids: parseBlocks(body) });
    // blank lines between items of the same list make it loose
    let j = i; while (j < lines.length && isBlank(lines[j])) j++;
    if (j > i && j < lines.length) { const n = ITEM.exec(lines[j]); if (n && n[1].length === base && /\d/.test(n[2]) === ordered) { list.loose = true; i = j; continue; } }
    if (j > i) break;
  }
  return { list, end: i };
}
export function parseMarkdown(src) {
  const { data, body } = parseFrontMatter(src);
  return { frontMatter: data, blocks: parseBlocks(body.split('\n').map(expandTabs)) };
}

// ---------- DOM (createElement / textContent only)
const SAFE_LANG = /^[\w+#.-]{1,24}$/;
export function renderMarkdown(src, { doc = globalThis.document, frontMatter = true } = {}) {
  const { frontMatter: fm, blocks } = parseMarkdown(src);
  const el = (tag, cls, text) => { const e = doc.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const inline = (nodes, parent) => {
    for (const n of nodes) {
      if (n.t === 'text') parent.append(doc.createTextNode(n.v));
      else if (n.t === 'br') parent.append(el('br'));
      else if (n.t === 'code') parent.append(el('code', '', n.v));
      else if (n.t === 'strong' || n.t === 'em' || n.t === 'del') { const e = el(n.t === 'strong' ? 'b' : n.t === 'em' ? 'i' : 'del'); inline(n.kids, e); parent.append(e); }
      else if (n.t === 'link') {
        // shown, not followed: the text, then the address in small type (selectable, no href)
        const e = el('span', 'md-link'); e.setAttribute('title', n.url); inline(n.kids, e);
        const text = n.kids.map(k => k.v || '').join('');
        if (n.url && n.url !== text) e.append(el('span', 'md-url', n.url));
        parent.append(e);
      } else if (n.t === 'image') { const e = el('span', 'md-img', 'Image: ' + (n.alt || 'untitled')); if (n.url) e.append(el('span', 'md-url', n.url)); parent.append(e); }
    }
    return parent;
  };
  const block = (b, parent, tight = false) => {
    if (b.t === 'p') { if (tight) inline(b.kids, parent); else parent.append(inline(b.kids, el('p'))); }
    else if (b.t === 'heading') parent.append(inline(b.kids, el('h' + b.level)));
    else if (b.t === 'hr') parent.append(el('hr'));
    else if (b.t === 'code') { const pre = el('pre', 'md-code'), code = el('code', b.lang && SAFE_LANG.test(b.lang) ? 'lang-' + b.lang : '', b.v); if (b.lang && SAFE_LANG.test(b.lang)) pre.setAttribute('data-lang', b.lang); pre.append(code); parent.append(pre); }
    else if (b.t === 'quote') { const q = el('blockquote'); for (const k of b.kids) block(k, q); parent.append(q); }
    else if (b.t === 'list') {
      const l = el(b.ordered ? 'ol' : 'ul');
      if (b.ordered && b.start !== 1) l.setAttribute('start', String(b.start));
      for (const it of b.items) {
        const li = el('li');
        it.kids.forEach((k, n) => { if (n && !b.loose && k.t === 'p') li.append(doc.createTextNode(' ')); block(k, li, !b.loose); });
        l.append(li);
      }
      parent.append(l);
    } else if (b.t === 'table') {
      const wrap = el('div', 'md-table'), t = el('table'), thead = el('thead'), tr = el('tr');
      b.head.forEach((c, n) => { const th = inline(c, el('th')); if (b.align[n]) th.style.textAlign = b.align[n]; tr.append(th); });
      thead.append(tr); t.append(thead);
      const tb = el('tbody');
      for (const r of b.rows) { const row = el('tr'); b.head.forEach((_, n) => { const td = inline(r[n] || [], el('td')); if (b.align[n]) td.style.textAlign = b.align[n]; row.append(td); }); tb.append(row); }
      t.append(tb); wrap.append(t); parent.append(wrap);
    }
  };
  const root = el('div', 'md');
  if (frontMatter && fm && Object.keys(fm).length) {
    const dl = el('dl', 'md-fm');
    for (const [k, v] of Object.entries(fm)) {
      const d = el('div'); d.append(el('dt', '', k), el('dd', '', fmText(v)));
      if (k === 'description') d.className = 'wide';
      dl.append(d);
    }
    root.append(dl);
  }
  for (const b of blocks) block(b, root);
  return root;
}
export const fmText = v => Array.isArray(v) ? v.join(', ') : v && typeof v === 'object' ? Object.entries(v).map(([k, x]) => `${k}: ${Array.isArray(x) ? x.join(', ') : x}`).join(' · ') : String(v ?? '');
