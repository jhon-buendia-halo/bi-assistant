import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Agent } from '../../services/agents-api.service';
import { AgentCard } from './agent-card';

const historian: Agent = {
  key: 'u-historian',
  id: 'u-historian',
  name: 'Cup historian',
  description: 'Answers questions about World Cup history',
  tools: [],
  kind: 'user',
  status: 'live',
  owner: 'You',
  datasets: ['World Cup Core'],
  missingDatasets: [],
};

const assistant: Agent = {
  key: 'assistant',
  id: 'assistant',
  name: 'Questions to Insights Assistant',
  description: 'Answers questions',
  tools: [],
  kind: 'official',
  owner: 'Official',
  datasets: [],
};

/** A card is a building block: it opens the agent, never a chat (R1, R53). */
describe('AgentCard', () => {
  let fixture: ComponentFixture<AgentCard>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AgentCard],
    }).compileComponents();
  });

  function render(agent: Agent): HTMLElement {
    fixture = TestBed.createComponent(AgentCard);
    fixture.componentRef.setInput('agent', agent);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  it('offers no Start chat on an Official or a Live user agent', () => {
    for (const agent of [historian, assistant]) {
      const el = render(agent);
      expect(el.textContent).not.toContain('Start chat');
      expect(el.querySelector('[data-testid^="agent-start-chat"]')).toBeNull();
    }
  });

  it('opens the agent from its open control', () => {
    const el = render(historian);
    const opened = jasmine.createSpy('open');
    fixture.componentInstance.open.subscribe(opened);
    el.querySelector<HTMLButtonElement>(
      '[data-testid="agent-u-historian"]',
    )!.click();
    expect(opened).toHaveBeenCalledTimes(1);
  });

  it('shows the persona: the human name with the job title under it', () => {
    const el = render({ ...assistant, name: 'Emily', role: 'Data Analyst' });
    expect(el.textContent).toContain('Emily');
    expect(
      el.querySelector('[data-testid="agent-role-assistant"]')?.textContent,
    ).toBe('Data Analyst');
    // No job title, no empty line.
    expect(
      render(historian).querySelector('[data-testid^="agent-role-"]'),
    ).toBeNull();
  });
});
