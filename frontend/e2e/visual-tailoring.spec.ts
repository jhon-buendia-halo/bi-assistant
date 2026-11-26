import fs from 'node:fs';
import path from 'node:path';
import type { Frame, Page } from '@playwright/test';
import { expect, test } from './fixtures/app.fixture';
import { builtBrand } from './helpers/brand';
import {
  WORLD_CUP_DATASET,
  followOsTheme,
  openSessions,
  WORLD_CUP_SESSION,
} from './helpers/app-actions';
import { apiJson } from './helpers/api';
import { saveLenaiSettings, seedWorldCupDataset } from './helpers/agents-api';
import { seedPastChat, seedRunVisual } from './helpers/past-chats';
import { ASK_WORKFLOW_ID, ASK_WORKFLOW_NAME } from './helpers/runs-api';
import {
  LlmStub,
  StubReply,
  StubRequest,
  startLlmStub,
} from './helpers/llm-stub';
import { scenarioStep } from './support/demo-captions';

/**
 * Mirrors the Feature "Visual tailoring" in specs/capabilities/visuals/spec.md,
 * against a past chat's read-only panel (the chat composer is retired, plan
 * 1.24.8; a run's own panel returns with plan 1.25.4): the scenarios "The visual follows the app's theme" and "An older visual
 * opens in the current theme" (visuals R40, BA-230). The visual designer is
 * gone (2026-11-26): the visuals under test are stored ones, written the way
 * an earlier version left them, and the frame is the document the backend
 * builds from them.
 */

const QUESTION = 'How many matches were played at each stage?';
const ANSWER = 'The group stage holds most of the matches.';
const SQL =
  'SELECT stage, COUNT(*) AS matches FROM world_cup.world_cup.matches GROUP BY stage';
const VISUAL_TITLE = 'Matches by stage';

/** The frame's tokens per theme (visuals R40) and brand (ADR-0045), as computed colours. */
const BRAND_FRAME_COLOURS = {
  halo: {
    light: { bg: 'rgb(255, 255, 255)', strong: 'rgb(24, 24, 24)' },
    dark: { bg: 'rgb(36, 36, 36)', strong: 'rgb(255, 255, 255)' },
  },
  mercer: {
    light: { bg: 'rgb(255, 255, 255)', strong: 'rgb(0, 31, 82)' },
    dark: { bg: 'rgb(18, 35, 58)', strong: 'rgb(238, 244, 252)' },
  },
} as const;
const FRAME_COLOURS = BRAND_FRAME_COLOURS[builtBrand()];
type Theme = keyof typeof FRAME_COLOURS;

/** The frame's background before BA-230: always dark (#171717). */
const OLD_FRAME_BACKGROUND = '#171717';

const SPEC_REPLY = {
  title: VISUAL_TITLE,
  description:
    'The group stage is played far more often than any knockout round.',
  spec: {
    spec: 1,
    chart: {
      form: 'bar',
      select: ['stage', 'matches'],
      x: 'stage',
      y: 'matches',
      sort: { by: 'y', dir: 'desc' },
    },
  },
};

const EVIDENCE = path.resolve(__dirname, '../../evidence/1.14.17');

let stub: LlmStub;

function scriptedReply(request: StubRequest): StubReply {
  if (
    request.stream &&
    !request.messages.some((message) => message.role === 'tool')
  ) {
    return {
      toolCall: {
        name: 'run_readonly_sql',
        arguments: { sql: SQL, rationale: 'Count the matches per stage.' },
      },
    };
  }
  return { text: ANSWER };
}

test.beforeEach(async ({ page }) => {
  stub = await startLlmStub();
  stub.reply = scriptedReply;
  await seedWorldCupDataset(page);
  await saveLenaiSettings(page, stub.baseUrl);
});

test.afterEach(async () => {
  await stub.close();
});

const visualFrameElement = (page: Page) =>
  page.locator('iframe[title="Interactive visualization"]');

/** The sandboxed visual's frame, once its document has rendered the title. */
async function visualFrame(page: Page): Promise<Frame> {
  await expect(visualFrameElement(page)).toBeVisible();
  const frame = await (await visualFrameElement(
    page,
  ).elementHandle())!.contentFrame();
  if (!frame) throw new Error('The visual has no frame');
  await expect(frame.locator('.qti-title')).toBeVisible();
  return frame;
}

