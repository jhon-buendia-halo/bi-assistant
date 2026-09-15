import { provideHttpClient } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { ProjectsApiService } from './projects-api.service';

describe('ProjectsApiService streaming', () => {
  let service: ProjectsApiService;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient()] });
    service = TestBed.inject(ProjectsApiService);
  });

  it('reports a stream that closes without a terminal event', async () => {
    spyOn(globalThis, 'fetch').and.resolveTo(
      sseResponse({ type: 'text', content: 'partial answer' }),
    );
    const onText = jasmine.createSpy('onText');
    const onError = jasmine.createSpy('onError');

    await service.streamMessage('project-1', 'question', {
      onText,
      onError,
    });

    expect(onText).toHaveBeenCalledOnceWith('partial answer');
    expect(onError).toHaveBeenCalledOnceWith('Stream ended before completion');
  });

  it('accepts a stream that ends with done', async () => {
    const project = {
      id: 'project-1',
      name: 'Analysis',
      sandboxes: ['sandbox'],
      messages: [],
    };
    spyOn(globalThis, 'fetch').and.resolveTo(
      sseResponse({ type: 'done', project }),
    );
    const onDone = jasmine.createSpy('onDone');
    const onError = jasmine.createSpy('onError');

    await service.streamMessage('project-1', 'question', {
      onDone,
      onError,
    });

    expect(onDone).toHaveBeenCalledOnceWith(project);
    expect(onError).not.toHaveBeenCalled();
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
