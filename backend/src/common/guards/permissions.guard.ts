import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  OnModuleInit,
  Optional,
  RequestMethod,
  UnauthorizedException,
} from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { DiscoveryService, MetadataScanner, Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { createHash, timingSafeEqual } from 'node:crypto';
import {
  ORG_SERVER_CONFIG,
  type OrgServerConfig,
} from '../../config/org-server.config';
import { ActivityService } from '../../modules/auth/activity.service';
import { CurrentUserService } from '../../modules/auth/current-user.service';
import { ScimError } from '../../modules/auth/scim/scim-error';
import {
  AUTH_REQUIREMENT_KEY,
  type AuthRequirement,
  LOCAL_MODE_ONLY_KEY,
  ORG_SERVER_ONLY_KEY,
} from '../decorators/auth-requirement.decorators';

const digest = (value: string) => createHash('sha256').update(value).digest();

/** A route handler or a controller class: what route metadata sits on. */
type RouteTarget = ReturnType<ExecutionContext['getHandler']>;

/**
 * The one server-side permission check (admin R23, R24; api.md 1.9),
 * registered as a global `APP_GUARD`. It runs before every handler: public
 * routes pass, SCIM routes need the SCIM bearer token (401 otherwise), and
 * every other route needs a signed-in caller (401) holding its permission
 * (403). Routes marked `@OrgServerOnly()` answer 404 in local mode, and
 * routes marked `@LocalModeOnly()` 404 on an org server (admin R73).
 *
 * At startup it walks every controller route and refuses to start when one
 * declares no requirement, so a new route cannot ship unguarded.
 */
@Injectable()
export class PermissionsGuard implements CanActivate, OnModuleInit {
  constructor(
    private readonly reflector: Reflector,
    private readonly currentUser: CurrentUserService,
    private readonly discovery: DiscoveryService,
    private readonly metadataScanner: MetadataScanner,
    @Optional() private readonly activity?: ActivityService,
    @Optional()
    @Inject(ORG_SERVER_CONFIG)
    private readonly config: OrgServerConfig | null = null,
  ) {}

  onModuleInit(): void {
    const unmarked = this.unmarkedRoutes();
    if (unmarked.length > 0) {
      throw new Error(
        `Every API route must declare @RequirePermission(), @Public() or @ScimAuth() (admin R23). Missing on: ${unmarked.join(', ')}`,
      );
    }
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const handler = context.getHandler();
    const controller = context.getClass();
    if (
      this.currentUser.mode === 'local' &&
      this.reflector.getAllAndOverride<boolean>(ORG_SERVER_ONLY_KEY, [
        handler,
        controller,
      ])
    ) {
      throw new NotFoundException('Not available in local mode');
    }
    if (
      this.currentUser.mode === 'org' &&
      this.reflector.getAllAndOverride<boolean>(LOCAL_MODE_ONLY_KEY, [
        handler,
        controller,
      ])
    ) {
      throw new NotFoundException('Not available in org server mode');
    }
    const requirement = this.requirementOf(handler, controller);
    // The startup check makes this unreachable for registered routes.
    if (!requirement) throw new ForbiddenException('Route has no permission');
    if (requirement.kind === 'public') return true;
    if (requirement.kind === 'scim') {
      this.checkScimToken(context.switchToHttp().getRequest<Request>());
      await this.activity?.recordScimRequest();
      return true;
    }

    const user = this.currentUser.current();
    if (!user) throw new UnauthorizedException('Sign in required');
    if (!user.permissions.includes(requirement.permission)) {
      throw new ForbiddenException(
        `Missing permission: ${requirement.permission}`,
      );
    }
    return true;
  }

  /**
   * `Authorization: Bearer <ORG_SCIM_TOKEN>`, compared in constant time
   * (admin R14, non-functional N73). A cookie never opens SCIM.
   */
  private checkScimToken(req: Request): void {
    const expected = this.config?.scimToken;
    const match = /^Bearer\s+(.+)$/i.exec(req.headers.authorization ?? '');
    if (
      !expected ||
      !match ||
      !timingSafeEqual(digest(match[1].trim()), digest(expected))
    ) {
      throw new ScimError(401, 'Missing or invalid SCIM bearer token');
    }
  }

  private requirementOf(
    handler: RouteTarget,
    controller: RouteTarget,
  ): AuthRequirement | undefined {
    return this.reflector.getAllAndOverride<AuthRequirement | undefined>(
      AUTH_REQUIREMENT_KEY,
      [handler, controller],
    );
  }

  /** `"<METHOD> <path> (<Controller>.<method>)"` for each route without a marker. */
  private unmarkedRoutes(): string[] {
    const unmarked: string[] = [];
    for (const wrapper of this.discovery.getControllers()) {
      const instance = wrapper.instance as object | undefined;
      const metatype = wrapper.metatype;
      if (!instance || !metatype) continue;
      const prototype = Object.getPrototypeOf(instance) as Record<
        string,
        unknown
      >;
      const prefix = this.pathOf(metatype);
      for (const name of this.metadataScanner.getAllMethodNames(prototype)) {
        const handler = prototype[name] as RouteTarget;
        const method = this.reflector.get<RequestMethod | undefined>(
          METHOD_METADATA,
          handler,
        );
        if (method === undefined) continue; // not a route handler
        if (this.requirementOf(handler, metatype)) continue;
        const path = [prefix, this.pathOf(handler)].filter(Boolean).join('/');
        unmarked.push(
          `${RequestMethod[method]} /${path} (${metatype.name}.${name})`,
        );
      }
    }
    return unmarked;
  }

  private pathOf(target: object): string {
    const raw = Reflect.getMetadata(PATH_METADATA, target) as
      string | string[] | undefined;
    const path = Array.isArray(raw) ? raw.join('|') : (raw ?? '');
    return path.replace(/^\/+|\/+$/g, '');
  }
}
