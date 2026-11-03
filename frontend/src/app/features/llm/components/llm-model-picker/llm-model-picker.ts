import {
  Component,
  HostListener,
  effect,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { LucideAngularModule, List, Loader2 } from 'lucide-angular';
import { ToastService } from '../../../../core/toast/toast.service';
import { ApiStyle } from '../../models/llm.model';
import { LlmModelsApiService } from '../../services/llm-models-api.service';

/**
 * "Load models" for the Custom endpoint provider (llm-settings R48, ui.md
 * LLM Configuration). Lists the endpoint's model ids under the model field;
 * picking one emits `modelChosen`. The model field itself stays free text and
 * lives in the form. The menu is positioned against the nearest positioned
 * ancestor, so the form wraps the model input and this picker in a
 * `relative` row and the menu takes that row's width.
 */
@Component({
  selector: 'app-llm-model-picker',
  imports: [LucideAngularModule],
  templateUrl: './llm-model-picker.html',
})
export class LlmModelPicker {
  readonly List = List;
  readonly Loader2 = Loader2;

  private readonly api = inject(LlmModelsApiService);
  private readonly toast = inject(ToastService);

  /** The form's current values; a blank key means "use the stored one". */
  readonly apiStyle = input.required<ApiStyle>();
  readonly baseUrl = input('');
  readonly apiKey = input('');

  readonly modelChosen = output<string>();

  readonly loading = signal(false);
  /** The loaded ids; null = nothing loaded (or discarded). */
  readonly models = signal<string[] | null>(null);
  readonly open = signal(false);
  private request = 0;

  constructor() {
    // Editing API style, base URL or key discards a loaded list and any
    // answer still on its way (ui.md).
    effect(() => {
      this.apiStyle();
      this.baseUrl();
      this.apiKey();
      this.request++;
      this.loading.set(false);
      this.models.set(null);
      this.open.set(false);
    });
  }

  get canLoad(): boolean {
    return !this.loading() && this.baseUrl().trim() !== '';
  }

  load(): void {
    if (!this.canLoad) return;
    const request = ++this.request;
    this.loading.set(true);
    this.open.set(false);
    const apiKey = this.apiKey().trim();
    this.api
      .listModels({
        provider: 'custom',
        apiStyle: this.apiStyle(),
        baseUrl: this.baseUrl().trim(),
        // Blank key = the backend uses the stored one.
        ...(apiKey ? { apiKey } : {}),
      })
      .subscribe({
        next: (res) => {
          if (request !== this.request) return;
          this.loading.set(false);
          if (res.ok) {
            this.models.set(res.models);
            this.open.set(true);
          } else {
            this.models.set(null);
            this.toast.error(res.message);
          }
        },
        error: (err) => {
          if (request !== this.request) return;
          this.loading.set(false);
          this.models.set(null);
          // A validation 400 may carry several messages as an array.
          const message: unknown = err?.error?.message;
          this.toast.error(
            Array.isArray(message)
              ? message.join('; ')
              : typeof message === 'string' && message
                ? message
                : 'Backend unreachable',
          );
        },
      });
  }

  choose(model: string): void {
    this.modelChosen.emit(model);
    this.open.set(false);
  }

  close(): void {
    this.open.set(false);
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    this.close();
  }
}
