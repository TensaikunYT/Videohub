import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('./app.js', import.meta.url), 'utf8');
const loader = source.slice(source.indexOf('// load a card\'s picture'), source.indexOf('function tile('));

function harness() {
  let intersect;
  const images = [], unobserved = [];
  const context = {
    IntersectionObserver: class { constructor(fn) { intersect = fn; } unobserve(el) { unobserved.push(el); } },
    Image: class { constructor() { images.push(this); } },
    h: (tag, attrs, text) => ({ tag, ...attrs, text }), encodeURIComponent,
    // Catalog cards must never load a film, start a job or create background timers.
    document: { createElement() { throw new Error('A cover must not create a player'); } },
    fetch() { throw new Error('Use the cached image URL only'); },
    setTimeout() { throw new Error('No cover refresh queue'); },
  };
  vm.createContext(context); vm.runInContext(loader, context);
  const card = (live = true) => {
    const children = [];
    return { dataset: { thumb: 'film-id', version: 'revision-1', ...(live ? { live: '1' } : {}) },
      isConnected: true, style: {}, children,
      append(el) { children.push(el); }, querySelector() { return null; } };
  };
  return { images, card, unobserved, intersect: entries => intersect(entries) };
}

test('many visible live cards load cached images without opening hidden films or refresh loops', () => {
  const h = harness(), cards = Array.from({ length: 30 }, () => h.card());
  h.intersect(cards.map(target => ({ target, isIntersecting: true })));
  assert.equal(h.images.length, 30);
  for (const [index, image] of h.images.entries()) {
    assert.equal(image.src, '/api/thumb/film-id?source=live&v=revision-1'); image.onload();
    assert.ok(cards[index].style.backgroundImage); assert.equal(cards[index].children.length, 0);
  }
});

test('missing covers offer the live preview and detached cards receive no image work', () => {
  const h = harness(), card = h.card();
  h.intersect([{ target: card, isIntersecting: true }]); h.images[0].onerror();
  assert.equal(card.children[0].text, 'Open live preview');
  const detached = h.card(); detached.isConnected = false;
  h.intersect([{ target: detached, isIntersecting: true }]); assert.equal(h.images.length, 1);
  card.isConnected = false; h.images[0].onload(); assert.equal(card.style.backgroundImage, undefined);
});
