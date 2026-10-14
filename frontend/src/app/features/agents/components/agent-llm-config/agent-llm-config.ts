import { Component, computed, input } from '@angular/core';
import { AgentLlm } from '../../services/agents-api.service';

/**
 * The LLM Config tab (ADR-0023): the provider, model, key state and limits
 * an agent runs on, read-only. The API key is never shown, only whether one
 * is set.
 */
@Component({
  selector: 'app-agent-llm-config',
  templateUrl: './agent-llm-config.html',
})
export class AgentLlmConfig {
  readonly llm = input<AgentLlm | null | undefined>(null);
  /** A user agent that sets its own model. */
  readonly modelOverride = input(false);

  protected readonly rows = computed(() => {
    const llm = this.llm();
    if (!llm || llm.model === null) return null;
    return [
      { label: 'Provider', value: llm.providerName ?? llm.provider ?? '—' },
      {
        label: 'Model',
        value: `${llm.model}${this.modelOverride() ? ' (agent override)' : ''}`,
      },
      { label: 'API key', value: llm.apiKeyConfigured ? 'Set' : 'Not set' },
      {
        label: 'Max output tokens',
        value:
          llm.maxOutputTokens === null
            ? 'Default'
            : llm.maxOutputTokens.toLocaleString('en-US'),
      },
      { label: 'Reasoning effort', value: llm.reasoningEffort ?? 'Default' },
    ];
  });
}
