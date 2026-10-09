import { Component, computed, input, output } from '@angular/core';
import {
  LucideAngularModule,
  Pin,
  PinOff,
  Sparkles,
  TriangleAlert,
} from 'lucide-angular';
import { Agent } from '../../services/agents-api.service';
import { agentKind } from '../../services/agent-hub.util';

/**
 * One agent on the hub (ui.md 4.4). The open control and the pin toggle are
 * sibling buttons, so no interactive control sits inside another.
 */
@Component({
  selector: 'app-agent-card',
  imports: [LucideAngularModule],
  templateUrl: './agent-card.html',
  host: { class: 'block h-full' },
})
export class AgentCard {
  readonly Pin = Pin;
  readonly PinOff = PinOff;
  readonly Sparkles = Sparkles;
  readonly TriangleAlert = TriangleAlert;

  readonly agent = input.required<Agent>();
  readonly open = output<void>();
  readonly togglePin = output<void>();

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
