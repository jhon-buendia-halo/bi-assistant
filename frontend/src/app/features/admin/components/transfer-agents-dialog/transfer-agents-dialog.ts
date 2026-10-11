import { Component, computed, inject, input, output, signal } from '@angular/core';
import { Loader2, LucideAngularModule } from 'lucide-angular';
import { ToastService } from '../../../../core/toast/toast.service';
import { AdminApiService } from '../../services/admin-api.service';
import { errorMessage } from '../../services/admin-format';
import { AdminDialog } from '../admin-dialog/admin-dialog';
import { DirectoryPicker, PickerOption } from '../directory-picker/directory-picker';

/** An agent offered for transfer, with the line that describes it. */
export interface TransferCandidate {
  id: string;
  name: string;
  description: string;
}

let nextId = 0;

/**
 * Moves ticked agents to a new owner, all at once (admin R43, R63, R64):
 * the **Assign an owner** dialog of the Overview and the **Transfer
 * ownership** dialog of the user detail panel. Every agent starts ticked;
 * **Transfer** needs a new owner and at least one ticked agent. Success
 * toasts the server's message and closes with `done`; a failure keeps the
 * dialog open and toasts the message (ui.md 4.18.1).
 */
@Component({
  selector: 'app-transfer-agents-dialog',
  imports: [AdminDialog, DirectoryPicker, LucideAngularModule],
  template: `
    <app-admin-dialog
      [title]="title()"
      [intro]="intro()"
      [busy]="running()"
      (dismiss)="cancel.emit()"
    >
      <fieldset>
        <legend class="sr-only">Agents</legend>
        <div class="flex flex-col gap-2">
          @for (agent of agents(); track agent.id; let i = $index) {
            <div class="flex items-start gap-3">
              <input
                type="checkbox"
                [id]="id + '-agent-' + i"
                [checked]="ticked().has(agent.id)"
                (change)="toggle(agent.id)"
                [attr.aria-describedby]="id + '-agent-' + i + '-desc'"
                class="mt-0.5 size-4 shrink-0 accent-primary"
              />
              <div class="min-w-0">
                <label
                  [for]="id + '-agent-' + i"
                  class="text-[14px] font-semibold text-fg-strong"
                  >{{ agent.name }}</label
                >
                <p
                  [id]="id + '-agent-' + i + '-desc'"
                  class="text-[12px] text-fg-muted"
                >
                  {{ agent.description }}
                </p>
              </div>
            </div>
          }
        </div>
      </fieldset>
      <div class="mt-5">
        <app-directory-picker
          label="New owner"
          kind="user"
          placeholder="Search by name or email"
          [exclude]="exclude()"
          (picked)="owner.set($event)"
        />
      </div>
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
          class="btn btn-primary"
          [disabled]="!canTransfer()"
          (click)="transfer()"
        >
          @if (running()) {
            <lucide-angular [img]="Loader2" [size]="14" class="animate-spin" />
            <span>Transferring…</span>
          } @else {
            <span>Transfer</span>
          }
        </button>
      </ng-container>
    </app-admin-dialog>
  `,
})
export class TransferAgentsDialog {
  readonly Loader2 = Loader2;

  private readonly api = inject(AdminApiService);
  private readonly toast = inject(ToastService);

  readonly title = input.required<string>();
  readonly intro = input.required<string>();
  readonly agents = input.required<readonly TransferCandidate[]>();
  /** User ids the New owner picker leaves out. */
  readonly exclude = input<readonly string[]>([]);
  readonly cancel = output<void>();
  /** The transfer succeeded; the host reloads. */
  readonly done = output<void>();

  readonly id = `admin-transfer-${++nextId}`;
  readonly owner = signal<PickerOption | null>(null);
  readonly running = signal(false);
  private readonly unticked = signal<ReadonlySet<string>>(new Set());

  readonly ticked = computed(
    () =>
      new Set(
        this.agents()
          .map((agent) => agent.id)
          .filter((id) => !this.unticked().has(id)),
      ),
  );

  readonly canTransfer = computed(
    () => !this.running() && this.owner() !== null && this.ticked().size > 0,
  );

  toggle(id: string): void {
    const next = new Set(this.unticked());
    if (next.has(id)) next.delete(id);
    else next.add(id);
    this.unticked.set(next);
  }

  transfer(): void {
    const owner = this.owner();
    if (!owner || !this.canTransfer()) return;
    this.running.set(true);
    this.api.transferAgents([...this.ticked()], owner.id).subscribe({
      next: (res) => {
        this.running.set(false);
        this.toast.success(res.message);
        this.done.emit();
      },
      error: (err) => {
        this.running.set(false);
        this.toast.error(errorMessage(err));
      },
    });
  }
}
