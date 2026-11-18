import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ChatMessage, Session } from '../../models/session.model';
import { By } from '@angular/platform-browser';
import { AnswerView } from '../answer-view/answer-view';
import { SessionChat } from './session-chat';

function sessionWith(message: ChatMessage): Session {
  return {
    id: 'session-1',
    name: 'Session 1',
    datasets: [],
    messages: [
      { role: 'user', content: 'Ask', at: '2026-01-01T00:00:00.000Z' },
      message,
    ],
  };
}

describe('SessionChat past chat (past-chats R66)', () => {
  let fixture: ComponentFixture<SessionChat>;

  async function render(message: ChatMessage): Promise<HTMLElement> {
    await TestBed.configureTestingModule({
      imports: [SessionChat],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();
    fixture = TestBed.createComponent(SessionChat);
    fixture.componentRef.setInput('session', sessionWith(message));
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  const answer: ChatMessage = {
    role: 'assistant',
    content: 'Answer',
    at: '2026-01-01T00:00:01.000Z',
    verified: true,
    data: [
      {
        tool: 'run_readonly_sql',
        input: 'select 1',
        rowCount: 500,
      },
    ],
  };

  // How one answer renders (badges, provenance, reasoning, clarification
  // card) is covered by answer-view.spec.ts; these specs cover the chat.

  it('reads the transcript through the answer view, with no composer, rating, visual generation or welcome', async () => {
    const el = await render(answer);
    expect(el.querySelectorAll('app-answer-view').length).toBe(1);
    expect(
      el
        .querySelector('[title="Matches an approved query"]')
        ?.textContent?.trim(),
    ).toBe('Verified');
    expect(el.querySelector('textarea')).toBeNull();
    expect(el.querySelector('[aria-label="Send message"]')).toBeNull();
    expect(el.querySelector('[aria-label="Careful mode"]')).toBeNull();
    expect(el.querySelector('[aria-label="Deep analysis"]')).toBeNull();
    expect(
      el.querySelector('[aria-label="Save as verified query"]'),
    ).toBeNull();
    expect(el.querySelector('[aria-label="Mark answer as wrong"]')).toBeNull();
    expect(el.textContent).not.toContain('Generate interactive visuals');
    expect(el.querySelector('[data-testid="session-welcome"]')).toBeNull();
  });

  it('shows the chat-history navigation only from two user questions', async () => {
    const el = await render(answer);
    expect(
      el.querySelector('[data-testid="session-chat-history-nav"]'),
    ).toBeNull();
    fixture.componentRef.setInput('session', {
      ...sessionWith(answer),
      messages: [
        { role: 'user', content: 'First', at: '2026-01-01T00:00:00.000Z' },
        answer,
        { role: 'user', content: 'Second', at: '2026-01-01T00:00:02.000Z' },
        answer,
      ],
    });
    fixture.detectChanges();
    const items = Array.from(
      el.querySelectorAll('[data-testid^="session-chat-history-item-"]'),
    );
    expect(items.map((i) => i.textContent?.trim())).toEqual(['First', 'Second']);
  });

  it('copies a user question', async () => {
    const el = await render(answer);
    const clipboard = spyOn(navigator.clipboard, 'writeText').and.resolveTo();
    el.querySelector<HTMLButtonElement>('[title="Copy message"]')!.click();
    expect(clipboard).toHaveBeenCalledWith('Ask');
  });

  it('asks the host to view a visual the chat created', async () => {
    const visual = {
      visualId: 'v1',
      version: 1,
      title: 'Claims',
      action: 'created' as const,
    };
    const card = await render({
      role: 'assistant',
      content: 'Created interactive visual "Claims".',
      at: '2026-01-01T00:00:01.000Z',
      visual,
    });
    const viewed: unknown[] = [];
    fixture.componentInstance.viewVisual.subscribe((v) => viewed.push(v));
    Array.from(card.querySelectorAll('button'))
      .find((b) => b.textContent?.trim() === 'View')!
      .click();
    expect(viewed).toEqual([visual]);
  });
});

describe('SessionChat query inspector (past-chats R70; plan 1.25.10)', () => {
  const sqlRecord = (rationale: string) => ({
    tool: 'run_readonly_sql',
    input: 'select count(*) as n from matches',
    columns: ['n'],
    rows: [{ n: 964 }],
    rowCount: 1,
    rationale,
  });
  const answerAt = (at: string, rationale: string): ChatMessage => ({
    role: 'assistant',
    content: 'The data holds 964 matches.',
    at,
    data: [sqlRecord(rationale)],
    evidence: [{ index: 0, coverage: 'whole-table' }],
  });
  const plain: ChatMessage = {
    role: 'assistant',
    content: 'Hello there',
    at: '2026-01-01T00:00:09.000Z',
  };
  const session = (id = 's1'): Session => ({
    id,
    name: 'S',
    datasets: [],
    messages: [
      { role: 'user', content: 'How many matches?', at: '2026-01-01T00:00:00Z' },
      answerAt('2026-01-01T00:00:01Z', 'First count.'),
      { role: 'user', content: 'And again?', at: '2026-01-01T00:00:02Z' },
      answerAt('2026-01-01T00:00:03Z', 'Second count.'),
      { role: 'user', content: 'Hi', at: '2026-01-01T00:00:04Z' },
      plain,
    ],
  });

  let fixture: ComponentFixture<SessionChat>;
  let http: HttpTestingController;
  let el: HTMLElement;
  const evidenceUrl = (id: string, message: number) =>
    (r: { url: string; method: string }) =>
      r.method === 'POST' &&
      r.url.endsWith(`/sessions/${id}/messages/${message}/answer/evidence`);

  beforeEach(async () => {
    (window.document.activeElement as HTMLElement | null)?.blur();
    await TestBed.configureTestingModule({
      imports: [SessionChat],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();
    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(SessionChat);
    fixture.componentRef.setInput('session', session());
    fixture.detectChanges();
    el = fixture.nativeElement as HTMLElement;
  });

  it('shows chips and query rows on an answer with data, and a message without data as before', () => {
    http.expectOne(evidenceUrl('s1', 3)).flush({ ok: true, message: answerAt('2026-01-01T00:00:03Z', 'Second count.') });
    fixture.detectChanges();
    expect(el.querySelectorAll('[data-testid="query-row-0"]').length).toBe(2);
    expect(el.querySelectorAll('[data-testid="figure-ref"]').length).toBeGreaterThan(0);
    expect(el.textContent).not.toContain('Data used');
    const views = el.querySelectorAll('app-answer-view');
    expect(views[2].querySelector('[data-testid="query-row-0"]')).toBeNull();
    expect(views[2].textContent).toContain('Hello there');
  });

  it('passes the user message before an answer as its question', () => {
    http.expectOne(evidenceUrl('s1', 3)).flush({ ok: true, message: answerAt('2026-01-01T00:00:03Z', 'Second count.') });
    const views = fixture.debugElement.queryAll(By.directive(AnswerView));
    const questions = views.map((v) => (v.componentInstance as AnswerView).question());
    expect(questions).toEqual(['How many matches?', 'And again?', 'Hi']);
    const inspector = views.map((v) => (v.componentInstance as AnswerView).queryInspector());
    expect(inspector).toEqual([true, true, false]);
  });

  it('opens the inspector from a row on that message and query; Escape closes it and gives the focus back', async () => {
    http.expectOne(evidenceUrl('s1', 3)).flush({ ok: true, message: answerAt('2026-01-01T00:00:03Z', 'Second count.') });
    fixture.detectChanges();
    const row = el.querySelectorAll<HTMLElement>('[data-testid="query-row-0"]')[0];
    row.focus();
    row.click();
    fixture.detectChanges();
    // The inspector is a deferred block: it renders once its chunk has loaded.
    await fixture.whenStable();
    fixture.detectChanges();
    const sheet = el.querySelector('[data-testid="query-inspector-sheet"]')!;
    expect(sheet.querySelector('[data-testid="query-inspector-title"]')?.textContent).toContain('First count.');
    expect(sheet.querySelector('[data-testid="query-inspector-position"]')?.textContent).toContain('Source 1 of 1');

    sheet
      .querySelector('[data-testid="query-inspector"]')!
      .dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    fixture.detectChanges();
    expect(el.querySelector('[data-testid="query-inspector-sheet"]')).toBeNull();
    await new Promise((resolve) => setTimeout(resolve));
    expect(window.document.activeElement).toBe(row);
    // The first message's evidence was built when its query was first opened.
    http.expectOne(evidenceUrl('s1', 1)).flush({ ok: true, message: answerAt('2026-01-01T00:00:01Z', 'First count.') });
    http.match(() => true);
  });

  it('builds the evidence of the last answer once on opening and of another when its query is first opened', () => {
    http.expectOne(evidenceUrl('s1', 3)).flush({ ok: true, message: answerAt('2026-01-01T00:00:03Z', 'Second count.') });
    fixture.detectChanges();
    http.expectNone(evidenceUrl('s1', 1));
    const rows = el.querySelectorAll<HTMLElement>('[data-testid="query-row-0"]');
    rows[1].click();
    fixture.detectChanges();
    http.expectNone(evidenceUrl('s1', 3));
    rows[0].click();
    fixture.detectChanges();
    const other = http.expectOne(evidenceUrl('s1', 1));
    other.flush({ ok: true, message: answerAt('2026-01-01T00:00:01Z', 'First count.') });
    fixture.detectChanges();
    rows[0].click();
    http.expectNone(evidenceUrl('s1', 1));
    http.match(() => true);
  });

  it('shows the message a call answered in place, without changing the session input', () => {
    const input = fixture.componentInstance.session();
    const filled: ChatMessage = {
      ...answerAt('2026-01-01T00:00:03Z', 'Second count.'),
      evidence: [{ index: 0, coverage: 'partial', datasourceKind: 'postgres' }],
    };
    http.expectOne(evidenceUrl('s1', 3)).flush({ ok: true, message: filled });
    fixture.detectChanges();
    expect(fixture.componentInstance.messages()[3]).toBe(filled);
    expect(input.messages[3].evidence?.[0].coverage).toBe('whole-table');
    // The same session, refreshed: the update stays.
    fixture.componentRef.setInput('session', { ...session() });
    fixture.detectChanges();
    expect(fixture.componentInstance.messages()[3]).toBe(filled);
    http.expectNone(evidenceUrl('s1', 3));
  });

  it('resets the open query and the prepared answers when the session id changes', () => {
    http.expectOne(evidenceUrl('s1', 3)).flush({ ok: true, message: answerAt('2026-01-01T00:00:03Z', 'Second count.') });
    fixture.detectChanges();
    el.querySelectorAll<HTMLElement>('[data-testid="query-row-0"]')[1].click();
    fixture.detectChanges();
    expect(el.querySelector('[data-testid="query-inspector-sheet"]')).not.toBeNull();

    fixture.componentRef.setInput('session', session('s2'));
    fixture.detectChanges();
    expect(el.querySelector('[data-testid="query-inspector-sheet"]')).toBeNull();
    http.expectOne(evidenceUrl('s2', 3));
    http.match(() => true);
  });

  it('stays silent when preparing fails', () => {
    http
      .expectOne(evidenceUrl('s1', 3))
      .flush({ message: 'boom' }, { status: 500, statusText: 'Server Error' });
    fixture.detectChanges();
    expect(el.querySelectorAll('[data-testid="query-row-0"]').length).toBe(2);
    http.match(() => true);
  });
});
