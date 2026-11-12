import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { ShellState } from '../../../core/shell/shell-state';
import { WorkflowRun } from '../../workflows/models/workflow.model';
import { WorkflowDesigner } from '../../workflows/services/workflow-designer.service';
import { RunsState } from './runs-state';

const RUN: WorkflowRun = {
  id: 'r1',
  workflowId: 'agent:assistant',
  workflowName: 'Assistant',
  input: { question: 'Most goals?', datasets: ['World Cup Core'] },
  status: 'success',
  steps: [],
  datasets: ['World Cup Core'],
  startedAt: '2026-01-01T00:00:00Z',
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

  it('loads the run history', () => {
    state.loadRuns();
    http.expectOne((r) => r.url.endsWith('/workflow-runs')).flush({
      runs: [
        {
          id: 'r1',
          workflowId: 'agent:assistant',
          workflowName: 'Assistant',
          status: 'success',
          title: 'Most goals?',
          startedAt: '2026-01-01T00:00:00Z',
        },
      ],
    });
    expect(state.runsLoaded()).toBeTrue();
    expect(state.runs().map((r) => r.title)).toEqual(['Most goals?']);
  });

  it('opens a stored run at run-detail', () => {
    state.openRun('r1');
    expect(shell.mainView()).toBe('run-detail');
    expect(shell.currentArea()).toBe('runs');
    http.expectOne((r) => r.url.endsWith('/workflow-runs/r1')).flush(RUN);
    expect(state.activeRun()?.id).toBe('r1');
    expect(state.loadingRun()).toBeFalse();
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
  });

  it('Run again opens the workflow with the run input as the form values', () => {
    state.runAgain(RUN);
    expect(shell.mainView()).toBe('workflow-detail');
    const designer = TestBed.inject(WorkflowDesigner);
    designer.load('agent:assistant');
    http.expectOne((r) => r.url.endsWith('/workflows/agent%3Aassistant')).flush({
      id: 'agent:assistant',
      name: 'Assistant',
      description: '',
      kind: 'agent',
      trigger: 'run',
      input: [
        { name: 'question', label: 'Question', type: 'textarea', required: true },
        { name: 'datasets', label: 'Datasets', type: 'datasets', required: true },
      ],
      steps: [],
      missingDatasets: [],
    });
    http.expectOne((r) => r.url.endsWith('/datasets')).flush({ datasets: [] });
    // The right panel (Run) focuses its form.
    expect(designer.runFormRequest()).toBe(1);
    expect(designer.inputValue('question')).toBe('Most goals?');
  });
});
