import type { BrowserContext, Page, TestInfo } from '@playwright/test';
import { randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import path from 'node:path';
import { type OidcStub, startOidcStub } from '../../../backend/test/oidc-stub';
import {
  ADMIN,
  AdminClient,
  type OrgPerson,
  ScimClient,
  stubUser,
} from '../helpers/scim-client';
import {
  type CliProcess,
  type Env,
  WINDOW_SIZE,
  expect,
  startCli,
  stopCli,
  test as base,
} from './app.fixture';

/**
 * The Playwright `org` project's fixture (specs/system/tech-stack.md, "Org
 * server mode"): the npm CLI in org server mode against the OIDC stub the
 * backend tests use, a SCIM client and a bootstrap admin. Every page is its
 * own browser context, so two people can be signed in side by side.
 */

/** A running org server. */
export interface OrgApp {
  /** `ORG_PUBLIC_BASE_URL`, also the URL the browser opens. */
  readonly url: string;
  readonly dataDir: string;
  readonly stub: OidcStub;
  readonly scim: ScimClient;
  /** The bootstrap admin, calling the API (roles, shared data). */
  readonly admin: AdminClient;
  /** Who the next "Sign in with Microsoft" signs in as. */
  willSignInAs(person: OrgPerson): void;
  /** A new, isolated browser context on the app, not signed in. */
  newPage(): Promise<Page>;
  /** Runs SQL on the app's `app.sqlite` while it runs. */
  sql<T = unknown>(statement: string, ...params: unknown[]): T[];
  output(): { stdout: string; stderr: string };
  close(): Promise<void>;
}

export interface OrgAppOptions {
  /** `ORG_BOOTSTRAP_ADMINS`; default Avery Admin (`admin@contoso.test`). */
  bootstrapAdmins?: string[];
}

interface OrgFixtures {
  /** Starts an org server on `appDataDir`; closed after the test. */
  launchOrgApp: (options?: OrgAppOptions) => Promise<OrgApp>;
  /** One org server with the default bootstrap admin. */
  org: OrgApp;
  /** A browser page on `org`, on the sign-in page. */
  page: Page;
  /** Signs `page` in as `person` and waits for the app shell. */
  signInAs: (page: Page, person: OrgPerson) => Promise<void>;
  /** Another browser, signed in as `person`. */
  newBrowserAs: (person: OrgPerson) => Promise<Page>;
}

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

/** A port nothing listens on right now. */
function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

const signInButton = (page: Page) =>
  page.getByRole('button', { name: 'Sign in with Microsoft' });
const systemLogsButton = (page: Page) => page.getByLabel('Open system logs');

async function startOrgApp(
  newContext: () => Promise<BrowserContext>,
  dataDir: string,
  options: OrgAppOptions,
): Promise<OrgApp> {
  const stub = await startOidcStub();
  const stdout: string[] = [];
  const stderr: string[] = [];
  const contexts: BrowserContext[] = [];
  let cli: CliProcess;
  let url: string;
  let scim: ScimClient;
  try {
    const port = await freePort();
    url = `http://127.0.0.1:${port}`;
    const scimToken = randomBytes(24).toString('hex');
    const admins = options.bootstrapAdmins ?? [ADMIN.email];
    const env: Env = {
      ORG_OIDC_ISSUER: stub.issuer,
      ORG_OIDC_CLIENT_ID: stub.clientId,
      ORG_OIDC_CLIENT_SECRET: stub.clientSecret,
      ORG_PUBLIC_BASE_URL: url,
      ORG_SCIM_TOKEN: scimToken,
      ORG_BOOTSTRAP_ADMINS: admins.length ? admins.join(',') : undefined,
    };
    cli = await startCli(dataDir, env, port, stdout, stderr);
    scim = new ScimClient(url, scimToken);
  } catch (error) {
    await stub.close();
    throw error;
  }
  const admin = new AdminClient(url, stub, scim);
  let db: SqliteDatabase | null = null;

  return {
    url,
    dataDir,
    stub,
    scim,
    admin,
    willSignInAs(person) {
      stub.signInAs(stubUser(person));
    },
    async newPage() {
      const context = await newContext();
      contexts.push(context);
      const page = await context.newPage();
      await page.goto(url);
      await expect(signInButton(page).or(systemLogsButton(page))).toBeVisible();
      return page;
    },
    sql<T>(statement: string, ...params: unknown[]): T[] {
      if (!db) {
        const Database = requireFromBackend('better-sqlite3') as new (
          file: string,
        ) => SqliteDatabase;
        db = new Database(path.join(dataDir, 'app.sqlite'));
        db.pragma('busy_timeout = 5000');
      }
      const prepared = db.prepare(statement);
      if (prepared.reader) return prepared.all(...params) as T[];
      prepared.run(...params);
      return [];
    },
    output: () => ({ stdout: stdout.join(''), stderr: stderr.join('') }),
    async close() {
      for (const context of contexts) {
        await context.close().catch(() => undefined);
      }
      db?.close();
      await stopCli(cli.child);
      await stub.close();
    },
  };
}

async function attachOutput(app: OrgApp, testInfo: TestInfo, index: number) {
  const { stdout, stderr } = app.output();
  await testInfo.attach(`org-${index}-stdout.txt`, {
    body: Buffer.from(stdout.slice(-200_000)),
    contentType: 'text/plain',
  });
  await testInfo.attach(`org-${index}-stderr.txt`, {
    body: Buffer.from(stderr.slice(-200_000)),
    contentType: 'text/plain',
  });
}

export const test = base.extend<OrgFixtures>({
  launchOrgApp: async ({ webBrowser, appDataDir }, use, testInfo) => {
    const launched: OrgApp[] = [];
    await use(async (options = {}) => {
      const browser = await webBrowser();
      const app = await startOrgApp(
        () => browser.newContext({ viewport: WINDOW_SIZE }),
        appDataDir,
        options,
      );
      launched.push(app);
      return app;
    });
    for (const [index, app] of launched.entries()) {
      if (testInfo.status !== testInfo.expectedStatus) {
        await attachOutput(app, testInfo, index + 1);
      }
      await app.close().catch(() => undefined);
    }
  },

  org: async ({ launchOrgApp }, use) => {
    await use(await launchOrgApp());
  },

  page: async ({ org }, use) => {
    await use(await org.newPage());
  },

  signInAs: async ({ org }, use) => {
    await use(async (page, person) => {
      org.willSignInAs(person);
      if (!(await signInButton(page).isVisible())) await page.goto(org.url);
      await signInButton(page).click();
      await expect(systemLogsButton(page)).toBeVisible();
    });
  },

  newBrowserAs: async ({ org, signInAs }, use) => {
    await use(async (person) => {
      const page = await org.newPage();
      await signInAs(page, person);
      return page;
    });
  },
});

export { expect };
