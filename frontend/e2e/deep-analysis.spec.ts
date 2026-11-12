import fs from 'node:fs';
import type { Download, Locator, Page } from '@playwright/test';
import { test, expect } from './fixtures/app.fixture';
import { scenarioStep } from './support/demo-captions';
import { WORLD_CUP_DATASET } from './helpers/app-actions';
import { saveLenaiSettings, seedWorldCupDataset } from './helpers/agents-api';
import {
  LlmStub,
  StubReply,
  StubRequest,
  messageText,
  startLlmStub,
} from './helpers/llm-stub';
import { worldCupKey } from './helpers/world-cup-db';

/**
 * Mirrors the Feature "Deep analysis" in
 * specs/capabilities/deep-analysis/spec.md: deep analysis runs as the
 * `deep-analysis` run workflow from its page's Run tab (plan 1.25.3), on the
 * recording stub model and the World Cup dataset.
 */

const QUESTION = 'What drives goal scoring across World Cup stages?';
const SQL = `SELECT stage, COUNT(*) AS matches FROM ${worldCupKey('matches')} GROUP BY stage`;
const PLAN = {
  title: 'World Cup scoring',
  angles: [
    { title: 'By stage', question: 'How many matches were played in each stage?' },
    { title: 'By team', question: 'Which teams scored the most goals?' },
    { title: 'By year', question: 'How did scoring change over the years?' },
  ],
};
const REPORT = {
  title: 'World Cup scoring deep dive',
  executiveSummary: 'Group-stage matches account for most goals scored.',
  report:
    '## Findings by angle\n\n### By stage\n\nMost matches are group matches.\n\n## Anomalies and drivers\n\nNone found.\n\n## Recommendations\n\nCompare stages per match.',
};
const STEPS = ['plan', 'investigate', 'write', 'assemble'];

let stub: LlmStub;

test.beforeEach(async ({ page }) => {
  // Background
  stub = await startLlmStub();
  await seedWorldCupDataset(page);
  await saveLenaiSettings(page, stub.baseUrl);
});

test.afterEach(async () => {
  await stub.close();
});

/** The text of every user message of a request: the phase prompt is one. */
function userText(request: StubRequest): string {
  return request.messages
    .filter((message) => message.role === 'user')
    .map(messageText)
    .join('\n');
}

/** The plan and the report as JSON; each angle's findings with its SQL. */
function deepAnalysisReply(request: StubRequest): StubReply {
  const text = userText(request);
  if (text.includes('Plan a deep analysis')) return { text: JSON.stringify(PLAN) };
  if (text.includes('Write the deep-analysis report')) {
    return { text: JSON.stringify(REPORT) };
  }
  const angle = /Deep analysis — angle (\d+) of/.exec(text);
  if (angle) {
    return {
      text: `Angle ${angle[1]}: group matches lead.\n\nSQL used\n\n\`\`\`sql\n${SQL}\n\`\`\``,
    };
  }
  return { text: 'The stub model answered this question.' };
}

function nodeStatus(page: Page, id: string): Locator {
  return page.getByTestId(`workflow-node-${id}`).getByTestId('workflow-node-status');
}

function runStep(page: Page, id: string): Locator {
  return page.getByTestId(`workflow-run-step-${id}`);
}

function runAnswer(page: Page): Locator {
  return page.getByTestId('run-answer');
}

test.describe('Feature: Deep analysis', () => {
  test(
    'Run a deep analysis and download its report',
    { tag: ['@demo', '@story-1.25.3', '@story-1.23.24'] },
    async ({ page }) => {
      stub.reply = deepAnalysisReply;

      await scenarioStep(page, 'When I open "Deep analysis" from Workflows and click Execute', async () => {
        await page
          .getByRole('complementary', { name: 'Navigation rail' })
          .getByRole('button', { name: 'Workflows', exact: true })
          .click();
        await page.getByTestId('workflow-deep-analysis').click();
        await expect(page.getByTestId('workflow-detail-name')).toHaveText('Deep analysis');
        for (const id of STEPS) {
          await expect(page.getByTestId(`workflow-node-${id}`)).toBeVisible();
        }
        await page.getByTestId('workflow-execute').click();
        await expect(page.getByTestId('workflow-panel-tab-run')).toHaveAttribute(
          'aria-selected',
          'true',
        );
      });
      await scenarioStep(
        page,
        `And I pick "${WORLD_CUP_DATASET}", type "${QUESTION}" and click Execute`,
        async () => {
          const card = page
            .getByTestId('workflow-input-datasets')
            .getByRole('button', { name: WORLD_CUP_DATASET });
          await card.click();
          await expect(card).toHaveAttribute('aria-pressed', 'true');
          await page.getByTestId('workflow-input-question').fill(QUESTION);
          await page.getByTestId('workflow-run').click();
        },
      );
      await scenarioStep(page, 'Then Plan, Investigate, Write and Assemble go Done', async () => {
        for (const id of STEPS) {
          await expect(nodeStatus(page, id)).toHaveText('Done');
          await expect(runStep(page, id).getByText('Done', { exact: true })).toBeVisible();
        }
        await expect(page.getByTestId('workflow-run-status')).toHaveText('Run succeeded');
      });
      await scenarioStep(
        page,
        'And I see the report card with its title, "Deep analysis · 3 angles investigated" and the executive summary',
        async () => {
          await expect(runAnswer(page)).toContainText(REPORT.title);
          await expect(runAnswer(page)).toContainText('Deep analysis · 3 angles investigated');
          await expect(runAnswer(page)).toContainText(REPORT.executiveSummary);
          await expect(
            runAnswer(page).getByRole('button', { name: 'Download report' }),
          ).toBeVisible();
        },
      );
      let saved!: Promise<Download>;
      await scenarioStep(page, 'When I click "Report"', async () => {
        saved = page.waitForEvent('download');
        await runAnswer(page).getByRole('button', { name: 'Download report' }).click();
      });
      await scenarioStep(
        page,
        'Then a markdown file named after the report title is saved, with its sections and SQL',
        async () => {
          const download = await saved;
          expect(download.suggestedFilename()).toBe('world-cup-scoring-deep-dive.md');
          const markdown = fs.readFileSync((await download.path())!, 'utf8');
          for (const heading of [
            '## Executive summary',
            '## Findings by angle',
            '## Recommendations',
            '## Data appendix',
          ]) {
            expect(markdown, heading).toContain(heading);
          }
          expect(markdown).toContain(SQL);
        },
      );
      await scenarioStep(page, 'And I see the toast "Report downloaded"', async () => {
        await expect(page.getByText('Report downloaded')).toBeVisible();
      });
    },
  );
});
