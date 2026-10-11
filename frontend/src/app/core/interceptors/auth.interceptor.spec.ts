import { TestBed } from '@angular/core/testing';
import {
  HttpClient,
  HttpErrorResponse,
  provideHttpClient,
  withInterceptors,
} from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { LOCAL_ME, PERMISSION_DENIED_MESSAGE } from '../auth/auth.models';
import { AuthService } from '../auth/auth.service';
import { ORG_MAKER } from '../auth/auth.testing';
import { ToastService } from '../toast/toast.service';
import { authInterceptor } from './auth.interceptor';

describe('authInterceptor', () => {
  let http: HttpClient;
  let backend: HttpTestingController;
  let auth: AuthService;
  let toast: ToastService;

  /** Signs in as `me` through GET /me. */
  function signIn(me = ORG_MAKER): void {
    auth.load();
    backend.expectOne('/me').flush(me);
  }

  /** Makes a call that the backend answers with `status`; resolves to the error. */
  function failWith(
    status: number,
    body: object = { statusCode: status, message: `HTTP ${status}` },
    url = '/agents',
  ): HttpErrorResponse | undefined {
    let failure: HttpErrorResponse | undefined;
    http.post(url, {}).subscribe({
      error: (error: HttpErrorResponse) => (failure = error),
    });
    backend.expectOne(url).flush(body, { status, statusText: 'Refused' });
    return failure;
  }

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([authInterceptor])),
        provideHttpClientTesting(),
      ],
    });
    http = TestBed.inject(HttpClient);
    backend = TestBed.inject(HttpTestingController);
    auth = TestBed.inject(AuthService);
    toast = TestBed.inject(ToastService);
  });

  afterEach(() => backend.verify());

  it('shows the sign-in page when a call answers 401 (admin R11)', () => {
    signIn();
    const error = failWith(401, {
      statusCode: 401,
      message: 'Sign in required',
      error: 'Unauthorized',
    });
    expect(error?.status).toBe(401);
    expect(auth.status()).toBe('signed-out');
  });

  it('keeps a local-mode app open on a stray 401', () => {
    signIn(LOCAL_ME);
    failWith(401);
    expect(auth.status()).toBe('signed-in');
  });

  it('toasts a 403 with the permission message, not the server one (admin R24)', () => {
    signIn();
    const error = failWith(403, {
      statusCode: 403,
      message: 'Missing permission: create-agents',
      error: 'Forbidden',
    });

    expect(toast.toasts().map((t) => [t.kind, t.message])).toEqual([
      ['error', PERMISSION_DENIED_MESSAGE],
    ]);
    expect(error?.status).toBe(403);
    expect(error?.error).toEqual({
      statusCode: 403,
      message: PERMISSION_DENIED_MESSAGE,
      error: 'Forbidden',
    });
    expect(auth.status()).toBe('signed-in');
  });

  it('shows the permission toast once when the view toasts the error too', () => {
    signIn();
    const error = failWith(403);
    toast.error(error?.error?.message);
    failWith(403);

    expect(toast.toasts().length).toBe(1);
  });

  it('passes other errors through unchanged', () => {
    signIn();
    const body = { ok: false, message: 'Agent "Goal" already exists' };
    const error = failWith(409, body);

    expect(error?.status).toBe(409);
    expect(error?.error).toEqual(body);
    expect(toast.toasts()).toEqual([]);
    expect(auth.status()).toBe('signed-in');
  });
});
