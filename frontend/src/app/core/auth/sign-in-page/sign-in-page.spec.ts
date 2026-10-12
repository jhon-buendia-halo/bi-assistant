import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import {
  LOCAL_SESSION_STORAGE_KEY,
  LocalSignInUser,
  localUserOptionLabel,
} from '../auth.models';
import { AuthService } from '../auth.service';
import { localMe } from '../auth.testing';
import { SignInPage } from './sign-in-page';

/** The personas as `GET /auth/local/users` answers them on a fresh folder. */
const USERS: LocalSignInUser[] = [
  {
    id: 'local-avery',
    displayName: 'Avery Approver',
    email: 'avery@local.test',
    initials: 'AA',
    roles: ['approver'],
  },
  {
    id: 'local-dana',
    displayName: 'Dana Data Owner',
    email: 'dana@local.test',
    initials: 'DD',
    roles: [],
  },
  {
    id: 'local',
    displayName: 'Demo User',
    email: 'demo@local.test',
    initials: 'DU',
    roles: ['platform-admin'],
  },
  {
    id: 'local-mark',
    displayName: 'Mark Maker',
    email: 'mark@local.test',
    initials: 'MM',
    roles: ['maker'],
  },
  {
    id: 'local-uma',
    displayName: 'Uma User',
    email: 'uma@local.test',
    initials: 'UU',
    roles: [],
  },
];

