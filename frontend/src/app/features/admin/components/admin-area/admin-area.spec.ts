import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { AdminArea } from './admin-area';

describe('AdminArea', () => {
  let http: HttpTestingController;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AdminArea],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();
    http = TestBed.inject(HttpTestingController);
  });

  function render() {
    const fixture = TestBed.createComponent(AdminArea);
    fixture.detectChanges();
    const element = fixture.nativeElement as HTMLElement;
    const tabs = () =>
      Array.from(element.querySelectorAll<HTMLButtonElement>('[role="tab"]'));
    const selected = () =>
      tabs()
        .filter((tab) => tab.getAttribute('aria-selected') === 'true')
        .map((tab) => tab.textContent?.trim());
    /** The header's action buttons (admin R37). */
    const headerActions = () =>
      Array.from(
        element.querySelectorAll<HTMLButtonElement>('.ml-auto > button'),
      ).map((b) => b.textContent?.replace(/\s+/g, ' ').trim());
    return { fixture, element, tabs, selected, headerActions };
  }

  it('shows the heading and three tabs with Overview selected (admin R35)', () => {
    const { element, tabs, selected } = render();
    expect(element.querySelector('h2')?.textContent?.trim()).toBe('Admin');
    expect(
      element.querySelector('[role="tablist"]')?.getAttribute('aria-label'),
    ).toBe('Admin sections');
    expect(tabs().map((tab) => tab.textContent?.trim())).toEqual([
      'Overview',
      'Users & groups',
      'Roles & permissions',
    ]);
    expect(selected()).toEqual(['Overview']);
    const panel = element.querySelector('[role="tabpanel"]') as HTMLElement;
    expect(panel.getAttribute('aria-labelledby')).toBe(tabs()[0].id);
    // The Overview loads as the area opens (admin R38).
    http.expectOne('/admin/overview');
  });

  it('selects a tab on click and labels the panel with it', () => {
    const { fixture, element, tabs, selected } = render();
    tabs()[1].click();
    fixture.detectChanges();
    expect(selected()).toEqual(['Users & groups']);
    expect(
      element
        .querySelector('[role="tabpanel"]')
        ?.getAttribute('aria-labelledby'),
    ).toBe(tabs()[1].id);
    expect(tabs().map((tab) => tab.tabIndex)).toEqual([-1, 0, -1]);
  });

  it('moves between tabs with the arrow keys, Home and End', () => {
    const { fixture, tabs, selected } = render();
    const press = (key: string) => {
      const current = tabs().find((tab) => tab.tabIndex === 0)!;
      current.dispatchEvent(
        new KeyboardEvent('keydown', { key, bubbles: true }),
      );
      fixture.detectChanges();
    };
    press('ArrowLeft');
    expect(selected()).toEqual(['Roles & permissions']);
    expect(document.activeElement).toBe(tabs()[2]);
    press('ArrowRight');
    expect(selected()).toEqual(['Overview']);
    press('End');
    expect(selected()).toEqual(['Roles & permissions']);
    press('Home');
    expect(selected()).toEqual(['Overview']);
  });

  it("shows each tab's own header action (admin R37)", () => {
    const { fixture, tabs, headerActions } = render();
    expect(headerActions()).toEqual(['Export report']);
    tabs()[1].click();
    fixture.detectChanges();
    expect(headerActions()).toEqual(['Assign role']);
    tabs()[2].click();
    fixture.detectChanges();
    expect(headerActions()).toEqual([]);
  });

  it('opens Assign role and reloads the users table once assigned (admin R56)', () => {
    const { fixture, element, tabs } = render();
    tabs()[1].click();
    fixture.detectChanges();
    http.expectOne((req) => req.url === '/admin/users').flush({
      items: [],
      total: 0,
      page: 1,
      pageSize: 25,
      counts: { users: 0, groups: 0, platformAdmins: 0, approvers: 0, dataOwners: 0, makers: 0, inactive: 0 },
      lastSyncAt: null,
    });
    element.querySelector<HTMLButtonElement>('.ml-auto > button')!.click();
    fixture.detectChanges();
    http.expectOne('/datasources').flush({ datasources: [] });
    expect(element.querySelector('[role="dialog"] h2')?.textContent?.trim()).toBe('Assign role');

    fixture.componentInstance.onAssigned();
    fixture.detectChanges();
    expect(element.querySelector('[role="dialog"]')).toBeNull();
    http.expectOne((req) => req.url === '/admin/users');
  });

  it('downloads the report under the server file name (admin R48)', () => {
    const { fixture, element, headerActions } = render();
    http.expectOne('/admin/overview');
    const clicked: string[] = [];
    spyOn(HTMLAnchorElement.prototype, 'click').and.callFake(function (
      this: HTMLAnchorElement,
    ) {
      clicked.push(this.download);
    });

    const exportButton = element.querySelector<HTMLButtonElement>('.ml-auto > button')!;
    exportButton.click();
    fixture.detectChanges();
    expect(headerActions()).toEqual(['Exporting…']);
    expect(exportButton.disabled).toBeTrue();

    http.expectOne('/admin/overview/export').flush(new Blob(['section,label,value']), {
      headers: {
        'Content-Disposition': 'attachment; filename="admin-report-2026-10-10.csv"',
      },
    });
    fixture.detectChanges();
    expect(clicked).toEqual(['admin-report-2026-10-10.csv']);
    expect(headerActions()).toEqual(['Export report']);
  });
});
