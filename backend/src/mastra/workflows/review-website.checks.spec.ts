import {
  axeFindings,
  exclusionMatcher,
  loadFindings,
  mergeFindings,
  screenSpec,
  severityCounts,
  snapshotFindings,
  urlGroup,
} from './review-website.checks';
import {
  domSnapshotSchema,
  type DomSnapshot,
  type RawFinding,
  type SnapElement,
} from './review-website.schemas';

const rect = (x = 0, y = 0, width = 100, height = 40) => ({
  x,
  y,
  width,
  height,
});

function element(over: Partial<SnapElement> = {}): SnapElement {
  return {
    selector: '#el',
    tag: 'button',
    text: 'Send',
    rect: rect(),
    interactive: true,
    submit: false,
    clipsText: false,
    coveredFraction: 0,
    coveredBy: null,
    brokenImage: null,
    ...over,
  };
}

function snapshot(over: Partial<DomSnapshot> = {}): DomSnapshot {
  return domSnapshotSchema.parse({
    url: 'https://site.test/page',
    screen: 'mobile',
    viewport: { width: 390, height: 844 },
    scrollWidth: 390,
    scrollHeight: 1200,
    widest: null,
    elements: [],
    visibleText: 'Hello world',
    ...over,
  });
}

describe('screenSpec', () => {
  it('returns the catalogue entry', () => {
    expect(screenSpec('laptop')).toMatchObject({
      width: 1440,
      isMobile: false,
    });
  });
});

describe('snapshotFindings', () => {
  it('reports nothing for a clean page', () => {
    expect(snapshotFindings(snapshot({ elements: [element()] }))).toEqual([]);
  });

  it('reports sideways scroll: major on mobile, minor elsewhere', () => {
    const widest = {
      selector: 'table.wide',
      right: 512,
      rect: rect(0, 0, 512),
    };
    const mobile = snapshotFindings(snapshot({ scrollWidth: 512, widest }));
    expect(mobile).toHaveLength(1);
    expect(mobile[0]).toMatchObject({
      rule: 'overflow-x',
      severity: 'major',
      title: 'Page scrolls sideways',
      selector: 'table.wide',
      measured:
        'Content is 512 px wide in a 390 px screen; widest element table.wide',
      expected: 'No sideways scrolling at 390 px (WCAG 1.4.10 Reflow)',
      helpUrl: 'https://www.w3.org/WAI/WCAG22/Understanding/reflow.html',
    });
    const laptop = snapshotFindings(
      snapshot({
        screen: 'laptop',
        viewport: { width: 1440, height: 900 },
        scrollWidth: 1600,
      }),
    );
    expect(laptop[0]).toMatchObject({
      severity: 'minor',
      selector: null,
      rect: null,
      measured: 'Content is 1600 px wide in a 1440 px screen',
    });
  });

  it('allows one pixel of tolerance on the width', () => {
    expect(snapshotFindings(snapshot({ scrollWidth: 391 }))).toEqual([]);
  });

  it('reports clipped text', () => {
    const [finding] = snapshotFindings(
      snapshot({
        elements: [
          element({
            tag: 'span',
            interactive: false,
            clipsText: true,
            text: 'x'.repeat(100),
          }),
        ],
      }),
    );
    expect(finding).toMatchObject({
      rule: 'clipped-text',
      severity: 'minor',
      title: 'Text is cut off',
      expected: 'Text fits its box or wraps',
    });
    expect(finding.measured).toContain('x'.repeat(60));
    expect(finding.measured).not.toContain('x'.repeat(61));
  });

  it('reports covered controls: critical for submit, by control kind', () => {
    const covered = { coveredFraction: 0.6, coveredBy: '#cookie-bar' };
    const findings = snapshotFindings(
      snapshot({
        elements: [
          element({ ...covered, submit: true, selector: '#send' }),
          element({ ...covered, tag: 'a', selector: '#lnk' }),
          element({ ...covered, tag: 'input', selector: '#fld' }),
          element({ ...covered, tag: 'button', selector: '#btn' }),
          element({ coveredFraction: 0.4, coveredBy: '#cookie-bar' }),
        ],
        screen: 'laptop',
        viewport: { width: 1440, height: 900 },
        scrollWidth: 1440,
      }),
    );
    expect(findings.map((f) => [f.selector, f.severity, f.title])).toEqual([
      ['#send', 'critical', 'Button covered by a fixed element'],
      ['#lnk', 'major', 'Link covered by a fixed element'],
      ['#fld', 'major', 'Field covered by a fixed element'],
      ['#btn', 'major', 'Button covered by a fixed element'],
    ]);
    expect(findings[0].measured).toBe('60% of #send is under #cookie-bar');
    expect(findings[0].expected).toBe(
      'Controls are not hidden by banners or sticky bars at load',
    );
  });

  it('reports small tap targets on mobile screens only, sparing inline links', () => {
    const small = element({ rect: rect(0, 0, 16.4, 16.2), selector: '#tiny' });
    const inlineLink = element({
      tag: 'a',
      text: 'Terms',
      rect: rect(0, 0, 40, 14),
      selector: '#inline',
    });
    const iconLink = element({
      tag: 'a',
      text: '',
      rect: rect(0, 0, 16, 16),
      selector: '#icon',
    });
    const findings = snapshotFindings(
      snapshot({ elements: [small, inlineLink, iconLink] }),
    );
    expect(findings.map((f) => f.selector)).toEqual(['#tiny', '#icon']);
    expect(findings[0]).toMatchObject({
      rule: 'tap-target',
      severity: 'minor',
      measured: '16×16 px',
      expected: 'At least 24×24 px (WCAG 2.5.8 Target Size)',
      helpUrl:
        'https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html',
    });
    const desktop = snapshotFindings(
      snapshot({
        screen: 'desktop',
        viewport: { width: 1920, height: 1080 },
        scrollWidth: 1920,
        elements: [small],
      }),
    );
    expect(desktop).toEqual([]);
  });

  it('reports broken images', () => {
    const [finding] = snapshotFindings(
      snapshot({
        elements: [
          element({
            tag: 'img',
            interactive: false,
            brokenImage: 'https://site.test/a.png',
          }),
        ],
      }),
    );
    expect(finding).toMatchObject({
      rule: 'broken-image',
      severity: 'major',
      title: 'Image does not load',
      measured: 'https://site.test/a.png',
      expected: 'Every image loads',
    });
  });

  it('reports each distinct kind of placeholder text once', () => {
    const findings = snapshotFindings(
      snapshot({
        visibleText:
          'Welcome Lorem Ipsum dolor\nHi {{ user }}\nTotal NaN and undefined\nnull\nHi Forename\nTODO fix\nLorem ipsum again',
      }),
    );
    const rules = new Set(findings.map((f) => f.rule));
    expect(rules).toEqual(new Set(['placeholder-text']));
    expect(findings).toHaveLength(7);
    expect(findings.every((f) => f.severity === 'major')).toBe(true);
    expect(findings.every((f) => f.selector === null && f.rect === null)).toBe(
      true,
    );
    expect(findings[0].measured).toBe(
      'Visible text contains "Welcome Lorem Ipsum dolor Hi {{ us"',
    );
    expect(findings[0].expected).toBe(
      'No placeholder or template text is shown',
    );
  });

  it('does not flag lookalikes', () => {
    const findings = snapshotFindings(
      snapshot({
        visibleText:
          'The null hypothesis. Nano. todo list. Undefined behaviour',
      }),
    );
    expect(findings).toEqual([]);
  });
});

