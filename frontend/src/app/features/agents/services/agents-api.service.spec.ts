import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { AgentsApiService } from './agents-api.service';

describe('AgentsApiService eval runs', () => {
  let api: AgentsApiService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    api = TestBed.inject(AgentsApiService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('starts a run with the judge off unless asked', () => {
    api.startEvalRun('assistant', 'ds-1', ['champion-2022']).subscribe();
    const req = http.expectOne(
      (r) =>
        r.method === 'POST' && r.url.endsWith('/agents/assistant/evals/run'),
    );
    expect(req.request.body).toEqual({
      datasourceId: 'ds-1',
      caseIds: ['champion-2022'],
      judge: 'off',
    });
    req.flush({ ok: true, message: 'Eval run started', jobId: 'job-1' });
  });

  it('sends the judge choice with the run', () => {
    api.startEvalRun('assistant', 'ds-1', ['out-of-scope'], 'on').subscribe();
    const req = http.expectOne((r) => r.url.endsWith('/evals/run'));
    expect(req.request.body.judge).toBe('on');
    req.flush({ ok: true, message: 'Eval run started', jobId: 'job-2' });
  });
});
