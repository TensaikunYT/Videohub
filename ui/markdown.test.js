import test from 'node:test';
import assert from 'node:assert/strict';
import { parseFrontMatter, parseInline, parseMarkdown, renderMarkdown, fmText } from './markdown.js';

// a tiny DOM stand-in: enough to build and inspect nodes; innerHTML throws so the renderer can never use it
function fakeDoc() {
  const text = v => ({ tag: '#text', textContent: v, kids: [] });
  const node = tag => ({
    tag, kids: [], attrs: {}, className: '', style: {},
    append(...k) { for (const x of k) this.kids.push(typeof x === 'string' ? text(x) : x); },
    setAttribute(k, v) { this.attrs[k] = String(v); },
    set textContent(v) { this.kids = [text(String(v))]; }, get textContent() { return this.kids.map(k => k.textContent).join(''); },
    set innerHTML(v) { throw new Error('innerHTML used'); },
  });
  return { createElement: node, createTextNode: text };
}
const tags = (n, out = []) => { if (n.tag !== '#text') out.push(n.tag); for (const k of n.kids) tags(k, out); return out; };
const find = (n, tag) => n.tag === tag ? n : n.kids.map(k => find(k, tag)).find(Boolean) || null;
const findAll = (n, tag, out = []) => { if (n.tag === tag) out.push(n); for (const k of n.kids) findAll(k, tag, out); return out; };

test('front matter: scalars, quotes, block scalars, lists and maps; CRLF and BOM', () => {
  const src = '﻿---\r\nname: "scanline-shorts"\r\ndescription: >\r\n  Builds 3D shorts\r\n  with a scan plane.\r\nversion: 1.6\r\ntags: [3d, "shorts"]\r\nallowed:\r\n  - Read\r\n  - Bash\r\nmetadata:\r\n  author: someone\r\nquote: \'it\'\'s\'\r\n---\r\n# Title\r\n';
  const { data, body } = parseFrontMatter(src);
  assert.deepEqual(data, { name: 'scanline-shorts', description: 'Builds 3D shorts with a scan plane.', version: '1.6', tags: ['3d', 'shorts'], allowed: ['Read', 'Bash'], metadata: { author: 'someone' }, quote: "it's" });
  assert.equal(body, '# Title\n');
  assert.equal(parseFrontMatter('# no front matter').data, null);
  assert.equal(parseFrontMatter('---\nname: x\nno end').data, null, 'an unclosed block is not front matter');
  assert.equal(parseFrontMatter('---\ndescription: |\n  line one\n  line two\n---\n').data.description, 'line one\nline two');
  assert.equal(parseFrontMatter('---\ndescription: plain text\n  continued here\n---\n').data.description, 'plain text continued here');
  assert.equal(fmText(['a', 'b']), 'a, b'); assert.equal(fmText({ a: 1 }), 'a: 1');
});

test('inline: emphasis, code, links shown with their URL, escapes', () => {
  const k = parseInline('a **bold** and *it* and _it2_ and ~~gone~~ with `co*de*` here');
  assert.deepEqual(k.map(x => x.t), ['text', 'strong', 'text', 'em', 'text', 'em', 'text', 'del', 'text', 'code', 'text']);
  assert.equal(k[9].v, 'co*de*');
  assert.deepEqual(parseInline('snake_case_name stays').map(x => x.t), ['text'], 'no intraword underscore emphasis');
  assert.deepEqual(parseInline('2 * 3 * 4').map(x => x.t), ['text'], 'a lone star between spaces is text');
  const l = parseInline('see [the docs](https://example.com/a_(b) "t") now');
  assert.equal(l[1].t, 'link'); assert.equal(l[1].url, 'https://example.com/a_(b)'); assert.equal(l[1].kids[0].v, 'the docs');
  assert.equal(parseInline('<https://x.test/y>')[0].url, 'https://x.test/y');
  assert.equal(parseInline('\\*not em\\*')[0].v, '*not em*');
  assert.equal(parseInline('![a cat](cat.png)')[0].t, 'image');
  assert.deepEqual(parseInline('a  \nb').map(x => x.t), ['text', 'br', 'text']);
  assert.equal(parseInline('``a ` b``')[0].v, 'a ` b');
  assert.equal(parseInline('**bold with `code` inside**')[0].kids[1].t, 'code');
});

