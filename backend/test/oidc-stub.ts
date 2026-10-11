/**
 * A hand-rolled OpenID Connect provider for tests of org server mode
 * (ADR-0011; specs/system/tech-stack.md, "Backend API-level e2e"). It speaks
 * just enough of the protocol for the app's sign-in: discovery, an authorize
 * endpoint that signs in whoever the test chose (no login page), a token
 * endpoint that checks PKCE and the client secret, a JWKS with one RS256 key
 * and an end-session endpoint. Node built-ins only, so the backend's Jest
 * tests and the frontend's Playwright helper both import it as it is.
 *
 *   const stub = await startOidcStub();
 *   stub.signInAs({ email: 'ada@contoso.test', name: 'Ada Lovelace' });
 *   // A sign-in name (UPN) and an email claim that differ:
 *   stub.signInAs({ preferredUsername: 'eve@contoso.test', email: 'ada@contoso.test' });
 *   // ORG_OIDC_ISSUER=stub.issuer, ORG_OIDC_CLIENT_ID=stub.clientId, ...
 *   await stub.close();
 */
import {
  createHash,
  createSign,
  generateKeyPairSync,
  randomBytes,
  type KeyObject,
} from 'node:crypto';
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http';
import type { AddressInfo } from 'node:net';

/**
 * Who the stub signs in. `email` or `preferredUsername` is required; each
 * defaults to the other, so `{ email }` alone is a person whose sign-in name
 * (UPN) is their email. The app matches people by `sub` and
 * `preferred_username`, never by `email` (admin R13).
 */
export interface StubUser {
  /** `email` claim. Default: the `preferredUsername`. */
  email?: string;
  /** Display name (`name` claim). Default: derived from the sign-in name. */
  name?: string;
  givenName?: string;
  familyName?: string;
  /** `preferred_username` claim (the UPN). Default: the email. */
  preferredUsername?: string;
  /** `sub` claim. Default: a stable hash of the `preferred_username`. */
  sub?: string;
  /** Entra ID tenant and object ids; the app then keys the user by `tid:oid`. */
  tid?: string;
  oid?: string;
}

export interface OidcStubOptions {
  /** Port to listen on; default a free one. */
  port?: number;
  clientId?: string;
  clientSecret?: string;
  /** The first user to sign in (as `signInAs`). */
  user?: StubUser | string;
}

export interface OidcStub {
  /** The issuer URL to pass as `ORG_OIDC_ISSUER`. */
  issuer: string;
  clientId: string;
  clientSecret: string;
  /**
   * Choose who the next sign-ins authenticate as (it sticks until changed).
   * A string is an email that is also the sign-in name. `null` makes the
   * authorize step answer `error=login_required`.
   */
  signInAs(user: StubUser | string | null): void;
  /** The next authorize request answers `error=<error>` instead (once). */
  failNextSignIn(error?: string): void;
  /** The `post_logout_redirect_uri` of each end-session call, in order. */
  readonly endSessionCalls: string[];
  close(): Promise<void>;
}

interface PendingCode {
  user: StubUser;
  nonce?: string;
  codeChallenge?: string;
  redirectUri: string;
  clientId: string;
  expiresAt: number;
}

const base64url = (value: Buffer | string) =>
  Buffer.from(value).toString('base64url');

function toStubUser(user: StubUser | string): StubUser {
  if (typeof user === 'string') return { email: user };
  if (!user.email && !user.preferredUsername) {
    throw new Error('A stub user needs an email or a preferredUsername');
  }
  return user;
}

/** "ada.lovelace@x" → "Ada Lovelace". */
function nameFromEmail(email: string): string {
  return email
    .split('@')[0]
    .split(/[._-]+/)
    .filter(Boolean)
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join(' ');
}

function claimsOf(user: StubUser): Record<string, string> {
  const userName = (user.preferredUsername ?? user.email)!;
  const email = user.email ?? user.preferredUsername!;
  const name = user.name ?? nameFromEmail(userName);
  const [given, ...rest] = name.split(' ');
  const claims: Record<string, string> = {
    sub:
      user.sub ??
      createHash('sha256').update(userName.toLowerCase()).digest('hex'),
    email,
    name,
    preferred_username: userName,
    given_name: user.givenName ?? given,
    family_name: user.familyName ?? rest.join(' '),
  };
  if (!claims.family_name) delete claims.family_name;
  if (user.tid) claims.tid = user.tid;
  if (user.oid) claims.oid = user.oid;
  return claims;
}

function signJwt(
  payload: Record<string, unknown>,
  key: KeyObject,
  kid: string,
): string {
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid }));
  const body = base64url(JSON.stringify(payload));
  const signer = createSign('RSA-SHA256');
  signer.update(`${header}.${body}`);
  return `${header}.${body}.${signer.sign(key).toString('base64url')}`;
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
  });
  res.end(JSON.stringify(body));
}

function redirect(res: ServerResponse, location: string): void {
  res.writeHead(302, { Location: location });
  res.end();
}

