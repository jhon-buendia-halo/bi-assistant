import {
  discoveredSiteSchema,
  reviewedSiteSchema,
  type ReviewedSite,
} from './review-website.schemas';
import {
  renderReportBundle,
  reviewAnswer,
  sessionLostAnswer,
  severityLine,
} from './review-website.report';

const HOSTILE = '</script><img src=x onerror=alert(1)>';
const BASE = 'https://example.com';

function page(
  path: string,
  group: string,
  extra: Record<string, unknown> = {},
) {
  return {
    url: `${BASE}${path}`,
    finalUrl: `${BASE}${path}`,
    status: 200,
    title: path,
    depth: path === '/' ? 0 : 1,
    parent: path === '/' ? null : `${BASE}/`,
    group,
    fingerprint: 'abc123',
    error: null,
    ...extra,
  };
}

function fixture(): ReviewedSite {
  return reviewedSiteSchema.parse({
    url: `${BASE}/`,
    maxPages: 5,
    maxDepth: 2,
    screens: ['mobile', 'laptop'],
    exclude: 'logout',
    needsSignIn: false,
    loginUrl: `${BASE}/`,
    origin: BASE,
    signedIn: false,
    visualReview: true,
    templates: [
      {
        id: '/',
        pages: [`${BASE}/`],
        representative: `${BASE}/`,
      },
      {
        id: '/claims/:id',
        pages: [`${BASE}/claims/1`, `${BASE}/claims/2`, `${BASE}/claims/3`],
        representative: `${BASE}/claims/1`,
      },
      {
        id: '/claims/new',
        pages: [`${BASE}/claims/new`],
        representative: `${BASE}/claims/new`,
      },
    ],
    reviewTemplates: ['/claims/:id'],
    askBeforeReview: false,
    reviewShots: [],
    reviewed: [
      {
        template: '/claims/:id',
        summary:
          'The claim page is busy and the headline competes with a banner.',
        findingCount: 1,
      },
    ],
    pages: [
      page('/', '/', { title: HOSTILE }),
      page('/claims/1', '/claims/:id'),
      page('/claims/2', '/claims/:id'),
      page('/claims/3', '/claims/:id'),
      page('/claims/new', '/claims/new', { status: 500 }),
    ],
    skippedLinks: [`${BASE}/logout`],
    capped: true,
    sessionLost: null,
    captures: [
      {
        url: `${BASE}/`,
        screen: 'mobile',
        group: '/',
        screenshot: 'shots/home-mobile.png',
        thumbnail: 'thumbs/home-mobile.jpg',
        status: 200,
        error: null,
      },
      {
        url: `${BASE}/claims/new`,
        screen: 'laptop',
        group: '/claims/new',
        screenshot: null,
        thumbnail: null,
        status: 500,
        error: 'Navigation timeout',
      },
    ],
    findings: [
      {
        id: 'covered-element:mobile:/claims/:id:button#submit',
        rule: 'covered-element',
        severity: 'critical',
        title: 'Submit button covered by the cookie banner',
        screen: 'mobile',
        selector: 'button#submit',
        measured: 'Element is 100% under div.cookie-bar',
        expected: 'Every control can be reached',
        rect: null,
        helpUrl: null,
        group: '/claims/:id',
        pages: [`${BASE}/claims/1`, `${BASE}/claims/2`, `${BASE}/claims/3`],
        crop: 'crops/submit.jpg',
        source: 'measured',
      },
      {
        id: 'visual:hierarchy:mobile:/claims/:id:3',
        rule: 'visual:hierarchy',
        severity: 'major',
        title: 'Two competing headlines',
        screen: 'mobile',
        selector: 'h1.hero',
        measured: 'The banner and the page title have the same weight',
        expected: 'Make the page title larger than the banner',
        rect: null,
        helpUrl: null,
        group: '/claims/:id',
        pages: [`${BASE}/claims/1`],
        crop: null,
        source: 'iris',
      },
      {
        id: 'overflow-x:mobile:/claims/:id:',
        rule: 'overflow-x',
        severity: 'major',
        title: 'Page scrolls sideways',
        screen: 'mobile',
        selector: null,
        measured: 'Content is 512 px wide in a 390 px screen',
        expected: 'No sideways scrolling (WCAG 1.4.10)',
        rect: null,
        helpUrl: 'https://www.w3.org/WAI/WCAG22/Understanding/reflow.html',
        group: '/claims/:id',
        pages: [`${BASE}/claims/1`, `${BASE}/claims/2`],
        crop: 'crops/overflow.jpg',
        source: 'measured',
      },
      {
        id: 'tap-target:laptop:/claims/new:a.x',
        rule: 'tap-target',
        severity: 'major',
        title: 'Tap target too small',
        screen: 'laptop',
        selector: 'a.x',
        measured: '20 x 20 px',
        expected: 'At least 24 x 24 px',
        rect: null,
        helpUrl: null,
        group: '/claims/new',
        pages: [`${BASE}/claims/new`],
        crop: 'crops/missing.jpg',
        source: 'measured',
      },
      {
        id: 'placeholder-text:laptop:/:',
        rule: 'placeholder-text',
        severity: 'minor',
        title: 'Placeholder text left on the page',
        screen: 'laptop',
        selector: null,
        measured: 'Found "Lorem ipsum"',
        expected: 'No placeholder text',
        rect: null,
        helpUrl: null,
        group: '/',
        pages: [`${BASE}/`],
        crop: null,
        source: 'measured',
      },
    ],
  });
}

