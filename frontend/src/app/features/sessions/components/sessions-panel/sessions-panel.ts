import { Component, inject } from '@angular/core';
import { SessionsState } from '../../services/sessions-state';
import { SessionPanel } from '../session-panel/session-panel';

/**
 * The right panel's body for an open chat. Deferred: the panel views stay out
 * of the initial bundle.
 */
@Component({
  selector: 'app-sessions-panel',
  imports: [SessionPanel],
  templateUrl: './sessions-panel.html',
  styles: ':host { display: contents; }',
})
export class SessionsPanel {
  readonly state = inject(SessionsState);
}
