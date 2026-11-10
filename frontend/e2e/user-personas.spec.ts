import type { Page } from '@playwright/test';
import { expect, test } from './fixtures/app.fixture';
import { scenarioStep } from './support/demo-captions';

const DEMO = 'Demo Finance Analyst';
const ANA = 'Ana, finance analyst';

const railItem = (page: Page, name: string) =>
  page
    .getByRole('complementary', { name: 'Navigation rail' })
    .getByRole('button', { name, exact: true });

const rows = (page: Page) => page.locator('[data-testid^="persona-row-"]');
const rowOf = (page: Page, name: string) =>
  rows(page).filter({ hasText: name });
const editOf = (page: Page, name: string) =>
  rowOf(page, name).locator('[data-testid^="persona-edit-"]');

async function openSection(page: Page): Promise<void> {
  await railItem(page, 'Context').click();
  await page.getByTestId('context-section-personas').click();
  await expect(
    page.getByRole('heading', { name: 'User personas' }),
  ).toBeVisible();
}

/** Deletes the persona called `name`, accepting the confirmation. */
async function deleteRow(page: Page, name: string): Promise<void> {
  const row = rowOf(page, name);
  const id = (await row.getAttribute('data-testid'))!.replace(
    'persona-row-',
    '',
  );
  page.once('dialog', (dialog) => void dialog.accept());
  await page.getByTestId(`persona-delete-${id}`).click();
  await expect(rowOf(page, name)).toHaveCount(0);
}

async function fillAna(page: Page): Promise<void> {
  await page.getByTestId('persona-new').click();
  await page.getByTestId('persona-name').fill(ANA);
  await page.getByTestId('persona-role').fill('Finance analyst');
  await page.getByTestId('persona-description').fill('Builds the monthly pack.');
  await page.getByTestId('persona-goals').fill('Explain variances fast.');
  await page.getByTestId('persona-question-add').click();
  await page.getByTestId('persona-question-0').fill('What drove revenue?');
  await page.getByTestId('persona-question-add').click();
  await page.getByTestId('persona-question-1').fill('Where is spend over plan?');
  await page.getByTestId('persona-expertise').selectOption('expert');
  await page.getByTestId('persona-answer-style').fill('Headline number first.');
}

