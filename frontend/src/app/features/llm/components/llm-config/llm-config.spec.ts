import { LlmModelsApiService } from '../../services/llm-models-api.service';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Subject, of, throwError } from 'rxjs';
import { LlmApiService } from '../../services/llm-api.service';
import { ToastService } from '../../../../core/toast/toast.service';
import { CopilotStatusView, LlmSettingsView } from '../../models/llm.model';
import {
  CUSTOM_BASE_URL_HINTS,
  CUSTOM_BASE_URL_PLACEHOLDERS,
  LlmConfig,
} from './llm-config';

const EMPTY_VIEW: LlmSettingsView = {
  provider: null,
  model: null,
  baseUrl: null,
  apiKeyMasked: null,
  reasoningEffort: 'high',
  configured: false,
  apiStyle: null,
};

describe('LlmConfig custom endpoint', () => {
  let fixture: ComponentFixture<LlmConfig>;
  let api: jasmine.SpyObj<LlmApiService>;

  async function render(saved: LlmSettingsView = EMPTY_VIEW): Promise<HTMLElement> {
    api = jasmine.createSpyObj<LlmApiService>('LlmApiService', [
      'getSettings',
      'saveSettings',
      'testConnection',
      'effortLevels',
      'saveReasoning',
      'copilotStatus',
    ]);
    api.getSettings.and.returnValue(of(saved));
    api.effortLevels.and.returnValue(
      of({ levels: [], defaultEffort: null, probeEffort: null }),
    );
    api.copilotStatus.and.returnValue(
      of({
        signedIn: true,
        login: 'octocat',
        method: 'gh-cli',
        message: 'Signed in to GitHub as octocat',
      }),
    );
    api.testConnection.and.returnValue(of({ ok: true, message: 'ok' }));
    api.saveSettings.and.returnValue(of({ ok: true, message: 'saved' }));
    const toast = jasmine.createSpyObj<ToastService>('ToastService', [
      'success',
      'error',
    ]);
    await TestBed.configureTestingModule({
      imports: [LlmConfig],
      providers: [
        { provide: LlmApiService, useValue: api },
        { provide: ToastService, useValue: toast },
        // The Load-models picker is tested on its own; here it never loads.
        {
          provide: LlmModelsApiService,
          useValue: jasmine.createSpyObj('LlmModelsApiService', ['listModels']),
        },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(LlmConfig);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  function pickProvider(el: HTMLElement, value: string): void {
    const select = el.querySelector('select') as HTMLSelectElement;
    select.value = value;
    select.dispatchEvent(new Event('change'));
    fixture.detectChanges();
  }

  function type(input: HTMLInputElement, value: string): void {
    input.value = value;
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
  }

  const q = <T extends Element>(el: HTMLElement, id: string): T | null =>
    el.querySelector<T>(`[data-testid="${id}"]`);

  function labels(el: HTMLElement): string[] {
    return Array.from(el.querySelectorAll('.field-label')).map((l) =>
      (l.textContent ?? '').trim(),
    );
  }

  it('offers "Custom endpoint" as a provider', async () => {
    const el = await render();
    const options = Array.from(
      (el.querySelector('select') as HTMLSelectElement).options,
    ).map((o) => o.textContent?.trim());
    expect(options).toContain('Custom endpoint');
  });

  it('shows API style, Base URL and optional key before the model for custom', async () => {
    const el = await render();
    expect(q(el, 'llm-api-style')).toBeNull();
    pickProvider(el, 'custom');
    const style = q<HTMLSelectElement>(el, 'llm-api-style')!;
    expect(style.value).toBe('openai');
    expect(Array.from(style.options).map((o) => o.textContent?.trim())).toEqual(
      ['OpenAI-compatible', 'Anthropic-compatible'],
    );
    expect(labels(el)).toEqual([
      'Provider',
      'API style',
      'Base URL',
      'API key (optional)',
      'Model',
      'Reasoning effort',
    ]);
    const key = q<HTMLInputElement>(el, 'llm-api-key')!;
    expect(key.placeholder).toBe('Leave blank if the server needs none');
    expect(q<HTMLInputElement>(el, 'llm-model')!.placeholder).toBe(
      'llama3.1:8b',
    );
    expect(q(el, 'llm-model-row')).not.toBeNull();
  });

  it('switches the base URL placeholder and hint with the API style', async () => {
    const el = await render();
    pickProvider(el, 'custom');
    const url = q<HTMLInputElement>(el, 'llm-base-url')!;
    const hint = el.querySelector('#llm-base-url-hint')!;
    expect(url.getAttribute('aria-describedby')).toBe('llm-base-url-hint');
    expect(url.placeholder).toBe('http://localhost:11434/v1');
    expect(hint.textContent?.trim()).toBe(CUSTOM_BASE_URL_HINTS.openai);
    expect(hint.textContent?.trim()).toBe(
      'Include the version path, e.g. http://127.0.0.1:8317/v1; requests use <base URL>/chat/completions.',
    );

    const style = q<HTMLSelectElement>(el, 'llm-api-style')!;
    style.value = 'anthropic';
    style.dispatchEvent(new Event('change'));
    fixture.detectChanges();
    expect(url.placeholder).toBe(CUSTOM_BASE_URL_PLACEHOLDERS.anthropic);
    expect(hint.textContent?.trim()).toBe(
      'Server root, e.g. http://127.0.0.1:8317; requests use <base URL>/v1/messages.',
    );
  });

  it('can test with model and base URL only, and sends apiStyle without a blank key', async () => {
    const el = await render();
    pickProvider(el, 'custom');
    const cmp = fixture.componentInstance;
    type(q<HTMLInputElement>(el, 'llm-model')!, 'llama3.1:8b');
    expect(cmp.canTest).toBeFalse();
    type(q<HTMLInputElement>(el, 'llm-base-url')!, ' http://127.0.0.1:8317/v1 ');
    expect(cmp.canTest).toBeTrue();

    cmp.testConnection();
    expect(api.testConnection).toHaveBeenCalledWith({
      provider: 'custom',
      model: 'llama3.1:8b',
      apiKey: undefined,
      baseUrl: 'http://127.0.0.1:8317/v1',
      apiStyle: 'openai',
      reasoningEffort: undefined,
    });
    expect(cmp.testedOk()).toBeTrue();

    cmp.saveConnection();
    expect(api.saveSettings).toHaveBeenCalledWith(
      jasmine.objectContaining({
        provider: 'custom',
        apiStyle: 'openai',
        baseUrl: 'http://127.0.0.1:8317/v1',
        apiKey: undefined,
      }),
    );
  });

  it('sends a typed key and resets the passed test on any edit', async () => {
    const el = await render();
    pickProvider(el, 'custom');
    const cmp = fixture.componentInstance;
    type(q<HTMLInputElement>(el, 'llm-model')!, 'claude-x');
    type(q<HTMLInputElement>(el, 'llm-base-url')!, 'http://127.0.0.1:8317');
    cmp.testConnection();
    expect(cmp.testedOk()).toBeTrue();

    const style = q<HTMLSelectElement>(el, 'llm-api-style')!;
    style.value = 'anthropic';
    style.dispatchEvent(new Event('change'));
    fixture.detectChanges();
    expect(cmp.testedOk()).toBeFalse();

    cmp.testConnection();
    type(q<HTMLInputElement>(el, 'llm-api-key')!, ' secret ');
    expect(cmp.testedOk()).toBeFalse();
    cmp.testConnection();
    expect(api.testConnection.calls.mostRecent().args[0]).toEqual(
      jasmine.objectContaining({ apiStyle: 'anthropic', apiKey: 'secret' }),
    );

    cmp.setModel('claude-y');
    expect(cmp.testedOk()).toBeFalse();
  });

  it('loads the saved custom style, base URL and masked key on open', async () => {
    const el = await render({
      provider: 'custom',
      model: 'claude-x',
      baseUrl: 'http://127.0.0.1:8317',
      apiKeyMasked: 'sk-…abcd',
      reasoningEffort: 'high',
      configured: true,
      apiStyle: 'anthropic',
    });
    fixture.detectChanges();
    expect(q<HTMLSelectElement>(el, 'llm-api-style')!.value).toBe('anthropic');
    expect(q<HTMLInputElement>(el, 'llm-base-url')!.value).toBe(
      'http://127.0.0.1:8317',
    );
    expect(q<HTMLInputElement>(el, 'llm-api-key')!.placeholder).toBe(
      'sk-…abcd',
    );
    expect(q<HTMLInputElement>(el, 'llm-model')!.value).toBe('claude-x');
  });

  it('does not offer another provider\'s saved key as the custom key', async () => {
    const el = await render({
      provider: 'openai',
      model: 'gpt-4o-mini',
      baseUrl: null,
      apiKeyMasked: 'sk-…wxyz',
      reasoningEffort: 'high',
      configured: true,
      apiStyle: null,
    });
    expect(q<HTMLInputElement>(el, 'llm-api-key')!.placeholder).toBe(
      'sk-…wxyz',
    );
    pickProvider(el, 'custom');
    expect(q<HTMLInputElement>(el, 'llm-api-key')!.placeholder).toBe(
      'Leave blank if the server needs none',
    );
    expect(q<HTMLSelectElement>(el, 'llm-api-style')!.value).toBe('openai');
  });

  it('sends neither apiStyle nor a base URL for OpenAI', async () => {
    const el = await render();
    pickProvider(el, 'custom');
    type(q<HTMLInputElement>(el, 'llm-base-url')!, 'http://127.0.0.1:8317/v1');
    pickProvider(el, 'openai');
    expect(q(el, 'llm-api-style')).toBeNull();
    expect(labels(el)).toEqual(['Provider', 'Model', 'Reasoning effort', 'API key']);
    type(q<HTMLInputElement>(el, 'llm-model')!, 'gpt-4o-mini');
    fixture.componentInstance.testConnection();
    const sent = api.testConnection.calls.mostRecent().args[0];
    expect(sent.apiStyle).toBeUndefined();
    expect(sent.baseUrl).toBeUndefined();
  });
  it('never carries a typed key across the custom boundary, nor a LenAI base URL', async () => {
    const el = await render();
    type(q<HTMLInputElement>(el, 'llm-api-key')!, 'sk-openai');
    pickProvider(el, 'custom');
    expect(q<HTMLInputElement>(el, 'llm-api-key')!.value).toBe('');
    expect(fixture.componentInstance.apiKey()).toBe('');
    type(q<HTMLInputElement>(el, 'llm-base-url')!, 'http://127.0.0.1:8317/v1');
    pickProvider(el, 'lenai');
    expect(fixture.componentInstance.baseUrl()).toBe('');
  });

  it('restores the saved base URL when returning to the saved provider', async () => {
    const el = await render({
      provider: 'custom',
      model: 'llama3.1:8b',
      baseUrl: 'http://localhost:11434/v1',
      apiKeyMasked: 'sk-…abcd',
      reasoningEffort: 'high',
      configured: true,
      apiStyle: 'openai',
    });
    pickProvider(el, 'openai');
    // A custom key is not offered as the OpenAI key.
    expect(q<HTMLInputElement>(el, 'llm-api-key')!.placeholder).toBe('sk-…');
    pickProvider(el, 'custom');
    expect(q<HTMLInputElement>(el, 'llm-base-url')!.value).toBe(
      'http://localhost:11434/v1',
    );
  });

  it('re-reads the saved key after a successful save', async () => {
    const el = await render();
    pickProvider(el, 'custom');
    const cmp = fixture.componentInstance;
    type(q<HTMLInputElement>(el, 'llm-model')!, 'llama3.1:8b');
    type(q<HTMLInputElement>(el, 'llm-base-url')!, 'http://localhost:11434/v1');
    type(q<HTMLInputElement>(el, 'llm-api-key')!, 'secret-cdef');
    expect(q<HTMLInputElement>(el, 'llm-api-key')!.placeholder).toBe(
      'Leave blank if the server needs none',
    );
    cmp.testConnection();
    api.getSettings.and.returnValue(
      of({
        provider: 'custom',
        model: 'llama3.1:8b',
        baseUrl: 'http://localhost:11434/v1',
        apiKeyMasked: '••••••••cdef',
        reasoningEffort: 'high',
        configured: true,
        apiStyle: 'openai',
      }),
    );
    cmp.saveConnection();
    fixture.detectChanges();
    expect(api.getSettings).toHaveBeenCalledTimes(2);
    expect(q<HTMLInputElement>(el, 'llm-api-key')!.placeholder).toBe(
      '••••••••cdef',
    );
  });

  describe('GitHub Copilot', () => {
    it('offers GitHub Copilot as the last provider', async () => {
      const el = await render();
      const options = Array.from(
        (el.querySelector('select') as HTMLSelectElement).options,
      );
      const last = options[options.length - 1];
      expect(last.value).toBe('copilot');
      expect(last.textContent?.trim()).toBe('GitHub Copilot');
    });

    it('hides API key, base URL and API style and shows the auto model hint', async () => {
      const el = await render();
      pickProvider(el, 'copilot');
      expect(q(el, 'llm-api-key')).toBeNull();
      expect(q(el, 'llm-base-url')).toBeNull();
      expect(q(el, 'llm-api-style')).toBeNull();
      expect(q<HTMLInputElement>(el, 'llm-model')!.placeholder).toBe('auto');
      expect(el.textContent).toContain(
        "Leave as auto to let Copilot choose from your plan's models.",
      );
      expect(q(el, 'llm-load-models')).not.toBeNull();
    });

    it('shows the signed-in message in the success style, reloading on each selection', async () => {
      const el = await render();
      pickProvider(el, 'copilot');
      const status = q<HTMLElement>(el, 'llm-copilot-status')!;
      expect(status.getAttribute('role')).toBe('status');
      expect(status.textContent).toContain('Signed in to GitHub as octocat');
      expect(status.classList).toContain('text-on-success-soft');
      expect(q<HTMLButtonElement>(el, 'llm-load-models')!.disabled).toBeFalse();

      pickProvider(el, 'openai');
      expect(q(el, 'llm-copilot-status')).toBeNull();
      pickProvider(el, 'copilot');
      expect(api.copilotStatus).toHaveBeenCalledTimes(2);
    });

    it('shows the not-signed-in message as a warning and disables Load models', async () => {
      const el = await render();
      api.copilotStatus.and.returnValue(
        of({
          signedIn: false,
          login: null,
          method: null,
          message: 'Not signed in to GitHub',
        }),
      );
      pickProvider(el, 'copilot');
      const status = q<HTMLElement>(el, 'llm-copilot-status')!;
      expect(status.textContent).toContain('Not signed in to GitHub');
      expect(status.classList).toContain('text-on-warning-soft');
      expect(status.classList).toContain('bg-warning-soft');
      expect(q<HTMLButtonElement>(el, 'llm-load-models')!.disabled).toBeTrue();
    });

    it('shows a warning when the status request fails', async () => {
      const el = await render();
      api.copilotStatus.and.returnValue(throwError(() => new Error('down')));
      pickProvider(el, 'copilot');
      const status = q<HTMLElement>(el, 'llm-copilot-status')!;
      expect(status.classList).toContain('text-on-warning-soft');
      expect(status.textContent).toContain('Could not check');
    });

    it('shows Checking GitHub sign-in… while the status loads', async () => {
      const el = await render();
      api.copilotStatus.and.returnValue(new Subject<CopilotStatusView>());
      pickProvider(el, 'copilot');
      const status = q<HTMLElement>(el, 'llm-copilot-status')!;
      expect(status.textContent).toContain('Checking GitHub sign-in…');
      expect(status.classList).toContain('text-fg-muted');
    });

    it('allows Test and Save with a blank model and keeps a typed model on switching', async () => {
      const el = await render();
      type(q<HTMLInputElement>(el, 'llm-model')!, 'gpt-5');
      pickProvider(el, 'copilot');
      expect(q<HTMLInputElement>(el, 'llm-model')!.value).toBe('gpt-5');
      type(q<HTMLInputElement>(el, 'llm-model')!, '');
      const cmp = fixture.componentInstance;
      expect(cmp.canTest).toBeTrue();
      cmp.testConnection();
      expect(api.testConnection).toHaveBeenCalledWith(
        jasmine.objectContaining({
          provider: 'copilot',
          model: '',
          baseUrl: undefined,
          apiStyle: undefined,
        }),
      );
      cmp.saveConnection();
      expect(api.saveSettings).toHaveBeenCalled();
    });

    it('asks for effort levels with the provider', async () => {
      const el = await render();
      pickProvider(el, 'copilot');
      type(q<HTMLInputElement>(el, 'llm-model')!, 'gpt-5');
      await new Promise((r) => setTimeout(r, 300));
      expect(api.effortLevels).toHaveBeenCalledWith('gpt-5', 'copilot');
    });

    it('loads a saved copilot configuration without a key notice', async () => {
      const el = await render({
        provider: 'copilot',
        model: 'auto',
        baseUrl: null,
        apiKeyMasked: null,
        reasoningEffort: 'high',
        configured: true,
        apiStyle: null,
      });
      expect(el.querySelector('select')!.value).toBe('copilot');
      expect(q<HTMLInputElement>(el, 'llm-model')!.value).toBe('auto');
      expect(q(el, 'llm-key-unreadable-notice')).toBeNull();
      expect(q(el, 'llm-copilot-status')).not.toBeNull();
    });
  });
});
