import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { DOCUMENT } from '@angular/common';
import { Injectable, computed, inject, signal } from '@angular/core';
import { retry, throwError, timer } from 'rxjs';
import { API_BASE_URL } from '../config/api.config';
import { ToastService } from '../toast/toast.service';
import {
  AuthMode,
  LOCAL_ME,
  MeView,
  PERMISSION_DENIED_MESSAGE,
  PermissionId,
  SIGN_IN_ERROR_MESSAGES,
  SignInError,
} from './auth.models';

/** `loading` until `GET /me` answers; the shell renders only when signed in. */
export type AuthStatus = 'loading' | 'signed-in' | 'signed-out';

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

/**
 * Who is using the app and what they may do (admin R2, R5, R10, R11, R25).
 * Loaded before anything else: in local mode it is the local user with
 * every permission; on an org server it is the signed-in user, or the
 * sign-in page when nobody is (ui.md 1.6).
 */
@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly http = inject(HttpClient);
  private readonly document = inject(DOCUMENT);
  private readonly toast = inject(ToastService);

  readonly status = signal<AuthStatus>('loading');
  readonly me = signal<MeView | null>(null);
  readonly mode = computed<AuthMode>(() => this.me()?.mode ?? 'local');
  readonly isOrg = computed(() => this.mode() === 'org');
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

  /**
   * Reads `GET /me` once at start-up. A 401 shows the sign-in page. A backend
   * that can't be reached is retried, then treated as local mode, as before
   * org server mode existed: an org server answers 401 to the next call.
   */
  load(): void {
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
        next: (me) => this.signedIn(me),
        error: (error) =>
          isUnauthorized(error) ? this.toSignInPage() : this.signedIn(LOCAL_ME),
      });
  }

  /** Any 401: the auth session is gone, so the sign-in page replaces the app. */
  handleUnauthorized(): void {
    // The local backend never answers 401; there is nothing to sign in to.
    if (this.status() === 'signed-in' && !this.isOrg()) return;
    this.toSignInPage();
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
   * **Sign out**: ends the auth session, then the identity provider's
   * session, which returns to the app's sign-in page (admin R10).
   */
  signOut(): void {
    if (this.signingOut()) return;
    this.signingOut.set(true);
    this.http.post<LogoutResult>(`${API_BASE_URL}/auth/logout`, {}).subscribe({
      next: (res) => this.navigate(res.endSessionUrl ?? `${API_BASE_URL}/`),
      error: (err) => {
        this.signingOut.set(false);
        this.toast.error(err?.error?.message ?? 'Backend unreachable');
      },
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

  private signedIn(me: MeView): void {
    this.me.set(me);
    this.status.set('signed-in');
  }

  private toSignInPage(): void {
    this.me.set(null);
    this.status.set('signed-out');
  }
}
