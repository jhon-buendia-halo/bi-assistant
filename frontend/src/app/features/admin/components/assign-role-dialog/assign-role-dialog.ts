import { Component, computed, inject, output, signal, viewChild } from '@angular/core';
import { Loader2, LucideAngularModule } from 'lucide-angular';
import { ToastService } from '../../../../core/toast/toast.service';
import { AssignableRole } from '../../models/admin.models';
import { AdminApiService } from '../../services/admin-api.service';
import { errorMessage } from '../../services/admin-format';
import { AdminDialog } from '../admin-dialog/admin-dialog';
import { DirectoryPicker, PickerOption } from '../directory-picker/directory-picker';
import { RoleFields, roleBody } from '../role-fields/role-fields';

/**
 * **Assign role** on Users & groups (admin R56, ui.md 4.18.3): a user, a
 * role and, for Data owner, a datasource. `201` toasts "Role assigned",
 * `200` "Role already assigned" (info); both close the dialog with `done`
 * so the table reloads. A failure keeps it open and toasts the message.
 */
@Component({
  selector: 'app-assign-role-dialog',
  imports: [AdminDialog, DirectoryPicker, LucideAngularModule, RoleFields],
  template: `
    <app-admin-dialog
      title="Assign role"
      intro="Give a person a role. Roles from group mappings are managed in Roles & permissions."
      [busy]="running()"
      (dismiss)="cancel.emit()"
    >
      <div class="flex flex-col gap-4">
        <app-directory-picker
          label="User"
          kind="user"
          placeholder="Search by name or email"
          (picked)="user.set($event)"
        />
        <app-role-fields [(role)]="role" [(datasourceId)]="datasourceId" />
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
          [disabled]="!canAssign()"
          (click)="assign()"
        >
          @if (running()) {
            <lucide-angular [img]="Loader2" [size]="14" class="animate-spin" />
            <span>Assigning…</span>
          } @else {
            <span>Assign</span>
          }
        </button>
      </ng-container>
    </app-admin-dialog>
  `,
})
export class AssignRoleDialog {
  readonly Loader2 = Loader2;

  private readonly api = inject(AdminApiService);
  private readonly toast = inject(ToastService);

  readonly cancel = output<void>();
  readonly done = output<void>();

  readonly user = signal<PickerOption | null>(null);
  readonly role = signal<AssignableRole | ''>('');
  readonly datasourceId = signal('');
  readonly running = signal(false);

  private readonly fields = viewChild.required(RoleFields);

  readonly canAssign = computed(
    () => !this.running() && this.user() !== null && this.fields().complete(),
  );

  assign(): void {
    const user = this.user();
    const role = this.role();
    if (!user || role === '' || !this.canAssign()) return;
    this.running.set(true);
    this.api
      .assignRole({ userId: user.id, ...roleBody(role, this.datasourceId()) })
      .subscribe({
        next: (res) => {
          this.running.set(false);
          const message = res.body?.message ?? 'Role assigned';
          if (res.status === 201) this.toast.success(message);
          else this.toast.info(message);
          this.done.emit();
        },
        error: (err) => {
          this.running.set(false);
          this.toast.error(errorMessage(err));
        },
      });
  }
}
