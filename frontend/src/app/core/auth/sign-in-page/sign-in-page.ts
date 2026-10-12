import { Component, effect, inject, signal, untracked } from '@angular/core';
import { LogIn, Loader2, LucideAngularModule } from 'lucide-angular';
import {
  BACKEND_UNREACHABLE_MESSAGE,
  LOCAL_SIGN_IN_FAILED_MESSAGE,
  LocalSignInUser,
  localUserOptionLabel,
} from '../auth.models';
import { AuthService } from '../auth.service';

/**
 * The only screen a browser without an auth session sees (admin R5-R7,
 * R16, R70; ui.md 4.17). It replaces the whole shell. Three states: the org
 * server variant (**Sign in with Microsoft**), the local mode variant (the
 * **Sign in as** dropdown of personas, 4.17.1), and "Backend unreachable"
 * with **Retry** in either mode.
 */
@Component({
  selector: 'app-sign-in-page',
  imports: [LucideAngularModule],
  templateUrl: './sign-in-page.html',
})
export class SignInPage {
  readonly auth = inject(AuthService);
  readonly LogIn = LogIn;
  readonly Loader2 = Loader2;
  readonly unreachableMessage = BACKEND_UNREACHABLE_MESSAGE;
  readonly optionLabel = localUserOptionLabel;

  /** Why the last org round trip failed; read once, then dropped from the URL. */
  readonly error = this.auth.consumeSignInError();

  /** Local mode: the personas, null while they load. */
  readonly users = signal<LocalSignInUser[] | null>(null);
  /** Local mode: the chosen user id, '' for "Choose a user". */
  readonly selected = signal('');
  readonly localError = signal<string | null>(null);

  constructor() {
    // Local mode lists the users once the mode is known and the backend is
    // reachable (again, after Retry).
    effect(() => {
      if (this.auth.isLocal() && !this.auth.backendUnreachable()) {
        untracked(() => this.loadUsers());
      }
    });
  }

  loadUsers(): void {
    this.users.set(null);
    this.auth.loadLocalUsers().subscribe({
      next: (users) => this.users.set(users),
      error: () => this.auth.unreachable(),
    });
  }

  choose(userId: string): void {
    this.selected.set(userId);
  }

  /** **Sign in** (admin R70): starts the auth session; the shell replaces the page. */
  signInLocal(): void {
    const userId = this.selected();
    if (!userId || this.auth.signingIn()) return;
    this.localError.set(null);
    this.auth.signInLocal(userId).subscribe({
      error: () => this.localError.set(LOCAL_SIGN_IN_FAILED_MESSAGE),
    });
  }

  /** **Retry**: `GET /me` again, then the users in local mode (ui.md 4.17). */
  retry(): void {
    this.auth.retryLoad();
  }
}
