import { Component, inject, output } from '@angular/core';
import {
  MonitoringStateService,
  MonitoringTab,
} from '../../services/monitoring-state.service';
import { LlmCallsPage } from '../llm-calls-page/llm-calls-page';
import { SessionsPage } from '../sessions-page/sessions-page';

/**
 * The Monitoring page's tabs, LLM calls and Sessions (roadmap 1.21.16), and
 * the chosen tab's panel. The tab is kept in MonitoringStateService.
 */
@Component({
  selector: 'app-monitoring-tabs',
  imports: [LlmCallsPage, SessionsPage],
  templateUrl: './monitoring-tabs.html',
})
export class MonitoringTabs {
  readonly state = inject(MonitoringStateService);

  /** A call to open, from the LLM calls table. */
  readonly openCall = output<string>();
  /** A session to open, from the Sessions table. */
  readonly openSession = output<string>();

  readonly tabs: { id: MonitoringTab; label: string }[] = [
    { id: 'calls', label: 'LLM calls' },
    { id: 'sessions', label: 'Sessions' },
  ];

  /** Chooses a tab; the arrow keys also move the focus to it. */
  select(tab: MonitoringTab, focus = false): void {
    this.state.setTab(tab);
    if (focus) {
      queueMicrotask(() =>
        document.getElementById(`monitoring-tab-${tab}`)?.focus(),
      );
    }
  }

  /** The other tab: with two tabs, both arrow keys lead there. */
  other(tab: MonitoringTab): MonitoringTab {
    return tab === 'calls' ? 'sessions' : 'calls';
  }
}