describe('axeFindings', () => {
  const violation = {
    id: 'color-contrast',
    impact: 'serious' as const,
    help: 'Elements must meet minimum color contrast',
    helpUrl: 'https://dequeuniversity.com/rules/axe/color-contrast',
    nodes: [
      {
        selector: '.a',
        summary:
          'Fix any of the following:\n  Element has insufficient contrast of 2.1',
        rect: rect(),
      },
      {
        selector: '.b',
        summary: 'Fix all of the following:  Missing label',
        rect: null,
      },
    ],
  };

  it('makes one finding per node and strips the prefix', () => {
    const findings = axeFindings([violation], 'tablet', 'https://site.test/');
    expect(findings).toHaveLength(2);
    expect(findings[0]).toMatchObject({
      rule: 'axe:color-contrast',
      severity: 'major',
      title: violation.help,
      expected: violation.help,
      screen: 'tablet',
      url: 'https://site.test/',
      selector: '.a',
      measured: 'Element has insufficient contrast of 2.1',
      helpUrl: violation.helpUrl,
    });
    expect(findings[1].measured).toBe('Missing label');
    expect(findings[1].rect).toBeNull();
  });

  it('maps impact to severity', () => {
    const sev = (impact: 'critical' | 'moderate' | 'minor' | null) =>
      axeFindings([{ ...violation, impact }], 'mobile', 'u')[0].severity;
    expect(sev('critical')).toBe('major');
    expect(sev('moderate')).toBe('minor');
    expect(sev('minor')).toBe('minor');
    expect(sev(null)).toBe('minor');
  });

  it('limits the measured text to 200 characters', () => {
    const [finding] = axeFindings(
      [
        {
          ...violation,
          nodes: [{ selector: '.a', summary: 'y'.repeat(500), rect: null }],
        },
      ],
      'mobile',
      'u',
    );
    expect(finding.measured).toHaveLength(200);
  });
});

describe('loadFindings', () => {
  const load = { url: 'https://site.test/x', screen: 'mobile' as const };

  it('reports an error status', () => {
    const [finding] = loadFindings({ ...load, status: 404, consoleErrors: [] });
    expect(finding).toMatchObject({
      rule: 'http-error',
      severity: 'major',
      title: 'Page answers 404',
      expected: 'The page loads (HTTP 2xx or 3xx)',
    });
  });

  it('reports console errors as one finding', () => {
    const findings = loadFindings({
      ...load,
      status: 200,
      consoleErrors: ['a'.repeat(300), 'b', 'c'],
    });
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      rule: 'console-error',
      severity: 'minor',
      title: 'Errors in the browser console',
      expected: 'No uncaught errors in the console',
    });
    expect(findings[0].measured).toBe('a'.repeat(150) + ' (+2 more)');
  });

  it('reports nothing for a healthy load', () => {
    expect(loadFindings({ ...load, status: 200, consoleErrors: [] })).toEqual(
      [],
    );
    expect(loadFindings({ ...load, status: null, consoleErrors: [] })).toEqual(
      [],
    );
  });
});

