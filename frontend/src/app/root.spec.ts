import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { LOCAL_ME } from './core/auth/auth.models';
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
    http.expectOne('/me').flush(LOCAL_ME);
    fixture.detectChanges();
    expect(element.querySelector('app-shell')).toBeTruthy();
    expect(element.querySelector('app-sign-in-page')).toBeNull();
    // The shell's own start-up loads follow.
    http.expectOne('/sessions');
    http.expectOne('/ui-preferences');
  });

  it('shows only the sign-in page when GET /me answers 401 (admin R5)', () => {
    const { fixture, element } = render();
    http
      .expectOne('/me')
      .flush(
        { statusCode: 401, message: 'Sign in required' },
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
});
