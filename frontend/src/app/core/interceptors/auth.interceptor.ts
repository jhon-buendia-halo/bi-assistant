import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError, throwError } from 'rxjs';
import { PERMISSION_DENIED_MESSAGE } from '../auth/auth.models';
import { AuthService } from '../auth/auth.service';
import { ToastService } from '../toast/toast.service';

/**
 * Org server answers every view relies on (admin R11, R24; ui.md 1.6):
 *  - 401: the auth session ended, so the sign-in page replaces the app.
 *  - 403: the error toast "You don't have permission to do this." The error
 *    reaching the caller carries the same message instead of the server's
 *    `Missing permission: <id>`, so a view that toasts or shows its own
 *    error says the same thing (the toast service shows it once).
 */
export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const auth = inject(AuthService);
  const toast = inject(ToastService);
  return next(req).pipe(
    catchError((error: unknown) => {
      if (!(error instanceof HttpErrorResponse)) return throwError(() => error);
      if (error.status === 401) {
        auth.handleUnauthorized();
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
