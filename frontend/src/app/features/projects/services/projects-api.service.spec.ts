import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { API_BASE_URL } from '../../../core/config/api.config';
import { ProjectsApiService } from './projects-api.service';

describe('ProjectsApiService feedback', () => {
  let service: ProjectsApiService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(ProjectsApiService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('posts the rating for a message', () => {
    service
      .sendMessageFeedback('project 1', '2026-01-01T00:00:00.000Z', 'up')
      .subscribe();

    const req = http.expectOne(
      `${API_BASE_URL}/projects/project%201/messages/feedback`,
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
      .repairVisualization('project 1', 'visual 1', 'x is not defined', 2)
      .subscribe();

    const req = http.expectOne(
      `${API_BASE_URL}/projects/project%201/visualizations/visual%201/repair`,
    );
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ error: 'x is not defined', version: 2 });
    req.flush({ ok: true, message: 'Repaired' });
  });

  it('posts a tailoring instruction', () => {
    service
      .tailorVisualization('project 1', 'visual 1', 'Sort descending.')
      .subscribe();

    const req = http.expectOne(
      `${API_BASE_URL}/projects/project%201/visualizations/visual%201/tailor`,
    );
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ instruction: 'Sort descending.' });
    req.flush({ ok: true, message: 'Updated' });
  });
});

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
