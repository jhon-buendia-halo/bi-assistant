import fs from 'node:fs';
import type { Page } from '@playwright/test';
import { test } from '../fixtures/app.fixture';
import { videoSeconds } from './video-clock';

const DEMO = process.env['DEMO'] === '1';
const CAPTION_ID = 'qti-demo-caption';
/**
 * A walkthrough (scripts/walkthrough.mjs, skill walkthrough-video): each step
 * is written as a subtitle cue to this JSON-lines file instead of being drawn
 * on the page, its text taken from the narration file when it names the step.
 */
const CUES_FILE = process.env['WALKTHROUGH_CUES'];
const NARRATION: Record<string, string> = process.env['WALKTHROUGH_NARRATION']
  ? (JSON.parse(
      fs.readFileSync(process.env['WALKTHROUGH_NARRATION'], 'utf8'),
    ) as Record<string, string>)
  : {};

/**
 * Runs one Gherkin line of a scenario as a Playwright step:
 * `await scenarioStep(page, 'When I choose "Dark"', async () => { … })`.
 *
 * With DEMO=1 (`scripts/qa.mjs --fast`, roadmap 0.4.5), the line is also shown
 * as a caption at the bottom of the page while the step runs, so the recorded
 * demo video reads like the scenario. Without it, this is just `test.step`:
 * no caption, no pause. Tag the test `@demo` and `@story-<roadmap-id>` so
 * qa.mjs finds it (delivery.md 13).
 */
export async function scenarioStep(
  page: Page,
  title: string,
  body: () => Promise<void>,
): Promise<void> {
  await test.step(title, async () => {
    if (DEMO && CUES_FILE) {
      const start = videoSeconds(page);
      await page.waitForTimeout(700);
      await body();
      await page.waitForTimeout(1200);
      const cue = {
        start,
        end: videoSeconds(page),
        text: NARRATION[title] ?? title,
      };
      fs.appendFileSync(CUES_FILE, `${JSON.stringify(cue)}\n`);
      return;
    }
    if (DEMO) await showCaption(page, title);
    await body();
    if (DEMO) await page.waitForTimeout(1200);
  });
}

async function showCaption(page: Page, title: string): Promise<void> {
  await page.evaluate(
    ({ id, text }) => {
      let el = document.getElementById(id);
      if (!el) {
        el = document.createElement('div');
        el.id = id;
        el.setAttribute('aria-hidden', 'true');
        Object.assign(el.style, {
          position: 'fixed',
          left: '50%',
          bottom: '24px',
          transform: 'translateX(-50%)',
          zIndex: '2147483647',
          padding: '10px 18px',
          borderRadius: '10px',
          background: 'rgba(15, 23, 42, 0.88)',
          color: '#fff',
          font: '600 18px/1.35 system-ui, sans-serif',
          boxShadow: '0 6px 24px rgba(0,0,0,0.35)',
          pointerEvents: 'none',
          maxWidth: '80vw',
          textAlign: 'center',
        });
        document.body.appendChild(el);
      }
      el.textContent = text;
    },
    { id: CAPTION_ID, text: title },
  );
  await page.waitForTimeout(700);
}
