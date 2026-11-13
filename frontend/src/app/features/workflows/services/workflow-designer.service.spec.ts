import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed, fakeAsync, tick } from '@angular/core/testing';
import { of } from 'rxjs';
import {
  WorkflowDetail,
  WorkflowRun,
  WorkflowRunRequest,
} from '../models/workflow.model';
import { WorkflowDesigner } from './workflow-designer.service';
import { GRAPH_RETRY_RUN, GRAPH_WORKFLOW } from './workflow-graph.testing';
import { RunStreamHandlers, WorkflowRunsApiService } from './workflow-runs-api.service';

/** A run stream the test drives: each call is recorded with its handlers. */
class FakeRunsApi {
  calls: {
    workflowId: string;
    body: WorkflowRunRequest;
    handlers: RunStreamHandlers;
    signal?: AbortSignal;
    end: () => void;
  }[] = [];
  getRun = jasmine.createSpy('getRun');
  rateAnswer = jasmine.createSpy('rateAnswer');

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
  id: 'qti-v2-turn',
  name: 'Questions to Insights v2',
  description: 'Answers questions over the datasets you pick.',
  kind: 'code',
  owner: 'Official',
  agents: [{ key: 'assistant-v2', name: 'Questions to Insights v2' }],
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
        key: 'assistant-v2',
        name: 'Questions to Insights v2',
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
    workflowId: 'qti-v2-turn',
    workflowName: 'Questions to Insights v2',
    input: { question: 'Which team scored the most goals?', datasets: ['World Cup Core'], verbose: false },
    status: 'success',
    steps: [{ id: 'answer', title: 'Answer', status: 'success', output: { stopped: false } }],
    question: 'Which team scored the most goals?',
    answer: { role: 'assistant', content: 'Brazil scored the most.', at: '2026-11-11T10:00:01.000Z' },
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
      ],
    });
    designer = TestBed.inject(WorkflowDesigner);
    http = TestBed.inject(HttpTestingController);
    designer.load(ASSISTANT.id);
    http.expectOne((r) => r.url.endsWith('/workflows/qti-v2-turn')).flush(ASSISTANT);
    http
      .expectOne((r) => r.url.endsWith('/datasets'))
      .flush({ datasets: [{ name: 'World Cup Core', tables: ['a', 'b'], datasourceKind: 'postgres' }] });
  });

  afterEach(() => http.verify());

  function executeQuestion(): void {
    designer.setInput('question', 'Which team scored the most goals?');
    designer.toggleDataset('datasets', 'World Cup Core');
    designer.execute();
  }

  it('asks for the run form with an earlier run\'s input after Run again (plan 1.24.11)', () => {
    designer.prefillRunAgain({
      question: 'Which team scored the most goals?',
      datasets: ['World Cup Core'],
      verbose: true,
    });
    designer.load(ASSISTANT.id);
    http.expectOne((r) => r.url.endsWith('/workflows/qti-v2-turn')).flush(ASSISTANT);
    http.expectOne((r) => r.url.endsWith('/datasets')).flush({ datasets: [] });
    expect(designer.runFormRequest()).toBe(1);
    expect(designer.inputValue('question')).toBe('Which team scored the most goals?');
    expect(designer.picked('datasets')).toEqual(['World Cup Core']);
    expect(designer.checked('verbose')).toBeTrue();
    // A second open starts from the defaults again.
    designer.load(ASSISTANT.id);
    http.expectOne((r) => r.url.endsWith('/workflows/qti-v2-turn')).flush(ASSISTANT);
    http.expectOne((r) => r.url.endsWith('/datasets')).flush({ datasets: [] });
    expect(designer.runFormRequest()).toBe(0);
  });

  it('starts the form from the defaults and loads the datasets to pick from', () => {
    expect(designer.inputValues()).toEqual({ verbose: false });
    expect(designer.datasets().map((d) => d.name)).toEqual(['World Cup Core']);
  });

  it('selects any node, opens and closes its dialog, and keeps Start, steps and End as nodes', () => {
    expect(designer.nodes().map((n) => n.nodeId)).toEqual(['start', 'answer', 'end']);
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

  it("opens a tool sub-node as that tool, with its calls in the run shown; its agent step stays selected", () => {
    designer.openNode('answer-tool-run_readonly_sql');
    expect(designer.openNodeId()).toBe('answer-tool-run_readonly_sql');
    expect(designer.selectedStepId()).toBe('answer');
    const tool = designer.openInspection()!;
    expect(tool.kind).toBe('tool');
    expect(tool.title).toBe('run_readonly_sql');
    expect(tool.tool?.calls).toEqual([]);
    // Tools are not nodes of the state panel.
    expect(designer.nodes().map((n) => n.nodeId)).toEqual(['start', 'answer', 'end']);

    executeQuestion();
    runs.last.handlers.onStep!({
      id: 'answer',
      title: 'Answer',
      status: 'success',
      toolCalls: [
        { tool: 'list_entities', durationMs: 3 },
        { tool: 'run_readonly_sql', input: 'SELECT 1', rowCount: 1, durationMs: 40 },
      ],
    });
    expect(designer.openInspection()?.tool?.calls.map((c) => c.input)).toEqual(['SELECT 1']);
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
    h.onRun!({ runId: 'run-1', workflowId: 'qti-v2-turn' });
    h.onStep!({
      id: 'answer',
      title: 'Answer',
      status: 'success',
      input: { question: 'Which team scored the most goals?' },
      inputTruncated: true,
      output: { stopped: false },
      startedAt: '2026-11-11T10:00:00.000Z',
      endedAt: '2026-11-11T10:00:02.500Z',
      toolCalls: [{ tool: 'run_readonly_sql', input: 'SELECT 1', rowCount: 1, durationMs: 40 }],
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
        toolCalls: [{ tool: 'run_readonly_sql', input: 'SELECT 1', rowCount: 1, durationMs: 40 }],
      }),
    );
    const answer = designer.nodes()[1];
    expect(answer.run?.durationMs).toBe(2500);
    expect(answer.run?.toolCalls.map((c) => c.tool)).toEqual(['run_readonly_sql']);
    expect(designer.nodes()[0].run?.input).toEqual(designer.liveInput()!);
    expect(designer.stateSummary()).toEqual(
      jasmine.objectContaining({ status: 'running', ran: 2, total: 3, runId: 'run-1' }),
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
    expect(result.steps[0].input).toEqual({ question: 'Which team scored the most goals?' });
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
    expect(runs.last.workflowId).toBe('qti-v2-turn');
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

    h.onRun!({ runId: 'run-1', workflowId: 'qti-v2-turn' });
    h.onStep!({ id: 'answer', title: 'Answer', status: 'running' });
    expect(designer.nodeStatuses()).toEqual({ start: 'success', answer: 'running' });
    h.onReasoning!('Looking at goals');
    h.onTool!({ name: 'run_readonly_sql', input: 'SELECT team FROM goals' });
    expect(designer.toolCalls()).toEqual([
      { name: 'run_readonly_sql', input: 'SELECT team FROM goals', finished: false },
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
      { id: 'answer', title: 'Answer', kind: 'agent', status: 'success', output: { stopped: false } },
    ]);
    expect(designer.nodeStatuses()).toEqual({ start: 'success', answer: 'success', end: 'success' });
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
    expect(designer.fieldErrors()).toEqual({ datasets: 'Select at least one dataset' });
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
      { field: 'question', message: 'Question must be at most 4000 characters' },
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
    h.onRun!({ runId: 'run-1', workflowId: 'qti-v2-turn' });
    h.onStep!({ id: 'answer', title: 'Answer', status: 'running' });
    h.onError!('The endpoint rejected the API key (401)');
    expect(designer.runError()).toBeNull();
    const result = designer.runResult()!;
    expect(result.status).toBe('failed');
    expect(result.error).toBe('The endpoint rejected the API key (401)');
    expect(designer.nodeStatuses()).toEqual({ start: 'success', answer: 'failed', end: 'skipped' });
    expect(designer.runResult()?.finishedAt).toEqual(jasmine.any(String));
  });

  it('Stop aborts the stream, shows the run stopped, then reads back the stored run with its partial answer', fakeAsync(() => {
    executeQuestion();
    const h = runs.last.handlers;
    h.onRun!({ runId: 'run-1', workflowId: 'qti-v2-turn' });
    h.onStep!({ id: 'answer', title: 'Answer', status: 'running' });
    runs.getRun.and.returnValues(
      of(storedRun({ status: 'running', answer: undefined })),
      of(
        storedRun({
          status: 'stopped',
          steps: [{ id: 'answer', title: 'Answer', status: 'stopped' }],
          answer: { role: 'assistant', content: 'Brazil', at: 'x' },
        }),
      ),
    );

    designer.stop();
    expect(runs.last.signal?.aborted).toBe(true);
    expect(designer.running()).toBe(false);
    expect(designer.runResult()?.status).toBe('stopped');
    expect(designer.nodeStatuses()).toEqual({ start: 'success', answer: 'stopped', end: 'stopped' });
    // Events of the stopped stream are ignored.
    h.onText!('late');
    expect(designer.streamingText()).toBe('');

    tick(300);
    expect(runs.getRun).toHaveBeenCalledTimes(2);
    expect(runs.getRun).toHaveBeenCalledWith('run-1');
    expect(designer.run()?.status).toBe('stopped');
    expect(designer.runResult()?.answer?.content).toBe('Brazil');
    expect(designer.canFollowUp()).toBe(false);
  }));

  it('Follow up runs on the same input with the new question and this run as its context', () => {
    executeQuestion();
    runs.last.handlers.onDone!(storedRun());
    designer.followUpText.set('And the fewest?');
    designer.followUp(designer.followUpText());
    expect(runs.calls.length).toBe(2);
    expect(runs.last.body).toEqual({
      input: { question: 'And the fewest?', datasets: ['World Cup Core'], verbose: false },
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
      input: { question: 'Highest win rate', datasets: ['World Cup Core'], verbose: false },
      context: { fromRunId: 'run-1' },
    });
  });

  it('leaving the page stops the stream and discards the run shown', () => {
    executeQuestion();
    const signal = runs.last.signal!;
    designer.clear();
    expect(signal.aborted).toBe(true);
    expect(designer.runResult()).toBeNull();
    expect(designer.running()).toBe(false);
  });

  it('an old stored run that still carries an rfpId is shown as a plain run', () => {
    executeQuestion();
    runs.last.handlers.onRun!({ runId: 'run-1', workflowId: 'qti-v2-turn' });
    runs.last.handlers.onDone!({ ...storedRun(), rfpId: 'rfp-1' } as WorkflowRun);
    expect(designer.run()?.answer?.content).toBe('Brazil scored the most.');
    expect(designer.canFollowUp()).toBe(true);
  });

  it("offers a step's chat only once the run shown ended and is stored", () => {
    expect(designer.nodeChat()).toEqual({ state: 'no-run' });
    executeQuestion();
    expect(designer.nodeChat()).toEqual({ state: 'running' });
    runs.last.handlers.onRun!({ runId: 'run-1', workflowId: 'qti-v2-turn' });
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
    runs.last.handlers.onRun!({ runId: 'run-1', workflowId: 'qti-v2-turn' });
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
        steps: [{ id: 'answer', title: 'Answer', status: 'failed', error: 'Boom' }],
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
      ],
    });
    designer = TestBed.inject(WorkflowDesigner);
    http = TestBed.inject(HttpTestingController);
    designer.load(GRAPH_WORKFLOW.id);
    http.expectOne((r) => r.url.endsWith('/workflows/qti-v2-turn')).flush(GRAPH_WORKFLOW);
    // No datasets field: the datasets are not read.
    http.match((r) => r.url.endsWith('/datasets')).forEach((r) => r.flush({ datasets: [] }));
    designer.setInput('question', 'How many matches per stage?');
    designer.execute();
  });

  afterEach(() => http.verify());

  it('keeps each attempt of a step live, shows the last and counts them', () => {
    const h = runs.last.handlers;
    h.onRun!({ runId: 'run-1', workflowId: 'qti-v2-turn' });
    h.onStep!({ id: 'analyse', title: 'Analyse', status: 'running', attempt: 1 });
    h.onTool!({ name: 'run_readonly_sql', input: 'select 1' });
    h.onStep!({
      id: 'analyse',
      title: 'Analyse',
      status: 'success',
      attempt: 1,
      toolCalls: [{ tool: 'run_readonly_sql', input: 'select 1' }],
    });
    h.onStep!({ id: 'validate', title: 'Validate', status: 'success', attempt: 1, output: { ok: false } });
    h.onStep!({ id: 'analyse', title: 'Analyse', status: 'running', attempt: 2 });
    // A new run of an agent step starts with no live tool calls of its own.
    expect(designer.toolCalls()).toEqual([]);

    const analyse = designer.runResult()!.steps.filter((s) => s.id === 'analyse');
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
      workflowId: 'qti-v2-turn',
      workflowName: 'Questions to Insights v2',
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
        { id: 'plan', title: 'Plan', status: 'success', startedAt: '2026-11-11T10:00:01.000Z' },
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
      ],
    });
    designer = TestBed.inject(WorkflowDesigner);
    http = TestBed.inject(HttpTestingController);
    designer.load(GRAPH_WORKFLOW.id);
    http.expectOne((r) => r.url.endsWith(`/workflows/${GRAPH_WORKFLOW.id}`)).flush(GRAPH_WORKFLOW);
    http.match((r) => r.url.endsWith('/datasets')).forEach((r) => r.flush({ datasets: [] }));
  });

  afterEach(() => http.verify());

  it('shows the waiting question while the stream suspends, then as stored', () => {
    designer.setInput('question', 'Q');
    designer.execute();
    runs.last.handlers.onRun?.({ runId: 'run-1', workflowId: GRAPH_WORKFLOW.id });
    runs.last.handlers.onStep?.({ id: 'clarify', title: 'Clarify', status: 'suspended' });
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
    http.expectOne((r) => r.url.endsWith(`/workflows/${GRAPH_WORKFLOW.id}`)).flush(GRAPH_WORKFLOW);
    http.match((r) => r.url.endsWith('/datasets')).forEach((r) => r.flush({ datasets: [] }));
    expect(designer.waitingFor()).not.toBeNull();
    designer.resume('  2022 ');
    expect(runs.resumes.length).toBe(1);
    expect(runs.resumes[0]).toEqual(
      jasmine.objectContaining({ runId: 'run-1', stepId: 'clarify', answer: '2022' }),
    );
    expect(designer.running()).toBeTrue();
    expect(designer.waitingFor()).toBeNull();
    expect(designer.runId()).toBe('run-1');
    const handlers = runs.resumes[0].handlers;
    handlers.onStep?.({ id: 'clarify', title: 'Clarify', status: 'success' });
    handlers.onStep?.({ id: 'plan', title: 'Plan', status: 'running', attempt: 2 });
    const steps = designer.runResult()?.steps ?? [];
    expect(designer.runResult()?.status).toBe('running');
    expect(steps.filter((s) => s.id === 'plan').map((s) => s.status)).toEqual(['success', 'running']);
    expect(steps.find((s) => s.id === 'clarify')?.status).toBe('success');
    handlers.onDone?.(storedRun({ status: 'success' }));
    expect(designer.runId()).toBe('run-1');
    expect(designer.waitingFor()).toBeNull();
    expect(designer.runResult()?.status).toBe('success');
  });

  it('can suspend again after a resume', () => {
    designer.showRunOnLoad(suspendedRun());
    designer.load(GRAPH_WORKFLOW.id);
    http.expectOne((r) => r.url.endsWith(`/workflows/${GRAPH_WORKFLOW.id}`)).flush(GRAPH_WORKFLOW);
    http.match((r) => r.url.endsWith('/datasets')).forEach((r) => r.flush({ datasets: [] }));
    designer.resume('2022');
    const handlers = runs.resumes[0].handlers;
    handlers.onInputRequired?.({ runId: 'run-1', ...WAITING, stepId: 'analyse', title: 'Analyse' });
    expect(designer.waitingFor()?.stepId).toBe('analyse');
    expect(designer.runResult()?.status).toBe('suspended');
  });

  it('ignores a blank answer and a run that is not waiting', () => {
    designer.showRunOnLoad(storedRun());
    designer.load(GRAPH_WORKFLOW.id);
    http.expectOne((r) => r.url.endsWith(`/workflows/${GRAPH_WORKFLOW.id}`)).flush(GRAPH_WORKFLOW);
    http.match((r) => r.url.endsWith('/datasets')).forEach((r) => r.flush({ datasets: [] }));
    designer.resume('2022');
    expect(runs.resumes.length).toBe(0);
  });

  it('keeps the run waiting and shows the message when the server refuses (409)', () => {
    designer.showRunOnLoad(suspendedRun());
    designer.load(GRAPH_WORKFLOW.id);
    http.expectOne((r) => r.url.endsWith(`/workflows/${GRAPH_WORKFLOW.id}`)).flush(GRAPH_WORKFLOW);
    http.match((r) => r.url.endsWith('/datasets')).forEach((r) => r.flush({ datasets: [] }));
    designer.resume('2022');
    runs.resumes[0].handlers.onRefused?.(409);
    runs.resumes[0].handlers.onError?.('Run "run-1" is not waiting for an answer');
    expect(designer.running()).toBeFalse();
    expect(designer.waitingFor()?.expired).toBeUndefined();
    expect(designer.resumeError()).toBe('Run "run-1" is not waiting for an answer');
    expect(designer.runResult()?.status).toBe('suspended');
  });

  it('reads an expired run (410) as stopped, with the card expired', () => {
    designer.showRunOnLoad(suspendedRun());
    designer.load(GRAPH_WORKFLOW.id);
    http.expectOne((r) => r.url.endsWith(`/workflows/${GRAPH_WORKFLOW.id}`)).flush(GRAPH_WORKFLOW);
    http.match((r) => r.url.endsWith('/datasets')).forEach((r) => r.flush({ datasets: [] }));
    designer.resume('2022');
    runs.resumes[0].handlers.onRefused?.(410);
    runs.resumes[0].handlers.onError?.('This run can no longer continue — run it again with your answer');
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
    http.expectOne((r) => r.url.endsWith(`/workflows/${GRAPH_WORKFLOW.id}`)).flush(GRAPH_WORKFLOW);
    http.match((r) => r.url.endsWith('/datasets')).forEach((r) => r.flush({ datasets: [] }));
    expect(designer.waitingFor()?.expired).toBeTrue();
    designer.rerunWithAnswer('2022');
    expect(runs.calls.length).toBe(1);
    expect(runs.last.body.context).toEqual({ fromRunId: 'run-1' });
    expect(runs.last.body.input['question']).toBe('2022');
  });
});
