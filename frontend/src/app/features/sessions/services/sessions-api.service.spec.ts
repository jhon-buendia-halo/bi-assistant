import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { API_BASE_URL } from '../../../core/config/api.config';
import {
  SessionsApiService,
  parseExpertStatus,
  parseToolEvent,
} from './sessions-api.service';

describe('SessionsApiService feedback', () => {
  let service: SessionsApiService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(SessionsApiService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('posts the rating for a message', () => {
    service
      .sendMessageFeedback('session 1', '2026-01-01T00:00:00.000Z', 'up')
      .subscribe();

    const req = http.expectOne(
      `${API_BASE_URL}/sessions/session%201/messages/feedback`,
    );
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({
      messageAt: '2026-01-01T00:00:00.000Z',
      rating: 'up',
    });
    req.flush({ ok: true, message: 'Saved' });
  });

  it('posts a repair request with the failing version', () => {
    service
      .repairVisualization('session 1', 'visual 1', 'x is not defined', 2)
      .subscribe();

    const req = http.expectOne(
      `${API_BASE_URL}/sessions/session%201/visualizations/visual%201/repair`,
    );
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ error: 'x is not defined', version: 2 });
    req.flush({ ok: true, message: 'Repaired' });
  });

  it('starts a deep-analysis job and polls it', () => {
    service.startDeepAnalysis('session 1', 'Why are denials rising?').subscribe();
    const started = http.expectOne(
      `${API_BASE_URL}/sessions/session%201/deep-analysis`,
    );
    expect(started.request.method).toBe('POST');
    expect(started.request.body).toEqual({
      question: 'Why are denials rising?',
    });
    started.flush({ ok: true, message: 'Deep analysis started', jobId: 'job 1' });

    service.deepAnalysisStatus('session 1', 'job 1').subscribe();
    const polled = http.expectOne(
      `${API_BASE_URL}/sessions/session%201/deep-analysis/job%201`,
    );
    expect(polled.request.method).toBe('GET');
    polled.flush({ ok: true, message: 'planning', status: 'planning' });
  });

  it('downloads the report as a blob', () => {
    service.downloadDeepAnalysis('session 1', 'job 1').subscribe();
    const req = http.expectOne(
      `${API_BASE_URL}/sessions/session%201/deep-analysis/job%201/download`,
    );
    expect(req.request.method).toBe('GET');
    expect(req.request.responseType).toBe('blob');
    req.flush(new Blob(['# report']));
  });

  it('posts block feedback with only the fields that changed', () => {
    service
      .sendBlockFeedback('session 1', {
        messageAt: '2026-01-01T00:00:01.000Z',
        block: 'data-selection',
        vote: 'down',
      })
      .subscribe();
    const vote = http.expectOne(
      `${API_BASE_URL}/sessions/session%201/expert/feedback`,
    );
    expect(vote.request.method).toBe('POST');
    expect(vote.request.body).toEqual({
      messageAt: '2026-01-01T00:00:01.000Z',
      block: 'data-selection',
      vote: 'down',
    });
    expect(Object.keys(vote.request.body)).not.toContain('comment');
    vote.flush({ ok: true, message: 'Saved' });

    // A note alone must not touch the vote; `vote: null` clears one.
    service
      .sendBlockFeedback('session 1', {
        messageAt: '2026-01-01T00:00:01.000Z',
        block: 'sql',
        comment: 'Should filter on 31 December.',
      })
      .subscribe();
    const note = http.expectOne(
      `${API_BASE_URL}/sessions/session%201/expert/feedback`,
    );
    expect(Object.keys(note.request.body)).not.toContain('vote');
    expect(note.request.body.comment).toBe('Should filter on 31 December.');
    note.flush({ ok: true, message: 'Saved' });

    service
      .sendBlockFeedback('session 1', {
        messageAt: '2026-01-01T00:00:01.000Z',
        block: 'sql',
        vote: null,
      })
      .subscribe();
    const cleared = http.expectOne(
      `${API_BASE_URL}/sessions/session%201/expert/feedback`,
    );
    expect(cleared.request.body).toEqual({
      messageAt: '2026-01-01T00:00:01.000Z',
      block: 'sql',
      vote: null,
    });
    cleared.flush({ ok: true, message: 'Cleared' });
  });

  it('posts a tailoring instruction', () => {
    service
      .tailorVisualization('session 1', 'visual 1', 'Sort descending.')
      .subscribe();

    const req = http.expectOne(
      `${API_BASE_URL}/sessions/session%201/visualizations/visual%201/tailor`,
    );
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ instruction: 'Sort descending.' });
    req.flush({ ok: true, message: 'Updated' });
  });
});

