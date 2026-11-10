import { Component, computed, input } from '@angular/core';
import { AgentLlm } from '../../services/agents-api.service';

/**
 * The LLM Config tab (ADR-0024): the provider, model, key state and limits
 * an agent runs on, read-only. The API key is never shown, only whether one
 * is set.
 */
/**
 * The provider's display name: the server's `providerName` as sent, else
 * "Custom endpoint" for `custom` (llm-settings R53), else the raw id.
 */
function providerLabel(llm: AgentLlm): string {
  if (llm.providerName) return llm.providerName;
  if (llm.provider === 'custom') return 'Custom endpoint';
  if (llm.provider === 'copilot') return 'GitHub Copilot';
  return llm.provider ?? '—';
}

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
      { label: 'Provider', value: providerLabel(llm) },
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
