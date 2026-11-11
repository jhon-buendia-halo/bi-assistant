import { TestBed } from '@angular/core/testing';
import { AgentWorkflow } from '../../services/agents-api.service';
import { AgentWorkflowView } from './agent-workflow';

const WORKFLOW: AgentWorkflow = {
  id: 'qti-v2-turn',
  steps: [
    {
      id: 'load-catalog',
      title: 'Load catalog',
      kind: 'code',
      summary: 'Lists the entities.',
      input: ['question', 'datasets'],
      output: ['question', 'catalog'],
      exits: [],
    },
    {
      id: 'analyse',
      title: 'Analyse',
      kind: 'agent',
      summary: 'The agent answers.',
      input: ['question', 'catalog'],
      output: ['calls', 'stopped'],
      agent: {
        name: 'Questions to Insights v2',
        tools: ['list_entities', 'run_readonly_sql'],
        maxSteps: 15,
      },
      exits: [{ label: 'Stop', outcome: 'stops' }],
    },
  ],
};

describe('AgentWorkflowView (agents-evals R108)', () => {
  function render() {
    const fixture = TestBed.createComponent(AgentWorkflowView);
    fixture.componentRef.setInput('workflow', WORKFLOW);
    fixture.detectChanges();
    return fixture;
  }

  const q = (el: HTMLElement, id: string) =>
    el.querySelector<HTMLElement>(`[data-testid="${id}"]`);

  it('draws one card per step, the agent step open with its tools and limit', () => {
    const el = render().nativeElement as HTMLElement;
    const titles = [
      ...el.querySelectorAll('[data-testid="workflow-step-title"]'),
    ].map((t) => t.textContent?.trim());
    expect(titles).toEqual(['Load catalog', 'Analyse']);
    const analyse = q(el, 'workflow-step-analyse')!;
    expect(
      analyse.querySelector('[data-testid="workflow-step-kind"]')?.textContent,
    ).toBe('LLM');
    expect(
      [...analyse.querySelectorAll('[data-testid="workflow-step-tool"]')].map(
        (t) => t.textContent,
      ),
    ).toEqual(['list_entities', 'run_readonly_sql']);
    expect(
      analyse.querySelector('[data-testid="workflow-step-loop"]')?.textContent,
    ).toContain('≤ 15 steps');
    expect(
      q(el, 'workflow-step-load-catalog')?.querySelector(
        '[data-testid="workflow-step-kind"]',
      )?.textContent,
    ).toBe('Code');
  });

  it('labels the arrow between steps and lists the other exits', () => {
    const el = render().nativeElement as HTMLElement;
    expect(q(el, 'workflow-edge-load-catalog')?.textContent).toContain(
      'question, catalog',
    );
    expect(q(el, 'workflow-edge-analyse')).toBeNull();
    expect(
      [...el.querySelectorAll('[data-testid="workflow-step-exit"]')].map((e) =>
        e.textContent?.trim(),
      ),
    ).toEqual(['Stop → ends the turn here']);
  });

  it('shows a step’s details when selected and closes them on a second click', () => {
    const fixture = render();
    const el = fixture.nativeElement as HTMLElement;
    expect(q(el, 'workflow-step-details')).toBeNull();

    const card = q(el, 'workflow-step-load-catalog')!;
    card.click();
    fixture.detectChanges();
    expect(card.getAttribute('aria-pressed')).toBe('true');
    expect(q(el, 'workflow-detail-input')?.textContent?.trim()).toBe(
      'question, datasets',
    );
    expect(q(el, 'workflow-detail-output')?.textContent?.trim()).toBe(
      'question, catalog',
    );
    expect(q(el, 'workflow-step-details')?.textContent).not.toContain(
      'Max steps',
    );

    q(el, 'workflow-step-analyse')!.click();
    fixture.detectChanges();
    expect(q(el, 'workflow-step-details')?.textContent).toContain('Max steps');
    expect(card.getAttribute('aria-pressed')).toBe('false');

    q(el, 'workflow-step-analyse')!.click();
    fixture.detectChanges();
    expect(q(el, 'workflow-step-details')).toBeNull();
  });
});
