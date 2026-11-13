import axe from 'axe-core';
import type { Locator, Page } from '@playwright/test';
import { test, expect } from './fixtures/app.fixture';
import { scenarioStep } from './support/demo-captions';
import { WORLD_CUP_DATASET, followOsTheme } from './helpers/app-actions';
import { apiJson } from './helpers/api';
import {
  createUserAgent,
  publishAgent,
  saveAgentDraft,
  seedWorldCupDataset,
} from './helpers/agents-api';

/** Mirrors the Feature "Agent Hub" in specs/capabilities/agents-evals/spec.md. */

const ASSISTANT = 'Questions to Insights Assistant';
/** Questions to Insights v2 (agents-evals R107, BA-320). */
const V2 = 'Questions to Insights v2';
const V2_KEY = 'assistant-v2';
const V2_DESCRIPTION =
  'A business data analyst: answers questions over the datasets you pick with read-only SQL, checks its results and explains how it got them.';
const V2_TOOLS = [
  'list_entities',
  'describe_entity',
  'sample_rows',
  'run_readonly_sql',
  'ask_clarification',
];
/** Its built-in skills, on demand (agents.md 7.4), sorted by name. */
const V2_SKILLS = ['curated-knowledge', 'result-validation', 'sql-analysis'];
/**
 * The Official cards in hub order, alphabetical by name ("Data Readiness
 * Agent", "Questions to Insights Assistant", "Questions to Insights v2";
 * agents-evals R1, R107).
 */
const OFFICIAL_KEYS = ['data-readiness', 'assistant', V2_KEY];
const HEALTH = 'Health plan analyst';
const HEALTH_DESCRIPTION = 'Answers questions about the 2026 health plan';
const CLAIMS = 'Claims triage';
const CLAIMS_DESCRIPTION = 'Sorts incoming claims by urgency';

/** Ids of the Background's user agents (a user agent's key is its id). */
let healthId = '';
let claimsId = '';

test.beforeEach(async ({ page }) => {
  // Background
  await seedWorldCupDataset(page);
  healthId = await createUserAgent(page, {
    name: HEALTH,
    description: HEALTH_DESCRIPTION,
    datasets: [WORLD_CUP_DATASET],
  });
  await publishAgent(page, healthId);
  claimsId = await createUserAgent(page, {
    name: CLAIMS,
    description: CLAIMS_DESCRIPTION,
  });
});

async function openHub(page: Page): Promise<void> {
  await page
    .getByRole('complementary', { name: 'Navigation rail' })
    .getByRole('button', { name: 'Agents', exact: true })
    .click();
  await expect(
    page.getByRole('heading', { name: 'Agents', exact: true }),
  ).toBeVisible();
}

function section(page: Page, id: string): Locator {
  return page.getByTestId(`agent-section-${id}`);
}

function cards(scope: Page | Locator): Locator {
  return scope.locator('[data-testid^="agent-card-"]');
}

/** The keys of the cards in `scope`, in the order they are shown. */
async function cardKeys(scope: Page | Locator): Promise<string[]> {
  const ids = await cards(scope).evaluateAll((elements) =>
    elements.map((element) => element.getAttribute('data-testid') ?? ''),
  );
  return ids.map((id) => id.slice('agent-card-'.length));
}

async function sectionIds(page: Page): Promise<string[]> {
  const ids = await page
    .locator('[data-testid^="agent-section-"]')
    .evaluateAll((elements) =>
      elements.map((element) => element.getAttribute('data-testid') ?? ''),
    );
  return ids.map((id) => id.slice('agent-section-'.length));
}

function filter(page: Page, name: string): Locator {
  return page
    .getByRole('group', { name: 'Filter agents' })
    .getByRole('button', { name, exact: true });
}

function search(page: Page): Locator {
  return page.getByLabel('Search agents by name or description', {
    exact: true,
  });
}

async function openAgent(page: Page, key: string, name: string) {
  await page.getByTestId(`agent-${key}`).click();
  await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
}

function button(page: Page, name: string): Locator {
  return page.getByRole('button', { name, exact: true });
}

