import fs from 'node:fs';
import path from 'node:path';
import axe from 'axe-core';
import type { Locator, Page } from '@playwright/test';
import { test, expect } from './fixtures/app.fixture';
import { createWorldCupSession, followOsTheme } from './helpers/app-actions';
import {
  createSkill,
  createUserAgent,
  saveLenaiSettings,
  seedWorldCupDataset,
} from './helpers/agents-api';
import {
  LlmStub,
  STUB_ANSWER,
  startLlmStub,
  systemTexts,
  turnRequests,
} from './helpers/llm-stub';

/**
 * Mirrors the Feature "Skill library" in specs/capabilities/agents-evals/spec.md
 * (R68-R80): the user's skills library and skill editor, and the built-in
 * skill editor. The built-in scenario's model is the recording LLM stub, so
 * the catalog the assistant receives can be read.
 */

const EMPTY_LIBRARY =
  'No skills yet. A skill is know-how an agent reads when a question needs it.';
const FISCAL = 'fiscal-calendar';
const FISCAL_DESCRIPTION = 'Use when a question names a fiscal year.';
const BUILT_IN_BANNER =
  'Changes apply to every session and agent as soon as you save. Run the evals to check them.';

/** Screenshots of the claimed state go to `evidence/<feature>/` at the repo root. */
const EVIDENCE = path.resolve(__dirname, '../../evidence');

async function evidenceShot(page: Page, feature: string, name: string) {
  const dir = path.join(EVIDENCE, feature);
  fs.mkdirSync(dir, { recursive: true });
  await page.screenshot({ path: path.join(dir, name) });
}

function button(scope: Page | Locator, name: string): Locator {
  return scope.getByRole('button', { name, exact: true });
}

async function openHub(page: Page): Promise<void> {
  await page
    .getByRole('complementary', { name: 'Navigation rail' })
    .getByRole('button', { name: 'Agents', exact: true })
    .click();
  await expect(
    page.getByRole('heading', { name: 'Agents', exact: true }),
  ).toBeVisible();
}

async function openLibrary(page: Page): Promise<void> {
  await openHub(page);
  await page.getByTestId('agent-skills-library').click();
  await expect(
    page.getByRole('heading', { name: 'Skills', exact: true }),
  ).toBeVisible();
  await expect(page.getByText('Loading skills…')).toHaveCount(0);
}

function notifications(page: Page): Locator {
  return page.getByRole('region', { name: 'Notifications' });
}

/** A toast with exactly `message`. */
function toast(page: Page, message: string): Locator {
  return notifications(page)
    .locator('div')
    .filter({ has: page.getByText(message, { exact: true }) });
}

/** Asserts an error toast (the danger icon) reading exactly `message`. */
async function expectErrorToast(page: Page, message: string): Promise<void> {
  await expect(
    toast(page, message).filter({ has: page.locator('.text-on-danger-soft') }),
  ).toBeVisible();
}

/** Asserts a success toast (the check icon) reading exactly `message`. */
async function expectSuccessToast(page: Page, message: string): Promise<void> {
  await expect(
    toast(page, message).filter({ has: page.locator('.text-on-success-soft') }),
  ).toBeVisible();
}

/**
 * Dismisses the toast reading `message` and waits until it is gone. It may
 * expire on its own first, so the click is allowed to find nothing.
 */
async function dismissToast(page: Page, message: string): Promise<void> {
  await toast(page, message)
    .getByRole('button', { name: 'Dismiss notification' })
    .click({ timeout: 2_000 })
    .catch(() => undefined);
  await expect(toast(page, message)).toHaveCount(0);
}

const nameField = (page: Page) => page.getByLabel('Name', { exact: true });
const descriptionField = (page: Page) =>
  page.getByLabel('Description', { exact: true });
/** The Tiptap body editor (role textbox, named "Body"). */
const bodyEditor = (page: Page) =>
  page.getByRole('textbox', { name: 'Body', exact: true });

async function openNewSkill(page: Page): Promise<void> {
  await openLibrary(page);
  await page.getByTestId('skill-new').click();
  await expect(
    page.getByRole('heading', { name: 'New skill', exact: true }),
  ).toBeVisible();
  await expect(bodyEditor(page)).toBeVisible();
}

async function typeBody(page: Page, text: string): Promise<void> {
  await bodyEditor(page).click();
  await page.keyboard.type(text);
}

async function openSkill(page: Page, name: string): Promise<void> {
  await page.getByTestId(`skill-row-${name}`).click();
  await expect(
    page.getByRole('heading', { name: `Edit ${name}`, exact: true }),
  ).toBeVisible();
  await expect(bodyEditor(page)).toBeVisible();
}

async function openBuiltIn(page: Page, name: string): Promise<void> {
  await page.getByTestId(`builtin-skill-row-${name}`).click();
  await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
  await expect(page.getByTestId('builtin-skill-banner')).toBeVisible();
}

