import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { WorkflowRunSummary } from '../../../workflows/models/workflow.model';
import { SessionsState } from '../../../sessions/services/sessions-state';
import { RunsState } from '../../services/runs-state';
import { RunsPage } from './runs-page';

function summary(n: number): WorkflowRunSummary {
  return {
    id: `run-${String(n).padStart(2, '0')}-aaaa`,
    workflowId: 'agent:assistant',
    workflowName: 'Assistant',
    status: n === 3 ? 'failed' : 'success',
    title: `Question ${n}`,
    startedAt: '2026-01-01T00:00:00Z',
  };
}

describe('RunsPage (app-shell R46; plan 1.24.11)', () => {
  let http: HttpTestingController;

  let fixture: ComponentFixture<RunsPage>;

  function mount(rows: WorkflowRunSummary[]): HTMLElement {
    fixture = TestBed.createComponent(RunsPage);
    fixture.detectChanges();
    http
      .expectOne((r) => r.url.endsWith('/workflow-runs'))
      .flush({ runs: rows });
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [RunsPage],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('lists runs ten to a page with a range and paging', () => {
    const el = mount(Array.from({ length: 12 }, (_, i) => summary(i + 1)));
    expect(el.querySelectorAll('[data-testid^="run-run-"]').length).toBe(10);
    expect(el.querySelector('[data-testid="runs-pagination"]')?.textContent).toContain(
      '1–10 of 12',
    );
    el.querySelector<HTMLButtonElement>('[aria-label="Next page"]')!.click();
    fixture.detectChanges();
    expect(el.querySelectorAll('[data-testid^="run-run-"]').length).toBe(2);
    expect(el.querySelector('[data-testid="runs-pagination"]')?.textContent).toContain(
      '11–12 of 12',
    );
  });

  it('shows a suspended run with a Waiting for you chip', () => {
    const el = mount([{ ...summary(1), status: 'suspended' }, summary(2)]);
    const chips = Array.from(
      el.querySelectorAll('[data-testid="row-run-status"]'),
    );
    expect(chips[0].textContent?.trim()).toBe('Waiting for you');
    expect(chips[0].classList).toContain('chip-warning');
    expect(chips[1].textContent?.trim()).toBe('Done');
  });

  it('shows the title, workflow, status and id of a run, and opens it on click', () => {
    const el = mount([summary(3)]);
    const row = el.querySelector('[data-testid="run-run-03-aaaa"]')!;
    expect(row.querySelector('[data-testid="row-run-title"]')?.textContent).toContain(
      'Question 3',
    );
    expect(row.querySelector('[data-testid="row-run-workflow"]')?.textContent).toContain(
      'Assistant',
    );
    expect(row.querySelector('[data-testid="row-run-status"]')?.textContent).toContain(
      'Failed',
    );
    expect(row.querySelector('[data-testid="row-run-id"]')?.textContent).toContain(
      'ID run-03-a',
    );
    const open = spyOn(TestBed.inject(RunsState), 'openRun');
    row.querySelector<HTMLButtonElement>('button')!.click();
    expect(open).toHaveBeenCalledWith('run-03-aaaa');
  });

  it('searches by title', () => {
    const el = mount([summary(1), summary(2)]);
    const input = el.querySelector<HTMLInputElement>('[data-testid="runs-search"]')!;
    input.value = 'question 2';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    const rows = el.querySelectorAll('[data-testid^="run-run-"]');
    expect(rows.length).toBe(1);
    expect(rows[0].getAttribute('data-testid')).toBe('run-run-02-aaaa');
  });

  it('switches to the Past chats tab, whose rows open read-only', () => {
    mount([summary(1)]);
    const sessions = TestBed.inject(SessionsState);
    sessions.sessions.set([{ id: 's1', name: 'Old chat', datasets: [], messages: [] }]);
    sessions.sessionsLoaded.set(true);
    TestBed.inject(RunsState).setTab('past-chats');
    fixture.detectChanges();
    const past = fixture.nativeElement as HTMLElement;
    expect(past.querySelector('nav[aria-label="Past chats"]')).toBeTruthy();
    const open = spyOn(sessions, 'openPastChat');
    past.querySelector<HTMLButtonElement>('[data-testid="session-s1"] button')!.click();
    expect(open).toHaveBeenCalled();
  });
});