test('shows the built-in agents and mine in sections', async ({ page }) => {
  await openHub(page);

  await expect(section(page, 'system')).toBeVisible();
  expect(await sectionIds(page)).toEqual(['official', 'mine', 'system']);
  await expect(section(page, 'pinned')).toHaveCount(0);
  await expect(button(page, 'New agent')).toBeEnabled();

  const official = section(page, 'official');
  await expect(
    official.getByRole('heading', { name: 'Official' }),
  ).toBeVisible();
  await expect(official.getByTestId('agent-card-assistant')).toContainText(
    ASSISTANT,
  );
  await expect(official.getByTestId('agent-card-assistant')).toContainText(
    'Owner: Official',
  );
  await expect(cards(official)).toHaveCount(OFFICIAL_KEYS.length);
  expect(await cardKeys(official)).toEqual(OFFICIAL_KEYS);
  await expect(page.getByTestId('agent-show-more-official')).toHaveCount(0);

  const mine = section(page, 'mine');
  await expect(mine.getByTestId(`agent-card-${healthId}`)).toContainText(
    HEALTH,
  );
  await expect(mine.getByTestId(`agent-card-${healthId}`)).toContainText(
    'Owner: You',
  );
  await expect(mine.getByTestId(`agent-status-${healthId}`)).toHaveText('Live');
  await expect(mine.getByTestId(`agent-card-${claimsId}`)).toContainText(
    CLAIMS,
  );
  await expect(mine.getByTestId(`agent-status-${claimsId}`)).toHaveText(
    'Draft',
  );

  const system = section(page, 'system');
  await expect(cards(system)).toHaveCount(3);
  const showMore = system.getByTestId('agent-show-more-system');
  await expect(showMore).toHaveText('Show more (2)');
  await expect(showMore).toHaveAttribute('aria-expanded', 'false');

  await button(page, 'Show more (2)').click();
  await expect(cards(system)).toHaveCount(5);
  await expect(system.getByTestId('agent-card-sql-verifier')).toContainText(
    'SQL Verifier',
  );
  await expect(showMore).toHaveAttribute('aria-expanded', 'true');

  await button(page, 'Show less').click();
  await expect(cards(system)).toHaveCount(3);
});

test('search narrows the agents by name or description', async ({ page }) => {
  await openHub(page);

  await search(page).fill('urgency');
  await expect(page.getByTestId(`agent-card-${claimsId}`)).toBeVisible();
  await expect(page.getByTestId(`agent-card-${healthId}`)).toHaveCount(0);

  await search(page).fill('HEALTH PLAN');
  await expect(page.getByTestId(`agent-card-${healthId}`)).toBeVisible();
  await expect(page.getByTestId(`agent-card-${claimsId}`)).toHaveCount(0);

  await search(page).fill('nothing here');
  await expect(page.getByText('No agents match "nothing here"')).toBeVisible();
  await expect(cards(page)).toHaveCount(0);
});

test('filters limit the hub to one kind of agent', async ({ page }) => {
  await openHub(page);

  await filter(page, 'Mine').click();
  await expect(filter(page, 'Mine')).toHaveAttribute('aria-pressed', 'true');
  await expect(cards(page)).toHaveCount(2);
  expect(await cardKeys(page)).toEqual([claimsId, healthId]);
  expect(await sectionIds(page)).toEqual(['mine']);

  await filter(page, 'Official').click();
  // The assistant, Questions to Insights v2 and the Data Readiness Agent
  // are Official; every card shows, alphabetical by name
  // (R1-R3, R107).
  await expect(page.getByTestId('agent-card-assistant')).toBeVisible();
  await expect(cards(page)).toHaveCount(OFFICIAL_KEYS.length);
  expect(await cardKeys(page)).toEqual(OFFICIAL_KEYS);
  await expect(page.getByTestId('agent-show-more-official')).toHaveCount(0);
  expect(await sectionIds(page)).toEqual(['official']);

  await filter(page, 'Pinned').click();
  await expect(page.getByText('No pinned agents yet.')).toBeVisible();
  await expect(cards(page)).toHaveCount(0);

  await filter(page, 'All').click();
  await expect(section(page, 'system')).toBeVisible();
});

