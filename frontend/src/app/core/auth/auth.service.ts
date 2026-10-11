import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { DOCUMENT } from '@angular/common';
import { Injectable, computed, inject, signal } from '@angular/core';
import { Observable, map, retry, tap, throwError, timer } from 'rxjs';
import { API_BASE_URL } from '../config/api.config';
import { ToastService } from '../toast/toast.service';
import {
  AuthMode,
  LOCAL_SESSION_STORAGE_KEY,
  LocalSignInResult,
  LocalSignInUser,
  MeView,
  PERMISSION_DENIED_MESSAGE,
  PermissionId,
  SIGN_IN_ERROR_MESSAGES,
  SignInError,
} from './auth.models';

/** `loading` until `GET /me` answers; the shell renders only when signed in. */
export type AuthStatus = 'loading' | 'signed-in' | 'signed-out';

/** The server's mode, or `unknown` until an answer names it (ui.md 1.6). */
export type AuthModeState = AuthMode | 'unknown';

interface LogoutResult {
  ok: boolean;
  message: string;
  endSessionUrl: string | null;
}

/** Retries of `GET /me` while the backend is unreachable or starting. */
const ME_RETRIES = 12;

const isUnauthorized = (error: unknown) =>
  error instanceof HttpErrorResponse && error.status === 401;

/** A backend that is not up yet (no answer, or a server error). */
const isTransient = (error: unknown) =>
  error instanceof HttpErrorResponse &&
  (error.status === 0 || error.status >= 500);

/** The `mode` a 401 body names (`GET /me` answers it, api.md 64), if any. */
export function modeOf(error: unknown): AuthMode | null {
  const body =
    error instanceof HttpErrorResponse ? error.error : (error as object);
  const mode =
    body && typeof body === 'object'
      ? (body as { mode?: unknown }).mode
      : undefined;
  return mode === 'local' || mode === 'org' ? mode : null;
}

/**
 * Who is using the app and what they may do (admin R2, R5, R10, R11, R25,
 * R70, R71). Loaded before anything else: the signed-in user, or the
 * sign-in page when nobody is (ui.md 1.6), in either mode. In local mode the
 * auth session is a token kept in browser storage and sent as
 * `Authorization: Bearer <token>`; on an org server it is a cookie.
 */
