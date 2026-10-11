import {
  Global,
  MiddlewareConsumer,
  Module,
  NestModule,
  type Provider,
} from '@nestjs/common';
import { APP_GUARD, DiscoveryModule } from '@nestjs/core';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { CurrentUserMiddleware } from './current-user.middleware';
import { CurrentUserService } from './current-user.service';
import {
  PRIVATE_COLLECTIONS,
  type DocStore,
} from '../../infrastructure/database/doc-store';
import { OwnedDocStore } from '../../infrastructure/database/owned-doc-store';
import { MeController } from './me.controller';

/** The owner-scoped private collections (data-model 3.15). */
const ownedStoreProviders: Provider[] = PRIVATE_COLLECTIONS.map((c) => ({
  provide: c.owned,
  inject: [c.raw, CurrentUserService],
  useFactory: (raw: DocStore<object>, users: CurrentUserService) =>
    new OwnedDocStore(raw, () => users.ownerScope()),
}));

/**
 * Who calls and what they may do (admin capability; ADR-0010, ADR-0011):
 * the current user on `AsyncLocalStorage`, the global permission guard and
 * `GET /me`, and the owner-scoped views of the private collections. Global
 * so any module can ask for the current user or inject an owned store.
 */
@Global()
@Module({
  imports: [DiscoveryModule],
  controllers: [MeController],
  providers: [
    CurrentUserService,
    { provide: APP_GUARD, useClass: PermissionsGuard },
    ...ownedStoreProviders,
  ],
  exports: [CurrentUserService, ...PRIVATE_COLLECTIONS.map((c) => c.owned)],
})
export class AuthModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(CurrentUserMiddleware).forRoutes('{*path}');
  }
}
