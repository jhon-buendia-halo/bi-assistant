import { spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import { chromium, type Locator, type Page } from '@playwright/test';
import { test, expect } from './fixtures/app.fixture';
import { scenarioStep } from './support/demo-captions';
import { saveLenaiSettings } from './helpers/agents-api';
import { startLlmStub, type StubRequest } from './helpers/llm-stub';
import {
  composer,
  composerMenu,
  closeComposerMenu,
  openComposerMenu,
  sendRun,
  setRunField,
  setRunOption,
} from './helpers/run-ui';

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
        'When I open "Review a Website" from User journeys, switch off "Visual review with Iris" under "+", type the site\'s URL and click Send',
        async () => {
          await railItem(page, 'User journeys').click();
          await page.getByTestId('workflow-review-website').click();
          await expect(page.getByTestId('workflow-detail-name')).toHaveText(
            'Review a Website',
          );
          await setRunField(page, 'maxPages', '20');
          // Measured checks only: Iris's review has its own scenario.
          await setRunOption(page, 'visualReview', false);
          // The composer's message is the entry URL (the workflow has no question).
          await composer(page).fill(`${SITE}/`);
          await sendRun(page);
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
          await expect(answer).toContainText(
            /6 pages, 5 page templates on Mobile and Laptop/,
          );
        },
      );
      await scenarioStep(
        page,
        'And the short answer puts the covered "Buy now" button first, as critical',
        async () => {
          await expect(answer).toContainText('Fix first:');
          await expect(answer.locator('li').first()).toContainText(
            /Button covered by a fixed element — \d+ elements? on 1 page \(critical, Measured\)/,
          );
          await expect(answer.locator('li')).toHaveCount(3);
        },
      );
      await scenarioStep(
        page,
        "And the answer's coverage says 1 link was skipped and 1 page failed",
        async () => {
          await expect(answer).toContainText(
            'Coverage: 6 of 20 pages; 1 link skipped; 1 page failed.',
          );
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
      await scenarioStep(
        page,
        'When I open the report in full screen',
        async () => {
          await page.getByTestId('run-artifact-open').first().click();
          await page.getByTestId('run-visual-full-screen').click();
          await expect(page.getByTestId('run-visual')).toHaveAttribute(
            'data-full-screen',
            'true',
          );
        },
      );
      await scenarioStep(
        page,
        'Then the problems come first, worst first; "Tap target too small" groups its elements, each framed in its page, with Previous and Next',
        async () => {
          const report = page.frameLocator('iframe[title="Interactive visualization"]');
          const problems = report.getByRole('list', { name: 'Problems' });
          await expect(problems.getByRole('button').first()).toContainText(
            'Button covered by a fixed element',
          );
          await problems
            .getByRole('button', { name: /Tap target too small/ })
            .click();
          await expect(report.getByText(/^1 of [2-9]$/)).toBeVisible();
          // The element's page band, framed.
          await expect(
            report.locator('img[src^="data:image/jpeg"]').first(),
          ).toBeVisible();
          await report.getByRole('button', { name: 'Next element' }).click();
          await expect(report.getByText(/^2 of [2-9]$/)).toBeVisible();
          await expect(
            report.getByRole('button', { name: 'Previous element' }),
          ).toBeEnabled();
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
            await railItem(page, 'User journeys').click();
            await page.getByTestId('workflow-review-website').click();
            await setRunField(page, 'maxPages', '20');
            await openComposerMenu(page);
            await expect(
              composerMenu(page).getByTestId('workflow-input-visualReview'),
            ).toBeChecked();
            await closeComposerMenu(page);
            await composer(page).fill(`${SITE}/`);
            await sendRun(page);
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
              'Iris reviewed 4 templates and found 4 visual issues.',
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
            await page.getByTestId('run-artifact-open').first().click();
            await page.getByTestId('run-visual-full-screen').click();
            const report = page.frameLocator('iframe[title="Interactive visualization"]');
            await report
              .getByRole('list', { name: 'Problems' })
              .getByRole('button', {
                name: /Navigation links look unlike the buttons/,
              })
              .first()
              .click();
            // Her finding: tagged Iris, what she observed and her suggestion.
            await expect(
              report.getByText('Observed', { exact: true }).first(),
            ).toBeVisible();
            await expect(
              report
                .getByText(
                  'The links are plain blue text while buttons are dark.',
                )
                .first(),
            ).toBeVisible();
            await expect(
              report.getByText(/^Suggestion:/).first(),
            ).toBeVisible();
          },
        );
      } finally {
        await stub.close();
      }
    },
  );
});
