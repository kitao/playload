import test from 'node:test';
import assert from 'node:assert/strict';
import { arcadePages, arcadeNavigation, ARCADE_PAGE_SIZE } from '../scripts/arcade-pages.js';

test('one Arcade page keeps its existing URL and needs no navigation', () => {
  for (const count of [0, ARCADE_PAGE_SIZE - 1, ARCADE_PAGE_SIZE]) {
    const cards = Array.from({ length: count }, (_, i) => `game-${i}`);
    const pages = arcadePages(cards);
    assert.equal(pages.length, 1);
    assert.equal(pages[0].path, 'arcade/');
    assert.deepEqual(pages[0].cards, cards);
    assert.equal(arcadeNavigation(pages, 0), '');
  }
});

test('Arcade pagination keeps every game in order across page boundaries', () => {
  const cards = Array.from({ length: ARCADE_PAGE_SIZE * 2 + 1 }, (_, i) => `game-${i}`);
  const pages = arcadePages(cards);
  assert.deepEqual(
    pages.map(({ cards }) => cards.length),
    [ARCADE_PAGE_SIZE, ARCADE_PAGE_SIZE, 1],
  );
  assert.deepEqual(
    pages.map(({ path }) => path),
    ['arcade/', 'arcade/page/2/', 'arcade/page/3/'],
  );
  assert.deepEqual(
    pages.flatMap(({ cards }) => cards),
    cards,
  );
  const first = arcadeNavigation(pages, 0),
    middle = arcadeNavigation(pages, 1),
    last = arcadeNavigation(pages, 2);
  assert.match(first, /aria-disabled="true">Previous/);
  assert.doesNotMatch(first, /rel="prev"/);
  assert.match(first, /href="\/playload\/arcade\/page\/2\/" rel="next"/);
  assert.match(middle, /href="\/playload\/arcade\/" rel="prev"/);
  assert.match(middle, /aria-current="page" aria-label="Page 2">2/);
  assert.match(last, /aria-disabled="true">Next/);
  assert.doesNotMatch(last, /rel="next"/);
});