test('pinned agents come first in their own section and survive a restart', async ({
  app,
  appDataDir,
  launchApp,
}) => {
  let page = app.page;
  await openHub(page);

  await button(page, `Pin ${HEALTH}`).click();
  await button(page, `Pin ${ASSISTANT}`).click();

  const assistantToggle = button(page, `Unpin ${ASSISTANT}`);
  await expect(assistantToggle).toHaveText('Pinned');
  await expect(assistantToggle).toHaveAttribute('aria-pressed', 'true');
  expect((await cardKeys(section(page, 'official')))[0]).toBe('assistant');

  const healthToggle = button(page, `Unpin ${HEALTH}`);
  await expect(healthToggle).toHaveText('Pinned');
  await expect(cards(section(page, 'mine')).first()).toHaveAttribute(
    'data-testid',
    `agent-card-${healthId}`,
  );
  await expect(section(page, 'pinned')).toHaveCount(0);

  await filter(page, 'Pinned').click();
  await expect(cards(section(page, 'pinned'))).toHaveCount(2);
  expect(await cardKeys(section(page, 'pinned'))).toEqual([
    'assistant',
    healthId,
  ]);

  // The app restarts on the same data directory.
  if (app.target === 'web') {
    await app.restartCli();
  } else {
    await app.close();
    page = (await launchApp(appDataDir)).page;
  }

  await openHub(page);
  await filter(page, 'Pinned').click();
  await expect(cards(section(page, 'pinned'))).toHaveCount(2);
  expect(await cardKeys(section(page, 'pinned'))).toEqual([
    'assistant',
    healthId,
  ]);

  await button(page, `Unpin ${HEALTH}`).click();
  await expect(cards(section(page, 'pinned'))).toHaveCount(1);
  expect(await cardKeys(section(page, 'pinned'))).toEqual(['assistant']);

  await filter(page, 'All').click();
  await expect(
    section(page, 'mine').getByRole('button', {
      name: `Pin ${HEALTH}`,
      exact: true,
    }),
  ).toHaveText('Pin');
});

test('flags an agent whose dataset no longer exists', async ({ page }) => {
  await saveAgentDraft(page, claimsId, {
    name: CLAIMS,
    description: CLAIMS_DESCRIPTION,
    datasets: ['Gone'],
  });
  await openHub(page);

  await expect(page.getByTestId(`agent-card-${claimsId}`)).toContainText(
    'Missing dataset: Gone',
  );
  await expect(page.getByTestId(`agent-card-${healthId}`)).toBeVisible();
  await expect(page.getByTestId(`agent-card-${healthId}`)).not.toContainText(
    'Missing dataset',
  );
});

test("a card opens the agent's detail view with its actions", async ({
  page,
}) => {
  await openHub(page);

  // No agent offers Start chat: chats can no longer be started (R53).
  await openAgent(page, claimsId, CLAIMS);
  await expect(page.getByTestId('agent-edit')).toBeVisible();
  await expect(button(page, 'Publish')).toBeVisible();
  await expect(button(page, 'Delete')).toBeVisible();
  await expect(button(page, 'Start chat')).toHaveCount(0);

  await button(page, 'All agents').click();
  await openAgent(page, healthId, HEALTH);
  await expect(page.getByTestId('agent-edit')).toBeVisible();
  await expect(button(page, 'Delete')).toBeVisible();
  await expect(button(page, 'Publish')).toHaveCount(0);
  await expect(button(page, 'Start chat')).toHaveCount(0);

  await button(page, 'All agents').click();
  await openAgent(page, 'assistant', ASSISTANT);
  await expect(page.getByTestId('agent-used-in')).toBeVisible();
  await expect(button(page, 'Start chat')).toHaveCount(0);
  await expect(page.getByTestId('agent-edit')).toHaveCount(0);
  await expect(button(page, 'Publish')).toHaveCount(0);
  await expect(button(page, 'Delete')).toHaveCount(0);
});

test('publishing a draft makes it Live', async ({ page }) => {
  await openHub(page);

  await openAgent(page, claimsId, CLAIMS);
  await button(page, 'Publish').click();
  await expect(
    page.getByText('Select at least one dataset to publish'),
  ).toBeVisible();

  await saveAgentDraft(page, claimsId, {
    name: CLAIMS,
    description: CLAIMS_DESCRIPTION,
    datasets: [WORLD_CUP_DATASET],
  });
  await button(page, 'All agents').click();
  await openAgent(page, claimsId, CLAIMS);
  await button(page, 'Publish').click();
  await expect(page.getByText(`Agent "${CLAIMS}" is Live`)).toBeVisible();
  await expect(button(page, 'Publish')).toHaveCount(0);

  await button(page, 'All agents').click();
  await expect(
    section(page, 'mine').getByTestId(`agent-status-${claimsId}`),
  ).toHaveText('Live');
});

