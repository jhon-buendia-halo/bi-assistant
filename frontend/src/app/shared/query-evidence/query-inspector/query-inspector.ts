import {
  Component,
  ElementRef,
  afterNextRender,
  computed,
  effect,
  inject,
  input,
  linkedSignal,
  output,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import {
  ChevronLeft,
  ChevronRight,
  Copy,
  Download,
  LucideAngularModule,
  RefreshCw,
  X,
} from 'lucide-angular';
import { ToastService } from '../../../core/toast/toast.service';
import { ChatMessage } from '../../../features/sessions/models/session.model';
import {
  QUERY_EVIDENCE_API,
  QueryEvidence,
  QueryRerunResult,
  QueryStep,
  QueryStepVerb,
} from '../query-evidence.model';
import { coverageChip, formatCount, queryLabel } from '../query-labels';
import { QueryResult } from '../query-result/query-result';
import { csvBlob, saveBlob } from '../rows-csv';

export type InspectorTab = 'steps' | 'result' | 'sql';

const TABS: InspectorTab[] = ['steps', 'result', 'sql'];

const VERB_LABELS: Record<QueryStepVerb, string> = {
  start: 'Start from',
  keep: 'Keep',
  add: 'Add',
  combine: 'Combine',
  group: 'Group',
  count: 'Count',
  compute: 'Compute',
  sort: 'Sort',
  show: 'Show',
};

const KIND_LABELS: Record<string, string> = {
  postgres: 'PostgreSQL',
  postgresql: 'PostgreSQL',
  databricks: 'Databricks SQL',
  rest: 'REST API',
};

interface FunnelStep {
  step: QueryStep;
  number: number;
  label: string;
  /** The words after the label. */
  text: string;
  /** The count on the right, or null when the step has none. */
  count: string | null;
  tint: boolean;
}

function errorText(err: unknown): string {
  const e = err as { error?: { message?: string }; message?: string } | null;
  return e?.error?.message ?? e?.message ?? 'Backend unreachable';
}

function rowsLabel(count: number): string {
  return `${formatCount(count)} ${count === 1 ? 'row' : 'rows'}`;
}

/**
 * The query inspector (ui.md 4.12.2): one query of an answer as steps, result
 * and SQL, with download, re-run and copy. It reads the answer it is given and
 * asks its host, through `QUERY_EVIDENCE_API`, for everything that changes the
 * stored answer; the host then passes the updated answer back in.
 */
@Component({
  selector: 'app-query-inspector',
  imports: [LucideAngularModule, QueryResult],
  templateUrl: './query-inspector.html',
  host: {
    class: 'flex h-full min-h-0 flex-col bg-surface',
    role: 'dialog',
    'aria-modal': 'false',
    'data-testid': 'query-inspector',
    '[attr.aria-label]': 'title()',
    '(keydown.escape)': 'close.emit()',
  },
})
export class QueryInspector {
  protected readonly ChevronLeft = ChevronLeft;
  protected readonly ChevronRight = ChevronRight;
  protected readonly Copy = Copy;
  protected readonly Download = Download;
  protected readonly RefreshCw = RefreshCw;
  protected readonly X = X;
  protected readonly tabs = TABS;

  private readonly api = inject(QUERY_EVIDENCE_API);
  private readonly toast = inject(ToastService);

  /** The answer. */
  readonly message = input.required<ChatMessage>();
  /** The query shown: an index into the answer's `data`. */
  readonly index = input.required<number>();
  readonly close = output<void>();
  /** Another query of the answer was picked (Previous, Next). */
  readonly navigate = output<number>();

  private readonly closeButton =
    viewChild<ElementRef<HTMLButtonElement>>('closeButton');

  /** The tab shown; another query opens on Step by step. */
  readonly tab = linkedSignal<number, InspectorTab>({
    source: this.index,
    computation: () => 'steps',
  });
  /** The re-run's rows, once run; another query forgets it. */
  protected readonly rerun = linkedSignal<number, QueryRerunResult | null>({
    source: this.index,
    computation: () => null,
  });
  protected readonly showRerun = linkedSignal<number, boolean>({
    source: this.index,
    computation: () => false,
  });
  protected readonly rerunning = signal(false);
  protected readonly counting = signal(false);
  /** The step explanation that failed, for the query it failed on. */
  protected readonly explainError = signal<{
    index: number;
    message: string;
  } | null>(null);
  private readonly explainRequested = new Set<number>();

  protected readonly total = computed(() => this.message().data?.length ?? 0);
  protected readonly record = computed(
    () => this.message().data?.[this.index()] ?? null,
  );
  protected readonly evidence = computed<QueryEvidence | null>(
    () => this.message().evidence?.find((e) => e.index === this.index()) ?? null,
  );
  protected readonly failed = computed(() => !!this.record()?.error);
  protected readonly label = computed(() => queryLabel(this.index()));
  protected readonly position = computed(
    () => `Query ${this.index() + 1} of ${this.total()}`,
  );
  readonly title = computed(
    () => this.record()?.rationale?.trim() || `Query ${this.index() + 1}`,
  );
  protected readonly sql = computed(() => this.record()?.input ?? '');

  protected readonly meta = computed(() => {
    const kind = this.evidence()?.datasourceKind;
    const parts: string[] = [];
    if (kind) parts.push(KIND_LABELS[kind.toLowerCase()] ?? kind);
    const count = this.record()?.rowCount;
    if (!this.failed() && count !== undefined) parts.push(rowsLabel(count));
    return parts.join(' · ');
  });

  protected readonly storedRows = computed(() => this.record()?.rows ?? []);
  /** All rows of the stored result, when known. */
  private readonly storedTotal = computed<number | null>(() => {
    const record = this.record();
    return this.evidence()?.totalRows ?? record?.rowCount ?? null;
  });
  protected readonly resultTabLabel = computed(() => {
    const count = this.record()?.rowCount;
    return count === undefined || this.failed()
      ? 'Result'
      : `Result (${rowsLabel(count)})`;
  });

  /** The rows the Result tab shows: the re-run's on request, else the stored ones. */
  protected readonly shownRows = computed(() => {
    const rerun = this.rerun();
    return this.showRerun() && rerun !== null ? rerun.rows : this.storedRows();
  });
  private readonly storedColumns = computed(() => {
    const record = this.record();
    return record?.columns ?? Object.keys(record?.rows?.[0] ?? {});
  });
  protected readonly columns = computed(() => {
    const rerun = this.rerun();
    return this.showRerun() && rerun !== null ? rerun.columns : this.storedColumns();
  });
  protected readonly resultNote = computed(() => {
    const rerun = this.rerun();
    const rerunning = this.showRerun() && rerun !== null;
    const total = rerunning
      ? (rerun.totalRows ?? rerun.rowCount)
      : this.storedTotal();
    const shown = this.shownRows().length;
    if (total === null || shown >= total) return null;
    return `Showing the first ${formatCount(shown)} of ${formatCount(total)} rows. Download all rows for the rest.`;
  });
  /** A sample has no full result to page; the others do. */
  protected readonly pageable = computed(
    () => this.record()?.tool !== 'sample_rows' && this.sql() !== '',
  );
  /** The stored result's size for the pager before the first page is asked. */
  protected readonly pagingTotal = computed(() =>
    this.showRerun() && this.rerun() !== null ? null : this.storedTotal(),
  );
  /** The row count of a top-n query: the page view says it pages past it. */
  protected readonly topN = computed(() =>
    this.evidence()?.coverage === 'top-n'
      ? (this.evidence()?.outerLimit ?? this.record()?.rowCount ?? null)
      : null,
  );
  protected readonly rerunBanner = computed(() => {
    const rerun = this.rerun();
    if (!this.showRerun() || rerun === null) return null;
    const at = new Date(rerun.ranAt);
    const time = Number.isNaN(at.getTime())
      ? rerun.ranAt
      : at.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
    const written = this.record()?.rowCount ?? this.storedRows().length;
    return `Re-run at ${time}: ${rowsLabel(rerun.rowCount)}. The answer was written from ${rowsLabel(written)}.`;
  });
  protected readonly hasRerunResult = computed(() => this.rerun() !== null);

  protected readonly explanation = computed(
    () => this.evidence()?.explanation ?? null,
  );
  protected readonly verified = computed(
    () => this.explanation()?.stageCounts?.status === 'verified',
  );
  protected readonly unverified = computed(
    () => this.explanation()?.stageCounts?.status === 'unverified',
  );
  /** The button asks to count only when some step has a statement to run. */
  protected readonly canCount = computed(() => {
    const explanation = this.explanation();
    return (
      explanation !== null &&
      explanation.stageCounts === undefined &&
      explanation.steps.some((step) => !!step.countSql)
    );
  });
  protected readonly funnel = computed<FunnelStep[]>(() => {
    const explanation = this.explanation();
    if (explanation === null) return [];
    const verified = this.verified();
    const before = explanation.steps.filter((s) => s.verb !== 'show');
    const lastBefore = [...before].reverse().find((s) => s.rows !== undefined)?.rows;
    return explanation.steps.map((step, i) => {
      let count: string | null = null;
      if (step.rows !== undefined) {
        if (step.verb === 'show') {
          count =
            verified && lastBefore !== undefined && lastBefore > step.rows
              ? `${formatCount(step.rows)} of ${formatCount(lastBefore)}`
              : rowsLabel(step.rows);
        } else {
          const unit = step.unit ?? 'rows';
          count = `${formatCount(step.rows)} ${step.rows === 1 && unit === 'rows' ? 'row' : unit}`;
        }
      }
      return {
        step,
        number: i + 1,
        label: VERB_LABELS[step.verb] ?? step.verb,
        // The Show step's text is written whole by code ("Show the first 100").
        text: step.verb === 'show' ? step.text.replace(/^Show\s+/, '') : step.text,
        count,
        tint: step.verb === 'show',
      };
    });
  });
  protected readonly stepsError = computed(() => {
    const error = this.explainError();
    return error !== null && error.index === this.index() ? error.message : null;
  });

  protected readonly canRerun = computed(
    () =>
      !this.failed() && this.record()?.tool !== 'sample_rows' && this.sql() !== '',
  );
  protected readonly downloadLabel = computed(() => {
    const record = this.record();
    const known = this.evidence()?.totalRows ?? (record?.truncated ? undefined : record?.rowCount);
    return known !== undefined
      ? known === 1
        ? 'Download the row (CSV)'
        : `Download all ${formatCount(known)} rows (CSV)`
      : 'Download all rows (CSV)';
  });
  protected readonly coverageLabel = computed(() => {
    const coverage = this.failed() ? 'failed' : this.evidence()?.coverage;
    return coverage
      ? coverageChip(coverage, this.evidence() ?? undefined).label
      : null;
  });

  constructor() {
    afterNextRender(() => this.closeButton()?.nativeElement.focus());
    // The steps are explained when the tab is first shown for a query with none yet.
    effect(() => {
      const index = this.index();
      const needs =
        this.tab() === 'steps' &&
        !this.failed() &&
        this.evidence() !== null &&
        this.explanation() === null;
      if (!needs) return;
      untracked(() => {
        if (this.explainRequested.has(index)) return;
        this.explainRequested.add(index);
        this.explain(index);
      });
    });
  }

  /** Ask the host to explain the query; `Try again` asks again. */
  protected explain(index = this.index()): void {
    this.explainError.set(null);
    this.api.explain(index).subscribe({
      error: (err) =>
        this.explainError.set({ index, message: errorText(err) }),
    });
  }

  protected selectTab(tab: InspectorTab): void {
    this.tab.set(tab);
  }

  /** Arrow keys move between the tabs (a roving tabindex). */
  protected onTabKey(event: KeyboardEvent): void {
    const step =
      event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
    if (step === 0) return;
    event.preventDefault();
    const next = TABS[(TABS.indexOf(this.tab()) + step + TABS.length) % TABS.length];
    this.tab.set(next);
    queueMicrotask(() =>
      (event.currentTarget as HTMLElement)
        .querySelector<HTMLElement>(`[data-testid="query-inspector-tab-${next}"]`)
        ?.focus(),
    );
  }

  protected tabLabel(tab: InspectorTab): string {
    return tab === 'steps'
      ? 'Step by step'
      : tab === 'result'
        ? this.resultTabLabel()
        : 'SQL';
  }

  protected countSteps(): void {
    if (this.counting()) return;
    this.counting.set(true);
    this.api.countStages(this.index()).subscribe({
      next: () => this.counting.set(false),
      error: (err) => {
        this.counting.set(false);
        this.toast.error(errorText(err));
      },
    });
  }

  protected runAgain(): void {
    if (this.rerunning()) return;
    const index = this.index();
    this.rerunning.set(true);
    this.api.rerun(index).subscribe({
      next: (result) => {
        this.rerunning.set(false);
        if (this.index() !== index) return;
        this.rerun.set(result);
        this.showRerun.set(true);
        this.tab.set('result');
      },
      error: (err) => {
        this.rerunning.set(false);
        this.toast.error(errorText(err));
      },
    });
  }

  protected showStoredRows(): void {
    this.showRerun.set(false);
  }

  /** In the browser when the stored rows are the complete result; else the server's CSV. */
  protected download(): void {
    const record = this.record();
    if (record === null) return;
    const fileName = `query-${this.label()}.csv`;
    const rows = record.rows ?? [];
    const complete =
      this.evidence()?.coverage === 'whole-table' &&
      rows.length === (this.evidence()?.totalRows ?? record.rowCount);
    if (complete) {
      saveBlob(csvBlob(this.storedColumns(), rows), fileName);
      return;
    }
    this.api.downloadCsv(this.index()).subscribe({
      next: (blob) => saveBlob(blob, fileName),
      error: (err) => this.toast.error(errorText(err)),
    });
  }

  protected copySql(): void {
    void window.navigator.clipboard.writeText(this.sql()).then(
      () => this.toast.success('SQL copied to clipboard'),
      () => this.toast.error('Copy failed'),
    );
  }

  protected cell(value: unknown): string {
    if (value === null || value === undefined) return '';
    return typeof value === 'object' ? JSON.stringify(value) : String(value);
  }
}
