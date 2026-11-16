import {
  Component,
  ElementRef,
  HostListener,
  computed,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { Check, Database, LucideAngularModule, Plus, Search, Table, X } from 'lucide-angular';
import { DatasourcesApiService } from '../../../datasources/services/datasources-api.service';
import { Dataset } from '../../services/datasets-api.service';
import { PickerOption, QUICK_PICK_MAX, buildPickerView } from './dataset-picker.util';

let nextId = 0;

/** Where the open list sits: above or below the field, never past the window. */
interface PopoverPosition {
  left: number;
  width: number;
  top: number | null;
  bottom: number | null;
  maxHeight: number;
}

/**
 * Picks one or more datasets from a catalogue of any size (ui.md 4.4b): the picked ones as
 * removable chips in one field, and **Add dataset** opening a searchable list (by name or
 * table) with the recent ones first and the rest grouped by datasource. With few datasets
 * and none picked, the field offers them as one-click suggestions.
 */
@Component({
  selector: 'app-dataset-picker',
  imports: [LucideAngularModule],
  templateUrl: './dataset-picker.html',
  styles: `
    :host {
      display: block;
    }
    .picker-field {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 0.375rem;
      min-height: 2.125rem;
      border: 1px solid var(--qti-border);
      border-radius: 0.5rem;
      background-color: var(--qti-surface);
      padding: 0.1875rem 0.25rem;
    }
    .picker-field-open {
      border-color: var(--qti-border-selected);
      box-shadow: 0 0 0 2px var(--qti-surface-selected);
    }
    .picker-field-invalid {
      border-color: var(--qti-on-danger-soft);
    }
    .picker-chip {
      display: inline-flex;
      max-width: 100%;
      align-items: center;
      gap: 0.375rem;
      border: 1px solid var(--qti-border-selected);
      border-radius: 9999px;
      background-color: var(--qti-surface-selected);
      padding: 0.0625rem 0.25rem 0.0625rem 0.625rem;
      font-size: 12px;
      color: var(--qti-on-primary-soft);
    }
    .picker-chip-remove {
      display: inline-flex;
      border-radius: 9999px;
      padding: 0.125rem;
      color: var(--qti-fg-muted);
      cursor: pointer;
    }
    .picker-chip-remove:hover {
      background-color: var(--qti-surface-muted);
      color: var(--qti-fg);
    }
    .picker-quick {
      display: inline-flex;
      align-items: center;
      gap: 0.25rem;
      border: 1px dashed var(--qti-border-strong);
      border-radius: 9999px;
      padding: 0.0625rem 0.625rem;
      font-size: 12px;
      color: var(--qti-fg);
      cursor: pointer;
    }
    .picker-quick:hover {
      border-style: solid;
      background-color: var(--qti-surface-muted);
    }
    .picker-placeholder {
      padding-left: 0.375rem;
      font-size: 12px;
      color: var(--qti-fg-muted);
    }
    .picker-add {
      margin-left: auto;
      display: inline-flex;
      align-items: center;
      gap: 0.25rem;
      border-radius: 9999px;
      padding: 0.1875rem 0.625rem;
      font-size: 12px;
      font-weight: 500;
      color: var(--qti-on-primary-soft);
      cursor: pointer;
    }
    .picker-add:hover,
    .picker-add[aria-expanded='true'] {
      background-color: var(--qti-surface-muted);
    }
    .picker-chip-remove:focus-visible,
    .picker-quick:focus-visible,
    .picker-add:focus-visible {
      outline: 2px solid var(--qti-focus);
      outline-offset: 2px;
    }
    .picker-pop {
      position: fixed;
      z-index: 50;
      display: flex;
      flex-direction: column;
      overflow: hidden;
      padding: 0;
    }
    .picker-search {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      border-bottom: 1px solid var(--qti-border);
      padding: 0.5rem 0.75rem;
      color: var(--qti-fg-muted);
    }
    .picker-search input {
      flex: 1;
      min-width: 0;
      border: 0;
      background: transparent;
      font-size: 13px;
      color: var(--qti-fg);
      outline: none;
    }
    .picker-search input::placeholder {
      color: var(--qti-fg-muted);
    }
    .picker-list {
      flex: 1;
      min-height: 0;
      overflow-y: auto;
      padding: 0.25rem;
    }
    .picker-group {
      padding: 0.5rem 0.625rem 0.25rem;
      font-size: 10.5px;
      font-weight: 600;
      letter-spacing: 0.06em;
      text-transform: uppercase;
      color: var(--qti-fg-muted);
    }
    .picker-option {
      display: flex;
      align-items: center;
      gap: 0.625rem;
      border-radius: 0.5rem;
      padding: 0.375rem 0.625rem;
      font-size: 13px;
      color: var(--qti-fg);
      cursor: pointer;
    }
    .picker-option-active {
      background-color: var(--qti-surface-muted);
    }
    .picker-box {
      display: inline-flex;
      height: 0.875rem;
      width: 0.875rem;
      flex-shrink: 0;
      align-items: center;
      justify-content: center;
      border: 1px solid var(--qti-border-strong);
      border-radius: 0.1875rem;
      color: var(--qti-on-primary);
    }
    .picker-box-on {
      border-color: var(--qti-primary);
      background-color: var(--qti-primary);
    }
    .picker-detail {
      display: flex;
      align-items: center;
      gap: 0.25rem;
      font-size: 11.5px;
      color: var(--qti-fg-muted);
    }
    .picker-meta {
      margin-left: auto;
      flex-shrink: 0;
      font-size: 11.5px;
      color: var(--qti-fg-muted);
    }
    .picker-mark {
      border-radius: 0.1875rem;
      background-color: var(--qti-warning-soft);
      color: var(--qti-on-warning-soft);
    }
    .picker-note {
      margin: 0;
      padding: 0.5rem 0.625rem;
      font-size: 12px;
      color: var(--qti-fg-muted);
    }
    .picker-foot {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      border-top: 1px solid var(--qti-border);
      padding: 0.375rem 0.5rem 0.375rem 0.75rem;
      font-size: 12px;
      color: var(--qti-fg-muted);
    }
    .picker-foot .btn {
      padding: 0.125rem 0.75rem;
      font-size: 12px;
    }
  `,
})
export class DatasetPicker {
  /** The datasets the field offers. */
  readonly datasets = input.required<readonly Dataset[]>();
  /** The names picked, in pick order. */
  readonly selected = input.required<readonly string[]>();
  /** Draws the field's invalid border (its group carries the message). */
  readonly invalid = input(false);
  /** The new list of picked names after each change. */
  readonly selectedChange = output<string[]>();

  private readonly datasourcesApi = inject(DatasourcesApiService);
  private readonly field = viewChild.required<ElementRef<HTMLElement>>('field');
  private readonly trigger = viewChild.required<ElementRef<HTMLButtonElement>>('trigger');
  private readonly searchInput = viewChild<ElementRef<HTMLInputElement>>('search');
  private readonly list = viewChild<ElementRef<HTMLElement>>('list');

  protected readonly Check = Check;
  protected readonly Database = Database;
  protected readonly Plus = Plus;
  protected readonly Search = Search;
  protected readonly Table = Table;
  protected readonly X = X;

  protected readonly uid = `dataset-picker-${nextId++}`;
  protected readonly listboxId = `${this.uid}-listbox`;

  protected readonly open = signal(false);
  protected readonly query = signal('');
  protected readonly active = signal(0);
  protected readonly position = signal<PopoverPosition | null>(null);
  private readonly datasourceNames = signal<ReadonlyMap<string, string>>(new Map());
  private datasourcesRequested = false;

  /** The few datasets offered as one-click chips while nothing is picked. */
  protected readonly quickPicks = computed(() => {
    const all = this.datasets();
    return this.selected().length === 0 && all.length <= QUICK_PICK_MAX ? all : [];
  });

  protected readonly view = computed(() =>
    buildPickerView(this.datasets(), this.selected(), this.query(), this.datasourceNames()),
  );

  private readonly indexByName = computed(
    () => new Map(this.view().flat.map((option, index) => [option.name, index])),
  );

  protected readonly activeId = computed(() => {
    const option = this.view().flat[this.active()];
    return option ? this.optionId(option) : null;
  });

  protected optionId(option: PickerOption): string {
    return `${this.uid}-option-${this.indexByName().get(option.name) ?? 0}`;
  }

  protected isActive(option: PickerOption): boolean {
    return this.indexByName().get(option.name) === this.active();
  }

  protected toggleOpen(): void {
    if (this.open()) this.close(false);
    else this.show();
  }

  private show(): void {
    this.loadDatasourceNames();
    this.query.set('');
    this.active.set(0);
    this.position.set(this.placement());
    this.open.set(true);
    setTimeout(() => this.searchInput()?.nativeElement.focus());
  }

  /** Closes the list; `refocus` puts the focus back on Add dataset. */
  protected close(refocus: boolean): void {
    if (!this.open()) return;
    this.open.set(false);
    if (refocus) this.trigger().nativeElement.focus();
  }

  protected toggle(name: string): void {
    const picked = this.selected();
    this.selectedChange.emit(
      picked.includes(name) ? picked.filter((n) => n !== name) : [...picked, name],
    );
  }

  protected add(name: string): void {
    if (!this.selected().includes(name)) this.selectedChange.emit([...this.selected(), name]);
  }

  protected remove(name: string): void {
    this.selectedChange.emit(this.selected().filter((n) => n !== name));
    this.trigger().nativeElement.focus();
  }

  protected clear(): void {
    this.selectedChange.emit([]);
  }

  protected onQuery(event: Event): void {
    this.query.set((event.target as HTMLInputElement).value);
    this.active.set(0);
    this.list()?.nativeElement.scrollTo?.({ top: 0 });
  }

  /** ↑ ↓ move, Enter picks or unpicks, Escape closes; Enter never submits the form. */
  protected onKey(event: KeyboardEvent): void {
    const count = this.view().flat.length;
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        if (count > 0) this.moveTo(Math.min(this.active() + 1, count - 1));
        break;
      case 'ArrowUp':
        event.preventDefault();
        if (count > 0) this.moveTo(Math.max(this.active() - 1, 0));
        break;
      case 'Enter': {
        event.preventDefault();
        const option = this.view().flat[this.active()];
        if (option) this.toggle(option.name);
        break;
      }
      case 'Escape':
        event.preventDefault();
        event.stopPropagation();
        this.close(true);
        break;
    }
  }

  protected hover(option: PickerOption): void {
    const index = this.indexByName().get(option.name);
    if (index !== undefined) this.active.set(index);
  }

  @HostListener('window:resize')
  protected onResize(): void {
    this.close(false);
  }

  private moveTo(index: number): void {
    this.active.set(index);
    setTimeout(() =>
      document.getElementById(this.activeId() ?? '')?.scrollIntoView?.({ block: 'nearest' }),
    );
  }

  /** Opens toward the larger free space: above when the field sits low (the run form). */
  private placement(): PopoverPosition {
    const field = this.field().nativeElement;
    const rect = field.getBoundingClientRect();
    // Opening upward, clear the field's label too (the group that holds it).
    const topEdge = (field.closest('[role="group"]') ?? field).getBoundingClientRect().top;
    const gap = 6;
    const margin = 8;
    const above = topEdge - gap - margin;
    const below = window.innerHeight - rect.bottom - gap - margin;
    const up = above > below;
    return {
      left: rect.left,
      width: Math.max(rect.width, 280),
      top: up ? null : rect.bottom + gap,
      bottom: up ? window.innerHeight - topEdge + gap : null,
      maxHeight: Math.max(160, Math.min(440, up ? above : below)),
    };
  }

  /** Datasource names group a large list; without them the groups fall back to the kind. */
  private loadDatasourceNames(): void {
    if (this.datasourcesRequested || this.datasets().length <= QUICK_PICK_MAX) return;
    this.datasourcesRequested = true;
    this.datasourcesApi.list().subscribe({
      next: ({ datasources }) =>
        this.datasourceNames.set(new Map(datasources.map((d) => [d.id, d.name]))),
      error: () => undefined,
    });
  }
}
