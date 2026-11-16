import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed, fakeAsync, tick } from '@angular/core/testing';
import { EMPTY, Subject, of, throwError } from 'rxjs';
import {
  WorkflowDetail,
  WorkflowRun,
  WorkflowRunRequest,
} from '../models/workflow.model';
import { WorkflowDesigner } from './workflow-designer.service';
import { GRAPH_RETRY_RUN, GRAPH_WORKFLOW } from './workflow-graph.testing';
import {
  RunStreamHandlers,
  WorkflowRunsApiService,
} from './workflow-runs-api.service';
import { WorkflowRunTasks } from './workflow-run-tasks';

/** The runs' background tasks (ADR-0048): what the designer asks of them. */
class FakeRunTasks {
  track = jasmine.createSpy('track');
  stop = jasmine.createSpy('stop').and.returnValue(EMPTY);
  watchShown = jasmine.createSpy('watchShown');
  markSeen = jasmine.createSpy('markSeen');
}

/** A run stream the test drives: each call is recorded with its handlers. */
class FakeRunsApi {
  tasks = new FakeRunTasks();

  /** The runs followed again (api.md 149), with their handlers. */
  attaches: {
    runId: string;
    handlers: RunStreamHandlers;
    signal?: AbortSignal;
    end: () => void;
  }[] = [];

  attachRun(
    runId: string,
    handlers: RunStreamHandlers,
    signal?: AbortSignal,
  ): Promise<void> {
    return new Promise<void>((end) => {
      this.attaches.push({ runId, handlers, signal, end });
    });
  }

  calls: {
    workflowId: string;
    body: WorkflowRunRequest;
    handlers: RunStreamHandlers;
    signal?: AbortSignal;
    end: () => void;
  }[] = [];
  getRun = jasmine.createSpy('getRun');
  rateAnswer = jasmine.createSpy('rateAnswer');
  prepareEvidence = jasmine.createSpy('prepareEvidence').and.returnValue(EMPTY);

  streamRun(
    workflowId: string,
    body: WorkflowRunRequest,
    handlers: RunStreamHandlers,
    signal?: AbortSignal,
  ): Promise<void> {
    return new Promise<void>((end) => {
      this.calls.push({ workflowId, body, handlers, signal, end });
    });
  }

  resumes: {
    runId: string;
    stepId: string;
    answer: string;
    handlers: RunStreamHandlers;
    end: () => void;
  }[] = [];

  resumeRun(
    runId: string,
    stepId: string,
    answer: string,
    handlers: RunStreamHandlers,
  ): Promise<void> {
    return new Promise<void>((end) => {
      this.resumes.push({ runId, stepId, answer, handlers, end });
    });
  }

  get last() {
    return this.calls[this.calls.length - 1];
  }
}

/** A one-agent-step code workflow over picked datasets, with a checkbox. */
const ASSISTANT: WorkflowDetail = {
  id: 'answer-business-question',
  name: 'Insights Analyst',
  description: 'Answers questions over the datasets you pick.',
  kind: 'code',
  owner: 'Official',
  agents: [{ key: 'insights-analyst', name: 'Insights Analyst' }],
  stepCount: 1,
  trigger: 'run',
  input: [
    { name: 'question', label: 'Question', type: 'textarea', required: true },
    { name: 'datasets', label: 'Datasets', type: 'datasets', required: true },
    {
      name: 'verbose',
      label: 'Verbose',
      type: 'boolean',
      required: false,
      default: false,
    },
  ],
  datasets: [],
  missingDatasets: [],
  starterQuestions: [],
  steps: [
    {
      id: 'answer',
      title: 'Answer',
      kind: 'agent',
      summary: 'The agent answers.',
      agent: {
        key: 'insights-analyst',
        name: 'Insights Analyst',
        tools: ['list_entities', 'run_readonly_sql'],
        maxSteps: 8,
      },
      input: ['question', 'datasets'],
      output: ['calls', 'stopped'],
      exits: [],
    },
  ],
};

function storedRun(overrides: Partial<WorkflowRun> = {}): WorkflowRun {
  return {
    id: 'run-1',
    workflowId: 'answer-business-question',
    workflowName: 'Insights Analyst',
    input: {
      question: 'Which team scored the most goals?',
      datasets: ['World Cup Core'],
      verbose: false,
    },
    status: 'success',
    steps: [
      {
        id: 'answer',
        title: 'Answer',
        status: 'success',
        output: { stopped: false },
      },
    ],
    question: 'Which team scored the most goals?',
    answer: {
      role: 'assistant',
      content: 'Brazil scored the most.',
      at: '2026-11-11T10:00:01.000Z',
    },
    datasets: ['World Cup Core'],
    startedAt: '2026-11-11T10:00:00.000Z',
    ...overrides,
  };
}

