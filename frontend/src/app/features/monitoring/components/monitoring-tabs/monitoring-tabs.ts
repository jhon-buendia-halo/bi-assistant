import { Component, inject, output } from '@angular/core';
import {
  MonitoringStateService,
  MonitoringTab,
} from '../../services/monitoring-state.service';
import { AgentQualityPage } from '../agent-quality-page/agent-quality-page';
import { LlmCallsPage } from '../llm-calls-page/llm-calls-page';
import { SessionsPage } from '../sessions-page/sessions-page';

/**
 * The Monitoring page's tabs, LLM calls, Runs and Agent quality (roadmap
 * 1.21.16, monitoring R26), and the chosen tab's panel. The tab is kept in
 * MonitoringStateService.
 */
@Component({
  selector: 'app-monitoring-tabs',
  imports: [LlmCallsPage, SessionsPage, AgentQualityPage],
  templateUrl: './monitoring-tabs.html',
})
export class MonitoringTabs {
  readonly state = inject(MonitoringStateService);

  /** A call to open, from the LLM calls table. */
  readonly openCall = output<string>();
  /** A session to open, from the Sessions table. */
  readonly openSession = output<string>();
  /** An agent's registry key, from the Agent quality table. */
  readonly openAgentEvals = output<string>();

  readonly tabs: { id: MonitoringTab; label: string }[] = [
    { id: 'calls', label: 'LLM calls' },
    { id: 'sessions', label: 'Runs' },
    { id: 'quality', label: 'Agent quality' },
  ];

  readonly notes: Record<MonitoringTab, string> = {
    calls: "LLM calls made by the app's agent personas, newest first.",
    sessions: 'Runs with recorded agent persona calls, most recent first.',
    quality:
      'How each agent persona scores on its evals and behaves in live calls.',
  };

  /** Chooses a tab; the keys also move the focus to it. */
  select(tab: MonitoringTab, focus = false): void {
    this.state.setTab(tab);
    if (focus) {
      queueMicrotask(() =>
        document.getElementById(`monitoring-tab-${tab}`)?.focus(),
      );
    }
  }

  /** The tab `delta` places from `tab`, wrapping at the ends. */
  step(tab: MonitoringTab, delta: number): MonitoringTab {
    const index = this.tabs.findIndex((t) => t.id === tab);
    const count = this.tabs.length;
    return this.tabs[(index + delta + count) % count].id;
  }

  first(): MonitoringTab {
    return this.tabs[0].id;
  }

  last(): MonitoringTab {
    return this.tabs[this.tabs.length - 1].id;
  }

  /** Home and End must not scroll the page. */
  jump(event: Event, tab: MonitoringTab): void {
    event.preventDefault();
    this.select(tab, true);
  }
}