/** The frame's theme attribute and colours match `theme` (visuals R40). */
async function expectFrameTheme(frame: Frame, theme: Theme): Promise<void> {
  await expect(frame.locator('html')).toHaveAttribute('data-theme', theme);
  await expect(frame.locator('body')).toHaveCSS(
    'background-color',
    FRAME_COLOURS[theme].bg,
  );
  await expect(frame.locator('.qti-title')).toHaveCSS(
    'color',
    FRAME_COLOURS[theme].strong,
  );
}

/**
 * Seeds an old chat with a visual into the data dir (no route starts a chat
 * any more) and opens it from Runs → Past chats. The chat is read-only, with
 * its visual in the panel.
 */
async function openPastChatWithVisual(
  page: Page,
  appDataDir: string,
): Promise<string> {
  const id = seedPastChat(appDataDir, {
    name: WORLD_CUP_SESSION,
    datasets: [WORLD_CUP_DATASET],
    workflowId: 'agent:assistant',
    turns: [
      {
        question: QUESTION,
        answer: ANSWER,
        data: [
          {
            tool: 'run_readonly_sql',
            input: SQL,
            columns: ['stage', 'matches'],
            rows: [
              { stage: 'Group stage', matches: 48 },
              { stage: 'Round of 16', matches: 8 },
              { stage: 'Final', matches: 1 },
            ],
            rowCount: 3,
            rationale: 'Count the matches per stage.',
          },
        ],
      },
    ],
    visual: {
      title: VISUAL_TITLE,
      description: SPEC_REPLY.description,
      spec: SPEC_REPLY.spec,
    },
  });
  await page.reload();
  await openPastChat(page);
  return id;
}

/** Opens the past chat from Runs → Past chats and its visual in the panel. */
async function openPastChat(page: Page): Promise<void> {
  await openSessions(page);
  await page
    .getByRole('navigation', { name: 'Past chats', exact: true })
    .getByRole('button', { name: new RegExp(`^${WORLD_CUP_SESSION}`) })
    .click();
  await expect(page.getByTestId('past-chat-banner')).toBeVisible();
  // The details panel starts collapsed after a reload (app-shell R2): open
  // the visual from its card in the chat.
  await page
    .getByText(`Created ${VISUAL_TITLE}`)
    .locator('xpath=ancestor::*[.//button[normalize-space()="View"]][1]')
    .getByRole('button', { name: 'View' })
    .click();
}

test("the visual follows the app's theme", async ({ appDataDir, page }) => {
  // The theme is switched while the visual stays open: Settings would replace
  // the chat (and with it the panel), so the app follows the operating system
  // (System) and the OS setting is switched; the app's resolved theme changes
  // in place exactly as when Appearance is changed.
  await page.emulateMedia({ colorScheme: 'light' });
  await followOsTheme(page);
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');

  await openPastChatWithVisual(page, appDataDir);
  const frame = await visualFrame(page);
  await expectFrameTheme(frame, 'light');
  // A chart label uses the frame's tokens too, not a hardcoded light grey.
  const label = frame.locator('svg text').first();
  await expect(label).toBeVisible();
  const lightLabel = await label.evaluate((el) => getComputedStyle(el).fill);
  await page.screenshot({
    path: path.join(EVIDENCE, 'visual-light-theme.png'),
  });

  // State that a reload would lose.
  await frame.evaluate(() => {
    (window as unknown as { qtiKept: string }).qtiKept = 'kept';
  });
  await frame.locator('[data-qti-value]').first().hover();

  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expectFrameTheme(frame, 'dark');
  // The same document: no reload, so its state survived.
  expect(
    await frame.evaluate(
      () => (window as unknown as { qtiKept?: string }).qtiKept,
    ),
  ).toBe('kept');
  expect(await label.evaluate((el) => getComputedStyle(el).fill)).not.toBe(
    lightLabel,
  );
  await page.screenshot({
    path: path.join(EVIDENCE, 'visual-dark-theme.png'),
  });
});