test('blocks: headings, paragraphs, nested lists, code, quotes, tables, rules', () => {
  const md = [
    '# Title', '', 'Para line one', 'line two', '', '## Steps', '1. first', '2. second', '   - nested a', '   - nested b', '     1. deeper', '3. third',
    '', '- loose a', '', '- loose b', '', '```js', 'const a = "<b>";', '  indented', '```', '', '> quoted **text**', '> more', '', '| Col | Right |', '|:---|---:|', '| a \\| b | `x|y` |', '| c | d |', '', '---', '', '    code by indent', '', 'end',
  ].join('\n');
  const { blocks } = parseMarkdown(md);
  assert.deepEqual(blocks.map(b => b.t), ['heading', 'p', 'heading', 'list', 'list', 'code', 'quote', 'table', 'hr', 'code', 'p']);
  const ol = blocks[3];
  assert.equal(ol.ordered, true); assert.equal(ol.items.length, 3); assert.equal(ol.loose, false);
  const nested = ol.items[1].kids.find(k => k.t === 'list');
  assert.equal(nested.items.length, 2); assert.equal(nested.items[1].kids[1].t, 'list', 'three levels deep');
  assert.equal(blocks[4].loose, true);
  assert.equal(blocks[5].lang, 'js'); assert.equal(blocks[5].v, 'const a = "<b>";\n  indented');
  assert.equal(blocks[7].align.join(','), 'left,right');
  assert.equal(blocks[7].rows[0][0][0].v, 'a | b'); assert.equal(blocks[7].rows[0][1][0].v, 'x|y', 'a pipe inside code stays in its cell');
  assert.equal(blocks[9].v, 'code by indent');
  assert.equal(parseMarkdown('```\nunclosed\nfence').blocks[0].v, 'unclosed\nfence');
  assert.deepEqual(parseMarkdown('para\n- list right after').blocks.map(b => b.t), ['p', 'list']);
  assert.deepEqual(parseMarkdown('- a\n\n  more of a\n- b').blocks[0].items[0].kids.map(b => b.t), ['p', 'p']);
  assert.equal(parseMarkdown('\t- tab indented').blocks[0].t, 'code', 'a tab is four spaces');
});

test('render: DOM nodes only, HTML in the file stays text, links do not navigate, front matter strip', () => {
  const doc = fakeDoc();
  const root = renderMarkdown('---\nname: demo\ndescription: A test\n---\n# Hi <script>alert(1)</script>\n\nClick [here](javascript:alert(1)) or <img src=x onerror=alert(1)>.\n\n- a\n- b\n\n```html\n<b>x</b>\n```\n| h |\n|---|\n| c |\n', { doc });
  const all = tags(root);
  assert.ok(!all.includes('script') && !all.includes('img') && !all.includes('a'), 'no script, img or anchor elements: ' + all.join(','));
  assert.equal(find(root, 'h1').textContent, 'Hi <script>alert(1)</script>');
  const link = findAll(root, 'span').find(s => s.className === 'md-link');
  assert.equal(link.attrs.href, undefined); assert.equal(link.textContent, 'herejavascript:alert(1)');
  const dl = find(root, 'dl'); assert.equal(dl.className, 'md-fm'); assert.equal(findAll(dl, 'dt').map(d => d.textContent).join(','), 'name,description');
  assert.equal(find(root, 'pre').attrs['data-lang'], 'html'); assert.equal(find(root, 'code').textContent, '<b>x</b>');
  assert.equal(findAll(find(root, 'ul'), 'li').length, 2); assert.equal(find(find(root, 'ul'), 'p'), null, 'a tight list has no paragraphs');
  assert.ok(find(root, 'table') && find(root, 'th').textContent === 'h');
  assert.equal(find(renderMarkdown('---\nname: x\n---\ntext', { doc, frontMatter: false }), 'dl'), null);
  assert.equal(renderMarkdown('```evil"><x\ncode\n```', { doc }).kids[0].attrs['data-lang'], undefined, 'odd fence info strings are not used as attributes');
  assert.equal(renderMarkdown('1. a\n2. b', { doc }).kids[0].attrs.start, undefined);
  assert.equal(renderMarkdown('3. a\n4. b', { doc }).kids[0].attrs.start, '3');
});
