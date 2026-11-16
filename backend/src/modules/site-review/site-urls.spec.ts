import { pageFileName, pageUrlOf, shortHash } from './site-urls';

describe('Review a Website crawl URLs (agents.md 5.19)', () => {
  const origin = 'https://shop.example.com';

  it.each([
    ['/items/12/', 'https://shop.example.com/items/12'],
    ['https://shop.example.com/', 'https://shop.example.com/'],
    ['/a?b=1#top', 'https://shop.example.com/a?b=1'],
    ['items', 'https://shop.example.com/items'],
  ])('writes %s once as %s', (href, expected) => {
    expect(pageUrlOf(href, origin)).toBe(expected);
  });

  it.each([
    'https://other.example.com/',
    'http://shop.example.com/',
    'mailto:a@b.c',
    'javascript:void(0)',
    '/files/report.PDF',
    '/img/logo.svg',
  ])('leaves out %s', (href) => {
    expect(pageUrlOf(href, origin)).toBeUndefined();
  });

  it('names a page file by its path and a hash', () => {
    expect(pageFileName('https://shop.example.com/')).toBe(
      `home-${shortHash('https://shop.example.com/')}`,
    );
    expect(pageFileName('https://shop.example.com/Items/12?x=1')).toMatch(
      /^items-12-x-1-[0-9a-f]{8}$/,
    );
  });
});
