import {
  Component,
  ElementRef,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import {
  LucideAngularModule,
  ArrowUp,
  Brain,
  Copy,
  Loader2,
  Sparkles,
  Square,
  Wrench,
} from 'lucide-angular';
import { ProjectsApiService } from '../../services/projects-api.service';
import { ChatMessage, Project } from '../../models/project.model';
import { ToastService } from '../../../../core/toast/toast.service';

@Component({
  selector: 'app-project-chat',
  imports: [LucideAngularModule],
  templateUrl: './project-chat.html',
  styleUrl: './project-chat.scss',
})
export class ProjectChat {
  readonly ArrowUp = ArrowUp;
  readonly Brain = Brain;
  readonly Copy = Copy;
  readonly Loader2 = Loader2;
  readonly Sparkles = Sparkles;
  readonly Square = Square;
  readonly Wrench = Wrench;

  private readonly api = inject(ProjectsApiService);
  private readonly toast = inject(ToastService);

  readonly project = input.required<Project>();
  readonly visualGenerating = input(false);
  readonly generateVisual = output<ChatMessage>();

  readonly messages = signal<ChatMessage[]>([]);
  readonly draft = signal('');
  readonly sending = signal(false);
  /** Tail of the model's reasoning stream, shown Conductor-style. */
  readonly reasoning = signal('');
  /** Names of tools invoked during the current turn. */
  readonly toolCalls = signal<string[]>([]);
  /** Streamed assistant text for the in-flight turn. */
  readonly streamingText = signal('');
  readonly elapsed = signal(0);
  /** Chat-history navigator (Conductor-style tick strip). */
  readonly historyOpen = signal(false);
  readonly historyItems = computed(() =>
    this.messages()
      .map((message, index) => ({ message, index }))
      .filter(({ message }) => message.role === 'user'),
  );

  private timer: ReturnType<typeof setInterval> | null = null;
  private activeStream: AbortController | null = null;

  private readonly scroller = viewChild<ElementRef<HTMLDivElement>>('scroller');

  constructor() {
    // Re-sync when the active project changes (component instance is reused).
    effect(() => {
      this.activeStream?.abort();
      this.activeStream = null;
      this.messages.set(this.project().messages);
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
          this.toolCalls.set([...this.toolCalls(), name]);
          this.scrollToBottom();
        },
        onText: (delta) => {
          if (this.activeStream !== controller) return;
          this.streamingText.set(this.streamingText() + delta);
          this.scrollToBottom();
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

  copyMessage(content: string): void {
    void navigator.clipboard.writeText(content).then(
      () => this.toast.success('Copied to clipboard'),
      () => this.toast.error('Copy failed'),
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
