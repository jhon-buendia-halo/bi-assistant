import {
  Controller,
  Get,
  HttpCode,
  Inject,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import {
  OrgServerOnly,
  Public,
} from '../../common/decorators/auth-requirement.decorators';
import {
  ORG_SERVER_CONFIG,
  type OrgServerConfig,
} from '../../config/org-server.config';
import { ActivityService } from './activity.service';
import {
  clearCookie,
  OIDC_COOKIE,
  OIDC_COOKIE_MAX_AGE_S,
  readCookie,
  SESSION_COOKIE,
  setCookie,
} from './auth-cookies';
import { AuthSessionsService } from './auth-sessions.service';
import { OIDC_CLIENT, type OidcClient } from './oidc/oidc-client';
import { SignInService } from './sign-in.service';

/**
 * Sign-in and sign-out of org server mode (admin R5-R10; api.md 61-63).
 * Public: these routes run without an auth session. They answer 404 in
 * local mode.
 */
@Controller('auth')
@Public()
@OrgServerOnly()
export class AuthController {
  constructor(
    @Inject(ORG_SERVER_CONFIG) private readonly config: OrgServerConfig,
    @Inject(OIDC_CLIENT) private readonly oidc: OidcClient,
    private readonly signIn: SignInService,
    private readonly sessions: AuthSessionsService,
    private readonly activity: ActivityService,
  ) {}

  private get secure(): boolean {
    return this.config.secureCookies;
  }

  @Get('login')
  async login(
    @Query('returnTo') returnTo: unknown,
    @Res() res: Response,
  ): Promise<void> {
    const started = await this.signIn.start(returnTo);
    if (!started) {
      res.redirect(302, '/?signInError=failed');
      return;
    }
    setCookie(res, OIDC_COOKIE, started.sealed, {
      secure: this.secure,
      path: '/auth',
      maxAge: OIDC_COOKIE_MAX_AGE_S,
    });
    res.redirect(302, started.url);
  }

  @Get('callback')
  async callback(
    @Query() query: Record<string, unknown>,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const sealed = readCookie(req, OIDC_COOKIE);
    clearCookie(res, OIDC_COOKIE, { secure: this.secure, path: '/auth' });
    const outcome = await this.signIn.finish(
      query,
      sealed,
      req.headers['user-agent'],
    );
    if (!outcome.ok) {
      res.redirect(302, `/?signInError=${outcome.error}`);
      return;
    }
    setCookie(res, SESSION_COOKIE, outcome.token, {
      secure: this.secure,
      path: '/',
    });
    res.redirect(302, outcome.returnTo);
  }

  @Post('logout')
  @HttpCode(200)
  async logout(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ ok: true; message: string; endSessionUrl: string | null }> {
    const session = await this.sessions.sessionOf(req);
    if (session) {
      await this.sessions.end(session.id);
      await this.activity.record('sign-out', {
        actorId: session.userId,
        subjectId: session.userId,
      });
    }
    clearCookie(res, SESSION_COOKIE, { secure: this.secure, path: '/' });
    return {
      ok: true,
      message: 'Signed out',
      endSessionUrl: await this.oidc.endSessionUrl(
        `${this.config.publicBaseUrl}/`,
      ),
    };
  }
}
