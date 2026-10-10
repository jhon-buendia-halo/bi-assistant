import { Component, OnDestroy, OnInit, inject, signal } from '@angular/core';
import { LucideAngularModule, Loader2, TriangleAlert } from 'lucide-angular';
import { LlmApiService } from '../../services/llm-api.service';
import { LlmProvider, ReasoningEffort } from '../../models/llm.model';
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
  // Placeholder for the key field when a key is already stored (masked view).
  readonly apiKeyPlaceholder = signal('sk-…');
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
        this.model.set(saved.model ?? '');
        this.baseUrl.set(saved.baseUrl ?? '');
        // The key never travels back in plaintext — empty field + masked
        // placeholder means "stored key is kept unless you type a new one".
        if (saved.apiKeyMasked) this.apiKeyPlaceholder.set(saved.apiKeyMasked);
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
      (this.provider() !== 'lenai' || this.baseUrl().trim() !== '')
    );
  }

  ngOnDestroy(): void {
    clearTimeout(this.levelsTimer);
  }

  onFieldChange(): void {
    // Editing invalidates the previous successful test.
    this.testedOk.set(false);
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

  private payload() {
    return {
      provider: this.provider(),
      model: this.model().trim(),
      // Empty key = backend uses the stored one.
      apiKey: this.apiKey().trim() || undefined,
      baseUrl: this.baseUrl().trim() || undefined,
      // Sent only when the model has levels; otherwise the stored one stays.
      reasoningEffort: this.effortLevels().length
        ? this.reasoningEffort()
        : undefined,
    };
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
    this.api.saveSettings(this.payload()).subscribe({
      next: (res) => {
        if (res.ok) {
          this.toast.success(res.message);
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