@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly http = inject(HttpClient);
  private readonly document = inject(DOCUMENT);
  private readonly toast = inject(ToastService);

  readonly status = signal<AuthStatus>('loading');
  readonly me = signal<MeView | null>(null);
  /** Set by `GET /me` (its answer, or its 401 body), kept across a 401. */
  readonly mode = signal<AuthModeState>('unknown');
  readonly isOrg = computed(() => this.mode() === 'org');
  readonly isLocal = computed(() => this.mode() === 'local');
  /** The backend could not be reached: the sign-in page offers Retry. */
  readonly backendUnreachable = signal(false);
  /** A Retry of `GET /me` is running. */
  readonly checking = signal(false);
  readonly user = computed(() => this.me()?.user ?? null);
  readonly signingIn = signal(false);
  readonly signingOut = signal(false);

  private readonly permissions = computed(
    () => new Set<PermissionId>(this.me()?.permissions ?? []),
  );

  /** Whether the current user holds `permission` (a signal read). */
  can(permission: PermissionId): boolean {
    return this.permissions().has(permission);
  }

  /** The local auth session token, or null (admin R71). */
  localToken(): string | null {
    try {
      return (
        this.document.defaultView?.localStorage.getItem(
          LOCAL_SESSION_STORAGE_KEY,
        ) || null
      );
    } catch {
      return null;
    }
  }

  /** The `Authorization` header for a raw `fetch` to the API, if any. */
  authHeaders(): Record<string, string> {
    const token = this.localToken();
    return token ? { Authorization: `Bearer ${token}` } : {};
  }

  /**
   * Reads `GET /me` (at start-up, and on **Retry**). A 401 shows the sign-in
   * page in the variant its `mode` names. A backend that can't be reached is
   * retried, then the sign-in page says "Backend unreachable" (ui.md 1.6).
   */
  load(): void {
    this.checking.set(true);
    this.http
      .get<MeView>(`${API_BASE_URL}/me`)
      .pipe(
        retry({
          count: ME_RETRIES,
          delay: (error, retryCount) =>
            isTransient(error)
              ? timer(Math.min(retryCount * 200, 1_000))
              : throwError(() => error),
        }),
      )
      .subscribe({
        next: (me) => {
          this.checking.set(false);
          this.backendUnreachable.set(false);
          this.signedIn(me);
        },
        error: (error) => {
          this.checking.set(false);
          if (isUnauthorized(error)) {
            this.backendUnreachable.set(false);
            this.handleUnauthorized(modeOf(error) ?? undefined);
          } else {
            this.unreachable();
          }
        },
      });
  }

  /** **Retry** on the sign-in page: `GET /me` again. */
  retryLoad(): void {
    if (this.checking()) return;
    this.load();
  }

  /**
   * Any 401: the auth session is gone (admin R11, R71). The local token is
   * forgotten and the sign-in page replaces the app, in either mode.
   */
  handleUnauthorized(mode?: AuthMode): void {
    this.forgetToken();
    if (mode) this.mode.set(mode);
    else if (this.mode() === 'unknown') this.mode.set('org');
    this.toSignInPage();
  }

  /** Shows the "Backend unreachable" sign-in page (ui.md 4.17). */
  unreachable(): void {
    this.backendUnreachable.set(true);
    this.toSignInPage();
  }

  /** The local sign-in dropdown's users (`GET /auth/local/users`, api.md 91). */
  loadLocalUsers(): Observable<LocalSignInUser[]> {
    return this.http
      .get<{ users: LocalSignInUser[] }>(`${API_BASE_URL}/auth/local/users`)
      .pipe(map((res) => res.users ?? []));
  }

  /**
   * Local **Sign in** (admin R70, R71): starts an auth session as `userId`,
   * keeps its token and opens the shell.
   */
  signInLocal(userId: string): Observable<MeView> {
    this.signingIn.set(true);
    return this.http
      .post<LocalSignInResult>(`${API_BASE_URL}/auth/local/sign-in`, {
        userId,
      })
      .pipe(
        tap({
          next: (res) => {
            this.storeToken(res.token);
            this.signingIn.set(false);
            this.backendUnreachable.set(false);
            this.signedIn(res.me);
          },
          error: () => this.signingIn.set(false),
        }),
        map((res) => res.me),
      );
  }

  /**
   * Applies the 401 and 403 handling to a status answered outside
   * HttpClient (the streamed `fetch` calls). Returns the message to show, or
   * null when the status is neither.
   */
  refusalOf(status: number): string | null {
    if (status === 401) {
      this.handleUnauthorized();
      return 'Sign in required';
    }
    if (status === 403) {
      this.toast.error(PERMISSION_DENIED_MESSAGE);
      return PERMISSION_DENIED_MESSAGE;
    }
    return null;
  }

  /** **Sign in with Microsoft**: a full-page trip through the identity provider. */
  signIn(): void {
    this.signingIn.set(true);
    this.navigate(`${API_BASE_URL}/auth/login`);
  }

  /**
   * **Sign out** (admin R10, R71). Org server: ends the auth session, then
   * the identity provider's session, which returns to the app's sign-in
   * page. Local mode: ends the auth session, forgets the token and reloads,
   * which shows the sign-in page.
   */
  signOut(): void {
    if (this.signingOut()) return;
    this.signingOut.set(true);
    const failed = (err: HttpErrorResponse) => {
      this.signingOut.set(false);
      this.toast.error(err?.error?.message ?? 'Backend unreachable');
    };
    if (this.isLocal()) {
      this.http
        .post(`${API_BASE_URL}/auth/local/sign-out`, {})
        .subscribe({
          next: () => {
            this.forgetToken();
            this.reload();
          },
          error: failed,
        });
      return;
    }
    this.http.post<LogoutResult>(`${API_BASE_URL}/auth/logout`, {}).subscribe({
      next: (res) => this.navigate(res.endSessionUrl ?? `${API_BASE_URL}/`),
      error: failed,
    });
  }

  /**
   * The sign-in error carried by the page URL (`signInError`, api.md 62), as
   * its message; the parameter is removed from the address bar once read.
   */
  consumeSignInError(): string | null {
    const win = this.document.defaultView;
    if (!win) return null;
    const url = new URL(win.location.href);
    const code = url.searchParams.get('signInError');
    if (code === null) return null;
    url.searchParams.delete('signInError');
    win.history.replaceState(
      win.history.state,
      '',
      `${url.pathname}${url.search}${url.hash}`,
    );
    return (
      SIGN_IN_ERROR_MESSAGES[code as SignInError] ??
      SIGN_IN_ERROR_MESSAGES.failed
    );
  }

  /** Leaves the app for `url` (a full page load). */
  navigate(url: string): void {
    this.document.defaultView?.location.assign(url);
  }

  /** Reloads the page (a fresh start, nobody signed in in memory). */
  reload(): void {
    this.document.defaultView?.location.reload();
  }

  private signedIn(me: MeView): void {
    this.mode.set(me.mode);
    this.me.set(me);
    this.status.set('signed-in');
  }

  private storeToken(token: string): void {
    try {
      this.document.defaultView?.localStorage.setItem(
        LOCAL_SESSION_STORAGE_KEY,
        token,
      );
    } catch {
      // No storage: the session lasts until the next 401.
    }
  }

  private forgetToken(): void {
    try {
      this.document.defaultView?.localStorage.removeItem(
        LOCAL_SESSION_STORAGE_KEY,
      );
    } catch {
      // Nothing stored.
    }
  }

  private toSignInPage(): void {
    this.me.set(null);
    this.status.set('signed-out');
  }
}
