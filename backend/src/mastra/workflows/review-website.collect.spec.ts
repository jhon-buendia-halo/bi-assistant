import { snapshotFindings } from './review-website.checks';
import { collectDomSnapshot, isGeneratedClass } from './review-website.collect';
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