describe('WorkflowDesigner, a streamed run (workflows R21; api.md 3.6)', () => {
  let designer: WorkflowDesigner;
  let runs: FakeRunsApi;
  let http: HttpTestingController;

  beforeEach(() => {
    runs = new FakeRunsApi();
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: WorkflowRunsApiService, useValue: runs },
        { provide: WorkflowRunTasks, useValue: runs.tasks },
      ],
    });
    designer = TestBed.inject(WorkflowDesigner);
    http = TestBed.inject(HttpTestingController);
    designer.load(ASSISTANT.id);
    http
      .expectOne((r) => r.url.endsWith('/workflows/answer-business-question'))
      .flush(ASSISTANT);
    http
      // The light listing (api.md 21): the run form's picker needs no snapshots.
      .expectOne(
        (r) => r.url.endsWith('/datasets') && r.params.get('view') === 'summary',
      )
      .flush({
        datasets: [
          {
            name: 'World Cup Core',
            tables: ['a', 'b'],
            datasourceKind: 'postgres',
          },
        ],
      });
  });

  afterEach(() => http.verify());

  function executeQuestion(): void {
    designer.setInput('question', 'Which team scored the most goals?');
    designer.toggleDataset('datasets', 'World Cup Core');
    designer.execute();
  }

  it('shows a run opened from Runs with its input in the form, without asking for the form (R19)', () => {
    designer.showRunOnLoad(
      storedRun({
        input: {
          question: 'Which team scored the most goals?',
          datasets: ['World Cup Core'],
          verbose: true,
        },
      }),
    );
    designer.load(ASSISTANT.id);
    http
      .expectOne((r) => r.url.endsWith('/workflows/answer-business-question'))
      .flush(ASSISTANT);
    http.expectOne((r) => r.url.endsWith('/datasets')).flush({ datasets: [] });
    expect(designer.runResult()?.runId).toBe('run-1');
    expect(designer.runFormRequest()).toBe(0);
    expect(designer.inputValue('question')).toBe(
      'Which team scored the most goals?',
    );
    expect(designer.picked('datasets')).toEqual(['World Cup Core']);
    expect(designer.checked('verbose')).toBeTrue();
    // A second open starts from the defaults again, with no run.
    designer.load(ASSISTANT.id);
    http
      .expectOne((r) => r.url.endsWith('/workflows/answer-business-question'))
      .flush(ASSISTANT);
    http.expectOne((r) => r.url.endsWith('/datasets')).flush({ datasets: [] });
    expect(designer.runResult()).toBeNull();
    expect(designer.inputValues()).toEqual({ verbose: false });
  });

  describe("the home's Ask (app-shell R51)", () => {
    const datasets = {
      datasets: [
        { name: 'World Cup Core', tables: ['a'], datasourceKind: 'postgres' },
      ],
    };

    function open(): void {
      designer.load(ASSISTANT.id);
      http
        .expectOne((r) => r.url.endsWith('/workflows/answer-business-question'))
        .flush(ASSISTANT);
    }

    it('runs on the held values once the datasets have loaded', () => {
      designer.prefillOnLoad(
        { question: 'Goals by team?', datasets: ['World Cup Core'] },
        { execute: true },
      );
      open();
      expect(runs.calls.length).toBe(0);
      http.expectOne((r) => r.url.endsWith('/datasets')).flush(datasets);
      expect(runs.calls.length).toBe(1);
      expect(runs.last.workflowId).toBe(ASSISTANT.id);
      expect(runs.last.body.input).toEqual(
        jasmine.objectContaining({
          question: 'Goals by team?',
          datasets: ['World Cup Core'],
        }),
      );
      expect(designer.running()).toBeTrue();
    });

    it('only fills the form without execute, and runs once at most', () => {
      designer.prefillOnLoad({ question: 'Goals by team?' });
      open();
      http.expectOne((r) => r.url.endsWith('/datasets')).flush(datasets);
      expect(runs.calls.length).toBe(0);
      expect(designer.inputValue('question')).toBe('Goals by team?');
      // A later open does not run either.
      open();
      http.expectOne((r) => r.url.endsWith('/datasets')).flush(datasets);
      expect(runs.calls.length).toBe(0);
    });

    it('does not run when the page shows a stored run', () => {
      designer.showRunOnLoad(storedRun());
      designer.prefillOnLoad({ question: 'Goals by team?' }, { execute: true });
      open();
      http.expectOne((r) => r.url.endsWith('/datasets')).flush(datasets);
      expect(runs.calls.length).toBe(0);
      expect(designer.runResult()?.runId).toBe('run-1');
    });
  });

  it('Run again drops the run shown and opens the form with its whole input (R19)', () => {
    expect(designer.canRunAgain()).toBeFalse();
    designer.showRunOnLoad(
      storedRun({
        input: {
          question: 'Goals by team?',
          datasets: ['World Cup Core'],
          verbose: true,
        },
      }),
    );
    designer.load(ASSISTANT.id);
    http
      .expectOne((r) => r.url.endsWith('/workflows/answer-business-question'))
      .flush(ASSISTANT);
    http.expectOne((r) => r.url.endsWith('/datasets')).flush({ datasets: [] });
    // Its fields were changed meanwhile: Run again restores the run's input.
    designer.setInput('question', 'Something else');
    designer.toggleDataset('datasets', 'World Cup Core');
    expect(designer.canRunAgain()).toBeTrue();
    designer.runAgain();
    expect(designer.runResult()).toBeNull();
    expect(designer.run()).toBeNull();
    expect(designer.canRunAgain()).toBeFalse();
    expect(designer.inputValue('question')).toBe('Goals by team?');
    expect(designer.picked('datasets')).toEqual(['World Cup Core']);
    expect(designer.checked('verbose')).toBeTrue();
    expect(designer.runFormRequest()).toBe(1);
  });

  it("Run again after a run started here uses that run's input; never while a run is going", () => {
    executeQuestion();
    expect(designer.canRunAgain()).toBeFalse();
    designer.runAgain();
    expect(designer.running()).toBeTrue();
    expect(designer.runFormRequest()).toBe(0);
    runs.last.handlers.onDone!(storedRun());
    designer.setInput('question', 'Changed');
    designer.runAgain();
    expect(designer.inputValue('question')).toBe(
      'Which team scored the most goals?',
    );
    expect(designer.picked('datasets')).toEqual(['World Cup Core']);
    expect(designer.runFormRequest()).toBe(1);
  });

  it('starts the form from the defaults and loads the datasets to pick from', () => {
    expect(designer.inputValues()).toEqual({ verbose: false });
    expect(designer.datasets().map((d) => d.name)).toEqual(['World Cup Core']);
  });

  it('selects any node, opens and closes its dialog, and keeps Start, steps and End as nodes', () => {
    expect(designer.nodes().map((n) => n.nodeId)).toEqual([
      'start',
      'answer',
      'end',
    ]);
    expect(designer.openInspection()).toBeNull();
    designer.select('start');
    expect(designer.selectedStepId()).toBe('start');
    expect(designer.openNodeId()).toBeNull();
    designer.openNode('answer');
    expect(designer.selectedStepId()).toBe('answer');
    expect(designer.openInspection()?.title).toBe('Answer');
    designer.closeNode();
    expect(designer.openInspection()).toBeNull();
    expect(designer.selectedStepId()).toBe('answer');
    designer.openNode('end');
    designer.clear();
    expect(designer.openNodeId()).toBeNull();
    expect(designer.selectedStepId()).toBeNull();
  });

  it('opens a tool sub-node as that tool, with its calls in the run shown; its agent step stays selected', () => {
    designer.openNode('answer-tool-run_readonly_sql');
    expect(designer.openNodeId()).toBe('answer-tool-run_readonly_sql');
    expect(designer.selectedStepId()).toBe('answer');
    const tool = designer.openInspection()!;
    expect(tool.kind).toBe('tool');
    expect(tool.title).toBe('run_readonly_sql');
    expect(tool.tool?.calls).toEqual([]);
    // Tools are not nodes of the state panel.
    expect(designer.nodes().map((n) => n.nodeId)).toEqual([
      'start',
      'answer',
      'end',
    ]);

    executeQuestion();
    runs.last.handlers.onStep!({
      id: 'answer',
      title: 'Answer',
      status: 'success',
      toolCalls: [
        { tool: 'list_entities', durationMs: 3 },
        {
          tool: 'run_readonly_sql',
          input: 'SELECT 1',
          rowCount: 1,
          durationMs: 40,
        },
      ],
    });
    expect(designer.openInspection()?.tool?.calls.map((c) => c.input)).toEqual([
      'SELECT 1',
    ]);
    designer.closeNode();
    // Model and "+n tools" open the step itself; an unknown tool opens nothing.
    designer.openNode('answer-tool-nope');
    expect(designer.openInspection()).toBeNull();
  });

  it('Execute workflow only asks for the run form: nothing runs', () => {
    designer.requestRunForm();
    designer.requestRunForm();
    expect(designer.runFormRequest()).toBe(2);
    expect(runs.calls.length).toBe(0);
    expect(designer.running()).toBe(false);
  });

  it('the state panel starts expanded and has no run before the first Execute', () => {
    expect(designer.stateOpen()).toBe(true);
    expect(designer.stateSummary()).toEqual({
      status: null,
      ran: 0,
      total: 3,
      durationMs: null,
      runId: null,
      invalidFields: 0,
    });
    expect(designer.nodeStatuses()).toEqual({});
  });

  it("fills each step's input, times and tool calls live, with the run's id, input and start", () => {
    executeQuestion();
    const h = runs.last.handlers;
    expect(designer.liveInput()).toEqual({
      question: 'Which team scored the most goals?',
      datasets: ['World Cup Core'],
      verbose: false,
    });
    h.onRun!({ runId: 'run-1', workflowId: 'answer-business-question' });
    h.onStep!({
      id: 'answer',
      title: 'Answer',
      status: 'success',
      input: { question: 'Which team scored the most goals?' },
      inputTruncated: true,
      output: { stopped: false },
      startedAt: '2026-11-11T10:00:00.000Z',
      endedAt: '2026-11-11T10:00:02.500Z',
      toolCalls: [
        {
          tool: 'run_readonly_sql',
          input: 'SELECT 1',
          rowCount: 1,
          durationMs: 40,
        },
      ],
    });
    const result = designer.runResult()!;
    expect(result.runId).toBe('run-1');
    expect(result.input).toEqual(designer.liveInput());
    expect(result.startedAt).toEqual(jasmine.any(String));
    expect(result.finishedAt).toBeUndefined();
    expect(result.steps[0]).toEqual(
      jasmine.objectContaining({
        input: { question: 'Which team scored the most goals?' },
        inputTruncated: true,
        startedAt: '2026-11-11T10:00:00.000Z',
        endedAt: '2026-11-11T10:00:02.500Z',
        toolCalls: [
          {
            tool: 'run_readonly_sql',
            input: 'SELECT 1',
            rowCount: 1,
            durationMs: 40,
          },
        ],
      }),
    );
    const answer = designer.nodes()[1];
    expect(answer.run?.durationMs).toBe(2500);
    expect(answer.run?.toolCalls.map((c) => c.tool)).toEqual([
      'run_readonly_sql',
    ]);
    expect(designer.nodes()[0].run?.input).toEqual(designer.liveInput()!);
    expect(designer.stateSummary()).toEqual(
      jasmine.objectContaining({
        status: 'running',
        ran: 2,
        total: 3,
        runId: 'run-1',
      }),
    );
  });

  it("shows a stored run's id, input and times, and its steps' recorded data", () => {
    executeQuestion();
    runs.last.handlers.onDone!(
      storedRun({
        finishedAt: '2026-11-11T10:00:13.900Z',
        steps: [
          {
            id: 'answer',
            title: 'Answer',
            status: 'success',
            input: { question: 'Which team scored the most goals?' },
            output: { stopped: false },
            startedAt: '2026-11-11T10:00:00.000Z',
            endedAt: '2026-11-11T10:00:13.900Z',
          },
        ],
      }),
    );
    const result = designer.runResult()!;
    expect(result.runId).toBe('run-1');
    expect(result.input).toEqual(storedRun().input);
    expect(result.startedAt).toBe('2026-11-11T10:00:00.000Z');
    expect(result.finishedAt).toBe('2026-11-11T10:00:13.900Z');
    expect(result.steps[0].input).toEqual({
      question: 'Which team scored the most goals?',
    });
    expect(designer.stateSummary()).toEqual({
      status: 'success',
      ran: 3,
      total: 3,
      durationMs: 13900,
      runId: 'run-1',
      invalidFields: 0,
    });
    expect(designer.nodeStatuses()).toEqual({
      start: 'success',
      answer: 'success',
      end: 'success',
    });
    designer.openNode('end');
    expect(designer.openInspection()?.run?.input).toEqual({ stopped: false });
  });

  it("sends the form's typed input to the workflow's stream", () => {
    executeQuestion();
    expect(runs.last.workflowId).toBe('answer-business-question');
    expect(runs.last.body).toEqual({
      input: {
        question: 'Which team scored the most goals?',
        datasets: ['World Cup Core'],
        verbose: false,
      },
    });
    expect(designer.running()).toBe(true);
  });

  it('shows the steps progress live, the tool calls and the answer forming, then the stored run', () => {
    executeQuestion();
    const h = runs.last.handlers;
    expect(designer.runResult()?.status).toBe('running');
    expect(designer.runResult()?.steps.map((s) => s.status)).toEqual([null]);

    h.onRun!({ runId: 'run-1', workflowId: 'answer-business-question' });
    h.onStep!({ id: 'answer', title: 'Answer', status: 'running' });
    expect(designer.nodeStatuses()).toEqual({
      start: 'success',
      answer: 'running',
    });
    h.onReasoning!('Looking at goals');
    h.onTool!({ name: 'run_readonly_sql', input: 'SELECT team FROM goals' });
    expect(designer.toolCalls()).toEqual([
      {
        name: 'run_readonly_sql',
        input: 'SELECT team FROM goals',
        finished: false,
      },
    ]);
    h.onToolResult!({ tool: 'run_readonly_sql', rowCount: 5 });
    expect(designer.toolCalls()[0]).toEqual(
      jasmine.objectContaining({ finished: true, rowCount: 5 }),
    );
    h.onText!('Brazil ');
    h.onText!('scored');
    expect(designer.streamingText()).toBe('Brazil scored');
    expect(designer.reasoning()).toBe('Looking at goals');

    h.onDone!(storedRun());
    expect(designer.running()).toBe(false);
    const result = designer.runResult()!;
    expect(result.status).toBe('success');
    expect(result.answer?.content).toBe('Brazil scored the most.');
    expect(result.steps).toEqual([
      {
        id: 'answer',
        title: 'Answer',
        kind: 'agent',
        status: 'success',
        output: { stopped: false },
      },
    ]);
    expect(designer.nodeStatuses()).toEqual({
      start: 'success',
      answer: 'success',
      end: 'success',
    });
    expect(designer.canFollowUp()).toBe(true);
  });

  it('rates the shown answer: a thumbs-up stores it on the run and says it was saved (1.23.19)', () => {
    executeQuestion();
    runs.last.handlers.onDone!(storedRun());
    const rated = {
      ...storedRun().answer!,
      feedback: 'up' as const,
      verified: true,
    };
    runs.rateAnswer.and.returnValue(
      of({
        ok: true,
        message: 'Answer saved as a verified query',
        run: storedRun({ answer: rated }),
      }),
    );

    designer.rateAnswer('up');

    expect(runs.rateAnswer).toHaveBeenCalledOnceWith('run-1', 'up');
    expect(designer.run()?.answer).toEqual(rated);
    expect(designer.ratingPending()).toBe(false);
    // The same rating again is a no-op.
    designer.rateAnswer('up');
    expect(runs.rateAnswer).toHaveBeenCalledTimes(1);
  });

  it('a refusal shows the message under Execute and no result', () => {
    executeQuestion();
    runs.last.handlers.onError!('Dataset "World Cup Core" not found');
    expect(designer.runError()).toBe('Dataset "World Cup Core" not found');
    expect(designer.runResult()).toBeNull();
    expect(designer.running()).toBe(false);
  });

  it('an invalid form is refused before any request: each field has its error, Start is invalid', () => {
    designer.setInput('question', '   ');
    const focus = designer.invalidFocusRequest();
    designer.execute();
    expect(runs.calls.length).toBe(0);
    expect(designer.running()).toBe(false);
    expect(designer.fieldErrors()).toEqual({
      question: 'Question is required',
      datasets: 'Select at least one dataset',
    });
    expect(designer.runError()).toBeNull();
    expect(designer.runResult()).toBeNull();
    expect(designer.nodeStatuses()).toEqual({ start: 'invalid' });
    expect(designer.stateSummary().invalidFields).toBe(2);
    expect(designer.invalidFocusRequest()).toBe(focus + 1);

    designer.setInput('question', 'Which team?');
    expect(designer.fieldErrors()).toEqual({
      datasets: 'Select at least one dataset',
    });
    expect(designer.stateSummary().invalidFields).toBe(1);
    designer.toggleDataset('datasets', 'World Cup Core');
    expect(designer.fieldErrors()).toEqual({});
    expect(designer.nodeStatuses()).toEqual({});

    designer.execute();
    expect(runs.calls.length).toBe(1);
  });

  it("maps a refusal's field errors onto the fields; a non-field error stays under Execute", () => {
    executeQuestion();
    runs.last.handlers.onError!('Question must be at most 4000 characters', [
      {
        field: 'question',
        message: 'Question must be at most 4000 characters',
      },
      { field: null, message: 'Run "old" not found' },
    ]);
    expect(designer.fieldErrors()).toEqual({
      question: 'Question must be at most 4000 characters',
    });
    expect(designer.runError()).toBe('Run "old" not found');
    expect(designer.nodeStatuses()).toEqual({ start: 'invalid' });
    expect(designer.runResult()).toBeNull();

    designer.execute();
    expect(runs.calls.length).toBe(2);
    runs.last.handlers.onError!('Question is required', [
      { field: 'question', message: 'Question is required' },
    ]);
    expect(designer.runError()).toBeNull();
  });

  it('an error after the run started fails the run with it, and the running step', () => {
    executeQuestion();
    const h = runs.last.handlers;
    h.onRun!({ runId: 'run-1', workflowId: 'answer-business-question' });
    h.onStep!({ id: 'answer', title: 'Answer', status: 'running' });
    h.onError!('The endpoint rejected the API key (401)');
    expect(designer.runError()).toBeNull();
    const result = designer.runResult()!;
    expect(result.status).toBe('failed');
    expect(result.error).toBe('The endpoint rejected the API key (401)');
    expect(designer.nodeStatuses()).toEqual({
      start: 'success',
      answer: 'failed',
      end: 'skipped',
    });
    expect(designer.runResult()?.finishedAt).toEqual(jasmine.any(String));
  });

  it('Stop asks the server to stop the run (api.md 150), drops the stream and shows the stored run with its partial answer', () => {
    executeQuestion();
    const h = runs.last.handlers;
    h.onRun!({ runId: 'run-1', workflowId: 'answer-business-question' });
    h.onStep!({ id: 'answer', title: 'Answer', status: 'running' });
    const stopped = new Subject<{
      ok: boolean;
      message: string;
      run: WorkflowRun;
    }>();
    runs.tasks.stop.and.returnValue(stopped);

    designer.stop();
    expect(runs.tasks.stop).toHaveBeenCalledOnceWith('run-1');
    expect(runs.last.signal?.aborted).toBe(true);
    expect(designer.running()).toBe(false);
    expect(designer.runResult()?.status).toBe('stopped');
    expect(designer.nodeStatuses()).toEqual({
      start: 'success',
      answer: 'stopped',
      end: 'stopped',
    });
    // Events of the dropped stream are ignored.
    h.onText!('late');
    expect(designer.streamingText()).toBe('');

    stopped.next({
      ok: true,
      message: 'Run stopped',
      run: storedRun({
        status: 'stopped',
        steps: [{ id: 'answer', title: 'Answer', status: 'stopped' }],
        answer: { role: 'assistant', content: 'Brazil', at: 'x' },
      }),
    });
    expect(designer.run()?.status).toBe('stopped');
    expect(designer.runResult()?.answer?.content).toBe('Brazil');
    expect(designer.canFollowUp()).toBe(false);
  });

  it('Stop reads the run back when the stop request fails', fakeAsync(() => {
    executeQuestion();
    runs.last.handlers.onRun!({
      runId: 'run-1',
      workflowId: 'answer-business-question',
    });
    runs.tasks.stop.and.returnValue(throwError(() => new Error('offline')));
    runs.getRun.and.returnValues(
      of(storedRun({ status: 'running', answer: undefined })),
      of(storedRun({ status: 'stopped', answer: undefined })),
    );
    designer.stop();
    tick(300);
    expect(runs.getRun).toHaveBeenCalledTimes(2);
    expect(designer.run()?.status).toBe('stopped');
  }));

  it('Stop before the run has its id stops it as soon as the run says it started', () => {
    executeQuestion();
    designer.stop();
    expect(designer.runResult()?.status).toBe('stopped');
    expect(designer.running()).toBe(false);
    // The stream stays until the run has an id, so it can be stopped.
    expect(runs.last.signal?.aborted).toBe(false);
    expect(runs.tasks.stop).not.toHaveBeenCalled();
    runs.last.handlers.onRun!({
      runId: 'run-1',
      workflowId: 'answer-business-question',
    });
    expect(runs.tasks.stop).toHaveBeenCalledOnceWith('run-1');
    expect(runs.last.signal?.aborted).toBe(true);
  });

  it('a run becomes a background task as soon as it has its id, titled by its question', () => {
    executeQuestion();
    expect(runs.tasks.track).not.toHaveBeenCalled();
    runs.last.handlers.onRun!({
      runId: 'run-1',
      workflowId: 'answer-business-question',
    });
    expect(runs.tasks.track).toHaveBeenCalledOnceWith({
      id: 'run-1',
      workflowName: 'Insights Analyst',
      title: 'Which team scored the most goals?',
    });
    // The page tells the tasks which run it shows (its end is not toasted).
    const shown = runs.tasks.watchShown.calls.mostRecent().args[0] as () =>
      string | null;
    expect(shown()).toBe('run-1');
  });

  it('Follow up runs on the same input with the new question and this run as its context', () => {
    executeQuestion();
    runs.last.handlers.onDone!(storedRun());
    designer.followUpText.set('And the fewest?');
    designer.followUp(designer.followUpText());
    expect(runs.calls.length).toBe(2);
    expect(runs.last.body).toEqual({
      input: {
        question: 'And the fewest?',
        datasets: ['World Cup Core'],
        verbose: false,
      },
      context: { fromRunId: 'run-1' },
    });
    expect(designer.inputValue('question')).toBe('And the fewest?');
    expect(designer.followUpText()).toBe('');
    expect(designer.contextRun()).toEqual({
      id: 'run-1',
      question: 'Which team scored the most goals?',
    });
    // The earlier answer gives way to the new run.
    expect(designer.run()).toBeNull();
    expect(designer.runResult()?.status).toBe('running');
  });

  it('Follow up sends the composer images: the kept paths and the new ones', () => {
    executeQuestion();
    runs.last.handlers.onDone!(
      storedRun({
        input: {
          question: 'Which team scored the most goals?',
          datasets: ['World Cup Core'],
          images: ['inputs/images/1.png', 'inputs/images/2.png'],
        },
      }),
    );
    designer.followUp('And the fewest?', [
      'inputs/images/2.png',
      'data:image/png;base64,AAAA',
    ]);
    expect(runs.last.body).toEqual({
      input: {
        question: 'And the fewest?',
        datasets: ['World Cup Core'],
        images: ['inputs/images/2.png', 'data:image/png;base64,AAAA'],
      },
      context: { fromRunId: 'run-1' },
    });
  });

  it('a clarification answer is a follow-up whose question is the picked option', () => {
    executeQuestion();
    runs.last.handlers.onDone!(
      storedRun({
        answer: {
          role: 'assistant',
          content: 'Which measure of best do you mean?',
          at: 'x',
          clarification: {
            question: 'Which measure of best do you mean?',
            options: [{ label: 'Most titles' }, { label: 'Highest win rate' }],
          },
        },
      }),
    );
    designer.followUp('Highest win rate');
    expect(runs.last.body).toEqual({
      input: {
        question: 'Highest win rate',
        datasets: ['World Cup Core'],
        verbose: false,
      },
      context: { fromRunId: 'run-1' },
    });
  });

  it('leaving the page drops the stream and the run shown but never stops the run (ADR-0048)', () => {
    executeQuestion();
    runs.last.handlers.onRun!({
      runId: 'run-1',
      workflowId: 'answer-business-question',
    });
    const signal = runs.last.signal!;
    designer.clear();
    expect(signal.aborted).toBe(true);
    expect(runs.tasks.stop).not.toHaveBeenCalled();
    expect(designer.runResult()).toBeNull();
    expect(designer.running()).toBe(false);
  });

  describe('coming back to a run that runs on the server (api.md 149)', () => {
    const RUNNING = storedRun({
      status: 'running',
      steps: [],
      answer: undefined,
    });

    /** Leave the page with run-1 running, then open the workflow again. */
    function leaveAndComeBack(): void {
      executeQuestion();
      runs.last.handlers.onRun!({
        runId: 'run-1',
        workflowId: 'answer-business-question',
      });
      runs.last.handlers.onText!('Bra');
      designer.clear();
      runs.getRun.and.returnValue(of(RUNNING));
      designer.load(ASSISTANT.id);
      http
        .expectOne((r) => r.url.endsWith('/workflows/answer-business-question'))
        .flush(ASSISTANT);
      http
        .expectOne((r) => r.url.endsWith('/datasets'))
        .flush({ datasets: [] });
    }

    it('opening its workflow again follows it from its first event and rebuilds the live view', () => {
      leaveAndComeBack();
      expect(runs.getRun).toHaveBeenCalledWith('run-1');
      expect(runs.attaches.length).toBe(1);
      expect(runs.attaches[0].runId).toBe('run-1');
      expect(designer.running()).toBe(true);
      expect(designer.runResult()?.runId).toBe('run-1');
      expect(designer.inputValue('question')).toBe(
        'Which team scored the most goals?',
      );
      // The replay: the run, its step, Thinking, a tool call, the answer forming.
      const h = runs.attaches[0].handlers;
      h.onRun!({ runId: 'run-1', workflowId: 'answer-business-question' });
      h.onStep!({ id: 'answer', title: 'Answer', status: 'running' });
      h.onReasoning!('Looking at goals');
      h.onTool!({ name: 'run_readonly_sql', input: 'SELECT 1' } as never);
      h.onText!('Bra');
      h.onText!('zil');
      expect(designer.nodeStatuses()['answer']).toBe('running');
      expect(designer.reasoning()).toBe('Looking at goals');
      expect(designer.toolCalls().map((call) => call.name)).toEqual([
        'run_readonly_sql',
      ]);
      expect(designer.streamingText()).toBe('Brazil');
      expect(runs.tasks.track).toHaveBeenCalledWith({
        id: 'run-1',
        workflowName: 'Insights Analyst',
        title: 'Which team scored the most goals?',
      });
      // It goes on live to its end.
      h.onDone!(storedRun());
      expect(designer.running()).toBe(false);
      expect(designer.run()?.status).toBe('success');
      // Its end showed here: its task does not toast it.
      expect(runs.tasks.markSeen).toHaveBeenCalledWith('run-1');
    });

    it('a run opened from Runs (or its task) while running is followed too', () => {
      designer.showRunOnLoad(RUNNING);
      designer.load(ASSISTANT.id);
      http
        .expectOne((r) => r.url.endsWith('/workflows/answer-business-question'))
        .flush(ASSISTANT);
      http
        .expectOne((r) => r.url.endsWith('/datasets'))
        .flush({ datasets: [] });
      expect(runs.attaches.map((a) => a.runId)).toEqual(['run-1']);
      expect(designer.runResult()?.status).toBe('running');
    });

    it('a run the server no longer holds is read back and shown as stored', fakeAsync(() => {
      leaveAndComeBack();
      const h = runs.attaches[0].handlers;
      runs.getRun.and.returnValue(of(storedRun()));
      h.onRefused!(404);
      h.onError!('Run "run-1" has no live events');
      expect(designer.run()?.status).toBe('success');
      expect(designer.runResult()?.answer?.content).toBe(
        'Brazil scored the most.',
      );
      tick(300);
    }));

    it('shows it only once: the next visit starts with no run', () => {
      leaveAndComeBack();
      runs.attaches[0].handlers.onDone!(storedRun());
      designer.clear();
      runs.getRun.calls.reset();
      designer.load(ASSISTANT.id);
      http
        .expectOne((r) => r.url.endsWith('/workflows/answer-business-question'))
        .flush(ASSISTANT);
      http
        .expectOne((r) => r.url.endsWith('/datasets'))
        .flush({ datasets: [] });
      expect(runs.getRun).not.toHaveBeenCalled();
      expect(designer.runResult()).toBeNull();
    });

    it('a stopped run is not followed again', () => {
      executeQuestion();
      runs.last.handlers.onRun!({
        runId: 'run-1',
        workflowId: 'answer-business-question',
      });
      designer.stop();
      designer.clear();
      designer.load(ASSISTANT.id);
      http
        .expectOne((r) => r.url.endsWith('/workflows/answer-business-question'))
        .flush(ASSISTANT);
      http
        .expectOne((r) => r.url.endsWith('/datasets'))
        .flush({ datasets: [] });
      expect(runs.attaches.length).toBe(0);
    });
  });

  it('an old stored run that still carries an rfpId is shown as a plain run', () => {
    executeQuestion();
    runs.last.handlers.onRun!({
      runId: 'run-1',
      workflowId: 'answer-business-question',
    });
    runs.last.handlers.onDone!({
      ...storedRun(),
      rfpId: 'rfp-1',
    } as WorkflowRun);
    expect(designer.run()?.answer?.content).toBe('Brazil scored the most.');
    expect(designer.canFollowUp()).toBe(true);
  });

  it("offers a step's chat only once the run shown ended and is stored", () => {
    expect(designer.nodeChat()).toEqual({ state: 'no-run' });
    executeQuestion();
    expect(designer.nodeChat()).toEqual({ state: 'running' });
    runs.last.handlers.onRun!({
      runId: 'run-1',
      workflowId: 'answer-business-question',
    });
    expect(designer.nodeChat()).toEqual({ state: 'running' });
    runs.last.handlers.onDone!(storedRun());
    expect(designer.nodeChat()).toEqual({ state: 'ready', runId: 'run-1' });

    // A run of another workflow (not this page's, so not resolved here): no chat.
    designer.run.set(storedRun({ workflowId: 'removed-workflow' }));
    expect(designer.nodeChat()).toEqual({ state: 'hidden' });

    designer.clear();
    expect(designer.nodeChat()).toEqual({ state: 'hidden' });
  });

  it('a run that failed after it started is stored, so its steps can be chatted about', () => {
    executeQuestion();
    runs.last.handlers.onRun!({
      runId: 'run-1',
      workflowId: 'answer-business-question',
    });
    runs.last.handlers.onError!('Model down');
    expect(designer.nodeChat()).toEqual({ state: 'ready', runId: 'run-1' });
  });

  it("reads a stored run's contract hash and its contract violations (ui.md 4.4b)", () => {
    expect(designer.contractViolations()).toEqual({});
    expect(designer.runContractHash()).toBeNull();
    designer.run.set(
      storedRun({
        status: 'failed',
        contractHash: '0a1b2c3d4e5f',
        steps: [
          {
            id: 'answer',
            title: 'Answer',
            status: 'failed',
            error: 'Contract violation in Answer (input): question Required',
          },
        ],
      }),
    );
    expect(designer.contractViolations()).toEqual({ answer: 'input' });
    expect(designer.runContractHash()).toBe('0a1b2c3d4e5f');
    // An old run has no hash; a plain failure is no violation.
    designer.run.set(
      storedRun({
        status: 'failed',
        steps: [
          { id: 'answer', title: 'Answer', status: 'failed', error: 'Boom' },
        ],
      }),
    );
    expect(designer.contractViolations()).toEqual({});
    expect(designer.runContractHash()).toBeNull();
  });

  it('no longer reads agent phases from the stream (agents have no workflow of their own)', () => {
    executeQuestion();
    expect('phases' in designer).toBe(false);
    expect(runs.last.handlers.onWorkflow).toBeUndefined();
  });

  it('New question drops the run and the question, keeps the datasets and asks for the run form', () => {
    executeQuestion();
    runs.last.handlers.onDone!(storedRun());
    expect(designer.runResult()).not.toBeNull();
    const before = designer.runFormRequest();
    designer.newQuestion();
    expect(designer.runResult()).toBeNull();
    expect(designer.run()).toBeNull();
    expect(designer.shownQuestion()).toBeNull();
    expect(designer.inputValue('question')).toBe('');
    expect(designer.picked('datasets')).toEqual(['World Cup Core']);
    expect(designer.runFormRequest()).toBe(before + 1);
  });

  it('asking for the run form unfolds the Run panel: Execute workflow, New question and Run again', () => {
    designer.stateOpen.set(false);
    designer.requestRunForm();
    expect(designer.stateOpen()).toBeTrue();

    designer.stateOpen.set(false);
    designer.newQuestion();
    expect(designer.stateOpen()).toBeTrue();

    executeQuestion();
    runs.last.handlers.onDone!(storedRun());
    designer.stateOpen.set(false);
    designer.runAgain();
    expect(designer.stateOpen()).toBeTrue();
  });

  it('New question does nothing while a run is going', () => {
    executeQuestion();
    expect(designer.running()).toBeTrue();
    const before = designer.runFormRequest();
    designer.newQuestion();
    expect(designer.running()).toBeTrue();
    expect(designer.inputValue('question')).toBe(
      'Which team scored the most goals?',
    );
    expect(designer.runFormRequest()).toBe(before);
  });

  it("shownQuestion reads the live input's question, else null before any run", () => {
    expect(designer.shownQuestion()).toBeNull();
    executeQuestion();
    expect(designer.shownQuestion()).toBe('Which team scored the most goals?');
  });

  function openStored(run: WorkflowRun): void {
    designer.showRunOnLoad(run);
    designer.load(ASSISTANT.id);
    http
      .expectOne((r) => r.url.endsWith('/workflows/answer-business-question'))
      .flush(ASSISTANT);
    http.expectOne((r) => r.url.endsWith('/datasets')).flush({ datasets: [] });
  }

  it("shownQuestion reads a stored run's input question, trimmed", () => {
    openStored(
      storedRun({ input: { question: '  Stored question  ', datasets: [] } }),
    );
    expect(designer.shownQuestion()).toBe('Stored question');
  });

  it('shownQuestion falls back to the run question when its input has none', () => {
    openStored(
      storedRun({ input: { datasets: [] }, question: ' From the run ' }),
    );
    expect(designer.shownQuestion()).toBe('From the run');
  });

  describe('the query inspector (M1-25)', () => {
    const withData = (id = 'run-1') =>
      storedRun({
        id,
        answer: {
          role: 'assistant',
          content: 'Brazil scored 12.',
          at: '2026-11-11T10:00:01.000Z',
          data: [{ tool: 'run_readonly_sql', input: 'select 1', rowCount: 1 }],
        },
      });

    it('openQuery sets the index, closeQuery clears it and answers the opener', () => {
      const button = document.createElement('button');
      button.setAttribute('data-testid', 'figure-ref');
      button.setAttribute('data-query-index', '1');
      designer.openQuery(1, button);
      expect(designer.openQueryIndex()).toBe(1);
      designer.openQuery(0);
      expect(designer.openQueryIndex()).toBe(0);
      const opener = designer.closeQuery();
      expect(designer.openQueryIndex()).toBeNull();
      expect(opener?.el).toBe(button);
      expect(opener?.selector).toBe(
        '[data-testid="figure-ref"][data-query-index="1"]',
      );
    });

    it('restores a maximized Run panel when a query opens', () => {
      designer.runDockMaximized.set(true);
      designer.openQuery(0);
      expect(designer.runDockMaximized()).toBeFalse();
    });

    it('prepares a stored answer of Answer a Business Question once per run id', () => {
      const updated = withData();
      runs.prepareEvidence.and.returnValue(
        of({ ok: true, run: { ...updated, datasets: ['Updated'] } }),
      );
      openStored(withData());
      expect(runs.prepareEvidence).toHaveBeenCalledOnceWith('run-1');
      expect(designer.run()?.datasets).toEqual(['Updated']);
      openStored(withData());
      expect(runs.prepareEvidence).toHaveBeenCalledTimes(1);
      openStored(withData('run-2'));
      expect(runs.prepareEvidence).toHaveBeenCalledTimes(2);
    });

    it('does not prepare an answer with no data, and a failure is silent', () => {
      openStored(storedRun());
      expect(runs.prepareEvidence).not.toHaveBeenCalled();
      runs.prepareEvidence.and.returnValue(throwError(() => new Error('boom')));
      openStored(withData('run-3'));
      expect(designer.run()?.id).toBe('run-3');
    });
  });
});

