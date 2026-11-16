/**
 * Iris's lenient reader and the conversion of her findings (agents.md 5.19).
 */
import { irisFindings, irisReviewOf } from './review-website.iris';
import type {
  IrisReview,
  PageTemplate,
  ReviewMark,
  ReviewShot,
  SiteScreenName,
} from './review-website.schemas';

const VALID = {
  screens: ['mobile', 'desktop'] as SiteScreenName[],
  marks: new Map<SiteScreenName, ReadonlySet<number>>([
    ['mobile', new Set([1, 2])],
    ['desktop', new Set([1, 2, 3])],
  ]),
};

const GOOD = {
  mark: 2,
  screen: 'mobile',
  severity: 'major',
  category: 'spacing',
  title: 'Buttons touch each other',
  observed: 'Two buttons have no gap.',
  suggestion: 'Add a 12 px gap.',
};

describe('irisReviewOf', () => {
  it('reads a clean object, a string and a fenced reply', () => {
    const body = { findings: [GOOD], summary: 'Mostly fine.' };
    const expected = { findings: [GOOD], summary: 'Mostly fine.' };
    expect(irisReviewOf(body, VALID)).toEqual(expected);
    expect(irisReviewOf(JSON.stringify(body), VALID)).toEqual(expected);
    expect(
      irisReviewOf('Here:\n```json\n' + JSON.stringify(body) + '\n```', VALID),
    ).toEqual(expected);
  });

  it('reads nothing from a reply that is no JSON object', () => {
    const none = { findings: [], summary: '' };
    expect(irisReviewOf('no idea', VALID)).toEqual(none);
    expect(irisReviewOf('{broken', VALID)).toEqual(none);
    expect(irisReviewOf(undefined, VALID)).toEqual(none);
    expect(irisReviewOf([GOOD], VALID)).toEqual(none);
    expect(irisReviewOf({ findings: 'x' }, VALID)).toEqual(none);
  });

  it('drops a finding on an unknown screen or with an empty title', () => {
    const review = irisReviewOf(
      {
        findings: [
          { ...GOOD, screen: 'tablet' },
          { ...GOOD, screen: 7 },
          { ...GOOD, title: '   ' },
          { ...GOOD, title: undefined },
          null,
          'text',
          GOOD,
        ],
      },
      VALID,
    );
    expect(review.findings).toEqual([GOOD]);
    expect(review.summary).toBe('');
  });

  it('turns a mark the screen does not have into null', () => {
    const review = irisReviewOf(
      {
        findings: [
          { ...GOOD, screen: 'mobile', mark: 3 },
          { ...GOOD, screen: 'desktop', mark: 3 },
          { ...GOOD, mark: 'two' },
          { ...GOOD, mark: null },
          { ...GOOD, mark: undefined },
        ],
      },
      VALID,
    );
    expect(review.findings.map((f) => f.mark)).toEqual([
      null,
      3,
      null,
      null,
      null,
    ]);
  });

  it('falls back to other and minor for unknown category and severity', () => {
    const [finding] = irisReviewOf(
      { findings: [{ ...GOOD, category: 'vibes', severity: 'blocker' }] },
      VALID,
    ).findings;
    expect(finding.category).toBe('other');
    expect(finding.severity).toBe('minor');
    const [none] = irisReviewOf(
      { findings: [{ ...GOOD, category: undefined, severity: 3 }] },
      VALID,
    ).findings;
    expect(none.category).toBe('other');
    expect(none.severity).toBe('minor');
  });

  it('trims strings, caps them at 300 characters and fills missing ones', () => {
    const [finding] = irisReviewOf(
      {
        findings: [
          {
            ...GOOD,
            title: `  ${'t'.repeat(400)}  `,
            observed: 'o'.repeat(301),
            suggestion: undefined,
          },
        ],
        summary: `  ${'s'.repeat(500)}`,
      },
      VALID,
    ).findings;
    expect(finding.title).toBe('t'.repeat(300));
    expect(finding.observed).toBe('o'.repeat(300));
    expect(finding.suggestion).toBe('');
    expect(
      irisReviewOf({ findings: [], summary: `  ${'s'.repeat(500)}` }, VALID)
        .summary,
    ).toBe('s'.repeat(300));
  });

  it('keeps at most eight findings, in order, counting only valid ones', () => {
    const findings = [
      { ...GOOD, screen: 'tablet', title: 'dropped' },
      ...Array.from({ length: 12 }, (_, i) => ({ ...GOOD, title: `F${i}` })),
    ];
    const review = irisReviewOf({ findings }, VALID);
    expect(review.findings.map((f) => f.title)).toEqual(
      Array.from({ length: 8 }, (_, i) => `F${i}`),
    );
  });
});