describe('SignInPage', () => {
  let original: string;
  let auth: AuthService;
  let http: HttpTestingController;

  beforeEach(async () => {
    original = location.href;
    localStorage.removeItem(LOCAL_SESSION_STORAGE_KEY);
    await TestBed.configureTestingModule({
      imports: [SignInPage],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();
    auth = TestBed.inject(AuthService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    http.verify();
    history.replaceState(history.state, '', original);
    localStorage.removeItem(LOCAL_SESSION_STORAGE_KEY);
  });

  function render() {
    const fixture = TestBed.createComponent(SignInPage);
    fixture.detectChanges();
    return { fixture, element: fixture.nativeElement as HTMLElement };
  }

  describe('org server variant', () => {
    beforeEach(() => auth.handleUnauthorized('org'));

    it('offers Sign in with Microsoft and no error at first (ui.md 4.17)', () => {
      const { element } = render();
      expect(element.querySelector('main')).toBeTruthy();
      expect(element.textContent).toContain(
        'Sign in with your organisation account to continue.',
      );
      expect(element.querySelector('[role="alert"]')).toBeNull();
      expect(element.querySelector('select')).toBeNull();
    });

    it('shows the failed sign-in from the URL and removes it from the address bar', () => {
      history.replaceState(
        history.state,
        '',
        `${location.pathname}?signInError=failed`,
      );
      const { element } = render();
      expect(
        element.querySelector('[role="alert"]')?.textContent?.trim(),
      ).toBe('Sign-in failed. Try again.');
      expect(location.search).toBe('');
    });

    it('reads "Signing in…", disabled, while it leaves for the identity provider', () => {
      const navigate = spyOn(auth, 'navigate');
      const { fixture, element } = render();
      const button = element.querySelector('main button') as HTMLButtonElement;
      button.click();
      fixture.detectChanges();

      expect(navigate).toHaveBeenCalledWith('/auth/login');
      expect(button.disabled).toBeTrue();
      expect(button.textContent?.trim()).toBe('Signing in…');
    });
  });

  describe('local mode variant (ui.md 4.17.1)', () => {
    beforeEach(() => auth.handleUnauthorized('local'));

    function renderWithUsers(users = USERS) {
      const view = render();
      http.expectOne('/auth/local/users').flush({ users });
      view.fixture.detectChanges();
      const select = view.element.querySelector(
        'select#local-user',
      ) as HTMLSelectElement;
      const button = Array.from(
        view.element.querySelectorAll('main button'),
      ).find((b) => b.textContent?.includes('Sign in')) as HTMLButtonElement;
      return { ...view, select, button };
    }

    function choose(
      fixture: ReturnType<typeof render>['fixture'],
      select: HTMLSelectElement,
      value: string,
    ) {
      select.value = value;
      select.dispatchEvent(new Event('change'));
      fixture.detectChanges();
    }

    it('shows "Loading users…" until the users answer', () => {
      const { element } = render();
      expect(element.textContent).toContain('Loading users…');
      expect(element.querySelector('select')).toBeNull();
      http.expectOne('/auth/local/users').flush({ users: USERS });
    });

    it('lists the personas with their roles, nobody chosen (admin R70)', () => {
      const { element, select, button } = renderWithUsers();

      expect(element.querySelector('h1')?.textContent?.trim()).toBe(
        'Agentic Hub',
      );
      expect(element.textContent).toContain(
        'Choose who you are to continue. Local mode has no passwords.',
      );
      expect(element.textContent).not.toContain('Sign in with Microsoft');
      const label = element.querySelector('label[for="local-user"]');
      expect(label?.textContent?.trim()).toBe('Sign in as');
      expect(
        Array.from(select.options).map((o) => o.textContent?.trim()),
      ).toEqual([
        'Choose a user',
        'Avery Approver · Approver',
        'Dana Data Owner · User',
        'Demo User · Platform admin',
        'Mark Maker · Maker',
        'Uma User · User',
      ]);
      expect(select.value).toBe('');
      expect(button.textContent?.trim()).toBe('Sign in');
      expect(button.disabled).toBeTrue();
      expect(element.querySelector('[role="alert"]')).toBeNull();
    });

    it('signs in as the chosen user, reading "Signing in…" meanwhile', () => {
      const { fixture, select, button } = renderWithUsers();
      choose(fixture, select, 'local');
      expect(button.disabled).toBeFalse();

      button.click();
      fixture.detectChanges();
      expect(button.disabled).toBeTrue();
      expect(button.textContent?.trim()).toBe('Signing in…');

      const req = http.expectOne('/auth/local/sign-in');
      expect(req.request.body).toEqual({ userId: 'local' });
      req.flush({
        ok: true,
        message: 'Signed in',
        token: 't'.repeat(43),
        me: localMe(),
      });

      expect(auth.status()).toBe('signed-in');
      expect(localStorage.getItem(LOCAL_SESSION_STORAGE_KEY)).toBe(
        't'.repeat(43),
      );
    });

    it('shows "Sign-in failed. Try again." and keeps the choice on failure', () => {
      const { fixture, element, select, button } = renderWithUsers();
      choose(fixture, select, 'local-mark');
      button.click();
      http.expectOne('/auth/local/sign-in').flush(
        {
          statusCode: 404,
          message: 'User local-mark not found',
          error: 'Not Found',
        },
        { status: 404, statusText: 'Not Found' },
      );
      fixture.detectChanges();

      expect(
        element.querySelector('[role="alert"]')?.textContent?.trim(),
      ).toBe('Sign-in failed. Try again.');
      expect(select.value).toBe('local-mark');
      expect(button.disabled).toBeFalse();
      expect(button.textContent?.trim()).toBe('Sign in');
      expect(auth.status()).toBe('signed-out');
    });

    it('says "Backend unreachable" when the users cannot be loaded', () => {
      const { fixture, element } = render();
      http
        .expectOne('/auth/local/users')
        .error(new ProgressEvent('error'), { status: 0, statusText: '' });
      fixture.detectChanges();

      expect(
        element.querySelector('[role="alert"]')?.textContent?.trim(),
      ).toBe('Backend unreachable');
      expect(element.querySelector('select')).toBeNull();
    });
  });

  describe('backend unreachable (ui.md 4.17)', () => {
    beforeEach(() => auth.unreachable());

    it('offers only Retry, which loads GET /me again', () => {
      const { fixture, element } = render();
      expect(
        element.querySelector('[role="alert"]')?.textContent?.trim(),
      ).toBe('Backend unreachable');
      const buttons = Array.from(element.querySelectorAll('main button'));
      expect(buttons.map((b) => b.textContent?.trim())).toEqual(['Retry']);
      expect(element.querySelector('select')).toBeNull();
      expect(element.textContent).not.toContain('Sign in with Microsoft');

      (buttons[0] as HTMLButtonElement).click();
      fixture.detectChanges();
      expect((buttons[0] as HTMLButtonElement).disabled).toBeTrue();

      // The backend is back, in local mode: the users load.
      http.expectOne('/me').flush(
        {
          statusCode: 401,
          message: 'Sign in required',
          error: 'Unauthorized',
          mode: 'local',
        },
        { status: 401, statusText: 'Unauthorized' },
      );
      fixture.detectChanges();
      http.expectOne('/auth/local/users').flush({ users: USERS });
      fixture.detectChanges();

      expect(element.querySelector('[role="alert"]')).toBeNull();
      expect(element.querySelector('select#local-user')).toBeTruthy();
    });
  });

  it('labels a persona with its roles in badge order, or "User" (admin R70)', () => {
    const base = USERS[0];
    expect(
      localUserOptionLabel({
        ...base,
        displayName: 'Ada',
        roles: ['maker', 'data-owner', 'platform-admin', 'approver'],
      }),
    ).toBe('Ada · Platform admin, Approver, Data owner, Maker');
    expect(localUserOptionLabel({ ...base, displayName: 'Ada', roles: [] })).toBe(
      'Ada · User',
    );
  });
});