test('deleting an agent asks first', async ({ page }) => {
  await openHub(page);
  await openAgent(page, claimsId, CLAIMS);

  const asked: string[] = [];
  page.once('dialog', (dialog) => {
    asked.push(dialog.message());
    void dialog.dismiss();
  });
  await button(page, 'Delete').click();
  await expect.poll(() => asked.length).toBe(1);
  expect(asked[0]).toBe(
    `Delete "${CLAIMS}"?\n\nIts sessions keep their transcripts and continue with the assistant.`,
  );
  await expect(
    page.getByRole('heading', { name: CLAIMS, exact: true }),
  ).toBeVisible();

  page.once('dialog', (dialog) => void dialog.accept());
  await button(page, 'Delete').click();
  await expect(page.getByText(`Agent "${CLAIMS}" deleted`)).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'Agents', exact: true }),
  ).toBeVisible();
  await expect(page.getByTestId(`agent-card-${healthId}`)).toBeVisible();
  await expect(page.getByTestId(`agent-card-${claimsId}`)).toHaveCount(0);
});

test('skills opens the skills library and Back returns to the hub', async ({
  page,
}) => {
  await openHub(page);
  const skills = button(page, 'Skills');
  await expect(skills).toBeVisible();
  // Beside "New agent", in the hub's header.
  const actions = page.getByTestId('agent-new').locator('..');
  await expect(actions.getByTestId('agent-skills-library')).toBeVisible();

  await skills.click();
  await expect(
    page.getByRole('heading', { name: 'Skills', exact: true }),
  ).toBeVisible();
  await expect(page.getByTestId('skill-new')).toBeVisible();
  await expect(
    page.getByRole('heading', {
      name: 'Built-in · included in every agent',
      exact: true,
    }),
  ).toBeVisible();

  await button(page, 'Back').click();
  await expect(
    page.getByRole('heading', { name: 'Agents', exact: true }),
  ).toBeVisible();
  await expect(page.getByTestId(`agent-card-${healthId}`)).toBeVisible();
});

test('the hub has no detectable accessibility violations in either theme', async ({
  page,
}) => {
  await followOsTheme(page);
  await openHub(page);
  await button(page, 'Show more (2)').click();
  await expect(cards(section(page, 'system'))).toHaveCount(5);

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
});

test(
  'The Official section holds only agents that can chat',
  { tag: ['@demo', '@story-1.23.8'] },
  async ({ page }) => {
    await scenarioStep(page, 'When I open "Agents"', async () => {
      await openHub(page);
    });
    const official = section(page, 'official');
    await scenarioStep(
      page,
      'Then the Official section shows "Questions to Insights Assistant", "Questions to Insights v2" and "Data Readiness Agent"',
      async () => {
        await expect(
          official.getByTestId('agent-card-assistant'),
        ).toBeVisible();
        expect(await cardKeys(official)).toEqual(OFFICIAL_KEYS);
        for (const [key, name] of [
          ['assistant', ASSISTANT],
          [V2_KEY, V2],
          ['data-readiness', 'Data Readiness Agent'],
        ]) {
          const card = official.getByTestId(`agent-card-${key}`);
          await expect(card).toContainText(name);
          await expect(card).toContainText('Owner: Official');
        }
        await expect(page.getByTestId('agent-show-more-official')).toHaveCount(
          0,
        );
      },
    );
    await scenarioStep(
      page,
      'And I see no "Showcase" chip and no "Benchmarking Agent", "Survey Agent", "LAD COE Agent" or "Strategy Agent"',
      async () => {
        await expect(page.getByText('Showcase', { exact: true })).toHaveCount(
          0,
        );
        for (const name of [
          'Benchmarking Agent',
          'Survey Agent',
          'LAD COE Agent',
          'Strategy Agent',
        ]) {
          await expect(page.getByText(name, { exact: true })).toHaveCount(0);
        }
      },
    );
  },
);

test('Questions to Insights v2 is an Official card', async ({ page }) => {
  await openHub(page);
  const official = section(page, 'official');
  const card = official.getByTestId(`agent-card-${V2_KEY}`);
  await expect(card).toContainText(V2);
  await expect(card).toContainText('Owner: Official');
  // Right after "Questions to Insights Assistant" (R1, R107).
  const keys = await cardKeys(official);
  expect(keys.indexOf(V2_KEY)).toBe(keys.indexOf('assistant') + 1);
});

