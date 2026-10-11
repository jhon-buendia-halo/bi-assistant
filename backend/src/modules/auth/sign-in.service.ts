import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  ORG_SERVER_CONFIG,
  type OrgServerConfig,
} from '../../config/org-server.config';
import { CryptoService } from '../../infrastructure/crypto/crypto.service';
import { ActivityService } from './activity.service';
import { OIDC_COOKIE_MAX_AGE_S } from './auth-cookies';
import { AuthSessionsService, isUsable } from './auth-sessions.service';
import type { UserDoc } from './entities/directory.entity';
import {
  OIDC_CLIENT,
  type OidcClaims,
  type OidcClient,
  type OidcRoundTrip,
} from './oidc/oidc-client';
import { DirectoryRepository } from './repositories/directory.repository';

/** The round trip sealed into the `qti_oidc` cookie (api.md 1.9). */
interface SealedRoundTrip extends OidcRoundTrip {
  returnTo: string;
  /** When the round trip started (epoch ms). */
  at: number;
}

/** How a callback ended; the controller turns it into cookies and a redirect. */
export type SignInOutcome =
  | { ok: true; token: string; returnTo: string }
  | { ok: false; error: 'failed' | 'deactivated' };

/** `returnTo` is kept only as a path inside the app (api.md 61). */
export function safeReturnTo(value: unknown): string {
  return typeof value === 'string' &&
    value.startsWith('/') &&
    !value.startsWith('//') &&
    !value.startsWith('/\\')
    ? value
    : '/';
}

const lower = (value: unknown) =>
  typeof value === 'string' && value.trim()
    ? value.trim().toLowerCase()
    : undefined;

/**
 * The OpenID Connect sign-in of org server mode (admin R6-R8, R12, R13, R16;
 * api.md 61-62): the round trip, then finding or creating the directory user
 * and starting their auth session.
 */
@Injectable()
export class SignInService {
  private readonly logger = new Logger(SignInService.name);

  constructor(
    @Inject(ORG_SERVER_CONFIG) private readonly config: OrgServerConfig,
    @Inject(OIDC_CLIENT) private readonly oidc: OidcClient,
    private readonly crypto: CryptoService,
    private readonly directory: DirectoryRepository,
    private readonly sessions: AuthSessionsService,
    private readonly activity: ActivityService,
  ) {}

  get redirectUri(): string {
    return `${this.config.publicBaseUrl}/auth/callback`;
  }

  /** The provider URL and the sealed round trip, or `null` when unreachable. */
  async start(
    returnTo: unknown,
  ): Promise<{ url: string; sealed: string } | null> {
    try {
      const { url, roundTrip } = await this.oidc.startSignIn(this.redirectUri);
      const sealed: SealedRoundTrip = {
        ...roundTrip,
        returnTo: safeReturnTo(returnTo),
        at: Date.now(),
      };
      return { url, sealed: this.crypto.encrypt(JSON.stringify(sealed)) };
    } catch (error) {
      this.logger.warn(
        `Sign-in could not reach the identity provider: ${(error as Error).message}`,
      );
      return null;
    }
  }

  async finish(
    query: Record<string, unknown>,
    sealed: string | undefined,
    userAgent?: string,
  ): Promise<SignInOutcome> {
    const roundTrip = this.unseal(sealed);
    if (!roundTrip || typeof query.error === 'string') {
      if (typeof query.error === 'string') {
        this.logger.warn(
          `The identity provider refused sign-in: ${query.error}`,
        );
      }
      return { ok: false, error: 'failed' };
    }
    let claims: OidcClaims;
    try {
      const callbackUrl = new URL(this.redirectUri);
      for (const [key, value] of Object.entries(query)) {
        if (typeof value === 'string') callbackUrl.searchParams.set(key, value);
      }
      claims = await this.oidc.finishSignIn(callbackUrl, roundTrip);
    } catch (error) {
      this.logger.warn(`Sign-in failed: ${(error as Error).message}`);
      return { ok: false, error: 'failed' };
    }

    const user = await this.findOrCreateUser(claims);
    if (!isUsable(user)) return { ok: false, error: 'deactivated' };
    const token = await this.sessions.create(user, userAgent);
    await this.activity.record('sign-in', {
      actorId: user.id,
      subjectId: user.id,
    });
    return { ok: true, token, returnTo: roundTrip.returnTo };
  }

  private unseal(sealed: string | undefined): SealedRoundTrip | null {
    if (!sealed) return null;
    try {
      const value = JSON.parse(this.crypto.decrypt(sealed)) as SealedRoundTrip;
      const fresh = Date.now() - value.at <= OIDC_COOKIE_MAX_AGE_S * 1000;
      return fresh && value.state && value.nonce && value.codeVerifier
        ? value
        : null;
    } catch {
      return null;
    }
  }

  /**
   * Match the directory user (admin R13): by the stored subject, else by
   * user name or email, case-insensitively. Otherwise add them just in time
   * (R12). Display name, email and the sign-in time are refreshed.
   */
  private async findOrCreateUser(claims: OidcClaims): Promise<UserDoc> {
    const subject =
      typeof claims.tid === 'string' && typeof claims.oid === 'string'
        ? `${claims.tid}:${claims.oid}`
        : claims.sub;
    const userName = lower(claims.preferred_username) ?? lower(claims.email);
    const email =
      lower(claims.email) ?? (userName?.includes('@') ? userName : undefined);
    const now = new Date().toISOString();
    const profile: Partial<UserDoc> = { lastSignInAt: now };
    if (email) profile.email = email;
    const name = typeof claims.name === 'string' ? claims.name.trim() : '';
    if (name) profile.displayName = name;
    if (typeof claims.given_name === 'string' && claims.given_name.trim()) {
      profile.givenName = claims.given_name.trim();
    }
    if (typeof claims.family_name === 'string' && claims.family_name.trim()) {
      profile.familyName = claims.family_name.trim();
    }

    const existing =
      (await this.directory.userBySubject(subject)) ??
      (await this.directory.userByNameOrEmail(
        [userName, email].filter((v): v is string => !!v),
      ));
    if (existing) {
      if (!existing.oidcSubject) profile.oidcSubject = subject;
      if (!isUsable(existing)) return existing;
      return (
        (await this.directory.updateUser(existing.id, profile)) ?? existing
      );
    }

    return this.directory.insertUser({
      userName: userName ?? subject.toLowerCase(),
      displayName: profile.displayName ?? userName ?? email ?? subject,
      active: true,
      source: 'jit',
      oidcSubject: subject,
      ...profile,
    });
  }
}
