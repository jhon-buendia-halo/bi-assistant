import { spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import { chromium, type Locator, type Page } from '@playwright/test';
import { test, expect } from './fixtures/app.fixture';
import { scenarioStep } from './support/demo-captions';
import { saveLenaiSettings } from './helpers/agents-api';
import { startLlmStub, type StubRequest } from './helpers/llm-stub';

// Review a Website drives a browser from the backend (agents.md 5.19,
// ADR-0049): the app under test gets Playwright's own Chromium, so the
// suite does not depend on the machine's Edge or Chrome. Set before the
// app starts: the app fixture passes this process's environment on.
process.env['SITE_REVIEW_BROWSER_PATH'] ??= chromium.executablePath();

const SITE_PORT = 4600 + Math.floor(Math.random() * 300);
const SITE = `http://127.0.0.1:${SITE_PORT}`;

let site: ChildProcess;

test.beforeAll(async () => {
  // Background: the local website with known defects.
  site = spawn(
    process.execPath,
    [
      path.join(__dirname, 'fixtures', 'site-review-site.cjs'),
      String(SITE_PORT),
    ],
    { stdio: ['ignore', 'pipe', 'inherit'] },
  );
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error('fixture site did not start')),
      10_000,
    );
    site.stdout?.on('data', (chunk) => {
      if (String(chunk).includes('site-review fixture on')) {
        clearTimeout(timer);
        resolve();
      }
    });
  });
});

test.afterAll(() => {
  site.kill();
});

function railItem(page: Page, name: string): Locator {
  return page
    .getByRole('complementary', { name: 'Navigation rail' })
    .getByRole('button', { name, exact: true });
}

