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

describe('AgentCard Start chat', () => {
  let fixture: ComponentFixture<AgentCard>;

  async function render(agent: Agent, starting = false): Promise<HTMLElement> {
    await TestBed.configureTestingModule({
      imports: [AgentCard],
    }).compileComponents();
    fixture = TestBed.createComponent(AgentCard);
    fixture.componentRef.setInput('agent', agent);
    fixture.componentRef.setInput('starting', starting);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  function startChat(el: HTMLElement): HTMLButtonElement | null {
    return el.querySelector('[aria-label="Start chat with Cup historian"]');
  }

  it('emits startChat without opening the detail', async () => {
    const el = await render(historian);
    const opened = jasmine.createSpy('open');
    const started = jasmine.createSpy('startChat');
    fixture.componentInstance.open.subscribe(opened);
    fixture.componentInstance.startChat.subscribe(started);

    startChat(el)!.click();

    expect(started).toHaveBeenCalledTimes(1);
    expect(opened).not.toHaveBeenCalled();
  });

  it('is not offered on a draft', async () => {
    const el = await render({ ...historian, status: 'draft' });
    expect(startChat(el)).toBeNull();
  });

  it("is disabled, with a title, when none of the agent's datasets exist", async () => {
    const el = await render({
      ...historian,
      missingDatasets: ['World Cup Core'],
    });
    const button = startChat(el)!;
    expect(button.disabled).toBeTrue();
    expect(button.title).toBe("None of this agent's datasets exist");
  });

  it('is disabled while the session is being created', async () => {
    const el = await render(historian, true);
    const button = startChat(el)!;
    expect(button.disabled).toBeTrue();
    expect(button.hasAttribute('title')).toBeFalse();
  });
});