const IMAGES = {
  'crops/submit.jpg': 'data:image/jpeg;base64,AAAA',
  'crops/overflow.jpg': 'data:image/jpeg;base64,BBBB',
  'thumbs/home-mobile.jpg': 'data:image/jpeg;base64,CCCC',
  'crops/unused.jpg': 'data:image/jpeg;base64,UNUSED',
};

describe('severityLine', () => {
  it('lists the kinds that have findings', () => {
    expect(severityLine({ critical: 1, major: 8, minor: 14 })).toBe(
      '1 critical, 8 major and 14 minor',
    );
    expect(severityLine({ critical: 0, major: 2, minor: 1 })).toBe(
      '2 major and 1 minor',
    );
    expect(severityLine({ critical: 0, major: 0, minor: 3 })).toBe('3 minor');
    expect(severityLine({ critical: 0, major: 0, minor: 0 })).toBe(
      'no measured issues',
    );
  });
});

describe('renderReportBundle', () => {
  const site = fixture();
  const bundle = renderReportBundle({
    site,
    images: IMAGES,
    generatedAt: '2026-11-16 10:00',
  });

  it('titles the report and describes it in one sentence', () => {
    expect(bundle.title).toBe('Site review: example.com');
    expect(bundle.description).toBe(
      'Reviewed 5 pages on Mobile and Laptop: 1 critical, 3 major and 1 minor.',
    );
  });

  it('embeds the site data as JSON', () => {
    expect(bundle.javascript).toContain('window.siteReview.mount(');
    expect(bundle.javascript).toContain(
      'Submit button covered by the cookie banner',
    );
    expect(bundle.javascript).toContain('"/claims/:id"');
    expect(bundle.html).toContain('site-review-root');
    expect(bundle.css).toContain('--qti-focus');
  });

  it('names the templates, the sources and Iris in the data and the runtime', () => {
    expect(bundle.javascript).toContain("text: 'Page templates'");
    expect(bundle.javascript).not.toContain('URL groups');
    expect(bundle.javascript).toContain("'Measured'");
    expect(bundle.javascript).toContain("'Iris'");
    expect(bundle.javascript).toContain("'Observed: '");
    expect(bundle.javascript).toContain("'Suggestion: '");
    expect(bundle.javascript).toContain('"source":"iris"');
    expect(bundle.javascript).toContain('"source":"measured"');
    expect(bundle.javascript).toContain(
      'The claim page is busy and the headline competes with a banner.',
    );
    expect(bundle.css).toContain('.sr-src-iris');
    expect(bundle.css).toContain('.sr-quote');
  });

  it('shows the Iris summary as a text node, never as markup', () => {
    expect(bundle.javascript).toContain("h('p', { class: 'sr-quote' }");
    expect(bundle.javascript).toContain('text: review.summary');
    expect(bundle.javascript).not.toContain('innerHTML');
  });

  it('never lets a hostile page title reach the markup or break the script', () => {
    expect(bundle.javascript).toContain('\\u003c/script>');
    expect(bundle.javascript).not.toContain('</script');
    expect(bundle.javascript).not.toContain('<img');
    expect(bundle.html).not.toContain('<img');
    expect(bundle.html).not.toContain(HOSTILE);
    expect(bundle.css).not.toContain('<');
  });

  it('embeds only the images a finding or capture refers to', () => {
    expect(bundle.javascript).toContain('AAAA');
    expect(bundle.javascript).toContain('BBBB');
    expect(bundle.javascript).toContain('CCCC');
    expect(bundle.javascript).not.toContain('UNUSED');
  });

  it('survives a missing image', () => {
    expect(bundle.javascript).not.toContain('crops/missing.jpg"]');
    expect(bundle.javascript).toContain('crops/missing.jpg');
  });
});

