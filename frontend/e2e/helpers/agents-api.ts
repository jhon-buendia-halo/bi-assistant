import { expect, Page } from '@playwright/test';
import { WORLD_CUP_DATASET, WORLD_CUP_DATASOURCE } from './app-actions';

/**
 * Seeds data through the backend API rather than the UI, so a test can start
 * from the state its Gherkin Background describes.
 */

/** The backend's base URL: same origin on the web target, port 3000 on desktop. */
export function apiBase(page: Page): string {
  const url = new URL(page.url());
  return url.protocol === 'file:' ? 'http://localhost:3000' : url.origin;
}

interface StyleA {
  ok: boolean;
  message: string;
}

async function call<T extends StyleA>(
  page: Page,
  method: 'POST' | 'PUT' | 'DELETE',
  path: string,
  data?: unknown,
): Promise<T> {
  const response = await page.request.fetch(`${apiBase(page)}${path}`, {
    method,
    data,
  });
  expect(response.ok(), `${method} ${path} → HTTP ${response.status()}`).toBe(
    true,
  );
  const body = (await response.json()) as T;
  expect(body.ok, `${method} ${path}: ${body.message}`).toBe(true);
  return body;
}

/**
 * Saves the World Cup datasource and a "World Cup Core" dataset over
 * `matches`, and returns the datasource id.
 */
export async function seedWorldCupDataset(page: Page): Promise<string> {
  const { datasource } = await call<StyleA & { datasource: { id: string } }>(
    page,
    'POST',
    '/datasources',
    {
      kind: 'postgres',
      name: WORLD_CUP_DATASOURCE,
      config: {
        host: '127.0.0.1',
        port: 55432,
        database: 'world_cup',
        user: 'world_cup',
        password: 'world_cup_dev',
        ssl: false,
      },
    },
  );
  await seedDataset(page, WORLD_CUP_DATASET, datasource.id);
  return datasource.id;
}

/** Saves a dataset named `name` over the World Cup `matches` table. */
export async function seedDataset(
  page: Page,
  name: string,
  datasourceId: string,
): Promise<void> {
  const key = 'world_cup.world_cup.matches';
  await call(page, 'POST', '/datasets', {
    name,
    tables: [key],
    entities: [
      {
        key,
        columns: [{ name: 'match_number', type: 'integer', nullable: false }],
      },
    ],
    datasourceId,
    datasourceKind: 'postgres',
  });
}

/** Deletes a dataset by name. */
export async function deleteDataset(page: Page, name: string): Promise<void> {
  await call(page, 'DELETE', `/datasets/${encodeURIComponent(name)}`);
}

/** Saves a LenAI configuration whose gateway is `baseUrl` (an LLM stub). */
export async function saveLenaiSettings(
  page: Page,
  baseUrl: string,
  deployment = 'stub-deployment',
): Promise<void> {
  await call(page, 'PUT', '/llm/settings', {
    provider: 'lenai',
    model: deployment,
    baseUrl,
    apiKey: 'sk-stub',
  });
}

export interface UserAgentInput {
  name: string;
  description?: string;
  instructions?: string;
  datasets?: string[];
  starterQuestions?: string[];
  model?: string;
  reasoningEffort?: 'low' | 'medium' | 'high';
}

/** Creates a user agent as a draft and returns its id. */
export async function createUserAgent(
  page: Page,
  input: UserAgentInput,
): Promise<string> {
  const { agent } = await call<StyleA & { agent: { id: string } }>(
    page,
    'POST',
    '/agents',
    input,
  );
  return agent.id;
}

/** Replaces a user agent's draft. */
export async function saveAgentDraft(
  page: Page,
  id: string,
  input: UserAgentInput,
): Promise<void> {
  await call(page, 'PUT', `/agents/${encodeURIComponent(id)}/draft`, input);
}

/** Publishes a user agent's draft. */
export async function publishAgent(page: Page, id: string): Promise<void> {
  await call(page, 'POST', `/agents/${encodeURIComponent(id)}/publish`);
}
