import * as fs from 'fs';
import * as path from 'path';
import type { Page } from '@playwright/test';
import { test, expect } from './fixtures/app.fixture';
import { runQuestionOk } from './helpers/runs-api';
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
 * What a run is given in skills, in specs/capabilities/agent-answers/spec.md.
 * The one runnable workflow is Questions to Insights v2 (`qti-v2-turn`),
 * whose agent `assistant-v2` loads its built-in skills on demand
 * (`curated-knowledge`, `sql-analysis`, `result-validation`): the scenario
 * checks that they reach the model through the framework's skill catalog,
 * and that a skill left in the data dir by an older version never does.
 * The model is the recording OpenAI-compatible stub, so the scenario checks
 * what the backend sent.
 */

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
  const result = await runQuestionOk(page, question);
  expect(result.text).toContain(STUB_ANSWER);
  const requests = turnRequests(stub, question);
  expect(requests.length, `a streamed call for "${question}"`).toBeGreaterThan(
    0,
  );
  return requests[0];
}

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

test('a Questions to Insights v2 run is offered its built-in skills only, and an old skills folder is ignored', async ({
  app,
  appDataDir,
  launchApp,
}) => {
  // Given the data dir holds a skills folder from an older version.
  const description = 'Use when writing SQL for the World Cup data.';
  const body = 'Prefer CTEs and one clause per line.';
  const page = await withOldSkillsFolder(
    { app, appDataDir, launchApp },
    'sql-style',
    description,
    body,
  );
  // When I run Questions to Insights v2.
  const request = await ask(page, QUESTION);

  // Then the framework's skill catalog lists its three built-in skills and
  // the model is offered the skill tool, but no file or script tool.
  const systems = systemTexts(request).join('\n');
  expect(systems).toContain('You are Questions to Insights v2');
  expect(systems).not.toContain('\n## Skills\n');
  expect(systems).toContain('<available_skills>');
  for (const skill of [
    'curated-knowledge',
    'sql-analysis',
    'result-validation',
  ]) {
    expect(systems).toContain(skill);
  }
  expect(request.tools).toContain('skill');
  expect(request.tools).not.toContain('read_file');
  expect(request.tools).not.toContain('run_skill_script');
  // And nothing of the old skill does.
  expect(stub.requests.length).toBeGreaterThan(0);
  for (const sent of stub.requests) {
    const everything = JSON.stringify(sent);
    expect(everything).not.toContain('sql-style');
    expect(everything).not.toContain(description);
    expect(everything).not.toContain(body);
  }
});
