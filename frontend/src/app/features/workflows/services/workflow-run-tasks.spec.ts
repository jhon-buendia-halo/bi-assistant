import { TestBed, fakeAsync, tick } from '@angular/core/testing';
import { EMPTY, of, throwError } from 'rxjs';
import { BackgroundTasksService } from '../../../core/background-tasks/background-tasks.service';
import { ToastService } from '../../../core/toast/toast.service';
import { RunsState } from '../../runs/services/runs-state';
import { WorkflowDetail, WorkflowRun } from '../models/workflow.model';
import { WorkflowRunsApiService } from './workflow-runs-api.service';
import { WorkflowsApiService } from './workflows-api.service';
import {
  RUN_TASK_POLL_MS,
  WorkflowRunTasks,
  runTaskDetail,
  runTaskTeam,
  runTaskTitle,
} from './workflow-run-tasks';

function run(overrides: Partial<WorkflowRun> = {}): WorkflowRun {
  return {
    id: 'run-1',
    workflowId: 'answer-business-question',
    workflowName: 'Answer a Business Question',
    input: { question: 'Most goals?' },
    status: 'running',
    steps: [],
    datasets: [],
    startedAt: '2026-11-15T10:00:00.000Z',
    ...overrides,
  };
}

describe('WorkflowRunTasks (ADR-0048; plan 1.26.5)', () => {
  let tasks: WorkflowRunTasks;
  let background: BackgroundTasksService;
  let api: {
    getRun: jasmine.Spy;
    stopRun: jasmine.Spy;
    list: jasmine.Spy;
  };
  let toast: { success: jasmine.Spy; error: jasmine.Spy };
  let runs: { openRun: jasmine.Spy };

  beforeEach(() => {
    api = {
      getRun: jasmine.createSpy('getRun'),
      stopRun: jasmine.createSpy('stopRun').and.returnValue(EMPTY),
      list: jasmine.createSpy('list'),
    };
    toast = {
      success: jasmine.createSpy('success'),
      error: jasmine.createSpy('error'),
    };
    runs = { openRun: jasmine.createSpy('openRun') };
    TestBed.configureTestingModule({
      providers: [
        { provide: WorkflowRunsApiService, useValue: api },
        // No catalogue in these tests: the rows keep their plain detail.
        {
          provide: WorkflowsApiService,
          useValue: { getWorkflow: () => throwError(() => new Error('none')) },
        },
        { provide: ToastService, useValue: toast },
        { provide: RunsState, useValue: runs },
      ],
    });
    tasks = TestBed.inject(WorkflowRunTasks);
    background = TestBed.inject(BackgroundTasksService);
  });

  it('titles a task `<workflow>: <run title>`, cut at 80 characters', () => {
    expect(runTaskTitle('Answer a Business Question', '  Most   goals? ')).toBe(
      'Answer a Business Question: Most goals?',
    );
    expect(runTaskTitle('W', 'x'.repeat(100))).toBe(`W: ${'x'.repeat(79)}…`);
    expect(runTaskTitle('W', '')).toBe('W');
  });

  it('says "Waiting for you" for a waiting run, else its running step', () => {
    expect(runTaskDetail(run({ status: 'suspended' }))).toBe('Waiting for you');
    expect(
      runTaskDetail(
        run({
          steps: [
            { id: 'plan', title: 'Plan', status: 'success' },
            { id: 'analyse', title: 'Analyse', status: 'running' },
          ],
        }),
      ),
    ).toBe('Analyse');
    expect(runTaskDetail(run())).toBeNull();
  });

  it('says "Waiting for a free slot" for a queued run', () => {
    expect(runTaskDetail(run({ status: 'queued' }))).toBe(
      'Waiting for a free slot',
    );
  });

  it('reads the run every 3 s until it ends, waiting runs included, then toasts done with Open', fakeAsync(() => {
    api.getRun.and.returnValues(
      of(run()),
      of(run({ status: 'suspended' })),
      of(run({ status: 'success' })),
    );
    const task = tasks.track({
      id: 'run-1',
      workflowName: 'Answer a Business Question',
      title: 'Most goals?',
    });
    expect(task.kind).toBe('workflow-run');
    expect(task.key).toBe('run-1');
    expect(task.title).toBe('Answer a Business Question: Most goals?');
    // A run tracked twice keeps its one task.
    expect(tasks.track({ id: 'run-1', workflowName: 'X', title: 'Y' }).id).toBe(
      task.id,
    );
    tick(RUN_TASK_POLL_MS);
    expect(background.get(task.id)?.status).toBe('running');
    tick(RUN_TASK_POLL_MS);
    expect(background.get(task.id)?.detail).toBe('Waiting for you');
    expect(background.get(task.id)?.status).toBe('running');
    tick(RUN_TASK_POLL_MS);
    expect(background.get(task.id)?.status).toBe('done');
    expect(api.getRun).toHaveBeenCalledTimes(3);
    expect(toast.success).toHaveBeenCalledTimes(1);
    toast.success.calls.mostRecent().args[1].run();
    expect(runs.openRun).toHaveBeenCalledOnceWith('run-1');
    tick(RUN_TASK_POLL_MS * 3);
    expect(api.getRun).toHaveBeenCalledTimes(3);
  }));

  it('a failed run fails its task with the server error; the run the page shows is not toasted', fakeAsync(() => {
    tasks.watchShown(() => 'run-2');
    api.getRun.and.callFake((id: string) =>
      of(run({ id, status: 'failed', error: 'The provider failed' })),
    );
    const first = tasks.track({ id: 'run-1', workflowName: 'W', title: 'Q' });
    const shown = tasks.track({ id: 'run-2', workflowName: 'W', title: 'Q' });
    tick(RUN_TASK_POLL_MS);
    expect(background.get(first.id)?.status).toBe('failed');
    expect(background.get(first.id)?.detail).toBe('The provider failed');
    expect(background.get(shown.id)?.status).toBe('failed');
    expect(toast.error).toHaveBeenCalledTimes(1);
  }));

  it('Stop on the task stops the run (150); a stop from the page cancels the task without a second request', fakeAsync(() => {
    api.getRun.and.returnValue(of(run()));
    const panel = tasks.track({ id: 'run-1', workflowName: 'W', title: 'Q' });
    background.cancel(panel.id);
    expect(api.stopRun).toHaveBeenCalledOnceWith('run-1');
    expect(background.get(panel.id)?.status).toBe('stopped');

    api.stopRun.calls.reset();
    const page = tasks.track({ id: 'run-2', workflowName: 'W', title: 'Q' });
    tasks.stop('run-2').subscribe();
    expect(api.stopRun).toHaveBeenCalledOnceWith('run-2');
    expect(background.get(page.id)?.status).toBe('stopped');
    expect(toast.success).not.toHaveBeenCalled();
    expect(toast.error).not.toHaveBeenCalled();
    tick(RUN_TASK_POLL_MS * 2);
    expect(api.getRun).not.toHaveBeenCalled();
  }));

  it('a run whose end the page showed is not toasted, even once the page shows another run', fakeAsync(() => {
    api.getRun.and.returnValue(of(run({ status: 'success' })));
    tasks.track({ id: 'run-1', workflowName: 'W', title: 'Q' });
    tasks.markSeen('run-1');
    // A follow-up is shown now.
    tasks.watchShown(() => 'run-2');
    tick(RUN_TASK_POLL_MS);
    expect(toast.success).not.toHaveBeenCalled();
    // Without a task, nothing is remembered.
    tasks.markSeen('old');
    tasks.track({ id: 'old', workflowName: 'W', title: 'Q' });
    tick(RUN_TASK_POLL_MS);
    expect(toast.success).toHaveBeenCalledTimes(1);
  }));

  it('a run stopped elsewhere ends its task without a toast', fakeAsync(() => {
    api.getRun.and.returnValue(of(run({ status: 'stopped' })));
    const task = tasks.track({ id: 'run-1', workflowName: 'W', title: 'Q' });
    tick(RUN_TASK_POLL_MS);
    expect(background.get(task.id)?.detail).toBe('Run stopped');
    expect(toast.error).not.toHaveBeenCalled();
  }));

  it('at start-up tracks the runs still running or waiting (api.md 120)', fakeAsync(() => {
    api.list.and.returnValue(
      of({
        runs: [
          {
            id: 'a',
            workflowId: 'w',
            workflowName: 'W',
            status: 'running',
            title: 'A',
            startedAt: 't',
          },
          {
            id: 'b',
            workflowId: 'w',
            workflowName: 'W',
            status: 'suspended',
            title: 'B',
            startedAt: 't',
          },
          {
            id: 'c',
            workflowId: 'w',
            workflowName: 'W',
            status: 'success',
            title: 'C',
            startedAt: 't',
          },
        ],
      }),
    );
    api.getRun.and.callFake((id: string) => of(run({ id, status: 'success' })));
    tasks.trackActive();
    expect(background.running().map((t) => [t.key, t.title])).toEqual([
      ['b', 'W: B'],
      ['a', 'W: A'],
    ]);
    tick(RUN_TASK_POLL_MS);
    expect(background.runningCount()).toBe(0);
  }));

  it('tracks a queued run at start-up and polls it until it ends', fakeAsync(() => {
    api.list.and.returnValue(
      of({
        runs: [
          {
            id: 'q',
            workflowId: 'w',
            workflowName: 'W',
            status: 'queued',
            title: 'Q',
            startedAt: 't',
          },
        ],
      }),
    );
    api.getRun.and.returnValues(
      of(run({ id: 'q', status: 'queued' })),
      of(run({ id: 'q', status: 'success' })),
    );
    tasks.trackActive();
    expect(background.running().map((t) => t.key)).toEqual(['q']);
    tick(RUN_TASK_POLL_MS);
    expect(background.runningCount()).toBe(1);
    tick(RUN_TASK_POLL_MS);
    expect(background.runningCount()).toBe(0);
  }));
});