test('an older visual opens in the current theme', async ({
  page,
  appDataDir,
}) => {
  const sessionId = await openPastChatWithVisual(page, appDataDir);
  await visualFrame(page);

  // Rewrite the stored visual as one made before the themed frame: a legacy
  // bundle with only index.html (no body.html, no spec), whose own styles
  // hardcode the old always-dark frame.
  const visuals = path.join(
    appDataDir,
    'workspaces',
    `session-${sessionId}`,
    'visuals',
  );
  const dirs = fs
    .readdirSync(visuals, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name === 'index.html')
    .map((entry) => entry.parentPath);
  expect(dirs.length, `a stored visual under ${visuals}`).toBeGreaterThan(0);
  for (const dir of dirs) {
    for (const name of ['body.html', 'spec.json']) {
      fs.rmSync(path.join(dir, name), { force: true });
    }
    fs.writeFileSync(path.join(dir, 'styles.css'), '');
    fs.writeFileSync(path.join(dir, 'script.js'), '');
    fs.writeFileSync(
      path.join(dir, 'index.html'),
      `<!doctype html><html><head><style>html, body { margin: 0; background: ${OLD_FRAME_BACKGROUND}; color: #d4d4d8; }</style></head>` +
        `<body><p id="made-before">Made before the themed frame</p><script src="script.js"></script></body></html>`,
    );
  }

  // Given the app is in the Dark theme
  await page.getByTitle('Settings').click();
  await page
    .getByRole('navigation', { name: 'Settings navigation' })
    .getByRole('button', { name: 'Appearance' })
    .click();
  await page
    .getByRole('radiogroup', { name: 'Theme' })
    .getByRole('radio', { name: 'Dark', exact: true })
    .click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');

  // When I open the visual
  await openPastChat(page);
  const frame = await visualFrame(page);
  await expect(frame.getByText('Made before the themed frame')).toBeVisible();
  await expectFrameTheme(frame, 'dark');
  await page.screenshot({
    path: path.join(EVIDENCE, 'visual-older-opens-dark.png'),
  });
});

/**
 * "A stored visual on a run's result" (visuals R12-R24 on a run, R41, R42): the
 * visual a run holds opens under its answer on the run page, read-only (no
 * Generate, no Tailor), with versions, Refresh and Download over
 * `/workflow-runs/:id/visualizations`.
 */
test(
  'a visual stored on a run opens in the side panel, with no Generate and no Tailor',
  { tag: ['@demo', '@story-1.23.25'] },
  async ({ appDataDir, page }) => {
    const runVisual = page.getByTestId('run-visual');
    const versionButton = runVisual.getByTitle('Version history');
    let runId = '';
    await scenarioStep(
      page,
      `Given a run of ${ASK_WORKFLOW_NAME} with an answer and a stored visual`,
      async () => {
        const run = await apiJson<{ id: string }>(
          page,
          'POST',
          `/workflows/${ASK_WORKFLOW_ID}/runs`,
          {
            input: {
              question: QUESTION,
              datasets: [WORLD_CUP_DATASET],
            },
          },
        );
        runId = run.id;
        seedRunVisual(appDataDir, runId, {
          title: VISUAL_TITLE,
          description: SPEC_REPLY.description,
          spec: SPEC_REPLY.spec,
        });
        await page.reload();
      },
    );
    await scenarioStep(page, 'And I open the run from Runs', async () => {
      await page
        .getByRole('complementary', { name: 'Navigation rail' })
        .getByRole('button', { name: 'Runs', exact: true })
        .click();
      await page
        .getByTestId(`run-${runId}`)
        .getByRole('button')
        .first()
        .click();
      // The run opens on its workflow's page, its answer in the Run panel's Chat.
      await expect(page.getByTestId('run-answer')).toContainText(ANSWER);
    });
    await scenarioStep(
      page,
      'Then the answer offers no "Generate interactive visuals"',
      async () => {
        await expect(
          page.getByRole('button', { name: 'Generate interactive visuals' }),
        ).toHaveCount(0);
      },
    );
    await scenarioStep(
      page,
      "When I open the visual from its card in the run's thread",
      async () => {
        await page
          .getByTestId('workflow-run-chat-log')
          .getByTestId('run-artifact-open')
          .first()
          .click();
      },
    );
    await scenarioStep(
      page,
      'Then the visual opens in the side panel at version 1, with Refresh and Download but no Tailor',
      async () => {
        await expect(
          runVisual.locator('iframe[title="Interactive visualization"]'),
        ).toBeVisible();
        // The side panel on the window's right edge (visuals R42).
        await expect(runVisual).toHaveAttribute('data-sheet', 'true');
        await expect(runVisual).toBeInViewport();
        await expect(versionButton).toHaveText(/v1/);
        await expect(
          runVisual.getByRole('button', { name: 'Refresh data' }),
        ).toBeVisible();
        await expect(
          runVisual.getByRole('button', { name: 'Download bundle' }),
        ).toBeVisible();
        await expect(
          runVisual.getByRole('button', { name: 'Tailor' }),
        ).toHaveCount(0);
        // Its artifact card in the thread (visuals R42).
        await expect(
          page
            .getByTestId('workflow-run-chat-log')
            .getByTestId('run-artifact-card')
            .filter({ hasText: 'Created · Version' }),
        ).toContainText(VISUAL_TITLE);
      },
    );
    await scenarioStep(
      page,
      'And reopening the run still shows the visual and its card',
      async () => {
        await page.reload();
        await page
          .getByRole('complementary', { name: 'Navigation rail' })
          .getByRole('button', { name: 'Runs', exact: true })
          .click();
        await page
          .getByTestId(`run-${runId}`)
          .getByRole('button')
          .first()
          .click();
        await expect(page.getByTestId('run-artifact-card')).toHaveCount(1);
        await page.getByTestId('run-artifact-open').first().click();
        await expect(
          runVisual.locator('iframe[title="Interactive visualization"]'),
        ).toBeVisible();
      },
    );
  },
);

