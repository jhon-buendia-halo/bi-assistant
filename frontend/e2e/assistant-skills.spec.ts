import type { Page } from '@playwright/test';
import { test, expect } from './fixtures/app.fixture';
import { createWorldCupSession } from './helpers/app-actions';
import { saveLenaiSettings, seedWorldCupDataset } from './helpers/agents-api';
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