test.describe('Feature: Review a Website', () => {
  test(
    'I review a website and every defect comes with its evidence',
    { tag: ['@demo', '@story-1.27.1'] },
    async ({ page }) => {
      test.setTimeout(180_000);
      await scenarioStep(
        page,
        'When I open "Review a Website" from Workflows, enter the site\'s URL, untick "Visual review with Iris" and click Execute',
        async () => {
          await railItem(page, 'Workflows').click();
          await page.getByTestId('workflow-review-website').click();
          await expect(page.getByTestId('workflow-detail-name')).toHaveText(
            'Review a Website',
          );
          await page.getByTestId('workflow-input-url').fill(`${SITE}/`);
          await page.getByTestId('workflow-input-maxPages').fill('20');
          // Measured checks only: Iris's review has its own scenario.
          await page.getByTestId('workflow-input-visualReview').uncheck();
          await page.getByTestId('workflow-run').click();
        },
      );
      const answer = page.getByTestId('run-answer');
      await scenarioStep(
        page,
        'Then I see the running step and its progress, page by page',
        async () => {
          await expect(
            page.getByTestId('workflow-run-progress-latest'),
          ).toContainText(
            /Found \d+ of at most 20 pages|Checking \d+ pages|Checked \d+ of \d+/,
          );
        },
      );
      await scenarioStep(
        page,
        'And the run succeeds with no model call',
        async () => {
          await expect(page.getByText('Run succeeded')).toBeVisible({
            timeout: 150_000,
          });
          await expect(answer).toContainText(`127.0.0.1:${SITE_PORT}`);
          await expect(answer).toContainText('6 pages on Mobile and Laptop');
        },
      );
      await scenarioStep(
        page,
        'And the answer names the covered "Buy now" button as critical, then the broken image on the 2 pages of "/items/:id"',
        async () => {
          await expect(answer).toContainText(
            'Button covered by a fixed element (critical, Mobile) on 1 page of /about',
          );
          await expect(answer).toContainText(
            'Image does not load (major, Mobile) on 2 pages of /items/:id',
          );
        },
      );
      await scenarioStep(
        page,
        "And the answer's coverage says 1 link was not followed and 1 page failed to load",
        async () => {
          await expect(answer).toContainText(
            '1 link was not followed because of the exclusion rule',
          );
          await expect(answer).toContainText('1 page failed to load');
        },
      );
      await scenarioStep(
        page,
        'And the sign-out link was never opened',
        async () => {
          const visits = (await (
            await fetch(`${SITE}/__visits`)
          ).json()) as string[];
          expect(visits).not.toContain('/logout');
          expect(visits).toContain('/items/2');
        },
      );
      await scenarioStep(page, 'When I open the report', async () => {
        await page.getByTestId('workflow-run-dock-maximize').click();
        await page.getByRole('button', { name: /^View/ }).first().click();
      });
      await scenarioStep(
        page,
        'Then I see the page groups with their severities, and picking "/items/:id" shows "Image does not load" found on 2 pages with its crop',
        async () => {
          const report = page.frameLocator('iframe').first();
          await expect(
            report.getByRole('button', { name: /\/about/ }),
          ).toContainText('1 critical');
          await report.getByRole('button', { name: /\/items\/:id/ }).click();
          const card = report
            .getByRole('listitem')
            .filter({ hasText: 'Image does not load' })
            .filter({ hasText: 'Found on 2 pages' });
          await expect(card).toHaveCount(1);
          await expect(
            card.getByRole('img', {
              name: 'Crop of the screenshot for: Image does not load',
            }),
          ).toHaveAttribute('src', /^data:image\/jpeg;base64,/);
        },
      );
    },
  );
  test(
    'Iris reviews one page per template and her findings join the report',
    { tag: ['@story-1.27.2'] },
    async ({ page }) => {
      test.setTimeout(180_000);
      const stub = await startLlmStub();
      const reviewed: StubRequest[] = [];
      try {
        await saveLenaiSettings(page, stub.baseUrl);
        // Iris's reply: one visual finding on mark 1 of the Mobile shot.
        stub.reply = (request) => {
          reviewed.push(request);
          return {
            text: JSON.stringify({
              findings: [
                {
                  mark: 1,
                  screen: 'mobile',
                  severity: 'major',
                  category: 'consistency',
                  title: 'Navigation links look unlike the buttons',
                  observed:
                    'The links are plain blue text while buttons are dark.',
                  suggestion: 'Give the navigation one shared style.',
                },
              ],
              summary: 'Plain layout with an inconsistent navigation.',
            }),
          };
        };
        await scenarioStep(
          page,
          'When I review the site with "Visual review with Iris" ticked',
          async () => {
            await railItem(page, 'Workflows').click();
            await page.getByTestId('workflow-review-website').click();
            await page.getByTestId('workflow-input-url').fill(`${SITE}/`);
            await page.getByTestId('workflow-input-maxPages').fill('20');
            await expect(
              page.getByTestId('workflow-input-visualReview'),
            ).toBeChecked();
            await page.getByTestId('workflow-run').click();
          },
        );
        const answer = page.getByTestId('run-answer');
        await scenarioStep(
          page,
          'Then the run succeeds and Iris reviewed each page template that loaded, one call each, with its screenshots',
          async () => {
            await expect(page.getByText('Run succeeded')).toBeVisible({
              timeout: 150_000,
            });
            await expect(answer).toContainText(
              'Iris reviewed 4 page templates and found 4 visual issues.',
            );
            expect(reviewed).toHaveLength(4);
            const parts = reviewed[0].messages.flatMap((message) =>
              Array.isArray(message.content)
                ? (message.content as { type?: string }[])
                : [],
            );
            expect(
              parts.filter((part) => part.type === 'image_url').length,
            ).toBe(4);
          },
        );
        await scenarioStep(
          page,
          'And the report tags her finding "Iris", with what she observed and her suggestion',
          async () => {
            await page.getByTestId('workflow-run-dock-maximize').click();
            await page.getByRole('button', { name: /^View/ }).first().click();
            const report = page.frameLocator('iframe').first();
            const card = report
              .getByRole('listitem')
              .filter({ hasText: 'Navigation links look unlike the buttons' })
              .first();
            await expect(card).toContainText('Iris');
            await expect(card).toContainText('Observed:');
            await expect(card).toContainText('Suggestion:');
          },
        );
      } finally {
        await stub.close();
      }
    },
  );
});