describe('WorkflowDesigner, a run that retries a step (a loop)', () => {
  let designer: WorkflowDesigner;
  let runs: FakeRunsApi;
  let http: HttpTestingController;

  beforeEach(() => {
    runs = new FakeRunsApi();
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: WorkflowRunsApiService, useValue: runs },
        { provide: WorkflowRunTasks, useValue: runs.tasks },
      ],
    });
    designer = TestBed.inject(WorkflowDesigner);
    http = TestBed.inject(HttpTestingController);
    designer.load(GRAPH_WORKFLOW.id);
    http
      .expectOne((r) => r.url.endsWith('/workflows/answer-business-question'))
      .flush(GRAPH_WORKFLOW);
    // No datasets field: the datasets are not read.
    http
      .match((r) => r.url.endsWith('/datasets'))
      .forEach((r) => r.flush({ datasets: [] }));
    designer.setInput('question', 'How many matches per stage?');
    designer.execute();
  });

  afterEach(() => http.verify());

  it('keeps each attempt of a step live, shows the last and counts them', () => {
    const h = runs.last.handlers;
    h.onRun!({ runId: 'run-1', workflowId: 'answer-business-question' });
    h.onStep!({
      id: 'analyse',
      title: 'Analyse',
      status: 'running',
      attempt: 1,
    });
    h.onTool!({ name: 'run_readonly_sql', input: 'select 1' });
    h.onStep!({
      id: 'analyse',
      title: 'Analyse',
      status: 'success',
      attempt: 1,
      toolCalls: [{ tool: 'run_readonly_sql', input: 'select 1' }],
    });
    h.onStep!({
      id: 'validate',
      title: 'Validate',
      status: 'success',
      attempt: 1,
      output: { ok: false },
    });
    h.onStep!({
      id: 'analyse',
      title: 'Analyse',
      status: 'running',
      attempt: 2,
    });
    // A new run of an agent step starts with no live tool calls of its own.
    expect(designer.toolCalls()).toEqual([]);

    const analyse = designer
      .runResult()!
      .steps.filter((s) => s.id === 'analyse');
    expect(analyse.map((s) => [s.attempt, s.status])).toEqual([
      [1, 'success'],
      [2, 'running'],
    ]);
    expect(designer.nodeStatuses()['analyse']).toBe('running');
    expect(designer.nodeAttempts()).toEqual({ analyse: 2, validate: 1 });
    // The run panel lists each step once, as its last attempt.
    expect(
      designer
        .runPanelSteps()
        .filter((s) => s.id === 'analyse')
        .map((s) => [s.attempt, s.attempts]),
    ).toEqual([[2, 2]]);
  });

  it('counts the attempts of a stored run and lists each step once', () => {
    runs.last.handlers.onDone!({
      id: 'run-1',
      workflowId: 'answer-business-question',
      workflowName: 'Insights Analyst',
      input: { question: 'Q' },
      status: 'success',
      steps: GRAPH_RETRY_RUN.steps.map((step) => ({
        id: step.id,
        title: step.title,
        status: step.status ?? 'skipped',
        ...(step.attempt !== undefined ? { attempt: step.attempt } : {}),
      })),
      datasets: [],
      startedAt: '2026-11-13T10:00:00.000Z',
    });
    expect(designer.nodeAttempts()).toEqual(
      jasmine.objectContaining({ analyse: 2, validate: 2, plan: 1 }),
    );
    expect(designer.runPanelSteps().map((s) => s.id)).toEqual([
      'receive-question',
      'load-catalog',
      'plan',
      'clarify',
      'analyse',
      'validate',
      'write-answer',
      'wrap-up',
    ]);
  });
});

