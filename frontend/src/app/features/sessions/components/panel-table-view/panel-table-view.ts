import { Component, computed, input, signal } from '@angular/core';
import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  ChevronRight,
  LucideAngularModule,
} from 'lucide-angular';
import { TablePanelItem } from '../../models/session.model';

type SortDirection = 'asc' | 'desc';

function asNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** Orders two cell values: numbers numerically, everything else as text; empty last. */
export function compareCells(a: unknown, b: unknown): number {
  const aEmpty = a === null || a === undefined || a === '';
  const bEmpty = b === null || b === undefined || b === '';
  if (aEmpty || bEmpty) return Number(aEmpty) - Number(bEmpty);
  const an = asNumber(a);
  const bn = asNumber(b);
  if (an !== null && bn !== null) return an - bn;
  return String(a).localeCompare(String(b), undefined, { numeric: true });
}

function cellText(value: unknown): string {
  if (value === null || value === undefined) return '';
  return typeof value === 'object' ? JSON.stringify(value) : String(value);
}

/** A query result the agent showed: sortable columns, row count, the SQL. */
@Component({
  selector: 'app-panel-table-view',
  imports: [LucideAngularModule],
  template: `
    <div class="flex h-full min-h-0 flex-col">
      <div class="min-h-0 flex-1 overflow-auto">
        <table class="w-full border-collapse text-left text-[12px]">
          <thead class="sticky top-0 bg-surface-muted">
            <tr>
              @for (column of item().columns; track column) {
                <th
                  scope="col"
                  class="border-b border-border p-0 font-medium whitespace-nowrap text-fg-muted"
                  [attr.aria-sort]="ariaSort(column)"
                >
                  <button
                    type="button"
                    (click)="toggleSort(column)"
                    class="flex w-full items-center gap-1 px-3 py-2 text-left hover:bg-surface-selected"
                  >
                    <span>{{ column }}</span>
                    @if (sortColumn() === column) {
                      <lucide-angular
                        [img]="sortDirection() === 'asc' ? ArrowUp : ArrowDown"
                        [size]="12"
                      />
                    }
                  </button>
                </th>
              }
            </tr>
          </thead>
          <tbody>
            @for (row of sortedRows(); track $index) {
              <tr class="border-b border-border hover:bg-surface-muted">
                @for (column of item().columns; track column) {
                  <td class="px-3 py-1.5 whitespace-nowrap text-fg">
                    {{ text(row[column]) }}
                  </td>
                }
              </tr>
            }
          </tbody>
        </table>
      </div>
      <div class="shrink-0 border-t border-border px-3 py-2 text-[12px]">
        <p class="text-fg-muted">
          {{ item().rowCount }} rows
          @if (item().truncated) {
            <span> (first 200 shown)</span>
          }
        </p>
        @if (item().input) {
          <button
            type="button"
            (click)="queryOpen.set(!queryOpen())"
            [attr.aria-expanded]="queryOpen()"
            class="mt-1 flex items-center gap-1 text-fg-muted hover:text-fg"
          >
            <lucide-angular
              [img]="queryOpen() ? ChevronDown : ChevronRight"
              [size]="12"
            />
            <span>Query</span>
          </button>
          @if (queryOpen()) {
            <pre
              class="mt-1 max-h-40 overflow-auto rounded-lg bg-surface-muted p-2 font-mono text-[11px] leading-4 whitespace-pre-wrap text-fg"
              >{{ item().input }}</pre
            >
          }
        }
      </div>
    </div>
  `,
})
export class PanelTableView {
  readonly ArrowUp = ArrowUp;
  readonly ArrowDown = ArrowDown;
  readonly ChevronDown = ChevronDown;
  readonly ChevronRight = ChevronRight;

  readonly item = input.required<TablePanelItem>();

  readonly sortColumn = signal<string | null>(null);
  readonly sortDirection = signal<SortDirection>('asc');
  readonly queryOpen = signal(false);

  readonly sortedRows = computed(() => {
    const rows = this.item().rows;
    const column = this.sortColumn();
    if (!column) return rows;
    const sign = this.sortDirection() === 'asc' ? 1 : -1;
    return [...rows].sort((a, b) => {
      const aEmpty = a[column] === null || a[column] === undefined || a[column] === '';
      const bEmpty = b[column] === null || b[column] === undefined || b[column] === '';
      if (aEmpty || bEmpty) return Number(aEmpty) - Number(bEmpty);
      return sign * compareCells(a[column], b[column]);
    });
  });

  protected text = cellText;

  toggleSort(column: string): void {
    if (this.sortColumn() === column) {
      this.sortDirection.set(this.sortDirection() === 'asc' ? 'desc' : 'asc');
    } else {
      this.sortColumn.set(column);
      this.sortDirection.set('asc');
    }
  }

  ariaSort(column: string): 'ascending' | 'descending' | 'none' {
    if (this.sortColumn() !== column) return 'none';
    return this.sortDirection() === 'asc' ? 'ascending' : 'descending';
  }
}