const TEMPLATE: PageTemplate = {
  id: '/claims/:id',
  pages: ['https://x.test/claims/1', 'https://x.test/claims/2'],
  representative: 'https://x.test/claims/1',
};
const RECT = { x: 10, y: 20, width: 100, height: 40 };
const MARK: ReviewMark = {
  n: 2,
  selector: '#submit',
  tag: 'button',
  text: 'Submit',
  rect: RECT,
  crop: 'crops/m2.png',
};
const SHOTS: ReviewShot[] = [
  {
    template: TEMPLATE.id,
    url: TEMPLATE.representative,
    screen: 'mobile',
    clean: 'a.png',
    marked: 'b.png',
    marks: [MARK],
  },
  {
    template: TEMPLATE.id,
    url: TEMPLATE.representative,
    screen: 'desktop',
    clean: 'c.png',
    marked: 'd.png',
    marks: [{ ...MARK, selector: '#other', crop: null }],
  },
];
const CTX = { template: TEMPLATE, url: TEMPLATE.representative, shots: SHOTS };

describe('irisFindings', () => {
  const review: IrisReview = {
    findings: [
      {
        mark: 2,
        screen: 'mobile',
        severity: 'major',
        category: 'spacing',
        title: 'Buttons touch',
        observed: 'No gap.',
        suggestion: 'Add a gap.',
      },
      {
        mark: null,
        screen: 'desktop',
        severity: 'minor',
        category: 'hierarchy',
        title: 'Flat headings',
        observed: 'All headings look alike.',
        suggestion: 'Vary the sizes.',
      },
    ],
    summary: '',
  };

  it('converts a finding about a mark with its element, box and crop', () => {
    const [finding] = irisFindings(review, CTX);
    expect(finding).toEqual({
      id: finding.id,
      rule: 'visual:spacing',
      severity: 'major',
      title: 'Buttons touch',
      screen: 'mobile',
      group: '/claims/:id',
      pages: ['https://x.test/claims/1'],
      selector: '#submit',
      rect: RECT,
      crop: 'crops/m2.png',
      measured: 'No gap.',
      expected: 'Add a gap.',
      helpUrl: null,
      source: 'iris',
    });
    expect(finding.id).toMatch(/^f-[0-9a-f]{8}$/);
  });

  it('leaves selector, box and crop empty for the page as a whole', () => {
    const finding = irisFindings(review, CTX)[1];
    expect(finding).toMatchObject({
      rule: 'visual:hierarchy',
      selector: null,
      rect: null,
      crop: null,
      source: 'iris',
    });
  });

  it('takes the mark from the shot of the finding’s screen', () => {
    const onDesktop = irisFindings(
      { findings: [{ ...review.findings[0], screen: 'desktop' }], summary: '' },
      CTX,
    )[0];
    expect(onDesktop.selector).toBe('#other');
    expect(onDesktop.crop).toBeNull();
  });

  it('gives no element when the mark is not on that shot', () => {
    const [finding] = irisFindings(
      { findings: [{ ...review.findings[0], mark: 9 }], summary: '' },
      CTX,
    );
    expect(finding.selector).toBeNull();
    expect(finding.rect).toBeNull();
  });

  it('makes a stable id that tells findings apart', () => {
    const again = irisFindings(review, CTX);
    expect(again.map((f) => f.id)).toEqual(
      irisFindings(review, CTX).map((f) => f.id),
    );
    expect(new Set(again.map((f) => f.id)).size).toBe(2);
    const moved = irisFindings(
      { findings: [{ ...review.findings[0], mark: 1 }], summary: '' },
      CTX,
    )[0];
    expect(moved.id).not.toBe(again[0].id);
    // observed and suggestion are not part of the id
    const reworded = irisFindings(
      { findings: [{ ...review.findings[0], observed: 'Other' }], summary: '' },
      CTX,
    )[0];
    expect(reworded.id).toBe(again[0].id);
  });
});
