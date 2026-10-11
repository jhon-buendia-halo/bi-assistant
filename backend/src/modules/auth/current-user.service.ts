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
 * The implicit user of local mode (admin R2, R21): holds every permission.
 * Items stored without an owner belong to them (admin R33).
 */
export const LOCAL_USER: CurrentUser = Object.freeze({
  id: 'local',
  displayName: 'Demo User',
  email: null,
  initials: 'D',
  roles: [
    { role: 'user', source: 'implicit' },
    { role: 'platform-admin', source: 'implicit' },
  ],
  permissions: permissionsForRoles(['user', 'platform-admin']),
}) as CurrentUser;

/**
 * Who the current request runs as (ADR-0011). The user is held in an
 * `AsyncLocalStorage`, so streams, tool calls and background work started
 * inside a request keep it without request-scoped providers (admin R32).
 *
 * The mode is fixed at startup (admin R1): org server mode when the `ORG_*`
 * configuration is present. In local mode every request and any code outside
 * a request runs as `LOCAL_USER`; in org server mode the current-user
 * middleware runs each request as its auth session's user, and code outside
 * a request runs as nobody.
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
   * The user the current code runs as. Outside a request in local mode that
   * is the local user; `undefined` means "not signed in" (org server mode).
   */
  current(): CurrentUser | undefined {
    return (
      this.storage.getStore() ??
      (this.mode === 'local' ? LOCAL_USER : undefined)
    );
  }

  /** Only the user set by `runAs`, without the local-mode fallback. */
  storedUser(): CurrentUser | undefined {
    return this.storage.getStore();
  }

  /** Run `fn` (and everything it starts) as `user`. */
  runAs<T>(user: CurrentUser, fn: () => T): T {
    return this.storage.run(user, fn);
  }

  /**
   * The id private items and in-memory jobs are owned by (data-model 3.15):
   * the current user's id, `local` for the local user. Throws 401 when
   * nobody is signed in, so private data is never reached without an owner.
   */
  ownerKey(): string {
    const user = this.current();
    if (!user) throw new UnauthorizedException('Sign in required');
    return user.id;
  }

  /**
   * The `ownerId` a private collection is scoped to: `null` for the local
   * user, whose items are never stamped or filtered (admin R33).
   */
  ownerScope(): string | null {
    const id = this.ownerKey();
    return id === LOCAL_USER.id ? null : id;
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
