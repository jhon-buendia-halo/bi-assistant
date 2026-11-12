import { Component, inject } from '@angular/core';
import {
  ChevronDown,
  CircleCheck,
  CornerDownLeft,
  LucideAngularModule,
  Signal,
  Sparkle,
  Workflow,
} from 'lucide-angular';
import { ComposerState } from '../../services/composer-state';

/** The New conversation screen (sessions-chat R64). */
@Component({
  selector: 'app-new-conversation',
  imports: [LucideAngularModule],
  templateUrl: './new-conversation.html',
  styles: ':host { display: contents; }',
})
export class NewConversation {
  readonly composer = inject(ComposerState);

  readonly ChevronDown = ChevronDown;
  readonly CircleCheck = CircleCheck;
  readonly CornerDownLeft = CornerDownLeft;
  readonly Signal = Signal;
  readonly Sparkle = Sparkle;
  readonly Workflow = Workflow;
}
