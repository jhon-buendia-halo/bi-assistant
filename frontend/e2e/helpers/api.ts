import { expect, type APIResponse, type Page } from '@playwright/test';

/**
 * API helpers for the specs. The app has no authentication (BA-232), so
 * calls carry no token or header.
 */

/** The backend's base URL: same origin on web, port 3000 under file://. */
export function apiBaseOf(page: Page): string {
  const url = new URL(page.url());
  return url.protocol === 'file:' ? 'http://localhost:3000' : url.origin;
}

/** An API call from Node. */
export async function apiFetch(
  page: Page,
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  route: string,
  data?: unknown,
): Promise<APIResponse> {
  return page.request.fetch(`${apiBaseOf(page)}${route}`, { method, data });
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