/** Start the stub; resolves once it listens on 127.0.0.1. */
export async function startOidcStub(
  options: OidcStubOptions = {},
): Promise<OidcStub> {
  const clientId = options.clientId ?? 'qti-test-client';
  const clientSecret = options.clientSecret ?? 'qti-test-client-secret';
  const { privateKey, publicKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
  });
  const kid = randomBytes(8).toString('hex');
  const codes = new Map<string, PendingCode>();
  const endSessionCalls: string[] = [];
  let currentUser: StubUser | null = options.user
    ? toStubUser(options.user)
    : null;
  let nextError: string | null = null;
  let issuer = '';

  const server = createServer((req, res) => {
    handle(req, res).catch((error: unknown) =>
      sendJson(res, 500, { error: 'server_error', detail: String(error) }),
    );
  });

  async function handle(
    req: IncomingMessage,
    res: ServerResponse,
  ): Promise<void> {
    const url = new URL(req.url ?? '/', issuer);
    const path = url.pathname.replace(/^\/oidc/, '');

    if (path === '/.well-known/openid-configuration') {
      sendJson(res, 200, {
        issuer,
        authorization_endpoint: `${issuer}/authorize`,
        token_endpoint: `${issuer}/token`,
        jwks_uri: `${issuer}/jwks`,
        end_session_endpoint: `${issuer}/logout`,
        response_types_supported: ['code'],
        subject_types_supported: ['public'],
        id_token_signing_alg_values_supported: ['RS256'],
        code_challenge_methods_supported: ['S256'],
        scopes_supported: ['openid', 'profile', 'email'],
        token_endpoint_auth_methods_supported: [
          'client_secret_post',
          'client_secret_basic',
        ],
      });
      return;
    }

    if (path === '/jwks') {
      const jwk = publicKey.export({ format: 'jwk' });
      sendJson(res, 200, {
        keys: [{ ...jwk, kid, alg: 'RS256', use: 'sig' }],
      });
      return;
    }

    if (path === '/authorize') {
      const q = url.searchParams;
      const redirectUri = q.get('redirect_uri');
      if (!redirectUri || q.get('client_id') !== clientId) {
        sendJson(res, 400, { error: 'invalid_request' });
        return;
      }
      const back = new URL(redirectUri);
      const state = q.get('state');
      if (state) back.searchParams.set('state', state);
      const error = nextError ?? (currentUser ? null : 'login_required');
      nextError = null;
      if (error) {
        back.searchParams.set('error', error);
        redirect(res, back.toString());
        return;
      }
      const code = randomBytes(24).toString('base64url');
      codes.set(code, {
        user: currentUser!,
        nonce: q.get('nonce') ?? undefined,
        codeChallenge: q.get('code_challenge') ?? undefined,
        redirectUri,
        clientId,
        expiresAt: Date.now() + 60_000,
      });
      back.searchParams.set('code', code);
      redirect(res, back.toString());
      return;
    }

    if (path === '/token' && req.method === 'POST') {
      const form = new URLSearchParams(await readBody(req));
      let id = form.get('client_id');
      let secret = form.get('client_secret');
      const basic = /^Basic (.+)$/i.exec(req.headers.authorization ?? '');
      if (basic) {
        const [user, pass] = Buffer.from(basic[1], 'base64')
          .toString('utf8')
          .split(':')
          .map((part) => decodeURIComponent(part));
        id = user;
        secret = pass;
      }
      if (id !== clientId || secret !== clientSecret) {
        sendJson(res, 401, { error: 'invalid_client' });
        return;
      }
      const code = form.get('code') ?? '';
      const pending = codes.get(code);
      codes.delete(code);
      if (
        form.get('grant_type') !== 'authorization_code' ||
        !pending ||
        pending.expiresAt < Date.now() ||
        pending.redirectUri !== form.get('redirect_uri')
      ) {
        sendJson(res, 400, { error: 'invalid_grant' });
        return;
      }
      const verifier = form.get('code_verifier') ?? '';
      const challenge = createHash('sha256').update(verifier).digest();
      if (
        !pending.codeChallenge ||
        base64url(challenge) !== pending.codeChallenge
      ) {
        sendJson(res, 400, {
          error: 'invalid_grant',
          error_description: 'PKCE verification failed',
        });
        return;
      }
      const now = Math.floor(Date.now() / 1000);
      const idToken = signJwt(
        {
          iss: issuer,
          aud: clientId,
          iat: now,
          exp: now + 600,
          ...(pending.nonce ? { nonce: pending.nonce } : {}),
          ...claimsOf(pending.user),
        },
        privateKey,
        kid,
      );
      sendJson(res, 200, {
        access_token: randomBytes(24).toString('base64url'),
        token_type: 'Bearer',
        expires_in: 3600,
        scope: 'openid profile email',
        id_token: idToken,
      });
      return;
    }

    if (path === '/logout') {
      const target = url.searchParams.get('post_logout_redirect_uri');
      endSessionCalls.push(target ?? '');
      if (target) {
        redirect(res, target);
      } else {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end('<!doctype html><title>Signed out</title><p>Signed out</p>');
      }
      return;
    }

    sendJson(res, 404, { error: 'not_found' });
  }

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port ?? 0, '127.0.0.1', () => resolve());
  });
  const { port } = server.address() as AddressInfo;
  issuer = `http://127.0.0.1:${port}/oidc`;

  return {
    issuer,
    clientId,
    clientSecret,
    endSessionCalls,
    signInAs(user) {
      currentUser = user === null ? null : toStubUser(user);
    },
    failNextSignIn(error = 'access_denied') {
      nextError = error;
    },
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}
