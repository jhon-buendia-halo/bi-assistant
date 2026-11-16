import { Component } from '@angular/core';
import { DashboardPage } from '../dashboard-page/dashboard-page';

/** The Dashboard area: the usage and cost overview of the app's agents. */
@Component({
  selector: 'app-dashboard-area',
  imports: [DashboardPage],
  template: `
    <div class="flex flex-1 justify-center overflow-y-auto px-6 py-6">
      <div
        class="flex w-full max-w-[1120px] min-w-0 flex-col gap-3"
        data-testid="dashboard-page"
      >
        <h2
          class="text-[20px] leading-7 font-light tracking-[0.12px] text-fg-strong"
        >
          Dashboard
        </h2>
        @defer (on immediate) {
          <app-dashboard-page />
        }
      </div>
    </div>
  `,
  styles: ':host { display: contents; }',
})
export class DashboardArea {}
