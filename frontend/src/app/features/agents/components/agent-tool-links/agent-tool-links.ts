import { Component, computed, input } from '@angular/core';
import { LucideAngularModule, Wrench } from 'lucide-angular';
import {
  AgentToolDetail,
  AgentToolLink,
  ToolLinkStatus,
} from '../../services/agents-api.service';

const STATUS_LABELS: Record<ToolLinkStatus, string> = {
  'always-on': 'Always on',
  linked: 'Linked',
  'not-linked': 'Not linked',
};

const STATUS_CHIPS: Record<ToolLinkStatus, string> = {
  'always-on': 'chip chip-success',
  linked: 'chip chip-info',
  'not-linked': 'chip chip-neutral',
};

/**
 * The Tools tab of a user agent (ADR-0023): every library tool, sorted by
 * name, with whether the agent gets it and what links it.
 */
@Component({
  selector: 'app-agent-tool-links',
  imports: [LucideAngularModule],
  templateUrl: './agent-tool-links.html',
})
export class AgentToolLinks {
  readonly Wrench = Wrench;

  readonly toolLinks = input.required<AgentToolLink[]>();
  /** Supplies each tool's description, when the agent's detail has it. */
  readonly toolDetails = input<AgentToolDetail[]>([]);

  protected readonly rows = computed(() => {
    const details = new Map(this.toolDetails().map((t) => [t.name, t]));
    return [...this.toolLinks()]
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((tool) => ({
        ...tool,
        description: details.get(tool.name)?.description ?? '',
      }));
  });

  protected statusLabel(status: ToolLinkStatus): string {
    return STATUS_LABELS[status];
  }

  protected statusChip(status: ToolLinkStatus): string {
    return STATUS_CHIPS[status];
  }

  protected skillsLabel(skills: string[]): string {
    return `Linked by ${skills.join(', ')}`;
  }
}
