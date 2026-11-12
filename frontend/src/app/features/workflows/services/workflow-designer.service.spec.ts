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
import { ToastService } from '../../../core/toast/toast.service';
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
  trigger: 'run',
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

  it('asks for the run form with an earlier run\'s input after Run again (plan 1.24.11)', () => {
    designer.prefillRunAgain({
      question: 'Which team scored the most goals?',
      datasets: ['World Cup Core'],
      careful: true,
    });
    designer.load(ASSISTANT.id);
    http.expectOne((r) => r.url.endsWith('/workflows/agent%3Aassistant')).flush(ASSISTANT);
    http.expectOne((r) => r.url.endsWith('/datasets')).flush({ datasets: [] });
    expect(designer.runFormRequest()).toBe(1);
    expect(designer.inputValue('question')).toBe('Which team scored the most goals?');
    expect(designer.picked('datasets')).toEqual(['World Cup Core']);
    expect(designer.checked('careful')).toBeTrue();
    // A second open starts from the defaults again.
    designer.load(ASSISTANT.id);
    http.expectOne((r) => r.url.endsWith('/workflows/agent%3Aassistant')).flush(ASSISTANT);
    http.expectOne((r) => r.url.endsWith('/datasets')).flush({ datasets: [] });
    expect(designer.runFormRequest()).toBe(0);
  });

  it('starts the form from the defaults and loads the datasets to pick from', () => {
    expect(designer.inputValues()).toEqual({ careful: false });
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
    });
    expect(designer.nodeStatuses()).toEqual({});
  });

  it("fills each step's input, times and tool calls live, with the run's id, input and start", () => {
    executeQuestion();
    const h = runs.last.handlers;
    expect(designer.liveInput()).toEqual({
      question: 'Which team scored the most goals?',
      datasets: ['World Cup Core'],
      careful: false,
    });
    h.onRun!({ runId: 'run-1', workflowId: 'agent:assistant' });
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

  it('keeps the agent phases of the run for the phases bar, live and as stored (plan 1.24.5)', () => {
    executeQuestion();
    expect(designer.phases()).toBeNull();
    const view = {
      phases: [{ number: 1, title: 'Understand' }],
      current: 1,
      done: [],
      skipped: [],
      source: 'workflow' as const,
    };
    runs.last.handlers.onWorkflow!(view);
    expect(designer.phases()).toEqual(view);
    runs.last.handlers.onDone!({ ...storedRun(), workflow: { ...view, current: null, done: [1] } });
    expect(designer.phases()?.done).toEqual([1]);
  });

  it('shows the steps progress live, the tool calls and the answer forming, then the stored run', () => {
    executeQuestion();
    const h = runs.last.handlers;
    expect(designer.runResult()?.status).toBe('running');
    expect(designer.runResult()?.steps.map((s) => s.status)).toEqual([null]);

    h.onRun!({ runId: 'run-1', workflowId: 'agent:assistant' });
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
    expect(designer.nodeStatuses()).toEqual({ start: 'success', answer: 'failed', end: 'skipped' });
    expect(designer.runResult()?.finishedAt).toEqual(jasmine.any(String));
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

const RFP: WorkflowDetail = {
  ...ASSISTANT,
  id: 'agent:rfp',
  name: 'RFP Builder',
  description: 'Walks a consultant through a carrier RFP.',
  agents: [{ key: 'rfp', name: 'RFP Builder' }],
  input: [
    {
      name: 'message',
      label: 'Message',
      type: 'textarea',
      required: true,
      placeholder: 'Name the client and plan year, or state your decision',
    },
    { name: 'rfpId', label: 'RFP', type: 'text', required: false, hidden: true },
  ],
  datasets: ['Intellify RFP API'],
  starterQuestions: ['Start an RFP for a client'],
};

const START = 'Start an RFP for Orchard Manufacturing, plan year 2027';
const PROPOSAL = 'Stage 1: Orchard Manufacturing renews on 1 January 2027. Confirm?';

function rfpRun(overrides: Partial<WorkflowRun> = {}): WorkflowRun {
  return storedRun({
    workflowId: 'agent:rfp',
    workflowName: 'RFP Builder',
    input: { message: START },
    question: START,
    answer: { role: 'assistant', content: PROPOSAL, at: '2026-11-11T10:00:01.000Z' },
    datasets: ['Intellify RFP API'],
    rfpId: 'rfp-1',
    ...overrides,
  });
}

describe('WorkflowDesigner, the RFP Builder one exchange per run (plan 4.3; rfp R7, R9)', () => {
  let designer: WorkflowDesigner;
  let runs: FakeRunsApi & {
    downloadRfpPackage: jasmine.Spy;
    panelItemFile: jasmine.Spy;
  };
  let http: HttpTestingController;
  let toast: jasmine.SpyObj<ToastService>;

  beforeEach(() => {
    runs = Object.assign(new FakeRunsApi(), {
      downloadRfpPackage: jasmine
        .createSpy('downloadRfpPackage')
        .and.returnValue(of(new Blob(['zip']))),
      panelItemFile: jasmine.createSpy('panelItemFile').and.returnValue(
        of({ item: { id: 'p1' }, contentType: 'text/markdown', text: '# DRAFT — Orchard' }),
      ),
    });
    toast = jasmine.createSpyObj<ToastService>('ToastService', ['success', 'error']);
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: WorkflowRunsApiService, useValue: runs },
        { provide: ToastService, useValue: toast },
      ],
    });
    designer = TestBed.inject(WorkflowDesigner);
    http = TestBed.inject(HttpTestingController);
    designer.load(RFP.id);
    http.expectOne((r) => r.url.endsWith('/workflows/agent%3Arfp')).flush(RFP);
  });

  afterEach(() => http.verify());

  function firstExchange(run: WorkflowRun = rfpRun()): void {
    designer.setInput('message', START);
    designer.execute();
    runs.last.handlers.onRun!({ runId: run.id, workflowId: 'agent:rfp' });
    runs.last.handlers.onDone!(run);
  }

  it('runs from its page, with the message only (rfpId is hidden)', () => {
    designer.setInput('message', START);
    designer.execute();
    expect(runs.last.body).toEqual({ input: { message: START } });
  });

  it('offers Continue, not Follow up, under a run that worked on an RFP', () => {
    firstExchange();
    expect(designer.canContinue()).toBe(true);
    expect(designer.canFollowUp()).toBe(false);
  });

  it('a run that only proposed (no RFP yet) is continued by its context alone; a failed run not at all', () => {
    firstExchange(rfpRun({ rfpId: undefined }));
    expect(designer.canContinue()).toBe(true);
    designer.continueRun();
    designer.setInput('message', 'yes');
    designer.execute();
    expect(runs.last.body).toEqual({
      input: { message: 'yes' },
      context: { fromRunId: 'run-1' },
    });
    firstExchange(rfpRun({ id: 'run-2', status: 'failed', error: 'boom' }));
    expect(designer.canContinue()).toBe(false);
  });

  it('Continue clears the message; Execute then sends the RFP and this run as the context', () => {
    firstExchange();
    designer.continueRun();
    expect(designer.inputValue('message')).toBe('');
    expect(designer.pendingContinue()).toEqual({
      id: 'run-1',
      question: START,
      rfpId: 'rfp-1',
    });
    expect(runs.calls.length).toBe(1);

    designer.setInput('message', 'yes');
    designer.execute();
    expect(runs.last.body).toEqual({
      input: { message: 'yes', rfpId: 'rfp-1' },
      context: { fromRunId: 'run-1' },
    });
    expect(designer.contextRun()).toEqual({ id: 'run-1', question: START });
    runs.last.handlers.onRun!({ runId: 'run-2', workflowId: 'agent:rfp' });
    expect(designer.pendingContinue()).toBeNull();
  });

  it('a refused Continue keeps the pending Continue; cancelling it starts fresh', () => {
    firstExchange();
    designer.continueRun();
    designer.execute();
    runs.last.handlers.onError!('Message is required');
    expect(designer.runError()).toBe('Message is required');
    expect(designer.pendingContinue()?.id).toBe('run-1');
    designer.cancelContinue();
    designer.setInput('message', 'Start an RFP for another client');
    designer.execute();
    expect(runs.last.body).toEqual({
      input: { message: 'Start an RFP for another client' },
    });
  });

  it('a clarification pick keeps working on the same RFP', () => {
    firstExchange(
      rfpRun({
        answer: {
          role: 'assistant',
          content: 'Which client do you mean?',
          at: 'x',
          clarification: {
            question: 'Which client do you mean?',
            options: [{ label: 'Orchard Manufacturing' }, { label: 'Orchard Foods' }],
          },
        },
      }),
    );
    designer.followUp('Orchard Manufacturing');
    expect(runs.last.body).toEqual({
      input: { message: 'Orchard Manufacturing', rfpId: 'rfp-1' },
      context: { fromRunId: 'run-1' },
    });
  });

  it("shows the stages live from the agent's workflow events, then as stored", () => {
    designer.setInput('message', START);
    designer.execute();
    expect(designer.phases()).toBeNull();
    runs.last.handlers.onWorkflow!({
      phases: [
        { number: 1, title: 'Client and renewal' },
        { number: 2, title: 'Current program' },
      ],
      current: 1,
      done: [],
      source: 'prompt',
      skipped: [],
    });
    expect(designer.phases()?.current).toBe(1);
    runs.last.handlers.onDone!(
      rfpRun({
        workflow: {
          phases: [
            { number: 1, title: 'Client and renewal' },
            { number: 2, title: 'Current program' },
          ],
          current: 2,
          done: [1],
          source: 'prompt',
          skipped: [],
        },
      }),
    );
    expect(designer.phases()?.done).toEqual([1]);
    expect(designer.phases()?.current).toBe(2);
  });

  it('reads the RFP document the run showed in the panel', () => {
    firstExchange(
      rfpRun({
        panelItems: [
          {
            id: 'p1',
            kind: 'file',
            title: 'rfp.md',
            path: 'rfp/rfp-1/draft/rfp.md',
            bytes: 10,
            shownAt: '2026-11-11T10:00:02.000Z',
          },
        ],
      }),
    );
    expect(runs.panelItemFile).toHaveBeenCalledWith('run-1', 'p1');
    expect(designer.rfpDocument()).toEqual({
      title: 'rfp.md',
      text: '# DRAFT — Orchard',
    });
  });

  it("downloads the package from the run's route, named as the server names it, with a toast", () => {
    firstExchange();
    const click = spyOn(HTMLAnchorElement.prototype, 'click');
    const pkg = {
      rfpId: 'rfp-1',
      title: 'Orchard Manufacturing — 2027 benefits RFP',
      files: [],
      exportedAt: 'x',
      draft: true as const,
    };
    designer.downloadRfpPackage(pkg);
    expect(runs.downloadRfpPackage).toHaveBeenCalledWith('run-1', 'rfp-1', undefined, true);
    expect(click).toHaveBeenCalledTimes(1);
    const link = click.calls.mostRecent().object as HTMLAnchorElement;
    expect(link.download).toBe('rfp-orchard-manufacturing-2027-benefits-rfp-draft.zip');
    expect(toast.success).toHaveBeenCalledWith('RFP package downloaded');
    expect(designer.rfpDownloading()).toBeNull();
  });
});

