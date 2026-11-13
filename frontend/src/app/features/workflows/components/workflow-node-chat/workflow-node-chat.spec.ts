import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Subject, of, throwError } from 'rxjs';
import {
  NodeChatAvailability,
  NodeChatMessage,
} from '../../models/workflow.model';
import {
  NodeChatStreamHandlers,
  WorkflowRunsApiService,
} from '../../services/workflow-runs-api.service';
import {
  NODE_CHAT_NO_RUN,
  NODE_CHAT_RUNNING,
  WorkflowNodeChat,
} from './workflow-node-chat';

const RUN_ID = '3f9c2a7e-51b0-4c1e-9f0a-2d6e8b7c4a11';

const QUESTION: NodeChatMessage = {
  id: 'm-1',
  role: 'user',
  content: 'Which SQL did you run?',
  createdAt: '2026-11-12T10:00:00.000Z',
};
const REPLY: NodeChatMessage = {
  id: 'm-2',
  role: 'assistant',
  content: 'I ran **one** query.',
  toolCalls: [
    { tool: 'run_readonly_sql', input: 'SELECT stage FROM matches', rowCount: 6 },
    { tool: 'describe_entity', input: 'matches', error: 'Not found' },
  ],
  createdAt: '2026-11-12T10:00:02.000Z',
};

/** The runs API the test drives: each chat turn is recorded with its handlers. */
class FakeRunsApi {
  getNodeChat = jasmine
    .createSpy('getNodeChat')
    .and.callFake(() => of({ messages: [] as NodeChatMessage[] }));
  turns: {
    runId: string;
    stepId: string;
    content: string;
    handlers: NodeChatStreamHandlers;
    signal?: AbortSignal;
  }[] = [];

  streamNodeChat(
    runId: string,
    stepId: string,
    content: string,
    handlers: NodeChatStreamHandlers,
    signal?: AbortSignal,
  ): Promise<void> {
    this.turns.push({ runId, stepId, content, handlers, signal });
    return new Promise<void>(() => undefined);
  }

  get last() {
    return this.turns[this.turns.length - 1];
  }
}

