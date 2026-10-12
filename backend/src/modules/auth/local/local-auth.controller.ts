import {
  Body,
  Controller,
  Get,
  HttpCode,
  NotFoundException,
  Post,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import {
  LocalModeOnly,
  Public,
} from '../../../common/decorators/auth-requirement.decorators';
import { ActivityService } from '../activity.service';
import { AuthSessionsService, isUsable } from '../auth-sessions.service';
import type { MeView } from '../entities/current-user.entity';
import type { UserDoc } from '../entities/directory.entity';
import { toMeView } from '../me.controller';
import type { RoleId } from '../permissions';
import { DirectoryRepository } from '../repositories/directory.repository';
import { initialsOf, RoleResolver } from '../role-resolver';

/** One persona to sign in as (api.md 91). */
export interface LocalSignInUser {
  id: string;
  displayName: string;
  email: string | null;
  initials: string;
  roles: RoleId[];
}

/** The order roles are listed in on the sign-in page (admin R70). */
const ROLE_ORDER: RoleId[] = [
  'platform-admin',
  'approver',
  'data-owner',
  'maker',
];

/** Active, not removed and not released: who may sign in (data-model 3.14.1). */
const canSignIn = (user: UserDoc | null): user is UserDoc =>
  isUsable(user) && user.releasedUserName === undefined;

/**
 * Sign-in and sign-out of local mode (admin R69-R73; api.md 91-93; ADR-0012):
 * a persona signs in without a password, and the auth-session token travels
 * as `Authorization: Bearer <token>`, never as a cookie. Public: these
 * routes run without an auth session. They answer 404 on an org server.
 */
@Controller('auth/local')
@Public()
@LocalModeOnly()
export class LocalAuthController {
  constructor(
    private readonly directory: DirectoryRepository,
    private readonly roles: RoleResolver,
    private readonly sessions: AuthSessionsService,
    private readonly activity: ActivityService,
  ) {}

  /** 91: the personas, sorted by display name, with their roles. */
  @Get('users')
  async users(): Promise<{ users: LocalSignInUser[] }> {
    const users = (await this.directory.allUsers()).filter(canSignIn);
    const listed: LocalSignInUser[] = [];
    for (const user of users) {
      const held = new Set(
        (await this.roles.heldRoles(user)).map((r) => r.role),
      );
      listed.push({
        id: user.id,
        displayName: user.displayName,
        email: user.email ?? null,
        initials: initialsOf(user),
        roles: ROLE_ORDER.filter((role) => held.has(role)),
      });
    }
    listed.sort((a, b) =>
      a.displayName.localeCompare(b.displayName, undefined, {
        sensitivity: 'base',
      }),
    );
    return { users: listed };
  }

  /** 92: sign in as a persona, without a password. */
  @Post('sign-in')
  @HttpCode(200)
  async signIn(
    @Body() body: { userId?: unknown } | undefined,
    @Req() req: Request,
  ): Promise<{ ok: true; message: string; token: string; me: MeView }> {
    const userId = typeof body?.userId === 'string' ? body.userId : '';
    const found = userId ? await this.directory.userById(userId) : null;
    if (!canSignIn(found)) {
      throw new NotFoundException(`User ${userId} not found`);
    }
    const token = await this.sessions.create(found, req.headers['user-agent']);
    const user =
      (await this.directory.updateUser(found.id, {
        lastSignInAt: new Date().toISOString(),
      })) ?? found;
    await this.activity.record('sign-in', {
      actorId: user.id,
      subjectId: user.id,
    });
    return {
      ok: true,
      message: 'Signed in',
      token,
      me: toMeView('local', await this.roles.currentUserFor(user)),
    };
  }

  /** 93: end the caller's auth session, if any; harmless twice. */
  @Post('sign-out')
  @HttpCode(200)
  async signOut(@Req() req: Request): Promise<{ ok: true; message: string }> {
    const session = await this.sessions.sessionOf(req);
    if (session) {
      await this.sessions.end(session.id);
      await this.activity.record('sign-out', {
        actorId: session.userId,
        subjectId: session.userId,
      });
    }
    return { ok: true, message: 'Signed out' };
  }
}