describe('urlGroup', () => {
  it.each([
    ['https://a.test/', '/'],
    ['https://a.test', '/'],
    ['https://a.test/claims/123', '/claims/:id'],
    ['https://a.test/Claims/123/', '/claims/:id'],
    [
      'https://a.test/c/3f2b8c1e-1a2b-4c3d-8e4f-5a6b7c8d9e0f/edit',
      '/c/:id/edit',
    ],
    ['https://a.test/news/2026-03-14/story', '/news/:id/story'],
    ['https://a.test/t/abcdef1234567890xy', '/t/:id'],
    ['https://a.test/about-us?x=1#top', '/about-us'],
    ['https://a.test/internationalization', '/internationalization'],
    ['not a url', 'not a url'],
  ])('%s -> %s', (url, group) => {
    expect(urlGroup(url)).toBe(group);
  });
});

describe('mergeFindings', () => {
  const raw = (over: Partial<RawFinding & { crop: string | null }> = {}) => ({
    rule: 'tap-target',
    severity: 'minor' as const,
    title: 'Tap target too small',
    screen: 'mobile' as const,
    url: 'https://a.test/claims/1',
    selector: '#go',
    measured: '16×16 px',
    expected: 'At least 24×24 px',
    rect: null,
    helpUrl: null,
    crop: null,
    ...over,
  });

  it('merges the same rule and element across a URL group', () => {
    const merged = mergeFindings([
      raw(),
      raw({
        url: 'https://a.test/claims/2',
        crop: 'crops/2.png',
        measured: '15×15 px',
      }),
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({
      group: '/claims/:id',
      pages: ['https://a.test/claims/2', 'https://a.test/claims/1'],
      crop: 'crops/2.png',
      measured: '15×15 px',
    });
    expect(merged[0].id).toMatch(/^f-[0-9a-f]{8}$/);
  });

  it('keeps different selectors, screens and groups apart, and ids are stable', () => {
    const merged = mergeFindings([
      raw(),
      raw({ selector: '#other' }),
      raw({ selector: null }),
      raw({ screen: 'tablet' }),
      raw({ url: 'https://a.test/policies/1' }),
    ]);
    expect(merged).toHaveLength(5);
    expect(new Set(merged.map((f) => f.id)).size).toBe(5);
    expect(mergeFindings([raw()])[0].id).toBe(mergeFindings([raw()])[0].id);
  });

  it('takes the worst severity and the first url when no crop exists', () => {
    const [finding] = mergeFindings([
      raw(),
      raw({ url: 'https://a.test/claims/2', severity: 'major' }),
      raw({ url: 'https://a.test/claims/1' }),
    ]);
    expect(finding.severity).toBe('major');
    expect(finding.pages).toEqual([
      'https://a.test/claims/1',
      'https://a.test/claims/2',
    ]);
  });

  it('sorts by severity, then pages, then title', () => {
    const merged = mergeFindings([
      raw({ rule: 'a', title: 'B title', selector: '#1' }),
      raw({ rule: 'b', title: 'A title', selector: '#2' }),
      raw({
        rule: 'c',
        title: 'C title',
        selector: '#3',
        severity: 'critical',
      }),
      raw({ rule: 'd', title: 'Z title', selector: '#4' }),
      raw({
        rule: 'd',
        title: 'Z title',
        selector: '#4',
        url: 'https://a.test/claims/2',
      }),
    ]);
    expect(merged.map((f) => f.title)).toEqual([
      'C title',
      'Z title',
      'A title',
      'B title',
    ]);
  });
});

describe('severityCounts', () => {
  it('counts by severity', () => {
    expect(
      severityCounts([
        { severity: 'major' },
        { severity: 'minor' },
        { severity: 'major' },
      ]),
    ).toEqual({ critical: 0, major: 2, minor: 1 });
  });
});

describe('exclusionMatcher', () => {
  it('matches the path and query, case-insensitively', () => {
    const match = exclusionMatcher('logout|/delete');
    expect(match('https://a.test/LogOut')).toBe(true);
    expect(match('https://a.test/x/delete/3')).toBe(true);
    expect(match('https://a.test/x?next=logout')).toBe(true);
    expect(match('https://a.test/home')).toBe(false);
  });

  it('ignores the origin', () => {
    expect(exclusionMatcher('logout')('https://logout.test/home')).toBe(false);
  });

  it('matches nothing when empty', () => {
    expect(exclusionMatcher('')('https://a.test/logout')).toBe(false);
  });

  it('throws a plain error for an invalid pattern', () => {
    expect(() => exclusionMatcher('(')).toThrow(
      /^The exclusion pattern is not a valid regular expression: /,
    );
  });
});