test("Questions to Insights v2's page shows its prompt, five tools and three skills", async ({
  page,
}) => {
  await openHub(page);
  await openAgent(page, V2_KEY, V2);
  await expect(page.getByText(V2_DESCRIPTION)).toBeVisible();
  // It opens on System Prompt and has no Chat Box (R5, R90, R107).
  await expect(page.getByTestId('agent-tab-chat')).toHaveCount(0);
  await expect(page.getByTestId('agent-prompt-view')).toBeVisible();

  await page.getByTestId('agent-tab-prompt').click();
  await expect(
    page.getByText('Built-in', { exact: true }).first(),
  ).toBeVisible();
  await expect(page.getByTestId('agent-prompt-view')).toContainText(
    'You are Questions to Insights v2',
  );

  await expect(page.getByTestId('agent-tab-tools')).toHaveText(/Tools \(5\)/);
  await page.getByTestId('agent-tab-tools').click();
  for (const tool of V2_TOOLS) {
    await expect(
      page.getByText(tool).locator('visible=true').first(),
    ).toBeVisible();
  }
  await expect(
    page.getByText('create_visual').locator('visible=true'),
  ).toHaveCount(0);

  await page.getByTestId('agent-tab-skills').click();
  await expect(page.getByTestId('agent-tab-skills')).toHaveText(/Skills \(3\)/);
  for (const skill of V2_SKILLS) {
    await expect(page.getByTestId(`agent-skill-${skill}`)).toContainText(
      'On demand',
    );
  }
  await expect(page.getByText('This agent has no skills.')).toHaveCount(0);

  await page.getByTestId('agent-tab-memory').click();
  await expect(page.getByText('Recent messages replayed')).toBeVisible();
  await expect(page.getByText('40 messages')).toBeVisible();
});

test('saving a Questions to Insights v2 prompt that loses its identity line is refused', async ({
  page,
}) => {
  await openHub(page);
  await openAgent(page, V2_KEY, V2);
  await page.getByTestId('agent-tab-prompt').click();
  await page.getByTestId('agent-prompt-edit').click();
  await expect(page.getByTestId('agent-prompt-editing')).toBeVisible();

  const editor = page.getByRole('textbox', {
    name: 'System prompt',
    exact: true,
  });
  await editor.focus();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.press('Delete');
  await page.keyboard.type('You are a data analyst.');
  await page.getByTestId('agent-prompt-save').click();

  await expect(
    page.getByText(
      'The Questions to Insights v2 prompt must start with "You are Questions to Insights v2"',
    ),
  ).toBeVisible();
  await expect(page.getByTestId('agent-prompt-modified')).toHaveCount(0);
  const agent = await apiJson<{ prompt?: { modified: boolean } }>(
    page,
    'GET',
    `/agents/${V2_KEY}`,
  );
  expect(agent.prompt?.modified).toBe(false);
});

function railItem(page: Page, name: string): Locator {
  return page
    .getByRole('complementary', { name: 'Navigation rail' })
    .getByRole('button', { name, exact: true });
}

/** The Used in text of a user agent, or an Official agent no workflow uses. */
const NOT_USED = 'Not used in any workflow.';
const SYSTEM_EMPTY =
  'Not used in any workflow. The app calls this agent itself.';

