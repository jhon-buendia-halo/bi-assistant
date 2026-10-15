import * as fs from 'fs';
import * as path from 'path';
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
  messageText,
  startLlmStub,
  systemTexts,
  turnRequests,
} from './helpers/llm-stub';

/**
 * Mirrors the Feature "Skills the assistant is given" in
 * specs/capabilities/sessions-chat/spec.md. The model is the recording
 * OpenAI-compatible stub, so the scenarios check what the backend sent.
 */

/** App skills only other agents or the harness use. */
const OTHER_SKILLS = ['interactive-visuals', 'deep-analysis'];

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

/** The tool results a request carries, oldest first. */
function toolResults(request: StubRequest): string[] {
  return request.messages
    .filter((message) => message.role === 'tool')
    .map(messageText);
}

/** The `<location>` the catalog gives for one skill, or undefined. */
function catalogLocation(
  request: StubRequest,
  name: string,
): string | undefined {
  const text = systemTexts(request).join('\n');
  const entry = new RegExp(
    `<name>${name}</name>[\\s\\S]*?<location>([^<]+)</location>`,
  ).exec(text);
  return entry?.[1];
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

  const prompt = systemTexts(request)[0];
  expect(prompt.startsWith(BASE_PROMPT_START)).toBe(true);
  const tools = prompt.indexOf('\n## Tools\n');
  const rules = prompt.indexOf('\n## Working rules\n');
  expect(tools, 'a ## Tools section').toBeGreaterThan(0);
  expect(rules, '## Working rules after ## Tools').toBeGreaterThan(tools);
  // The skills reach the model through the framework's catalog, not the prompt.
  expect(prompt).not.toContain('\n## Skills\n');
  expect(prompt).toContain(
    '\n- run_readonly_sql(sql, datasourceId, limit, rationale): ',
  );
  expect(prompt).toContain('\n- ask_clarification(question, options): ');
  expect(prompt).not.toContain('read_file');
  // The built-in curated-knowledge skill is the whole catalog (ADR-0020).
  expect(catalogSkills(request)).toEqual(['curated-knowledge']);
  const location = catalogLocation(request, 'curated-knowledge') ?? '';
  expect(location.endsWith(path.join('curated-knowledge', 'SKILL.md'))).toBe(
    true,
  );
  for (const name of OTHER_SKILLS) {
    expect(systemTexts(request).join('\n')).not.toContain(`name: ${name}`);
    expect(catalogSkills(request)).not.toContain(name);
  }
  expect(request.tools).toContain('skill');
  expect(request.tools).not.toContain('read_file');
  expect(request.tools).not.toContain('run_skill_script');
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

test('a turn with curated knowledge carries the block, and the rules stay on demand', async ({
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
  // The rules travel only if the model reads the skill, and this stub doesn't.
  const all = systems.join('\n');
  expect(all).not.toContain(KNOWLEDGE_RULES_START);
  expect(all).not.toContain(KNOWLEDGE_RULE);
  expect(catalogSkills(request)).toContain('curated-knowledge');
});

/**
 * Writes a skill into `<data dir>/skills/`, where older versions read user
 * skills, and restarts the backend so it starts with the folder in place
 * (agents.md 7.3). The LLM settings and the dataset the Background saved live
 * in the same data dir, so they survive.
 */
async function withOldSkillsFolder(
  {
    app,
    appDataDir,
    launchApp,
  }: {
    app: {
      target: string;
      restartCli(): Promise<void>;
      close(): Promise<void>;
      page: Page;
    };
    appDataDir: string;
    launchApp: (dir: string) => Promise<{ page: Page }>;
  },
  name: string,
  description: string,
  body: string,
): Promise<Page> {
  const dir = path.join(appDataDir, 'skills', name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'SKILL.md'),
    [
      '---',
      `name: ${name}`,
      `description: ${description}`,
      '---',
      '',
      body,
      '',
    ].join('\n'),
  );
  if (app.target === 'web') {
    await app.restartCli();
    return app.page;
  }
  await app.close();
  return (await launchApp(appDataDir)).page;
}

/** Whether a request is a chat turn whose latest user message is `question`. */
function isTurnFor(request: StubRequest, question: string): boolean {
  const lastUser = request.messages
    .filter((message) => message.role === 'user')
    .at(-1);
  return (
    request.stream &&
    lastUser !== undefined &&
    messageText(lastUser).includes(question)
  );
}

test('a skills folder left in the data dir by an older version is ignored', async ({
  app,
  appDataDir,
  launchApp,
}) => {
  const description = 'Use when writing SQL for the World Cup data.';
  const body = 'Prefer CTEs and one clause per line.';
  const page = await withOldSkillsFolder(
    { app, appDataDir, launchApp },
    'sql-style',
    description,
    body,
  );
  await createWorldCupSession(page);
  const request = await ask(page, QUESTION);

  expect(catalogSkills(request)).toEqual(['curated-knowledge']);
  expect(stub.requests.length).toBeGreaterThan(0);
  for (const sent of stub.requests) {
    const everything = JSON.stringify(sent);
    expect(everything).not.toContain('sql-style');
    expect(everything).not.toContain(description);
    expect(everything).not.toContain(body);
  }
});

test('the assistant loads a skill with the skill tool', async ({ page }) => {
  let turn = 0;
  stub.reply = (request) => {
    if (!isTurnFor(request, QUESTION)) return { text: STUB_ANSWER };
    turn += 1;
    if (turn === 1)
      return {
        toolCall: { name: 'skill', arguments: { name: 'curated-knowledge' } },
      };
    return { text: STUB_ANSWER };
  };
  await createKnowledgeSnippet(page, {
    kind: 'instruction',
    title: 'Coverage',
    body: 'Only the 2018 and 2022 tournaments are in this data.',
    datasetId: WORLD_CUP_DATASET,
  });
  await createWorldCupSession(page);
  await ask(page, QUESTION);

  const results = toolResults(turnRequests(stub, QUESTION).at(-1)!);
  expect(results).toHaveLength(1);
  expect(results[0]).toContain(KNOWLEDGE_RULE);
});
