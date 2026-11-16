import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  linkedSignal,
  signal,
  untracked,
} from '@angular/core';
import {
  FILTER_OPS,
  FILTER_OP_LABELS,
  FilterOp,
  FilterSpec,
  FilterValue,
  PAGE_MAX_ROWS,
  PAGE_SIZE_DEFAULT,
  PageRequest,
  PageResult,
  QUERY_EVIDENCE_API,
  ResultView,
  SortSpec,
} from '../query-evidence.model';
import { formatCount } from '../query-labels';

const NO_VALUE_OPS: FilterOp[] = ['is_null', 'not_null'];
const LIST_OPS: FilterOp[] = ['in', 'not_in'];

function errorText(err: unknown): string {
  const e = err as { error?: { message?: string }; message?: string } | null;
  return e?.error?.message ?? e?.message ?? 'Backend unreachable';
}

/**
 * The Result tab's table with its pager, sortable headers and column filters
 * (ui.md 4.12.2, agent-answers R76 and R79 to R81). It shows the rows it is
 * given until the reader pages, sorts or filters; then it asks the host's
 * `api.page` and shows the page that comes back.
 */
@Component({
  selector: 'app-query-result',
  templateUrl: './query-result.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'flex min-h-0 flex-col gap-2' },
})
export class QueryResult {
  private readonly api = inject(QUERY_EVIDENCE_API);

  /** The query shown: an index into the answer's `data`. */
  readonly index = input.required<number>();
  /** The rows the answer was written from (or a re-run's). */
  readonly columns = input.required<string[]>();
  readonly rows = input.required<Record<string, unknown>[]>();
  /** Today's note on the stored rows, when they are a part. */
  readonly note = input<string | null>(null);
  /** False for a sample: it has no full result to page. */
  readonly pageable = input(true);
  /** All rows of the stored result, when known. */
  readonly total = input<number | null>(null);
  /** The row count of a `top-n` query (its LIMIT); null for other coverage. */
  readonly topN = input<number | null>(null);

  /** The view an explore record opens on (agent-answers R83). */
  readonly view = input<ResultView | null>(null);

  protected readonly ops = FILTER_OPS;
  protected readonly opLabels = FILTER_OP_LABELS;

  /** Another query, or other stored rows, starts over. */
  private readonly source = computed(
    () => `${this.index()}|${this.rows().length}|${this.columns().join(',')}`,
  );
  protected readonly result = linkedSignal<string, PageResult | null>({
    source: this.source,
    computation: () => null,
  });
  protected readonly filters = linkedSignal<string, FilterSpec[]>({
    source: this.source,
    computation: () => [],
  });
  protected readonly sort = linkedSignal<string, SortSpec[]>({
    source: this.source,
    computation: () => [],
  });
  protected readonly error = linkedSignal<string, string | null>({
    source: this.source,
    computation: () => null,
  });
  protected readonly textError = linkedSignal<string, string | null>({
    source: this.source,
    computation: () => null,
  });
  protected readonly understood = linkedSignal<string, string | null>({
    source: this.source,
    computation: () => null,
  });
  protected readonly rejected = linkedSignal<string, string[]>({
    source: this.source,
    computation: () => [],
  });
  protected readonly interpreting = signal(false);
  protected readonly draftText = signal('');
  protected readonly loading = signal(false);
  protected readonly adding = signal(false);
  private lastRequest: PageRequest | null = null;

  protected readonly draftColumn = signal('');
  protected readonly draftOp = signal<FilterOp>('eq');
  protected readonly draftValue = signal('');
  protected readonly draftValueTo = signal('');

  protected readonly shownColumns = computed(
    () => this.result()?.columns ?? this.columns(),
  );
  protected readonly shownRows = computed(
    () => this.result()?.rows ?? this.rows(),
  );
  protected readonly filtered = computed(() => this.filters().length > 0);
  protected readonly page = computed(() => this.result()?.page ?? 1);
  protected readonly pageSize = computed(
    () => this.result()?.pageSize ?? PAGE_SIZE_DEFAULT,
  );

  protected readonly canPrevious = computed(
    () => !this.loading() && this.result() !== null && this.page() > 1,
  );
  protected readonly canNext = computed(() => {
    if (this.loading()) return false;
    const result = this.result();
    if (result === null) {
      const total = this.total();
      return total === null || total > this.rows().length;
    }
    return result.page < result.pageCount;
  });

