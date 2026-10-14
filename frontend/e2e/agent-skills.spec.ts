import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { Locator, Page } from '@playwright/test';
import { test, expect } from './fixtures/app.fixture';

/**
 * Mirrors the Feature "Agent skills" in specs/capabilities/agents-evals/spec.md
 * (R63-R67). User and project skills are folders written before the app
 * starts, because the backend reads skills once at startup (agents.md 7.3).
 */

const PROJECT_VARIABLE = 'QUESTIONS_TO_INSIGHTS_PROJECT_SKILLS_DIR';

/** Writes `files` (path → text) under `<root>/<name>/`. */
function writeSkill(
  root: string,
  name: string,
  files: Record<string, string>,
): void {
  for (const [file, text] of Object.entries(files)) {
    const target = path.join(root, name, file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, text);
  }
}

function skillMd(name: string, description: string | null, body: string) {
  return [
    '---',
    `name: ${name}`,
    ...(description === null ? [] : [`description: ${description}`]),
    '---',
    '',
    body,
    '',
  ].join('\n');
}

async function openAgent(page: Page, key: string): Promise<void> {
  await page.getByRole('button', { name: 'Agents' }).click();
  const showMore = page.getByTestId('agent-show-more-system');
  if (key !== 'assistant' && (await showMore.isVisible())) {
    await showMore.click();
  }
  await page.getByTestId(`agent-${key}`).click();
}

async function openSkillsTab(page: Page): Promise<Locator> {
  await page.getByTestId('agent-tab-skills').click();
  await expect(page.getByText('Loading skills…')).toHaveCount(0);
  await expect(
    page.getByText(
      'Skills are read when the app starts. Restart the app to pick up changes.',
    ),
  ).toBeVisible();
  return page.getByTestId('agent-tab-skills');
}

function skill(page: Page, name: string): Locator {
  return page.getByTestId(`agent-skill-${name}`);
}

test('shows the designer built-in skill and the content of its files', async ({
  appDataDir,
  launchApp,
}) => {
  const { page } = await launchApp(appDataDir, {
    [PROJECT_VARIABLE]: undefined,
  });
  await openAgent(page, 'visualization');
  const tab = await openSkillsTab(page);

  await expect(tab).toHaveText('Skills (1)');
  const visuals = skill(page, 'interactive-visuals');
  await expect(visuals).toContainText('Built-in');
  await expect(visuals).toContainText('Loaded by the app');
  await expect(page.getByTestId('skill-level-built-in')).toContainText(
    'Ships with the app',
  );
  await expect(page.getByTestId('skill-level-user')).toContainText(
    `${path.join(appDataDir, 'skills')} (not found)`,
  );
  await expect(page.getByTestId('skill-level-project')).toContainText(
    `Not set (${PROJECT_VARIABLE})`,
  );

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

test('an agent without skills says so', async ({ appDataDir, launchApp }) => {
  const { page } = await launchApp(appDataDir);
  await openAgent(page, 'sql-fixer');
  const tab = await openSkillsTab(page);

  await expect(tab).toHaveText('Skills (0)');
  await expect(page.getByText('This agent has no skills.')).toBeVisible();
});

test('a user skill and a project override reach the assistant', async ({
  appDataDir,
  launchApp,
}) => {
  const userSkills = path.join(appDataDir, 'skills');
  const projectSkills = fs.mkdtempSync(
    path.join(os.tmpdir(), 'qti-e2e-project-skills-'),
  );
  try {
    writeSkill(userSkills, 'sql-style', {
      'SKILL.md': skillMd(
        'sql-style',
        'Use when writing SQL for the World Cup data.',
        'Prefer CTEs. The style rules are in reference/style.md.',
      ),
      'reference/style.md': '# Style\n\nOne clause per line.\n',
    });
    writeSkill(userSkills, 'curated-knowledge', {
      'SKILL.md': skillMd(
        'curated-knowledge',
        'Use when the turn carries a curated dataset knowledge block.',
        'Curated knowledge (user override): follow the glossary first.',
      ),
    });
    writeSkill(projectSkills, 'curated-knowledge', {
      'SKILL.md': skillMd(
        'curated-knowledge',
        'Use when the turn carries a curated dataset knowledge block.',
        'Curated knowledge (project override): follow the glossary first.',
      ),
    });

    const { page } = await launchApp(appDataDir, {
      [PROJECT_VARIABLE]: projectSkills,
    });
    await openAgent(page, 'assistant');
    const tab = await openSkillsTab(page);

    await expect(tab).toHaveText('Skills (3)');
    const style = skill(page, 'sql-style');
    await expect(style).toContainText('User');
    await expect(style).toContainText('On demand');
    await expect(style).toContainText(
      'Use when writing SQL for the World Cup data.',
    );

    const knowledge = skill(page, 'curated-knowledge');
    await expect(knowledge).toContainText('Project');
    await expect(knowledge).toContainText('Loaded by the app');
    await expect(knowledge).toContainText('Overrides built-in and user');
    await knowledge.getByRole('button', { name: /curated-knowledge/ }).click();
    await expect(knowledge.locator('pre')).toContainText(
      'Curated knowledge (project override)',
    );

    const deep = skill(page, 'deep-analysis');
    await expect(deep).toContainText('Built-in');
    await expect(deep).toContainText('Loaded by the app');

    await expect(page.getByTestId('skill-level-project')).toContainText(
      projectSkills,
    );
    await expect(page.getByTestId('skill-level-project')).not.toContainText(
      'not found',
    );
  } finally {
    fs.rmSync(projectSkills, { recursive: true, force: true });
  }
});

test('a broken user skill is skipped and says why', async ({
  appDataDir,
  launchApp,
}) => {
  writeSkill(path.join(appDataDir, 'skills'), 'broken', {
    'SKILL.md': skillMd('broken', null, 'No description above.'),
  });

  const { page } = await launchApp(appDataDir);
  await openAgent(page, 'assistant');
  const tab = await openSkillsTab(page);

  await expect(tab).toHaveText('Skills (2)');
  await expect(page.getByText('Skipped', { exact: true })).toBeVisible();
  const skipped = page.getByTestId('skipped-skill-broken');
  await expect(skipped).toContainText('User');
  await expect(skipped).toContainText('description is missing');
  await expect(skill(page, 'broken')).toHaveCount(0);
});