/**
 * "A visual can be a dashboard" (visuals, panels): a stored visual holds a spec
 * with KPI tiles and two panels, and the frame draws them from its stored
 * result sets. No result set has a US state column, so the map form is
 * not covered here (it has unit tests).
 */
const DASHBOARD_QUESTION =
  'Give me a dashboard of the matches: totals, and by stage.';
const DASHBOARD_ANSWER = 'There were many matches; most were group games.';
const TOTALS_SQL =
  'SELECT COUNT(*)::int AS matches, SUM(home_goals + away_goals)::int AS goals FROM world_cup.world_cup.matches';
const BY_STAGE_SQL =
  'SELECT stage, COUNT(*)::int AS matches FROM world_cup.world_cup.matches GROUP BY stage';
const BY_STAGE_DURATION_SQL =
  "SELECT stage, CASE WHEN went_to_extra_time THEN 'Extra time' ELSE 'Regular time' END AS duration, COUNT(*)::int AS matches FROM world_cup.world_cup.matches GROUP BY 1, 2";
/** The result sets the stored dashboard was drawn from. */
const DASHBOARD_RESULTS = [
  {
    tool: 'run_readonly_sql',
    input: TOTALS_SQL,
    columns: ['matches', 'goals'],
    rows: [{ matches: 64, goals: 172 }],
    rowCount: 1,
  },
  {
    tool: 'run_readonly_sql',
    input: BY_STAGE_SQL,
    columns: ['stage', 'matches'],
    rows: [
      { stage: 'Group stage', matches: 48 },
      { stage: 'Round of 16', matches: 8 },
      { stage: 'Final', matches: 1 },
    ],
    rowCount: 3,
  },
  {
    tool: 'run_readonly_sql',
    input: BY_STAGE_DURATION_SQL,
    columns: ['stage', 'duration', 'matches'],
    rows: [
      { stage: 'Group stage', duration: 'Regular time', matches: 48 },
      { stage: 'Round of 16', duration: 'Regular time', matches: 6 },
      { stage: 'Round of 16', duration: 'Extra time', matches: 2 },
      { stage: 'Final', duration: 'Extra time', matches: 1 },
    ],
    rowCount: 4,
  },
];
const PIVOT_TITLE = 'Matches by stage and duration';
const BAR_TITLE = 'Matches per stage';
const DASHBOARD_REPLY = {
  title: 'Matches dashboard',
  description: 'Totals, then the matches by stage as a pivot and a bar chart.',
  spec: {
    spec: 1,
    kpis: [
      {
        label: 'Matches played',
        select: ['matches', 'goals'],
        column: 'matches',
        agg: 'sum',
      },
      {
        label: 'Goals scored',
        select: ['matches', 'goals'],
        column: 'goals',
        agg: 'sum',
      },
    ],
    panels: [
      {
        title: PIVOT_TITLE,
        span: 7,
        chart: {
          form: 'pivot',
          select: ['stage', 'duration', 'matches'],
          x: 'stage',
          series: 'duration',
          y: 'matches',
        },
      },
      {
        title: BAR_TITLE,
        span: 5,
        chart: {
          form: 'bar',
          select: ['stage', 'matches'],
          x: 'stage',
          y: 'matches',
        },
      },
    ],
  },
};

