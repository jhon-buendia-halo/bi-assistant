import { TestBed, fakeAsync, tick } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { ToastService } from '../toast/toast.service';
import {
  LOCAL_SESSION_STORAGE_KEY,
  PERMISSION_DENIED_MESSAGE,
} from './auth.models';
import { AuthService } from './auth.service';
import { LOCAL_UMA, ORG_MAKER, localMe } from './auth.testing';

describe('AuthService', () => {
  let auth: AuthService;
  let http: HttpTestingController;

  const storedToken = () => localStorage.getItem(LOCAL_SESSION_STORAGE_KEY);

  beforeEach(() => {
    localStorage.removeItem(LOCAL_SESSION_STORAGE_KEY);
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    auth = TestBed.inject(AuthService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    http.verify();
    localStorage.removeItem(LOCAL_SESSION_STORAGE_KEY);
  });

  it('is loading, with no permission, until GET /me answers', () => {
    expect(auth.status()).toBe('loading');
    expect(auth.can('use-agents')).toBeFalse();
  });

  it('holds every permission as Demo User in local mode (admin R2, R69)', () => {
    auth.load();
    http.expectOne('/me').flush(localMe());

    expect(auth.status()).toBe('signed-in');
    expect(auth.isOrg()).toBeFalse();
    expect(auth.isLocal()).toBeTrue();
    expect(auth.user()?.displayName).toBe('Demo User');
    expect(auth.can('manage-llm')).toBeTrue();
    expect(auth.can('manage-users')).toBeTrue();
  });

  it("holds only the signed-in user's permissions on an org server", () => {
    auth.load();
    http.expectOne('/me').flush(ORG_MAKER);

    expect(auth.status()).toBe('signed-in');
    expect(auth.isOrg()).toBeTrue();
    expect(auth.user()?.initials).toBe('AL');
    expect(auth.can('create-agents')).toBeTrue();
    expect(auth.can('manage-datasources')).toBeFalse();
    expect(auth.can('manage-users')).toBeFalse();
  });

  it('shows the org sign-in page when GET /me answers 401 in org mode (admin R11)', () => {
    auth.load();
    http.expectOne('/me').flush(
      {
        statusCode: 401,
        message: 'Sign in required',
        error: 'Unauthorized',
        mode: 'org',
      },
      { status: 401, statusText: 'Unauthorized' },
    );

    expect(auth.status()).toBe('signed-out');
    expect(auth.user()).toBeNull();
    expect(auth.isOrg()).toBeTrue();
    expect(auth.backendUnreachable()).toBeFalse();
  });

  it('shows the local sign-in page and forgets the token on a local 401 (admin R70, R71)', () => {
    localStorage.setItem(LOCAL_SESSION_STORAGE_KEY, 'stale-token');
    auth.load();
    http.expectOne('/me').flush(
      {
        statusCode: 401,
        message: 'Sign in required',
        error: 'Unauthorized',
        mode: 'local',
      },
      { status: 401, statusText: 'Unauthorized' },
    );

    expect(auth.status()).toBe('signed-out');
    expect(auth.isLocal()).toBeTrue();
    expect(storedToken()).toBeNull();
    expect(auth.localToken()).toBeNull();
  });

  it('retries an unreachable backend, then says so on the sign-in page, never the shell (ui.md 1.6)', fakeAsync(() => {
    auth.load();
    for (let attempt = 0; attempt <= 12; attempt++) {
      http
        .expectOne('/me')
        .error(new ProgressEvent('error'), { status: 0, statusText: '' });
      tick(1_000);
    }

    expect(auth.status()).toBe('signed-out');
    expect(auth.backendUnreachable()).toBeTrue();
    expect(auth.mode()).toBe('unknown');
    expect(auth.can('manage-llm')).toBeFalse();
    expect(auth.checking()).toBeFalse();
  }));

  it('Retry loads GET /me again and opens the shell once it answers', fakeAsync(() => {
    auth.unreachable();
    auth.retryLoad();
    expect(auth.checking()).toBeTrue();
    // A second Retry while the first runs does nothing.
    auth.retryLoad();
    http.expectOne('/me').flush(localMe());

    expect(auth.status()).toBe('signed-in');
    expect(auth.backendUnreachable()).toBeFalse();
    expect(auth.checking()).toBeFalse();
  }));

  it('signs in once the backend answers after a retry', fakeAsync(() => {
    auth.load();
    http
      .expectOne('/me')
      .error(new ProgressEvent('error'), { status: 0, statusText: '' });
    tick(200);
    http.expectOne('/me').flush(ORG_MAKER);

    expect(auth.status()).toBe('signed-in');
    expect(auth.isOrg()).toBeTrue();
  }));

  it('turns a later 401 into the sign-in page on an org server', () => {
    auth.load();
    http.expectOne('/me').flush(ORG_MAKER);
    auth.handleUnauthorized();
    expect(auth.status()).toBe('signed-out');
    expect(auth.can('create-agents')).toBeFalse();
  });

  it('turns a later 401 into the local sign-in page and forgets the token (admin R71)', () => {
    localStorage.setItem(LOCAL_SESSION_STORAGE_KEY, 'swept-token');
    auth.load();
    http.expectOne('/me').flush(localMe());
    auth.handleUnauthorized();
    expect(auth.status()).toBe('signed-out');
    expect(auth.isLocal()).toBeTrue();
    expect(storedToken()).toBeNull();
  });

  it('sends the stored token as a bearer header to raw fetch calls', () => {
    expect(auth.authHeaders()).toEqual({});
    localStorage.setItem(LOCAL_SESSION_STORAGE_KEY, 'tok-123');
    expect(auth.localToken()).toBe('tok-123');
    expect(auth.authHeaders()).toEqual({ Authorization: 'Bearer tok-123' });
  });

  it('lists the local sign-in users (api.md 91)', () => {
    let users: unknown;
    auth.loadLocalUsers().subscribe((list) => (users = list));
    const user = {
      id: 'local',
      displayName: 'Demo User',
      email: 'demo@local.test',
      initials: 'DU',
      roles: ['platform-admin'],
    };
    http.expectOne('/auth/local/users').flush({ users: [user] });
    expect(users).toEqual([user]);
  });

  it('signs in locally: keeps the token and opens the shell (admin R70, R71)', () => {
    auth.handleUnauthorized('local');
    let signedInAs: string | undefined;
    auth.signInLocal('local-uma').subscribe((me) => (signedInAs = me.user.id));
    expect(auth.signingIn()).toBeTrue();
    const req = http.expectOne('/auth/local/sign-in');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ userId: 'local-uma' });
    req.flush({
      ok: true,
      message: 'Signed in',
      token: 'a'.repeat(43),
      me: LOCAL_UMA,
    });

    expect(signedInAs).toBe('local-uma');
    expect(storedToken()).toBe('a'.repeat(43));
    expect(auth.status()).toBe('signed-in');
    expect(auth.signingIn()).toBeFalse();
    expect(auth.user()?.initials).toBe('UU');
    expect(auth.can('create-agents')).toBeFalse();
  });

  it('stays on the sign-in page when local sign-in fails', () => {
    auth.handleUnauthorized('local');
    let failed = false;
    auth.signInLocal('nobody').subscribe({ error: () => (failed = true) });
    http.expectOne('/auth/local/sign-in').flush(
      { statusCode: 404, message: 'User nobody not found', error: 'Not Found' },
      { status: 404, statusText: 'Not Found' },
    );

    expect(failed).toBeTrue();
    expect(auth.status()).toBe('signed-out');
    expect(auth.signingIn()).toBeFalse();
    expect(storedToken()).toBeNull();
  });

  it('signs out locally: ends the session, forgets the token and reloads (admin R71)', () => {
    localStorage.setItem(LOCAL_SESSION_STORAGE_KEY, 'tok-123');
    auth.load();
    http.expectOne('/me').flush(localMe());
    const reload = spyOn(auth, 'reload');
    const navigate = spyOn(auth, 'navigate');

    auth.signOut();
    expect(auth.signingOut()).toBeTrue();
    const req = http.expectOne('/auth/local/sign-out');
    expect(req.request.method).toBe('POST');
    req.flush({ ok: true, message: 'Signed out' });

    expect(storedToken()).toBeNull();
    expect(reload).toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
  });

  it('answers a refused streamed call with the toast and message (ui.md 1.6)', () => {
    const toast = TestBed.inject(ToastService);
    auth.load();
    http.expectOne('/me').flush(ORG_MAKER);

    expect(auth.refusalOf(403)).toBe(PERMISSION_DENIED_MESSAGE);
    expect(toast.toasts().map((t) => t.message)).toEqual([
      PERMISSION_DENIED_MESSAGE,
    ]);
    expect(auth.refusalOf(500)).toBeNull();
    expect(auth.status()).toBe('signed-in');

    expect(auth.refusalOf(401)).toBe('Sign in required');
    expect(auth.status()).toBe('signed-out');
  });

  it('signs in through a full-page trip to /auth/login', () => {
    const navigate = spyOn(auth, 'navigate');
    auth.signIn();
    expect(auth.signingIn()).toBeTrue();
    expect(navigate).toHaveBeenCalledWith('/auth/login');
  });

  it("signs out, then ends the identity provider's session (admin R10)", () => {
    auth.load();
    http.expectOne('/me').flush(ORG_MAKER);
    const navigate = spyOn(auth, 'navigate');
    auth.signOut();
    expect(auth.signingOut()).toBeTrue();
    const req = http.expectOne('/auth/logout');
    expect(req.request.method).toBe('POST');
    req.flush({
      ok: true,
      message: 'Signed out',
      endSessionUrl: 'https://login.example/logout?client_id=x',
    });
    expect(navigate).toHaveBeenCalledWith(
      'https://login.example/logout?client_id=x',
    );
  });

  it('returns to the app root after sign-out without an end-session URL', () => {
    auth.load();
    http.expectOne('/me').flush(ORG_MAKER);
    const navigate = spyOn(auth, 'navigate');
    auth.signOut();
    http
      .expectOne('/auth/logout')
      .flush({ ok: true, message: 'Signed out', endSessionUrl: null });
    expect(navigate).toHaveBeenCalledWith('/');
  });

  describe('the sign-in error in the URL (ui.md 4.17)', () => {
    let original: string;

    beforeEach(() => (original = location.href));
    afterEach(() => history.replaceState(history.state, '', original));

    it('reads the message and removes the parameter', () => {
      history.replaceState(
        history.state,
        '',
        `${location.pathname}?signInError=deactivated&keep=1`,
      );
      expect(auth.consumeSignInError()).toBe(
        'Your account is deactivated. Contact your administrator.',
      );
      expect(location.search).toBe('?keep=1');
    });

    it('treats an unknown code as a failed sign-in', () => {
      history.replaceState(
        history.state,
        '',
        `${location.pathname}?signInError=weird`,
      );
      expect(auth.consumeSignInError()).toBe('Sign-in failed. Try again.');
      expect(location.search).toBe('');
    });

    it('has nothing to show without the parameter', () => {
      expect(auth.consumeSignInError()).toBeNull();
    });
  });
});
