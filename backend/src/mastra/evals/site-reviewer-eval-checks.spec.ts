import type { ReviewMark } from '../workflows/review-website.schemas';
import type { EvalCustomCheck } from './assistant.evals';
import {
  answerOf,
  atMostEightFindings,
  doesNotRepeatMeasured,
  flagsPlantedElement,
  markOfElement,
  marksExist,
  onlyMinorFindings,
  parsesAsReview,
} from './site-reviewer-eval-checks';

interface FindingInput {
  mark?: number | null;
  screen?: 'mobile' | 'laptop';
  severity?: 'critical' | 'major' | 'minor';
  category?: string;
  title?: string;
  observed?: string;
}

function finding(input: FindingInput = {}) {
  return {
    mark: input.mark === undefined ? 1 : input.mark,
    screen: input.screen ?? 'mobile',
    severity: input.severity ?? 'major',
    category: input.category ?? 'consistency',
    title: input.title ?? 'The buttons look different',
    observed: input.observed ?? 'Three buttons in a row have three styles.',
    suggestion: 'Use one button style.',
  };
}

/** A reply as the target builds it: Iris's review plus the screens. */
function answer(
  findings: ReturnType<typeof finding>[],
  planted: Record<string, number | null> = { start: 1, demo: 2, contact: 3 },
): string {
  return JSON.stringify({
    findings,
    summary: 'One page.',
    screens: [
      { screen: 'mobile', marks: [1, 2, 3, 4], planted },
      { screen: 'laptop', marks: [1, 2, 3], planted },
    ],
  });
}

async function run(check: EvalCustomCheck, text: string) {
  return check.run({ answer: text, toolCalls: [], datasets: [], vars: {} });
}

describe('answerOf', () => {
  it('reads a review with its screens', () => {
    const read = answerOf(answer([finding()]));
    expect(typeof read).toBe('object');
    expect((read as { findings: unknown[] }).findings).toHaveLength(1);
  });

  it('says why a reply is no review', () => {
    expect(answerOf('not json')).toBe('The answer is not a JSON review');
    expect(answerOf('{"findings":"none","summary":""}')).toMatch(
      /not an Iris review/,
    );
    expect(answerOf('{"findings":[],"summary":""}')).toMatch(/no screens/);
  });
});

describe('parsesAsReview', () => {
  it('passes a review and fails text', async () => {
    expect(await run(parsesAsReview(), answer([]))).toBeUndefined();
    expect(await run(parsesAsReview(), 'The page looks fine.')).toMatch(
      /not a JSON review/,
    );
  });
});

describe('atMostEightFindings', () => {
  it('passes eight and fails nine', async () => {
    const eight = Array.from({ length: 8 }, () => finding());
    expect(await run(atMostEightFindings(), answer(eight))).toBeUndefined();
    expect(
      await run(atMostEightFindings(), answer([...eight, finding()])),
    ).toMatch(/9 findings/);
  });
});

describe('marksExist', () => {
  it('passes marks of the finding screen and page-wide findings', async () => {
    const text = answer([
      finding({ mark: 4, screen: 'mobile' }),
      finding({ mark: null, screen: 'laptop' }),
    ]);
    expect(await run(marksExist(), text)).toBeUndefined();
  });

  it('fails a mark the screen does not have', async () => {
    const text = answer([finding({ mark: 4, screen: 'laptop' })]);
    expect(await run(marksExist(), text)).toMatch(
      /mark 4, which the laptop screen does not have/,
    );
  });
});

