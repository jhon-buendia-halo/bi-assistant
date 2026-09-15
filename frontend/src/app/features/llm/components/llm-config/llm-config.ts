import { Component, OnInit, inject, signal } from '@angular/core';
import { LucideAngularModule, Loader2 } from 'lucide-angular';
import { LlmApiService } from '../../services/llm-api.service';
import { LlmProvider } from '../../models/llm.model';
import { ToastService } from '../../../../core/toast/toast.service';

@Component({
  selector: 'app-llm-config',
  imports: [LucideAngularModule],
  templateUrl: './llm-config.html',
  styleUrl: './llm-config.scss',
})
export class LlmConfig implements OnInit {
  readonly Loader2 = Loader2;

  private readonly api = inject(LlmApiService);
  private readonly toast = inject(ToastService);

  readonly provider = signal<LlmProvider>('openai');
  readonly model = signal('');
  readonly apiKey = signal('');
  readonly baseUrl = signal('');
  // Placeholder for the key field when a key is already stored (masked view).
  readonly apiKeyPlaceholder = signal('sk-…');

  readonly testing = signal(false);
  readonly saving = signal(false);
  // Only a configuration whose test passed can be saved.
  readonly testedOk = signal(false);

  ngOnInit(): void {
    this.api.getSettings().subscribe({
      next: (saved) => {
        if (!saved.configured) return;
        this.provider.set(saved.provider ?? 'openai');
        this.model.set(saved.model ?? '');
        this.baseUrl.set(saved.baseUrl ?? '');
        // The key never travels back in plaintext — empty field + masked
        // placeholder means "stored key is kept unless you type a new one".
        if (saved.apiKeyMasked) this.apiKeyPlaceholder.set(saved.apiKeyMasked);
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

  onFieldChange(): void {
    // Editing invalidates the previous successful test.
    this.testedOk.set(false);
  }

  private payload() {
    return {
      provider: this.provider(),
      model: this.model().trim(),
      // Empty key = backend uses the stored one.
      apiKey: this.apiKey().trim() || undefined,
      baseUrl: this.baseUrl().trim() || undefined,
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
        if (res.ok) this.toast.success(res.message);
        else this.toast.error(res.message);
        this.saving.set(false);
      },
      error: (err) => {
        this.toast.error(err?.error?.message ?? 'Backend unreachable');
        this.saving.set(false);
      },
    });
  }
}
