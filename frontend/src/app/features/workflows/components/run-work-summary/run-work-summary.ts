import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  output,
  signal,
} from '@angular/core';
import { ChevronDown, ChevronRight, LucideAngularModule } from 'lucide-angular';
import { WorkSummarySource, workSummaryOf } from '../../services/work-summary';

/**
 * The line above a conversational agent's answer: how long she worked, the
 * skills she loaded, the tables she read, the queries she ran and the checks
 * that held. It folds open to the query list; a query opens the inspector.
 */
@Component({
  selector: 'app-run-work-summary',
  imports: [LucideAngularModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (hasParts()) {
      <div data-testid="run-work-summary-block" class="flex flex-col gap-1">
        <button
          type="button"
          data-testid="run-work-summary"
          [attr.aria-expanded]="open()"
          (click)="open.set(!open())"
          class="flex w-fit max-w-full cursor-pointer flex-wrap items-center gap-x-1.5 gap-y-0.5 rounded-md border-0 bg-transparent px-1 py-0.5 text-left text-[12px] text-fg-muted hover:bg-surface-muted focus-visible:outline-2 focus-visible:outline-focus"
        >
          <lucide-angular
            [img]="open() ? ChevronDown : ChevronRight"
            [size]="12"
            class="shrink-0"
          />
          @for (part of parts(); track part.id; let last = $last) {
            <span
              [attr.data-testid]="'run-work-summary-' + part.id"
              [class.text-on-warning-soft]="part.warning"
              [class.font-medium]="part.warning"
              >{{ part.label }}</span
            >
            @if (!last) {
              <span aria-hidden="true">·</span>
            }
          }
        </button>
        @if (open()) {
          <ul
            data-testid="run-work-summary-query-list"
            aria-label="Queries run"
            class="m-0 flex list-none flex-col gap-0.5 p-0 pl-5"
          >
            @for (query of summary().queries; track query.index) {
              <li>
                <button
                  type="button"
                  data-testid="run-work-summary-query"
                  (click)="openQuery.emit(query.index)"
                  class="cursor-pointer rounded border-0 bg-transparent px-1 py-0.5 text-left text-[12px] text-fg hover:bg-surface-muted focus-visible:outline-2 focus-visible:outline-focus"
                >
                  {{ query.rationale || 'Query ' + (query.index + 1) }}
                  @if (query.rows !== null) {
                    <span class="text-fg-muted">
                      · {{ query.rows }} {{ query.rows === 1 ? 'row' : 'rows' }}
                    </span>
                  }
                </button>
              </li>
            } @empty {
              <li class="text-[12px] text-fg-muted">No queries were run.</li>
            }
          </ul>
        }
      </div>
    }
  `,
})
export class RunWorkSummary {
  protected readonly ChevronDown = ChevronDown;
  protected readonly ChevronRight = ChevronRight;

  /** The run's steps and its answer (an earlier turn passes the answer alone). */
  readonly source = input.required<WorkSummarySource>();
  /** A query of the list: the inspector opens it on `answer.data[index]`. */
  readonly openQuery = output<number>();

  protected readonly open = signal(false);
  protected readonly summary = computed(() => workSummaryOf(this.source()));

  protected readonly parts = computed(() => {
    const s = this.summary();
    return [
      { id: 'duration', label: s.durationLabel, warning: false },
      { id: 'skills', label: s.skillsLabel, warning: false },
      { id: 'tables', label: s.tablesLabel, warning: false },
      { id: 'queries', label: s.queriesLabel, warning: false },
      { id: 'checks', label: s.checksLabel, warning: s.checksWarning },
    ].filter(
      (part): part is { id: string; label: string; warning: boolean } =>
        part.label !== null,
    );
  });

  protected readonly hasParts = computed(() => this.parts().length > 0);
}
