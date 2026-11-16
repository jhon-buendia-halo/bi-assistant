import { Component, computed, input } from '@angular/core';
import { AgentDetail } from '../../services/agents-api.service';
import { agentDomain, domainInfo } from '../../services/agent-domains';
import { jobDescriptionCv } from '../../services/job-description-cv';
import { AgentAvatar } from '../../../../shared/components/agent-avatar/agent-avatar';
import { LinkedText } from '../linked-text/linked-text';

/**
 * The job description laid out as a two-column CV (ui.md 4.5, *CV view*):
 * on the left the agent's details the page already has (portrait, name,
 * title, team, the workflows it works on, its tools, model and memory); on
 * the right the job description's own words, sorted into CV sections
 * (`jobDescriptionCv`). Read-only; the text view and Edit stay as they were.
 */
@Component({
  selector: 'app-agent-cv',
  imports: [AgentAvatar, LinkedText],
  templateUrl: './agent-cv.html',
  styles: `
    .cv-label {
      font-size: 11px;
      font-weight: 600;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: var(--qti-fg-muted);
    }
    .cv-list {
      display: flex;
      flex-direction: column;
      gap: 6px;
      padding-left: 1.15rem;
    }
    .cv-list li {
      font-size: 14px;
      line-height: 1.6;
      color: var(--qti-fg);
    }
    .cv-list li::marker {
      color: var(--qti-primary);
    }
  `,
})
export class AgentCv {
  readonly agent = input.required<AgentDetail>();
  /** The job description to lay out: the stored text, links as written. */
  readonly text = input.required<string>();
  /** The links that exist, as `kind:name` (the text view's chips). */
  readonly known = input.required<ReadonlySet<string>>();
  /** The test id of the column that holds the job description's words. */
  readonly bodyTestId = input('agent-cv-body');

  readonly sections = computed(() => jobDescriptionCv(this.text()));

  readonly team = computed(() => domainInfo(agentDomain(this.agent())).label);

  readonly tools = computed(() => [...(this.agent().tools ?? [])]);

  readonly model = computed(() => this.agent().llm?.model ?? 'Not set');

  /** Memory in a few words: how many messages it keeps, or Off. */
  readonly memory = computed(() => {
    const memory = this.agent().memory;
    if (!memory || memory.lastMessages === false) return 'Off';
    if (typeof memory.lastMessages === 'number') {
      return `Last ${memory.lastMessages} messages`;
    }
    return 'On';
  });
}