describe('SessionsApiService streaming', () => {
  let service: SessionsApiService;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient()] });
    service = TestBed.inject(SessionsApiService);
  });

  it('reports a stream that closes without a terminal event', async () => {
    spyOn(globalThis, 'fetch').and.resolveTo(
      sseResponse({ type: 'text', content: 'partial answer' }),
    );
    const onText = jasmine.createSpy('onText');
    const onError = jasmine.createSpy('onError');

    await service.streamMessage('session-1', 'question', {
      onText,
      onError,
    });

    expect(onText).toHaveBeenCalledOnceWith('partial answer');
    expect(onError).toHaveBeenCalledOnceWith('Stream ended before completion');
  });

  it('accepts a stream that ends with done', async () => {
    const session = {
      id: 'session-1',
      name: 'Analysis',
      datasets: ['dataset'],
      messages: [],
    };
    spyOn(globalThis, 'fetch').and.resolveTo(
      sseResponse({ type: 'done', session }),
    );
    const onDone = jasmine.createSpy('onDone');
    const onError = jasmine.createSpy('onError');

    await service.streamMessage('session-1', 'question', {
      onDone,
      onError,
    });

    expect(onDone).toHaveBeenCalledOnceWith(session);
    expect(onError).not.toHaveBeenCalled();
  });

  it('reads the rationale off a tool frame, name-only frames included', async () => {
    const onTool = jasmine.createSpy('onTool');
    spyOn(globalThis, 'fetch').and.resolveTo(
      sseResponse({
        type: 'tool',
        content: JSON.stringify({
          name: 'run_readonly_sql',
          rationale: 'No cost-per-member column, so I checked the keys first.',
        }),
      }),
    );

    await service.streamMessage('session-1', 'question', { onTool });
    expect(onTool).toHaveBeenCalledOnceWith({
      name: 'run_readonly_sql',
      rationale: 'No cost-per-member column, so I checked the keys first.',
    });

    // Old contract: the frame is the bare tool name.
    expect(parseToolEvent('run_readonly_sql')).toEqual({
      name: 'run_readonly_sql',
    });
    expect(parseToolEvent('{"rationale":"orphaned"}')).toEqual({
      name: '{"rationale":"orphaned"}',
    });
  });

  it('asks for careful mode only when the turn requested it', async () => {
    // A fresh Response per call: a body stream can only be read once.
    const fetchSpy = spyOn(globalThis, 'fetch').and.callFake(() =>
      Promise.resolve(sseResponse({ type: 'done' })),
    );

    await service.streamMessage('session-1', 'question', {});
    expect(requestBody(fetchSpy)).toEqual({ content: 'question' });

    await service.streamMessage(
      'session-1',
      'question',
      {},
      undefined,
      'visual-1',
      true,
    );
    expect(requestBody(fetchSpy)).toEqual({
      content: 'question',
      activeVisualizationId: 'visual-1',
      careful: true,
    });
  });

  it('asks for business expert mode only when the turn requested it', async () => {
    const fetchSpy = spyOn(globalThis, 'fetch').and.callFake(() =>
      Promise.resolve(sseResponse({ type: 'done' })),
    );

    await service.streamMessage(
      'session-1',
      'question',
      {},
      undefined,
      undefined,
      false,
      false,
    );
    expect(requestBody(fetchSpy)).toEqual({ content: 'question' });

    await service.streamMessage(
      'session-1',
      'question',
      {},
      undefined,
      undefined,
      false,
      true,
    );
    expect(requestBody(fetchSpy)).toEqual({ content: 'question', expert: true });
  });

  it('sends pin:false only when asked, omitting it otherwise', async () => {
    const fetchSpy = spyOn(globalThis, 'fetch').and.callFake(() =>
      Promise.resolve(sseResponse({ type: 'done' })),
    );

    // Omitted pin argument — the backend's own default (replay on) applies.
    await service.streamMessage('session-1', 'question', {});
    expect(requestBody(fetchSpy)).toEqual({ content: 'question' });

    // pin: true is never sent explicitly — it is the implicit default.
    await service.streamMessage(
      'session-1',
      'question',
      {},
      undefined,
      undefined,
      false,
      false,
      true,
    );
    expect(requestBody(fetchSpy)).toEqual({ content: 'question' });

    await service.streamMessage(
      'session-1',
      'question',
      {},
      undefined,
      undefined,
      false,
      false,
      false,
    );
    expect(requestBody(fetchSpy)).toEqual({ content: 'question', pin: false });
  });

  it('reports expert-status frames and ignores unknown statuses', async () => {
    spyOn(globalThis, 'fetch').and.resolveTo(
      sseResponse(
        { type: 'expert-status', content: 'cross-check' },
        { type: 'expert-status', content: 'explaining' },
        { type: 'expert-status', content: 'pondering' },
        { type: 'expert-status', content: 'failed' },
        { type: 'done' },
      ),
    );
    const onExpertStatus = jasmine.createSpy('onExpertStatus');
    const onError = jasmine.createSpy('onError');

    await service.streamMessage('session-1', 'question', {
      onExpertStatus,
      onError,
    });

    expect(onExpertStatus.calls.allArgs()).toEqual([
      ['cross-check'],
      ['explaining'],
      ['failed'],
    ]);
    expect(onError).not.toHaveBeenCalled();
    expect(parseExpertStatus(' explaining ')).toBe('explaining');
    expect(parseExpertStatus(undefined)).toBeNull();
  });
});

/** The JSON body of the most recent fetch the service issued. */
function requestBody(fetchSpy: jasmine.Spy): unknown {
  const init = fetchSpy.calls.mostRecent().args[1] as RequestInit;
  return JSON.parse(init.body as string);
}

function sseResponse(...events: unknown[]): Response {
  const body = new ReadableStream({
    start(controller) {
      for (const event of events) {
        controller.enqueue(
          new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`),
        );
      }
      controller.close();
    },
  });
  return new Response(body, {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream' },
  });
}