describe('runTaskTeam (ui.md 3.7)', () => {
  const workflow = {
    id: 'answer-business-question',
    steps: [
      { id: 'load-catalog', title: 'Load catalog', kind: 'code', output: [] },
      {
        id: 'plan',
        title: 'Plan',
        kind: 'agent',
        output: ['plan'],
        agent: {
          key: 'analysis-planner',
          name: 'Olivia',
          role: 'Analysis Lead',
        },
      },
      {
        id: 'analyse',
        title: 'Analyse',
        kind: 'agent',
        output: ['answer'],
        agent: {
          key: 'insights-analyst',
          name: 'Michael',
          role: 'Insights Analyst',
        },
      },
      {
        id: 'write-answer',
        title: 'Write answer',
        kind: 'agent',
        output: ['answer'],
        agent: {
          key: 'answer-writer',
          name: 'Jessica',
          role: 'Insights Writer',
        },
      },
    ],
  } as unknown as WorkflowDetail;

  const run = {
    id: 'r1',
    workflowId: 'answer-business-question',
    workflowName: 'Answer a Business Question',
    status: 'running',
    steps: [
      { id: 'load-catalog', title: 'Load catalog', status: 'success' },
      { id: 'plan', title: 'Plan', status: 'success' },
      {
        id: 'analyse',
        title: 'Analyse',
        status: 'running',
        toolCalls: [{ tool: 'run_readonly_sql' }],
      },
    ],
  } as unknown as WorkflowRun;

  it("shows the run's agents, who works now and how far it is", () => {
    expect(runTaskTeam(run, workflow)).toEqual({
      detail: 'Michael is running query 1 · step 3 of 4',
      progress: { done: 2, total: 4 },
      people: [
        { key: 'analysis-planner', name: 'Olivia', state: 'done' },
        { key: 'insights-analyst', name: 'Michael', state: 'active' },
        { key: 'answer-writer', name: 'Jessica', state: 'waiting' },
      ],
    });
  });

  it('marks no one active while the stored run has no steps yet', () => {
    const early = { ...run, steps: [] } as unknown as WorkflowRun;
    const team = runTaskTeam(early, workflow);
    expect(team.progress).toBeNull();
    expect(team.people?.map((p) => p.state)).toEqual([
      'unknown',
      'unknown',
      'unknown',
    ]);
  });

  it('keeps the plain detail while the catalogue is unknown', () => {
    expect(runTaskTeam(run, null)).toEqual({
      detail: 'Analyse',
      progress: null,
      people: null,
    });
  });
});
