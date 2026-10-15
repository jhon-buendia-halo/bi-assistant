import { TestBed } from '@angular/core/testing';
import { Welcome } from './welcome';

describe('Welcome', () => {
  function create() {
    const fixture = TestBed.createComponent(Welcome);
    fixture.detectChanges();
    return fixture;
  }

  it('explains the product in four steps', () => {
    const el: HTMLElement = create().nativeElement;
    expect(el.querySelector('h2')?.textContent).toContain(
      'Welcome to Agentic Hub',
    );
    const steps = [...el.querySelectorAll('ol[aria-label="How it works"] li')];
    expect(steps.map((s) => s.querySelector('p')?.textContent?.trim())).toEqual(
      [
        '1 Pick your data',
        '2 Ask a question',
        '3 Work with an agent',
        '4 Read, refine, download',
      ],
    );
  });

  it('opens the place each step names', () => {
    const fixture = create();
    const welcome = fixture.componentInstance;
    const fired: string[] = [];
    welcome.openDatasets.subscribe(() => fired.push('datasets'));
    welcome.startConversation.subscribe(() => fired.push('conversation'));
    welcome.openAgents.subscribe(() => fired.push('agents'));
    const el: HTMLElement = fixture.nativeElement;
    const click = (label: string) =>
      [...el.querySelectorAll<HTMLButtonElement>('button')]
        .find((b) => b.textContent?.trim() === label)!
        .click();

    click('Datasets');
    click('Agents');
    el.querySelector<HTMLButtonElement>(
      '[data-testid="welcome-agents"]',
    )!.click();

    click('Start a conversation');

    expect(fired).toEqual(['datasets', 'agents', 'agents', 'conversation']);
  });
});
