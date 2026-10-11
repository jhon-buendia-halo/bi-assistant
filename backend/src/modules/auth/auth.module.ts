import { Global, MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { APP_GUARD, DiscoveryModule } from '@nestjs/core';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { CurrentUserMiddleware } from './current-user.middleware';
import { CurrentUserService } from './current-user.service';
import { MeController } from './me.controller';

/**
 * Who calls and what they may do (admin capability; ADR-0010, ADR-0011):
 * the current user on `AsyncLocalStorage`, the global permission guard and
 * `GET /me`. Global so any module can ask for the current user.
 */
@Global()
@Module({
  imports: [DiscoveryModule],
  controllers: [MeController],
  providers: [
    CurrentUserService,
    { provide: APP_GUARD, useClass: PermissionsGuard },
  ],
  exports: [CurrentUserService],
})
export class AuthModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(CurrentUserMiddleware).forRoutes('{*path}');
  }
}
