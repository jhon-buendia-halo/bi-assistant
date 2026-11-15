import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { API_BASE_URL } from '../../../core/config/api.config';
import {
  sampleReadinessPanelItem,
  sampleReadinessReport,
} from '../models/readiness.testing';
import {
  SessionsApiService,
  parseReadinessReportEvent,
  parseToolEvent,
} from './sessions-api.service';

describe('SessionsApiService past chat reads', () => {
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

  it('reads one readiness report by id', () => {
    service.getReadinessReport('r 1').subscribe();
    const req = http.expectOne(
      `${API_BASE_URL}/data-readiness/assessments/r%201`,
    );
    expect(req.request.method).toBe('GET');
    req.flush(sampleReadinessReport());
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

  it('parses the double-encoded readiness-report frame', () => {
    const event = {
      report: sampleReadinessReport(),
      panelItem: sampleReadinessPanelItem(),
    };
    expect(parseReadinessReportEvent(JSON.stringify(event))).toEqual(event);
  });

  it('ignores a malformed readiness-report frame', () => {
    expect(parseReadinessReportEvent('not json')).toBeNull();
    expect(parseReadinessReportEvent('{}')).toBeNull();
    expect(
      parseReadinessReportEvent(
        JSON.stringify({
          report: sampleReadinessReport(),
          panelItem: { ...sampleReadinessPanelItem(), kind: 'table' },
        }),
      ),
    ).toBeNull();
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
    service.queryCsv('s 1', 3, 2).subscribe();
    const csv = http.expectOne(`${base}/queries/2/csv`);
    expect(csv.request.method).toBe('GET');
    expect(csv.request.responseType).toBe('blob');
    http.verify();
  });
});
