import {
  Global,
  MiddlewareConsumer,
  Module,
  NestModule,
  type Provider,
} from '@nestjs/common';
import { APP_GUARD, DiscoveryModule } from '@nestjs/core';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import {
  loadOrgServerConfig,
  ORG_SERVER_CONFIG,
  type OrgServerConfig,
} from '../../config/org-server.config';
import { CryptoModule } from '../../infrastructure/crypto/crypto.module';
import {
  PRIVATE_COLLECTIONS,
  type DocStore,
} from '../../infrastructure/database/doc-store';
import { OwnedDocStore } from '../../infrastructure/database/owned-doc-store';
import { ActivityService } from './activity.service';
import { AuthController } from './auth.controller';
import { AuthSessionsService } from './auth-sessions.service';
import { CurrentUserMiddleware } from './current-user.middleware';
import { CurrentUserService } from './current-user.service';
import { LocalAuthController } from './local/local-auth.controller';
import { LocalDirectoryService } from './local/local-directory.service';
import { MeController } from './me.controller';
import { OIDC_CLIENT } from './oidc/oidc-client';
import { OpenIdClientOidcClient } from './oidc/openid-client.oidc-client';
import { OriginCheckMiddleware } from './origin-check.middleware';
import { AuthSessionsRepository } from './repositories/auth-sessions.repository';
import { DirectoryRepository } from './repositories/directory.repository';
import { RolesRepository } from './repositories/roles.repository';
import { RoleResolver } from './role-resolver';
import { ScimDiscoveryController } from './scim/scim-discovery.controller';
import { ScimGroupsController } from './scim/scim-groups.controller';
import { ScimUsersController } from './scim/scim-users.controller';
import { ScimService } from './scim/scim.service';
import { SignInService } from './sign-in.service';

/** The owner-scoped private collections (data-model 3.15). */
const ownedStoreProviders: Provider[] = PRIVATE_COLLECTIONS.map((c) => ({
  provide: c.owned,
  inject: [c.raw, CurrentUserService],
  useFactory: (raw: DocStore<object>, users: CurrentUserService) =>
    new OwnedDocStore(raw, () => users.ownerScope()),
}));

/**
 * Who calls and what they may do (admin capability; ADR-0010, ADR-0011):
 * the mode and org server configuration, the current user on
 * `AsyncLocalStorage`, the global permission guard, `GET /me`, sign-in and
 * sign-out (org and local), the local personas, SCIM, the directory, roles, auth sessions and activity events,
 * and the owner-scoped views of the private collections. Global so any
 * module can ask for the current user or inject an owned store.
 */
@Global()
@Module({
  imports: [DiscoveryModule, CryptoModule],
  controllers: [
    MeController,
    AuthController,
    LocalAuthController,
    ScimDiscoveryController,
    ScimUsersController,
    ScimGroupsController,
  ],
  providers: [
    // Throws on a partial configuration, so the server does not start.
    { provide: ORG_SERVER_CONFIG, useFactory: () => loadOrgServerConfig() },
    {
      provide: OIDC_CLIENT,
      inject: [ORG_SERVER_CONFIG],
      useFactory: (config: OrgServerConfig | null) =>
        config ? new OpenIdClientOidcClient(config) : null,
    },
    CurrentUserService,
    DirectoryRepository,
    RolesRepository,
    AuthSessionsRepository,
    RoleResolver,
    ActivityService,
    AuthSessionsService,
    SignInService,
    ScimService,
    LocalDirectoryService,
    { provide: APP_GUARD, useClass: PermissionsGuard },
    ...ownedStoreProviders,
  ],
  exports: [
    ORG_SERVER_CONFIG,
    CurrentUserService,
    DirectoryRepository,
    RolesRepository,
    RoleResolver,
    ActivityService,
    AuthSessionsService,
    LocalDirectoryService,
    ...PRIVATE_COLLECTIONS.map((c) => c.owned),
  ],
})
export class AuthModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer
      .apply(OriginCheckMiddleware, CurrentUserMiddleware)
      .forRoutes('{*path}');
  }
}
