import fs from 'node:fs';
import path from 'node:path';
import type { Frame, Page } from '@playwright/test';
import { expect, test } from './fixtures/app.fixture';
import {
  createWorldCupSession,
  followOsTheme,
  openSessions,
  WORLD_CUP_SESSION,
} from './helpers/app-actions';
import { saveLenaiSettings, seedWorldCupDataset } from './helpers/agents-api';
import {
  LlmStub,
  StubReply,
  StubRequest,
  startLlmStub,
  systemTexts,
} from './helpers/llm-stub';

/**
 * Mirrors the Feature "Visual tailoring" in specs/capabilities/visuals/spec.md:
 * the scenarios "The visual follows the app's theme" and "An older visual
 * opens in the current theme" (visuals R40, BA-230). The visual is designed
 * through the real designer pipeline against the recording LLM stub, so the
 * frame under test is the document the backend builds.
 */

const QUESTION = 'How many matches were played at each stage?';
const ANSWER = 'The group stage holds most of the matches.';
const SQL =
  'SELECT stage, COUNT(*) AS matches FROM world_cup.world_cup.matches GROUP BY stage';
const VISUAL_TITLE = 'Matches by stage';
const SKILL_TAG = '<interactive-visuals-skill>';

/** The frame's tokens per theme (visuals R40), as computed colours. */
const FRAME_COLOURS = {
  light: { bg: 'rgb(255, 255, 255)', strong: 'rgb(0, 31, 82)' },
  dark: { bg: 'rgb(18, 35, 58)', strong: 'rgb(238, 244, 252)' },
} as const;
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

function isDesignerCall(request: StubRequest): boolean {
  return systemTexts(request).some((text) => text.includes(SKILL_TAG));
}

function scriptedReply(request: StubRequest): StubReply {
  if (isDesignerCall(request)) return { text: JSON.stringify(SPEC_REPLY) };
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

/** Asks the question and generates the visual from its answer. */
async function generateVisual(page: Page): Promise<string> {
  const sessionId = await createWorldCupSession(page);
  await page.getByPlaceholder('Ask a follow-up question…').fill(QUESTION);
  await page.getByRole('button', { name: 'Send message' }).click();
  await expect(page.getByText(ANSWER)).toBeVisible();
  await page
    .getByRole('button', { name: 'Generate interactive visuals' })
    .click();
  await expect(page.getByText('Interactive visual generated')).toBeVisible();
  return sessionId;
}

test("the visual follows the app's theme", async ({ page }) => {
  // The theme is switched while the visual stays open: Settings would replace
  // the chat (and with it the panel), so the app follows the operating system
  // (System) and the OS setting is switched; the app's resolved theme changes
  // in place exactly as when Appearance is changed.
  await page.emulateMedia({ colorScheme: 'light' });
  await followOsTheme(page);
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');

  await generateVisual(page);
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
  const sessionId = await generateVisual(page);
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
  await openSessions(page);
  await page
    .getByRole('navigation', { name: 'Sessions', exact: true })
    .getByRole('button', { name: new RegExp(`^${WORLD_CUP_SESSION}`) })
    .click();
  // The details panel starts collapsed after a reload (app-shell R2): open
  // the visual from its card in the chat.
  await page
    .getByText(`Created ${VISUAL_TITLE}`)
    .locator('xpath=ancestor::*[.//button[normalize-space()="View"]][1]')
    .getByRole('button', { name: 'View' })
    .click();
  const frame = await visualFrame(page);
  await expect(frame.getByText('Made before the themed frame')).toBeVisible();
  await expectFrameTheme(frame, 'dark');
  await page.screenshot({
    path: path.join(EVIDENCE, 'visual-older-opens-dark.png'),
  });
});
