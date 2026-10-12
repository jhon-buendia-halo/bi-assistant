import {
  Inject,
  Injectable,
  Logger,
  OnModuleInit,
  Optional,
} from '@nestjs/common';
import type { Request } from 'express';
import { createHash, randomBytes } from 'node:crypto';
import {
  ORG_SERVER_CONFIG,
  type OrgServerConfig,
} from '../../config/org-server.config';
import { ActivityService } from './activity.service';
import { readCookie, SESSION_COOKIE } from './auth-cookies';
import type { CurrentUser } from './entities/current-user.entity';
import type { AuthSessionDoc, UserDoc } from './entities/directory.entity';
import { AuthSessionsRepository } from './repositories/auth-sessions.repository';
import { DirectoryRepository } from './repositories/directory.repository';
import { RoleResolver } from './role-resolver';

/** An auth session ends after this long without a request (admin R9). */
export const SESSION_IDLE_MS = 8 * 60 * 60 * 1000;
/** ... or this long after sign-in, whichever comes first (admin R9). */
export const SESSION_MAX_MS = 7 * 24 * 60 * 60 * 1000;
/**
 * A local auth session has no idle limit and ends this long after sign-in
 * (admin R71; data-model 3.14.6).
 */
export const LOCAL_SESSION_MAX_MS = 30 * 24 * 60 * 60 * 1000;
/** `lastSeenAt` is bumped at most once a minute (data-model 3.14.6). */
const TOUCH_INTERVAL_MS = 60_000;

export const hashToken = (token: string) =>
  createHash('sha256').update(token).digest('hex');

/** A user who may sign in and use the app: active and not removed. */
export const isUsable = (user: UserDoc | null): user is UserDoc =>
  !!user && user.active && !user.scimDeleted;

/**
 * Auth sessions (admin R8, R9, R16, R71; data-model 3.14.6): an opaque
 * 32-byte token, of which the store keeps only the SHA-256. On an org server
 * it travels in the `qti_session` cookie; in local mode as
 * `Authorization: Bearer <token>`, never as a cookie.
 */
@Injectable()
export class AuthSessionsService implements OnModuleInit {
  private readonly logger = new Logger(AuthSessionsService.name);

  constructor(
    private readonly sessions: AuthSessionsRepository,
    private readonly directory: DirectoryRepository,
    private readonly roles: RoleResolver,
    private readonly activity: ActivityService,
    @Optional()
    @Inject(ORG_SERVER_CONFIG)
    private readonly config: OrgServerConfig | null = null,
  ) {}

  /** Expired and idle sessions are swept at startup, in both modes. */
  async onModuleInit(): Promise<void> {
    const now = Date.now();
    let swept = 0;
    for (const session of await this.sessions.all()) {
      if (this.ended(session, now)) {
        swept += await this.sessions.delete(session.id);
      }
    }
    if (swept) this.logger.log(`Swept ${swept} ended auth session(s)`);
  }

  /** Start an auth session for `user`; returns the token. */
  async create(user: UserDoc, userAgent?: string): Promise<string> {
    const token = randomBytes(32).toString('base64url');
    const now = Date.now();
    const session: AuthSessionDoc = {
      id: hashToken(token),
      userId: user.id,
      lastSeenAt: new Date(now).toISOString(),
      expiresAt: new Date(
        now + (this.config ? SESSION_MAX_MS : LOCAL_SESSION_MAX_MS),
      ).toISOString(),
    };
    if (userAgent) session.userAgent = userAgent.slice(0, 200);
    await this.sessions.insert(session);
    return token;
  }

  /**
   * The request's token: the `qti_session` cookie on an org server, the
   * bearer token in local mode (admin R71). Each mode ignores the other's.
   */
  tokenOf(req: Request): string | undefined {
    if (this.config) return readCookie(req, SESSION_COOKIE);
    const match = /^Bearer\s+(.+)$/i.exec(req.headers?.authorization ?? '');
    return match?.[1].trim() || undefined;
  }

  /** The session behind the request's token, if it is still valid. */
  async sessionOf(req: Request): Promise<AuthSessionDoc | null> {
    const token = this.tokenOf(req);
    if (!token) return null;
    const session = await this.sessions.byId(hashToken(token));
    if (!session) return null;
    if (this.ended(session, Date.now())) {
      await this.sessions.delete(session.id);
      return null;
    }
    return session;
  }

  /**
   * The user a request runs as, or `null` when it has no valid auth session
   * (admin R11). Also bumps `lastSeenAt` and records the day's activity.
   */
  async userForRequest(req: Request): Promise<CurrentUser | null> {
    const session = await this.sessionOf(req);
    if (!session) return null;
    const user = await this.directory.userById(session.userId);
    if (!isUsable(user)) {
      await this.sessions.deleteAllOf(session.userId);
      return null;
    }
    const now = Date.now();
    if (now - Date.parse(session.lastSeenAt) >= TOUCH_INTERVAL_MS) {
      await this.sessions.touch(session.id, new Date(now).toISOString());
    }
    await this.activity.markActive(user);
    return this.roles.currentUserFor(user);
  }

  async end(sessionId: string): Promise<void> {
    await this.sessions.delete(sessionId);
  }

  /** Deactivation ends every session of the user at once (admin R16). */
  async endAllOf(userId: string): Promise<void> {
    await this.sessions.deleteAllOf(userId);
  }

  /** Local sessions have no idle limit (admin R71). */
  private ended(session: AuthSessionDoc, now: number): boolean {
    if (Date.parse(session.expiresAt) <= now) return true;
    return (
      !!this.config && Date.parse(session.lastSeenAt) + SESSION_IDLE_MS <= now
    );
  }
}
