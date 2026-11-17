import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ChatHistoryItem, ChatHistoryNav } from './chat-history-nav';

@Component({
  imports: [ChatHistoryNav],
  template: `
    <div
      #scroller
      data-testid="scroller"
      style="height: 120px; overflow-y: auto; position: relative"
    >
      @for (m of messages(); track m) {
        <p [attr.data-history-id]="m" style="height: 100px; margin: 0">
          {{ m }}
        </p>
      }
    </div>
    <app-chat-history-nav
      [container]="scroller"
      [items]="items()"
      label="Test chat"
      testIdPrefix="t"
      (picked)="picks.push($event)"
    />
  `,
})
class Host {
  readonly messages = signal<string[]>(['a', 'b', 'c']);
  readonly picks: string[] = [];
  items(): ChatHistoryItem[] {
    return this.messages().map((id) => ({ id, label: 'Question ' + id }));
  }
}

describe('ChatHistoryNav', () => {
  let fixture: ComponentFixture<Host>;
  let el: HTMLElement;

  const flush = async () => {
    fixture.detectChanges();
    await new Promise((r) => setTimeout(r, 30));
    fixture.detectChanges();
  };
  const scroller = () =>
    el.querySelector<HTMLElement>('[data-testid="scroller"]')!;
  const currents = () =>
    Array.from(el.querySelectorAll('[data-testid^="t-item-"]')).map((b) =>
      b.getAttribute('aria-current'),
    );

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Host],
    }).compileComponents();
    fixture = TestBed.createComponent(Host);
    document.body.appendChild(fixture.nativeElement);
    el = fixture.nativeElement as HTMLElement;
    await flush();
  });

  afterEach(() => fixture.nativeElement.remove());

  it('draws a tick and a list button per user message, with the landmark label', () => {
    expect(el.querySelector('nav')!.getAttribute('aria-label')).toBe(
      'Test chat',
    );
    expect(el.querySelectorAll('[data-testid="t-tick"]').length).toBe(3);
    const buttons = Array.from(
      el.querySelectorAll<HTMLButtonElement>('[data-testid^="t-item-"]'),
    );
    expect(buttons.map((b) => b.textContent?.trim())).toEqual([
      'Question a',
      'Question b',
      'Question c',
    ]);
    expect(buttons[0].title).toBe('Question a');
  });

  it('is hidden under two user messages', async () => {
    fixture.componentInstance.messages.set(['a']);
    await flush();
    expect(el.querySelector('nav')).toBeNull();
  });

  it('marks the message in view and follows the scroll', async () => {
    scroller().scrollTop = 0;
    await flush();
    expect(currents()).toEqual(['true', null, null]);
    scroller().scrollTop = 110;
    await flush();
    expect(currents()).toEqual([null, 'true', null]);
    scroller().scrollTop = scroller().scrollHeight;
    await flush();
    expect(currents()).toEqual([null, null, 'true']);
  });

  it('a pick scrolls the chat to that message and emits it', async () => {
    scroller().scrollTop = scroller().scrollHeight;
    await flush();
    el.querySelector<HTMLButtonElement>('[data-testid="t-item-0"]')!.click();
    await flush();
    expect(scroller().scrollTop).toBeLessThan(10);
    expect(fixture.componentInstance.picks).toEqual(['a']);
    expect(currents()[0]).toBe('true');
  });
});
