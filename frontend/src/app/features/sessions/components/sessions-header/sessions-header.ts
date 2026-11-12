import { Component, inject } from '@angular/core';
import {
  Copy,
  Database,
  LucideAngularModule,
  PanelRight,
  SquarePen,
  Workflow,
} from 'lucide-angular';
import { ShellState } from '../../../../core/shell/shell-state';
import { kindLabel } from '../../../datasources/models/datasource.model';
import { sessionWorkflowLabel } from '../../models/session.model';
import { ComposerState } from '../../services/composer-state';
import { SessionsState } from '../../services/sessions-state';

/** The Sessions area's page header (app-shell R49, sessions-chat R57). */
@Component({
  selector: 'app-sessions-header',
  imports: [LucideAngularModule],
  templateUrl: './sessions-header.html',
  styles: ':host { display: contents; }',
})
export class SessionsHeader {
  readonly shell = inject(ShellState);
  readonly state = inject(SessionsState);
  readonly composer = inject(ComposerState);

  readonly Copy = Copy;
  readonly Database = Database;
  readonly PanelRight = PanelRight;
  readonly SquarePen = SquarePen;
  readonly Workflow = Workflow;
  readonly datasourceKindLabel = kindLabel;
  /** The page header's Workflow chip, for every session (sessions-chat R57). */
  readonly workflowLabel = sessionWorkflowLabel;
}
