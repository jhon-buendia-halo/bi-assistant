import {
  expect,
  type APIResponse,
  type Locator,
  type Page,
} from '@playwright/test';
import { createRequire } from 'node:module';
import path from 'node:path';

/**
 * Local mode sign-in for the `web` and `desktop` projects (admin R69-R71,
 * ADR-0012). Local mode opens on a sign-in page listing five seeded
 * personas; signing in answers an opaque token the app keeps in
 * `localStorage` and sends as `Authorization: Bearer <token>`. The fixture
 * signs in through the API and stores the token, so every spec starts in the
 * shell as Demo User unless it asks otherwise.
 */

/** Where the app keeps the local auth session token (the raw token string). */
export const LOCAL_SESSION_KEY = 'questions-to-insights:local-session';

/** The five seeded personas' fixed directory ids (admin R69). */
export const LOCAL_USERS = {
  demo: 'local',
  uma: 'local-uma',
  mark: 'local-mark',
  dana: 'local-dana',
  avery: 'local-avery',
} as const;

export type LocalUserId = (typeof LOCAL_USERS)[keyof typeof LOCAL_USERS];

/** Display names of the personas, by id. */
export const LOCAL_USER_NAMES: Record<LocalUserId, string> = {
  local: 'Demo User',
  'local-uma': 'Uma User',
  'local-mark': 'Mark Maker',
  'local-dana': 'Dana Data Owner',
  'local-avery': 'Avery Approver',
};

/** The backend's base URL: same origin on web, port 3000 under file://. */
export function apiBaseOf(page: Page): string {
  const url = new URL(page.url());
  return url.protocol === 'file:' ? 'http://localhost:3000' : url.origin;
}

/**
 * Signs `userId` in through `POST /auth/local/sign-in` (api.md 92) from
 * Node and resolves to the auth session token.
 */
export async function signInLocally(
  baseUrl: string,
  userId: string,
): Promise<string> {
  const response = await fetch(`${baseUrl}/auth/local/sign-in`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId }),
  });
  const text = await response.text();
  if (response.status !== 200) {
    throw new Error(
      `Local sign-in as ${userId} failed: POST /auth/local/sign-in → HTTP ${response.status}: ${text}`,
    );
  }
  const body = JSON.parse(text) as { ok?: boolean; token?: unknown };
  if (body.ok !== true || typeof body.token !== 'string' || !body.token) {
    throw new Error(`Local sign-in as ${userId} answered no token: ${text}`);
  }
  return body.token;
}

/** The token `page` holds, or null when it is signed out. */
export async function localToken(page: Page): Promise<string | null> {
  return page.evaluate(
    (key) => localStorage.getItem(key),
    LOCAL_SESSION_KEY,
  );
}

/** The `Authorization` header of `page`'s local auth session, if any. */
export async function authHeaders(page: Page): Promise<Record<string, string>> {
  const token = await localToken(page);
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/** An API call from Node with `page`'s local auth session. */
export async function apiFetch(
  page: Page,
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  route: string,
  data?: unknown,
): Promise<APIResponse> {
  return page.request.fetch(`${apiBaseOf(page)}${route}`, {
    method,
    data,
    headers: await authHeaders(page),
  });
}

/** Like `apiFetch`, expecting a 2xx JSON answer, which it returns. */
export async function apiJson<T = unknown>(
  page: Page,
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  route: string,
  data?: unknown,
): Promise<T> {
  const response = await apiFetch(page, method, route, data);
  expect(
    response.ok(),
    `${method} ${route} → HTTP ${response.status()}: ${await response.text()}`,
  ).toBe(true);
  return (await response.json()) as T;
}

// ---------------------------------------------------------------- UI

/** The local sign-in page's user dropdown (ui.md 4.17.1). */
export const localUserSelect = (page: Page): Locator =>
  page.getByLabel('Sign in as', { exact: true });

/** The local sign-in page's Sign in button. */
export const localSignInButton = (page: Page): Locator =>
  page.getByRole('button', { name: 'Sign in', exact: true });

/** An option label of the dropdown: `<display name> · <roles>` (admin R70). */
export const localUserOption = (displayName: string, roles: string): string =>
  `${displayName} · ${roles}`;

/** Signs in through the sign-in page's dropdown and waits for the shell. */
export async function signInThroughPage(
  page: Page,
  optionLabel: string,
): Promise<void> {
  await expect(localUserSelect(page)).toBeVisible();
  await localUserSelect(page).selectOption({ label: optionLabel });
  await localSignInButton(page).click();
  await expect(page.getByLabel('Open system logs')).toBeVisible();
}

// ---------------------------------------------------------------- SQLite

interface SqliteStatement {
  reader: boolean;
  all(...params: unknown[]): unknown[];
  run(...params: unknown[]): unknown;
}

interface SqliteDatabase {
  pragma(statement: string): unknown;
  prepare(statement: string): SqliteStatement;
  close(): void;
}

/** `better-sqlite3` is a backend dependency; the tests borrow it. */
const requireFromBackend = createRequire(
  path.resolve(__dirname, '../../../backend/package.json'),
);

/** Runs one SQL statement on `<dataDir>/app.sqlite` (the app may be running). */
export function appSql<T = unknown>(
  dataDir: string,
  statement: string,
  ...params: unknown[]
): T[] {
  const Database = requireFromBackend('better-sqlite3') as new (
    file: string,
  ) => SqliteDatabase;
  const db = new Database(path.join(dataDir, 'app.sqlite'));
  try {
    db.pragma('busy_timeout = 5000');
    const prepared = db.prepare(statement);
    if (prepared.reader) return prepared.all(...params) as T[];
    prepared.run(...params);
    return [];
  } finally {
    db.close();
  }
}
