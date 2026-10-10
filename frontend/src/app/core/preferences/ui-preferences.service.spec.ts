import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { API_BASE_URL } from '../config/api.config';
import { THEME_STORAGE_KEY, ThemeService } from '../theme/theme.service';
import {
  NAV_EXPANDED_STORAGE_KEY,
  UiPreferencesService,
  parseNavExpanded,
} from './ui-preferences.service';

const URL = `${API_BASE_URL}/ui-preferences`;

describe('parseNavExpanded', () => {
  it('is expanded unless false was stored', () => {
    expect(parseNavExpanded(null)).toBeTrue();
    expect(parseNavExpanded('true')).toBeTrue();
    expect(parseNavExpanded('junk')).toBeTrue();
    expect(parseNavExpanded('false')).toBeFalse();
  });
});

describe('UiPreferencesService', () => {
  let http: HttpTestingController;

  function create(): UiPreferencesService {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    http = TestBed.inject(HttpTestingController);
    return TestBed.inject(UiPreferencesService);
  }

  afterEach(() => {
    http.verify();
    localStorage.removeItem(THEME_STORAGE_KEY);
    localStorage.removeItem(NAV_EXPANDED_STORAGE_KEY);
  });

  it('applies the backend values, which win over the browser copies', () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'light');
    localStorage.setItem(NAV_EXPANDED_STORAGE_KEY, 'true');
    const prefs = create();
    prefs.load();
    http.expectOne(URL).flush({ theme: 'dark', navExpanded: false });

    expect(TestBed.inject(ThemeService).preference()).toBe('dark');
    expect(prefs.navExpanded()).toBeFalse();
    expect(localStorage.getItem(NAV_EXPANDED_STORAGE_KEY)).toBe('false');
  });

  it('moves a browser-only theme choice to the backend once', () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'dark');
    const prefs = create();
    prefs.load();
    http.expectOne(URL).flush({ theme: null, navExpanded: null });

    const put = http.expectOne({ method: 'PUT', url: URL });
    expect(put.request.body).toEqual({ theme: 'dark' });
    put.flush({ ok: true });
    expect(prefs.navExpanded()).toBeTrue();
  });

  it('writes nothing when nothing was ever chosen', () => {
    const prefs = create();
    prefs.load();
    http.expectOne(URL).flush({ theme: null, navExpanded: null });

    expect(TestBed.inject(ThemeService).preference()).toBe('light');
  });

  it('remembers drawer clicks and keeps them over a late backend answer', () => {
    const prefs = create();
    prefs.load();
    prefs.setNavExpanded(false);
    http
      .expectOne({ method: 'PUT', url: URL })
      .flush({ ok: true });
    http.expectOne({ method: 'GET', url: URL }).flush({
      theme: null,
      navExpanded: true,
    });

    expect(prefs.navExpanded()).toBeFalse();
    expect(localStorage.getItem(NAV_EXPANDED_STORAGE_KEY)).toBe('false');
  });
});