async function axeClean(page: Page): Promise<void> {
  await page.addScriptTag({ content: axe.source });
  for (const theme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: theme });
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    // Let the theme's colour transitions finish before axe reads colours.
    await page.waitForTimeout(500);
    const results = await page.evaluate(async () => {
      return (window as unknown as { axe: typeof axe }).axe.run(document);
    });
    expect(results.violations, theme).toEqual([]);
  }
}

test('creates, edits and deletes a skill', async ({ page }) => {
  await openLibrary(page);
  await expect(page.getByText(EMPTY_LIBRARY)).toBeVisible();

  await page.getByTestId('skill-new').click();
  await expect(
    page.getByRole('heading', { name: 'New skill', exact: true }),
  ).toBeVisible();
  await nameField(page).fill(FISCAL);
  await descriptionField(page).fill(FISCAL_DESCRIPTION);
  await typeBody(
    page,
    'Our fiscal year starts on 1 July. See references/quarters.md.',
  );
  await page.getByTestId('skill-save').click();
  await expectErrorToast(
    page,
    "The body names references/quarters.md, which this skill doesn't have",
  );

  await button(page, 'Add reference file').click();
  await page
    .getByLabel('Path of reference file 1', { exact: true })
    .fill('references/quarters.md');
  await page
    .getByLabel('Content of reference file 1', { exact: true })
    .fill('Q1 is July to September.');
  await page.getByTestId('skill-save').click();
  await expectSuccessToast(page, `Skill "${FISCAL}" created`);
  const preview = page.getByTestId('skill-catalog-preview');
  await expect(preview).toContainText(FISCAL);
  await expect(preview).toContainText(FISCAL_DESCRIPTION);

  await button(page, 'Back').click();
  const row = page.getByTestId(`skill-row-${FISCAL}`);
  await expect(row).toContainText(FISCAL);
  await expect(row).toContainText('Not used by any agent');
  await evidenceShot(page, '1.14.3', 'skill-library-list.png');

  await openSkill(page, FISCAL);
  const asked: string[] = [];
  page.once('dialog', (dialog) => {
    asked.push(dialog.message());
    void dialog.accept();
  });
  await page.getByTestId('skill-delete').click();
  await expectSuccessToast(page, `Skill "${FISCAL}" deleted`);
  expect(asked).toEqual([`Delete "${FISCAL}"?`]);
  await expect(page.getByText(EMPTY_LIBRARY)).toBeVisible();
});

test('refuses a bad name or description', async ({ page }) => {
  await openNewSkill(page);
  await nameField(page).fill('Fiscal Calendar');
  await descriptionField(page).fill(FISCAL_DESCRIPTION);
  await typeBody(page, 'Body');
  await page.getByTestId('skill-save').click();
  await expectErrorToast(
    page,
    'Use lowercase letters, digits and single hyphens in a skill name',
  );

  await nameField(page).fill('curated-knowledge');
  await page.getByTestId('skill-save').click();
  await expectErrorToast(
    page,
    '"curated-knowledge" is the name of a built-in skill',
  );

  await nameField(page).fill(FISCAL);
  await descriptionField(page).fill('Fiscal calendar rules.');
  await page.getByTestId('skill-save').click();
  await expectErrorToast(page, 'The description must start with "Use when"');
  // Nothing was created.
  const response = await page.request.get(new URL('/skills', page.url()).href);
  const body = (await response.json()) as { skills: unknown[] };
  expect(body.skills).toEqual([]);
});

test("a skill that an agent links can't be deleted or renamed", async ({
  page,
}) => {
  await createSkill(page, {
    name: FISCAL,
    description: FISCAL_DESCRIPTION,
    body: 'Our fiscal year starts on 1 July.',
  });
  await createUserAgent(page, {
    name: 'Finance helper',
    instructions: `Use [[skill:${FISCAL}]].`,
  });
  const refusal = `"${FISCAL}" is linked by Finance helper. Unlink it first.`;

  await openLibrary(page);
  await openSkill(page, FISCAL);
  page.once('dialog', (dialog) => void dialog.accept());
  await page.getByTestId('skill-delete').click();
  await expectErrorToast(page, refusal);
  await expect(
    page.getByRole('heading', { name: `Edit ${FISCAL}`, exact: true }),
  ).toBeVisible();

  await dismissToast(page, refusal);
  await nameField(page).fill('fiscal-rules');
  await page.getByTestId('skill-save').click();
  await expectErrorToast(page, refusal);

  // The skill keeps its name and still exists.
  const response = await page.request.get(new URL('/skills', page.url()).href);
  const body = (await response.json()) as { skills: { name: string }[] };
  expect(body.skills.map((skill) => skill.name)).toEqual([FISCAL]);
});

