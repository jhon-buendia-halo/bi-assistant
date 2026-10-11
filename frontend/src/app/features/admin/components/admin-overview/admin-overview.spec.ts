import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { ToastService } from '../../../../core/toast/toast.service';
import { emptyWeeks, overview } from '../../testing/admin.fixtures';
import { AdminOverviewTab, attentionRows } from './admin-overview';

describe('AdminOverviewTab', () => {
  let http: HttpTestingController;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AdminOverviewTab],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  function render() {
    const fixture = TestBed.createComponent(AdminOverviewTab);
    fixture.detectChanges();
    const element = fixture.nativeElement as HTMLElement;
    const text = () => element.textContent?.replace(/\s+/g, ' ') ?? '';
    return { fixture, element, text };
  }

  it('shows a loading line, then the tiles (admin R38, R41)', () => {
    const { fixture, element, text } = render();
    expect(text()).toContain('Loading overview…');

    http
      .expectOne('/admin/overview')
      .flush(overview({ activeUsers30d: 1940, agentsLive: 64 }));
    fixture.detectChanges();

    const tiles = Array.from(
      element.querySelectorAll('[data-testid="admin-tile"] p'),
    ).map((tile) =>
      Array.from(tile.querySelectorAll('span')).map((span) => span.textContent?.trim()),
    );
    expect(tiles).toEqual([
      ['1,940', 'Active users · 30 days'],
      ['64', 'Agents live'],
    ]);
  });

  it('keeps the three attention rows, disabling actions at 0 (admin R42)', () => {
    const { fixture, element } = render();
    http.expectOne('/admin/overview').flush(overview());
    fixture.detectChanges();

    const rows = Array.from(element.querySelectorAll('li.list-row'));
    expect(rows.map((row) => row.querySelector('span')?.textContent)).toEqual([
      'Agents without an active owner',
      'Agents with errors in the last 7 days',
      'Users inactive for 90+ days with Maker role',
    ]);
    const buttons = rows.map((row) => row.querySelector('button')!);
    expect(buttons.map((b) => b.textContent?.trim())).toEqual([
      'Assign',
      'Inspect',
      'Clean up',
    ]);
    expect(buttons.every((b) => b.disabled && b.title === 'Nothing to do')).toBeTrue();
    expect(
      rows.map((row) => row.querySelector('[data-testid="attention-count"]')?.textContent?.trim()),
    ).toEqual(['0 agents', '0 agents', '0 users']);
  });

  it('styles and counts the attention badges', () => {
    const rows = attentionRows(
      overview({
        attention: {
          ownerlessAgents: { count: 1, items: [] },
          erroredAgents: { count: 2, items: [] },
          inactiveMakers: { count: 5, items: [] },
        },
      }),
    );
    expect(rows.map((r) => [r.badge, r.chip])).toEqual([
      ['1 agent', 'chip-danger'],
      ['2 agents', 'chip-danger'],
      ['5 users', 'chip-neutral'],
    ]);
  });

  it('shows the empty chart caption and no recent activity (admin R46, R47)', () => {
    const { fixture, element, text } = render();
    http.expectOne('/admin/overview').flush(overview());
    fixture.detectChanges();

    expect(text()).toContain('Last 8 weeks · no activity yet');
    expect(text()).toContain('No activity yet.');
    const rows = element.querySelectorAll('table.sr-only tbody tr');
    expect(rows.length).toBe(8);
  });

  it('highlights the current week and lists recent activity', () => {
    const { fixture, element, text } = render();
    const weeks = emptyWeeks().map((week, i) => ({ ...week, users: i === 7 ? 3 : 1 }));
    http.expectOne('/admin/overview').flush(
      overview({
        weeklyActiveUsers: weeks,
        recentActivity: [
          {
            id: 'e1',
            type: 'role.assigned',
            at: new Date().toISOString(),
            text: 'Avery Admin gave Ada Lovelace the Maker role',
          },
        ],
      }),
    );
    fixture.detectChanges();

    expect(text()).toContain('Last 8 weeks · peak 3 this week');
    expect(text()).toContain('Avery Admin gave Ada Lovelace the Maker role');
    expect(text()).toContain('just now');
    const bars = element.querySelectorAll<HTMLElement>('figure [aria-hidden="true"] > div');
    expect(bars.length).toBe(8);
    expect(bars[7].classList).toContain('bg-primary');
    expect(bars[0].classList).toContain('bg-border-strong');
    expect(bars[7].style.height).toBe('120px');
  });

  it("shows the server's message with Retry when loading fails (admin R38)", () => {
    const { fixture, element, text } = render();
    http
      .expectOne('/admin/overview')
      .flush({ message: 'Database locked' }, { status: 500, statusText: 'Error' });
    fixture.detectChanges();

    expect(text()).toContain('Database locked');
    const retry = Array.from(element.querySelectorAll('button')).find(
      (b) => b.textContent?.trim() === 'Retry',
    )!;
    retry.click();
    fixture.detectChanges();
    expect(text()).toContain('Loading overview…');
    http.expectOne('/admin/overview').flush(overview());
  });

  it('opens Inspect read-only, listing each agent with its last error (admin R44)', () => {
    const { fixture, element } = render();
    http.expectOne('/admin/overview').flush(
      overview({
        attention: {
          ownerlessAgents: { count: 0, items: [] },
          erroredAgents: {
            count: 1,
            items: [
              {
                agentId: 'a1',
                agentName: 'Goal analyst',
                owner: { id: 'u-ada', displayName: 'Ada Lovelace' },
                errors: 1,
                lastErrorAt: new Date().toISOString(),
                lastErrorMessage: 'Model unavailable',
              },
            ],
          },
          inactiveMakers: { count: 0, items: [] },
        },
      }),
    );
    fixture.detectChanges();
    const inspect = Array.from(element.querySelectorAll('button')).find(
      (b) => b.textContent?.trim() === 'Inspect',
    )!;
    inspect.click();
    fixture.detectChanges();

    const dialog = element.querySelector('[role="dialog"]')!;
    expect(dialog.querySelector('h2')?.textContent?.trim()).toBe('Agents with errors');
    const cells = Array.from(dialog.querySelectorAll('tbody td')).map((td) =>
      td.textContent?.replace(/\s+/g, ' ').trim(),
    );
    expect(cells).toEqual(['Goal analyst', 'Ada Lovelace', '1', 'just nowModel unavailable']);
    expect(
      Array.from(dialog.querySelectorAll('button')).map((b) => b.textContent?.trim()),
    ).toEqual(['Close']);
  });

  it('toasts a failed reload and keeps the figures', () => {
    const toast = TestBed.inject(ToastService);
    const { fixture, text } = render();
    http.expectOne('/admin/overview').flush(overview({ agentsLive: 4 }));
    fixture.detectChanges();

    fixture.componentInstance.load();
    http
      .expectOne('/admin/overview')
      .flush({ message: 'Nope' }, { status: 500, statusText: 'Error' });
    fixture.detectChanges();
    expect(text()).toContain('Agents live');
    expect(toast.toasts().map((t) => t.message)).toContain('Nope');
  });
});
