import { Component, OnInit, inject, signal } from '@angular/core';
import { LucideAngularModule, TriangleAlert } from 'lucide-angular';
import { ToastService } from '../../../../core/toast/toast.service';
import { MemorySettingsView } from '../../models/memory-settings.model';
import { MemoryApiService } from '../../services/memory-api.service';

@Component({
  selector: 'app-memory-settings',
  imports: [LucideAngularModule],
  templateUrl: './memory-settings.html',
})
export class MemorySettings implements OnInit {
  readonly TriangleAlert = TriangleAlert;

  private readonly api = inject(MemoryApiService);
  private readonly toast = inject(ToastService);

  /** The saved state; the switch always shows this. */
  readonly view = signal<MemorySettingsView | null>(null);
  readonly saving = signal(false);

  ngOnInit(): void {
    this.api.getSettings().subscribe({
      // Backend unreachable: the section stays empty.
      next: (view) => this.view.set(view),
    });
  }

  toggle(): void {
    const current = this.view();
    if (!current || this.saving()) return;
    const enabled = !current.enabled;
    this.saving.set(true);
    this.api.saveSettings(enabled).subscribe({
      next: (result) => {
        this.saving.set(false);
        if ('ok' in result && result.ok === false) {
          this.toast.error(result.message);
          return;
        }
        this.view.set(result as MemorySettingsView);
        this.toast.success(enabled ? 'Memory turned on' : 'Memory turned off');
      },
      error: (err) => {
        this.saving.set(false);
        this.toast.error(err?.error?.message ?? 'Backend unreachable');
      },
    });
  }
}
