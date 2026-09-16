import {
  Component,
  ElementRef,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import {
  LucideAngularModule,
  ArrowUp,
  BarChart3,
  Brain,
  Copy,
  Loader2,
  Sparkles,
  Square,
  ThumbsDown,
  ThumbsUp,
  Wrench,
} from 'lucide-angular';
import { ProjectsApiService } from '../../services/projects-api.service';
import {
  ChatMessage,
  MessageFeedback,
  Project,
  ToolDataRecord,
  VisualEvent,
} from '../../models/project.model';
import { ToastService } from '../../../../core/toast/toast.service';
import { MarkdownPipe } from '../../../../shared/pipes/markdown.pipe';

/** One tool call shown in the Thinking block, enriched when its result lands. */
interface ToolActivity {
  name: string;
  input?: string;
  rowCount?: number;
  error?: string;
}

@Component({
  selector: 'app-project-chat',
  imports: [LucideAngularModule, MarkdownPipe],
  templateUrl: './project-chat.html',
  styleUrl: './project-chat.scss',
})
export class ProjectChat {
  readonly ArrowUp = ArrowUp;
  readonly BarChart3 = BarChart3;
  readonly Brain = Brain;
  readonly Copy = Copy;
  readonly Loader2 = Loader2;
  readonly Sparkles = Sparkles;
  readonly Square = Square;
  readonly ThumbsDown = ThumbsDown;
  readonly ThumbsUp = ThumbsUp;
  readonly Wrench = Wrench;

  private readonly api = inject(ProjectsApiService);
  private readonly toast = inject(ToastService);

  readonly project = input.required<Project>();
  readonly visualGenerating = input(false);
  /** Visual open in the right panel — the default target for tailoring. */
  readonly activeVisualizationId = input<string | null>(null);
  readonly generateVisual = output<ChatMessage>();
  /** A turn created/updated a visual; the host should refresh the panel. */
  readonly visualUpdated = output<VisualEvent>();
  readonly viewVisual = output<VisualEvent>();
  /** The project was persisted out of band (answer feedback) — refresh copies. */
  readonly projectUpdated = output<Project>();

  readonly messages = signal<ChatMessage[]>([]);
  readonly draft = signal('');
  readonly sending = signal(false);
  /** Tail of the model's reasoning stream, shown Conductor-style. */
  readonly reasoning = signal('');
  /** Tools invoked during the current turn, with result summaries. */
  readonly toolCalls = signal<ToolActivity[]>([]);
  /** Streamed assistant text for the in-flight turn. */
  readonly streamingText = signal('');
  readonly elapsed = signal(0);
  /** `at` of the message whose rating is being persisted right now. */
  readonly feedbackPending = signal<string | null>(null);
  /** Chat-history navigator (Conductor-style tick strip). */
  readonly historyOpen = signal(false);
  readonly historyItems = computed(() =>
    this.messages()
      .map((message, index) => ({ message, index }))
      .filter(({ message }) => message.role === 'user'),
  );

  private timer: ReturnType<typeof setInterval> | null = null;
  private activeStream: AbortController | null = null;
  private syncedProjectId: string | null = null;

  private readonly scroller = viewChild<ElementRef<HTMLDivElement>>('scroller');

  constructor() {
    // Re-sync when the active project changes (component instance is reused).
    effect(() => {
      const project = this.project();
      if (project.id === this.syncedProjectId) {
        // Same project, refreshed metadata (e.g. a visual was versioned).
        // Never disturb an in-flight turn; `done` brings the final transcript.
        if (!untracked(() => this.sending())) {
          this.messages.set(project.messages);
        }
        return;
      }
      this.syncedProjectId = project.id;
      this.activeStream?.abort();
      this.activeStream = null;
      this.stopTimer();
      this.sending.set(false);
      this.messages.set(project.messages);
      this.feedbackPending.set(null);
      this.draft.set('');
      this.customAnswer.set('');
      this.customAnswerOpen.set(false);
      this.resetTurnState();
      this.scrollToBottom();
    });
  }

  /** Last ~90 chars of reasoning, single line, like Conductor's snippet. */
  get reasoningSnippet(): string {
    const flat = this.reasoning().replace(/\s+/g, ' ').trim();
    return flat.length > 90 ? `…${flat.slice(-90)}` : flat;
  }

  onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      this.send();
    }
  }

  send(): void {
    const content = this.draft().trim();
    if (!content || this.sending()) return;
    this.draft.set('');
    this.sending.set(true);
    this.resetTurnState();
    this.messages.set([
      ...this.messages(),
      { role: 'user', content, at: new Date().toISOString() },
    ]);
    this.scrollToBottom();
    this.startTimer();

    const controller = new AbortController();
    this.activeStream = controller;

    void this.api.streamMessage(
      this.project().id,
      content,
      {
        onReasoning: (delta) => {
          if (this.activeStream !== controller) return;
          this.reasoning.set(this.reasoning() + delta);
        },
        onTool: (name) => {
          if (this.activeStream !== controller) return;
          this.toolCalls.set([...this.toolCalls(), { name }]);
          this.scrollToBottom();
        },
        onToolResult: (summary) => {
          if (this.activeStream !== controller) return;
          // Attach to the latest call of that tool still missing a result.
          const calls = [...this.toolCalls()];
          for (let i = calls.length - 1; i >= 0; i--) {
            const call = calls[i];
            if (
              call.name === summary.tool &&
              call.rowCount === undefined &&
              call.error === undefined
            ) {
              calls[i] = {
                ...call,
                input: summary.input,
                rowCount: summary.rowCount,
                error: summary.error,
              };
              break;
            }
          }
          this.toolCalls.set(calls);
        },
        onText: (delta) => {
          if (this.activeStream !== controller) return;
          this.streamingText.set(this.streamingText() + delta);
          this.scrollToBottom();
        },
        onVisualUpdated: (event) => {
          if (this.activeStream !== controller) return;
          this.visualUpdated.emit(event);
        },
        onDone: (project) => {
          if (this.activeStream !== controller) return;
          this.activeStream = null;
          this.stopTimer();
          this.sending.set(false);
          this.resetTurnState();
          if (project) this.messages.set(project.messages);
          this.scrollToBottom();
        },
        onError: (message) => {
          if (this.activeStream !== controller) return;
          this.activeStream = null;
          this.stopTimer();
          this.sending.set(false);
          this.resetTurnState();
          this.toast.error(message);
        },
      },
      controller.signal,
      this.activeVisualizationId() ?? undefined,
    );
  }

  stop(): void {
    if (!this.sending()) return;
    const partial = this.streamingText().trim();
    this.activeStream?.abort();
    this.activeStream = null;
    this.stopTimer();
    this.sending.set(false);
    if (partial) {
      this.messages.set([
        ...this.messages(),
        { role: 'assistant', content: partial, at: new Date().toISOString() },
      ]);
    }
    this.resetTurnState();
    this.scrollToBottom();
  }

  private resetTurnState(): void {
    this.reasoning.set('');
    this.toolCalls.set([]);
    this.streamingText.set('');
    this.elapsed.set(0);
  }

  private startTimer(): void {
    this.stopTimer();
    const started = Date.now();
    this.timer = setInterval(
      () => this.elapsed.set((Date.now() - started) / 1000),
      100,
    );
  }

  private stopTimer(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /** Short label for a persisted data record under an answer. */
  dataLabel(record: ToolDataRecord): string {
    if (record.error) return `${record.tool} — failed`;
    const rows = record.rowCount ?? record.rows?.length ?? 0;
    return `${record.tool} — ${rows} row${rows === 1 ? '' : 's'}`;
  }

  copyMessage(content: string): void {
    void navigator.clipboard.writeText(content).then(
      () => this.toast.success('Copied to clipboard'),
      () => this.toast.error('Copy failed'),
    );
  }

  /**
   * Rate an answer. Same rating twice is a no-op; the other rating switches.
   * The transcript is patched locally first so the click feels instant, then
   * reconciled with the persisted project — never while a turn is streaming,
   * because `done` brings the authoritative transcript.
   */
  rateMessage(message: ChatMessage, rating: MessageFeedback): void {
    if (message.feedback === rating) return;
    if (this.feedbackPending() === message.at) return;
    const previous = message.feedback;
    this.feedbackPending.set(message.at);
    this.patchFeedback(message.at, rating);

    this.api
      .sendMessageFeedback(this.project().id, message.at, rating)
      .subscribe({
        next: (result) => {
          this.feedbackPending.set(null);
          if (!result.ok) {
            this.patchFeedback(message.at, previous);
            this.toast.error(result.message || 'Could not save feedback');
            return;
          }
          if (result.project) {
            if (!this.sending()) this.messages.set(result.project.messages);
            this.projectUpdated.emit(result.project);
          }
          this.toast.success(result.message || 'Feedback saved');
        },
        error: (err) => {
          this.feedbackPending.set(null);
          this.patchFeedback(message.at, previous);
          this.toast.error(err?.error?.message ?? 'Backend unreachable');
        },
      });
  }

  private patchFeedback(
    at: string,
    feedback: MessageFeedback | undefined,
  ): void {
    this.messages.update((messages) =>
      messages.map((message) =>
        message.role === 'assistant' && message.at === at
          ? { ...message, feedback }
          : message,
      ),
    );
  }

  requestVisualization(message: ChatMessage): void {
    if (this.sending() || this.visualGenerating()) return;
    this.generateVisual.emit(message);
  }

  /** Clarification card actions. */
  pickOption(label: string): void {
    if (this.sending()) return;
    this.customAnswer.set('');
    this.customAnswerOpen.set(false);
    this.draft.set(label);
    this.send();
  }

  skipClarification(): void {
    this.pickOption('Skip — proceed with your best judgment.');
  }

  /** Inline custom answer inside the clarification card. */
  readonly customAnswerOpen = signal(false);
  readonly customAnswer = signal('');

  toggleCustomAnswer(): void {
    this.customAnswerOpen.set(!this.customAnswerOpen());
    if (this.customAnswerOpen()) {
      setTimeout(() => {
        const el = this.scroller()?.nativeElement.querySelector(
          '#custom-answer',
        ) as HTMLInputElement | null;
        el?.focus();
      });
    }
  }

  sendCustomAnswer(): void {
    const answer = this.customAnswer().trim();
    if (!answer || this.sending()) return;
    this.pickOption(answer);
  }

  onCustomAnswerKeydown(event: KeyboardEvent): void {
    if (event.key === 'Enter') {
      event.preventDefault();
      this.sendCustomAnswer();
    }
  }

  /** Only the latest message's clarification card is actionable. */
  isLatest(index: number): boolean {
    return index === this.messages().length - 1;
  }

  scrollToMessage(index: number): void {
    this.historyOpen.set(false);
    const el = this.scroller()?.nativeElement.querySelector(`#msg-${index}`);
    el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  private scrollToBottom(): void {
    setTimeout(() => {
      const el = this.scroller()?.nativeElement;
      if (el) el.scrollTop = el.scrollHeight;
    });
  }
}
