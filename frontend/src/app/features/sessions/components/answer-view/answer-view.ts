import { NgTemplateOutlet } from '@angular/common';
import {
  Component,
  ElementRef,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import {
  LucideAngularModule,
  ArrowUp,
  BadgeCheck,
  BarChart3,
  Copy,
  Download,
  FileArchive,
  Info,
  Loader2,
  ShieldAlert,
  ShieldCheck,
  ShieldOff,
  Sparkles,
  Telescope,
  ThumbsDown,
  ThumbsUp,
  TriangleAlert,
  Wrench,
} from 'lucide-angular';
import {
  AnalysisReport,
  ChatMessage,
  CrossCheck,
  MessageFeedback,
  ReadinessReportRef,
  ReasoningStep,
  ToolDataRecord,
  VisualEvent,
} from '../../models/session.model';
import {
  legacyTagAccentClass,
  legacyTagDescription,
  legacyTagLabel,
} from '../../../ontology/models/ontology.model';
import { ToastService } from '../../../../core/toast/toast.service';
import { MarkdownPipe } from '../../../../shared/pipes/markdown.pipe';
import { ReadinessCard } from '../session-chat/readiness-card';

/** What the clarification card's **Skip** answers. */
export const SKIP_CLARIFICATION_ANSWER =
  'Skip — proceed with your best judgment.';

/**
 * One assistant answer and its provenance (ui.md 4.12; 1.23.13): the
 * Markdown body, the reasoning, ontology and data blocks, the badges and
 * rating, the clarification card and the report, readiness and
 * visual event cards. It holds no session: everything that reaches the
 * backend is an output, so the chat, a run result and a past chat can host
 * it alike.
 */
@Component({
  selector: 'app-answer-view',
  imports: [LucideAngularModule, MarkdownPipe, NgTemplateOutlet, ReadinessCard],
  templateUrl: './answer-view.html',
  styleUrl: './answer-view.scss',
})
export class AnswerView {
  // Labels/colours for the ontology items an answer was produced under. The
  // per-turn record keeps the legacy tags (term, default_filter, …); the
  // ontology model maps them so the chat and the Ontology tab never drift.
  readonly knowledgeKindLabel = legacyTagLabel;
  readonly knowledgeDescription = legacyTagDescription;
  readonly knowledgeAccentClass = legacyTagAccentClass;

  readonly ArrowUp = ArrowUp;
  readonly BadgeCheck = BadgeCheck;
  readonly BarChart3 = BarChart3;
  readonly Copy = Copy;
  readonly Download = Download;
  readonly FileArchive = FileArchive;
  readonly Info = Info;
  readonly Loader2 = Loader2;
  readonly ShieldAlert = ShieldAlert;
  readonly ShieldCheck = ShieldCheck;
  readonly ShieldOff = ShieldOff;
  readonly Sparkles = Sparkles;
  readonly Telescope = Telescope;
  readonly ThumbsDown = ThumbsDown;
  readonly ThumbsUp = ThumbsUp;
  readonly TriangleAlert = TriangleAlert;
  readonly Wrench = Wrench;

  private readonly toast = inject(ToastService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  /** The assistant message to render (not a user message, not an error). */
  readonly message = input.required<ChatMessage>();
  /** Element id of the report card (the chat's `msg-<i>`). */
  readonly anchorId = input<string | null>(null);
  /** Only the latest clarification card can be answered. */
  readonly latest = input(false);
  /** The host is sending a turn: clarification answers and visuals wait. */
  readonly busy = input(false);
  /** Shows the thumbs on an answer that has data (verified-queries). */
  readonly showRating = input(false);
  /** The host is persisting this answer's rating. */
  readonly ratingPending = input(false);
  /** Shows **Generate interactive visuals** under an answer with text. */
  readonly showGenerateVisual = input(false);
  readonly visualGenerating = input(false);
  /** This message's report is being downloaded. */
  readonly reportDownloading = input(false);

  /** A clarification answer: an option label, a custom answer or Skip. */
  readonly optionPicked = output<string>();
  readonly rate = output<MessageFeedback>();
  readonly generateVisual = output<void>();
  readonly viewVisual = output<VisualEvent>();
  readonly openScorecard = output<ReadinessReportRef>();
  readonly downloadReport = output<AnalysisReport>();

  /** Inline custom answer inside the clarification card. */
  readonly customAnswerOpen = signal(false);
  readonly customAnswer = signal('');

  // --------------------------------------------------- clarification card

  pick(label: string): void {
    if (this.busy()) return;
    this.customAnswer.set('');
    this.customAnswerOpen.set(false);
    this.optionPicked.emit(label);
  }

  skipClarification(): void {
    this.pick(SKIP_CLARIFICATION_ANSWER);
  }

  toggleCustomAnswer(): void {
    this.customAnswerOpen.set(!this.customAnswerOpen());
    if (this.customAnswerOpen()) {
      setTimeout(() => {
        const el = this.host.nativeElement.querySelector(
          '#custom-answer',
        ) as HTMLInputElement | null;
        el?.focus();
      });
    }
  }

  sendCustomAnswer(): void {
    const answer = this.customAnswer().trim();
    if (!answer || this.busy()) return;
    this.pick(answer);
  }

  onCustomAnswerKeydown(event: KeyboardEvent): void {
    if (event.key === 'Enter') {
      event.preventDefault();
      this.sendCustomAnswer();
    }
  }

  // --------------------------------------------------- answer actions

  requestVisualization(): void {
    if (this.busy() || this.visualGenerating()) return;
    this.generateVisual.emit();
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
      return 'border-on-success-soft/30 bg-success-soft text-on-success-soft';
    }
    return check.status === 'disagree'
      ? 'border-on-warning-soft/30 bg-warning-soft text-on-warning-soft'
      : 'border-border bg-surface-muted text-fg-muted';
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
}