test(
  'a dashboard visual shows its KPI tiles and two panels side by side',
  { tag: ['@story-visual-panels'] },
  async ({ appDataDir, page }) => {
    // The run's answer is plain: the dashboard is the stored visual's.
    stub.reply = () => ({ text: DASHBOARD_ANSWER });
    // Wide enough for the 12-column grid: a frame under 720px stacks the panels.
    await page.setViewportSize({ width: 1600, height: 1000 });

    const runVisual = page.getByTestId('run-visual');
    let runId = '';
    await scenarioStep(
      page,
      'Given a run with a stored dashboard visual over three result sets',
      async () => {
        const run = await apiJson<{ id: string }>(
          page,
          'POST',
          `/workflows/${ASK_WORKFLOW_ID}/runs`,
          {
            input: {
              question: DASHBOARD_QUESTION,
              datasets: [WORLD_CUP_DATASET],
            },
          },
        );
        runId = run.id;
        await page.reload();
        await page
          .getByRole('complementary', { name: 'Navigation rail' })
          .getByRole('button', { name: 'Runs', exact: true })
          .click();
        await page
          .getByTestId(`run-${runId}`)
          .getByRole('button')
          .first()
          .click();
        await expect(page.getByTestId('run-answer')).toContainText(
          DASHBOARD_ANSWER,
        );
      },
    );
    await scenarioStep(
      page,
      'When I open its stored dashboard visual full screen',
      async () => {
        seedRunVisual(
          appDataDir,
          runId,
          {
            title: DASHBOARD_REPLY.title,
            description: DASHBOARD_REPLY.description,
            spec: DASHBOARD_REPLY.spec,
          },
          DASHBOARD_RESULTS,
        );
        await page.reload();
        await page
          .getByRole('complementary', { name: 'Navigation rail' })
          .getByRole('button', { name: 'Runs', exact: true })
          .click();
        await page
          .getByTestId(`run-${runId}`)
          .getByRole('button')
          .first()
          .click();
        await expect(page.getByTestId('run-answer')).toContainText(
          DASHBOARD_ANSWER,
        );
        await page
          .getByTestId('workflow-run-chat-log')
          .getByTestId('run-artifact-open')
          .first()
          .click();
        await expect(runVisual).toBeVisible();
        await runVisual
          .getByRole('button', { name: 'Full screen', exact: true })
          .click();
      },
    );
    await scenarioStep(
      page,
      'Then the frame shows the dashboard: KPI tiles and two panels side by side',
      async () => {
        const frame = await visualFrame(page);
        await expect(frame.locator('main')).toHaveClass(/qti-frame--wide/);
        await expect(frame.locator('.qti-panels')).toBeVisible();
        await expect(frame.locator('section.qti-panel')).toHaveCount(2);

        const pivot = frame.getByRole('region', {
          name: PIVOT_TITLE,
          exact: true,
        });
        const bar = frame.getByRole('region', {
          name: BAR_TITLE,
          exact: true,
        });
        await expect(pivot).toBeVisible();
        await expect(bar).toBeVisible();
        await expect(pivot).toHaveAttribute('data-qti-span', '7');
        await expect(bar).toHaveAttribute('data-qti-span', '5');

        // The KPI tiles come from the totals result set.
        await expect(frame.locator('.qti-kpi')).toHaveCount(2);
        await expect(
          frame.getByText('Matches played', { exact: true }),
        ).toBeVisible();
        await expect(
          frame.getByText('Goals scored', { exact: true }),
        ).toBeVisible();

        // Both panels drew their charts from the stored rows.
        await expect(frame.getByText('No data for this view.')).toHaveCount(0);
        await expect(pivot.locator('table.qti-pivot')).toBeVisible();
        await expect(pivot.locator('tr.qti-pivot-total')).toBeVisible();
        await expect(bar.locator('[data-qti-value]').first()).toBeVisible();

        // Side by side: the same row, the first panel on the left.
        const first = await pivot.boundingBox();
        const second = await bar.boundingBox();
        expect(first, 'the pivot panel has a box').not.toBeNull();
        expect(second, 'the bar panel has a box').not.toBeNull();
        expect(Math.abs(first!.y - second!.y)).toBeLessThan(4);
        expect(first!.x).toBeLessThan(second!.x);
      },
    );
  },
);
