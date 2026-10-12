import {
  Inject,
  Injectable,
  Optional,
  UnauthorizedException,
} from '@nestjs/common';
import { AsyncLocalStorage } from 'node:async_hooks';
import {
  ORG_SERVER_CONFIG,
  type OrgServerConfig,
} from '../../config/org-server.config';
import type { AuthMode, CurrentUser } from './entities/current-user.entity';
import { permissionsForRoles } from './permissions';

/**
 * Demo User, the local persona with id `local` (admin R69; ADR-0012): always
 * Platform admin as local mode's bootstrap admin (R18), so holds every
 * permission (R21). Items stored in local mode before it had sign-in belong
 * to them (admin R33, M13). Requests run as the signed-in persona; this
 * constant is for code that runs outside any request on purpose (the eval
 * CLI).
 */
export const LOCAL_USER: CurrentUser = Object.freeze({
  id: 'local',
  displayName: 'Demo User',
  email: 'demo@local.test',
  initials: 'DU',
  roles: [
    { role: 'user', source: 'implicit' },
    { role: 'platform-admin', source: 'bootstrap' },
  ],
  permissions: permissionsForRoles(['user', 'platform-admin']),
}) as CurrentUser;

/**
 * Who the current request runs as (ADR-0011). The user is held in an
 * `AsyncLocalStorage`, so streams, tool calls and background work started
 * inside a request keep it without request-scoped providers (admin R32).
 *
 * The mode is fixed at startup (admin R1): org server mode when the `ORG_*`
 * configuration is present. In both modes the current-user middleware runs
 * each request as its auth session's user (admin R11, R71), and code outside
 * a request runs as nobody unless it calls `runAs`.
 */
@Injectable()
export class CurrentUserService {
  private readonly storage = new AsyncLocalStorage<CurrentUser>();

  readonly mode: AuthMode;

  constructor(
    @Optional()
    @Inject(ORG_SERVER_CONFIG)
    config: OrgServerConfig | null = null,
  ) {
    this.mode = config ? 'org' : 'local';
  }

  /**
   * The user the current code runs as; `undefined` means "not signed in"
   * (and outside any request), in both modes.
   */
  current(): CurrentUser | undefined {
    return this.storage.getStore();
  }

  /** Run `fn` (and everything it starts) as `user`. */
  runAs<T>(user: CurrentUser, fn: () => T): T {
    return this.storage.run(user, fn);
  }

  /**
   * The id private items and in-memory jobs are owned by (data-model 3.15):
   * the current user's id (`local` for Demo User). Throws 401 when nobody is
   * signed in, so private data is never reached without an owner.
   */
  ownerKey(): string {
    const user = this.current();
    if (!user) throw new UnauthorizedException('Sign in required');
    return user.id;
  }

  /**
   * The `ownerId` a private collection is scoped to: the caller's id, in
   * both modes (admin R29, R33).
   */
  ownerScope(): string {
    return this.ownerKey();
  }

  /**
   * Start background work as the current user (admin R32): the returned
   * function runs `fn` as the user captured now, whatever context it is
   * later called from.
   */
  bind<A extends unknown[], R>(fn: (...args: A) => R): (...args: A) => R {
    const user = this.current();
    if (!user) throw new UnauthorizedException('Sign in required');
    return (...args: A) => this.runAs(user, () => fn(...args));
  }
}
