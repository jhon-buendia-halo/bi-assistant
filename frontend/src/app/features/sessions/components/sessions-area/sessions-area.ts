import { Component, inject } from '@angular/core';
import { ShellState } from '../../../../core/shell/shell-state';
import { ComposerState } from '../../services/composer-state';
import { SessionsState } from '../../services/sessions-state';
import { NewConversation } from '../new-conversation/new-conversation';
import { SessionChat } from '../session-chat/session-chat';
import { SessionsList } from '../sessions-list/sessions-list';
import { WorkflowBar } from '../workflow-bar/workflow-bar';

/** The Sessions area: the list, an open chat and the New conversation screen. */
@Component({
  selector: 'app-sessions-area',
  imports: [SessionChat, WorkflowBar, SessionsList, NewConversation],
  templateUrl: './sessions-area.html',
  styles: ':host { display: contents; }',
})
export class SessionsArea {
  readonly shell = inject(ShellState);
  readonly state = inject(SessionsState);
  readonly composer = inject(ComposerState);
}