test.describe('Feature: User personas', () => {
  test('Open the section from the Context page', async ({ page }) => {
    await test.step('Given I am on the Context page', async () => {
      await railItem(page, 'Context').click();
      await expect(
        page.getByRole('heading', { name: 'Context' }),
      ).toBeVisible();
    });
    await test.step('When I click the "User personas" card', async () => {
      await page.getByTestId('context-section-personas').click();
    });
    await test.step('Then I see the section and Context is still current', async () => {
      await expect(
        page.getByRole('heading', { name: 'User personas' }),
      ).toBeVisible();
      await expect(railItem(page, 'Context')).toHaveAttribute(
        'aria-current',
        'page',
      );
    });
    await test.step('When I click the Context back control', async () => {
      await page.getByTestId('context-back').click();
    });
    await test.step('Then I see the Context page with its cards', async () => {
      await expect(page.getByTestId('context-section-personas')).toBeVisible();
      await expect(
        page.getByRole('heading', { name: 'User personas' }),
      ).toHaveCount(0);
    });
  });

  // The story's main scenario: `scripts/qa.mjs 1.21.6 --fast` records it as
  // evidence/1.21.6/demo.webm, captioned with these Gherkin lines.
  test(
    'A new install starts with the demo persona',
    { tag: ['@demo', '@story-1.21.6'] },
    async ({ page }) => {
    await scenarioStep(page, 'When I open the "User personas" section', async () => {
      await openSection(page);
    });
    await scenarioStep(page, 'Then I see "Demo Finance Analyst" with role "FP&A analyst" and the chip "Intermediate"', async () => {
      await expect(rows(page)).toHaveCount(1);
      const row = rowOf(page, DEMO);
      await expect(row).toBeVisible();
      await expect(row).toContainText('FP&A analyst');
      await expect(row.getByTestId('persona-expertise-chip')).toHaveText(
        'Intermediate',
      );
    });
    await scenarioStep(page, 'And editing it shows every field filled in', async () => {
      await editOf(page, DEMO).click();
      await expect(page.getByTestId('persona-name')).toHaveValue(DEMO);
      await expect(page.getByTestId('persona-role')).toHaveValue('FP&A analyst');
      await expect(page.getByTestId('persona-description')).not.toHaveValue('');
      await expect(page.getByTestId('persona-goals')).not.toHaveValue('');
      await expect(page.getByTestId('persona-answer-style')).not.toHaveValue('');
      await expect(page.getByTestId('persona-expertise')).toHaveValue(
        'intermediate',
      );
      for (let i = 0; i < 5; i++) {
        await expect(page.getByTestId(`persona-question-${i}`)).not.toHaveValue(
          '',
        );
      }
      await expect(page.getByTestId('persona-question-5')).toHaveCount(0);
    });
    },
  );

  test('A deleted demo persona does not come back', async ({ app, page }) => {
    await test.step('Given I deleted the demo persona', async () => {
      await openSection(page);
      await deleteRow(page, DEMO);
    });
    await test.step('When the app restarts', async () => {
      await app.restartCli();
    });
    await test.step('Then it is not listed', async () => {
      await openSection(page);
      await expect(page.getByTestId('personas-empty')).toBeVisible();
      await expect(rowOf(page, DEMO)).toHaveCount(0);
    });
  });

  test('The empty library invites the first persona', async ({ page }) => {
    await test.step('Given no personas exist', async () => {
      await openSection(page);
      await deleteRow(page, DEMO);
    });
    await test.step('When I open the section, I see "No personas yet" and "New persona"', async () => {
      await expect(page.getByTestId('personas-empty')).toContainText(
        'No personas yet',
      );
      await expect(page.getByTestId('persona-new')).toBeVisible();
      await expect(
        page
          .getByTestId('personas-empty')
          .getByRole('button', { name: 'New persona' }),
      ).toBeVisible();
    });
  });

  test('Create a persona with every field', async ({ app, page }) => {
    await openSection(page);
    await test.step('When I fill every field and choose Expert', async () => {
      await fillAna(page);
    });
    await test.step('And I save', async () => {
      await page.getByTestId('persona-save').click();
    });
    await test.step('Then it is listed with its role and chip', async () => {
      const row = rowOf(page, ANA);
      await expect(row).toBeVisible();
      await expect(row).toContainText('Finance analyst');
      await expect(row.getByTestId('persona-expertise-chip')).toHaveText(
        'Expert',
      );
    });
    await test.step('And it is still listed after the app restarts', async () => {
      await app.restartCli();
      await openSection(page);
      await expect(rowOf(page, ANA)).toBeVisible();
      await editOf(page, ANA).click();
      await expect(page.getByTestId('persona-question-1')).toHaveValue(
        'Where is spend over plan?',
      );
      await expect(page.getByTestId('persona-expertise')).toHaveValue('expert');
    });
  });

  test('Blank name keeps Save disabled', async ({ page }) => {
    await openSection(page);
    await test.step('Given the persona editor is open', async () => {
      await page.getByTestId('persona-new').click();
      await expect(page.getByTestId('persona-form')).toBeVisible();
    });
    await test.step('When Name is empty or only spaces, Save is disabled', async () => {
      await expect(page.getByTestId('persona-name')).toHaveValue('');
      await expect(page.getByTestId('persona-save')).toBeDisabled();
      await page.getByTestId('persona-name').fill('   ');
      await expect(page.getByTestId('persona-save')).toBeDisabled();
    });
    await test.step('Then a real name enables Save', async () => {
      await page.getByTestId('persona-name').fill('Someone');
      await expect(page.getByTestId('persona-save')).toBeEnabled();
    });
  });

  test('Edit a persona', async ({ page }) => {
    await openSection(page);
    await test.step('Given a persona "Ana, finance analyst" exists', async () => {
      await fillAna(page);
      await page.getByTestId('persona-save').click();
      await expect(rowOf(page, ANA)).toBeVisible();
    });
    await test.step('When I change Role to "Controller" and save', async () => {
      await editOf(page, ANA).click();
      await page.getByTestId('persona-role').fill('Controller');
      await page.getByTestId('persona-save').click();
    });
    await test.step('Then the list shows the new role', async () => {
      await expect(rowOf(page, ANA)).toContainText('Controller');
      await expect(rowOf(page, ANA)).not.toContainText('Finance analyst');
    });
    await test.step('And its other fields are unchanged', async () => {
      await editOf(page, ANA).click();
      await expect(page.getByTestId('persona-name')).toHaveValue(ANA);
      await expect(page.getByTestId('persona-description')).toHaveValue(
        'Builds the monthly pack.',
      );
      await expect(page.getByTestId('persona-goals')).toHaveValue(
        'Explain variances fast.',
      );
      await expect(page.getByTestId('persona-question-0')).toHaveValue(
        'What drove revenue?',
      );
      await expect(page.getByTestId('persona-question-1')).toHaveValue(
        'Where is spend over plan?',
      );
      await expect(page.getByTestId('persona-expertise')).toHaveValue('expert');
      await expect(page.getByTestId('persona-answer-style')).toHaveValue(
        'Headline number first.',
      );
    });
  });

  test('Delete a persona after confirmation', async ({ page }) => {
    await openSection(page);
    await test.step('Given a persona "Ana, finance analyst" exists', async () => {
      await fillAna(page);
      await page.getByTestId('persona-save').click();
      await expect(rowOf(page, ANA)).toBeVisible();
    });
    const id = (await rowOf(page, ANA).getAttribute('data-testid'))!.replace(
      'persona-row-',
      '',
    );
    await test.step('When I dismiss the confirmation, nothing is deleted', async () => {
      page.once('dialog', (dialog) => {
        expect(dialog.message()).toBe(`Delete persona "${ANA}"?`);
        void dialog.dismiss();
      });
      await page.getByTestId(`persona-delete-${id}`).click();
      await expect(rowOf(page, ANA)).toBeVisible();
    });
    await test.step('And I confirm the deletion', async () => {
      page.once('dialog', (dialog) => {
        expect(dialog.message()).toBe(`Delete persona "${ANA}"?`);
        void dialog.accept();
      });
      await page.getByTestId(`persona-delete-${id}`).click();
    });
    await test.step('Then the persona is no longer listed', async () => {
      await expect(rowOf(page, ANA)).toHaveCount(0);
      await expect(rowOf(page, DEMO)).toBeVisible();
    });
  });

  test('A duplicate name is refused', async ({ page }) => {
    const duplicate = 'ana, FINANCE analyst';
    await openSection(page);
    await test.step('Given a persona "Ana, finance analyst" exists', async () => {
      await page.getByTestId('persona-new').click();
      await page.getByTestId('persona-name').fill(ANA);
      await page.getByTestId('persona-save').click();
      await expect(rowOf(page, ANA)).toBeVisible();
    });
    await test.step('When I create "ana, FINANCE analyst" and save', async () => {
      await page.getByTestId('persona-new').click();
      await page.getByTestId('persona-name').fill(duplicate);
      await page.getByTestId('persona-save').click();
    });
    await test.step('Then the editor shows the message', async () => {
      await expect(page.getByTestId('persona-error')).toHaveText(
        `A persona named "${duplicate}" already exists`,
      );
      await expect(page.getByTestId('persona-form')).toBeVisible();
    });
    await test.step('And no second persona is listed', async () => {
      await page.getByTestId('persona-cancel').click();
      await expect(rowOf(page, ANA)).toHaveCount(1);
      await expect(rows(page)).toHaveCount(2); // demo + Ana
    });
  });
});
