import { Component, computed, input, output } from '@angular/core';
import {
  LucideAngularModule,
  Pin,
  PinOff,
  TriangleAlert,
} from 'lucide-angular';
import { Agent } from '../../services/agents-api.service';
import { agentKind } from '../../services/agent-hub.util';
import { agentDomain, domainInfo } from '../../services/agent-domains';
import { AgentActivity } from '../../services/agent-activity';
import { AgentAvatar } from '../agent-avatar/agent-avatar';

/**
 * One agent on the hub (ui.md 4.4). The open control and the pin toggle are
 * sibling buttons, so no interactive control sits inside another. A card
 * never starts a chat: chats start from a workflow (agents-evals R53).
 */
@Component({
  selector: 'app-agent-card',
  imports: [LucideAngularModule, AgentAvatar],
  templateUrl: './agent-card.html',
  host: { class: 'block h-full' },
})
export class AgentCard {
  readonly Pin = Pin;
  readonly PinOff = PinOff;
  readonly TriangleAlert = TriangleAlert;

  readonly agent = input.required<Agent>();
  /** What the agent is doing now; absent until the run history loads. */
  readonly activity = input<AgentActivity | null>(null);
  readonly open = output<void>();
  readonly togglePin = output<void>();

  /** The domain's label and the icon of the badge on the portrait (ui.md 4.4). */
  readonly domain = computed(() => domainInfo(agentDomain(this.agent())));

  readonly isUser = computed(() => agentKind(this.agent()) === 'user');

  readonly owner = computed(() => {
    const agent = this.agent();
    if (agent.owner) return agent.owner;
    const kind = agentKind(agent);
    return kind === 'user'
      ? 'You'
      : kind === 'official'
        ? 'Official'
        : 'System';
  });

  readonly missing = computed(() =>
    (this.agent().missingDatasets ?? []).join(', '),
  );
}