test(
  'An agent shows the workflows that use it',
  { tag: ['@demo', '@story-1.23.7'] },
  async ({ page }) => {
    await scenarioStep(page, 'When I open "Agents"', async () => {
      await openHub(page);
    });
    await scenarioStep(page, 'Then no card has "Start chat"', async () => {
      await expect(page.getByTestId('agent-card-assistant')).toBeVisible();
      await expect(cards(page).first()).toBeVisible();
      await expect(
        page.getByRole('button', { name: /Start chat/ }),
      ).toHaveCount(0);
    });
    await scenarioStep(page, `When I open "${V2}"`, async () => {
      await openAgent(page, V2_KEY, V2);
    });
    await scenarioStep(page, `Then I see "Used in" "${V2}"`, async () => {
      const usedIn = page.getByTestId('agent-used-in');
      await expect(usedIn).toContainText('Used in');
      await expect(usedIn.getByTestId('agent-used-in-qti-v2-turn')).toHaveText(
        V2,
      );
      await expect(button(page, 'Start chat')).toHaveCount(0);
    });
    await scenarioStep(page, `When I click the "${V2}" chip`, async () => {
      await page.getByTestId('agent-used-in-qti-v2-turn').click();
    });
    await scenarioStep(
      page,
      `Then I see the "${V2}" workflow page and "Workflows" is the current rail item`,
      async () => {
        await expect(page.getByTestId('workflow-detail-name')).toHaveText(V2);
        await expect(page.getByTestId('workflow-detail-id')).toHaveText(
          'qti-v2-turn',
        );
        await expect(railItem(page, 'Workflows')).toHaveAttribute(
          'aria-current',
          'page',
        );
        await expect(railItem(page, 'Agents')).not.toHaveAttribute(
          'aria-current',
        );
      },
    );
    await scenarioStep(
      page,
      'When I open the "Data Readiness Agent" agent',
      async () => {
        await openHub(page);
        await openAgent(page, 'data-readiness', 'Data Readiness Agent');
      },
    );
    await scenarioStep(
      page,
      'Then I see no "Chat Box" tab, "System Prompt" is open, and it is used in no workflow',
      async () => {
        await expect(page.getByTestId('agent-tab-prompt')).toBeVisible();
        await expect(page.getByTestId('agent-tab-chat')).toHaveCount(0);
        await expect(page.getByText('Chat Box', { exact: true })).toHaveCount(
          0,
        );
        await expect(page.getByTestId('agent-prompt-view')).toContainText(
          'You are the Data Readiness Agent',
        );
        // Its one-step workflow is gone: it can no longer be run.
        await expect(page.getByTestId('agent-used-in')).toContainText(NOT_USED);
        await expect(
          page.getByTestId('agent-used-in').getByRole('button'),
        ).toHaveCount(0);
        await expect(
          page.getByTestId('agent-used-in-agent:data-readiness'),
        ).toHaveCount(0);
      },
    );
  },
);

test('a user agent is used in no workflow, even once published', async ({
  page,
}) => {
  await openHub(page);
  await openAgent(page, claimsId, CLAIMS);
  await expect(page.getByTestId('agent-used-in')).toContainText(NOT_USED);
  await expect(
    page.getByTestId('agent-used-in').getByRole('button'),
  ).toHaveCount(0);
  // A user agent keeps its Chat Box, and opens on it (R90).
  await expect(page.getByTestId('agent-tab-chat')).toBeVisible();
  await expect(page.getByTestId('agent-panel-chat')).toBeVisible();

  await saveAgentDraft(page, claimsId, {
    name: CLAIMS,
    description: CLAIMS_DESCRIPTION,
    datasets: [WORLD_CUP_DATASET],
  });
  await button(page, 'All agents').click();
  await openAgent(page, claimsId, CLAIMS);
  await button(page, 'Publish').click();
  await expect(page.getByText(`Agent "${CLAIMS}" is Live`)).toBeVisible();
  // Agents are a library: publishing gives it no workflow.
  await expect(page.getByTestId('agent-used-in')).toContainText(NOT_USED);
  await expect(
    page.getByTestId(`agent-used-in-agent:${claimsId}`),
  ).toHaveCount(0);
  await expect(
    page.getByTestId('agent-used-in').getByRole('button'),
  ).toHaveCount(0);
});

test('a System agent says the app calls it itself', async ({ page }) => {
  await openHub(page);
  await button(page, 'Show more (2)').click();
  await openAgent(page, 'sql-fixer', 'SQL Fixer');
  await expect(page.getByTestId('agent-used-in')).toContainText(SYSTEM_EMPTY);
  await expect(page.getByTestId('agent-tab-chat')).toHaveCount(0);
  await expect(button(page, 'Start chat')).toHaveCount(0);
});

test('the agent detail has no detectable accessibility violations in either theme', async ({
  page,
}) => {
  await followOsTheme(page);
  await page.addScriptTag({ content: axe.source });

  async function scan(label: string): Promise<void> {
    for (const theme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme: theme });
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      // Let the theme's colour transitions finish before axe reads colours.
      await page.waitForTimeout(500);
      const results = await page.evaluate(async () => {
        return (window as unknown as { axe: typeof axe }).axe.run(document);
      });
      expect(results.violations, `${label}, ${theme}`).toEqual([]);
    }
  }

  await openHub(page);
  await openAgent(page, V2_KEY, V2);
  await expect(page.getByTestId('agent-used-in-qti-v2-turn')).toBeVisible();
  await expect(page.getByTestId('agent-prompt-view')).toBeVisible();
  await scan('Official agent');

  await button(page, 'All agents').click();
  await openAgent(page, claimsId, CLAIMS);
  await expect(page.getByTestId('agent-used-in')).toContainText(NOT_USED);
  await scan('draft user agent');
});
