import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ToastService } from '../../../../core/toast/toast.service';
import { MemorySettingsView } from '../../models/memory-settings.model';
import { MemorySettings } from './memory-settings';

describe('MemorySettings', () => {
  let fixture: ComponentFixture<MemorySettings>;
  let http: HttpTestingController;
  let el: HTMLElement;

  const view = (
    over: Partial<MemorySettingsView> = {},
  ): MemorySettingsView => ({
    enabled: false,
    embeddingModel: 'text-embedding-3-small',
    embeddingKey: 'llm-settings',
    ...over,
  });

  async function render(initial: MemorySettingsView): Promise<void> {
    await TestBed.configureTestingModule({
      imports: [MemorySettings],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();
    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(MemorySettings);
    fixture.detectChanges();
    http.expectOne((r) => r.url.endsWith('/memory/settings')).flush(initial);
    fixture.detectChanges();
    el = fixture.nativeElement as HTMLElement;
  }

  const sw = () => el.querySelector('[role="switch"]') as HTMLButtonElement;

  it('shows the saved state and the embeddings line', async () => {
    await render(view({ enabled: true, embeddingKey: 'environment' }));
    expect(sw().getAttribute('aria-label')).toBe('Memory of past sessions');
    expect(sw().getAttribute('aria-checked')).toBe('true');
    expect(el.textContent).toContain('OPENAI_API_KEY from');
  });

  it('warns when there is no key', async () => {
    await render(view({ embeddingKey: 'none' }));
    expect(el.textContent).toContain('Until then nothing is remembered.');
  });

  it('PUTs the toggled value, disables while saving and toasts', async () => {
    await render(view());
    const toast = TestBed.inject(ToastService);
    spyOn(toast, 'success');
    sw().click();
    fixture.detectChanges();
    expect(sw().disabled).toBeTrue();
    const req = http.expectOne((r) => r.method === 'PUT');
    expect(req.request.body).toEqual({ enabled: true });
    req.flush(view({ enabled: true }));
    fixture.detectChanges();
    expect(sw().disabled).toBeFalse();
    expect(sw().getAttribute('aria-checked')).toBe('true');
    expect(toast.success).toHaveBeenCalledWith('Memory turned on');
  });

  it('reverts to the saved state and toasts on failure', async () => {
    await render(view());
    const toast = TestBed.inject(ToastService);
    spyOn(toast, 'error');
    sw().click();
    http
      .expectOne((r) => r.method === 'PUT')
      .flush(
        { message: 'enabled must be true or false' },
        { status: 400, statusText: 'Bad Request' },
      );
    fixture.detectChanges();
    expect(sw().getAttribute('aria-checked')).toBe('false');
    expect(toast.error).toHaveBeenCalledWith('enabled must be true or false');
  });
});
