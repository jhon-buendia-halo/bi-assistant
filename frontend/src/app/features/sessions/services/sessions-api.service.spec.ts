import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { LOCAL_SESSION_STORAGE_KEY } from '../../../core/auth/auth.models';
import { AuthService } from '../../../core/auth/auth.service';
import { API_BASE_URL } from '../../../core/config/api.config';
import { SessionsApiService, parseToolEvent } from './sessions-api.service';

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

  it('downloads an RFP package zip or one file as a blob', () => {
    service.downloadRfpPackage('s 1', 'rfp-1').subscribe();
    const zip = http.expectOne(
      `${API_BASE_URL}/sessions/s%201/rfp-packages/rfp-1/download`,
    );
    expect(zip.request.responseType).toBe('blob');
    zip.flush(new Blob(['z']));

    service.downloadRfpPackage('s 1', 'rfp-1', 'exhibits/a.csv').subscribe();
    const one = http.expectOne(
      (r) =>
        r.url === `${API_BASE_URL}/sessions/s%201/rfp-packages/rfp-1/download` &&
        r.params.get('file') === 'exhibits/a.csv',
    );
    one.flush(new Blob(['c']));
  });

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
});

describe('SessionsApiService streaming auth', () => {
  let service: SessionsApiService;

  beforeEach(() => {
    localStorage.removeItem(LOCAL_SESSION_STORAGE_KEY);
    TestBed.configureTestingModule({ providers: [provideHttpClient()] });
    service = TestBed.inject(SessionsApiService);
  });

  afterEach(() => localStorage.removeItem(LOCAL_SESSION_STORAGE_KEY));

  it('sends the local token as a bearer header (admin R71, ui.md 1.6)', async () => {
    const fetchSpy = spyOn(globalThis, 'fetch').and.callFake(() =>
      Promise.resolve(sseResponse({ type: 'done' })),
    );

    await service.streamMessage('session-1', 'question', {});
    let headers = (fetchSpy.calls.mostRecent().args[1] as RequestInit)
      .headers as Record<string, string>;
    expect(headers['Authorization']).toBeUndefined();

    localStorage.setItem(LOCAL_SESSION_STORAGE_KEY, 'tok-123');
    await service.streamMessage('session-1', 'question', {});
    headers = (fetchSpy.calls.mostRecent().args[1] as RequestInit)
      .headers as Record<string, string>;
    expect(headers).toEqual({
      'Content-Type': 'application/json',
      Authorization: 'Bearer tok-123',
    });
  });

  it('shows the sign-in page when the stream answers 401 (admin R11)', async () => {
    const auth = TestBed.inject(AuthService);
    auth.handleUnauthorized('local');
    auth.status.set('signed-in');
    localStorage.setItem(LOCAL_SESSION_STORAGE_KEY, 'swept-token');
    spyOn(globalThis, 'fetch').and.resolveTo(
      new Response('{}', { status: 401 }),
    );
    const onError = jasmine.createSpy('onError');

    await service.streamMessage('session-1', 'question', { onError });

    expect(onError).toHaveBeenCalledOnceWith('Sign in required');
    expect(auth.status()).toBe('signed-out');
    expect(localStorage.getItem(LOCAL_SESSION_STORAGE_KEY)).toBeNull();
  });
});

/** The JSON body of the most recent fetch the service issued. */
function requestBody(fetchSpy: jasmine.Spy): unknown {
  const init = fetchSpy.calls.mostRecent().args[1] as RequestInit;
  return JSON.parse(init.body as string);
}

function sseResponse(event: unknown): Response {
  const body = new ReadableStream({
    start(controller) {
      controller.enqueue(
        new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`),
      );
      controller.close();
    },
  });
  return new Response(body, {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream' },
  });
}