describe('WorkflowNodeChat (ui.md 4.4b; api.md 136, 137)', () => {
  let fixture: ComponentFixture<WorkflowNodeChat>;
  let api: FakeRunsApi;
  const el = () => fixture.nativeElement as HTMLElement;
  const byId = (id: string) =>
    el().querySelector<HTMLElement>(`[data-testid="${id}"]`);
  const all = (id: string) =>
    Array.from(el().querySelectorAll<HTMLElement>(`[data-testid="${id}"]`));
  const text = (node: Element | null | undefined) =>
    node?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
  const input = () =>
    byId('workflow-node-chat-input') as HTMLTextAreaElement;
  const send = () => byId('workflow-node-chat-send') as HTMLButtonElement;

  function open(
    availability: NodeChatAvailability = { state: 'ready', runId: RUN_ID },
    stepId = 'analyse',
  ): void {
    fixture = TestBed.createComponent(WorkflowNodeChat);
    fixture.componentRef.setInput('availability', availability);
    fixture.componentRef.setInput('stepId', stepId);
    fixture.detectChanges();
  }

  function type(value: string): void {
    input().value = value;
    input().dispatchEvent(new Event('input'));
    fixture.detectChanges();
  }

  function press(key: string, init: KeyboardEventInit = {}): KeyboardEvent {
    const event = new KeyboardEvent('keydown', {
      key,
      bubbles: true,
      cancelable: true,
      ...init,
    });
    input().dispatchEvent(event);
    fixture.detectChanges();
    return event;
  }

  beforeEach(() => {
    api = new FakeRunsApi();
    TestBed.configureTestingModule({
      imports: [WorkflowNodeChat],
      providers: [{ provide: WorkflowRunsApiService, useValue: api }],
    });
  });

  it('explains why it cannot chat before a run, and while the run streams', () => {
    open({ state: 'no-run' });
    expect(text(byId('workflow-node-chat-unavailable'))).toBe(NODE_CHAT_NO_RUN);
    expect(NODE_CHAT_NO_RUN).toBe(
      "Execute the workflow, then chat with this agent about this step's data.",
    );
    expect(byId('workflow-node-chat')).toBeNull();
    expect(api.getNodeChat).not.toHaveBeenCalled();

    fixture.componentRef.setInput('availability', { state: 'running' });
    fixture.detectChanges();
    expect(text(byId('workflow-node-chat-unavailable'))).toBe(
      'Wait for the run to finish to chat about it.',
    );
    expect(NODE_CHAT_RUNNING).toBe('Wait for the run to finish to chat about it.');
  });

  it("reads the stored chat and shows the note, the messages and the assistant's tool calls", () => {
    api.getNodeChat.and.returnValue(of({ messages: [QUESTION, REPLY] }));
    open();
    expect(api.getNodeChat).toHaveBeenCalledOnceWith(RUN_ID, 'analyse');
    expect(text(byId('workflow-node-chat-note'))).toBe(
      "Chatting about run 3f9c2a7e: this step's input, output and tool calls.",
    );
    const log = byId('workflow-node-chat-messages')!;
    expect(log.getAttribute('role')).toBe('log');
    expect(log.getAttribute('aria-live')).toBe('polite');

    const messages = all('workflow-node-chat-message');
    expect(messages.map((m) => m.getAttribute('data-role'))).toEqual([
      'user',
      'assistant',
    ]);
    expect(text(messages[0])).toBe('Which SQL did you run?');
    // Markdown is rendered for the agent.
    expect(messages[1].querySelector('strong')?.textContent).toBe('one');
    const calls = all('workflow-node-chat-tool-call');
    expect(calls.length).toBe(2);
    const head = (call: HTMLElement) => text(call.firstElementChild);
    expect(head(calls[0])).toBe('run_readonly_sql · 6 rows');
    const sql = calls[0].querySelector('pre')!;
    expect(sql.textContent).toBe('SELECT stage FROM matches');
    expect(sql.classList).toContain('font-mono');
    expect(head(calls[1])).toBe('describe_entity · Not found');
    expect(calls[1].querySelector('pre')?.textContent).toBe('matches');
  });

  it('has a labelled box; Send is disabled while it is blank', () => {
    open();
    const label = el().querySelector(`label[for="${input().id}"]`);
    expect(text(label)).toBe("Ask this step's agent");
    expect(send().disabled).toBe(true);
    type('   ');
    expect(send().disabled).toBe(true);
    type('How many rows?');
    expect(send().disabled).toBe(false);
  });

  it('Enter sends; Shift+Enter keeps typing', () => {
    open();
    type('First line');
    const shifted = press('Enter', { shiftKey: true });
    expect(shifted.defaultPrevented).toBe(false);
    expect(api.turns.length).toBe(0);

    const plain = press('Enter');
    expect(plain.defaultPrevented).toBe(true);
    expect(api.turns.length).toBe(1);
    expect(api.last).toEqual(
      jasmine.objectContaining({ runId: RUN_ID, stepId: 'analyse', content: 'First line' }),
    );
  });

  it('streams the answer with its tool calls, then shows the stored reply', () => {
    open();
    type('Which SQL did you run?');
    send().click();
    fixture.detectChanges();
    expect(input().value).toBe('');
    expect(send().disabled).toBe(true);
    expect(byId('workflow-node-chat-stop')).not.toBeNull();
    expect(all('workflow-node-chat-message').map((m) => m.getAttribute('data-role'))).toEqual([
      'user',
    ]);

    const h = api.last.handlers;
    h.onTool!({ name: 'run_readonly_sql', input: 'SELECT stage FROM matches' });
    fixture.detectChanges();
    expect(text(byId('workflow-node-chat-streaming'))).toContain('Running…');
    h.onToolResult!({ tool: 'run_readonly_sql', rowCount: 6 });
    h.onText!('I ran ');
    h.onText!('one query.');
    fixture.detectChanges();
    const streaming = text(byId('workflow-node-chat-streaming'));
    expect(streaming).toContain('6 rows');
    expect(streaming).toContain('I ran one query.');

    h.onDone!(REPLY);
    fixture.detectChanges();
    expect(byId('workflow-node-chat-streaming')).toBeNull();
    expect(byId('workflow-node-chat-stop')).toBeNull();
    expect(all('workflow-node-chat-message').map((m) => m.getAttribute('data-role'))).toEqual([
      'user',
      'assistant',
    ]);
  });

  it('Stop aborts the turn and keeps its partial answer, marked stopped', () => {
    open();
    type('Count the rows');
    send().click();
    const turn = api.last;
    turn.handlers.onText!('There are');
    fixture.detectChanges();
    byId('workflow-node-chat-stop')!.click();
    fixture.detectChanges();
    expect(turn.signal?.aborted).toBe(true);
    const messages = all('workflow-node-chat-message');
    expect(messages.length).toBe(2);
    expect(text(messages[1])).toBe('There are Stopped');
    // Late events of the stopped turn are ignored.
    turn.handlers.onDone!(REPLY);
    fixture.detectChanges();
    expect(all('workflow-node-chat-message').length).toBe(2);
  });

  it("shows a refusal under the list, rereads the chat and puts an unstored message back", () => {
    open();
    type('Why?');
    send().click();
    api.getNodeChat.and.returnValue(of({ messages: [] }));
    api.last.handlers.onError!('Step "analyse" did not run in this run');
    fixture.detectChanges();
    expect(text(byId('workflow-node-chat-error'))).toBe(
      'Step "analyse" did not run in this run',
    );
    expect(byId('workflow-node-chat-error')?.getAttribute('role')).toBe('alert');
    expect(all('workflow-node-chat-message').length).toBe(0);
    expect(input().value).toBe('Why?');
    expect(send().disabled).toBe(false);
  });

  it('a failed turn the server kept stays in the list; the box stays empty', () => {
    open();
    type('Why?');
    send().click();
    const stored: NodeChatMessage[] = [
      { ...QUESTION, content: 'Why?' },
      { ...REPLY, content: '', toolCalls: [], error: 'Model down' },
    ];
    api.getNodeChat.and.returnValue(of({ messages: stored }));
    api.last.handlers.onError!('Model down');
    fixture.detectChanges();
    expect(all('workflow-node-chat-message').length).toBe(2);
    expect(input().value).toBe('');
  });

  it('reports a chat it cannot read', () => {
    api.getNodeChat.and.returnValue(
      throwError(() => ({ error: { message: 'Run "x" not found' } })),
    );
    open();
    expect(text(byId('workflow-node-chat-error'))).toBe('Run "x" not found');
  });

  it('another run or step drops the conversation shown, stops its turn and reads the new one', () => {
    open();
    type('Hi');
    send().click();
    const turn = api.last;
    const pending = new Subject<{ messages: NodeChatMessage[] }>();
    api.getNodeChat.and.returnValue(pending);
    fixture.componentRef.setInput('availability', { state: 'ready', runId: 'run-2' });
    fixture.detectChanges();
    expect(turn.signal?.aborted).toBe(true);
    expect(api.getNodeChat).toHaveBeenCalledWith('run-2', 'analyse');
    expect(all('workflow-node-chat-message').length).toBe(0);
    pending.next({ messages: [QUESTION] });
    fixture.detectChanges();
    expect(all('workflow-node-chat-message').length).toBe(1);
  });

  it('closing the dialog stops a turn in progress', () => {
    open();
    type('Hi');
    send().click();
    const turn = api.last;
    fixture.destroy();
    expect(turn.signal?.aborted).toBe(true);
  });
});
