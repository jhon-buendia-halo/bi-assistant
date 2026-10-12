import { Controller, Get, INestApplication, Post } from '@nestjs/common';
import { APP_GUARD, DiscoveryModule } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import {
  LocalModeOnly,
  OrgServerOnly,
  Public,
  RequirePermission,
  ScimAuth,
} from '../decorators/auth-requirement.decorators';
import { ORG_SERVER_CONFIG } from '../../config/org-server.config';
import { ActivityService } from '../../modules/auth/activity.service';
import { PermissionsGuard } from './permissions.guard';
import {
  CurrentUserService,
  LOCAL_USER,
} from '../../modules/auth/current-user.service';
import type { CurrentUser } from '../../modules/auth/entities/current-user.entity';

@Controller('things')
class ThingsController {
  @Get()
  @RequirePermission('use-agents')
  list() {
    return { things: [] };
  }

  @Post()
  @RequirePermission('manage-llm')
  create() {
    return { ok: true };
  }

  @Get('open')
  @Public()
  open() {
    return { open: true };
  }

  @Get('scim')
  @ScimAuth()
  @OrgServerOnly()
  scim() {
    return { scim: true };
  }

  @Post('local-sign-in')
  @Public()
  @LocalModeOnly()
  localSignIn() {
    return { ok: true };
  }
}

/** Class-level requirement, overridden on one handler. */
@Controller('admin-things')
@RequirePermission('manage-users')
class AdminThingsController {
  @Get()
  list() {
    return { admin: true };
  }

  @Get('public')
  @Public()
  open() {
    return { open: true };
  }
}

@Controller('unmarked')
class UnmarkedController {
  @Get('x')
  @RequirePermission('use-agents')
  marked() {
    return {};
  }

  @Post('y')
  forgotten() {
    return {};
  }
}

const USER_ONLY: CurrentUser = {
  id: 'u1',
  displayName: 'Ada Lovelace',
  email: 'ada@contoso.test',
  initials: 'AL',
  roles: [{ role: 'user', source: 'implicit' }],
  permissions: ['use-agents'],
};

/** A stand-in for the current user, so a test can pick who calls. */
class FakeCurrentUser {
  constructor(readonly mode: 'local' | 'org' = 'local') {}
  user: CurrentUser | undefined = LOCAL_USER;
  current() {
    return this.user;
  }
}

const SCIM_TOKEN = 's'.repeat(40);

async function appWith(
  controllers: Array<new (...args: never[]) => unknown>,
  currentUser: FakeCurrentUser,
  activity = { recordScimRequest: jest.fn(() => Promise.resolve()) },
): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({
    imports: [DiscoveryModule],
    controllers,
    providers: [
      { provide: CurrentUserService, useValue: currentUser },
      { provide: ActivityService, useValue: activity },
      {
        provide: ORG_SERVER_CONFIG,
        useValue: currentUser.mode === 'org' ? { scimToken: SCIM_TOKEN } : null,
      },
      { provide: APP_GUARD, useClass: PermissionsGuard },
    ],
  }).compile();
  const app = moduleRef.createNestApplication({ logger: false });
  await app.init();
  return app;
}

describe('PermissionsGuard', () => {
  const currentUser = new FakeCurrentUser();
  let app: INestApplication;

  beforeAll(async () => {
    app = await appWith([ThingsController, AdminThingsController], currentUser);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    currentUser.user = LOCAL_USER;
  });

  it('lets Demo User (Platform admin) through every route', async () => {
    const http = () => request(app.getHttpServer());
    await http().get('/things').expect(200);
    await http().post('/things').expect(201);
    await http().get('/admin-things').expect(200);
    await http().get('/things/open').expect(200);
  });

  it('refuses a caller without the route permission with 403', async () => {
    currentUser.user = USER_ONLY;
    await request(app.getHttpServer()).get('/things').expect(200);
    const res = await request(app.getHttpServer()).post('/things').expect(403);
    expect(res.body).toEqual({
      statusCode: 403,
      message: 'Missing permission: manage-llm',
      error: 'Forbidden',
    });
  });

  it('applies a class-level requirement, overridden per handler', async () => {
    currentUser.user = USER_ONLY;
    const res = await request(app.getHttpServer())
      .get('/admin-things')
      .expect(403);
    expect((res.body as { message: string }).message).toBe(
      'Missing permission: manage-users',
    );
    await request(app.getHttpServer()).get('/admin-things/public').expect(200);
  });

  it('refuses a caller without a user with 401, except public routes', async () => {
    currentUser.user = undefined;
    const res = await request(app.getHttpServer()).get('/things').expect(401);
    expect(res.body).toEqual({
      statusCode: 401,
      message: 'Sign in required',
      error: 'Unauthorized',
    });
    await request(app.getHttpServer()).get('/things/open').expect(200);
  });

  it('answers 404 for org-server-only routes in local mode', async () => {
    const res = await request(app.getHttpServer())
      .get('/things/scim')
      .set('Authorization', `Bearer ${SCIM_TOKEN}`)
      .expect(404);
    expect(res.body).toEqual({
      statusCode: 404,
      message: 'Not available in local mode',
      error: 'Not Found',
    });
  });

  it('opens local-mode-only routes in local mode, without a user', async () => {
    currentUser.user = undefined;
    await request(app.getHttpServer()).post('/things/local-sign-in').expect(201);
  });
});

describe('PermissionsGuard in org server mode', () => {
  const currentUser = new FakeCurrentUser('org');
  const activity = { recordScimRequest: jest.fn(() => Promise.resolve()) };
  let app: INestApplication;

  beforeAll(async () => {
    app = await appWith([ThingsController], currentUser, activity);
  });

  afterAll(async () => {
    await app.close();
  });

  it('opens SCIM routes with the bearer token only, and records the request', async () => {
    currentUser.user = undefined;
    const http = () => request(app.getHttpServer());
    await http().get('/things/scim').expect(401);
    await http()
      .get('/things/scim')
      .set('Authorization', `Bearer ${'x'.repeat(40)}`)
      .expect(401);
    expect(activity.recordScimRequest).not.toHaveBeenCalled();
    await http()
      .get('/things/scim')
      .set('Authorization', `Bearer ${SCIM_TOKEN}`)
      .expect(200);
    expect(activity.recordScimRequest).toHaveBeenCalledTimes(1);
  });

  it('a signed-in user does not open SCIM without the token', async () => {
    currentUser.user = LOCAL_USER;
    await request(app.getHttpServer()).get('/things/scim').expect(401);
  });

  it('answers 404 for local-mode-only routes on an org server (admin R73)', async () => {
    currentUser.user = undefined;
    const res = await request(app.getHttpServer())
      .post('/things/local-sign-in')
      .expect(404);
    expect(res.body).toEqual({
      statusCode: 404,
      message: 'Not available in org server mode',
      error: 'Not Found',
    });
  });
});

describe('PermissionsGuard startup self-check', () => {
  it('stops the app from starting when a route declares no requirement', async () => {
    await expect(
      appWith([ThingsController, UnmarkedController], new FakeCurrentUser()),
    ).rejects.toThrow(/POST \/unmarked\/y \(UnmarkedController\.forgotten\)/);
  });

  it('starts when every route declares a requirement', async () => {
    const app = await appWith(
      [ThingsController, AdminThingsController],
      new FakeCurrentUser(),
    );
    await app.close();
  });
});
