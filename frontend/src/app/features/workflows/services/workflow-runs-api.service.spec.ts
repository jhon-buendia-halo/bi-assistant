import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { WorkflowRun, WorkflowRunStep } from '../models/workflow.model';
import { RunStreamHandlers, WorkflowRunsApiService } from './workflow-runs-api.service';

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
  workflowId: 'agent:assistant',
  workflowName: 'Assistant',
  input: { question: 'Q', datasets: ['World Cup Core'], careful: false },
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
      'agent:assistant',
      { input: { question: 'Q' }, context: { fromRunId: 'run-0' } },
      {},
    );
    const [url, init] = fetchSpy.calls.mostRecent().args as [string, RequestInit];
    expect(url).toMatch(/\/workflows\/agent%3Aassistant\/runs\/stream$/);
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({
      input: { question: 'Q' },
      context: { fromRunId: 'run-0' },
    });
  });

  it('reports the run, its steps, the agent events and the stored run, in order', async () => {
    fetchSpy.and.resolveTo(
      sseResponse(
        { type: 'run', runId: 'run-1', workflowId: 'agent:assistant' },
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
    await service.streamRun('agent:assistant', { input: {} }, handlers);
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
    await service.streamRun('agent:assistant', { input: { question: 'Q' } }, {
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
    await service.streamRun('agent:assistant', { input: {} }, { onError, onRun });
    expect(onError).toHaveBeenCalledOnceWith('Select at least one dataset');
    expect(onRun).not.toHaveBeenCalled();
  });

  it("reports the agent turn's error event", async () => {
    fetchSpy.and.resolveTo(
      sseResponse(
        { type: 'run', runId: 'run-1', workflowId: 'agent:assistant' },
        { type: 'error', content: 'The endpoint rejected the API key (401)' },
      ),
    );
    const onError = jasmine.createSpy('onError');
    await service.streamRun('agent:assistant', { input: {} }, { onError });
    expect(onError).toHaveBeenCalledOnceWith('The endpoint rejected the API key (401)');
  });

  it('reports an unreachable backend and a stream that ends without a terminal event', async () => {
    fetchSpy.and.rejectWith(new TypeError('Failed to fetch'));
    const onError = jasmine.createSpy('onError');
    await service.streamRun('seq-text-demo', { input: {} }, { onError });
    expect(onError).toHaveBeenCalledOnceWith('Backend unreachable');

    onError.calls.reset();
    fetchSpy.and.resolveTo(sseResponse({ type: 'run', runId: 'r', workflowId: 'seq-text-demo' }));
    await service.streamRun('seq-text-demo', { input: {} }, { onError });
    expect(onError).toHaveBeenCalledOnceWith('Stream ended before completion');
  });

  it('reports nothing once stopped (aborted)', async () => {
    const controller = new AbortController();
    controller.abort();
    fetchSpy.and.rejectWith(new DOMException('Aborted', 'AbortError'));
    const onError = jasmine.createSpy('onError');
    await service.streamRun('seq-text-demo', { input: {} }, { onError }, controller.signal);
    expect(onError).not.toHaveBeenCalled();
  });
});

describe("WorkflowRunsApiService, a run's files (api.md 126)", () => {
  it('downloads a file panel item of a run as a blob, ids encoded', () => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    const service = TestBed.inject(WorkflowRunsApiService);
    const http = TestBed.inject(HttpTestingController);
    let got: Blob | undefined;
    service.downloadPanelItem('run-1', 'file:synthetic/a b.sql').subscribe((b) => (got = b));
    const req = http.expectOne((r) =>
      r.url.endsWith('/workflow-runs/run-1/panel-items/file%3Asynthetic%2Fa%20b.sql/download'),
    );
    expect(req.request.method).toBe('GET');
    expect(req.request.responseType).toBe('blob');
    req.flush(new Blob(['INSERT INTO t VALUES (1);']));
    expect(got).toBeDefined();
    http.verify();
  });
});
