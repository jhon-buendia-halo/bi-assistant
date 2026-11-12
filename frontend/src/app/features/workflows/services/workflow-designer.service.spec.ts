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

  get last() {
    return this.calls[this.calls.length - 1];
  }
}

const ASSISTANT: WorkflowDetail = {
  id: 'agent:assistant',
  name: 'Assistant',
  description: 'Answers questions over the datasets you pick.',
  kind: 'agent',
  owner: 'Official',
  agents: [{ key: 'assistant', name: 'Questions to Insights Assistant' }],
  stepCount: 1,
  bar: 'agent',
  trigger: 'chat',
  input: [
    { name: 'question', label: 'Question', type: 'textarea', required: true },
    { name: 'datasets', label: 'Datasets', type: 'datasets', required: true },
    {
      name: 'careful',
      label: 'Careful: cross-check the result with an independent query',
      type: 'boolean',
      required: false,
      default: false,
    },
  ],
  picksDatasets: true,
  datasets: [],
  missingDatasets: [],
  starterQuestions: [],
  steps: [
    {
      id: 'answer',
      title: 'Answer',
      kind: 'agent',
      summary: 'The agent answers.',
      input: ['question', 'datasets'],
      output: ['calls', 'stopped'],
      exits: [],
    },
  ],
};

function storedRun(overrides: Partial<WorkflowRun> = {}): WorkflowRun {
  return {
    id: 'run-1',
    workflowId: 'agent:assistant',
    workflowName: 'Assistant',
    input: { question: 'Which team scored the most goals?', datasets: ['World Cup Core'], careful: false },
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
    http.expectOne((r) => r.url.endsWith('/workflows/agent%3Aassistant')).flush(ASSISTANT);
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

  it('starts the form from the defaults and loads the datasets to pick from', () => {
    expect(designer.inputValues()).toEqual({ careful: false });
    expect(designer.datasets().map((d) => d.name)).toEqual(['World Cup Core']);
    expect(designer.tabs().map((t) => t.id)).toEqual(['workflow', 'step', 'run', 'code']);
  });

  it("sends the form's typed input to the workflow's stream", () => {
    executeQuestion();
    expect(runs.last.workflowId).toBe('agent:assistant');
    expect(runs.last.body).toEqual({
      input: {
        question: 'Which team scored the most goals?',
        datasets: ['World Cup Core'],
        careful: false,
      },
    });
    expect(designer.running()).toBe(true);
  });

  it('shows the steps progress live, the tool calls and the answer forming, then the stored run', () => {
    executeQuestion();
    const h = runs.last.handlers;
    expect(designer.runResult()?.status).toBe('running');
    expect(designer.runResult()?.steps.map((s) => s.status)).toEqual([null]);

    h.onRun!({ runId: 'run-1', workflowId: 'agent:assistant' });
    h.onStep!({ id: 'answer', title: 'Answer', status: 'running' });
    expect(designer.stepStatuses()).toEqual({ answer: 'running' });
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
    expect(designer.stepStatuses()).toEqual({ answer: 'success' });
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
    designer.execute();
    runs.last.handlers.onError!('Question is required');
    expect(designer.runError()).toBe('Question is required');
    expect(designer.runResult()).toBeNull();
    expect(designer.running()).toBe(false);
  });

  it('an error after the run started fails the run with it, and the running step', () => {
    executeQuestion();
    const h = runs.last.handlers;
    h.onRun!({ runId: 'run-1', workflowId: 'agent:assistant' });
    h.onStep!({ id: 'answer', title: 'Answer', status: 'running' });
    h.onError!('The endpoint rejected the API key (401)');
    expect(designer.runError()).toBeNull();
    const result = designer.runResult()!;
    expect(result.status).toBe('failed');
    expect(result.error).toBe('The endpoint rejected the API key (401)');
    expect(designer.stepStatuses()).toEqual({ answer: 'failed' });
  });

  it('Stop aborts the stream, shows the run stopped, then reads back the stored run with its partial answer', fakeAsync(() => {
    executeQuestion();
    const h = runs.last.handlers;
    h.onRun!({ runId: 'run-1', workflowId: 'agent:assistant' });
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
    expect(designer.stepStatuses()).toEqual({ answer: 'stopped' });
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
      input: { question: 'And the fewest?', datasets: ['World Cup Core'], careful: false },
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
      input: { question: 'Highest win rate', datasets: ['World Cup Core'], careful: false },
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
});
