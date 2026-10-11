import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  OnModuleInit,
  RequestMethod,
  UnauthorizedException,
} from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { DiscoveryService, MetadataScanner, Reflector } from '@nestjs/core';
import { CurrentUserService } from '../../modules/auth/current-user.service';
import {
  AUTH_REQUIREMENT_KEY,
  type AuthRequirement,
} from '../decorators/auth-requirement.decorators';

/** A route handler or a controller class: what route metadata sits on. */
type RouteTarget = ReturnType<ExecutionContext['getHandler']>;

/**
 * The one server-side permission check (admin R23, R24; api.md 1.9),
 * registered as a global `APP_GUARD`. It runs before every handler: public
 * routes pass, SCIM routes are left to their token check, and every other
 * route needs a signed-in caller (401) holding its permission (403).
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
  ) {}

  onModuleInit(): void {
    const unmarked = this.unmarkedRoutes();
    if (unmarked.length > 0) {
      throw new Error(
        `Every API route must declare @RequirePermission(), @Public() or @ScimAuth() (admin R23). Missing on: ${unmarked.join(', ')}`,
      );
    }
  }

  canActivate(context: ExecutionContext): boolean {
    const requirement = this.requirementOf(
      context.getHandler(),
      context.getClass(),
    );
    // The startup check makes this unreachable for registered routes.
    if (!requirement) throw new ForbiddenException('Route has no permission');
    if (requirement.kind === 'public') return true;
    // Local mode has no SCIM token; the SCIM routes answer 404 there
    // (api.md 1.9). Org server mode checks the bearer token (BA-163 S3).
    if (requirement.kind === 'scim') return true;

    const user = this.currentUser.current();
    if (!user) throw new UnauthorizedException('Sign in required');
    if (!user.permissions.includes(requirement.permission)) {
      throw new ForbiddenException(
        `Missing permission: ${requirement.permission}`,
      );
    }
    return true;
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
