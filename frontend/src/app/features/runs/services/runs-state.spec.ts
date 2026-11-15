import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { ShellState } from '../../../core/shell/shell-state';
import { WorkflowRun } from '../../workflows/models/workflow.model';
import { WorkflowDesigner } from '../../workflows/services/workflow-designer.service';
import { WorkflowsNavState } from '../../workflows/services/workflows-nav-state';
import { RunsState } from './runs-state';

const RUN: WorkflowRun = {
  id: 'r1',
  workflowId: 'answer-business-question',
  workflowName: 'Insights Analyst',
  input: { question: 'Most goals?', datasets: ['World Cup Core'] },
  status: 'success',
  steps: [],
  datasets: ['World Cup Core'],
  startedAt: '2026-01-01T00:00:00Z',
};

/** A run stored by a workflow that is no longer in the catalogue. */
const OLD_RUN: WorkflowRun = {
  ...RUN,
  id: 'r0',
  workflowId: 'agent:assistant',
  workflowName: 'Assistant',
};

const V2_DETAIL = {
  id: 'answer-business-question',
  name: 'Insights Analyst',
  description: '',
  kind: 'code',
  owner: 'Official',
  trigger: 'run',
  input: [
    { name: 'question', label: 'Question', type: 'textarea', required: true },
    { name: 'datasets', label: 'Datasets', type: 'datasets', required: true },
  ],
  steps: [],
  missingDatasets: [],
};

describe('RunsState (plan 1.24.11)', () => {
  let state: RunsState;
  let http: HttpTestingController;
  let shell: ShellState;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    state = TestBed.inject(RunsState);
    http = TestBed.inject(HttpTestingController);
    shell = TestBed.inject(ShellState);
  });

  afterEach(() => http.verify());

  it('loads the run history, runs of removed workflows included', () => {
    state.loadRuns();
    http.expectOne((r) => r.url.endsWith('/workflow-runs')).flush({
      runs: [
        {
          id: 'r1',
          workflowId: 'answer-business-question',
          workflowName: 'Insights Analyst',
          status: 'success',
          title: 'Most goals?',
          startedAt: '2026-01-01T00:00:00Z',
        },
        {
          id: 'r0',
          workflowId: 'agent:assistant',
          workflowName: 'Assistant',
          status: 'success',
          title: 'Older question',
          startedAt: '2025-12-01T00:00:00Z',
        },
      ],
    });
    expect(state.runsLoaded()).toBeTrue();
    expect(state.runs().map((r) => r.title)).toEqual(['Most goals?', 'Older question']);
  });

  it('opens an ended run on its workflow page, drawn with that run and holding its input', () => {
    state.openRun('r1');
    expect(shell.mainView()).toBe('run-detail');
    expect(shell.currentArea()).toBe('runs');
    expect(state.loadingRun()).toBeTrue();
    http.expectOne((r) => r.url.endsWith('/workflow-runs/r1')).flush(RUN);
    expect(shell.mainView()).toBe('run-detail');
    http.expectOne((r) => r.url.endsWith('/workflows/answer-business-question')).flush(V2_DETAIL);
    expect(shell.mainView()).toBe('workflow-detail');
    expect(TestBed.inject(WorkflowsNavState).activeWorkflowId()).toBe('answer-business-question');
    expect(state.loadingRun()).toBeFalse();
    expect(state.activeRun()).toBeNull();

    // The workflow page loads it: the run is shown, its input in the form.
    const designer = TestBed.inject(WorkflowDesigner);
    designer.load('answer-business-question');
    http.expectOne((r) => r.url.endsWith('/workflows/answer-business-question')).flush(V2_DETAIL);
    http.expectOne((r) => r.url.endsWith('/datasets')).flush({ datasets: [] });
    expect(designer.runResult()?.runId).toBe('r1');
    expect(designer.inputValue('question')).toBe('Most goals?');
    expect(designer.inputValues()['datasets']).toEqual(['World Cup Core']);
    expect(designer.runFormRequest()).toBe(0);
  });

  it('opens a run of a removed workflow read-only (R23)', () => {
    state.openRun('r0');
    http.expectOne((r) => r.url.endsWith('/workflow-runs/r0')).flush(OLD_RUN);
    expect(state.activeRun()).toBeNull();
    http
      .expectOne((r) => r.url.endsWith('/workflows/agent%3Aassistant'))
      .flush(
        { message: 'Workflow "agent:assistant" not found' },
        { status: 404, statusText: 'Not Found' },
      );
    expect(shell.mainView()).toBe('run-detail');
    expect(state.activeRun()?.id).toBe('r0');
    expect(state.loadingRun()).toBeFalse();
    expect(state.runError()).toBeNull();
  });

  it('opens a run still running read-only, without asking for its workflow', () => {
    state.openRun('r1');
    http
      .expectOne((r) => r.url.endsWith('/workflow-runs/r1'))
      .flush({ ...RUN, status: 'running' });
    expect(shell.mainView()).toBe('run-detail');
    expect(state.activeRun()?.status).toBe('running');
    expect(state.loadingRun()).toBeFalse();
  });

  it('a newer open or another view wins over a run still being opened', () => {
    state.openRun('r1');
    http.expectOne((r) => r.url.endsWith('/workflow-runs/r1')).flush(RUN);
    const first = http.expectOne((r) => r.url.endsWith('/workflows/answer-business-question'));
    state.openRun('r0');
    first.flush(V2_DETAIL);
    expect(shell.mainView()).toBe('run-detail');
    http.expectOne((r) => r.url.endsWith('/workflow-runs/r0')).flush(OLD_RUN);
    http
      .expectOne((r) => r.url.endsWith('/workflows/agent%3Aassistant'))
      .flush({ message: 'not found' }, { status: 404, statusText: 'Not Found' });
    expect(state.activeRun()?.id).toBe('r0');

    state.openRun('r1');
    http.expectOne((r) => r.url.endsWith('/workflow-runs/r1')).flush(RUN);
    const late = http.expectOne((r) => r.url.endsWith('/workflows/answer-business-question'));
    shell.mainView.set('runs');
    late.flush(V2_DETAIL);
    expect(shell.mainView()).toBe('runs');
  });

  it('shows a missing run as an error', () => {
    state.openRun('nope');
    http
      .expectOne((r) => r.url.endsWith('/workflow-runs/nope'))
      .flush(
        { message: 'Run "nope" not found' },
        { status: 404, statusText: 'Not Found' },
      );
    expect(state.runError()).toBe('Run "nope" not found');
    expect(state.loadingRun()).toBeFalse();
    expect(shell.mainView()).toBe('run-detail');
  });
});
