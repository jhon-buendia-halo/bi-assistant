import * as fs from 'fs';
import * as path from 'path';
import type { Locator, Page } from '@playwright/test';
import { test, expect } from './fixtures/app.fixture';

/**
 * Mirrors the Feature "Agent skills" in specs/capabilities/agents-evals/spec.md
 * (R63-R67). Skills ship only with the app; the old-folder scenario writes a
 * skills folder into the data dir before the app starts (agents.md 7.3).
 */

async function openAgent(page: Page, key: string): Promise<void> {
  await page.getByRole('button', { name: 'Agents' }).click();
  // The System section shows its first row until "Show more" (agents-evals R3).
  if (key !== 'assistant') {
    await page.getByTestId('agent-show-more-system').click();
  }
  await page.getByTestId(`agent-${key}`).click();
}

async function openSkillsTab(page: Page): Promise<Locator> {
  await page.getByTestId('agent-tab-skills').click();
  await expect(page.getByText('Loading skills…')).toHaveCount(0);
  // The tab shows either its skill rows or the empty state once loaded.
  await expect(
    page
      .locator('[data-testid^="agent-skill-"]')
      .or(page.getByText('This agent has no skills.'))
      .first(),
  ).toBeVisible();
  return page.getByTestId('agent-tab-skills');
}

function skill(page: Page, name: string): Locator {
  return page.getByTestId(`agent-skill-${name}`);
}

test("shows the designer's built-in skill and the content of its files", async ({
  app: { page },
}) => {
  await openAgent(page, 'visualization');
  const tab = await openSkillsTab(page);

  await expect(tab).toHaveText('Skills (1)');
  const visuals = skill(page, 'interactive-visuals');
  await expect(visuals).toContainText('Loaded by the app');
  await expect(page.getByText('Where skills come from')).toHaveCount(0);

  await visuals.getByRole('button', { name: /interactive-visuals/ }).click();
  for (const file of [
    'SKILL.md',
    'reference/freeform.md',
    'reference/spec-mode.md',
  ]) {
    await expect(page.getByTestId(`skill-file-${file}`)).toBeVisible();
  }
  const content = visuals.locator('pre');
  await expect(content).toContainText('name: interactive-visuals');

  await page.getByTestId('skill-file-reference/spec-mode.md').click();
  await expect(content).toContainText('## The spec');
  await expect(content).not.toContainText('name: interactive-visuals');
});

test('an agent without skills says so', async ({ app: { page } }) => {
  await openAgent(page, 'sql-fixer');
  const tab = await openSkillsTab(page);

  await expect(tab).toHaveText('Skills (0)');
  await expect(page.getByText('This agent has no skills.')).toBeVisible();
});

test('the assistant gets only its built-in skills, and an old skills folder is ignored', async ({
  appDataDir,
  launchApp,
}) => {
  // Given the data dir holds a skills folder from an older version.
  const oldSkill = path.join(appDataDir, 'skills', 'sql-style', 'SKILL.md');
  fs.mkdirSync(path.dirname(oldSkill), { recursive: true });
  fs.writeFileSync(
    oldSkill,
    [
      '---',
      'name: sql-style',
      'description: Use when writing SQL for the World Cup data.',
      '---',
      '',
      'Prefer CTEs and one clause per line.',
      '',
    ].join('\n'),
  );

  const { page } = await launchApp(appDataDir);
  await openAgent(page, 'assistant');
  const tab = await openSkillsTab(page);

  await expect(tab).toHaveText('Skills (2)');
  // On demand since ADR-0020: the model reads it from the catalog.
  await expect(skill(page, 'curated-knowledge')).toContainText('On demand');
  await expect(skill(page, 'deep-analysis')).toContainText('Loaded by the app');
  await expect(skill(page, 'sql-style')).toHaveCount(0);
  await expect(page.getByText('sql-style')).toHaveCount(0);
});
