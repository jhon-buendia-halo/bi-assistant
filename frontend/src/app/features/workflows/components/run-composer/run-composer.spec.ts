import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { RunMessage } from '../run-message/run-message';
import { RunComposer } from './run-composer';

@Component({
  imports: [RunComposer, RunMessage],
  template: `
    <app-run-composer
      [value]="value()"
      placeholder="Message Avery"
      label="Message Avery"
      [canSend]="canSend()"
      [menuOpen]="open()"
      (valueChange)="value.set($event)"
      (send)="sent = sent + 1"
      (plus)="open.set(!open())"
    />
    <app-run-message from="user">Hi there</app-run-message>
    <app-run-message name="Avery" role="Chief of Staff"
      >Which data?</app-run-message
    >
    <app-run-message name="Avery" [bubble]="false">bare</app-run-message>
  `,
})
class Host {
  readonly value = signal('');
  readonly canSend = signal(false);
  readonly open = signal(false);
  sent = 0;
}

describe('RunComposer and RunMessage, the run chat pieces (ui.md 4.4b)', () => {
  let fixture: ComponentFixture<Host>;
  let host: Host;
  let el: HTMLElement;
  const q = (testId: string) =>
    el.querySelector(`[data-testid="${testId}"]`) as HTMLElement | null;

  beforeEach(() => {
    fixture = TestBed.createComponent(Host);
    host = fixture.componentInstance;
    el = fixture.nativeElement as HTMLElement;
    fixture.detectChanges();
  });

  function key(init: KeyboardEventInit): KeyboardEvent {
    const event = new KeyboardEvent('keydown', {
      key: 'Enter',
      bubbles: true,
      cancelable: true,
      ...init,
    });
    q('run-composer-input')!.dispatchEvent(event);
    fixture.detectChanges();
    return event;
  }

  it('is a labelled pill: +, a one-line box and a Send that is off until the host allows it', () => {
    expect(q('run-composer')!.getAttribute('aria-label')).toBe('Message Avery');
    const box = q('run-composer-input') as HTMLTextAreaElement;
    expect(box.rows).toBe(1);
    expect(box.placeholder).toBe('Message Avery');
    expect(el.querySelector(`label[for="${box.id}"]`)!.textContent).toBe(
      'Message Avery',
    );
    expect((q('run-composer-send') as HTMLButtonElement).disabled).toBeTrue();
    host.canSend.set(true);
    fixture.detectChanges();
    expect((q('run-composer-send') as HTMLButtonElement).disabled).toBeFalse();
  });

  it('+ says whether its menu is open', () => {
    const plus = q('run-composer-plus')!;
    expect(plus.getAttribute('aria-label')).toBe('Add inputs and options');
    expect(plus.getAttribute('aria-expanded')).toBe('false');
    plus.click();
    fixture.detectChanges();
    expect(plus.getAttribute('aria-expanded')).toBe('true');
  });

  it('typing reaches the host; Enter sends (the host decides), Shift+Enter adds a line', () => {
    const box = q('run-composer-input') as HTMLTextAreaElement;
    box.value = 'Hello';
    box.dispatchEvent(new Event('input'));
    expect(host.value()).toBe('Hello');
    expect(key({ shiftKey: true }).defaultPrevented).toBeFalse();
    expect(host.sent).toBe(0);
    // Even before change detection catches up with canSend.
    expect(key({}).defaultPrevented).toBeTrue();
    expect(host.sent).toBe(1);
  });

  it("puts the user's turn on the right and the agent's under its avatar and caption", () => {
    const user = q('run-user-message')!;
    expect(user.textContent?.trim()).toBe('Hi there');
    expect(user.closest('app-run-message')!.classList).toContain('justify-end');
    const agent = el.querySelectorAll('app-run-message')[1];
    expect(agent.textContent).toContain('Avery · Chief of Staff');
    expect(
      agent.querySelector('[aria-hidden="true"]')!.textContent?.trim(),
    ).toBe('A');
    expect(
      agent
        .querySelector('[data-testid="run-agent-message"]')!
        .textContent?.trim(),
    ).toBe('Which data?');
    // A bare turn keeps the row but no bubble.
    const bare = el.querySelectorAll('app-run-message')[2];
    expect(bare.querySelector('[data-testid="run-agent-message"]')).toBeNull();
    expect(bare.textContent).toContain('bare');
  });
});
