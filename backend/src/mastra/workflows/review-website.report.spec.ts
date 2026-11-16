import {
  discoveredSiteSchema,
  findingSchema,
  reviewedSiteSchema,
  type ReviewedSite,
} from './review-website.schemas';
import {
  problemGroups,
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

/** A measured finding on the mobile screen of `/claims/:id`; override what differs. */
function finding(extra: Record<string, unknown>) {
  return {
    screen: 'mobile',
    selector: null,
    rect: null,
    helpUrl: null,
    group: '/claims/:id',
    crop: null,
    context: null,
    source: 'measured',
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
      finding({
        id: 'covered-element:mobile:/claims/:id:button#submit',
        rule: 'covered-element',
        severity: 'critical',
        title: 'Submit button covered by the cookie banner',
        selector: 'button#submit',
        measured: 'Element is 100% under div.cookie-bar',
        expected: 'Every control can be reached',
        rect: { x: 100, y: 500, width: 200, height: 48 },
        pages: [`${BASE}/claims/1`, `${BASE}/claims/2`, `${BASE}/claims/3`],
        crop: 'crops/submit.jpg',
        context: {
          image: 'context/submit.jpg',
          clip: { x: 0, y: 300, width: 390, height: 600 },
        },
      }),
      finding({
        id: 'axe:color-contrast:mobile:/claims/:id:p.lead',
        rule: 'axe:color-contrast',
        severity: 'major',
        title: 'Elements must meet minimum color contrast ratios',
        selector: 'p.lead',
        measured: 'Contrast ratio 2.1:1',
        expected: 'At least 4.5:1',
        helpUrl: 'https://dequeuniversity.com/rules/axe/color-contrast',
        pages: [`${BASE}/claims/1`, `${BASE}/claims/2`],
        crop: 'crops/contrast.jpg',
      }),
      finding({
        id: 'axe:color-contrast:laptop:/claims/:id:.nav a',
        rule: 'axe:color-contrast',
        severity: 'major',
        title: 'Elements must meet minimum color contrast ratios',
        screen: 'laptop',
        selector: '.nav a',
        measured: 'Contrast ratio 3.0:1',
        expected: 'At least 4.5:1',
        rect: { x: 40, y: 20, width: 80, height: 20 },
        pages: [`${BASE}/claims/1`],
        context: {
          image: 'context/nav.jpg',
          clip: { x: 0, y: 0, width: 1440, height: 400 },
        },
      }),
      finding({
        id: 'axe:color-contrast:laptop:/claims/new:label.hint',
        rule: 'axe:color-contrast',
        severity: 'major',
        title: 'Elements must meet minimum color contrast ratios',
        screen: 'laptop',
        group: '/claims/new',
        selector: 'label.hint',
        measured: 'Contrast ratio 2.8:1',
        expected: 'At least 4.5:1',
        pages: [`${BASE}/claims/new`],
        crop: 'crops/missing.jpg',
      }),
      finding({
        id: 'visual:hierarchy:mobile:/claims/:id:3',
        rule: 'visual:hierarchy',
        severity: 'major',
        title: 'Two competing headlines',
        selector: 'h1.hero',
        measured: 'The banner and the page title have the same weight',
        expected: 'Make the page title larger than the banner',
        pages: [`${BASE}/claims/1`],
        source: 'iris',
      }),
      finding({
        id: 'overflow-x:mobile:/claims/:id:',
        rule: 'overflow-x',
        severity: 'major',
        title: 'Page scrolls sideways',
        measured: 'Content is 512 px wide in a 390 px screen',
        expected: 'No sideways scrolling (WCAG 1.4.10)',
        helpUrl: 'https://www.w3.org/WAI/WCAG22/Understanding/reflow.html',
        pages: [`${BASE}/claims/1`, `${BASE}/claims/2`],
        crop: 'crops/overflow.jpg',
      }),
      finding({
        id: 'tap-target:laptop:/claims/new:a.x',
        rule: 'tap-target',
        severity: 'major',
        title: 'Tap target too small',
        screen: 'laptop',
        group: '/claims/new',
        selector: 'a.x',
        measured: '20 x 20 px',
        expected: 'At least 24 x 24 px',
        pages: [`${BASE}/claims/new`],
      }),
      finding({
        id: 'placeholder-text:laptop:/:',
        rule: 'placeholder-text',
        severity: 'minor',
        title: 'Placeholder text left on the page',
        screen: 'laptop',
        group: '/',
        measured: 'Found "Lorem ipsum"',
        expected: 'No placeholder text',
        pages: [`${BASE}/`],
      }),
    ],
  });
}

