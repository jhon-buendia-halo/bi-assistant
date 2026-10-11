import { Component, computed, inject, input, output, signal } from '@angular/core';
import { concatMap, from, toArray } from 'rxjs';
import { Loader2, LucideAngularModule } from 'lucide-angular';
import { ToastService } from '../../../../core/toast/toast.service';
import { InactiveMaker } from '../../models/admin.models';
import { AdminApiService } from '../../services/admin-api.service';
import { errorMessage, lastActiveLabel, plural } from '../../services/admin-format';
import { AdminDialog } from '../admin-dialog/admin-dialog';

/** How an inactive maker's checkbox reads (admin R45, ui.md 4.18.2). */
export function inactiveMakerDescription(item: InactiveMaker, now = Date.now()): string {
  const lastActive = `Last active ${lastActiveLabel(item.lastActiveAt, now)}`;
  return item.makerAssignmentId
    ? `${lastActive} · Direct assignment`
    : `${lastActive} · From group ${item.makerGroups.join(', ')}`;
}

let nextId = 0;

/**
 * **Clean up** on the Overview (admin R45): removes the direct Maker
 * assignment of every ticked inactive maker, one after the other
 * (api 80). Maker held only from a group is shown unticked and disabled.
 * Success toasts "Maker role removed from <n> user(s)" and emits `done`; a
 * failure stops, toasts the server's message and emits `changed`, so the
 * host reloads while the dialog stays open.
 */
@Component({
  selector: 'app-inactive-makers-dialog',
  imports: [AdminDialog, LucideAngularModule],
  template: `
    <app-admin-dialog
      title="Inactive makers"
      intro="These people haven't used the app for 90 days or more and still hold the Maker role."
      [busy]="running()"
      (dismiss)="cancel.emit()"
    >
      <fieldset>
        <legend class="sr-only">Inactive makers</legend>
        <div class="flex flex-col gap-2">
          @for (item of items(); track item.user.id; let i = $index) {
            <div class="flex items-start gap-3">
              <input
                type="checkbox"
                [id]="id + '-user-' + i"
                [checked]="ticked().has(item.user.id)"
                [disabled]="!item.makerAssignmentId"
                (change)="toggle(item.user.id)"
                [attr.aria-describedby]="id + '-user-' + i + '-desc'"
                class="mt-0.5 size-4 shrink-0 accent-primary"
              />
              <div class="min-w-0">
                <label
                  [for]="id + '-user-' + i"
                  class="text-[14px] font-semibold text-fg-strong"
                  >{{ item.user.displayName }}</label
                >
                <p
                  [id]="id + '-user-' + i + '-desc'"
                  class="text-[12px] text-fg-muted"
                >
                  {{ describe(item) }}
                </p>
              </div>
            </div>
          }
        </div>
      </fieldset>
      <ng-container ngProjectAs="[dialogActions]">
        <button
          type="button"
          class="btn btn-outline"
          [disabled]="running()"
          (click)="cancel.emit()"
        >
          Cancel
        </button>
        <button
          type="button"
          class="btn btn-danger"
          [disabled]="running() || ticked().size === 0"
          (click)="remove()"
        >
          @if (running()) {
            <lucide-angular [img]="Loader2" [size]="14" class="animate-spin" />
            <span>Removing…</span>
          } @else {
            <span>Remove Maker role</span>
          }
        </button>
      </ng-container>
    </app-admin-dialog>
  `,
})
export class InactiveMakersDialog {
  readonly Loader2 = Loader2;

  private readonly api = inject(AdminApiService);
  private readonly toast = inject(ToastService);

  readonly items = input.required<readonly InactiveMaker[]>();
  readonly cancel = output<void>();
  readonly done = output<void>();
  readonly changed = output<void>();

  readonly id = `admin-inactive-${++nextId}`;
  readonly running = signal(false);
  private readonly unticked = signal<ReadonlySet<string>>(new Set());

  /** Users with a direct Maker assignment, ticked unless the admin unticked them. */
  readonly ticked = computed(
    () =>
      new Set(
        this.items()
          .filter((item) => item.makerAssignmentId)
          .map((item) => item.user.id)
          .filter((id) => !this.unticked().has(id)),
      ),
  );

  describe(item: InactiveMaker): string {
    return inactiveMakerDescription(item);
  }

  toggle(userId: string): void {
    const next = new Set(this.unticked());
    if (next.has(userId)) next.delete(userId);
    else next.add(userId);
    this.unticked.set(next);
  }

  remove(): void {
    const ticked = this.ticked();
    const ids = this.items()
      .filter((item) => ticked.has(item.user.id) && item.makerAssignmentId)
      .map((item) => item.makerAssignmentId!);
    if (!ids.length) return;
    this.running.set(true);
    from(ids)
      .pipe(
        concatMap((id) => this.api.removeRoleAssignment(id)),
        toArray(),
      )
      .subscribe({
        next: () => {
          this.running.set(false);
          this.toast.success(`Maker role removed from ${plural(ids.length, 'user')}`);
          this.done.emit();
        },
        error: (err) => {
          this.running.set(false);
          this.toast.error(errorMessage(err));
          this.changed.emit();
        },
      });
  }
}
