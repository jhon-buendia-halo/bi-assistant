import { expect, type Locator, type Page } from '@playwright/test';

/**
 * The Run tab of a workflow page (workflows R21), driven from the UI: the
 * same controls `workflow-runs.spec.ts` uses, for specs that check how a run
 * renders (not only what reaches the model, which `runs-api.ts` covers).
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

export async function openRunTab(page: Page): Promise<void> {
  await page.getByTestId('workflow-execute').click();
  await expect(page.getByTestId('workflow-run')).toBeVisible();
}

export function datasetCard(page: Page, name: string): Locator {
  return page
    .getByTestId('workflow-input-datasets')
    .getByRole('button', { name });
}

/** Types the question (and picks the dataset, when given) in the Run tab. */
export async function fillRun(
  page: Page,
  question: string,
  dataset?: string,
): Promise<void> {
  if (dataset !== undefined) {
    await datasetCard(page, dataset).click();
    await expect(datasetCard(page, dataset)).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  }
  await page.getByTestId('workflow-input-question').fill(question);
}

/** Opens the Assistant's Run tab, fills it and clicks Execute. */
export async function runAssistantInTab(
  page: Page,
  question: string,
  dataset: string,
): Promise<void> {
  await openWorkflowPage(page, 'agent:assistant', 'Assistant');
  await openRunTab(page);
  await fillRun(page, question, dataset);
  await page.getByTestId('workflow-run').click();
}

export function runAnswer(page: Page): Locator {
  return page.getByTestId('run-answer');
}

/** A promise a test resolves by hand, to hold a model call open. */
export function gate(): { promise: Promise<void>; release: () => void } {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => (release = resolve));
  return { promise, release };
}
