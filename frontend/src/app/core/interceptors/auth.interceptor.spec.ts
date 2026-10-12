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
import {
  LOCAL_SESSION_STORAGE_KEY,
  PERMISSION_DENIED_MESSAGE,
} from '../auth/auth.models';
import { AuthService } from '../auth/auth.service';
import { ORG_MAKER, localMe } from '../auth/auth.testing';
import { ToastService } from '../toast/toast.service';
import { authInterceptor, isApiUrl } from './auth.interceptor';

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
    localStorage.removeItem(LOCAL_SESSION_STORAGE_KEY);
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

  afterEach(() => {
    backend.verify();
    localStorage.removeItem(LOCAL_SESSION_STORAGE_KEY);
  });

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

  it('shows the local sign-in page and forgets the token on a 401 in local mode (admin R11, R71)', () => {
    localStorage.setItem(LOCAL_SESSION_STORAGE_KEY, 'swept-token');
    signIn(localMe());
    failWith(401, {
      statusCode: 401,
      message: 'Sign in required',
      error: 'Unauthorized',
    });
    expect(auth.status()).toBe('signed-out');
    expect(auth.isLocal()).toBeTrue();
    expect(localStorage.getItem(LOCAL_SESSION_STORAGE_KEY)).toBeNull();
  });

  it('sends the local token as a bearer header on API calls (admin R71)', () => {
    localStorage.setItem(LOCAL_SESSION_STORAGE_KEY, 'tok-123');
    http.get('/sessions').subscribe();
    const req = backend.expectOne('/sessions');
    expect(req.request.headers.get('Authorization')).toBe('Bearer tok-123');
    req.flush([]);
  });

  it('sends no Authorization header without a token, nor to other origins', () => {
    http.get('/sessions').subscribe();
    const plain = backend.expectOne('/sessions');
    expect(plain.request.headers.has('Authorization')).toBeFalse();
    plain.flush([]);

    localStorage.setItem(LOCAL_SESSION_STORAGE_KEY, 'tok-123');
    http.get('https://cdn.example/asset.json').subscribe();
    const other = backend.expectOne('https://cdn.example/asset.json');
    expect(other.request.headers.has('Authorization')).toBeFalse();
    other.flush({});
  });

  it('recognises API URLs on the web and in the desktop renderer', () => {
    expect(isApiUrl('/me', '')).toBeTrue();
    expect(isApiUrl('//cdn.example/x', '')).toBeFalse();
    expect(isApiUrl('https://cdn.example/x', '')).toBeFalse();
    expect(isApiUrl('http://localhost:3000/me', 'http://localhost:3000')).toBeTrue();
    expect(isApiUrl('http://localhost:30001/me', 'http://localhost:3000')).toBeFalse();
    expect(isApiUrl('https://cdn.example/x', 'http://localhost:3000')).toBeFalse();
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
