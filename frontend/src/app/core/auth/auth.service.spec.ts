import { TestBed, fakeAsync, tick } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { ToastService } from '../toast/toast.service';
import { LOCAL_ME, PERMISSION_DENIED_MESSAGE } from './auth.models';
import { AuthService } from './auth.service';
import { ORG_MAKER } from './auth.testing';

describe('AuthService', () => {
  let auth: AuthService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    auth = TestBed.inject(AuthService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('is loading, with no permission, until GET /me answers', () => {
    expect(auth.status()).toBe('loading');
    expect(auth.can('use-agents')).toBeFalse();
  });

  it('holds every permission as the local user in local mode (admin R2)', () => {
    auth.load();
    http.expectOne('/me').flush(LOCAL_ME);

    expect(auth.status()).toBe('signed-in');
    expect(auth.isOrg()).toBeFalse();
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

  it('shows the sign-in page when GET /me answers 401 (admin R11)', () => {
    auth.load();
    http
      .expectOne('/me')
      .flush(
        { statusCode: 401, message: 'Sign in required' },
        { status: 401, statusText: 'Unauthorized' },
      );

    expect(auth.status()).toBe('signed-out');
    expect(auth.user()).toBeNull();
  });

  it('retries an unreachable backend, then opens as before (local mode)', fakeAsync(() => {
    auth.load();
    for (let attempt = 0; attempt <= 12; attempt++) {
      http
        .expectOne('/me')
        .error(new ProgressEvent('error'), { status: 0, statusText: '' });
      tick(1_000);
    }

    expect(auth.status()).toBe('signed-in');
    expect(auth.isOrg()).toBeFalse();
    expect(auth.can('manage-llm')).toBeTrue();
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

  it('turns a later 401 into the sign-in page on an org server only', () => {
    auth.load();
    http.expectOne('/me').flush(ORG_MAKER);
    auth.handleUnauthorized();
    expect(auth.status()).toBe('signed-out');
    expect(auth.can('create-agents')).toBeFalse();
  });

  it('ignores a 401 in local mode, which never signs in', () => {
    auth.load();
    http.expectOne('/me').flush(LOCAL_ME);
    auth.handleUnauthorized();
    expect(auth.status()).toBe('signed-in');
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
