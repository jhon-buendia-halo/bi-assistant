import { provideHttpClient } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { LOCAL_SESSION_STORAGE_KEY } from '../../../core/auth/auth.models';
import { KnowledgeApiService } from './knowledge-api.service';

describe('KnowledgeApiService bootstrap stream', () => {
  let service: KnowledgeApiService;

  beforeEach(() => {
    localStorage.removeItem(LOCAL_SESSION_STORAGE_KEY);
    TestBed.configureTestingModule({ providers: [provideHttpClient()] });
    service = TestBed.inject(KnowledgeApiService);
  });

  afterEach(() => localStorage.removeItem(LOCAL_SESSION_STORAGE_KEY));

  it('sends the local token as a bearer header (admin R71, ui.md 1.6)', async () => {
    localStorage.setItem(LOCAL_SESSION_STORAGE_KEY, 'tok-123');
    const fetchSpy = spyOn(globalThis, 'fetch').and.callFake(() =>
      Promise.resolve(sseResponse({ type: 'done', created: [] })),
    );
    const onDone = jasmine.createSpy('onDone');

    await service.bootstrapStream('dataset-1', { onDone });

    const init = fetchSpy.calls.mostRecent().args[1] as RequestInit;
    expect(init.headers).toEqual({
      'Content-Type': 'application/json',
      Authorization: 'Bearer tok-123',
    });
    expect(JSON.parse(init.body as string)).toEqual({ datasetId: 'dataset-1' });
    expect(onDone).toHaveBeenCalledOnceWith([]);
  });

  it('sends no Authorization header without a local token', async () => {
    const fetchSpy = spyOn(globalThis, 'fetch').and.callFake(() =>
      Promise.resolve(sseResponse({ type: 'done', created: [] })),
    );

    await service.bootstrapStream('dataset-1', {});

    const init = fetchSpy.calls.mostRecent().args[1] as RequestInit;
    expect(init.headers).toEqual({ 'Content-Type': 'application/json' });
  });
});

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
