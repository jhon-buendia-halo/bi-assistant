import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { AuthService } from '../auth.service';
import { localMe, orgMe } from '../auth.testing';
import { AccountMenu } from './account-menu';

describe('AccountMenu', () => {
  let auth: AuthService;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AccountMenu],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();
    auth = TestBed.inject(AuthService);
    auth.me.set(orgMe(['use-agents']));
    auth.status.set('signed-in');
  });

  function render() {
    const fixture = TestBed.createComponent(AccountMenu);
    fixture.detectChanges();
    const element = fixture.nativeElement as HTMLElement;
    const avatar = element.querySelector(
      'button[aria-label="Account menu"]',
    ) as HTMLButtonElement;
    return { fixture, element, avatar };
  }

  it('opens a menu with the name, the email and Sign out (admin R10)', () => {
    const { fixture, element, avatar } = render();
    expect(avatar.getAttribute('aria-expanded')).toBe('false');
    expect(element.querySelector('[data-testid="account-menu"]')).toBeNull();

    avatar.click();
    fixture.detectChanges();

    expect(avatar.getAttribute('aria-expanded')).toBe('true');
    const menu = element.querySelector(
      '[data-testid="account-menu"]',
    ) as HTMLElement;
    expect(menu.textContent).toContain('Ada Lovelace');
    expect(menu.textContent).toContain('ada@contoso.test');
    const items = menu.querySelectorAll('[role="menu"] [role="menuitem"]');
    expect(Array.from(items).map((item) => item.textContent?.trim())).toEqual([
      'Sign out',
    ]);
    expect(avatar.getAttribute('aria-controls')).toBe(
      menu.querySelector('[role="menu"]')?.id ?? 'missing',
    );
  });

  it('closes on Escape and gives focus back to the avatar', () => {
    const { fixture, element, avatar } = render();
    avatar.click();
    fixture.detectChanges();

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    fixture.detectChanges();

    expect(element.querySelector('[data-testid="account-menu"]')).toBeNull();
    expect(document.activeElement).toBe(avatar);
  });

  it('signs out from the menu, reading "Signing out…" meanwhile', () => {
    const signOut = spyOn(auth, 'signOut').and.callFake(() =>
      auth.signingOut.set(true),
    );
    const { fixture, element, avatar } = render();
    avatar.click();
    fixture.detectChanges();
    const item = element.querySelector(
      '[role="menuitem"]',
    ) as HTMLButtonElement;
    item.click();
    fixture.detectChanges();

    expect(signOut).toHaveBeenCalled();
    expect(item.disabled).toBeTrue();
    expect(item.textContent?.trim()).toBe('Signing out…');
  });

  it("shows Demo User's initials, name and email in local mode (admin R10)", () => {
    auth.me.set(localMe());
    const { fixture, element, avatar } = render();
    expect(avatar.textContent?.trim()).toBe('DU');
    expect(avatar.title).toBe('Demo User');
    avatar.click();
    fixture.detectChanges();
    const menu = element.querySelector(
      '[data-testid="account-menu"]',
    ) as HTMLElement;
    expect(menu.textContent).toContain('Demo User');
    expect(menu.textContent).toContain('demo@local.test');
  });
});
