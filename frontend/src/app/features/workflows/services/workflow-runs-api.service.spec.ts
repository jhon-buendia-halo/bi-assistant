import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { NodeChatMessage, WorkflowRun, WorkflowRunStep } from '../models/workflow.model';
import {
  NodeChatStreamHandlers,
  RunStreamHandlers,
  WorkflowRunsApiService,
} from './workflow-runs-api.service';

function sseResponse(...events: unknown[]): Response {
  const body = new ReadableStream({
    start(controller) {
      controller.enqueue(
        new TextEncoder().encode(
          events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join(''),
        ),
      );
      controller.close();
    },
  });
  return new Response(body, {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream' },
  });
}

const RUN: WorkflowRun = {
  id: 'run-1',
  workflowId: 'qti-v2-turn',
  workflowName: 'Questions to Insights v2',
  input: { question: 'Q', datasets: ['World Cup Core'] },
  status: 'success',
  steps: [{ id: 'answer', title: 'Answer', status: 'success', output: { calls: [], stopped: false } }],
  question: 'Q',
  answer: { role: 'assistant', content: 'The answer.', at: '2026-11-11T10:00:01.000Z' },
  datasets: ['World Cup Core'],
  startedAt: '2026-11-11T10:00:00.000Z',
};

describe('WorkflowRunsApiService, the run stream (api.md 119, 3.6)', () => {
  let service: WorkflowRunsApiService;
  let fetchSpy: jasmine.Spy;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(WorkflowRunsApiService);
    fetchSpy = spyOn(window, 'fetch');
  });

  it('posts the input and context to the encoded workflow id', async () => {
    fetchSpy.and.resolveTo(sseResponse({ type: 'done', run: RUN }));
    await service.streamRun(
      'qti-v2-turn',
      { input: { question: 'Q' }, context: { fromRunId: 'run-0' } },
      {},
    );
    const [url, init] = fetchSpy.calls.mostRecent().args as [string, RequestInit];
    expect(url).toMatch(/\/workflows\/qti-v2-turn\/runs\/stream$/);
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({
      input: { question: 'Q' },
      context: { fromRunId: 'run-0' },
    });
  });

  it('reports the run, its steps, the agent events and the stored run, in order', async () => {
    fetchSpy.and.resolveTo(
      sseResponse(
        { type: 'run', runId: 'run-1', workflowId: 'qti-v2-turn' },
        { type: 'step', id: 'answer', title: 'Answer', status: 'running' },
        { type: 'reasoning', content: 'Thinking about goals' },
        { type: 'tool', content: JSON.stringify({ name: 'run_readonly_sql', input: 'SELECT 1' }) },
        { type: 'tool-result', content: JSON.stringify({ tool: 'run_readonly_sql', rowCount: 3 }) },
        { type: 'text', content: 'The ' },
        { type: 'text', content: 'answer.' },
        { type: 'step', id: 'answer', title: 'Answer', status: 'success', output: { stopped: false } },
        { type: 'done', run: RUN },
      ),
    );
    const seen: string[] = [];
    const steps: WorkflowRunStep[] = [];
    const handlers: RunStreamHandlers = {
      onRun: (r) => seen.push(`run:${r.runId}`),
      onStep: (s) => {
        steps.push(s);
        seen.push(`step:${s.status}`);
      },
      onReasoning: (d) => seen.push(`reasoning:${d}`),
      onTool: (c) => seen.push(`tool:${c.name}`),
      onToolResult: (r) => seen.push(`result:${r.rowCount}`),
      onText: (d) => seen.push(`text:${d}`),
      onDone: (run) => seen.push(`done:${run.id}`),
      onError: (m) => seen.push(`error:${m}`),
    };
    await service.streamRun('qti-v2-turn', { input: {} }, handlers);
    expect(seen).toEqual([
      'run:run-1',
      'step:running',
      'reasoning:Thinking about goals',
      'tool:run_readonly_sql',
      'result:3',
      'text:The ',
      'text:answer.',
      'step:success',
      'done:run-1',
    ]);
    expect(steps[1]).toEqual({
      id: 'answer',
      title: 'Answer',
      status: 'success',
      output: { stopped: false },
    });
  });

  it('copies the input, timestamps and tool calls of a step event', async () => {
    const full = {
      id: 'answer',
      title: 'Answer',
      status: 'success',
      input: { question: 'Q' },
      inputTruncated: true,
      output: { stopped: false },
      startedAt: '2026-11-11T10:00:00.000Z',
      endedAt: '2026-11-11T10:00:02.000Z',
      toolCalls: [{ tool: 'run_readonly_sql', input: 'select 1', rowCount: 1, durationMs: 40 }],
    };
    fetchSpy.and.resolveTo(sseResponse({ type: 'step', ...full }, { type: 'done', run: RUN }));
    const steps: WorkflowRunStep[] = [];
    await service.streamRun('qti-v2-turn', { input: { question: 'Q' } }, {
      onStep: (s) => steps.push(s),
    });
    expect(steps[0]).toEqual(full as WorkflowRunStep);
  });

  it("reports a refusal with the server's message, before anything streams", async () => {
    fetchSpy.and.resolveTo(
      new Response(
        JSON.stringify({ statusCode: 400, message: 'Select at least one dataset', error: 'Bad Request' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    const onError = jasmine.createSpy('onError');
    const onRun = jasmine.createSpy('onRun');
    await service.streamRun('qti-v2-turn', { input: {} }, { onError, onRun });
    expect(onError).toHaveBeenCalledOnceWith('Select at least one dataset');
    expect(onRun).not.toHaveBeenCalled();
  });

  it("passes on a refusal's field errors (api.md 119 `errors[]`)", async () => {
    const errors = [
      { field: 'question', message: 'Question is required' },
      { field: 'datasets', message: 'Select at least one dataset' },
      { field: null, message: 'Run "x" not found' },
      { field: 3, message: 'dropped' },
    ];
    fetchSpy.and.resolveTo(
      new Response(
        JSON.stringify({ statusCode: 400, message: 'Question is required', errors }),
        { status: 400, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    const onError = jasmine.createSpy('onError');
    await service.streamRun('qti-v2-turn', { input: {} }, { onError });
    expect(onError).toHaveBeenCalledOnceWith('Question is required', errors.slice(0, 3));
  });

  it("reports the agent turn's error event", async () => {
    fetchSpy.and.resolveTo(
      sseResponse(
        { type: 'run', runId: 'run-1', workflowId: 'qti-v2-turn' },
        { type: 'error', content: 'The endpoint rejected the API key (401)' },
      ),
    );
    const onError = jasmine.createSpy('onError');
    await service.streamRun('qti-v2-turn', { input: {} }, { onError });
    expect(onError).toHaveBeenCalledOnceWith('The endpoint rejected the API key (401)');
  });

  it('reports an unreachable backend and a stream that ends without a terminal event', async () => {
    fetchSpy.and.rejectWith(new TypeError('Failed to fetch'));
    const onError = jasmine.createSpy('onError');
    await service.streamRun('qti-v2-turn', { input: {} }, { onError });
    expect(onError).toHaveBeenCalledOnceWith('Backend unreachable');

    onError.calls.reset();
    fetchSpy.and.resolveTo(sseResponse({ type: 'run', runId: 'r', workflowId: 'qti-v2-turn' }));
    await service.streamRun('qti-v2-turn', { input: {} }, { onError });
    expect(onError).toHaveBeenCalledOnceWith('Stream ended before completion');
  });

  it('reports nothing once stopped (aborted)', async () => {
    const controller = new AbortController();
    controller.abort();
    fetchSpy.and.rejectWith(new DOMException('Aborted', 'AbortError'));
    const onError = jasmine.createSpy('onError');
    await service.streamRun('qti-v2-turn', { input: {} }, { onError }, controller.signal);
    expect(onError).not.toHaveBeenCalled();
  });
});

const REPLY: NodeChatMessage = {
  id: 'm-2',
  role: 'assistant',
  content: 'Six stages.',
  toolCalls: [{ tool: 'run_readonly_sql', input: 'SELECT 1', rowCount: 6 }],
  createdAt: '2026-11-12T10:00:02.000Z',
};

describe('WorkflowRunsApiService, a step chat (api.md 136, 137)', () => {
  let service: WorkflowRunsApiService;
  let http: HttpTestingController;
  let fetchSpy: jasmine.Spy;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(WorkflowRunsApiService);
    http = TestBed.inject(HttpTestingController);
    fetchSpy = spyOn(window, 'fetch');
  });

  afterEach(() => http.verify());

  it('reads a step chat at the encoded run and step ids (136)', () => {
    let messages: NodeChatMessage[] | null = null;
    service.getNodeChat('run 1', 'an/alyse').subscribe((r) => (messages = r.messages));
    const req = http.expectOne((r) =>
      r.url.endsWith('/workflow-runs/run%201/node-chats/an%2Falyse'),
    );
    expect(req.request.method).toBe('GET');
    req.flush({ messages: [REPLY] });
    expect(messages!).toEqual([REPLY]);
  });

  it('posts the message to the stream URL and reports the turn, then the stored reply (137)', async () => {
    fetchSpy.and.resolveTo(
      sseResponse(
        { type: 'reasoning', content: 'Looking' },
        { type: 'tool', content: JSON.stringify({ name: 'run_readonly_sql', input: 'SELECT 1' }) },
        {
          type: 'tool-progress',
          content: JSON.stringify({ tool: 'run_readonly_sql', message: 'Querying' }),
        },
        { type: 'tool-result', content: JSON.stringify({ tool: 'run_readonly_sql', rowCount: 6 }) },
        { type: 'text', content: 'Six ' },
        { type: 'text', content: 'stages.' },
        { type: 'done', message: REPLY },
        { type: 'text', content: 'ignored' },
      ),
    );
    const seen: string[] = [];
    const handlers: NodeChatStreamHandlers = {
      onReasoning: (d) => seen.push(`reasoning:${d}`),
      onTool: (c) => seen.push(`tool:${c.name}:${c.input}`),
      onToolProgress: (p) => seen.push(`progress:${p.message}`),
      onToolResult: (r) => seen.push(`result:${r.rowCount}`),
      onText: (d) => seen.push(`text:${d}`),
      onDone: (m) => seen.push(`done:${m.id}`),
      onError: (m) => seen.push(`error:${m}`),
    };
    await service.streamNodeChat('run-1', 'analyse', 'How many stages?', handlers);
    const [url, init] = fetchSpy.calls.mostRecent().args as [string, RequestInit];
    expect(url).toMatch(/\/workflow-runs\/run-1\/node-chats\/analyse\/messages\/stream$/);
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({ content: 'How many stages?' });
    expect(seen).toEqual([
      'reasoning:Looking',
      'tool:run_readonly_sql:SELECT 1',
      'progress:Querying',
      'result:6',
      'text:Six ',
      'text:stages.',
      'done:m-2',
    ]);
  });

  for (const [status, message] of [
    [400, 'Message is required'],
    [404, 'Run "run-1" not found'],
    [409, 'The run is still running'],
  ] as const) {
    it(`reports a ${status} refusal with its message, before anything streams`, async () => {
      fetchSpy.and.resolveTo(
        new Response(JSON.stringify({ statusCode: status, message }), {
          status,
          headers: { 'Content-Type': 'application/json' },
        }),
      );
      const onError = jasmine.createSpy('onError');
      const onDone = jasmine.createSpy('onDone');
      await service.streamNodeChat('run-1', 'analyse', 'Hi', { onError, onDone });
      expect(onError).toHaveBeenCalledOnceWith(message);
      expect(onDone).not.toHaveBeenCalled();
    });
  }

  it("reports the turn's error event, and a stream that ends without a terminal event", async () => {
    fetchSpy.and.resolveTo(sseResponse({ type: 'error', content: 'Model down' }));
    const onError = jasmine.createSpy('onError');
    await service.streamNodeChat('run-1', 'analyse', 'Hi', { onError });
    expect(onError).toHaveBeenCalledOnceWith('Model down');

    onError.calls.reset();
    fetchSpy.and.resolveTo(sseResponse({ type: 'text', content: 'Half' }));
    await service.streamNodeChat('run-1', 'analyse', 'Hi', { onError });
    expect(onError).toHaveBeenCalledOnceWith('Stream ended before completion');
  });

  it('reports nothing once stopped (aborted)', async () => {
    const controller = new AbortController();
    controller.abort();
    fetchSpy.and.rejectWith(new DOMException('Aborted', 'AbortError'));
    const onError = jasmine.createSpy('onError');
    await service.streamNodeChat('run-1', 'analyse', 'Hi', { onError }, controller.signal);
    expect(onError).not.toHaveBeenCalled();
  });
});

describe('WorkflowRunsApiService, resume (api.md 138)', () => {
  let service: WorkflowRunsApiService;
  let fetchSpy: jasmine.Spy;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(WorkflowRunsApiService);
    fetchSpy = spyOn(window, 'fetch');
  });

  it('posts the step and answer to the encoded run id and reports the same events as a run', async () => {
    fetchSpy.and.resolveTo(
      sseResponse(
        { type: 'step', id: 'clarify', title: 'Clarify', status: 'success' },
        { type: 'step', id: 'analyse', title: 'Analyse', status: 'suspended' },
        {
          type: 'input-required',
          runId: 'agent:run-1',
          stepId: 'analyse',
          title: 'Analyse',
          question: 'Which year?',
          options: ['2018', '2022'],
          expiresAt: '2026-11-11T10:30:00.000Z',
        },
        { type: 'done', run: { ...RUN, status: 'suspended' } },
      ),
    );
    const seen: string[] = [];
    const handlers: RunStreamHandlers = {
      onStep: (s) => seen.push(`step:${s.id}:${s.status}`),
      onInputRequired: (e) =>
        seen.push(`input:${e.stepId}:${e.options.join('|')}`),
      onDone: (r) => seen.push(`done:${r.status}`),
    };
    await service.resumeRun('agent:run-1', 'clarify', '2022', handlers);
    const [url, init] = fetchSpy.calls.mostRecent().args as [string, RequestInit];
    expect(url).toMatch(/\/workflow-runs\/agent%3Arun-1\/resume\/stream$/);
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({
      stepId: 'clarify',
      answer: '2022',
    });
    expect(seen).toEqual([
      'step:clarify:success',
      'step:analyse:suspended',
      'input:analyse:2018|2022',
      'done:suspended',
    ]);
  });

  const refusals: [number, string][] = [
    [404, 'Run "run-1" not found'],
    [409, 'Run "run-1" is not waiting for an answer'],
    [400, 'Answer is required'],
    [400, 'Step "plan" is not waiting for an answer'],
    [410, 'This run can no longer continue — run it again with your answer'],
  ];
  refusals.forEach(([status, message]) => {
    it(`reports the ${status} refusal "${message}" before any stream, with its status`, async () => {
      fetchSpy.and.resolveTo(
        new Response(JSON.stringify({ statusCode: status, message }), {
          status,
          headers: { 'Content-Type': 'application/json' },
        }),
      );
      const onError = jasmine.createSpy('onError');
      const onRefused = jasmine.createSpy('onRefused');
      const onDone = jasmine.createSpy('onDone');
      await service.resumeRun('run-1', 'clarify', 'x', {
        onError,
        onRefused,
        onDone,
      });
      expect(onRefused).toHaveBeenCalledOnceWith(status);
      expect(onError).toHaveBeenCalledOnceWith(message);
      expect(onDone).not.toHaveBeenCalled();
    });
  });

  it('reports nothing once stopped (aborted)', async () => {
    const controller = new AbortController();
    controller.abort();
    fetchSpy.and.rejectWith(new DOMException('Aborted', 'AbortError'));
    const onError = jasmine.createSpy('onError');
    await service.resumeRun('run-1', 'clarify', 'x', { onError }, controller.signal);
    expect(onError).not.toHaveBeenCalled();
  });
});
