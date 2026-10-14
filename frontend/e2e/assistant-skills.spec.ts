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
const OTHER_SKILLS = ['interactive-visuals'];
/** The framework's skill tools, never offered (ADR-0020). */
const FRAMEWORK_SKILL_TOOLS = ['skill', 'skill_search', 'skill_read'];

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
  expect(prompt).not.toContain('## Skills');
  expect(prompt).toContain(
    '\n- run_readonly_sql(sql, datasourceId, limit, rationale): ',
  );
  expect(prompt).toContain('\n- ask_clarification(question, options): ');
  expect(catalogSkills(request)).toEqual([]);
  for (const name of OTHER_SKILLS) {
    expect(systemTexts(request).join('\n')).not.toContain(`name: ${name}`);
  }
  for (const tool of ['read_file', ...FRAMEWORK_SKILL_TOOLS]) {
    expect(request.tools).not.toContain(tool);
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

/**
 * Writes a user-level skill into the data dir and restarts the backend, which
 * reads skills only at startup (agents.md 7.3). The LLM settings and the
 * dataset the Background saved live in the same data dir, so they survive.
 */
async function withUserSkill(
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
    await app.page.reload();
    return app.page;
  }
  await app.close();
  return (await launchApp(appDataDir)).page;
}

test('a user-level skill is offered to the assistant on demand', async ({
  app,
  appDataDir,
  launchApp,
}) => {
  const description = 'Use when writing SQL for the World Cup data.';
  const page = await withUserSkill(
    { app, appDataDir, launchApp },
    'sql-style',
    description,
    'Prefer CTEs and one clause per line.',
  );
  await createWorldCupSession(page);
  const request = await ask(page, QUESTION);

  const prompt = systemTexts(request)[0];
  const skills = prompt.indexOf('\n## Skills\n');
  expect(skills, '## Skills after ## Working rules').toBeGreaterThan(
    prompt.indexOf('\n## Working rules\n'),
  );
  expect(prompt.trimEnd().endsWith('</available_skills>')).toBe(true);
  expect(catalogSkills(request)).toEqual(['sql-style']);
  expect(prompt).toContain(`<description>${description}</description>`);
  expect(prompt).toContain(
    `<location>${path.join(appDataDir, 'skills', 'sql-style', 'SKILL.md')}</location>`,
  );
  expect(prompt).toContain('\n- read_file(path): ');
  expect(request.tools).toContain('read_file');
  for (const tool of FRAMEWORK_SKILL_TOOLS) {
    expect(request.tools).not.toContain(tool);
  }
});

test("the assistant reads a skill's files with read_file, and only those", async ({
  app,
  appDataDir,
  launchApp,
}) => {
  const page = await withUserSkill(
    { app, appDataDir, launchApp },
    'sql-style',
    'Use when writing SQL for the World Cup data.',
    'Prefer CTEs and one clause per line.',
  );
  const skillMd = path.join(appDataDir, 'skills', 'sql-style', 'SKILL.md');
  const outside = path.join(appDataDir, 'app.sqlite');
  let turn = 0;
  stub.reply = (request) => {
    const isTurn =
      request.stream &&
      request.messages.some(
        (message) =>
          message.role === 'user' && messageText(message).includes(QUESTION),
      );
    if (!isTurn) return { text: STUB_ANSWER };
    turn += 1;
    if (turn === 1)
      return { toolCall: { name: 'read_file', arguments: { path: skillMd } } };
    if (turn === 2)
      return { toolCall: { name: 'read_file', arguments: { path: outside } } };
    return { text: STUB_ANSWER };
  };
  await createWorldCupSession(page);
  await ask(page, QUESTION);

  const results = toolResults(turnRequests(stub, QUESTION).at(-1)!);
  expect(results).toHaveLength(2);
  expect(results[0]).toContain('Prefer CTEs and one clause per line.');
  expect(results[0]).toContain('name: sql-style');
  expect(results[1]).toContain('Not a file of an installed skill');
  expect(results[1]).not.toContain('SQLite format');
});

test('a user-level override of the curated-knowledge skill reaches the turn', async ({
  app,
  appDataDir,
  launchApp,
}) => {
  const override =
    'Curated knowledge (team override): follow the glossary before anything else.';
  const page = await withUserSkill(
    { app, appDataDir, launchApp },
    'curated-knowledge',
    'Use when the turn carries a curated dataset knowledge block.',
    override,
  );
  await createKnowledgeSnippet(page, {
    kind: 'instruction',
    title: 'Coverage',
    body: 'Only the 2018 and 2022 tournaments are in this data.',
    datasetId: WORLD_CUP_DATASET,
  });
  await createWorldCupSession(page);
  const request = await ask(page, QUESTION);

  const systems = systemTexts(request);
  const block = systems.findIndex((text) =>
    text.startsWith(KNOWLEDGE_BLOCK_START),
  );
  expect(block, 'a curated-knowledge block').toBeGreaterThanOrEqual(0);
  expect(systems[block + 1]).toBe(override);
  expect(systems.join('\n')).not.toContain(KNOWLEDGE_RULE);
  // The override is a harness-loaded skill, so it is in no catalog.
  expect(catalogSkills(request)).toEqual([]);
});
