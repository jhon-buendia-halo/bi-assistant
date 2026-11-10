import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { API_BASE_URL } from '../../../core/config/api.config';
import { OntologyApiService } from './ontology-api.service';

describe('OntologyApiService', () => {
  let service: OntologyApiService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(OntologyApiService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('lists a dataset ontology with its filters, URL-encoding the name', () => {
    service
      .list('market insight', { kind: 'concept', source: 'mined', enabled: false })
      .subscribe();

    const req = http.expectOne(
      (r) => r.url === `${API_BASE_URL}/datasets/market%20insight/ontology`,
    );
    expect(req.request.method).toBe('GET');
    expect(req.request.params.get('kind')).toBe('concept');
    expect(req.request.params.get('source')).toBe('mined');
    expect(req.request.params.get('enabled')).toBe('false');
    req.flush([]);
  });

  it('lists without query params when no filter is given', () => {
    service.list('sales').subscribe();

    const req = http.expectOne(`${API_BASE_URL}/datasets/sales/ontology`);
    expect(req.request.params.keys()).toEqual([]);
    req.flush([]);
  });

  it('creates an item on the dataset, passing shared through', () => {
    service
      .create('a/b', {
        kind: 'instruction',
        name: 'Coverage',
        description: 'Data spans 2020–2024.',
        shared: true,
      })
      .subscribe();

    const req = http.expectOne(`${API_BASE_URL}/datasets/a%2Fb/ontology`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({
      kind: 'instruction',
      name: 'Coverage',
      description: 'Data spans 2020–2024.',
      shared: true,
    });
    req.flush({});
  });

  it('patches and deletes by id on /ontology/:id', () => {
    service.update('id 1', { enabled: true }).subscribe();
    const patch = http.expectOne(`${API_BASE_URL}/ontology/id%201`);
    expect(patch.request.method).toBe('PATCH');
    expect(patch.request.body).toEqual({ enabled: true });
    patch.flush({});

    service.remove('id 1').subscribe();
    const del = http.expectOne(`${API_BASE_URL}/ontology/id%201`);
    expect(del.request.method).toBe('DELETE');
    del.flush(null, { status: 204, statusText: 'No Content' });
  });
});

describe('OntologyApiService bootstrap stream', () => {
  let service: OntologyApiService;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient()] });
    service = TestBed.inject(OntologyApiService);
  });

  it('posts to the dataset bootstrap stream and reports progress then done', async () => {
    const fetchSpy = spyOn(globalThis, 'fetch').and.callFake(() =>
      Promise.resolve(
        sseResponse([
          { type: 'progress', key: 'schema', message: 'Reading schema' },
          { type: 'done', created: [] },
        ]),
      ),
    );
    const onProgress = jasmine.createSpy('onProgress');
    const onDone = jasmine.createSpy('onDone');

    await service.bootstrapStream('market insight', { onProgress, onDone });

    const [url, init] = fetchSpy.calls.mostRecent().args as [
      string,
      RequestInit,
    ];
    expect(url).toBe(
      `${API_BASE_URL}/datasets/market%20insight/ontology/bootstrap/stream`,
    );
    expect(init.method).toBe('POST');
    expect(init.headers).toEqual({ 'Content-Type': 'application/json' });
    expect(onProgress).toHaveBeenCalledOnceWith({
      key: 'schema',
      message: 'Reading schema',
    });
    expect(onDone).toHaveBeenCalledOnceWith([]);
  });

  it('reports the HTTP status when the stream cannot start', async () => {
    spyOn(globalThis, 'fetch').and.callFake(() =>
      Promise.resolve(new Response('nope', { status: 404 })),
    );
    const onError = jasmine.createSpy('onError');

    await service.bootstrapStream('missing', { onError });

    expect(onError).toHaveBeenCalledOnceWith(
      'Could not generate suggestions (404)',
    );
  });

  it('never leaves the run spinning when the stream ends without a verdict', async () => {
    spyOn(globalThis, 'fetch').and.callFake(() =>
      Promise.resolve(sseResponse([])),
    );
    const onError = jasmine.createSpy('onError');

    await service.bootstrapStream('sales', { onError });

    expect(onError).toHaveBeenCalledOnceWith('Stream ended unexpectedly');
  });
});

function sseResponse(events: unknown[]): Response {
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
