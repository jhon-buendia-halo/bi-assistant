import { TestBed } from '@angular/core/testing';
import { AgentLlm } from '../../services/agents-api.service';
import { AgentLlmConfig } from './agent-llm-config';

const LLM: AgentLlm = {
  provider: 'openai',
  providerName: 'OpenAI',
  model: 'gpt-4.1',
  apiKeyConfigured: true,
  maxOutputTokens: 4096,
  reasoningEffort: 'medium',
};

function render(llm: AgentLlm | null, modelOverride = false): HTMLElement {
  const fixture = TestBed.createComponent(AgentLlmConfig);
  fixture.componentRef.setInput('llm', llm);
  fixture.componentRef.setInput('modelOverride', modelOverride);
  fixture.detectChanges();
  return fixture.nativeElement;
}

const value = (el: HTMLElement, label: string) =>
  el
    .querySelector(`[data-testid="llm-${label}"] span:last-child`)
    ?.textContent?.trim();

describe('AgentLlmConfig', () => {
  it('shows the provider, model, key state, limit and effort', () => {
    const el = render(LLM);
    expect(value(el, 'Provider')).toBe('OpenAI');
    expect(value(el, 'Model')).toBe('gpt-4.1');
    expect(value(el, 'API key')).toBe('Set');
    expect(value(el, 'Max output tokens')).toBe('4,096');
    expect(value(el, 'Reasoning effort')).toBe('medium');
  });

  it('marks a model the agent sets itself', () => {
    expect(value(render(LLM, true), 'Model')).toBe('gpt-4.1 (agent override)');
  });

  it('says Not set without a key and never renders a key value', () => {
    // The API never sends a key; even a stray field must not reach the page.
    const stray = { ...LLM, apiKeyConfigured: false, apiKey: 'sk-secret-123' };
    const el = render(stray as AgentLlm);
    expect(value(el, 'API key')).toBe('Not set');
    expect(el.textContent).not.toContain('sk-secret-123');
    expect(el.textContent).not.toContain('sk-');
  });

  it('uses Default for an unset limit or effort', () => {
    const el = render({ ...LLM, maxOutputTokens: null, reasoningEffort: null });
    expect(value(el, 'Max output tokens')).toBe('Default');
    expect(value(el, 'Reasoning effort')).toBe('Default');
  });

  it('explains when no LLM is saved', () => {
    const el = render({
      provider: null,
      providerName: null,
      model: null,
      apiKeyConfigured: false,
      maxOutputTokens: null,
      reasoningEffort: null,
    });
    expect(el.textContent).toContain('No model resolved');
  });
});
