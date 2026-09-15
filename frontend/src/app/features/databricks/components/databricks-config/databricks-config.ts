import { Component, OnInit, inject, signal } from '@angular/core';
import { LucideAngularModule, Loader2 } from 'lucide-angular';
import { DatabricksApiService } from '../../services/databricks-api.service';
import { ToastService } from '../../../../core/toast/toast.service';

@Component({
  selector: 'app-databricks-config',
  imports: [LucideAngularModule],
  templateUrl: './databricks-config.html',
  styleUrl: './databricks-config.scss',
})
export class DatabricksConfig implements OnInit {
  readonly Loader2 = Loader2;

  private readonly api = inject(DatabricksApiService);
  private readonly toast = inject(ToastService);

  readonly host = signal('');
  readonly token = signal('');
  readonly warehouseId = signal('');
  readonly testing = signal(false);
  readonly saving = signal(false);
  // Only a configuration whose test passed can be saved.
  readonly testedOk = signal(false);

  ngOnInit(): void {
    this.api.getConnection().subscribe({
      next: (saved) => {
        if (!saved) return;
        this.host.set(saved.host);
        this.token.set(saved.token);
        this.warehouseId.set(saved.warehouseId);
      },
      error: () => {
        // Backend unreachable — leave the form empty.
      },
    });
  }

  get canTest(): boolean {
    return (
      !this.testing() &&
      this.host().trim() !== '' &&
      this.token().trim() !== '' &&
      this.warehouseId().trim() !== ''
    );
  }

  onFieldChange(): void {
    // Editing invalidates the previous successful test.
    this.testedOk.set(false);
  }

  private payload() {
    return {
      host: this.host().trim(),
      token: this.token().trim(),
      warehouseId: this.warehouseId().trim(),
    };
  }

  testConnection(): void {
    if (!this.canTest) return;
    this.testing.set(true);
    this.api.testConnection(this.payload()).subscribe({
      next: (res) => {
        if (res.ok) this.toast.success(res.message);
        else this.toast.error(res.message);
        this.testedOk.set(res.ok);
        this.testing.set(false);
      },
      error: (err) => {
        this.toast.error(err?.error?.message ?? 'Backend unreachable');
        this.testedOk.set(false);
        this.testing.set(false);
      },
    });
  }

  saveConnection(): void {
    if (!this.testedOk() || this.saving()) return;
    this.saving.set(true);
    this.api.saveConnection(this.payload()).subscribe({
      next: (res) => {
        if (res.ok) this.toast.success(res.message);
        else this.toast.error(res.message);
        this.saving.set(false);
      },
      error: (err) => {
        this.toast.error(err?.error?.message ?? 'Backend unreachable');
        this.saving.set(false);
      },
    });
  }
}