describe('reviewAnswer', () => {
  it('summarises the findings and the coverage', () => {
    expect(reviewAnswer(fixture())).toBe(
      [
        '**example.com**: 5 pages on Mobile and Laptop — 1 critical, 3 major and 1 minor.',
        '',
        'Iris reviewed 1 page template and found 1 visual issue.',
        '',
        'Fix first:',
        '- **Submit button covered by the cookie banner** (critical, Mobile) on 3 pages of `/claims/:id`: Element is 100% under div.cookie-bar',
        '- **Two competing headlines** (major, Mobile) (Iris) on 1 page of `/claims/:id`: The banner and the page title have the same weight',
        '- **Page scrolls sideways** (major, Mobile) on 2 pages of `/claims/:id`: Content is 512 px wide in a 390 px screen',
        '',
        'Coverage: 5 pages reached out of a limit of 5; the crawl stopped at the page limit, so the site may have more. 3 page templates. 1 link was not followed because of the exclusion rule. 1 page failed to load. 1 capture failed.',
        '',
        'The full report is the visual above: every finding shows the element, what was measured and a crop of the screenshot.',
      ].join('\n'),
    );
  });

  it('says so when nothing was found and omits zero facts', () => {
    const clean = reviewedSiteSchema.parse({
      ...fixture(),
      pages: [page('/', '/'), page('/about', '/about')],
      captures: [],
      findings: [],
      skippedLinks: [],
      capped: false,
      screens: ['mobile', 'tablet', 'laptop'],
      visualReview: false,
      reviewTemplates: [],
      reviewed: [],
      templates: [
        { id: '/', pages: [`${BASE}/`], representative: `${BASE}/` },
        {
          id: '/about',
          pages: [`${BASE}/about`],
          representative: `${BASE}/about`,
        },
      ],
    });
    expect(reviewAnswer(clean)).toBe(
      [
        '**example.com**: 2 pages on Mobile, Tablet and Laptop — no measured issues.',
        '',
        'Coverage: 2 pages reached out of a limit of 5. 2 page templates.',
        '',
        'The full report is the visual above: every finding shows the element, what was measured and a crop of the screenshot.',
      ].join('\n'),
    );
  });

  it('says Iris was skipped when the user chose measured checks only', () => {
    const skipped = reviewedSiteSchema.parse({
      ...fixture(),
      reviewTemplates: [],
      reviewed: [],
      findings: [],
    });
    const answer = reviewAnswer(skipped);
    expect(answer).toContain(
      "Iris's visual review was skipped: measured checks only.",
    );
    expect(answer).not.toContain('Iris reviewed');
  });

  it('says nothing about Iris when the visual review is off', () => {
    const off = reviewedSiteSchema.parse({
      ...fixture(),
      visualReview: false,
      reviewTemplates: [],
      reviewed: [],
      findings: fixture().findings.filter((f) => f.source === 'measured'),
    });
    expect(reviewAnswer(off)).not.toContain('Iris');
  });
});

describe('sessionLostAnswer', () => {
  it('names the page that sent the crawler to the sign-in', () => {
    const discovered = discoveredSiteSchema.parse(fixture());
    expect(
      sessionLostAnswer({ ...discovered, sessionLost: `${BASE}/claims/1` }),
    ).toBe(
      'The sign-in for **example.com** expired: https://example.com/claims/1 sent the crawler back to the sign-in page, so nothing was reviewed. Run again with **The site needs a sign-in** ticked to sign in again.',
    );
  });
});
