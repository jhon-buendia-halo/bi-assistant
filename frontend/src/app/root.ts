import { Component, inject } from '@angular/core';
import { App } from './app';
import { AuthService } from './core/auth/auth.service';
import { SignInPage } from './core/auth/sign-in-page/sign-in-page';
import { ThemeService } from './core/theme/theme.service';

/**
 * The bootstrapped component. It loads the current user before anything
 * else (ui.md 1.6), then shows the app shell, or on an org server without
 * an auth session the sign-in page in its place (admin R5, R11).
 */
@Component({
  selector: 'app-root',
  imports: [App, SignInPage],
  template: `
    @switch (auth.status()) {
      @case ('signed-in') {
        <app-shell />
      }
      @case ('signed-out') {
        <app-sign-in-page />
      }
      @default {
        <!-- Until GET /me answers: the frame alone, never a wrong shell -->
        <div class="h-screen" style="background: var(--frame-gradient)"></div>
      }
    }
  `,
})
export class Root {
  readonly auth = inject(AuthService);
  // The resolved theme applies to the sign-in page as well as the shell.
  private readonly theme = inject(ThemeService);

  constructor() {
    this.auth.load();
  }
}
