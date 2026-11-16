import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import {
  ComponentFixture,
  TestBed,
  fakeAsync,
  tick,
} from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { BackgroundTasksService } from '../../../../core/background-tasks/background-tasks.service';
import { API_BASE_URL } from '../../../../core/config/api.config';
import {
  AgentDetail as AgentDetailModel,
  AgentEvalCaseResult,
} from '../../services/agents-api.service';
import { AgentPageState } from '../../services/agent-page-state.service';
import { AgentDetail } from './agent-detail';

const key = 'insights-analyst';
const agentUrl = `${API_BASE_URL}/agents/${key}`;
const startUrl = `${agentUrl}/evals/run`;
const pollUrl = `${agentUrl}/evals/runs/j1`;

function result(id: string, passed: boolean): AgentEvalCaseResult {
  return {
    id,
    question: id,
    scores: {},
    checkResults: [],
    answer: '',
    toolCalls: [],
    passed,
    durationMs: 1,
  };
}

function poll(
  status: 'running' | 'completed' | 'failed',
  results: AgentEvalCaseResult[],
  extra: Record<string, unknown> = {},
) {
  return {
    ok: true,
    message: '',
    jobId: 'j1',
    status,
    results,
    totalCases: 3,
    datasets: ['World Cup'],
    ...extra,
  };
}

/**
 * An eval run is an `eval-run` background task (ADR-0047, agents-evals):
 * polling lives at the root, so leaving the agent page neither stops the run
 * nor leaks a timer, and the page shows the run again when it is reopened.
 */
describe('AgentDetail eval run as a background task', () => {
  let http: HttpTestingController;
  let tasks: BackgroundTasksService;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AgentDetail],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
      ],
    }).compileComponents();
    http = TestBed.inject(HttpTestingController);
    tasks = TestBed.inject(BackgroundTasksService);
  });

  function open(): ComponentFixture<AgentDetail> {
    const fixture = TestBed.createComponent(AgentDetail);
    fixture.componentRef.setInput('agentKey', key);
    fixture.detectChanges();
    http.expectOne(agentUrl).flush({
      key,
      id: key,
      name: 'Insights Analyst',
      description: '',
      tools: [],
      kind: 'official',
      status: 'builtin',
      instructions: '',
      toolDetails: [],
      memory: null,
      model: null,
      datasets: [],
      usedInWorkflows: [],
    } as unknown as AgentDetailModel);
    fixture.detectChanges();
    return fixture;
  }

  function startRun(fixture: ComponentFixture<AgentDetail>): void {
    const page = fixture.componentInstance;
    page.selectedDatasourceId.set('ds-1');
    page.selectedCaseIds.set(new Set(['a', 'b', 'c']));
    page.startRun();
    http.expectOne(startUrl).flush({ ok: true, message: '', jobId: 'j1' });
  }

  it('polls at the root until the terminal status and leaves no timer', fakeAsync(() => {
    const first = open();
    startRun(first);
    // Started: shown as running with no result yet (0/3 done) until the first read.
    expect(first.componentInstance.runStarting()).toBeFalse();
    expect(first.componentInstance.runStatus()).toBe('running');
    expect(first.componentInstance.runResults().length).toBe(0);
    http.expectNone(pollUrl);

    tick(1500);
    http.expectOne(pollUrl).flush(poll('running', [result('a', true)]));
    expect(first.componentInstance.runStatus()).toBe('running');
    const task = tasks.active('eval-run', key)!;
    expect(task.title).toBe('Running evals · Insights Analyst');
    expect(task.progress).toEqual({ done: 1, total: 3 });
    expect(task.detail).toBe('1 of 3 questions');

    // The page goes away; the run and its polling go on.
    first.destroy();
    tick(1500);
    http
      .expectOne(pollUrl)
      .flush(
        poll('completed', [
          result('a', true),
          result('b', false),
          result('c', true),
        ]),
      );

    // Terminal status: no further poll and no timer left.
    tick(10_000);
    http.expectNone(pollUrl);
    const ended = tasks.latest('eval-run', key)!;
    expect(ended.status).toBe('done');
    expect(ended.detail).toBe('Evals for Insights Analyst: 2 of 3 passed');
  }));

  it('shows the live run and then its results when the page is opened again', fakeAsync(() => {
    const first = open();
    startRun(first);
    tick(1500);
    http.expectOne(pollUrl).flush(poll('running', [result('a', true)]));
    first.destroy();

    const second = open();
    expect(second.componentInstance.runStatus()).toBe('running');
    expect(second.componentInstance.running()).toBeTrue();
    expect(second.componentInstance.runResults().length).toBe(1);

    tick(1500);
    http
      .expectOne(pollUrl)
      .flush(poll('completed', [result('a', true), result('b', true)]));
    expect(second.componentInstance.runStatus()).toBe('completed');
    expect(second.componentInstance.runResults().length).toBe(2);

    // Opened after the end: the results are still there.
    second.destroy();
    const third = open();
    expect(third.componentInstance.runStatus()).toBe('completed');
    expect(third.componentInstance.passedCount()).toBe(2);
    third.destroy();
  }));

  it('ends as failed on a job error and shows the error', fakeAsync(() => {
    const fixture = open();
    startRun(fixture);
    tick(1500);
    http
      .expectOne(pollUrl)
      .flush(poll('failed', [], { error: 'The model is not reachable' }));

    expect(fixture.componentInstance.runStatus()).toBe('failed');
    expect(fixture.componentInstance.runError()).toBe(
      'The model is not reachable',
    );
    expect(tasks.latest('eval-run', key)!.status).toBe('failed');
    fixture.destroy();
  }));

  it('shows a refused start as the run error', fakeAsync(() => {
    const fixture = open();
    const page = fixture.componentInstance;
    page.selectedDatasourceId.set('ds-1');
    page.selectedCaseIds.set(new Set(['a']));
    page.startRun();
    http.expectOne(startUrl).flush({ ok: false, message: 'No datasets' });

    expect(page.runStarting()).toBeFalse();
    expect(page.runStatus()).toBe('failed');
    expect(page.runError()).toBe('No datasets');
    fixture.destroy();
  }));

  it('opens the agent page on its Evals tab from the task', fakeAsync(() => {
    const first = open();
    startRun(first);
    tick(1500);
    http.expectOne(pollUrl).flush(poll('running', [result('a', true)]));
    first.destroy();

    const pageState = TestBed.inject(AgentPageState);
    tasks.open(tasks.active('eval-run', key)!.id);
    // The shell is not part of this test: the request is the contract.
    expect(pageState.requestedTab()).toBe('evals');

    const second = open();
    TestBed.tick();
    expect(second.componentInstance.activeTab()).toBe('evals');
    expect(pageState.requestedTab()).toBeNull();

    tick(1500);
    http.expectOne(pollUrl).flush(poll('completed', [result('a', true)]));
    second.destroy();
  }));
});
