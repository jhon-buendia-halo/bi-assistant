import { Component, inject } from '@angular/core';
import { ShellState } from '../../../../core/shell/shell-state';
import { RunDetail } from '../../../runs/components/run-detail/run-detail';
import { RunsPage } from '../../../runs/components/runs-page/runs-page';
import { SessionsState } from '../../services/sessions-state';
import { SessionChat } from '../session-chat/session-chat';
import { WorkflowBar } from '../workflow-bar/workflow-bar';

/**
 * The Runs area: the Runs page with its Past chats tab, an open run, an open
 * chat (a past chat is read-only).
 */
@Component({
  selector: 'app-sessions-area',
  imports: [SessionChat, WorkflowBar, RunsPage, RunDetail],
  templateUrl: './sessions-area.html',
  styles: ':host { display: contents; }',
})
export class SessionsArea {
  readonly shell = inject(ShellState);
  readonly state = inject(SessionsState);
}
