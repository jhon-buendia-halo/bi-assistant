import { expect, type Locator, type Page } from '@playwright/test';
import { ASK_WORKFLOW_ID, ASK_WORKFLOW_NAME } from './runs-api';

/**
 * The run chat of a workflow page (workflows R21, ui.md 4.4b), driven from
 * the UI: the composer (a message fills the prompt), its `+` menu (the other
 * inputs and the options), the agent's asks for what is still missing, for
 * specs that check how a run renders (not only what reaches the model, which
 * `runs-api.ts` covers).
 */

export function railItem(page: Page, name: string): Locator {
  return page
    .getByRole('complementary', { name: 'Navigation rail' })
    .getByRole('button', { name, exact: true });
}

export async function openWorkflowPage(
  page: Page,
  id: string,
  name: string,
): Promise<void> {
  await railItem(page, 'Workflows').click();
  await expect(
    page.getByRole('heading', { name: 'Workflows', exact: true }),
  ).toBeVisible();
  await page.getByTestId(`workflow-${id}`).click();
  await expect(page.getByTestId('workflow-detail-name')).toHaveText(name);
}

/** Run workflow: the Run panel unfolds with the composer. */
export async function openRunTab(page: Page): Promise<void> {
  await page.getByTestId('workflow-execute').click();
  await expect(composer(page)).toBeVisible();
}

// ------------------------------------------------------------ the composer

/** The composer's text box: what is typed fills the workflow's prompt. */
export function composer(page: Page): Locator {
  return page.getByTestId('run-composer-input');
}

/** The composer's Send (icon only, `aria-label="Send"`). */
export function sendButton(page: Page): Locator {
  return page.getByTestId('run-composer-send');
}

/** The inputs and options menu behind `+`. */
export function composerMenu(page: Page): Locator {
  return page.getByTestId('run-composer-menu');
}

/** Opens the `+` menu; does nothing when it is open already. */
export async function openComposerMenu(page: Page): Promise<void> {
  const plus = page.getByTestId('run-composer-plus');
  await expect(plus).toBeVisible();
  if ((await plus.getAttribute('aria-expanded')) !== 'true') {
    await plus.click();
  }
  await expect(plus).toHaveAttribute('aria-expanded', 'true');
  await expect(composerMenu(page)).toBeVisible();
}

/** Closes the `+` menu with Escape (its backdrop covers the composer while open). */
export async function closeComposerMenu(page: Page): Promise<void> {
  await page.keyboard.press('Escape');
  await expect(composerMenu(page)).toBeHidden();
}

/**
 * Unfolds the menu's ADD row of `field` (opening the menu first); does
 * nothing when it is unfolded already.
 */
export async function unfoldMenuItem(page: Page, field: string): Promise<Locator> {
  await openComposerMenu(page);
  const row = page.getByTestId(`run-composer-menu-item-${field}`);
  await expect(row).toBeVisible();
  if ((await row.getAttribute('aria-expanded')) !== 'true') {
    await row.click();
  }
  await expect(row).toHaveAttribute('aria-expanded', 'true');
  return row;
}

/**
 * Adds a dataset through the `+` menu: unfolds `field` (`datasets`, or a
 * single `dataset`) and clicks its card's Add unless it is added already.
 * Leaves the menu open.
 */
export async function pickDataset(
  page: Page,
  name: string,
  field = 'datasets',
): Promise<void> {
  await unfoldMenuItem(page, field);
  const option = page.getByTestId(`run-composer-option-${field}-${name}`);
  await expect(option).toBeVisible();
  if ((await option.getAttribute('aria-pressed')) !== 'true') {
    await option.click();
  }
  await expect(option).toHaveAttribute('aria-pressed', 'true');
}

/** An added dataset's chip above the composer: there only while it is added. */
export function pickedDataset(
  page: Page,
  name: string,
  field = 'datasets',
): Locator {
  return page.getByTestId(`run-composer-chip-${field}`).filter({
    has: page.getByRole('button', { name: `Remove ${name}`, exact: true }),
  });
}

