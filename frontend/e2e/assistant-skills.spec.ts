import type { Page } from '@playwright/test';
import { test, expect } from './fixtures/app.fixture';
import {
  WORLD_CUP_DATASET,
  createWorldCupSession,
} from './helpers/app-actions';
import {
  createKnowledgeSnippet,
  saveLenaiSettings,
  seedWorldCupDataset,
} from './helpers/agents-api';
import {
  LlmStub,
  STUB_ANSWER,
  StubRequest,
  startLlmStub,
  systemTexts,
  turnRequests,
} from './helpers/llm-stub';

/**
 * Mirrors the Feature "Skills the assistant is given" in
 * specs/capabilities/sessions-chat/spec.md. The model is the recording
 * OpenAI-compatible stub, so the scenarios check what the backend sent.
 */

/** The skills the assistant's catalog lists (agents.md section 7.4). */
const ASSISTANT_SKILLS: string[] = [];
/** App skills only other agents or the harness use. */
const OTHER_SKILLS = ['interactive-visuals'];
const SKILL_TOOLS = ['skill', 'skill_read'];

const BASE_PROMPT_START = 'You are the Questions to Insights assistant';
/** Opening of the curated-knowledge block (agents.md 4.1, Block 3). */
const KNOWLEDGE_BLOCK_START = 'Curated dataset knowledge';
/** Opening of the `curated-knowledge` skill's body. */
const KNOWLEDGE_RULES_START = 'Curated knowledge:';
/** A rule only the `curated-knowledge` skill states. */
const KNOWLEDGE_RULE = 'Apply every [default_filter] to every query you run';
const QUESTION = 'Who won the 2022 World Cup?';

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

async function ask(page: Page, question: string): Promise<StubRequest> {
  await page.getByPlaceholder('Ask a follow-up question…').fill(question);
  await page.getByRole('button', { name: 'Send message' }).click();
  await expect(page.getByText(STUB_ANSWER)).toBeVisible();
  const requests = turnRequests(stub, question);
  expect(requests.length, `a streamed call for "${question}"`).toBeGreaterThan(
    0,
  );
  return requests[0];
}

/** Skill names in the `<available_skills>` catalog of a request. */
function catalogSkills(request: StubRequest): string[] {
  const catalog = systemTexts(request)
    .join('\n')
    .match(/<available_skills>[\s\S]*?<\/available_skills>/);
  if (!catalog) return [];
  return [...catalog[0].matchAll(/<name>([^<]+)<\/name>/g)].map((m) => m[1]);
}

test('the assistant is offered only its own skills', async ({ page }) => {
  await createWorldCupSession(page);
  const request = await ask(page, 'Who won the 2022 World Cup?');

  expect(catalogSkills(request).sort()).toEqual([...ASSISTANT_SKILLS].sort());
  for (const name of OTHER_SKILLS) {
    expect(systemTexts(request).join('\n')).not.toContain(`name: ${name}`);
  }
  for (const tool of SKILL_TOOLS) {
    if (ASSISTANT_SKILLS.length) expect(request.tools).toContain(tool);
    else expect(request.tools).not.toContain(tool);
  }
});

test('a turn without curated knowledge carries no knowledge rules', async ({
  page,
}) => {
  await createWorldCupSession(page);
  const request = await ask(page, QUESTION);

  const systems = systemTexts(request);
  expect(systems[0]).toContain(BASE_PROMPT_START);
  const all = systems.join('\n');
  expect(all).not.toContain(KNOWLEDGE_BLOCK_START);
  expect(all).not.toContain(KNOWLEDGE_RULES_START);
  expect(all).not.toContain(KNOWLEDGE_RULE);
});

test('a turn with curated knowledge carries the rules right after the block', async ({
  page,
}) => {
  const instruction = 'Only the 2018 and 2022 tournaments are in this data.';
  await createKnowledgeSnippet(page, {
    kind: 'instruction',
    title: 'Coverage',
    body: instruction,
    datasetId: WORLD_CUP_DATASET,
  });
  await createWorldCupSession(page);
  const request = await ask(page, QUESTION);

  const systems = systemTexts(request);
  expect(systems[0]).toContain(BASE_PROMPT_START);
  expect(systems[0]).not.toContain(KNOWLEDGE_RULES_START);
  expect(systems[0]).not.toContain(KNOWLEDGE_RULE);

  const blocks = systems
    .map((text, index) => (text.startsWith(KNOWLEDGE_BLOCK_START) ? index : -1))
    .filter((index) => index >= 0);
  expect(blocks, 'one curated-knowledge block').toHaveLength(1);
  expect(systems[blocks[0]]).toContain(
    `- [instruction] Coverage: ${instruction}`,
  );
  const next = systems[blocks[0] + 1] ?? '';
  expect(next.startsWith(KNOWLEDGE_RULES_START), next.slice(0, 80)).toBe(true);
  expect(next).toContain(KNOWLEDGE_RULE);
  // Sent once, and only there.
  expect(systems.filter((text) => text.includes(KNOWLEDGE_RULE))).toHaveLength(
    1,
  );
});
