import { NgTemplateOutlet } from '@angular/common';
import {
  Component,
  ElementRef,
  computed,
  effect,
  inject,
  input,
  OnDestroy,
  output,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import {
  LucideAngularModule,
  ArrowUp,
  BadgeCheck,
  BarChart3,
  Brain,
  Copy,
  Download,
  Info,
  Loader2,
  ShieldAlert,
  ShieldCheck,
  ShieldOff,
  Sparkles,
  Square,
  Telescope,
  ThumbsDown,
  ThumbsUp,
  TriangleAlert,
  Wrench,
  X,
} from 'lucide-angular';
import { SessionsApiService } from '../../services/sessions-api.service';
import {
  AnalysisReport,
  ChatMessage,
  CrossCheck,
  DataPointSelection,
  DeepAnalysisStatus,
  MessageFeedback,
  Session,
  ReasoningStep,
  ToolDataRecord,
  VisualEvent,
} from '../../models/session.model';
import {
  kindAccentClass,
  kindDescription,
  kindLabel,
} from '../../../knowledge/models/knowledge.model';
import { ToastService } from '../../../../core/toast/toast.service';
import { MarkdownPipe } from '../../../../shared/pipes/markdown.pipe';

/** Human-readable text for a clicked mark: its label when it has one. */
export function selectionText(selection: DataPointSelection): string {
  return selection.label?.trim() || selection.value;
}

/** Prompts behind the two follow-up chips. The user reviews before sending. */
export function drillPrompt(selection: DataPointSelection): string {
  return `Drill into "${selection.value}": break it down further.`;
}

export function whyPrompt(selection: DataPointSelection): string {
  return `Why does "${selection.value}" stand out? Explain the drivers.`;
}

/** One tool call shown in the Thinking block, enriched when its result lands. */
interface ToolActivity {
  name: string;
  /** Why the assistant ran this call, in its own words. */
  rationale?: string;
  input?: string;
  rowCount?: number;
  error?: string;
}

/** The deep-analysis job this conversation is waiting on, if any. */
interface DeepAnalysisActivity {
  jobId: string;
  question: string;
  status: DeepAnalysisStatus;
  progress?: string;
  step?: number;
  steps?: number;
  error?: string;
}

/** Status cadence for the pending card — the job itself takes minutes. */
export const DEEP_ANALYSIS_POLL_MS = 3_000;
/** Unanswered polls tolerated before the card stops watching the job. */
const MAX_POLL_FAILURES = 5;

/** One line describing where a running job is, for the pending card. */
export function deepAnalysisProgressLine(job: DeepAnalysisActivity): string {
  if (job.progress?.trim()) return job.progress.trim();
  switch (job.status) {
    case 'planning':
      return 'planning the investigation';
    case 'investigating':
      return job.steps
        ? `investigating angle ${job.step ?? 1} of ${job.steps}`
        : 'investigating';
    case 'writing':
      return 'writing the report';
    case 'error':
      return job.error ?? 'the analysis failed';
    default:
      return 'finishing up';
  }
}

@Component({
  selector: 'app-session-chat',
  imports: [LucideAngularModule, MarkdownPipe, NgTemplateOutlet],
  templateUrl: './session-chat.html',
  styleUrl: './session-chat.scss',
})
export class SessionChat implements OnDestroy {
  // Labels/colours for the knowledge snippets an answer was produced under —
  // reused from the Knowledge feature so the chat and that screen never drift.
  readonly knowledgeKindLabel = kindLabel;
  readonly knowledgeDescription = kindDescription;
  readonly knowledgeAccentClass = kindAccentClass;

  readonly ArrowUp = ArrowUp;
  readonly BadgeCheck = BadgeCheck;
  readonly BarChart3 = BarChart3;
  readonly Brain = Brain;
  readonly Copy = Copy;
  readonly Download = Download;
  readonly Info = Info;
  readonly Loader2 = Loader2;
  readonly ShieldAlert = ShieldAlert;
  readonly ShieldCheck = ShieldCheck;
  readonly ShieldOff = ShieldOff;
  readonly Sparkles = Sparkles;
  readonly Square = Square;
  readonly Telescope = Telescope;
  readonly ThumbsDown = ThumbsDown;
  readonly ThumbsUp = ThumbsUp;
  readonly TriangleAlert = TriangleAlert;
  readonly Wrench = Wrench;
  readonly X = X;

  private readonly api = inject(SessionsApiService);
  private readonly toast = inject(ToastService);

  readonly session = input.required<Session>();
  readonly visualGenerating = input(false);
  /** Visual open in the right panel — the default target for tailoring. */
  readonly activeVisualizationId = input<string | null>(null);
  /** Data mark clicked in the open visual; offers follow-up chips. */
  readonly dataPointSelection = input<DataPointSelection | null>(null);
  readonly generateVisual = output<ChatMessage>();
  /** A turn created/updated a visual; the host should refresh the panel. */
  readonly visualUpdated = output<VisualEvent>();
  readonly viewVisual = output<VisualEvent>();
  /** The session was persisted out of band (answer feedback) — refresh copies. */
  readonly sessionUpdated = output<Session>();

  readonly messages = signal<ChatMessage[]>([]);
  readonly draft = signal('');
  readonly sending = signal(false);
  /**
   * Careful mode: every turn sent while this is on is cross-checked by an
   * independent query. Session-scoped — it lasts for this conversation, it is
   * not stored with the session.
   */
  readonly careful = signal(false);
  /** Tail of the model's reasoning stream, shown Conductor-style. */
  readonly reasoning = signal('');
  /** Tools invoked during the current turn, with result summaries. */
  readonly toolCalls = signal<ToolActivity[]>([]);
  /** Streamed assistant text for the in-flight turn. */
  readonly streamingText = signal('');
  readonly elapsed = signal(0);
  /** `at` of the message whose rating is being persisted right now. */
  readonly feedbackPending = signal<string | null>(null);
  /**
   * Deep-analysis job this conversation started. It runs in the background —
   * normal chat stays usable — and reports through polling until the report
   * message lands in the transcript.
   */
  readonly deepAnalysisJob = signal<DeepAnalysisActivity | null>(null);
  readonly deepAnalysisRunning = computed(() => {
    const job = this.deepAnalysisJob();
    return !!job && job.status !== 'error';
  });
  /** Job id whose report is being downloaded right now. */
  readonly reportDownloading = signal<string | null>(null);
  /**
   * Opening message for a session nobody has asked anything in yet. Rendered
   * client-side only — it never enters the transcript, so it costs the model
   * no context and cannot be mistaken for something the assistant said.
   */
  readonly showWelcome = computed(
    () => this.messages().length === 0 && !this.sending(),
  );
  /** Datasets wired to this session, named in the welcome block. */
  readonly welcomeDatasets = computed(() => this.session().datasets ?? []);
  /** Starter questions offered with the welcome block. */
  readonly starterPrompts: readonly string[] = [
    'What data is available here? Summarise the tables and the key metrics.',
    'What stands out in this data right now? Give me the headline numbers.',
    'How have the main metrics moved over the last 12 months?',
  ];

  /** Chat-history navigator (Conductor-style tick strip). */
  readonly historyOpen = signal(false);
  readonly historyItems = computed(() =>
    this.messages()
      .map((message, index) => ({ message, index }))
      .filter(({ message }) => message.role === 'user'),
  );

  private timer: ReturnType<typeof setInterval> | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  /** Consecutive unanswered status polls; too many and the card gives up. */
  private pollFailures = 0;
  private activeStream: AbortController | null = null;
  private syncedSessionId: string | null = null;

  private readonly scroller = viewChild<ElementRef<HTMLDivElement>>('scroller');
  private readonly composer =
    viewChild<ElementRef<HTMLTextAreaElement>>('composer');

  /** The selection whose chips were dismissed or already sent. */
  private readonly usedSelection = signal<DataPointSelection | null>(null);
  /**
   * Selection currently offering follow-up chips. Derived, so a new click on a
   * mark always replaces the row and dismissing only silences that selection —
   * no effect can race the session re-sync.
   */
  readonly followUpSelection = computed(() => {
    const selection = this.dataPointSelection();
    return selection && selection !== this.usedSelection() ? selection : null;
  });
  readonly followUpLabel = computed(() => {
    const selection = this.followUpSelection();
    return selection ? selectionText(selection) : '';
  });
  /** Chips only make sense while a visual is open in the panel. */
  readonly followUpVisible = computed(
    () => !!this.followUpSelection() && !!this.activeVisualizationId(),
  );

  constructor() {

    // Re-sync when the active session changes (component instance is reused).
    effect(() => {
      const session = this.session();
      if (session.id === this.syncedSessionId) {
        // Same session, refreshed metadata (e.g. a visual was versioned).
        // Never disturb an in-flight turn; `done` brings the final transcript.
        if (!untracked(() => this.sending())) {
          this.messages.set(session.messages);
        }
        return;
      }
      this.syncedSessionId = session.id;
      this.activeStream?.abort();
      this.activeStream = null;
      this.stopTimer();
      // The job keeps running server-side; this conversation simply stops
      // watching it — its report lands in the transcript either way.
      this.stopPolling();
      this.deepAnalysisJob.set(null);
      this.sending.set(false);
      this.messages.set(session.messages);
      this.feedbackPending.set(null);
      // Follow-up chips follow their input: the host drops the selection when
      // it opens another session, so nothing to reset here.
      this.draft.set('');
      // A new conversation starts a new session — careful mode is opt-in again.
      this.careful.set(false);
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

  /** Chip actions: prefill the composer, never send — the user decides. */
  /** Put a starter question in the composer; the user sends it themselves. */
  useStarterPrompt(prompt: string): void {
    this.draft.set(prompt);
    setTimeout(() => {
      const el = this.composer()?.nativeElement;
      if (!el) return;
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
    });
  }

  useDrillPrompt(): void {
    this.fillComposer(drillPrompt);
  }

  useWhyPrompt(): void {
    this.fillComposer(whyPrompt);
  }

  private fillComposer(build: (selection: DataPointSelection) => string): void {
    const selection = this.followUpSelection();
    if (!selection) return;
    this.draft.set(build(selection));
    setTimeout(() => {
      const el = this.composer()?.nativeElement;
      if (!el) return;
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
    });
  }

  dismissFollowUps(): void {
    this.usedSelection.set(this.dataPointSelection());
  }

  send(): void {
    const content = this.draft().trim();
    if (!content || this.sending()) return;
    this.dismissFollowUps();
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
      this.session().id,
      content,
      {
        onReasoning: (delta) => {
          if (this.activeStream !== controller) return;
          this.reasoning.set(this.reasoning() + delta);
        },
        onTool: (call) => {
          if (this.activeStream !== controller) return;
          this.toolCalls.set([
            ...this.toolCalls(),
            { name: call.name, rationale: call.rationale },
          ]);
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
                // The call frame usually carries the reason; take the
                // result's when it did not.
                rationale: call.rationale ?? summary.rationale,
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
        onDone: (session) => {
          if (this.activeStream !== controller) return;
          this.activeStream = null;
          this.stopTimer();
          this.sending.set(false);
          this.resetTurnState();
          if (session) this.messages.set(session.messages);
          this.scrollToBottom();
        },
        onError: (message) => {
          if (this.activeStream !== controller) return;
          this.activeStream = null;
          this.stopTimer();
          this.sending.set(false);
          // Preserve whatever text had already streamed in — the same
          // rescue `stop()` gives a manually-cancelled turn — before the
          // error bubble that explains why the turn didn't finish.
          const partial = this.streamingText().trim();
          this.resetTurnState();
          const now = Date.now();
          this.messages.set([
            ...this.messages(),
            ...(partial
              ? [
                  {
                    role: 'assistant' as const,
                    content: partial,
                    at: new Date(now).toISOString(),
                  },
                ]
              : []),
            {
              role: 'assistant' as const,
              content: message,
              at: new Date(now + 1).toISOString(),
              error: true,
            },
          ]);
          this.toast.error(message);
          this.scrollToBottom();
        },
      },
      controller.signal,
      this.activeVisualizationId() ?? undefined,
      this.careful(),
    );
  }

  toggleCareful(): void {
    this.careful.update((on) => !on);
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

  /**
   * Resend the question behind a failed turn (the error bubble's Retry
   * action). The error bubble is never persisted, so the backend transcript
   * still ends with that unanswered user question — `appendUserMessage`'s
   * dedup reuses it there instead of stacking a duplicate.
   */
  retryLastQuestion(index: number): void {
    if (this.sending()) return;
    const previous = this.messages()
      .slice(0, index)
      .reverse()
      .find((message) => message.role === 'user');
    if (!previous) return;
    this.draft.set(previous.content);
    this.send();
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

  ngOnDestroy(): void {
    this.stopTimer();
    this.stopPolling();
  }

  // --------------------------------------------------- deep analysis

  /**
   * Send the draft as a deep-analysis job instead of a chat turn. The job runs
   * in the background: the composer stays free, ordinary turns still work, and
   * the report arrives as a message when it is done.
   */
  runDeepAnalysis(): void {
    const question = this.draft().trim();
    if (!question || this.deepAnalysisRunning()) return;
    this.draft.set('');
    this.deepAnalysisJob.set({
      jobId: '',
      question,
      status: 'planning',
      progress: 'Starting the deep analysis',
    });

    this.api.startDeepAnalysis(this.session().id, question).subscribe({
      next: (result) => {
        if (!result.ok || !result.jobId) {
          this.deepAnalysisJob.set(null);
          // Give the question back rather than losing what the user typed.
          if (!this.draft().trim()) this.draft.set(question);
          this.toast.error(result.message || 'Could not start deep analysis');
          return;
        }
        this.deepAnalysisJob.set({
          jobId: result.jobId,
          question,
          status: result.status ?? 'planning',
          progress: result.progress ?? 'Planning the investigation',
        });
        this.scrollToBottom();
        this.startPolling(result.jobId);
      },
      error: (err) => {
        this.deepAnalysisJob.set(null);
        if (!this.draft().trim()) this.draft.set(question);
        this.toast.error(err?.error?.message ?? 'Backend unreachable');
      },
    });
  }

  /** Stop watching a finished or failed job (the card's dismiss action). */
  dismissDeepAnalysis(): void {
    this.stopPolling();
    this.deepAnalysisJob.set(null);
  }

  deepAnalysisLine(job: DeepAnalysisActivity): string {
    return deepAnalysisProgressLine(job);
  }

  private startPolling(jobId: string): void {
    this.stopPolling();
    this.pollFailures = 0;
    this.pollTimer = setInterval(
      () => this.pollDeepAnalysis(jobId),
      DEEP_ANALYSIS_POLL_MS,
    );
  }

  private stopPolling(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  private pollDeepAnalysis(jobId: string): void {
    const sessionId = this.session().id;
    this.api.deepAnalysisStatus(sessionId, jobId).subscribe({
      next: (view) => {
        const job = this.deepAnalysisJob();
        if (!job || job.jobId !== jobId) return;
        this.pollFailures = 0;
        if (!view.ok || !view.status) {
          this.failDeepAnalysis(view.message || 'Deep analysis was lost');
          return;
        }
        this.deepAnalysisJob.set({
          ...job,
          status: view.status,
          progress: view.progress,
          step: view.step,
          steps: view.steps,
        });
        if (view.status === 'done') {
          this.stopPolling();
          this.completeDeepAnalysis(sessionId, jobId);
        } else if (view.status === 'error') {
          this.failDeepAnalysis(view.error || 'Deep analysis failed');
        }
      },
      // A transient poll failure is not a job failure — try again in 3s, but
      // do not keep polling a backend that has stopped answering.
      error: () => {
        if (++this.pollFailures >= MAX_POLL_FAILURES) {
          this.failDeepAnalysis('Lost contact with the deep analysis');
        }
      },
    });
  }

  private failDeepAnalysis(message: string): void {
    this.stopPolling();
    const job = this.deepAnalysisJob();
    if (job) {
      this.deepAnalysisJob.set({ ...job, status: 'error', error: message });
    }
    this.toast.error(message);
  }

  /** The report is persisted — pull the transcript that now contains it. */
  private completeDeepAnalysis(sessionId: string, jobId: string): void {
    this.api.get(sessionId).subscribe({
      next: (session) => {
        const job = this.deepAnalysisJob();
        if (job?.jobId === jobId) this.deepAnalysisJob.set(null);
        // Never disturb an in-flight turn; its `done` brings the transcript.
        if (!this.sending()) this.messages.set(session.messages);
        this.sessionUpdated.emit(session);
        this.scrollToBottom();
        this.toast.success('Deep analysis report ready');
      },
      error: () =>
        this.failDeepAnalysis('The report is ready but could not be loaded'),
    });
  }

  /** Save one report's markdown to disk. */
  downloadReport(report: AnalysisReport): void {
    if (this.reportDownloading()) return;
    this.reportDownloading.set(report.jobId);
    this.api.downloadDeepAnalysis(this.session().id, report.jobId).subscribe({
      next: (blob) => {
        this.reportDownloading.set(null);
        const slug =
          report.title
            .normalize('NFKD')
            .replace(/[^a-zA-Z0-9]+/g, '-')
            .replace(/^-+|-+$/g, '')
            .toLowerCase()
            .slice(0, 64) || `deep-analysis-${report.jobId.slice(0, 8)}`;
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `${slug}.md`;
        document.body.appendChild(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 0);
        this.toast.success('Report downloaded');
      },
      error: (err) => {
        this.reportDownloading.set(null);
        this.toast.error(err?.error?.message ?? 'Report download failed');
      },
    });
  }

  // --------------------------------------------------- cross-check chip

  /** What the independent re-derivation concluded, in one word. */
  crossCheckLabel(check: CrossCheck): string {
    if (check.status === 'agree') return 'Cross-checked';
    return check.status === 'disagree'
      ? 'Cross-check differs'
      : 'Cross-check failed';
  }

  crossCheckIcon(check: CrossCheck): typeof ShieldCheck {
    if (check.status === 'agree') return this.ShieldCheck;
    return check.status === 'disagree' ? this.ShieldAlert : this.ShieldOff;
  }

  /** Emerald when corroborated, amber when it differs, muted when it failed. */
  crossCheckClass(check: CrossCheck): string {
    if (check.status === 'agree') {
      return 'border-emerald-400/20 bg-emerald-400/10 text-emerald-400';
    }
    return check.status === 'disagree'
      ? 'border-amber-400/20 bg-amber-400/10 text-amber-400'
      : 'border-white/10 bg-white/[0.04] text-zinc-500';
  }

  /** Tooltip: the backend's note, or the verdict when it sent none. */
  crossCheckTitle(check: CrossCheck): string {
    return check.note?.trim() || this.crossCheckLabel(check);
  }

  /**
   * Muted outcome shown after one step of "How I worked this out": what the
   * step returned, or why it failed. Empty when the step reported neither.
   */
  reasoningOutcome(step: ReasoningStep): string {
    if (step.error) return `failed — ${step.error}`;
    if (step.rowCount === undefined) return '';
    const rows = step.rowCount.toLocaleString('en-US');
    return `${rows} row${step.rowCount === 1 ? '' : 's'}`;
  }

  /** Short label for a persisted data record under an answer. */
  dataLabel(record: ToolDataRecord): string {
    if (record.error) return `${record.tool} — failed`;
    const rows = record.rowCount ?? record.rows?.length ?? 0;
    return `${record.tool} — ${rows} row${rows === 1 ? '' : 's'}`;
  }

  copyMessage(content: string): void {
    this.copyToClipboard(content, 'Copied to clipboard');
  }

  /** Copy the query behind one persisted data record. */
  copySql(record: ToolDataRecord): void {
    const sql = record.input?.trim();
    if (!sql) return;
    this.copyToClipboard(sql, 'SQL copied to clipboard');
  }

  private copyToClipboard(text: string, success: string): void {
    void navigator.clipboard.writeText(text).then(
      () => this.toast.success(success),
      () => this.toast.error('Copy failed'),
    );
  }

  /**
   * Rate an answer. Same rating twice is a no-op; the other rating switches.
   * The transcript is patched locally first so the click feels instant, then
   * reconciled with the persisted session — never while a turn is streaming,
   * because `done` brings the authoritative transcript.
   */
  rateMessage(message: ChatMessage, rating: MessageFeedback): void {
    if (message.feedback === rating) return;
    if (this.feedbackPending() === message.at) return;
    const previous = message.feedback;
    this.feedbackPending.set(message.at);
    this.patchFeedback(message.at, rating);

    this.api
      .sendMessageFeedback(this.session().id, message.at, rating)
      .subscribe({
        next: (result) => {
          this.feedbackPending.set(null);
          if (!result.ok) {
            this.patchFeedback(message.at, previous);
            this.toast.error(result.message || 'Could not save feedback');
            return;
          }
          if (result.session) {
            if (!this.sending()) this.messages.set(result.session.messages);
            this.sessionUpdated.emit(result.session);
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
