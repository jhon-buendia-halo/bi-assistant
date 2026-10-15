import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Session } from '../../models/session.model';
import { SessionsList, sessionActivityLabel } from './sessions-list';

const NOW = Date.parse('2026-10-14T12:00:00Z');

function session(
  over: Partial<Session> & { id: string; name: string },
): Session {
  return { datasets: [], messages: [], ...over };
}

describe('sessionActivityLabel', () => {
  it('reads recent times relatively, then yesterday, then a date', () => {
    expect(sessionActivityLabel('2026-10-14T11:59:50Z', NOW)).toBe('just now');
    expect(sessionActivityLabel('2026-10-14T11:30:00Z', NOW)).toBe(
      '30 min ago',
    );
    expect(sessionActivityLabel('2026-10-14T10:00:00Z', NOW)).toBe('2 h ago');
    expect(sessionActivityLabel('2026-10-13T08:00:00Z', NOW)).toBe('yesterday');
    expect(sessionActivityLabel('2026-09-20T08:00:00Z', NOW)).toBe('Sep 20');
    expect(sessionActivityLabel('2025-09-20T08:00:00Z', NOW)).toBe(
      'Sep 20, 2025',
    );
    expect(sessionActivityLabel(null, NOW)).toBe('');
  });
});

describe('SessionsList', () => {
  let fixture: ComponentFixture<SessionsList>;
  const root = () => fixture.nativeElement as HTMLElement;

  function setup(sessions: Session[], loading = false): void {
    fixture = TestBed.createComponent(SessionsList);
    fixture.componentRef.setInput('sessions', sessions);
    fixture.componentRef.setInput('loading', loading);
    fixture.detectChanges();
  }

  beforeEach(() => TestBed.configureTestingModule({ imports: [SessionsList] }));

  it('lists a row per session with its agent line, in landmark nav', () => {
    setup([
      session({
        id: 'a',
        name: 'Alpha',
        datasets: ['World Cup'],
        agent: { name: 'RFP Builder' } as Session['agent'],
        updatedAt: new Date(Date.now() - 2 * 3_600_000).toISOString(),
      }),
      session({ id: 'b', name: 'Beta', datasets: ['F1'] }),
    ]);
    expect(root().querySelector('nav[aria-label="Sessions"]')).toBeTruthy();
    const rows = root().querySelectorAll('[data-testid^="session-"]');
    expect(rows.length).toBe(2);
    expect(rows[0].textContent).toContain('Alpha');
    expect(
      rows[0].querySelector('[data-testid="row-session-agent"]')?.textContent,
    ).toContain('RFP Builder');
    expect(rows[0].textContent).toContain('World Cup');
    expect(
      rows[1].querySelector('[data-testid="row-session-agent"]')?.textContent,
    ).toContain('Assistant');
    expect(rows[0].textContent).toContain('2 h ago');
    expect(rows[1].textContent).toContain('F1');
  });

  it('filters by name, case-insensitively, and explains no match', () => {
    setup([
      session({ id: 'a', name: 'Alpha' }),
      session({ id: 'b', name: 'Beta' }),
    ]);
    const input = root().querySelector('input') as HTMLInputElement;
    expect(input.placeholder).toBe('Search sessions by name or ID…');
    input.value = 'ALP';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    expect(root().querySelectorAll('[data-testid^="session-"]').length).toBe(1);
    input.value = 'zzz';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    expect(root().textContent).toContain('No sessions match "zzz".');
  });

  it('shows loading and empty states', () => {
    setup([], true);
    expect(root().textContent).toContain('Loading sessions…');
    fixture.componentRef.setInput('loading', false);
    fixture.detectChanges();
    expect(root().textContent).toContain(
      'No sessions yet. Start a new conversation or open an agent.',
    );
    expect(root().textContent).toContain('Start New Conversation');
  });

  it('opens a session and offers Delete session from the options menu', () => {
    const alpha = session({ id: 'a', name: 'Alpha' });
    setup([alpha]);
    const opened: Session[] = [];
    const deleted: Session[] = [];
    fixture.componentInstance.openSession.subscribe((s) => opened.push(s));
    fixture.componentInstance.deleteSession.subscribe((s) => deleted.push(s));
    (
      root().querySelector('[data-testid="session-a"] button') as HTMLElement
    ).click();
    expect(opened).toEqual([alpha]);
    (
      root().querySelector('[aria-label="Options for Alpha"]') as HTMLElement
    ).click();
    fixture.detectChanges();
    const item = Array.from(root().querySelectorAll('.menu-item')).find((el) =>
      el.textContent?.includes('Delete session'),
    ) as HTMLElement;
    item.click();
    expect(deleted).toEqual([alpha]);
  });
});

describe('SessionsList ids and pages', () => {
  function many(count: number): Session[] {
    return Array.from({ length: count }, (_, i) =>
      session({
        id: `id-${String(i + 1).padStart(2, '0')}-0000-0000`,
        name: `Session ${i + 1}`,
      }),
    );
  }

  function setup(sessions: Session[]) {
    TestBed.configureTestingModule({ imports: [SessionsList] });
    const fixture = TestBed.createComponent(SessionsList);
    fixture.componentRef.setInput('sessions', sessions);
    fixture.detectChanges();
    return fixture;
  }

  const rows = (el: HTMLElement) =>
    [...el.querySelectorAll('li[data-testid^="session-"]')].map((r) =>
      r.querySelector('span')?.textContent?.trim(),
    );

  it("shows each session's short id and finds a session by id", () => {
    const fixture = setup(many(3));
    const el: HTMLElement = fixture.nativeElement;
    const ids = [...el.querySelectorAll('[data-testid="row-session-id"]')];
    expect(ids[1].textContent).toContain('ID id-02-00');
    expect(ids[1].getAttribute('title')).toBe(
      'Session ID id-02-0000-0000 (click to copy)',
    );
    const search = el.querySelector<HTMLInputElement>(
      '[data-testid="sessions-search"]',
    )!;
    search.value = 'id-03';
    search.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    expect(rows(el)).toEqual(['Session 3']);
  });

  it('pages ten sessions at a time', () => {
    const fixture = setup(many(23));
    const el: HTMLElement = fixture.nativeElement;
    const pager = () =>
      el.querySelector('[data-testid="sessions-pagination"]')!.textContent!;
    expect(rows(el).length).toBe(10);
    expect(pager()).toContain('1–10 of 23');
    expect(pager()).toContain('Page 1 of 3');
    el.querySelector<HTMLButtonElement>('[aria-label="Next page"]')!.click();
    fixture.detectChanges();
    el.querySelector<HTMLButtonElement>('[aria-label="Next page"]')!.click();
    fixture.detectChanges();
    expect(rows(el)).toEqual(['Session 21', 'Session 22', 'Session 23']);
    expect(pager()).toContain('21–23 of 23');
    expect(
      el.querySelector<HTMLButtonElement>('[aria-label="Next page"]')!.disabled,
    ).toBeTrue();
  });

  it('shows no pager buttons for a single page', () => {
    const el: HTMLElement = setup(many(4)).nativeElement;
    expect(el.querySelector('[aria-label="Next page"]')).toBeNull();
    expect(
      el.querySelector('[data-testid="sessions-pagination"]')!.textContent,
    ).toContain('1–4 of 4');
  });
});