describe('WorkflowDesigner, a deep-analysis run (plan 1.25.3)', () => {
  const REPORT_PATH = 'reports/denial-drivers.md';
  const DEEP: WorkflowDetail = {
    ...ASSISTANT,
    id: 'deep-analysis',
    name: 'Deep analysis',
    kind: 'code',
    stepCount: 4,
    bar: 'steps',
    trigger: 'run',
    input: ASSISTANT.input.slice(0, 2),
    steps: ['plan', 'investigate', 'write', 'assemble'].map((id) => ({
      id,
      title: id,
      kind: id === 'assemble' ? ('code' as const) : ('agent' as const),
      summary: id,
      input: [],
      output: [],
      exits: [],
    })),
  };
  const report = { jobId: 'run-1', title: 'Denial drivers', path: REPORT_PATH, angles: 3 };
  let designer: WorkflowDesigner;
  let runs: FakeRunsApi & { downloadPanelItem: jasmine.Spy };
  let http: HttpTestingController;
  let toast: jasmine.SpyObj<ToastService>;

  beforeEach(() => {
    runs = Object.assign(new FakeRunsApi(), {
      downloadPanelItem: jasmine
        .createSpy('downloadPanelItem')
        .and.returnValue(of(new Blob(['# Denial drivers']))),
    });
    toast = jasmine.createSpyObj<ToastService>('ToastService', ['success', 'error']);
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: WorkflowRunsApiService, useValue: runs },
        { provide: ToastService, useValue: toast },
      ],
    });
    designer = TestBed.inject(WorkflowDesigner);
    http = TestBed.inject(HttpTestingController);
    designer.load(DEEP.id);
    http.expectOne((r) => r.url.endsWith('/workflows/deep-analysis')).flush(DEEP);
    http.expectOne((r) => r.url.endsWith('/datasets')).flush({ datasets: [] });
  });

  afterEach(() => http.verify());

  function finish(): void {
    designer.setInput('question', 'Why are denials rising?');
    designer.toggleDataset('datasets', 'World Cup Core');
    designer.execute();
    runs.last.handlers.onRun!({ runId: 'run-1', workflowId: 'deep-analysis' });
    runs.last.handlers.onDone!(
      storedRun({
        workflowId: 'deep-analysis',
        workflowName: 'Deep analysis',
        steps: DEEP.steps.map((step) => ({ id: step.id, title: step.title, status: 'success' })),
        answer: {
          role: 'assistant',
          content: 'Denials rose to 12.4%.',
          at: '2026-11-11T10:00:01.000Z',
          report,
        },
        panelItems: [
          {
            id: 'deep-analysis-report',
            kind: 'file',
            title: 'Denial drivers',
            shownAt: 'x',
            path: REPORT_PATH,
            bytes: 2048,
          },
        ],
      }),
    );
  }

  it("downloads the report from the run's file route, named as the file, with a toast", () => {
    finish();
    const click = spyOn(HTMLAnchorElement.prototype, 'click');
    designer.downloadReport(report);
    expect(runs.downloadPanelItem).toHaveBeenCalledWith('run-1', 'deep-analysis-report');
    const link = click.calls.mostRecent().object as HTMLAnchorElement;
    expect(link.download).toBe('denial-drivers.md');
    expect(toast.success).toHaveBeenCalledWith('Report downloaded');
    expect(designer.reportDownloading()).toBeFalse();
  });

  it('says the download failed when the run has no file at the report path', () => {
    finish();
    designer.downloadReport({ ...report, path: 'reports/other.md' });
    expect(runs.downloadPanelItem).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith('Report download failed');
  });
});
