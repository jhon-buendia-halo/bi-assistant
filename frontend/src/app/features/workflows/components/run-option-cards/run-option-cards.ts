import { Component, computed, input, output } from '@angular/core';
import {
  Check,
  Database,
  FileSpreadsheet,
  Globe,
  LayoutDashboard,
  LucideAngularModule,
} from 'lucide-angular';
import { IntakeOption } from '../workflow-run-chat/run-intake.util';

const ICONS = {
  database: Database,
  file: FileSpreadsheet,
  api: Globe,
  dashboard: LayoutDashboard,
} as const;

/**
 * A bordered list of choices the run chat offers (ui.md 4.4b): each an icon
 * tile, its name, a muted line (`PostgreSQL · 9 tables`) and a pill Add that
 * reads ✓ Added once picked (`aria-pressed`). Presentational: the host
 * filters, cuts and picks.
 */
@Component({
  selector: 'app-run-option-cards',
  imports: [LucideAngularModule],
  host: { class: 'block' },
  template: `
    @if (options().length === 0) {
      <p class="m-0 px-1 text-[12px] text-fg-muted">{{ empty() }}</p>
    } @else {
      <ul
        [attr.aria-label]="label()"
        class="m-0 flex list-none flex-col overflow-hidden rounded-[18px] border border-border bg-surface p-0"
      >
        @for (option of options(); track option.id) {
          @let on = isOn(option.id);
          <li
            class="flex items-center gap-3 border-t border-border px-3.5 py-2.5 first:border-t-0"
            [style.padding-block.px]="compact() ? 7 : null"
            [class.bg-surface-selected]="on"
          >
            <span
              aria-hidden="true"
              class="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] border"
              [class.border-border]="!on"
              [class.bg-surface-muted]="!on"
              [class.text-icon]="!on"
              [class.border-transparent]="on"
              [class.bg-primary-soft]="on"
              [class.text-primary]="on"
            >
              <lucide-angular [img]="icon(option)" [size]="18" />
            </span>
            <span class="flex min-w-0 flex-1 flex-col">
              <span class="truncate text-[14px] font-semibold text-fg-strong">{{
                option.name
              }}</span>
              @if (option.detail) {
                <span class="truncate text-[12px] text-fg-muted">{{
                  option.detail
                }}</span>
              }
            </span>
            <button
              type="button"
              [attr.data-testid]="testIdPrefix() + '-' + option.id"
              [attr.aria-pressed]="on"
              [attr.aria-label]="'Add ' + option.name"
              (click)="toggle.emit(option)"
              class="inline-flex shrink-0 cursor-pointer items-center gap-1 rounded-full border border-border-strong bg-surface px-3.5 py-[5px] text-[13px] font-medium text-fg-strong transition-colors hover:bg-surface-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus aria-pressed:border-transparent aria-pressed:bg-fg-strong aria-pressed:text-surface aria-pressed:hover:bg-fg-strong"
            >
              @if (on) {
                <lucide-angular [img]="Check" [size]="13" />
                <span>Added</span>
              } @else {
                <span>Add</span>
              }
            </button>
          </li>
        }
      </ul>
    }
  `,
})
export class RunOptionCards {
  protected readonly Check = Check;

  readonly options = input.required<readonly IntakeOption[]>();
  /** The ids picked now. */
  readonly selected = input<readonly string[]>([]);
  /** Each Add's test id is `<prefix>-<option id>`. */
  readonly testIdPrefix = input.required<string>();
  readonly label = input('Choices');
  readonly empty = input('Nothing to pick yet.');
  /** Tighter rows, for the inputs menu. */
  readonly compact = input(false);

  readonly toggle = output<IntakeOption>();

  private readonly picked = computed(() => new Set(this.selected()));

  protected isOn(id: string): boolean {
    return this.picked().has(id);
  }

  protected icon(option: IntakeOption) {
    return ICONS[option.icon];
  }
}
