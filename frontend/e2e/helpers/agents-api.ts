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

/** Saves the World Cup datasource and a "World Cup Core" dataset over `matches`. */
export async function seedWorldCupDataset(page: Page): Promise<void> {
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
  const key = 'world_cup.world_cup.matches';
  await call(page, 'POST', '/datasets', {
    name: WORLD_CUP_DATASET,
    tables: [key],
    entities: [
      {
        key,
        columns: [{ name: 'match_number', type: 'integer', nullable: false }],
      },
    ],
    datasourceId: datasource.id,
    datasourceKind: 'postgres',
  });
}

export interface UserAgentInput {
  name: string;
  description?: string;
  instructions?: string;
  datasets?: string[];
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
