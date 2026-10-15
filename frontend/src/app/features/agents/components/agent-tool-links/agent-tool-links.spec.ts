import { TestBed } from '@angular/core/testing';
import { AgentToolLink } from '../../services/agents-api.service';
import { AgentToolLinks } from './agent-tool-links';

const LINKS: AgentToolLink[] = [
  {
    name: 'sample_rows',
    status: 'linked',
    linkedVia: { instructions: true, skills: ['planner', 'budget'] },
  },
  {
    name: 'create_visual',
    status: 'linked',
    linkedVia: { instructions: false, skills: ['planner'] },
  },
  {
    name: 'ask_clarification',
    status: 'not-linked',
    linkedVia: { instructions: false, skills: [] },
  },
  {
    name: 'describe_entity',
    status: 'always-on',
    linkedVia: { instructions: false, skills: [] },
  },
];

describe('AgentToolLinks', () => {
  function render(): HTMLElement {
    const fixture = TestBed.createComponent(AgentToolLinks);
    fixture.componentRef.setInput('toolLinks', LINKS);
    fixture.componentRef.setInput('toolDetails', [
      { name: 'sample_rows', description: 'Reads rows.', inputs: [] },
    ]);
    fixture.detectChanges();
    return fixture.nativeElement;
  }

  const text = (el: HTMLElement, id: string) =>
    el.querySelector(`[data-testid="${id}"]`)?.textContent?.replace(/\s+/g, ' ').trim();

  it('lists every tool sorted by name', () => {
    const names = [...render().querySelectorAll('[data-testid^="tool-link-"]')].map(
      (node) => node.getAttribute('data-testid'),
    );
    expect(names).toEqual([
      'tool-link-ask_clarification',
      'tool-link-create_visual',
      'tool-link-describe_entity',
      'tool-link-sample_rows',
    ]);
  });

  it('shows Always on, Linked and Not linked', () => {
    const el = render();
    expect(text(el, 'tool-status-describe_entity')).toBe('Always on');
    expect(text(el, 'tool-status-sample_rows')).toBe('Linked');
    expect(text(el, 'tool-status-ask_clarification')).toBe('Not linked');
    expect(
      el.querySelector('[data-testid="tool-status-describe_entity"]')!.className,
    ).toContain('chip-success');
  });

  it('says what links a tool', () => {
    const el = render();
    expect(text(el, 'tool-link-sample_rows')).toContain(
      'Linked from the instructions',
    );
    expect(text(el, 'tool-link-sample_rows')).toContain(
      'Linked by planner, budget',
    );
    expect(text(el, 'tool-link-create_visual')).not.toContain(
      'Linked from the instructions',
    );
    expect(text(el, 'tool-link-create_visual')).toContain('Linked by planner');
    expect(text(el, 'tool-link-ask_clarification')).not.toContain('Linked by');
    expect(text(el, 'tool-link-sample_rows')).toContain('Reads rows.');
  });
});