test('the skill editor links tools only', async ({ page }) => {
  await createSkill(page, {
    name: 'chart-style',
    description: 'Use when drawing a chart.',
    body: 'Draw one chart per answer.',
  });
  await openLibrary(page);
  await openSkill(page, 'chart-style');

  await expect(page.getByTestId('link-tool')).toHaveText('+ Link tool');
  await expect(page.getByTestId('link-skill')).toHaveCount(0);
  await expect(page.getByText('+ Link skill', { exact: true })).toHaveCount(0);

  // At the end of the body, on a line of its own ("/" opens the menu only at
  // the start of a line or after a space).
  await bodyEditor(page).click();
  await page.keyboard.press('Control+End');
  await page.keyboard.press('Enter');
  await page.keyboard.type('/');
  const menu = page.getByRole('listbox', { name: 'Tools', exact: true });
  await expect(menu).toBeVisible();
  await expect(menu.getByText('Tools', { exact: true })).toBeVisible();
  await expect(menu.getByText('Skills', { exact: true })).toHaveCount(0);
  await expect(menu.getByRole('option').first()).toBeVisible();
});

test('the library and the skill editor have no detectable accessibility violations in either theme', async ({
  page,
}) => {
  await createSkill(page, {
    name: FISCAL,
    description: FISCAL_DESCRIPTION,
    body: 'Our fiscal year starts on 1 July.',
  });
  await followOsTheme(page);
  await openLibrary(page);
  await expect(page.getByTestId(`skill-row-${FISCAL}`)).toBeVisible();
  await axeClean(page);

  await openSkill(page, FISCAL);
  await axeClean(page);
});

test.describe('built-in skills', () => {
  let stub: LlmStub;

  test.beforeEach(async ({ page }) => {
    stub = await startLlmStub();
    await seedWorldCupDataset(page);
    await saveLenaiSettings(page, stub.baseUrl);
  });

  test.afterEach(async () => {
    await stub.close();
  });

  test('I edit a built-in skill, and Reset restores it', async ({ page }) => {
    const edited =
      'Use when the turn carries curated knowledge: glossary, rules and filters.';
    const question = 'Who won in 2022?';

    await openLibrary(page);
    await expect(
      page.getByRole('heading', {
        name: 'Built-in · included in every agent',
        exact: true,
      }),
    ).toBeVisible();
    for (const name of [
      'curated-knowledge',
      'deep-analysis',
      'interactive-visuals',
    ]) {
      await expect(page.getByTestId(`builtin-skill-row-${name}`)).toBeVisible();
    }

    await openBuiltIn(page, 'curated-knowledge');
    await expect(page.getByTestId('builtin-skill-banner')).toContainText(
      BUILT_IN_BANNER,
    );
    await descriptionField(page).fill(edited);
    await page.getByTestId('builtin-skill-save').click();
    await expectSuccessToast(page, 'Built-in skill "curated-knowledge" saved');
    await button(page, 'Back').click();
    const row = page.getByTestId('builtin-skill-row-curated-knowledge');
    await expect(row).toContainText('Modified');
    await evidenceShot(page, '1.14.5', 'builtin-skill-modified.png');

    await createWorldCupSession(page);
    await page.getByPlaceholder('Ask a follow-up question…').fill(question);
    await page.getByRole('button', { name: 'Send message' }).click();
    await expect(page.getByText(STUB_ANSWER)).toBeVisible();
    const requests = turnRequests(stub, question);
    expect(
      requests.length,
      `a streamed call for "${question}"`,
    ).toBeGreaterThan(0);
    const catalog =
      systemTexts(requests[0])
        .join('\n')
        .match(/<available_skills>[\s\S]*?<\/available_skills>/)?.[0] ?? '';
    expect(catalog).toMatch(
      /<name>curated-knowledge<\/name>\s*<description>Use when the turn carries curated knowledge: glossary, rules and filters\.<\/description>/,
    );

    await openLibrary(page);
    await openBuiltIn(page, 'curated-knowledge');
    const asked: string[] = [];
    page.once('dialog', (dialog) => {
      asked.push(dialog.message());
      void dialog.accept();
    });
    await page.getByTestId('builtin-skill-reset').click();
    await expectSuccessToast(page, 'Built-in skill "curated-knowledge" reset');
    expect(asked).toEqual([
      'Reset "curated-knowledge" to the built-in version?',
    ]);
    await button(page, 'Back').click();
    await expect(
      page.getByTestId('builtin-skill-row-curated-knowledge'),
    ).not.toContainText('Modified');
  });

  test('an override that drops a placeholder is refused', async ({ page }) => {
    await openLibrary(page);
    await openBuiltIn(page, 'deep-analysis');

    const plan = page.getByLabel('Content of phases/1-plan.md', {
      exact: true,
    });
    const original = await plan.inputValue();
    expect(original).toContain('{{');
    await plan.fill(original.replace(/\{\{[^}]*\}\}/g, ''));
    await page.getByTestId('builtin-skill-save').click();
    const error = notifications(page)
      .locator('div')
      .filter({ hasText: /^phases\/1-plan\.md must use the placeholders/ })
      .filter({ has: page.locator('.text-on-danger-soft') });
    await expect(error).toBeVisible();

    // Leaving discards the unsaved edit.
    page.once('dialog', (dialog) => void dialog.accept());
    await button(page, 'Back').click();
    await expect(
      page.getByTestId('builtin-skill-row-deep-analysis'),
    ).toBeVisible();
    await expect(
      page.getByTestId('builtin-skill-row-deep-analysis'),
    ).not.toContainText('Modified');
  });
});
