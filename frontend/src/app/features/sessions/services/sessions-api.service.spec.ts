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

  it('downloads the report as a blob', () => {
    service.downloadDeepAnalysis('session 1', 'job 1').subscribe();
    const req = http.expectOne(
      `${API_BASE_URL}/sessions/session%201/deep-analysis/job%201/download`,
    );
    expect(req.request.method).toBe('GET');
    expect(req.request.responseType).toBe('blob');
    req.flush(new Blob(['# report']));
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
