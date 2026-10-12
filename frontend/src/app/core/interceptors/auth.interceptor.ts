import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError, throwError } from 'rxjs';
import { PERMISSION_DENIED_MESSAGE } from '../auth/auth.models';
import { AuthService, modeOf } from '../auth/auth.service';
import { API_BASE_URL } from '../config/api.config';
import { ToastService } from '../toast/toast.service';

/**
 * Whether `url` is a call to the app's backend: under `API_BASE_URL` in the
 * desktop renderer, a same-origin absolute path on the web.
 */
export function isApiUrl(url: string, base = API_BASE_URL): boolean {
  if (base) return url === base || url.startsWith(`${base}/`);
  return url.startsWith('/') && !url.startsWith('//');
}

/**
 * The auth session and the answers every view relies on (admin R11, R24,
 * R71; ui.md 1.6):
 *  - Local mode: every API call carries `Authorization: Bearer <token>`
 *    while a local auth session token is stored.
 *  - 401 (either mode): the auth session ended, so the local token is
 *    forgotten and the sign-in page replaces the app.
 *  - 403: the error toast "You don't have permission to do this." The error
 *    reaching the caller carries the same message instead of the server's
 *    `Missing permission: <id>`, so a view that toasts or shows its own
 *    error says the same thing (the toast service shows it once).
 */
export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const auth = inject(AuthService);
  const toast = inject(ToastService);
  const token = auth.localToken();
  const request =
    token && isApiUrl(req.url) && !req.headers.has('Authorization')
      ? req.clone({ setHeaders: { Authorization: `Bearer ${token}` } })
      : req;
  return next(request).pipe(
    catchError((error: unknown) => {
      if (!(error instanceof HttpErrorResponse)) return throwError(() => error);
      if (error.status === 401) {
        auth.handleUnauthorized(modeOf(error) ?? undefined);
      } else if (error.status === 403) {
        toast.error(PERMISSION_DENIED_MESSAGE);
        const body =
          error.error && typeof error.error === 'object' ? error.error : {};
        return throwError(
          () =>
            new HttpErrorResponse({
              error: { ...body, message: PERMISSION_DENIED_MESSAGE },
              headers: error.headers,
              status: error.status,
              statusText: error.statusText,
              url: error.url ?? undefined,
            }),
        );
      }
      return throwError(() => error);
    }),
  );
};
