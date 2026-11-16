/**
 * Review a Website's browser work against a real browser and a small local
 * site with known defects (agents.md 5.19). Runs only when
 * `SITE_REVIEW_BROWSER_PATH` names a Chromium executable (Playwright's, in
 * CI and locally); skipped otherwise.
 */
jest.mock('../../mastra/session-workspaces', () => {
  const path = jest.requireActual<typeof import('path')>('path');
  const os = jest.requireActual<typeof import('os')>('os');
  const root = path.join(os.tmpdir(), `site-review-spec-${process.pid}`);
  return { sessionWorkspacePath: (id: string) => path.join(root, id) };
});
jest.mock('../sessions/workspace-files', () => {
  const path = jest.requireActual<typeof import('path')>('path');
  const os = jest.requireActual<typeof import('os')>('os');
  const fs = jest.requireActual<typeof import('fs/promises')>('fs/promises');
  const root = path.join(os.tmpdir(), `site-review-spec-${process.pid}`);
  return {
    writeWorkspaceFile: async (
      id: string,
      file: string,
      data: string | Buffer,
    ) => {
      const target = path.join(root, id, file);
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, data);
    },
  };
});

import { createServer, type Server } from 'http';
import type { AddressInfo } from 'net';
import { rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { CryptoService } from '../../infrastructure/crypto/crypto.service';
import { preparedSessionOf } from '../../mastra/workflows/review-website.steps';
import type { PreparedSession } from '../../mastra/workflows/review-website.schemas';
import { SiteReviewService } from './site-review.service';
import type {
  SiteSignInDoc,
  SiteSignInsRepository,
} from './site-signins.repository';

const browserPath = process.env.SITE_REVIEW_BROWSER_PATH;
const describeWithBrowser = browserPath ? describe : describe.skip;

const PAGE = (title: string, body: string) =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title>
  <style>body{font-family:sans-serif;margin:0;padding:16px} .bar{position:fixed;left:0;right:0;bottom:0;height:140px;background:#222;color:#fff}</style></head>
  <body>${body}</body></html>`;

const NAV = `<nav><a href="/">Home</a> <a href="/items/1">Item 1</a> <a href="/items/2">Item 2</a> <a href="/about">About</a> <a href="/logout">Sign out</a> <a href="/broken">Broken</a> <a href="/files/terms.pdf">Terms</a> <a href="https://elsewhere.example.org/">Elsewhere</a></nav>`;

/** The fixture site: a home page, an item template, a 500 and a sign-out. */
function site(visits: string[]): Server {
  return createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://localhost');
    visits.push(url.pathname);
    const send = (status: number, html: string, headers = {}) => {
      response.writeHead(status, { 'content-type': 'text/html', ...headers });
      response.end(html);
    };
    const signedIn = (request.headers.cookie ?? '').includes('session=ok');
    switch (url.pathname) {
      case '/':
        return send(
          200,
          PAGE(
            'Home',
            `${NAV}<h1>Shop</h1>
            <table style="width:900px"><tr><td>A table wider than a phone</td></tr></table>
            <button style="width:16px;height:16px;padding:0" aria-label="Close"></button>
            <input type="text" placeholder="Search">`,
          ),
        );
      case '/items/1':
      case '/items/2':
        return send(
          200,
          PAGE(
            'Item',
            `${NAV}<h1>Hi Forename</h1><img src="/missing.png" alt="Product">`,
          ),
        );
      case '/about':
        // A cookie bar over the submit button. (On a page that also scrolls
        // sideways a phone zooms out, and the bar no longer covers it.)
        return send(
          200,
          PAGE(
            'About',
            `${NAV}<h1>About us</h1>
            <form style="position:absolute;bottom:40px;left:16px"><button type="submit" id="buy">Buy now</button></form>
            <div class="bar" id="cookies">We use cookies</div>`,
          ),
        );
      case '/broken':
        return send(500, PAGE('Error', '<h1>Server error</h1>'));
      case '/logout':
        return send(200, PAGE('Signed out', '<h1>Signed out</h1>'), {
          'set-cookie': 'session=; Max-Age=0; Path=/',
        });
      case '/login':
        return send(
          200,
          PAGE(
            'Sign in',
            '<form><label>Password <input type="password"></label></form>',
          ),
        );
      case '/account':
      case '/account/orders':
        return signedIn
          ? send(
              200,
              PAGE(
                'Account',
                `<a href="/account/orders">Orders</a> <a href="/account/expire">Expire</a>`,
              ),
            )
          : send(302, '', { location: '/login' });
      case '/account/expire':
        // Ends the session, as a site does when its sign-in times out.
        return send(302, '', {
          location: '/account/orders',
          'set-cookie': 'session=; Max-Age=0; Path=/',
        });
      default:
        response.writeHead(404, { 'content-type': 'text/plain' });
        response.end('not found');
    }
  });
}

/** An in-memory sign-ins store. */
function signIns(): SiteSignInsRepository & {
  docs: Map<string, SiteSignInDoc>;
} {
  const docs = new Map<string, SiteSignInDoc>();
  return {
    docs,
    get: (origin: string) => Promise.resolve(docs.get(origin) ?? null),
    put: (doc: SiteSignInDoc) => {
      docs.set(doc.origin, doc);
      return Promise.resolve();
    },
    delete: (origin: string) => Promise.resolve(docs.delete(origin) ? 1 : 0),
  } as unknown as SiteSignInsRepository & { docs: Map<string, SiteSignInDoc> };
}

describeWithBrowser(
  'SiteReviewService in a real browser (agents.md 5.19)',
  () => {
    jest.setTimeout(120_000);
    const visits: string[] = [];
    let server: Server;
    let origin: string;
    const previousSecret = process.env.APP_SECRET;

    beforeAll(async () => {
      process.env.APP_SECRET = 'site-review-spec-secret';
      server = site(visits);
      await new Promise<void>((resolve) =>
        server.listen(0, '127.0.0.1', resolve),
      );
      origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    });

    afterAll(async () => {
      process.env.APP_SECRET = previousSecret;
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await rm(join(tmpdir(), `site-review-spec-${process.pid}`), {
        recursive: true,
        force: true,
      });
    });

    function session(patch: Partial<PreparedSession> = {}): PreparedSession {
      return {
        ...preparedSessionOf({
          url: `${origin}/`,
          maxPages: 20,
          maxDepth: 2,
          mobile: true,
          tablet: false,
          laptop: true,
          desktop: false,
          exclude: '',
          needsSignIn: false,
          loginUrl: '',
        }),
        signedIn: false,
        ...patch,
      };
    }

    const io = (progress: string[] = []) => ({
      sessionId: 'run-spec',
      signal: new AbortController().signal,
      progress: (line: string) => progress.push(line),
    });

    it('crawls the site, measures every page on every screen, and crops the evidence', async () => {
      const service = new SiteReviewService(signIns(), new CryptoService());
      const work = service.forRun(io());
      const prepared = session();
      const found = await work.discoverPages(prepared);
      const paths = found.pages.map((page) => new URL(page.url).pathname);
      expect(paths).toEqual(['/', '/items/1', '/items/2', '/about', '/broken']);
      expect(found.skippedLinks).toEqual([`${origin}/logout`]);
      expect(found.capped).toBe(false);
      expect(found.sessionLost).toBeNull();
      expect(visits).not.toContain('/logout');
      expect(visits).not.toContain('/files/terms.pdf');
      expect(
        found.pages.find((page) => page.url.endsWith('/broken'))?.status,
      ).toBe(500);
      expect(new Set(found.pages.map((page) => page.group))).toEqual(
        new Set(['/', '/items/:id', '/about', '/broken']),
      );

      const checked = await work.captureAndCheck({ ...prepared, ...found });
      expect(checked.captures).toHaveLength(10);
      expect(checked.captures.every((capture) => capture.screenshot)).toBe(
        true,
      );
      const rules = (screen: string) =>
        new Set(
          checked.findings
            .filter((finding) => finding.screen === screen)
            .map((finding) => finding.rule),
        );
      const mobile = rules('mobile');
      for (const rule of [
        'overflow-x',
        'covered-element',
        'tap-target',
        'broken-image',
        'placeholder-text',
        'http-error',
      ]) {
        expect({ rule, found: mobile.has(rule) }).toEqual({
          rule,
          found: true,
        });
      }
      expect([...mobile].some((rule) => rule.startsWith('axe:'))).toBe(true);
      // The item template's findings are one finding for both pages.
      const broken = checked.findings.find(
        (finding) =>
          finding.rule === 'broken-image' && finding.screen === 'mobile',
      );
      expect(broken?.group).toBe('/items/:id');
      expect(broken?.pages).toHaveLength(2);
      // The covered submit button is critical and comes first.
      expect(checked.findings[0]).toEqual(
        expect.objectContaining({
          rule: 'covered-element',
          severity: 'critical',
        }),
      );
      expect(checked.findings[0].crop).toMatch(/\.crop\.jpg$/);
      // A thumbnail per group and screen, read back as data URIs.
      const thumbnails = checked.captures
        .map((capture) => capture.thumbnail)
        .filter((path): path is string => path !== null);
      expect(thumbnails).toHaveLength(8);
      const images = await work.readImages([...thumbnails, '../escape.jpg']);
      expect(Object.keys(images)).toHaveLength(8);
      expect(Object.values(images)[0]).toMatch(/^data:image\/jpeg;base64,/);
    });

    it('crawls with a saved sign-in, and stops when the site signs it out', async () => {
      const store = signIns();
      const crypto = new CryptoService();
      const host = new URL(origin).hostname;
      await store.put({
        origin,
        capturedAt: new Date().toISOString(),
        storageStateCiphertext: crypto.encrypt(
          JSON.stringify({
            cookies: [
              {
                name: 'session',
                value: 'ok',
                domain: host,
                path: '/',
                expires: -1,
                httpOnly: false,
                secure: false,
                sameSite: 'Lax',
              },
            ],
            origins: [],
          }),
        ),
      });
      const service = new SiteReviewService(store, crypto);
      const work = service.forRun(io());
      const loginUrl = `${origin}/login`;
      expect(
        await work.checkSignIn({ url: `${origin}/account`, loginUrl }),
      ).toEqual({ signedIn: true });
      expect(
        await new SiteReviewService(signIns(), crypto)
          .forRun(io())
          .checkSignIn({ url: `${origin}/account`, loginUrl }),
      ).toEqual({ signedIn: false });

      const found = await work.discoverPages(
        session({
          url: `${origin}/account`,
          loginUrl,
          needsSignIn: true,
          signedIn: true,
        }),
      );
      // Orders loads signed in; the link that ends the session lands on the
      // sign-in page, and the crawl stops there.
      expect(found.sessionLost).toBe(`${origin}/account/expire`);
      expect(found.capped).toBe(false);
    });
  },
);
