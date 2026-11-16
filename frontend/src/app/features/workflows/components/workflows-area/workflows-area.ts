import { Component, inject } from '@angular/core';
import { ShellState } from '../../../../core/shell/shell-state';
import { AgentsNavState } from '../../../agents/services/agents-nav-state';
import { WorkflowsNavState } from '../../services/workflows-nav-state';
import { WorkflowDetailPage } from '../workflow-detail/workflow-detail';
import { WorkflowsPage } from '../workflows-page/workflows-page';

/** The Workflows area: the list and a workflow's page (workflows R5-R8). */
@Component({
  selector: 'app-workflows-area',
  imports: [WorkflowsPage, WorkflowDetailPage],
  templateUrl: './workflows-area.html',
  styles: ':host { display: contents; }',
})
export class WorkflowsArea {
  readonly shell = inject(ShellState);
  readonly workflows = inject(WorkflowsNavState);
  readonly agents = inject(AgentsNavState);
}
