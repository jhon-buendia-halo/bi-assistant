import { ChangeDetectionStrategy, Component, inject, input } from '@angular/core';
import { Copy, LucideAngularModule } from 'lucide-angular';
import { ToastService } from '../../core/toast/toast.service';

/**
 * A workflow run's id, as the reader quotes it to report a run (workflows
 * R19): its first 8 characters, the whole id copied on click.
 */
@Component({
  selector: 'app-execution-id',
  imports: [LucideAngularModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <button
      type="button"
      data-testid="execution-id"
      [attr.data-execution-id]="id()"
      class="inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 font-mono text-[11px] text-fg-muted hover:bg-surface-selected hover:text-fg"
      [title]="'Execution ID ' + id() + ' (click to copy)'"
      [attr.aria-label]="'Copy execution ID ' + id()"
      (click)="copy()"
    >
      <span>Execution ID {{ id().slice(0, 8) }}</span>
      <lucide-angular [img]="Copy" [size]="12" />
    </button>
  `,
})
export class ExecutionId {
  readonly id = input.required<string>();
  protected readonly Copy = Copy;
  private readonly toast = inject(ToastService);

  protected copy(): void {
    void navigator.clipboard.writeText(this.id()).then(
      () => this.toast.success('Execution ID copied'),
      () => this.toast.error('Copy failed'),
    );
  }
}
