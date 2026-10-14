import { TestBed } from '@angular/core/testing';
import { AgentToolLink } from '../../services/agents-api.service';
import { AgentGraph, GRAPH_STEPS } from './agent-graph';

const tool = (
  name: string,
  status: AgentToolLink['status'],
): AgentToolLink => ({
  name,
  status,
  linkedVia: { instructions: false, skills: [] },
});

describe('AgentGraph', () => {
  function render() {
    const fixture = TestBed.createComponent(AgentGraph);
    fixture.componentRef.setInput(
      'instructions',
      'Use [[skill:planner]] and [[tool:sample_rows]].',
    );
    fixture.componentRef.setInput('skills', [
      { name: 'planner', tools: ['create_visual'] },
      { name: 'unused', tools: [] },
    ]);
    fixture.componentRef.setInput('toolLinks', [
      tool('create_visual', 'linked'),
      tool('sample_rows', 'linked'),
      tool('describe_entity', 'always-on'),
      tool('ask_clarification', 'not-linked'),
    ]);
    fixture.detectChanges();
    return fixture;
  }

  const nodes = (el: HTMLElement) =>
    [...el.querySelectorAll('[data-testid^="graph-node-"]')].map((n) =>
      n.getAttribute('data-testid')?.replace('graph-node-', ''),
    );

  it('draws the linked chain and the always-on tools', () => {
    const el: HTMLElement = render().nativeElement;
    expect(nodes(el)).toEqual([
      'prompt',
      'skill:planner',
      // Level with their parents; the always-on tool, which nothing links, last.
      'tool:sample_rows',
      'tool:create_visual',
      'tool:describe_entity',
    ]);
    expect(el.querySelector('svg title')?.textContent).toContain('Links');
    expect(el.querySelector('svg desc')?.textContent).toContain(
      'The planner skill links the create_visual tool',
    );
  });

  it('nodes are focusable, and focusing one dims what is not on its chain', () => {
    const fixture = render();
    const el: HTMLElement = fixture.nativeElement;
    const sample = el.querySelector(
      '[data-testid="graph-node-tool:sample_rows"]',
    ) as SVGElement;
    expect(sample.getAttribute('tabindex')).toBe('0');
    sample.dispatchEvent(new Event('focus'));
    fixture.detectChanges();
    expect(
      el
        .querySelector('[data-testid="graph-node-skill:planner"]')!
        .classList.contains('dim'),
    ).toBeTrue();
    expect(sample.classList.contains('dim')).toBeFalse();
  });

  it('Show unlinked adds the unlinked skills and not-linked tools', () => {
    const fixture = render();
    const el: HTMLElement = fixture.nativeElement;
    (el.querySelector('[data-testid="graph-show-unlinked"]') as HTMLInputElement).click();
    fixture.detectChanges();
    expect(nodes(el)).toContain('skill:unused');
    expect(nodes(el)).toContain('tool:ask_clarification');
  });

  it('has a legend and the four steps', () => {
    const el: HTMLElement = render().nativeElement;
    const legend = el.querySelector('.legend')!.textContent!;
    for (const item of ['Instructions', 'Skill', 'Tool', 'Always on']) {
      expect(legend).toContain(item);
    }
    expect(el.textContent).toContain('What happens on each message');
    expect(el.querySelectorAll('ol li').length).toBe(4);
    expect(el.querySelector('ol')!.textContent).toContain(GRAPH_STEPS[3]);
  });
});