  protected readonly pageLabel = computed(() => {
    const result = this.result();
    if (result !== null) {
      if (result.rows.length === 0) return '';
      const from = (result.page - 1) * result.pageSize + 1;
      const to = from + result.rows.length - 1;
      const count = `${formatCount(result.matchedRows)}${result.capped ? '+' : ''}`;
      return `Rows ${formatCount(from)}–${formatCount(to)} of ${count}${this.filtered() ? ' matching' : ''}`;
    }
    const shown = this.rows().length;
    if (shown === 0) return '';
    const total = this.total();
    return total === null
      ? `Rows 1–${formatCount(shown)}`
      : `Rows 1–${formatCount(shown)} of ${formatCount(total)}`;
  });
  protected readonly rejectedText = computed(() =>
    this.rejected().length === 0
      ? null
      : `Ignored: ${this.rejected().join('; ')}`,
  );
  protected readonly canInterpret = computed(
    () =>
      !this.interpreting() && !this.loading() && this.draftText().trim() !== '',
  );
  /** "Page 2 of 41 · Country is Brazil · sorted by Goals, high to low" */
  protected readonly viewNote = computed(() => {
    const result = this.result();
    if (this.view() === null || result === null) return null;
    const parts = [`Page ${formatCount(result.page)} of ${formatCount(result.pageCount)}`];
    for (const filter of this.filters()) parts.push(this.filterText(filter));
    const sort = this.sort();
    if (sort.length > 0) {
      parts.push(
        'sorted by ' +
          sort
            .map(
              (s) =>
                `${s.column}, ${s.direction === 'desc' ? 'high to low' : 'low to high'}`,
            )
            .join('; '),
      );
    }
    return parts.join(' · ');
  });
  protected readonly capNote = computed(() => this.result()?.capped === true);
  protected readonly topNNote = computed(() => {
    const n = this.topN();
    return this.result() !== null && n !== null
      ? `Paging the full result, not only the top ${formatCount(n)} the answer used`
      : null;
  });
  protected readonly capText = `Paging stops at ${formatCount(PAGE_MAX_ROWS)} rows. Add a filter to narrow the result.`;

  protected readonly chips = computed(() =>
    this.filters().map((filter) => ({ filter, text: this.filterText(filter) })),
  );
  protected readonly needsValue = computed(
    () => !NO_VALUE_OPS.includes(this.draftOp()),
  );
  protected readonly needsValueTo = computed(() => this.draftOp() === 'between');
  private readonly effectiveDraftColumn = computed(
    () => this.draftColumn() || this.shownColumns()[0] || '',
  );
  protected readonly selectedColumn = this.effectiveDraftColumn;
  protected readonly canApply = computed(() => {
    if (this.loading()) return false;
    if (this.effectiveDraftColumn() === '') return false;
    if (!this.needsValue()) return true;
    if (this.draftValue().trim() === '') return false;
    return !this.needsValueTo() || this.draftValueTo().trim() !== '';
  });

  constructor() {
    // An explore record opens on its view: request that page at once.
    effect(() => {
      const view = this.view();
      this.source();
      untracked(() => {
        if (view === null || !this.pageable()) return;
        this.filters.set(view.filters);
        this.sort.set(view.sort);
        this.send({
          page: view.page,
          pageSize: view.pageSize,
          filters: view.filters,
          sort: view.sort,
        });
      });
    });
  }

  protected sortState(column: string): 'ascending' | 'descending' | 'none' {
    const sort = this.sort().find((s) => s.column === column);
    return sort === undefined
      ? 'none'
      : sort.direction === 'asc'
        ? 'ascending'
        : 'descending';
  }

  protected toggleSort(column: string): void {
    const state = this.sortState(column);
    const sort: SortSpec[] =
      state === 'none'
        ? [{ column, direction: 'asc' }]
        : state === 'ascending'
          ? [{ column, direction: 'desc' }]
          : [];
    this.sort.set(sort);
    this.load(1);
  }

  protected previous(): void {
    this.load(this.page() - 1);
  }

  protected next(): void {
    this.load(this.page() + 1);
  }

  protected openFilter(): void {
    this.adding.set(true);
    this.draftColumn.set(this.shownColumns()[0] ?? '');
    this.draftOp.set('eq');
    this.draftValue.set('');
    this.draftValueTo.set('');
  }

  protected cancelFilter(): void {
    this.adding.set(false);
  }

