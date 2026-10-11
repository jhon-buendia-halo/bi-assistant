import { TestBed, fakeAsync, tick } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { localMe } from './core/auth/auth.testing';
import { Root } from './root';

describe('Root', () => {
  let http: HttpTestingController;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Root],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();
    http = TestBed.inject(HttpTestingController);
  });

  function render() {
    const fixture = TestBed.createComponent(Root);
    fixture.detectChanges();
    return { fixture, element: fixture.nativeElement as HTMLElement };
  }

  it('loads the current user before anything else (ui.md 1.6)', () => {
    const { element } = render();
    http.expectOne('/me');
    // Nothing else is requested, and no shell is shown, until it answers.
    http.verify({ ignoreCancelled: true });
    expect(element.querySelector('app-shell')).toBeNull();
    expect(element.querySelector('app-sign-in-page')).toBeNull();
  });

  it('shows the shell once GET /me answers', () => {
    const { fixture, element } = render();
    http.expectOne('/me').flush(localMe());
    fixture.detectChanges();
    expect(element.querySelector('app-shell')).toBeTruthy();
    expect(element.querySelector('app-sign-in-page')).toBeNull();
    // The shell's own start-up loads follow.
    http.expectOne('/sessions');
    http.expectOne('/ui-preferences');
  });

  it('shows only the sign-in page when GET /me answers 401 (admin R5)', () => {
    const { fixture, element } = render();
    http.expectOne('/me').flush(
      {
        statusCode: 401,
        message: 'Sign in required',
        error: 'Unauthorized',
        mode: 'org',
      },
      { status: 401, statusText: 'Unauthorized' },
    );
    fixture.detectChanges();

    expect(element.querySelector('app-shell')).toBeNull();
    expect(element.querySelector('[aria-label="Navigation rail"]')).toBeNull();
    const page = element.querySelector('app-sign-in-page') as HTMLElement;
    expect(page.querySelector('h1')?.textContent?.trim()).toBe('Agentic Hub');
    expect(page.querySelector('main button')?.textContent?.trim()).toBe(
      'Sign in with Microsoft',
    );
    http.verify();
  });

  it('shows the local sign-in page when GET /me answers 401 in local mode (admin R70)', () => {
    const { fixture, element } = render();
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
    http.expectOne('/auth/local/users').flush({ users: [] });
    fixture.detectChanges();

    expect(element.querySelector('app-shell')).toBeNull();
    const page = element.querySelector('app-sign-in-page') as HTMLElement;
    expect(page.querySelector('select#local-user')).toBeTruthy();
    expect(page.textContent).not.toContain('Sign in with Microsoft');
    http.verify();
  });

  it('never opens the shell when the backend is unreachable (ui.md 1.6)', fakeAsync(() => {
    const { fixture, element } = render();
    for (let attempt = 0; attempt <= 12; attempt++) {
      http
        .expectOne('/me')
        .error(new ProgressEvent('error'), { status: 0, statusText: '' });
      tick(1_000);
    }
    fixture.detectChanges();

    expect(element.querySelector('app-shell')).toBeNull();
    const page = element.querySelector('app-sign-in-page') as HTMLElement;
    expect(page.querySelector('[role="alert"]')?.textContent?.trim()).toBe(
      'Backend unreachable',
    );
    expect(page.querySelector('main button')?.textContent?.trim()).toBe(
      'Retry',
    );
    http.verify();
  }));
});