describe('WorkflowDesigner, a run that waits for an answer (api.md 138)', () => {
  let designer: WorkflowDesigner;
  let runs: FakeRunsApi;
  let http: HttpTestingController;

  const WAITING = {
    stepId: 'clarify',
    title: 'Clarify',
    question: 'Which World Cup do you mean?',
    options: ['2018', '2022'],
    expiresAt: '2026-11-11T10:30:00.000Z',
  };

  function suspendedRun(): WorkflowRun {
    return storedRun({
      status: 'suspended',
      waitingFor: { ...WAITING, since: '2026-11-11T10:00:02.000Z' },
      steps: [
        {
          id: 'plan',
          title: 'Plan',
          status: 'success',
          startedAt: '2026-11-11T10:00:01.000Z',
        },
        { id: 'clarify', title: 'Clarify', status: 'suspended' },
      ],
      answer: undefined,
    });
  }

  beforeEach(() => {
    runs = new FakeRunsApi();
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: WorkflowRunsApiService, useValue: runs },
        { provide: WorkflowRunTasks, useValue: runs.tasks },
      ],
    });
    designer = TestBed.inject(WorkflowDesigner);
    http = TestBed.inject(HttpTestingController);
    designer.load(GRAPH_WORKFLOW.id);
    http
      .expectOne((r) => r.url.endsWith(`/workflows/${GRAPH_WORKFLOW.id}`))
      .flush(GRAPH_WORKFLOW);
    http
      .match((r) => r.url.endsWith('/datasets'))
      .forEach((r) => r.flush({ datasets: [] }));
  });

  afterEach(() => http.verify());

  it('shows the waiting question while the stream suspends, then as stored', () => {
    designer.setInput('question', 'Q');
    designer.execute();
    runs.last.handlers.onRun?.({
      runId: 'run-1',
      workflowId: GRAPH_WORKFLOW.id,
    });
    runs.last.handlers.onStep?.({
      id: 'clarify',
      title: 'Clarify',
      status: 'suspended',
    });
    runs.last.handlers.onInputRequired?.({ runId: 'run-1', ...WAITING });
    expect(designer.waitingFor()?.question).toBe(WAITING.question);
    expect(designer.runResult()?.status).toBe('suspended');
    runs.last.handlers.onDone?.(suspendedRun());
    expect(designer.running()).toBeFalse();
    expect(designer.waitingFor()?.options).toEqual(['2018', '2022']);
    expect(designer.runResult()?.status).toBe('suspended');
  });

  it('resumes the same run: runId unchanged, the events appended to the steps it had', () => {
    designer.showRunOnLoad(suspendedRun());
    designer.load(GRAPH_WORKFLOW.id);
    http
      .expectOne((r) => r.url.endsWith(`/workflows/${GRAPH_WORKFLOW.id}`))
      .flush(GRAPH_WORKFLOW);
    http
      .match((r) => r.url.endsWith('/datasets'))
      .forEach((r) => r.flush({ datasets: [] }));
    expect(designer.waitingFor()).not.toBeNull();
    designer.resume('  2022 ');
    expect(runs.resumes.length).toBe(1);
    expect(runs.resumes[0]).toEqual(
      jasmine.objectContaining({
        runId: 'run-1',
        stepId: 'clarify',
        answer: '2022',
      }),
    );
    expect(designer.running()).toBeTrue();
    expect(designer.waitingFor()).toBeNull();
    expect(designer.runId()).toBe('run-1');
    const handlers = runs.resumes[0].handlers;
    handlers.onStep?.({ id: 'clarify', title: 'Clarify', status: 'success' });
    handlers.onStep?.({
      id: 'plan',
      title: 'Plan',
      status: 'running',
      attempt: 2,
    });
    const steps = designer.runResult()?.steps ?? [];
    expect(designer.runResult()?.status).toBe('running');
    expect(steps.filter((s) => s.id === 'plan').map((s) => s.status)).toEqual([
      'success',
      'running',
    ]);
    expect(steps.find((s) => s.id === 'clarify')?.status).toBe('success');
    handlers.onDone?.(storedRun({ status: 'success' }));
    expect(designer.runId()).toBe('run-1');
    expect(designer.waitingFor()).toBeNull();
    expect(designer.runResult()?.status).toBe('success');
  });

  it('can suspend again after a resume', () => {
    designer.showRunOnLoad(suspendedRun());
    designer.load(GRAPH_WORKFLOW.id);
    http
      .expectOne((r) => r.url.endsWith(`/workflows/${GRAPH_WORKFLOW.id}`))
      .flush(GRAPH_WORKFLOW);
    http
      .match((r) => r.url.endsWith('/datasets'))
      .forEach((r) => r.flush({ datasets: [] }));
    designer.resume('2022');
    const handlers = runs.resumes[0].handlers;
    handlers.onInputRequired?.({
      runId: 'run-1',
      ...WAITING,
      stepId: 'analyse',
      title: 'Analyse',
    });
    expect(designer.waitingFor()?.stepId).toBe('analyse');
    expect(designer.runResult()?.status).toBe('suspended');
  });

  it('ignores a blank answer and a run that is not waiting', () => {
    designer.showRunOnLoad(storedRun());
    designer.load(GRAPH_WORKFLOW.id);
    http
      .expectOne((r) => r.url.endsWith(`/workflows/${GRAPH_WORKFLOW.id}`))
      .flush(GRAPH_WORKFLOW);
    http
      .match((r) => r.url.endsWith('/datasets'))
      .forEach((r) => r.flush({ datasets: [] }));
    designer.resume('2022');
    expect(runs.resumes.length).toBe(0);
  });

  it('keeps the run waiting and shows the message when the server refuses (409)', () => {
    designer.showRunOnLoad(suspendedRun());
    designer.load(GRAPH_WORKFLOW.id);
    http
      .expectOne((r) => r.url.endsWith(`/workflows/${GRAPH_WORKFLOW.id}`))
      .flush(GRAPH_WORKFLOW);
    http
      .match((r) => r.url.endsWith('/datasets'))
      .forEach((r) => r.flush({ datasets: [] }));
    designer.resume('2022');
    runs.resumes[0].handlers.onRefused?.(409);
    runs.resumes[0].handlers.onError?.(
      'Run "run-1" is not waiting for an answer',
    );
    expect(designer.running()).toBeFalse();
    expect(designer.waitingFor()?.expired).toBeUndefined();
    expect(designer.resumeError()).toBe(
      'Run "run-1" is not waiting for an answer',
    );
    expect(designer.runResult()?.status).toBe('suspended');
  });

  it('reads an expired run (410) as stopped, with the card expired', () => {
    designer.showRunOnLoad(suspendedRun());
    designer.load(GRAPH_WORKFLOW.id);
    http
      .expectOne((r) => r.url.endsWith(`/workflows/${GRAPH_WORKFLOW.id}`))
      .flush(GRAPH_WORKFLOW);
    http
      .match((r) => r.url.endsWith('/datasets'))
      .forEach((r) => r.flush({ datasets: [] }));
    designer.resume('2022');
    runs.resumes[0].handlers.onRefused?.(410);
    runs.resumes[0].handlers.onError?.(
      'This run can no longer continue — run it again with your answer',
    );
    expect(designer.waitingFor()?.expired).toBeTrue();
    expect(designer.runResult()?.status).toBe('stopped');
    expect(designer.resumeError()).toBeNull();
  });

  it('runs again with the answer as a follow-up on the expired run', () => {
    const stopped = storedRun({
      status: 'stopped',
      waitingFor: { ...WAITING, expired: true },
      answer: undefined,
    });
    designer.showRunOnLoad(stopped);
    designer.load(GRAPH_WORKFLOW.id);
    http
      .expectOne((r) => r.url.endsWith(`/workflows/${GRAPH_WORKFLOW.id}`))
      .flush(GRAPH_WORKFLOW);
    http
      .match((r) => r.url.endsWith('/datasets'))
      .forEach((r) => r.flush({ datasets: [] }));
    expect(designer.waitingFor()?.expired).toBeTrue();
    designer.rerunWithAnswer('2022');
    expect(runs.calls.length).toBe(1);
    expect(runs.last.body.context).toEqual({ fromRunId: 'run-1' });
    expect(runs.last.body.input['question']).toBe('2022');
  });
});
