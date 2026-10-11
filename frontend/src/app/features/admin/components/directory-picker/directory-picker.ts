import {
  Component,
  OnDestroy,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { Observable, Subscription, map } from 'rxjs';
import { AdminApiService } from '../../services/admin-api.service';

/** A person or group chosen in a picker. */
export interface PickerOption {
  id: string;
  label: string;
  /** The display name alone (for toasts and summaries). */
  name: string;
}

/** Delay after the last keystroke before searching (ui.md 4.18.1). */
export const PICKER_DEBOUNCE_MS = 250;
const MAX_OPTIONS = 10;

let nextId = 0;

/**
 * The User, New owner and Entra ID group pickers (ui.md 4.18.1): a combobox
 * over up to 10 matches, searched 250 ms after typing stops. Users are
 * searched by name or email among users who are not deactivated; groups by
 * name. Arrow keys move, Enter picks, Escape closes the list.
 */
@Component({
  selector: 'app-directory-picker',
  template: `
    <label [for]="inputId" class="field-label">{{ label() }}</label>
    <input
      [id]="inputId"
      type="text"
      role="combobox"
      autocomplete="off"
      aria-autocomplete="list"
      [attr.aria-expanded]="open()"
      [attr.aria-controls]="listId"
      [attr.aria-activedescendant]="
        open() && active() >= 0 ? listId + '-' + active() : null
      "
      [placeholder]="placeholder()"
      [value]="text()"
      (input)="onInput($any($event.target).value)"
      (keydown)="onKeydown($event)"
      (blur)="close()"
      class="field mt-1"
    />
    <ul
      [id]="listId"
      role="listbox"
      [attr.aria-label]="label()"
      [hidden]="!open() || !options().length"
      class="menu mt-1"
    >
      @for (option of options(); track option.id; let i = $index) {
        <li
          [id]="listId + '-' + i"
          role="option"
          [attr.aria-selected]="i === active()"
          (mousedown)="$event.preventDefault()"
          (click)="choose(option)"
          class="menu-item cursor-pointer"
          [class.bg-surface-muted]="i === active()"
        >
          {{ option.label }}
        </li>
      }
    </ul>
    @if (open() && !options().length) {
      <p class="mt-1 text-[12px] text-fg-muted">No matches.</p>
    }
  `,
})
export class DirectoryPicker implements OnDestroy {
  private readonly api = inject(AdminApiService);

  readonly label = input.required<string>();
  readonly kind = input.required<'user' | 'group'>();
  readonly placeholder = input('');
  /** Ids never offered (the current owner in Transfer ownership). */
  readonly exclude = input<readonly string[]>([]);
  /** The chosen option, or null once the text no longer matches it. */
  readonly picked = output<PickerOption | null>();

  readonly inputId = `admin-picker-${++nextId}`;
  readonly listId = `${this.inputId}-list`;

  readonly text = signal('');
  readonly options = signal<PickerOption[]>([]);
  readonly open = signal(false);
  readonly active = signal(-1);

  private chosen: PickerOption | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private request?: Subscription;

  ngOnDestroy(): void {
    this.clearTimer();
    this.request?.unsubscribe();
  }

  onInput(value: string): void {
    this.text.set(value);
    if (this.chosen) {
      this.chosen = null;
      this.picked.emit(null);
    }
    this.clearTimer();
    this.timer = setTimeout(() => this.search(value), PICKER_DEBOUNCE_MS);
  }

  onKeydown(event: KeyboardEvent): void {
    const count = this.options().length;
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        if (!count) return;
        this.open.set(true);
        this.active.set(Math.min(this.active() + 1, count - 1));
        return;
      case 'ArrowUp':
        event.preventDefault();
        if (!count) return;
        this.active.set(Math.max(this.active() - 1, 0));
        return;
      case 'Enter':
        if (this.open() && this.active() >= 0 && this.active() < count) {
          event.preventDefault();
          this.choose(this.options()[this.active()]);
        }
        return;
      case 'Escape':
        if (this.open()) {
          event.preventDefault();
          event.stopPropagation();
          this.close();
        }
        return;
    }
  }

  choose(option: PickerOption): void {
    this.chosen = option;
    this.text.set(option.label);
    this.close();
    this.picked.emit(option);
  }

  close(): void {
    this.open.set(false);
    this.active.set(-1);
  }

  private search(query: string): void {
    this.timer = null;
    this.request?.unsubscribe();
    const exclude = new Set(this.exclude());
    this.request = this.lookup(query).subscribe({
      next: (options) => {
        this.options.set(options.filter((o) => !exclude.has(o.id)));
        this.active.set(this.options().length ? 0 : -1);
        this.open.set(true);
      },
      error: () => {
        this.options.set([]);
        this.open.set(true);
      },
    });
  }

  private lookup(q: string): Observable<PickerOption[]> {
    if (this.kind() === 'group') {
      return this.api
        .groups({ q, pageSize: MAX_OPTIONS })
        .pipe(
          map((page) =>
            page.items.map((g) => ({ id: g.id, label: g.displayName, name: g.displayName })),
          ),
        );
    }
    return this.api
      .users({ q, pageSize: MAX_OPTIONS, excludeDeactivated: true })
      .pipe(
        map((page) =>
          page.items.map((u) => ({
            id: u.id,
            name: u.displayName,
            label: u.email ? `${u.displayName} · ${u.email}` : u.displayName,
          })),
        ),
      );
  }

  private clearTimer(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }
}
