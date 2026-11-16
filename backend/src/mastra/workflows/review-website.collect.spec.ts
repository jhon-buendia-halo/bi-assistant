import { snapshotFindings } from './review-website.checks';
import {
  clearReviewMarks,
  collectDomSnapshot,
  drawReviewMarks,
  isGeneratedClass,
  structureSkeleton,
} from './review-website.collect';
import { domSnapshotSchema } from './review-website.schemas';

describe('isGeneratedClass', () => {
  it.each([
    'css-1x2y3z',
    'sc-bdnylx',
    'jsx-123',
    'a1b2c3d4e5',
    'md:flex',
    'w-1/2',
  ])('%s is generated or unusable', (name) => {
    expect(isGeneratedClass(name)).toBe(true);
  });

  it.each([
    'card',
    'primary',
    'btn-primary',
    'col-6',
    'h1',
    'nav_item',
    'Hero',
  ])('%s is kept', (name) => {
    expect(isGeneratedClass(name)).toBe(false);
  });
});

describe('collectDomSnapshot source', () => {
  const source = collectDomSnapshot.toString();

  it('is self-contained', () => {
    for (const forbidden of ['require(', 'import(', '__awaiter', 'exports.']) {
      expect(source).not.toContain(forbidden);
    }
    expect(source).not.toMatch(/\basync\b/);
  });

  it('does not call the module-level isGeneratedClass', () => {
    expect(source).not.toContain('isGeneratedClass');
  });
});

const browserPath = process.env.SITE_REVIEW_BROWSER_PATH;
const describeBrowser = browserPath ? describe : describe.skip;

const FIXTURE = `<!doctype html><html><head><style>
  body { margin: 0; font: 14px sans-serif; }
  #bar { position: fixed; left: 0; right: 0; bottom: 0; height: 120px; background: #222; color: #fff; z-index: 10; }
  #wide { width: 600px; border-collapse: collapse; }
  .tiny { width: 16px; height: 16px; padding: 0; }
  .label { width: 80px; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
</style></head><body>
  <main>
    <table id="wide"><tr><td>Wide table cell</td></tr></table>
    <button class="tiny" id="tiny"></button>
    <img id="pic" alt="Broken" width="40" height="40" src="data:image/png;base64,AAAA">
    <div class="label" id="label">An extremely long label that cannot fit</div>
    <p>Hi Forename</p>
    <form><button type="submit" id="send" style="position:absolute;left:20px;top:760px;width:120px;height:40px">Send</button></form>
  </main>
  <div id="bar">We use cookies</div>
</body></html>`;

describeBrowser('collectDomSnapshot in a real browser', () => {
  it('finds each defect of the fixture page', async () => {
    // Loaded here so Jest needs playwright-core only when a browser is set.
    const playwright = // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('playwright-core') as typeof import('playwright-core');
    const { chromium } = playwright;
    const browser = await chromium.launch({ executablePath: browserPath });
    try {
      const page = await browser.newPage({
        viewport: { width: 390, height: 844 },
      });
      await page.setContent(FIXTURE);
      const raw = await page.evaluate(collectDomSnapshot, {
        screen: 'mobile',
        viewport: { width: 390, height: 844 },
        maxElements: 50,
      });
      const snapshot = domSnapshotSchema.parse(raw);
      const findings = snapshotFindings(snapshot);
      const rules = new Set(findings.map((f) => f.rule));
      expect(rules).toEqual(
        new Set([
          'overflow-x',
          'clipped-text',
          'covered-element',
          'tap-target',
          'broken-image',
          'placeholder-text',
        ]),
      );
      expect(snapshot.widest?.selector).toBe('#wide');
      const send = snapshot.elements.find((e) => e.selector === '#send');
      expect(send).toMatchObject({ submit: true, coveredBy: '#bar' });
      expect(send?.coveredFraction).toBeGreaterThanOrEqual(0.5);
      expect(findings.find((f) => f.rule === 'covered-element')?.severity).toBe(
        'critical',
      );
      expect(snapshot.elements[0].selector).toBe('#send');
      expect(snapshot.visibleText).toContain('Hi Forename');
    } finally {
      await browser.close();
    }
  }, 60_000);
});

describe('review in-page functions source', () => {
  it.each([
    ['structureSkeleton', structureSkeleton],
    ['drawReviewMarks', drawReviewMarks],
    ['clearReviewMarks', clearReviewMarks],
  ])('%s is self-contained', (_name, fn) => {
    const source = fn.toString();
    for (const forbidden of ['require(', 'import(', '__awaiter', 'exports.']) {
      expect(source).not.toContain(forbidden);
    }
    expect(source).not.toMatch(/\basync\b/);
    expect(source).not.toContain('isGeneratedClass');
  });
});

const CARDS = (n: number, word: string): string =>
  Array.from(
    { length: n },
    (_, i) =>
      `<section><h2>${word} ${i}</h2><img alt="" width="40" height="40" src="data:image/gif;base64,R0lGODlhAQABAAAAACw="></section>`,
  ).join('');

const templatePage = (n: number, word: string): string =>
  `<!doctype html><html><body style="margin:0;font:14px sans-serif">
  <header><nav><a href="/">Home</a></nav></header>
  <main><h1>${word} title</h1><button id="go">Buy ${word}</button>${CARDS(n, word)}</main>
  <footer>Footer ${word}</footer></body></html>`;

describeBrowser('review in-page functions in a real browser', () => {
  it('fingerprints a template and draws numbered marks', async () => {
    const playwright = // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('playwright-core') as typeof import('playwright-core');
    const browser = await playwright.chromium.launch({
      executablePath: browserPath,
    });
    try {
      const page = await browser.newPage({
        viewport: { width: 1000, height: 800 },
      });
      await page.setContent(templatePage(1, 'Alpha'));
      const three = await page.evaluate(structureSkeleton);
      await page.setContent(templatePage(5, 'Beta'));
      const five = await page.evaluate(structureSkeleton);
      expect(three).toBe(five);
      expect(three).toContain('section(h2,img)');
      expect(three).not.toContain('+');
      await page.setContent(
        '<!doctype html><body><main><table><tr><td>x</td></tr></table></main></body>',
      );
      expect(await page.evaluate(structureSkeleton)).not.toBe(three);

      await page.setContent(templatePage(3, 'Alpha'));
      const marks = await page.evaluate(drawReviewMarks, {
        maxMarks: 20,
        maxHeight: 2000,
      });
      expect(marks.map((m) => m.n)).toEqual(marks.map((_, i) => i + 1));
      const tags = marks.map((m) => m.tag);
      expect(tags).toContain('h1');
      expect(tags).toContain('button');
      expect(marks.find((m) => m.tag === 'button')).toMatchObject({
        selector: '#go',
        text: 'Buy Alpha',
      });
      const tops = marks.map((m) => Math.round(m.rect.y / 8));
      expect(tops).toEqual([...tops].sort((a, b) => a - b));
      expect(await page.locator('#__qti_review_marks').count()).toBe(1);
      await page.evaluate(clearReviewMarks);
      expect(await page.locator('#__qti_review_marks').count()).toBe(0);
    } finally {
      await browser.close();
    }
  }, 60_000);
});