/**
 * Fills a text or number input of the `+` menu (`maxPages`, a prompt with a
 * default such as readiness's `question`…), then closes the menu.
 */
export async function setRunField(
  page: Page,
  name: string,
  value: string,
): Promise<void> {
  await unfoldMenuItem(page, name);
  await composerMenu(page).getByTestId(`workflow-input-${name}`).fill(value);
  await closeComposerMenu(page);
}

/** Sets an option switch of the `+` menu (a workflow's yes/no input), then closes the menu. */
export async function setRunOption(
  page: Page,
  name: string,
  on: boolean,
): Promise<void> {
  await openComposerMenu(page);
  const option = page.getByTestId(`workflow-input-${name}`);
  await expect(option).toHaveAttribute('role', 'switch');
  await option.setChecked(on);
  await closeComposerMenu(page);
}

/**
 * Adds the dataset (when given) through `+` (the menu is closed again) and
 * types the question in the composer. Does not send.
 */
export async function fillRun(
  page: Page,
  question: string,
  dataset?: string,
): Promise<void> {
  if (dataset !== undefined) {
    await pickDataset(page, dataset);
    await closeComposerMenu(page);
  }
  await composer(page).fill(question);
}

/** Clicks Send. */
export async function sendRun(page: Page): Promise<void> {
  await expect(sendButton(page)).toBeEnabled();
  await sendButton(page).click();
}

/**
 * Answers the agent's ask for `field` with the named choices: for
 * `datasets` adds each card then clicks Continue; a single pick (`dataset`,
 * `artifact`, by its value id) continues on its click.
 */
export async function answerPickAsk(
  page: Page,
  names: string | readonly string[],
  field = 'datasets',
): Promise<void> {
  const ask = page.getByTestId(`run-intake-${field}`);
  await expect(ask).toBeVisible();
  const list = typeof names === 'string' ? [names] : names;
  for (const name of list) {
    const option = ask.getByTestId(`run-intake-option-${field}-${name}`);
    await option.click();
    if (field === 'datasets') {
      await expect(option).toHaveAttribute('aria-pressed', 'true');
    }
  }
  if (field !== 'datasets') return;
  const next = ask.getByTestId('run-intake-continue');
  await expect(next).toHaveText(
    `Continue with ${list.length} dataset${list.length === 1 ? '' : 's'}`,
  );
  await next.click();
}

/** Opens Answer a Business Question (Avery + Michael)'s Run tab, fills it and clicks Send. */
export async function runQuestionInTab(
  page: Page,
  question: string,
  dataset: string,
): Promise<void> {
  await openWorkflowPage(page, ASK_WORKFLOW_ID, ASK_WORKFLOW_NAME);
  await openRunTab(page);
  await fillRun(page, question, dataset);
  await sendRun(page);
}

export function runAnswer(page: Page): Locator {
  return page.getByTestId('run-answer');
}

// ------------------------------------------------------------ the agent editor

/** Picks a dataset in the agent editor's dataset picker held by `field` (search, tick, Done). */
export async function pickDatasetIn(field: Locator, name: string): Promise<void> {
  const page = field.page();
  await field.getByTestId('dataset-picker-open').click();
  await field.getByTestId('dataset-picker-search').fill(name);
  const exactName = new RegExp(
    `^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`,
  );
  await field
    .getByRole('option')
    .filter({ has: page.locator('.picker-label', { hasText: exactName }) })
    .click();
  await field.getByTestId('dataset-picker-done').click();
  await expect(
    field.getByRole('button', { name: `Remove ${name}`, exact: true }),
  ).toBeVisible();
}

/** A promise a test resolves by hand, to hold a model call open. */
export function gate(): { promise: Promise<void>; release: () => void } {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => (release = resolve));
  return { promise, release };
}
