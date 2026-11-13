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
import { MarkdownPipe } from '../../../../shared/pipes/markdown.pipe';
import {
  LiveToolCall,
  NodeChatAvailability,
  NodeChatMessage,
  WorkflowRunToolCall,
} from '../../models/workflow.model';
import { WorkflowRunsApiService } from '../../services/workflow-runs-api.service';

export const NODE_CHAT_NO_RUN =
  "Execute the workflow, then chat with this agent about this step's data.";
export const NODE_CHAT_RUNNING = 'Wait for the run to finish to chat about it.';
export const NODE_CHAT_EMPTY =
  "No messages yet. Ask about this step's input, output or tool calls.";

/** A tool call as the chat shows it: stored, or live while the turn streams. */
interface ChatToolCall {
  tool: string;
  input?: string;
  rowCount?: number;
  error?: string;
  /** Live only: still waiting for its result, with its latest progress. */
  running?: boolean;
  progress?: string;
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
    ...(call.progress ? { progress: call.progress } : {}),
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
  imports: [LucideAngularModule, MarkdownPipe, NgTemplateOutlet],
  templateUrl: './workflow-node-chat.html',
  host: { class: 'flex min-h-0 flex-1 flex-col' },
})
export class WorkflowNodeChat {
  readonly Loader2 = Loader2;
  readonly Send = Send;
  readonly Square = Square;

  private readonly api = inject(WorkflowRunsApiService);

  readonly availability = input.required<NodeChatAvailability>();
  readonly stepId = input.required<string>();

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
      : `Chatting about run ${id.slice(0, 8)}: this step's input, output and tool calls.`;
  });
  readonly canSend = computed(
    () => this.runId() !== null && !this.streaming() && !!this.draft().trim(),
  );
  readonly liveToolCalls = computed(() => this.liveCalls().map(liveCallView));

  private readonly list = viewChild<ElementRef<HTMLElement>>('list');
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
    if (call.running) return call.progress ?? 'Running…';
    return call.rowCount !== undefined ? `${call.rowCount} rows` : '';
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
          onToolProgress: (progress) => {
            if (!live()) return;
            this.updateOpenCall(progress.tool, (call) => ({
              ...call,
              progress: progress.message,
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
