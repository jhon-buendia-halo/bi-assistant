import {
  Component,
  ElementRef,
  HostListener,
  computed,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { LogOut, LucideAngularModule } from 'lucide-angular';
import { AuthService } from '../auth.service';

/** Gap between the rail and the menu beside it. */
const MENU_GAP_PX = 8;

/**
 * The rail avatar on an org server (admin R10; ui.md 1.3): the signed-in
 * user's initials, opening a menu with their name, email and **Sign out**.
 * Local mode keeps the static "Demo User" avatar instead.
 */
@Component({
  selector: 'app-account-menu',
  imports: [LucideAngularModule],
  templateUrl: './account-menu.html',
})
export class AccountMenu {
  readonly auth = inject(AuthService);
  readonly LogOut = LogOut;

  readonly user = computed(() => this.auth.user());
  readonly open = signal(false);
  /** Fixed position beside the rail, bottom-aligned with the avatar. */
  readonly position = signal({ left: 0, bottom: 0 });

  private readonly trigger =
    viewChild<ElementRef<HTMLButtonElement>>('trigger');
  private readonly signOutItem =
    viewChild<ElementRef<HTMLButtonElement>>('signOutItem');

  toggle(): void {
    if (this.open()) {
      this.close();
      return;
    }
    const button = this.trigger()?.nativeElement;
    if (!button) return;
    const avatar = button.getBoundingClientRect();
    const rail = button.closest('aside')?.getBoundingClientRect() ?? avatar;
    this.position.set({
      left: rail.right + MENU_GAP_PX,
      bottom: Math.max(0, window.innerHeight - avatar.bottom),
    });
    this.open.set(true);
    // The menu's first item takes focus, as in any menu.
    setTimeout(() => this.signOutItem()?.nativeElement.focus());
  }

  close(returnFocus = false): void {
    if (!this.open()) return;
    this.open.set(false);
    if (returnFocus) this.trigger()?.nativeElement.focus();
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    this.close(true);
  }
}
