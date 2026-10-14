import { Component, computed, input, signal } from '@angular/core';
import { AgentToolLink } from '../../services/agents-api.service';
import {
  GraphNode,
  NODE_H,
  NODE_W,
  buildFlowGraph,
  connectedTo,
} from '../../services/flow-graph';
import { SkillSummary } from '../../services/skills-api.service';

/** The four steps under the graph (ADR-0024). */
export const GRAPH_STEPS = [
  "The assistant's core prompt and this agent's instructions are sent, with links turned into plain mentions.",
  'The skill catalog lists the built-in skills and the linked skills; the model reads a skill when a question matches it.',
  'The model can call the always-on data tools and the linked tools, including those its linked skills link.',
  "Every answer comes from read-only queries over the agent's datasets.",
];

/**
 * The Graph tab of a user agent (ADR-0024): its instructions, the skills they
 * link and the tools linked from either, as an SVG, and what happens on each
 * message. Hover or focus a node to trace its chain.
 */
@Component({
  selector: 'app-agent-graph',
  templateUrl: './agent-graph.html',
  styleUrl: './agent-graph.scss',
})
export class AgentGraph {
  /** The agent's instructions, with their links. */
  readonly instructions = input.required<string>();
  /** The owner's skills, with the tools each links. */
  readonly skills = input.required<Pick<SkillSummary, 'name' | 'tools'>[]>();
  readonly toolLinks = input.required<AgentToolLink[]>();

  protected readonly steps = GRAPH_STEPS;
  protected readonly NODE_W = NODE_W;
  protected readonly NODE_H = NODE_H;
  protected readonly showUnlinked = signal(false);
  protected readonly focused = signal<string | null>(null);

  protected readonly graph = computed(() =>
    buildFlowGraph(
      {
        instructions: this.instructions(),
        skills: this.skills(),
        toolLinks: this.toolLinks(),
      },
      this.showUnlinked(),
    ),
  );

  private readonly highlighted = computed(() => {
    const id = this.focused();
    return id ? connectedTo(this.graph(), id) : null;
  });

  protected dimmed(...ids: string[]): boolean {
    const highlighted = this.highlighted();
    return !!highlighted && !ids.every((id) => highlighted.has(id));
  }

  protected nodeLabel(node: GraphNode): string {
    return `${node.name}, ${node.subtitle}`;
  }
}
