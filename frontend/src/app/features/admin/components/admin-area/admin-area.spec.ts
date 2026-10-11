import { TestBed } from '@angular/core/testing';
import { AdminArea } from './admin-area';

describe('AdminArea', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AdminArea],
    }).compileComponents();
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
    return { fixture, element, tabs, selected };
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
});
