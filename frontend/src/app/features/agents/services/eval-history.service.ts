import { Injectable, computed, inject, signal } from '@angular/core';
import { AgentsApiService } from './agents-api.service';
import type {
  EvalHarness,
  EvalRunLogRecordV2,
  RunLogSummary,
} from '../models/eval.model';

/**
 * Signals store behind the History sub-tab (`eval-log-history`): the run-log
 * index (`GET /evals/logs`), the filters it is browsed through, the A/B pair
 * picked for Compare, and a small cache of full records so re-opening a row
 * or re-running the same compare does not re-fetch it.
 *
 * `providedIn: 'root'` like `EvalSelectionService` — one instance for the
 * app, reset explicitly when the agent key changes (`reset()`).
 */
@Injectable({ providedIn: 'root' })
export class EvalHistoryService {
  private readonly api = inject(AgentsApiService);

  readonly logs = signal<RunLogSummary[]>([]);
  /** The log directories the backend actually read from (footnote text). */
  readonly dirs = signal<string[]>([]);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);
  private loadedForKey: string | null = null;

  /** '' = no filter on that dimension. */
  readonly suiteFilter = signal('');
  readonly armFilter = signal('');
  readonly harnessFilter = signal<EvalHarness | ''>('');
  readonly modelFilter = signal('');

  /** The two runs picked for Compare, by their `file` name. */
  readonly selectedA = signal<string | null>(null);
  readonly selectedB = signal<string | null>(null);

  /** The run currently expanded in the History list. */
  readonly openedFile = signal<string | null>(null);
  readonly openedRecord = signal<EvalRunLogRecordV2 | null>(null);
  readonly openLoading = signal(false);
  readonly openError = signal<string | null>(null);

  private readonly recordCache = new Map<string, EvalRunLogRecordV2>();

  /** Distinct filter values actually present in the loaded index, so the pickers never offer a dead option. */
  readonly suites = computed(() => distinct(this.logs().map((l) => l.suite)));
  readonly arms = computed(() =>
    distinct(this.logs().map((l) => l.arm ?? '').filter(Boolean)),
  );
  readonly harnesses = computed(
    () =>
      distinct(
        this.logs()
          .map((l) => l.harness as string | undefined)
          .filter((h): h is string => !!h),
      ) as EvalHarness[],
  );
  readonly models = computed(() =>
    distinct(this.logs().map((l) => l.model ?? '').filter(Boolean)),
  );

  readonly filteredLogs = computed(() => {
    const suite = this.suiteFilter();
    const arm = this.armFilter();
    const harness = this.harnessFilter();
    const model = this.modelFilter();
    return this.logs().filter(
      (log) =>
        (!suite || log.suite === suite) &&
        (!arm || (log.arm ?? '') === arm) &&
        (!harness || log.harness === harness) &&
        (!model || log.model === model),
    );
  });

  readonly canCompare = computed(() => {
    const a = this.selectedA();
    const b = this.selectedB();
    return !!a && !!b && a !== b;
  });

  /** Fetch the index for `agentKey`; a no-op when it is already loaded, unless `force`. */
  load(agentKey: string, force = false): void {
    if (!force && this.loadedForKey === agentKey && this.logs().length > 0) {
      return;
    }
    this.loadedForKey = agentKey;
    this.loading.set(true);
    this.error.set(null);
    this.api.listRunLogs(agentKey).subscribe({
      next: (res) => {
        this.logs.set(res.logs ?? []);
        this.dirs.set(res.dirs ?? []);
        this.loading.set(false);
      },
      error: (err) => {
        this.logs.set([]);
        this.dirs.set([]);
        this.error.set(err?.error?.message ?? 'Backend unreachable');
        this.loading.set(false);
      },
    });
  }

  /** Clears every piece of state — called when the agent key changes, so one agent's picks never leak into another's. */
  reset(): void {
    this.loadedForKey = null;
    this.logs.set([]);
    this.dirs.set([]);
    this.loading.set(false);
    this.error.set(null);
    this.suiteFilter.set('');
    this.armFilter.set('');
    this.harnessFilter.set('');
    this.modelFilter.set('');
    this.selectedA.set(null);
    this.selectedB.set(null);
    this.openedFile.set(null);
    this.openedRecord.set(null);
    this.openLoading.set(false);
    this.openError.set(null);
    this.recordCache.clear();
  }

  /**
   * Toggle one row into the A/B compare pair: fills A, then B; re-clicking a
   * picked row clears it; a third pick replaces A with B and takes B's slot
   * itself, so the two most recently picked rows are always what compares.
   */
  toggleCompareSelection(file: string): void {
    const a = this.selectedA();
    const b = this.selectedB();
    if (a === file) {
      this.selectedA.set(null);
      return;
    }
    if (b === file) {
      this.selectedB.set(null);
      return;
    }
    if (!a) {
      this.selectedA.set(file);
      return;
    }
    if (!b) {
      this.selectedB.set(file);
      return;
    }
    this.selectedA.set(b);
    this.selectedB.set(file);
  }

  clearCompareSelection(): void {
    this.selectedA.set(null);
    this.selectedB.set(null);
  }

  /** Open one run's full record — from cache when it was already fetched this session. */
  openLog(agentKey: string, file: string): void {
    this.openedFile.set(file);
    const cached = this.recordCache.get(file);
    if (cached) {
      this.openedRecord.set(cached);
      this.openError.set(null);
      return;
    }
    this.openLoading.set(true);
    this.openError.set(null);
    this.api.getRunLog(agentKey, file).subscribe({
      next: (res) => {
        this.openLoading.set(false);
        if (!res.ok || !res.record) {
          this.openError.set(res.message ?? 'Could not load this run');
          this.openedRecord.set(null);
          return;
        }
        this.recordCache.set(file, res.record);
        this.openedRecord.set(res.record);
      },
      error: (err) => {
        this.openLoading.set(false);
        this.openError.set(err?.error?.message ?? 'Backend unreachable');
        this.openedRecord.set(null);
      },
    });
  }

  closeLog(): void {
    this.openedFile.set(null);
    this.openedRecord.set(null);
    this.openError.set(null);
  }
}

function distinct(values: readonly string[]): string[] {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b));
}
