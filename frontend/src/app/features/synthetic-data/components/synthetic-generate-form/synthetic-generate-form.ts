import {
  Component,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { LucideAngularModule, Loader2 } from 'lucide-angular';
import { ToastService } from '../../../../core/toast/toast.service';
import {
  DEFAULT_SEED,
  DEFAULT_TARGET_SCHEMA,
  ExportFormat,
  ROWS_PER_TABLE_DEFAULT,
  ROWS_PER_TABLE_MAX,
  SampledProfile,
  ScriptRequest,
} from '../../models/synthetic-data.model';
import {
  FORMAT_OPTIONS,
  generateLabel,
  isWholeBetween,
} from '../../models/synthetic-data.format';
import {
  DownloadError,
  SyntheticDataApiService,
  saveFile,
} from '../../services/synthetic-data-api.service';

const SEED_MAX = 2147483647;
const ROWS_MESSAGE = 'Row counts must be whole numbers from 1 to 10,000';

/** The Generate form of the Profile & synthesize tab (stories 1.22.2, 1.22.5). */
@Component({
  selector: 'app-synthetic-generate-form',
  imports: [LucideAngularModule],
  templateUrl: './synthetic-generate-form.html',
})
export class SyntheticGenerateForm {
  readonly Loader2 = Loader2;
  readonly profile = input.required<SampledProfile>();
  /** The profile is gone from the server cache (404). */
  readonly expired = output<void>();

  private readonly api = inject(SyntheticDataApiService);
  private readonly toast = inject(ToastService);

  readonly formats = FORMAT_OPTIONS;
  readonly seedHint = 'Same profile and seed give the same script.';
  readonly rowsMax = ROWS_PER_TABLE_MAX;

  /** Typed text per table key; a key absent from the map shows the default. */
  readonly rowText = signal<Record<string, string>>({});
  readonly allText = signal(String(ROWS_PER_TABLE_DEFAULT));
  readonly seedText = signal(String(DEFAULT_SEED));
  readonly targetSchema = signal(DEFAULT_TARGET_SCHEMA);
  readonly includeConstraints = signal(true);
  readonly format = signal<ExportFormat>('sql');
  readonly generating = signal(false);
  readonly error = signal<string | null>(null);

  readonly buttonLabel = computed(() => generateLabel(this.format()));

  constructor() {
    // A new profile starts the form over.
    effect(() => {
      this.profile();
      this.rowText.set({});
      this.error.set(null);
    });
  }

  rowValue(key: string): string {
    return this.rowText()[key] ?? String(ROWS_PER_TABLE_DEFAULT);
  }

  private parse(text: string): number {
    return text.trim() === '' ? NaN : Number(text);
  }

  rowInvalid(key: string): boolean {
    return !isWholeBetween(
      this.parse(this.rowValue(key)),
      1,
      ROWS_PER_TABLE_MAX,
    );
  }

  readonly allInvalid = computed(
    () => !isWholeBetween(this.parse(this.allText()), 1, ROWS_PER_TABLE_MAX),
  );
  readonly seedInvalid = computed(
    () => !isWholeBetween(this.parse(this.seedText()), 0, SEED_MAX),
  );
  readonly schemaEmpty = computed(() => this.targetSchema().trim() === '');

  readonly invalid = computed(
    () =>
      this.seedInvalid() ||
      this.schemaEmpty() ||
      this.profile().tables.some((t) => this.rowInvalid(t.key)),
  );
  readonly canGenerate = computed(() => !this.invalid() && !this.generating());

  setRows(key: string, text: string): void {
    this.rowText.update((m) => ({ ...m, [key]: text }));
  }

  applyAll(): void {
    if (this.allInvalid()) return;
    const text = this.allText().trim();
    const next: Record<string, string> = {};
    for (const t of this.profile().tables) next[t.key] = text;
    this.rowText.set(next);
  }

  setFormat(value: string): void {
    this.format.set(value === 'csv' || value === 'xlsx' ? value : 'sql');
  }

  generate(): void {
    if (!this.canGenerate()) return;
    const rowCounts: Record<string, number> = {};
    for (const t of this.profile().tables) {
      rowCounts[t.key] = Number(this.rowValue(t.key));
    }
    const request: ScriptRequest = {
      profileId: this.profile().profileId,
      format: this.format(),
      rowCounts,
      seed: Number(this.seedText()),
      targetSchema: this.targetSchema().trim(),
      includeConstraints: this.includeConstraints(),
    };
    this.error.set(null);
    this.generating.set(true);
    this.api.script(request).subscribe({
      next: (file) => {
        this.generating.set(false);
        saveFile(file);
        this.toast.success(`Downloaded ${file.fileName}`);
      },
      error: (err: DownloadError) => {
        this.generating.set(false);
        if (err.status === 404) this.expired.emit();
        else this.error.set(err.message);
      },
    });
  }

  readonly rowsMessage = ROWS_MESSAGE;
}