  protected applyFilter(): void {
    if (!this.canApply()) return;
    const column = this.effectiveDraftColumn();
    const op = this.draftOp();
    const filter: FilterSpec = { column, op };
    if (LIST_OPS.includes(op)) {
      filter.values = this.draftValue()
        .split(',')
        .map((v) => v.trim())
        .filter((v) => v !== '')
        .map((v) => this.coerce(column, v));
    } else if (this.needsValue()) {
      filter.value = this.coerce(column, this.draftValue().trim());
      if (op === 'between') {
        filter.valueTo = this.coerce(column, this.draftValueTo().trim());
      }
    }
    this.filters.update((all) => [...all, filter]);
    this.adding.set(false);
    this.load(1);
  }

  protected removeFilter(index: number): void {
    this.filters.update((all) => all.filter((_, i) => i !== index));
    this.load(1);
  }

  protected clearFilters(): void {
    this.filters.set([]);
    this.load(1);
  }

  protected interpret(): void {
    if (!this.canInterpret()) return;
    const index = this.index();
    this.interpreting.set(true);
    this.textError.set(null);
    this.api
      .interpretFilter(index, this.draftText().trim(), this.currentView())
      .subscribe({
        next: (interpretation) => {
          this.interpreting.set(false);
          if (this.index() !== index) return;
          const request = interpretation.request;
          this.filters.set(request.filters ?? []);
          this.sort.set(request.sort ?? []);
          this.understood.set(interpretation.understood);
          this.rejected.set(interpretation.rejected ?? []);
          this.send({
            page: request.page ?? 1,
            pageSize: request.pageSize ?? this.pageSize(),
            filters: this.filters(),
            sort: this.sort(),
          });
        },
        error: (err) => {
          this.interpreting.set(false);
          if (this.index() === index) this.textError.set(errorText(err));
        },
      });
  }

  /** What the reader sees now, for the agent to build on; null before any change. */
  private currentView(): ResultView | null {
    if (
      this.result() === null &&
      this.filters().length === 0 &&
      this.sort().length === 0
    ) {
      return null;
    }
    return {
      filters: this.filters(),
      sort: this.sort(),
      page: this.page(),
      pageSize: this.pageSize(),
    };
  }

  protected retry(): void {
    if (this.lastRequest !== null) this.send(this.lastRequest);
  }

  /** Back to the rows the answer was written from. */
  protected showStored(): void {
    this.result.set(null);
    this.filters.set([]);
    this.sort.set([]);
    this.error.set(null);
    this.textError.set(null);
    this.understood.set(null);
    this.rejected.set([]);
    this.adding.set(false);
  }

  protected cell(value: unknown): string {
    if (value === null || value === undefined) return '';
    return typeof value === 'object' ? JSON.stringify(value) : String(value);
  }

  protected setOp(value: string): void {
    this.draftOp.set(value as FilterOp);
  }

  private load(page: number): void {
    this.send({
      page,
      pageSize: this.pageSize(),
      filters: this.filters(),
      sort: this.sort(),
    });
  }

  private send(request: PageRequest): void {
    this.lastRequest = request;
    this.error.set(null);
    this.loading.set(true);
    const index = this.index();
    this.api.page(index, request).subscribe({
      next: (result) => {
        this.loading.set(false);
        if (this.index() === index) this.result.set(result);
      },
      error: (err) => {
        this.loading.set(false);
        if (this.index() === index) this.error.set(errorText(err));
      },
    });
  }

  /** A number column takes a number; the server coerces the rest. */
  private coerce(column: string, text: string): FilterValue {
    const kind = this.result()?.columnKinds?.[column];
    if (kind === 'number' && text !== '' && !Number.isNaN(Number(text))) {
      return Number(text);
    }
    if (kind === 'boolean' && (text === 'true' || text === 'false')) {
      return text === 'true';
    }
    return text;
  }

  private filterText(filter: FilterSpec): string {
    const label = FILTER_OP_LABELS[filter.op];
    if (NO_VALUE_OPS.includes(filter.op)) return `${filter.column} ${label}`;
    if (LIST_OPS.includes(filter.op)) {
      return `${filter.column} ${label} ${(filter.values ?? []).join(', ')}`;
    }
    if (filter.op === 'between') {
      return `${filter.column} ${label} ${filter.value} and ${filter.valueTo}`;
    }
    return `${filter.column} ${label} ${filter.value}`;
  }
}
