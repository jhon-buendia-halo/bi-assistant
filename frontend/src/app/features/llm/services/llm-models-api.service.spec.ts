import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { API_BASE_URL } from '../../../core/config/api.config';
import { ListModelsResult } from '../models/llm.model';
import { LlmModelsApiService } from './llm-models-api.service';

describe('LlmModelsApiService', () => {
  let service: LlmModelsApiService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(LlmModelsApiService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('posts the request body to /llm/models and returns the answer', () => {
    let result: ListModelsResult | undefined;
    service
      .listModels({
        provider: 'custom',
        apiStyle: 'openai',
        baseUrl: 'http://127.0.0.1:8317/v1',
        apiKey: 'sk-test',
      })
      .subscribe((r) => (result = r));

    const req = http.expectOne(`${API_BASE_URL}/llm/models`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({
      provider: 'custom',
      apiStyle: 'openai',
      baseUrl: 'http://127.0.0.1:8317/v1',
      apiKey: 'sk-test',
    });
    req.flush({ ok: true, models: ['qwen3-8b'] });
    expect(result).toEqual({ ok: true, models: ['qwen3-8b'] });
  });
});
