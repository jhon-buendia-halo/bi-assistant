import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { AuthService } from '../auth.service';
import { SignInPage } from './sign-in-page';

describe('SignInPage', () => {
  let original: string;

  beforeEach(async () => {
    original = location.href;
    await TestBed.configureTestingModule({
      imports: [SignInPage],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();
  });

  afterEach(() => history.replaceState(history.state, '', original));

  function render() {
    const fixture = TestBed.createComponent(SignInPage);
    fixture.detectChanges();
    return { fixture, element: fixture.nativeElement as HTMLElement };
  }

  it('offers Sign in with Microsoft and no error at first (ui.md 4.17)', () => {
    const { element } = render();
    expect(element.querySelector('main')).toBeTruthy();
    expect(element.textContent).toContain(
      'Sign in with your organisation account to continue.',
    );
    expect(element.querySelector('[role="alert"]')).toBeNull();
  });

  it('shows the failed sign-in from the URL and removes it from the address bar', () => {
    history.replaceState(
      history.state,
      '',
      `${location.pathname}?signInError=failed`,
    );
    const { element } = render();
    expect(element.querySelector('[role="alert"]')?.textContent?.trim()).toBe(
      'Sign-in failed. Try again.',
    );
    expect(location.search).toBe('');
  });

  it('reads "Signing in…", disabled, while it leaves for the identity provider', () => {
    const navigate = spyOn(TestBed.inject(AuthService), 'navigate');
    const { fixture, element } = render();
    const button = element.querySelector('main button') as HTMLButtonElement;
    button.click();
    fixture.detectChanges();

    expect(navigate).toHaveBeenCalledWith('/auth/login');
    expect(button.disabled).toBeTrue();
    expect(button.textContent?.trim()).toBe('Signing in…');
  });
});
