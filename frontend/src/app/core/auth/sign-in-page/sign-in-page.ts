import { Component, inject } from '@angular/core';
import { LogIn, LucideAngularModule } from 'lucide-angular';
import { AuthService } from '../auth.service';

/**
 * The only screen an unauthenticated browser sees on an org server
 * (admin R5-R7, R16; ui.md 4.17). It replaces the whole shell.
 */
@Component({
  selector: 'app-sign-in-page',
  imports: [LucideAngularModule],
  templateUrl: './sign-in-page.html',
})
export class SignInPage {
  readonly auth = inject(AuthService);
  readonly LogIn = LogIn;

  /** Why the last round trip failed; read once, then dropped from the URL. */
  readonly error = this.auth.consumeSignInError();
}