describe('flagsPlantedElement', () => {
  const check = flagsPlantedElement(
    ['consistency', 'hierarchy'],
    ['start', 'demo', 'contact'],
  );

  it('passes the right category on a planted mark', async () => {
    expect(
      await run(check, answer([finding({ mark: 2, category: 'hierarchy' })])),
    ).toBeUndefined();
  });

  it('passes when only the second screen holds the finding', async () => {
    const planted = { start: 1, demo: 2, contact: 3 };
    expect(
      await run(
        check,
        answer([finding({ mark: 3, screen: 'laptop' })], planted),
      ),
    ).toBeUndefined();
  });

  it('fails a finding on another mark, in another category, or none', async () => {
    expect(await run(check, answer([finding({ mark: 4 })]))).toMatch(
      /No consistency or hierarchy finding points at start, demo, contact/,
    );
    expect(
      await run(check, answer([finding({ mark: 1, category: 'spacing' })])),
    ).toMatch(/No consistency/);
    expect(await run(check, answer([finding({ mark: null })]))).toMatch(
      /No consistency/,
    );
    expect(await run(check, answer([]))).toMatch(/No consistency/);
  });

  it('fails when the planted element got no mark', async () => {
    const text = answer([finding({ mark: 1 })], {
      start: null,
      demo: null,
      contact: null,
    });
    expect(await run(check, text)).toMatch(/start=#none/);
  });
});

describe('onlyMinorFindings', () => {
  const check = onlyMinorFindings(2);

  it('passes an empty review and minor remarks', async () => {
    expect(await run(check, answer([]))).toBeUndefined();
    const minor = [
      finding({ severity: 'minor' }),
      finding({ severity: 'minor' }),
    ];
    expect(await run(check, answer(minor))).toBeUndefined();
  });

  it('fails a major or critical finding', async () => {
    expect(
      await run(check, answer([finding({ severity: 'major', title: 'Mess' })])),
    ).toMatch(/major finding on a clean page: "Mess"/);
    expect(
      await run(check, answer([finding({ severity: 'critical' })])),
    ).toMatch(/critical/);
  });

  it('fails three minor findings on one screen', async () => {
    const three = Array.from({ length: 3 }, () =>
      finding({ severity: 'minor' }),
    );
    expect(await run(check, answer(three))).toMatch(
      /3 minor findings on the mobile screen/,
    );
  });
});

describe('doesNotRepeatMeasured', () => {
  const check = doesNotRepeatMeasured();

  it('passes findings about something else', async () => {
    const text = answer([
      finding({
        title: 'Heading is too close to the photo area',
        observed: 'The spacing under the heading is tight.',
        category: 'spacing',
      }),
    ]);
    expect(await run(check, text)).toBeUndefined();
    expect(await run(check, answer([]))).toBeUndefined();
  });

  it('fails a finding that says the image does not load', async () => {
    const text = answer([
      finding({
        title: 'Team photo is missing',
        observed: 'The image area shows only the alt text.',
        category: 'imagery',
      }),
    ]);
    expect(await run(check, text)).toMatch(/repeats the measured/);
    expect(
      await run(
        check,
        answer([
          finding({
            title: 'Broken image',
            observed: 'The picture failed to load.',
          }),
        ]),
      ),
    ).toMatch(/Broken image/);
  });
});

describe('markOfElement', () => {
  const mark = (n: number, selector: string, rect: ReviewMark['rect']) =>
    ({ n, selector, tag: 'div', text: '', rect, crop: null }) as ReviewMark;
  const marks = [
    mark(1, '#hero', { x: 0, y: 0, width: 400, height: 300 }),
    mark(2, '#title', { x: 10, y: 10, width: 200, height: 40 }),
  ];

  it('prefers the mark with the element selector', () => {
    expect(
      markOfElement(
        { selector: '#title', rect: { x: 10, y: 10, width: 200, height: 40 } },
        marks,
      ),
    ).toBe(2);
  });

  it('falls back to the smallest mark that holds the element', () => {
    expect(
      markOfElement(
        { selector: '#inner', rect: { x: 12, y: 12, width: 100, height: 20 } },
        marks,
      ),
    ).toBe(2);
    expect(
      markOfElement(
        { selector: '#lede', rect: { x: 12, y: 100, width: 100, height: 20 } },
        marks,
      ),
    ).toBe(1);
  });

  it('is null when no mark holds it', () => {
    expect(
      markOfElement(
        { selector: '#far', rect: { x: 900, y: 900, width: 10, height: 10 } },
        marks,
      ),
    ).toBeNull();
  });
});
