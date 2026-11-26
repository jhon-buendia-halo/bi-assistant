import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { API_BASE_URL } from '../../../core/config/api.config';
import {
  SessionsApiService,
  parseToolEvent,
  readEventStream,
} from './sessions-api.service';

describe('readEventStream heartbeat (api.md 3.1)', () => {
  const streamOf = (chunks: string[]) =>
    new ReadableStream<Uint8Array>({
      start(controller) {
        for (const c of chunks) controller.enqueue(new TextEncoder().encode(c));
        controller.close();
      },
    });

  it('ignores a ": ping" comment frame between two events', async () => {
    const frames: unknown[] = [];
    const how = await readEventStream(
      streamOf(['data: {"n":1}\n\n: ping\n\ndata: {"n":2}\n\n']),
      (f) => frames.push(f),
    );
    expect(how).toBe('ended');
    expect(frames).toEqual([{ n: 1 }, { n: 2 }]);
  });

  it('ignores a ping split across two chunks', async () => {
    const frames: unknown[] = [];
    await readEventStream(
      streamOf(['data: {"n":1}\n\n: pi', 'ng\n\ndata: {"n":2}\n\n']),
      (f) => frames.push(f),
    );
    expect(frames).toEqual([{ n: 1 }, { n: 2 }]);
  });
});

describe('stream frame parsers (a run host streams them too)', () => {
  it('reads the input a tool call carries, such as the skill it loads', () => {
    expect(
      parseToolEvent('{"name":"skill","input":"report-outline"}'),
    ).toEqual({ name: 'skill', input: 'report-outline' });
    expect(parseToolEvent('{"name":"get_report","input":"  "}')).toEqual({
      name: 'get_report',
    });
  });
});

describe('SessionsApiService answer evidence (api.md 144 to 148)', () => {
  it('addresses the message by its index and returns the updated message', () => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    const service = TestBed.inject(SessionsApiService);
    const http = TestBed.inject(HttpTestingController);
    const base = `${API_BASE_URL}/sessions/s%201/messages/3/answer`;
    const message = { role: 'assistant' as const, content: 'x', at: 't' };

    let got: unknown;
    service.prepareEvidence('s 1', 3).subscribe((r) => (got = r));
    const req = http.expectOne(`${base}/evidence`);
    expect(req.request.method).toBe('POST');
    req.flush({ ok: true, message });
    expect(got).toEqual({ ok: true, message });

    service.explainQuery('s 1', 3, 2).subscribe();
    http.expectOne(`${base}/queries/2/explanation`).flush({ ok: true, message });
    service.countQueryStages('s 1', 3, 2).subscribe();
    http.expectOne(`${base}/queries/2/stage-counts`).flush({ ok: true, message });
    service.rerunQuery('s 1', 3, 2).subscribe();
    expect(http.expectOne(`${base}/queries/2/rerun`).request.method).toBe('POST');
    service.pageQuery('s 1', 3, 2, { page: 2 }).subscribe();
    const page = http.expectOne(`${base}/queries/2/page`);
    expect(page.request.method).toBe('POST');
    expect(page.request.body).toEqual({ page: 2 });
    service.interpretFilter('s 1', 3, 2, 'only Brazil', null).subscribe();
    const words = http.expectOne(`${base}/queries/2/interpret-filter`);
    expect(words.request.method).toBe('POST');
    expect(words.request.body).toEqual({ text: 'only Brazil' });
    service.queryCsv('s 1', 3, 2).subscribe();
    const csv = http.expectOne(`${base}/queries/2/csv`);
    expect(csv.request.method).toBe('GET');
    expect(csv.request.responseType).toBe('blob');
    http.verify();
  });
});
