import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { API_BASE_URL } from '../../../core/config/api.config';
import { SkillsApiService } from './skills-api.service';

describe('SkillsApiService', () => {
  let api: SkillsApiService;
  let http: HttpTestingController;
  const input = { name: 'a', description: 'Use when x', body: 'b' };

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    api = TestBed.inject(SkillsApiService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('calls the skills endpoints', () => {
    api.list().subscribe();
    expect(http.expectOne(`${API_BASE_URL}/skills`).request.method).toBe('GET');

    api.get('s 1').subscribe();
    expect(http.expectOne(`${API_BASE_URL}/skills/s%201`).request.method).toBe(
      'GET',
    );

    api.create(input).subscribe();
    const post = http.expectOne(`${API_BASE_URL}/skills`);
    expect(post.request.method).toBe('POST');
    expect(post.request.body).toEqual(input);

    api.save('s1', input).subscribe();
    const put = http.expectOne(`${API_BASE_URL}/skills/s1`);
    expect(put.request.method).toBe('PUT');
    expect(put.request.body).toEqual(input);

    api.delete('s1').subscribe();
    expect(http.expectOne(`${API_BASE_URL}/skills/s1`).request.method).toBe(
      'DELETE',
    );
  });

  it('calls the built-in skill endpoints', () => {
    api.listBuiltIn().subscribe();
    expect(
      http.expectOne(`${API_BASE_URL}/skills/built-in`).request.method,
    ).toBe('GET');

    api.getBuiltIn('deep-analysis').subscribe();
    expect(
      http.expectOne(`${API_BASE_URL}/skills/built-in/deep-analysis`).request
        .method,
    ).toBe('GET');

    const body = { description: 'Use when x', body: 'b', files: [] };
    api.saveBuiltIn('deep-analysis', body).subscribe();
    const put = http.expectOne(`${API_BASE_URL}/skills/built-in/deep-analysis`);
    expect(put.request.method).toBe('PUT');
    expect(put.request.body).toEqual(body);

    api.resetBuiltIn('deep-analysis').subscribe();
    expect(
      http.expectOne(`${API_BASE_URL}/skills/built-in/deep-analysis`).request
        .method,
    ).toBe('DELETE');
  });
});
