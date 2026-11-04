import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { API_BASE_URL } from '../../../../core/config/api.config';
import { ToastService } from '../../../../core/toast/toast.service';
import { LlmModelPicker } from './llm-model-picker';

const URL = `${API_BASE_URL}/llm/models`;

describe('LlmModelPicker', () => {
  let fixture: ComponentFixture<LlmModelPicker>;
  let component: LlmModelPicker;
  let http: HttpTestingController;
  let toast: ToastService;
  let chosen: string[];

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [LlmModelPicker],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();
    http = TestBed.inject(HttpTestingController);
    toast = TestBed.inject(ToastService);
    fixture = TestBed.createComponent(LlmModelPicker);
    component = fixture.componentInstance;
    chosen = [];
    component.modelChosen.subscribe((m) => chosen.push(m));
    fixture.componentRef.setInput('apiStyle', 'openai');
    fixture.componentRef.setInput('baseUrl', 'http://127.0.0.1:8317/v1');
    fixture.componentRef.setInput('apiKey', '');
    fixture.detectChanges();
  });

  afterEach(() => http.verify());

  const el = (): HTMLElement => fixture.nativeElement as HTMLElement;
  const button = (): HTMLButtonElement =>
    el().querySelector('[data-testid="llm-load-models"]') as HTMLButtonElement;
  const menu = (): HTMLElement | null =>
    el().querySelector('[data-testid="llm-model-options"]');
  const options = (): HTMLButtonElement[] =>
    Array.from(el().querySelectorAll('[role="option"]'));

  function clickLoad(): void {
    button().click();
    fixture.detectChanges();
  }

  it('is disabled while the base URL is empty', () => {
    fixture.componentRef.setInput('baseUrl', '   ');
    fixture.detectChanges();
    expect(button().disabled).toBeTrue();
    expect(button().textContent).toContain('Load models');
  });

  it('posts the typed style, base URL and key, and shows "Loading models…" while running', () => {
    fixture.componentRef.setInput('apiStyle', 'anthropic');
    fixture.componentRef.setInput('baseUrl', ' http://127.0.0.1:8317 ');
    fixture.componentRef.setInput('apiKey', ' sk-abc ');
    fixture.detectChanges();
    clickLoad();

    const req = http.expectOne(URL);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({
      provider: 'custom',
      apiStyle: 'anthropic',
      baseUrl: 'http://127.0.0.1:8317',
      apiKey: 'sk-abc',
    });
    expect(button().disabled).toBeTrue();
    expect(button().textContent).toContain('Loading models…');
    req.flush({ ok: true, models: [] });
  });

  it('leaves the key out when it is blank (the stored key is used)', () => {
    clickLoad();
    const req = http.expectOne(URL);
    expect('apiKey' in req.request.body).toBeFalse();
    req.flush({ ok: true, models: [] });
  });

  it('lists the models in the server order and emits the picked one', () => {
    clickLoad();
    http.expectOne(URL).flush({ ok: true, models: ['qwen3-8b', 'llama3.1:8b'] });
    fixture.detectChanges();

    expect(button().textContent).toContain('Load models');
    expect(menu()?.getAttribute('role')).toBe('listbox');
    expect(menu()?.getAttribute('aria-label')).toBe('Models');
    expect(options().map((o) => o.textContent?.trim())).toEqual([
      'qwen3-8b',
      'llama3.1:8b',
    ]);

    options()[1].click();
    fixture.detectChanges();
    expect(chosen).toEqual(['llama3.1:8b']);
    expect(menu()).toBeNull();
  });

  it('shows the empty line in the menu when the endpoint lists no models', () => {
    const info = spyOn(toast, 'info');
    clickLoad();
    http.expectOne(URL).flush({ ok: true, models: [] });
    fixture.detectChanges();
    expect(menu()?.textContent).toContain(
      'The endpoint listed no models — type the model name.',
    );
    expect(options().length).toBe(0);
    expect(info).not.toHaveBeenCalled();
  });

  it('shows an error toast with the server message on failure', () => {
    const error = spyOn(toast, 'error');
    clickLoad();
    http.expectOne(URL).flush({
      ok: false,
      message: 'The endpoint rejected the API key (401)',
    });
    fixture.detectChanges();
    expect(error).toHaveBeenCalledOnceWith(
      'The endpoint rejected the API key (401)',
    );
    expect(menu()).toBeNull();
    expect(button().disabled).toBeFalse();
  });

  it('toasts the validation message of a 400 answer', () => {
    const error = spyOn(toast, 'error');
    clickLoad();
    http
      .expectOne(URL)
      .flush(
        { message: 'baseUrl must be an http or https URL' },
        { status: 400, statusText: 'Bad Request' },
      );
    expect(error).toHaveBeenCalledOnceWith(
      'baseUrl must be an http or https URL',
    );
  });

  it('joins an array of validation messages', () => {
    const error = spyOn(toast, 'error');
    clickLoad();
    http
      .expectOne(URL)
      .flush(
        { message: ['a', 'b'] },
        { status: 400, statusText: 'Bad Request' },
      );
    expect(error).toHaveBeenCalledOnceWith('a; b');
  });

  it('closes on Escape and on a click outside', () => {
    clickLoad();
    http.expectOne(URL).flush({ ok: true, models: ['a'] });
    fixture.detectChanges();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    fixture.detectChanges();
    expect(menu()).toBeNull();

    clickLoad();
    http.expectOne(URL).flush({ ok: true, models: ['a'] });
    fixture.detectChanges();
    (el().querySelector('.fixed.inset-0') as HTMLElement).click();
    fixture.detectChanges();
    expect(menu()).toBeNull();
    expect(chosen).toEqual([]);
  });

  it('discards a loaded list when the base URL, style or key changes', () => {
    clickLoad();
    http.expectOne(URL).flush({ ok: true, models: ['a'] });
    fixture.detectChanges();
    expect(menu()).not.toBeNull();

    fixture.componentRef.setInput('apiKey', 'sk-new');
    fixture.detectChanges();
    expect(menu()).toBeNull();
    expect(component.models()).toBeNull();
  });

  it('ignores an answer that arrives after the inputs changed', () => {
    const error = spyOn(toast, 'error');
    clickLoad();
    const req = http.expectOne(URL);
    fixture.componentRef.setInput('apiStyle', 'anthropic');
    fixture.detectChanges();
    expect(button().disabled).toBeFalse();

    req.flush({ ok: false, message: 'late' });
    fixture.detectChanges();
    expect(error).not.toHaveBeenCalled();
    expect(menu()).toBeNull();
  });
});
