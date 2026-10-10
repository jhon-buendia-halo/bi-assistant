import { Component, computed, input, output } from '@angular/core';
import {
  Loader2,
  LucideAngularModule,
  MessageSquarePlus,
  Pin,
  PinOff,
  Sparkles,
  TriangleAlert,
} from 'lucide-angular';
import { Agent } from '../../services/agents-api.service';
import {
  agentKind,
  canStartChat,
  startChatBlockedReason,
} from '../../services/agent-hub.util';

/**
 * One agent on the hub (ui.md 4.4). The open control, the pin toggle and
 * Start chat are sibling buttons, so no interactive control sits inside
 * another.
 */
@Component({
  selector: 'app-agent-card',
  imports: [LucideAngularModule],
  templateUrl: './agent-card.html',
  host: { class: 'block h-full' },
})
export class AgentCard {
  readonly Loader2 = Loader2;
  readonly MessageSquarePlus = MessageSquarePlus;
  readonly Pin = Pin;
  readonly PinOff = PinOff;
  readonly Sparkles = Sparkles;
  readonly TriangleAlert = TriangleAlert;

  readonly agent = input.required<Agent>();
  /** True while a session is being created from this agent. */
  readonly starting = input(false);
  readonly open = output<void>();
  readonly togglePin = output<void>();
  readonly startChat = output<void>();

  /** Official and Live user agents only (agents-evals R53). */
  readonly showStartChat = computed(() => canStartChat(this.agent()));
  /** Set when none of the agent's datasets exist; disables Start chat. */
  readonly blockedReason = computed(() =>
    startChatBlockedReason(this.agent()),
  );

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