const IMAGES = {
  'crops/submit.jpg': 'data:image/jpeg;base64,AAAA',
  'crops/overflow.jpg': 'data:image/jpeg;base64,BBBB',
  'thumbs/home-mobile.jpg': 'data:image/jpeg;base64,CCCC',
  'context/submit.jpg': 'data:image/jpeg;base64,DDDD',
  'context/nav.jpg': 'data:image/jpeg;base64,EEEE',
  'crops/unused.jpg': 'data:image/jpeg;base64,UNUSED',
  'context/unused.jpg': 'data:image/jpeg;base64,UNUSEDCTX',
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

describe('problemGroups', () => {
  const groups = problemGroups(fixture().findings);

  it('counts one element per selector, whatever its template or screen (a site-wide header link is one element)', () => {
    const shared = (group: string, screen: string, page: string) =>
      findingSchema.parse({
        ...finding({ group, screen, selector: 'header a.logo' }),
        id: `f-${group}-${screen}`,
        rule: 'axe:link-name',
        severity: 'major',
        title: 'Links must have discernible text',
        measured: 'No text',
        expected: 'Links have text',
        pages: [page],
      });
    const [group] = problemGroups([
      shared('/', 'mobile', `${BASE}/`),
      shared('/', 'laptop', `${BASE}/`),
      shared('/about', 'mobile', `${BASE}/about`),
    ]);
    expect(group.elementCount).toBe(1);
    expect(group.pageCount).toBe(2);
    expect(group.templateCount).toBe(2);
  });

  it('groups a measured rule across elements, templates and screens', () => {
    const contrast = groups.find(
      (g) => g.key === 'measured|axe:color-contrast',
    );
    expect(contrast).toMatchObject({
      title: 'Elements must meet minimum color contrast ratios',
      severity: 'major',
      source: 'measured',
      elementCount: 3,
      pageCount: 3,
      templateCount: 2,
    });
    expect(contrast?.findings).toHaveLength(3);
  });

  it('keeps each Iris finding as its own problem', () => {
    const iris = groups.filter((g) => g.source === 'iris');
    expect(iris).toHaveLength(1);
    expect(iris[0].key).toBe('iris|visual:hierarchy|Two competing headlines');
    expect(iris[0]).toMatchObject({ elementCount: 1, pageCount: 1 });
  });

  it('sorts by severity, then element count, then title', () => {
    expect(groups.map((g) => g.title)).toEqual([
      'Submit button covered by the cookie banner',
      'Elements must meet minimum color contrast ratios',
      'Page scrolls sideways',
      'Tap target too small',
      'Two competing headlines',
      'Placeholder text left on the page',
    ]);
  });

  it('takes the worst severity of the findings and the first title', () => {
    const [a, b] = fixture().findings;
    const merged = problemGroups([
      { ...a, rule: 'r', title: 'First', severity: 'minor' },
      { ...b, rule: 'r', title: 'Second', severity: 'critical' },
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({ title: 'First', severity: 'critical' });
  });

  it('is empty for no findings', () => {
    expect(problemGroups([])).toEqual([]);
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
      'Reviewed 5 pages on Mobile and Laptop: 6 problems: 1 critical, 4 major and 1 minor.',
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

  it('is issue-first: tabs, a problem list and an occurrence viewer', () => {
    const js = bundle.javascript;
    expect(js).toContain("role: 'tablist'");
    expect(js).toContain("role: 'tab'");
    expect(js).toContain("'Problems'");
    expect(js).toContain("'Pages & coverage'");
    expect(js).toContain("'sr-plist'");
    expect(js).toContain("(state.occ + 1) + ' of ' + n");
    // The report takes the whole frame (the visual document's column gives way).
    expect(js).toContain('function useWholeFrame()');
    expect(js).toContain("text: 'Previous'");
    expect(js).toContain("text: 'Next'");
    expect(js).toContain('No problems match these filters');
    expect(js).toContain('Clear filters');
    expect(js).toContain("'All page templates'");
    expect(js).toContain("type: 'search'");
    expect(js).toContain("'aria-pressed'");
    expect(js).toContain('function problemGroups(');
    expect(js).toContain('ArrowLeft');
    expect(js).not.toContain('URL groups');
    expect(bundle.css).toContain('.sr-mark');
    expect(bundle.css).toContain('@container');
  });

  it('names the templates, the sources and Iris in the data and the runtime', () => {
    expect(bundle.javascript).toContain("text: 'Page templates'");
    expect(bundle.javascript).toContain("'Measured'");
    expect(bundle.javascript).toContain("'Iris'");
    expect(bundle.javascript).toContain("'Observed'");
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
    expect(bundle.javascript).toContain('DDDD');
    expect(bundle.javascript).toContain('EEEE');
    expect(bundle.javascript).not.toContain('UNUSED');
  });

  it('embeds only data:image URIs', () => {
    const hostile = renderReportBundle({
      site,
      images: {
        'context/submit.jpg': 'https://evil.example/x.jpg',
        'crops/submit.jpg': 'javascript:alert(1)',
      },
      generatedAt: 'now',
    });
    expect(hostile.javascript).not.toContain('evil.example');
    expect(hostile.javascript).not.toContain('javascript:alert');
  });

  it('frames the element from its rect inside the context clip', () => {
    expect(bundle.javascript).toContain('(r.x - c.x) / c.width');
    expect(bundle.javascript).toContain(
      '"clip":{"x":0,"y":300,"width":390,"height":600}',
    );
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
        '**example.com**: 5 pages, 3 page templates on Mobile and Laptop — 6 problems: 1 critical, 4 major and 1 minor.',
        '',
        'Iris reviewed 1 template and found 1 visual issue.',
        '',
        'Fix first:',
        '- **Submit button covered by the cookie banner** — 1 element on 3 pages (critical, Measured)',
        '- **Elements must meet minimum color contrast ratios** — 3 elements on 3 pages (major, Measured)',
        '- **Page scrolls sideways** — on 2 pages (major, Measured)',
        '',
        'Coverage: 5 of 5 pages; stopped at the limit; 1 link skipped; 1 page failed.',
        '',
        'Open the report in full screen to see each element framed in its page.',
      ].join('\n'),
    );
  });

  it('names an Iris problem and carries no measured text or selectors', () => {
    const onlyIris = reviewedSiteSchema.parse({
      ...fixture(),
      findings: fixture().findings.filter((f) => f.source === 'iris'),
    });
    const answer = reviewAnswer(onlyIris);
    expect(answer).toContain(
      '- **Two competing headlines** — 1 element on 1 page (major, Iris)',
    );
    expect(answer).not.toContain('h1.hero');
    expect(answer).not.toContain('same weight');
  });

  it('pluralises one page and one template', () => {
    const single = reviewedSiteSchema.parse({
      ...fixture(),
      maxPages: 1,
      pages: [page('/', '/')],
      captures: [],
      findings: [],
      skippedLinks: [],
      capped: false,
      screens: ['mobile'],
      visualReview: false,
      reviewTemplates: [],
      reviewed: [],
      templates: [{ id: '/', pages: [`${BASE}/`], representative: `${BASE}/` }],
    });
    expect(reviewAnswer(single)).toBe(
      [
        '**example.com**: 1 page, 1 page template on Mobile — no problems found.',
        '',
        'Coverage: 1 of 1 page.',
        '',
        'Open the report in full screen to see each element framed in its page.',
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
        '**example.com**: 2 pages, 2 page templates on Mobile, Tablet and Laptop — no problems found.',
        '',
        'Coverage: 2 of 5 pages.',
        '',
        'Open the report in full screen to see each element framed in its page.',
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
