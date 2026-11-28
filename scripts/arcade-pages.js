export const ARCADE_PAGE_SIZE = 30;

export function arcadePages(cards) {
  const count = Math.max(1, Math.ceil(cards.length / ARCADE_PAGE_SIZE));
  return Array.from({ length: count }, (_, index) => ({
    number: index + 1,
    path: index === 0 ? 'arcade/' : `arcade/page/${index + 1}/`,
    cards: cards.slice(index * ARCADE_PAGE_SIZE, (index + 1) * ARCADE_PAGE_SIZE),
  }));
}

export function arcadeNavigation(pages, current) {
  if (pages.length < 2) return '';
  const link = (page, label, attributes = '') =>
    `<a href="/playload/${page.path}" ${attributes}>${label}</a>`;
  const previous =
    current > 0
      ? link(pages[current - 1], 'Previous', 'rel="prev" aria-label="Previous page"')
      : '<span aria-disabled="true">Previous</span>';
  const next =
    current < pages.length - 1
      ? link(pages[current + 1], 'Next', 'rel="next" aria-label="Next page"')
      : '<span aria-disabled="true">Next</span>';
  const numbers = pages
    .map((page, index) =>
      index === current
        ? `<span aria-current="page" aria-label="Page ${page.number}">${page.number}</span>`
        : link(page, page.number, `aria-label="Page ${page.number}"`),
    )
    .join('');
  return `${previous}<div class="arcade-page-numbers">${numbers}</div>${next}`;
}
