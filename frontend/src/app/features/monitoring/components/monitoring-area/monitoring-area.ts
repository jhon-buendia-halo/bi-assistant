import { Component, inject } from '@angular/core';
import { ArrowLeft, LucideAngularModule } from 'lucide-angular';
import { ShellState } from '../../../../core/shell/shell-state';
import { RunsState } from '../../../runs/services/runs-state';
import { SessionsState } from '../../../sessions/services/sessions-state';
import { MonitoringNavState } from '../../services/monitoring-nav-state';
import { LlmCallDetailPage } from '../llm-call-detail/llm-call-detail';
import { MonitoringTabs } from '../monitoring-tabs/monitoring-tabs';
import { SessionFlowPage } from '../session-flow/session-flow';

/** The Monitoring area: the LLM calls table, a call and a session's flow. */
@Component({
  selector: 'app-monitoring-area',
  imports: [
    LucideAngularModule,
    MonitoringTabs,
    LlmCallDetailPage,
    SessionFlowPage,
  ],
  templateUrl: './monitoring-area.html',
  styles: ':host { display: contents; }',
})
export class MonitoringArea {
  readonly shell = inject(ShellState);
  readonly monitoring = inject(MonitoringNavState);
  readonly sessions = inject(SessionsState);
  readonly runs = inject(RunsState);
  readonly ArrowLeft = ArrowLeft;
}
