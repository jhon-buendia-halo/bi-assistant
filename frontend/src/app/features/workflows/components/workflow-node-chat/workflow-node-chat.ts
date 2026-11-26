import {
  ChatHistoryItem,
  ChatHistoryNav,
} from '../../../../shared/components/chat-history-nav/chat-history-nav';
import { NgTemplateOutlet } from '@angular/common';
import {
  Component,
  DestroyRef,
  ElementRef,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { Subscription } from 'rxjs';
import { Loader2, LucideAngularModule, Send, Square } from 'lucide-angular';
import { AgentAvatar } from '../../../../shared/components/agent-avatar/agent-avatar';
import { ExecutionId } from '../../../../shared/execution-id/execution-id';
import { MarkdownPipe } from '../../../../shared/pipes/markdown.pipe';
import {
  LiveToolCall,
  NodeChatAvailability,
  NodeChatMessage,
  WorkflowRunToolCall,
} from '../../models/workflow.model';
import { WorkflowRunsApiService } from '../../services/workflow-runs-api.service';

export const NODE_CHAT_NO_RUN =
  "Run the workflow, then chat with this agent persona about this step's data.";
export const NODE_CHAT_RUNNING = 'Wait for the run to finish to chat about it.';
export const NODE_CHAT_EMPTY =
  "No messages yet. Ask about this step's input, output or tool calls.";

/** A tool call as the chat shows it: stored, or live while the turn streams. */
interface ChatToolCall {
  tool: string;
  input?: string;
  rowCount?: number;
  error?: string;
  /** Live only: still waiting for its result. */
  running?: boolean;
}

function storedCall(call: WorkflowRunToolCall): ChatToolCall {
  return {
    tool: call.tool,
    ...(call.input !== undefined ? { input: call.input } : {}),
    ...(call.rowCount !== undefined ? { rowCount: call.rowCount } : {}),
    ...(call.error ? { error: call.error } : {}),
  };
}

function liveCallView(call: LiveToolCall): ChatToolCall {
  return {
    tool: call.name,
    ...(call.input !== undefined ? { input: call.input } : {}),
    ...(call.rowCount !== undefined ? { rowCount: call.rowCount } : {}),
    ...(call.error ? { error: call.error } : {}),
    ...(call.finished ? {} : { running: true }),
  };
}

function toStoredCall(call: LiveToolCall): WorkflowRunToolCall {
  return {
    tool: call.name,
    ...(call.input !== undefined ? { input: call.input } : {}),
    ...(call.rowCount !== undefined ? { rowCount: call.rowCount } : {}),
    ...(call.error ? { error: call.error } : {}),
  };
}

/**
 * The Chat tab of an agent step's dialog (ui.md 4.4b; api.md 136, 137): a
 * Q&A with the step's agent about this step's data in the run shown, stored
 * with the run, per step. It never changes the run. The conversation is
 * read when the tab first shows for a run and step, and again when either
 * changes; the dialog keeps it mounted while other tabs show. Closing the
 * dialog mid-answer stops the turn (the server keeps the partial answer).
 */
@Component({
  selector: 'app-workflow-node-chat',
  imports: [
    AgentAvatar,
    ChatHistoryNav,
    ExecutionId,
    LucideAngularModule,
    MarkdownPipe,
    NgTemplateOutlet,
  ],
  templateUrl: './workflow-node-chat.html',
  host: { class: 'flex flex-col' },
})
export class WorkflowNodeChat {
  readonly Loader2 = Loader2;
  readonly Send = Send;
  readonly Square = Square;

  private readonly api = inject(WorkflowRunsApiService);

  readonly availability = input.required<NodeChatAvailability>();
  readonly stepId = input.required<string>();
  /** Suggested first questions, shown while the chat is ready and empty. */
  readonly suggestions = input<string[]>([]);
  readonly agentName = input<string>('');
  readonly agentRole = input<string>('');
  /** The agent's registry key (portrait seed); the name when empty. */
  readonly agentKey = input<string>('');

  readonly noRunText = NODE_CHAT_NO_RUN;
  readonly runningText = NODE_CHAT_RUNNING;
  readonly emptyText = NODE_CHAT_EMPTY;

  readonly messages = signal<NodeChatMessage[]>([]);
  readonly loading = signal(false);
  readonly streaming = signal(false);
  /** The answer so far, while the agent answers. */
  readonly streamingText = signal('');
  private readonly liveCalls = signal<LiveToolCall[]>([]);
  readonly error = signal<string | null>(null);
  readonly draft = signal('');

  /** The run chatted about; null while the chat is unavailable. */
  readonly runId = computed(() => {
    const availability = this.availability();
    return availability.state === 'ready' ? availability.runId : null;
  });
  readonly note = computed(() => {
    const id = this.runId();
    return id === null
      ? ''
      : "Chatting about this run: this step's input, output and tool calls.";
  });
  readonly canSend = computed(
    () => this.runId() !== null && !this.streaming() && !!this.draft().trim(),
  );
  readonly personaLabel = computed(() => {
    const name = this.agentName();
    const role = this.agentRole();
    if (!name) return role ? `Agent · ${role}` : 'Agent';
    return role ? `${name} · ${role}` : name;
  });
  readonly composerLabel = computed(() => {
    const name = this.agentName();
    return name
      ? `Ask ${name} about this step`
      : "Ask this step's agent persona";
  });
  readonly showSuggestions = computed(
    () =>
      this.runId() !== null &&
      !this.loading() &&
      !this.streaming() &&
      this.messages().length === 0 &&
      this.suggestions().length > 0,
  );
  readonly liveToolCalls = computed(() => this.liveCalls().map(liveCallView));

  private readonly list = viewChild<ElementRef<HTMLElement>>('list');
  protected readonly listElement = computed(() => this.list()?.nativeElement);
  /** The user's messages, for the chat-history navigation (ui.md). */
  protected readonly historyItems = computed<ChatHistoryItem[]>(() =>
    this.messages().flatMap((m) =>
      m.role === 'user' ? [{ id: m.id, label: m.content }] : [],
    ),
  );
  private readonly composer =
    viewChild<ElementRef<HTMLTextAreaElement>>('composer');
  private readonly key = computed(() => {
    const id = this.runId();
    return id === null ? null : { runId: id, stepId: this.stepId() };
  });

  private abort: AbortController | null = null;
  private loadSubscription: Subscription | null = null;
  /** Bumped on each run or step change and on Stop: late events are ignored. */
  private generation = 0;

  constructor() {
    effect(() => {
      const key = this.key();
      untracked(() => this.reset(key));
    });
    // Keep the newest message in view.
    effect(() => {
      this.messages();
      this.streamingText();
      this.liveCalls();
      const list = this.list()?.nativeElement;
      if (list) setTimeout(() => (list.scrollTop = list.scrollHeight));
    });
    inject(DestroyRef).onDestroy(() => this.cancel());
  }

  toolCalls(message: NodeChatMessage): ChatToolCall[] {
    return (message.toolCalls ?? []).map(storedCall);
  }

  callMeta(call: ChatToolCall): string {
    if (call.running) return 'Running…';
    return call.rowCount !== undefined ? `${call.rowCount} rows` : '';
  }

  /** Put a question in the box (a suggestion), focused, without sending it. */
  prefill(text: string): void {
    if (this.runId() === null || this.streaming()) return;
    this.draft.set(text);
    setTimeout(() => this.composer()?.nativeElement.focus());
  }

  /** A suggestion chip: fills the box, like the dialog's chips always did. */
  suggest(question: string): void {
    this.prefill(question);
  }

  onInput(event: Event): void {
    this.draft.set((event.target as HTMLTextAreaElement).value);
  }

  /** Enter sends; Shift+Enter (or composing text) adds a new line. */
  onEnter(event: Event): void {
    const key = event as KeyboardEvent;
    if (key.shiftKey || key.isComposing) return;
    event.preventDefault();
    this.send();
  }

  send(): void {
    const key = this.key();
    const content = this.draft().trim();
    if (key === null || !content || this.streaming()) return;
    const generation = ++this.generation;
    const live = () => generation === this.generation;
    this.error.set(null);
    this.draft.set('');
    this.messages.update((messages) => [
      ...messages,
      {
        id: `local-${generation}`,
        role: 'user',
        content,
        createdAt: new Date().toISOString(),
      },
    ]);
    this.streamingText.set('');
    this.liveCalls.set([]);
    this.streaming.set(true);
    const controller = new AbortController();
    this.abort = controller;

    void this.api
      .streamNodeChat(
        key.runId,
        key.stepId,
        content,
        {
          onText: (delta) => {
            if (live()) this.streamingText.update((text) => text + delta);
          },
          onTool: (call) => {
            if (!live()) return;
            this.liveCalls.update((calls) => [
              ...calls,
              { ...call, finished: false },
            ]);
          },
          onToolResult: (summary) => {
            if (!live()) return;
            this.updateOpenCall(summary.tool, (call) => ({
              ...call,
              finished: true,
              ...(summary.rowCount !== undefined
                ? { rowCount: summary.rowCount }
                : {}),
              ...(summary.error ? { error: summary.error } : {}),
            }));
          },
          onDone: (message) => {
            if (!live()) return;
            this.endTurn();
            this.messages.update((messages) => [...messages, message]);
          },
          onError: (message) => {
            if (!live()) return;
            this.endTurn();
            this.error.set(message);
            this.resync(key, content, generation);
          },
        },
        controller.signal,
      )
      .finally(() => {
        if (this.abort === controller) this.abort = null;
      });
  }

  /** Stop: the turn is aborted; its partial answer shows as stopped. */
  stop(): void {
    if (!this.streaming()) return;
    const partial: NodeChatMessage = {
      id: `local-stopped-${this.generation}`,
      role: 'assistant',
      content: this.streamingText(),
      toolCalls: this.liveCalls().map(toStoredCall),
      stopped: true,
      createdAt: new Date().toISOString(),
    };
    this.cancel();
    this.messages.update((messages) => [...messages, partial]);
  }

  private endTurn(): void {
    this.streaming.set(false);
    this.streamingText.set('');
    this.liveCalls.set([]);
  }

  private cancel(): void {
    this.generation += 1;
    this.abort?.abort();
    this.abort = null;
    this.loadSubscription?.unsubscribe();
    this.loadSubscription = null;
    this.endTurn();
  }

  /** A new run or step: anything of the previous one is dropped, then read. */
  private reset(key: { runId: string; stepId: string } | null): void {
    this.cancel();
    this.messages.set([]);
    this.error.set(null);
    this.draft.set('');
    this.loading.set(false);
    if (key === null) return;
    const generation = this.generation;
    this.loading.set(true);
    this.loadSubscription = this.api
      .getNodeChat(key.runId, key.stepId)
      .subscribe({
        next: ({ messages }) => {
          if (generation !== this.generation) return;
          this.messages.set(messages ?? []);
          this.loading.set(false);
        },
        error: (err) => {
          if (generation !== this.generation) return;
          this.error.set(err?.error?.message ?? 'Backend unreachable');
          this.loading.set(false);
        },
      });
  }

  /**
   * After a failed turn, show what the server kept. A refused message was
   * not stored: it goes back into the empty box to edit or send again.
   */
  private resync(
    key: { runId: string; stepId: string },
    content: string,
    generation: number,
  ): void {
    this.loadSubscription?.unsubscribe();
    this.loadSubscription = this.api
      .getNodeChat(key.runId, key.stepId)
      .subscribe({
        next: ({ messages }) => {
          if (generation !== this.generation) return;
          const list = messages ?? [];
          this.messages.set(list);
          const lastUser = list.filter((m) => m.role === 'user').at(-1);
          if (lastUser?.content !== content && this.draft() === '') {
            this.draft.set(content);
          }
        },
        error: () => undefined,
      });
  }

  /** Update the latest unfinished call of `tool`. */
  private updateOpenCall(
    tool: string,
    change: (call: LiveToolCall) => LiveToolCall,
  ): void {
    this.liveCalls.update((calls) => {
      for (let i = calls.length - 1; i >= 0; i--) {
        if (calls[i].name === tool && !calls[i].finished) {
          const next = [...calls];
          next[i] = change(calls[i]);
          return next;
        }
      }
      return calls;
    });
  }
}
