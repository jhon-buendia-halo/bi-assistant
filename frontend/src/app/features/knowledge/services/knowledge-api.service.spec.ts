import { provideHttpClient } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { KnowledgeApiService } from './knowledge-api.service';

describe('KnowledgeApiService bootstrap stream', () => {
  let service: KnowledgeApiService;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient()] });
    service = TestBed.inject(KnowledgeApiService);
  });

  it('posts the dataset id as JSON with no auth header', async () => {
    const fetchSpy = spyOn(globalThis, 'fetch').and.callFake(() =>
      Promise.resolve(sseResponse({ type: 'done', created: [] })),
    );
    const onDone = jasmine.createSpy('onDone');

    await service.bootstrapStream('dataset-1', { onDone });

    const init = fetchSpy.calls.mostRecent().args[1] as RequestInit;
    expect(init.headers).toEqual({ 'Content-Type': 'application/json' });
    expect(JSON.parse(init.body as string)).toEqual({ datasetId: 'dataset-1' });
    expect(onDone).toHaveBeenCalledOnceWith([]);
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
