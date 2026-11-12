import { Component, inject } from '@angular/core';
import {
  Copy,
  Database,
  LucideAngularModule,
  PanelRight,
  Workflow,
} from 'lucide-angular';
import { ShellState } from '../../../../core/shell/shell-state';
import { kindLabel } from '../../../datasources/models/datasource.model';
import { sessionWorkflowLabel } from '../../models/session.model';
import { SessionsState } from '../../services/sessions-state';

/** The Sessions area's page header (app-shell R49, past-chats R57). */
@Component({
  selector: 'app-sessions-header',
  imports: [LucideAngularModule],
  templateUrl: './sessions-header.html',
  styles: ':host { display: contents; }',
})
export class SessionsHeader {
  readonly shell = inject(ShellState);
  readonly state = inject(SessionsState);

  readonly Copy = Copy;
  readonly Database = Database;
  readonly PanelRight = PanelRight;
  readonly Workflow = Workflow;
  readonly datasourceKindLabel = kindLabel;
  /** The page header's Workflow chip, for every session (past-chats R57). */
  readonly workflowLabel = sessionWorkflowLabel;
}
