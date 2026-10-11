/**
 * Starts the BUILT backend in org server mode against the OIDC stub, for the
 * API tests of the Feature "Org server API" (specs/capabilities/admin/spec.md).
 * Run `npm run build` first. Helpers sign people in through the real
 * redirect round trip, call SCIM with the token and reach into `app.sqlite`
 * for what has no API yet (group mappings, shared fixtures, clock changes).
 */
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type Backend, boot, freePort, stop } from './backend-process';
import { type OidcStub, type StubUser, startOidcStub } from './oidc-stub';

export interface OrgServer {
  backend: Backend;
  stub: OidcStub;
  /** `ORG_PUBLIC_BASE_URL`, also the backend URL. */
  url: string;
  scimToken: string;
  dataDir: string;
  /** Sign in through `/auth/login` → stub → `/auth/callback`; the cookie header. */
  signIn(user: StubUser | string): Promise<string>;
  /** The raw callback outcome: where it redirected and the cookie it set. */
  signInRoundTrip(
    user: StubUser | string | null,
  ): Promise<{ location: string; cookie: string | null }>;
  /** `fetch` against the app with an optional cookie and the right Origin. */
  api(path: string, init?: ApiInit): Promise<Response>;
  /** `fetch` a SCIM route with the bearer token. */
  scim(path: string, init?: ScimInit): Promise<Response>;
  /** Run SQL against the app's `app.sqlite` while it runs. */
  sql<T = unknown>(statement: string, ...params: unknown[]): T[];
  /** Insert a raw document into a collection table. */
  insertDoc(table: string, doc: Record<string, unknown>): void;
  close(): Promise<void>;
}

export interface ApiInit {
  method?: string;
  cookie?: string | null;
  body?: unknown;
  /** Default: the public base URL for non-GET requests; `null` sends none. */
  origin?: string | null;
  headers?: Record<string, string>;
}

export interface ScimInit {
  method?: string;
  body?: unknown;
  /** Default: the right token; `null` sends no Authorization header. */
  token?: string | null;
}

/** A SCIM token as long as the spec requires (N73: at least 32 characters). */
export function newScimToken(): string {
  return randomBytes(24).toString('hex');
}

function cookieFrom(res: Response, name: string): string | null {
  for (const header of res.headers.getSetCookie()) {
    const [pair] = header.split(';');
    const eq = pair.indexOf('=');
    if (pair.slice(0, eq).trim() === name) {
      const value = pair.slice(eq + 1).trim();
      return value ? `${name}=${value}` : null;
    }
  }
  return null;
}

export async function startOrgServer(
  options: { bootstrapAdmins?: string[] } = {},
): Promise<OrgServer> {
  const dataDir = mkdtempSync(join(tmpdir(), 'qti-org-'));
  const stub = await startOidcStub();
  const port = await freePort();
  const url = `http://127.0.0.1:${port}`;
  const scimToken = newScimToken();
  const env: Record<string, string> = {
    ORG_OIDC_ISSUER: stub.issuer,
    ORG_OIDC_CLIENT_ID: stub.clientId,
    ORG_OIDC_CLIENT_SECRET: stub.clientSecret,
    ORG_PUBLIC_BASE_URL: url,
    ORG_SCIM_TOKEN: scimToken,
  };
  if (options.bootstrapAdmins?.length) {
    env.ORG_BOOTSTRAP_ADMINS = options.bootstrapAdmins.join(',');
  }
  let backend: Backend;
  try {
    backend = await boot(dataDir, { env, port });
  } catch (error) {
    await stub.close();
    throw error;
  }

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const Database = require('better-sqlite3') as typeof import('better-sqlite3');
  const db = new Database(join(dataDir, 'app.sqlite'));
  db.pragma('busy_timeout = 5000');

  const api = (path: string, init: ApiInit = {}) => {
    const method = init.method ?? 'GET';
    const headers: Record<string, string> = { ...init.headers };
    if (init.cookie) headers.Cookie = init.cookie;
    const origin =
      init.origin === undefined
        ? method === 'GET' || method === 'HEAD'
          ? null
          : url
        : init.origin;
    if (origin) headers.Origin = origin;
    let body: string | undefined;
    if (init.body !== undefined) {
      headers['Content-Type'] ??= 'application/json';
      body = JSON.stringify(init.body);
    }
    return fetch(`${url}${path}`, {
      method,
      headers,
      body,
      redirect: 'manual',
    });
  };

  const signInRoundTrip = async (user: StubUser | string | null) => {
    stub.signInAs(user);
    const login = await fetch(`${url}/auth/login`, { redirect: 'manual' });
    const oidcCookie = cookieFrom(login, 'qti_oidc');
    const toProvider = login.headers.get('location') ?? '';
    if (!toProvider.startsWith(stub.issuer)) {
      return { location: toProvider, cookie: null };
    }
    const authorize = await fetch(toProvider, { redirect: 'manual' });
    const toCallback = authorize.headers.get('location') ?? '';
    const callback = await fetch(toCallback, {
      redirect: 'manual',
      headers: oidcCookie ? { Cookie: oidcCookie } : {},
    });
    return {
      location: callback.headers.get('location') ?? '',
      cookie: cookieFrom(callback, 'qti_session'),
    };
  };

  return {
    backend,
    stub,
    url,
    scimToken,
    dataDir,
    signInRoundTrip,
    async signIn(user) {
      const { location, cookie } = await signInRoundTrip(user);
      if (!cookie) {
        throw new Error(`Sign-in failed: redirected to ${location}`);
      }
      return cookie;
    },
    api,
    scim(path, init = {}) {
      const headers: Record<string, string> = {};
      const token = init.token === undefined ? scimToken : init.token;
      if (token !== null) headers.Authorization = `Bearer ${token}`;
      let body: string | undefined;
      if (init.body !== undefined) {
        headers['Content-Type'] = 'application/scim+json';
        body = JSON.stringify(init.body);
      }
      return fetch(`${url}/scim/v2${path}`, {
        method: init.method ?? 'GET',
        headers,
        body,
      });
    },
    sql<T>(statement: string, ...params: unknown[]): T[] {
      const prepared = db.prepare(statement);
      if (prepared.reader) return prepared.all(...params) as T[];
      prepared.run(...params);
      return [];
    },
    insertDoc(table, doc) {
      const now = new Date().toISOString();
      db.prepare(`INSERT INTO "${table}" (doc) VALUES (?)`).run(
        JSON.stringify({
          id: randomUUID(),
          createdAt: now,
          updatedAt: now,
          ...doc,
        }),
      );
    },
    async close() {
      db.close();
      await stop(backend);
      await stub.close();
      rmSync(dataDir, { recursive: true, force: true });
    },
  };
}

/** A SCIM core User resource for `POST /scim/v2/Users`. */
export function scimUser(
  email: string,
  displayName: string,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  const [givenName, ...rest] = displayName.split(' ');
  return {
    schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'],
    userName: email,
    active: true,
    displayName,
    name: { givenName, familyName: rest.join(' ') },
    emails: [{ value: email, type: 'work', primary: true }],
    externalId: randomUUID(),
    ...extra,
  };
}
