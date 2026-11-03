import {
  Component,
  OnDestroy,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { LucideAngularModule, Loader2, TriangleAlert } from 'lucide-angular';
import { LlmApiService } from '../../services/llm-api.service';
import {
  ApiStyle,
  LlmProvider,
  LlmSettings,
  ReasoningEffort,
} from '../../models/llm.model';
import { ToastService } from '../../../../core/toast/toast.service';

/** Labels for the effort select, in the order the backend sends levels. */
export const EFFORT_LABELS: Record<ReasoningEffort, string> = {
  none: 'None',
  minimal: 'Minimal',
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  xhigh: 'XHigh',
  max: 'Max',
};

/** Base URL placeholder per custom API style (ui.md LLM Configuration). */
export const CUSTOM_BASE_URL_PLACEHOLDERS: Record<ApiStyle, string> = {
  openai: 'http://localhost:11434/v1',
  anthropic: 'http://127.0.0.1:8317',
};

/** Base URL hint per custom API style (ui.md LLM Configuration). */
export const CUSTOM_BASE_URL_HINTS: Record<ApiStyle, string> = {
  openai:
    'Include the version path, e.g. http://127.0.0.1:8317/v1; requests use <base URL>/chat/completions.',
  anthropic:
    'Server root, e.g. http://127.0.0.1:8317; requests use <base URL>/v1/messages.',
};

/** Model placeholder per provider (ui.md LLM Configuration). */
export const MODEL_PLACEHOLDERS: Record<LlmProvider, string> = {
  openai: 'gpt-4o-mini',
  anthropic: 'claude-sonnet-5-5',
  lenai: 'my-deployment',
  custom: 'llama3.1:8b',
};

/** Wait after the last keystroke before looking up a model's levels. */
const LEVELS_LOOKUP_DELAY_MS = 250;

@Component({
  selector: 'app-llm-config',
  imports: [LucideAngularModule],
  templateUrl: './llm-config.html',
  styleUrl: './llm-config.scss',
})
export class LlmConfig implements OnInit, OnDestroy {
  readonly Loader2 = Loader2;
  readonly TriangleAlert = TriangleAlert;

  private readonly api = inject(LlmApiService);
  private readonly toast = inject(ToastService);

  readonly provider = signal<LlmProvider>('openai');
  readonly model = signal('');
  readonly apiKey = signal('');
  readonly baseUrl = signal('');
  // Which API a custom endpoint speaks; only sent for provider 'custom'.
  readonly apiStyle = signal<ApiStyle>('openai');
  // The provider and masked key of the saved configuration, if any.
  private readonly savedProvider = signal<LlmProvider | null>(null);
  private readonly savedKeyMasked = signal<string | null>(null);
  private readonly savedBaseUrl = signal('');
  /**
   * The key field's placeholder: the masked saved key when the blank field
   * would reuse it (spec R6, R47), else the provider's hint. A custom
   * endpoint reuses only a key saved with a custom configuration.
   */
  readonly apiKeyPlaceholder = computed(() => {
    const masked = this.savedKeyMasked();
    const savedCustom = this.savedProvider() === 'custom';
    if (this.provider() === 'custom') {
      return masked && savedCustom
        ? masked
        : 'Leave blank if the server needs none';
    }
    return masked && !savedCustom ? masked : 'sk-…';
  });
  readonly modelPlaceholder = computed(
    () => MODEL_PLACEHOLDERS[this.provider()],
  );
  readonly baseUrlPlaceholder = computed(
    () => CUSTOM_BASE_URL_PLACEHOLDERS[this.apiStyle()],
  );
  readonly baseUrlHint = computed(() => CUSTOM_BASE_URL_HINTS[this.apiStyle()]);
  // A key is stored but can't be decrypted (the app secret changed) — the
  // user has to type it again.
  readonly keyUnreadable = signal(false);
  readonly effortLabels = EFFORT_LABELS;
  // The typed model's effort levels (lowest first); empty = no select.
  readonly effortLevels = signal<ReasoningEffort[]>([]);
  readonly reasoningEffort = signal<ReasoningEffort>('high');
  private levelsTimer: ReturnType<typeof setTimeout> | undefined;
  private levelsRequest = 0;

  readonly testing = signal(false);
  readonly saving = signal(false);
  // Only a configuration whose test passed can be saved.
  readonly testedOk = signal(false);

  ngOnInit(): void {
    this.api.getSettings().subscribe({
      next: (saved) => {
        if (!saved.configured && !saved.keyUnreadable) return;
        this.keyUnreadable.set(saved.keyUnreadable === true);
        this.provider.set(saved.provider ?? 'openai');
        this.savedProvider.set(saved.provider);
        this.apiStyle.set(saved.apiStyle ?? 'openai');
        this.model.set(saved.model ?? '');
        this.baseUrl.set(saved.baseUrl ?? '');
        this.savedBaseUrl.set(saved.baseUrl ?? '');
        // The key never travels back in plaintext — empty field + masked
        // placeholder means "stored key is kept unless you type a new one".
        this.savedKeyMasked.set(saved.apiKeyMasked || null);
        this.reasoningEffort.set(saved.reasoningEffort);
        this.lookUpEffortLevels(0);
      },
      error: () => {
        // Backend unreachable — leave the form empty.
      },
    });
  }

  get canTest(): boolean {
    return (
      !this.testing() &&
      this.model().trim() !== '' &&
      (!this.usesBaseUrl || this.baseUrl().trim() !== '')
    );
  }

  /** LenAI and a custom endpoint need a base URL (spec R44); the key stays optional for custom (R47). */
  get usesBaseUrl(): boolean {
    return this.provider() === 'lenai' || this.provider() === 'custom';
  }

  ngOnDestroy(): void {
    clearTimeout(this.levelsTimer);
  }

  /** The select's single option while it is disabled (spec R37). */
  get effortPlaceholder(): string {
    return this.model().trim()
      ? 'Default — not available for this model'
      : 'Default — enter a model first';
  }

  /** The select's hint, also its accessible description (spec R42). */
  get effortHint(): string {
    if (this.effortLevels().length) {
      return 'Used for answers. Test connection always uses the lowest level.';
    }
    return this.model().trim()
      ? "This model doesn't support a reasoning effort setting."
      : 'Enter a model to see the effort levels it supports.';
  }

  /** Editing any field but the effort invalidates the previous successful test. */
  onFieldChange(): void {
    this.testedOk.set(false);
  }

  /**
   * Switches the provider, keeping the typed model. A key typed for a public
   * provider is never carried to a custom endpoint (or back), and LenAI and a
   * custom endpoint don't share a base URL: the saved one comes back when
   * returning to the saved provider.
   */
  setProvider(provider: LlmProvider): void {
    const previous = this.provider();
    if (provider === previous) return;
    this.provider.set(provider);
    if (previous === 'custom' || provider === 'custom') this.apiKey.set('');
    this.baseUrl.set(
      provider === this.savedProvider() ? this.savedBaseUrl() : '',
    );
    this.onFieldChange();
  }

  /** Sets the model (typed, or picked from a loaded list), invalidates the last test and refetches the effort levels. */
  setModel(model: string): void {
    this.model.set(model);
    this.onFieldChange();
    this.lookUpEffortLevels(LEVELS_LOOKUP_DELAY_MS);
  }

  /** The probe ignores the chosen effort, so a passed test still stands. */
  onEffortChange(effort: ReasoningEffort): void {
    this.reasoningEffort.set(effort);
  }

  /**
   * Fetches the typed model's levels and keeps the selected effort when the
   * model accepts it, else selects the model's default. Only the newest
   * lookup applies, so a slow answer for an older model can't win.
   */
  private lookUpEffortLevels(delayMs: number): void {
    clearTimeout(this.levelsTimer);
    const model = this.model().trim();
    if (!model) {
      this.effortLevels.set([]);
      return;
    }
    const request = ++this.levelsRequest;
    this.levelsTimer = setTimeout(() => {
      this.api.effortLevels(model).subscribe({
        next: (view) => {
          if (request !== this.levelsRequest) return;
          this.effortLevels.set(view.levels);
          if (
            view.defaultEffort &&
            !view.levels.includes(this.reasoningEffort())
          ) {
            this.reasoningEffort.set(view.defaultEffort);
          }
        },
        error: () => {
          if (request === this.levelsRequest) this.effortLevels.set([]);
        },
      });
    }, delayMs);
  }

  private payload(): LlmSettings {
    const provider = this.provider();
    return {
      provider,
      model: this.model().trim(),
      // Empty key = backend uses the stored one (or, for custom, none).
      apiKey: this.apiKey().trim() || undefined,
      // Only the providers that use a base URL send one.
      baseUrl: (this.usesBaseUrl && this.baseUrl().trim()) || undefined,
      apiStyle: provider === 'custom' ? this.apiStyle() : undefined,
      // Sent only when the model has levels; otherwise the stored one stays.
      reasoningEffort: this.effortLevels().length
        ? this.reasoningEffort()
        : undefined,
    };
  }

  /** Re-reads the stored provider, base URL and masked key after a save. */
  private refreshSavedKey(): void {
    this.api.getSettings().subscribe({
      next: (saved) => {
        this.savedProvider.set(saved.provider);
        this.savedBaseUrl.set(saved.baseUrl ?? '');
        this.savedKeyMasked.set(saved.apiKeyMasked || null);
      },
      error: () => {
        // Keep the previous view; the save itself already succeeded.
      },
    });
  }

  testConnection(): void {
    if (!this.canTest) return;
    this.testing.set(true);
    this.api.testConnection(this.payload()).subscribe({
      next: (res) => {
        if (res.ok) this.toast.success(res.message);
        else this.toast.error(res.message);
        this.testedOk.set(res.ok);
        this.testing.set(false);
      },
      error: (err) => {
        this.toast.error(err?.error?.message ?? 'Backend unreachable');
        this.testedOk.set(false);
        this.testing.set(false);
      },
    });
  }

  saveConnection(): void {
    if (!this.testedOk() || this.saving()) return;
    this.saving.set(true);
    const payload = this.payload();
    this.api.saveSettings(payload).subscribe({
      next: (res) => {
        if (res.ok) {
          this.toast.success(res.message);
          this.refreshSavedKey();
          this.keyUnreadable.set(false);
        } else {
          this.toast.error(res.message);
        }
        this.saving.set(false);
      },
      error: (err) => {
        this.toast.error(err?.error?.message ?? 'Backend unreachable');
        this.saving.set(false);
      },
    });
  }
}
