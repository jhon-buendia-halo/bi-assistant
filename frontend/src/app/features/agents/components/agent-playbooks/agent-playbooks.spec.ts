import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { AgentsApiService } from '../../services/agents-api.service';
import { AgentPlaybooks } from './agent-playbooks';

const ROUTER = `# Playbooks

## Pick one playbook
- Score 0–1 → no playbook.
- Ranking words → read reference/ranking.md

## When something happens during the run
- A check failed → read reference/failed-check.md
`;
const FILES: Record<string, string> = {
  'SKILL.md': ROUTER,
  'reference/ranking.md':
    '# Ranking\n\n1. Plan.\n2. Brief Michael.\n\n**Reply:** the winner.',
  'reference/failed-check.md':
    '# Failed check\n\n1. Fix it.\n\n**Reply:** what failed.',
};

describe('AgentPlaybooks (the CV view’s Playbooks section)', () => {
  let fixture: ComponentFixture<AgentPlaybooks>;
  const el = () => fixture.nativeElement as HTMLElement;
  const all = (id: string) =>
    Array.from(el().querySelectorAll<HTMLElement>(`[data-testid="${id}"]`));

  function render(files: string[]) {
    const api = {
      skillFile: (_k: string, _n: string, path: string) =>
        of({ path, size: 1, content: FILES[path] ?? null }),
    };
    TestBed.configureTestingModule({
      imports: [AgentPlaybooks],
      providers: [{ provide: AgentsApiService, useValue: api }],
    });
    fixture = TestBed.createComponent(AgentPlaybooks);
    fixture.componentRef.setInput('agentKey', 'chief-of-staff');
    fixture.componentRef.setInput('agentName', 'Avery');
    fixture.componentRef.setInput('skill', {
      name: 'avery-playbooks',
      description: '',
      loading: 'on-demand',
      level: 'built-in',
      files: files.map((path) => ({ path, size: 1 })),
    });
    fixture.detectChanges();
  }

  it('lists the playbooks in the router’s order, the first open with its steps and Reply; a click opens another', () => {
    render([...Object.keys(FILES), 'reference/notes/deep.md', 'README.txt']);
    const rows = all('agent-playbook');
    expect(rows.map((r) => r.getAttribute('data-path'))).toEqual([
      'reference/ranking.md',
      'reference/failed-check.md',
    ]);
    expect(rows[0].textContent).toContain('Picked first');
    expect(rows[0].textContent).toContain('Ranking words');
    expect(rows[1].textContent).toContain('During the run');
    expect(all('agent-playbook-body').length).toBe(1);
    expect(all('agent-playbook-reply')[0].textContent).toContain('the winner.');
    expect(all('agent-playbooks-note')[0].textContent).toContain('Score 0–1');

    const toggles = all('agent-playbook-toggle');
    toggles[1].click();
    fixture.detectChanges();
    expect(toggles[1].getAttribute('aria-expanded')).toBe('true');
    expect(all('agent-playbook-body').length).toBe(2);
  });

  it('shows nothing when the skill has no playbook files', () => {
    render(['SKILL.md']);
    expect(
      el().querySelector('[data-testid="agent-cv-section-playbooks"]'),
    ).toBeNull();
  });
});
