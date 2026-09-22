import { Component, computed, inject } from '@angular/core';
import { BackendStatusService } from '../../../core/backend-status/backend-status.service';

@Component({
  selector: 'app-backend-status-banner',
  templateUrl: './backend-status-banner.html',
})
export class BackendStatusBanner {
  private readonly backendStatus = inject(BackendStatusService);

  readonly status = this.backendStatus.status;
  readonly visible = computed(
    () => this.status() === 'restarting' || this.status() === 'down',
  );
}
