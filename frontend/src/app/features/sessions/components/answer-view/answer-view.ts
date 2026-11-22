import { NgTemplateOutlet } from '@angular/common';
import {
  Component,
  ElementRef,
  TemplateRef,
  computed,
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
  Database,
  FileArchive,
  Info,
  Loader2,
  ShieldAlert,
  ShieldCheck,
  ShieldOff,
  Sparkles,
  ThumbsDown,
  ThumbsUp,
  TriangleAlert,
  Wrench,
} from 'lucide-angular';
import {
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
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import {
  figureIndex,
  linkFigures,
  questionNumbers,
  sampleQueriesOf,
} from '../../../../shared/query-evidence/figure-refs';
import { blufParts } from './answer-bluf';
import {
  SourceInfo,
  sourceInfos,
  sourceLabel,
} from '../../../../shared/query-evidence/query-labels';
import { QueryEvidenceSummary } from '../../../../shared/query-evidence/query-evidence-summary/query-evidence-summary';
import {
  MarkdownPipe,
  renderMarkdown,
} from '../../../../shared/pipes/markdown.pipe';
import { ReadinessCard } from '../session-chat/readiness-card';

/** What the clarification card's **Skip** answers. */
export const SKIP_CLARIFICATION_ANSWER =
  'Skip — proceed with your best judgment.';

/**
 * One assistant answer and its provenance (ui.md 4.12; 1.23.13): the
 * Markdown body, the reasoning, ontology and data blocks, the badges and
 * rating, the clarification card and the readiness and visual event
 * cards. It holds no session: everything that reaches the
 * backend is an output, so the chat, a run result and a past chat can host
 * it alike.
 */
let nextCardId = 0;

/** What the hover card of a source chip shows. */
export interface SourceCard {
  label: string;
  purpose: string;
  detail: string;
  sample: boolean;
  also: string;
  left: number;
  top: number;
}

@Component({
  selector: 'app-answer-view',
  imports: [
    LucideAngularModule,
    MarkdownPipe,
    NgTemplateOutlet,
    QueryEvidenceSummary,
    ReadinessCard,
  ],
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
  readonly Database = Database;
  readonly FileArchive = FileArchive;
  readonly Info = Info;
  readonly Loader2 = Loader2;
  readonly ShieldAlert = ShieldAlert;
  readonly ShieldCheck = ShieldCheck;
  readonly ShieldOff = ShieldOff;
  readonly Sparkles = Sparkles;
  readonly ThumbsDown = ThumbsDown;
  readonly ThumbsUp = ThumbsUp;
  readonly TriangleAlert = TriangleAlert;
  readonly Wrench = Wrench;

  private readonly toast = inject(ToastService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly sanitizer = inject(DomSanitizer);

  /** The assistant message to render (not a user message, not an error). */
  readonly message = input.required<ChatMessage>();
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
  /**
   * The host shows the query inspector (1.25): figures carry a query chip and
   * the coverage line and query rows replace "How I worked this out" and
   * "Data used". Off, the answer renders exactly as before.
   */
  readonly queryInspector = input(false);
  /**
   * The question this answer replies to, when the host knows it. A number the
   * answer repeats from it ("the top 100") gets no figure chip.
   */
  readonly question = input<string | null>(null);
  /**
   * How the host shows a visual this message created (visuals R42): a run's
   * host gives its artifact card, with a live preview and Open; without one,
   * the compact Created / View strip.
   */
  readonly visualCard = input<TemplateRef<{ $implicit: VisualEvent }> | null>(
    null,
  );

  /** The answer body with a chip after each figure (inspector mode only). */
  private readonly inspectorHtml = computed(() => {
    const msg = this.message();
    return linkFigures(
      renderMarkdown(msg.content),
      figureIndex(msg.data),
      sampleQueriesOf(msg.evidence),
      questionNumbers(this.question()),
      sourceInfos(msg),
    );
  });
  // Sanitized first; only code-made integers and labels were added after.
  readonly inspectorBody = computed<SafeHtml>(() =>
    this.sanitizer.bypassSecurityTrustHtml(this.inspectorHtml()),
  );

  /**
   * The host lays the answer out bottom line first (ui.md 4.4b *Answer
   * first*): the run chat. Only with the query inspector, whose figure
   * chips the parts keep.
   */
  readonly bluf = input(false);
  /** The answer's parts when laid out bottom line first; null to read it as written. */
  readonly blufView = computed(() => {
    if (!this.bluf() || !this.queryInspector()) return null;
    const parts = blufParts(this.inspectorHtml());
    if (!parts) return null;
    const safe = (html: string) => this.sanitizer.bypassSecurityTrustHtml(html);
    return {
      headline: safe(parts.headline),
      context: parts.context ? safe(parts.context) : null,
      body: safe(parts.body),
      folded: parts.folded
        ? { titles: parts.folded.titles, html: safe(parts.folded.html) }
        : null,
    };
  });

  /** A clarification answer: an option label, a custom answer or Skip. */
  readonly optionPicked = output<string>();
  readonly rate = output<MessageFeedback>();
  readonly generateVisual = output<void>();
  readonly viewVisual = output<VisualEvent>();
  readonly openScorecard = output<ReadinessReportRef>();
  /** A figure chip or a query row was picked: the index into the message's `data`. */
  readonly inspectQuery = output<number>();

  /** One handler on the prose element catches the figure chips and table source lines. */
  onProseClick(event: Event): void {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const chip = target.closest('button.figure-ref, button.table-source');
    const index = Number(chip?.getAttribute('data-query-index'));
    if (chip && Number.isInteger(index)) this.inspectQuery.emit(index);
  }

  /** The one card, reused for every chip: what the chip's source is. */
  readonly card = signal<SourceCard | null>(null);
  readonly cardId = `figure-ref-card-${nextCardId++}`;
  private cardChip: Element | null = null;

  onProseOver(event: Event): void {
    this.showCard(event.target);
  }

  onProseOut(event: Event): void {
    const target = event.target;
    if (target instanceof Element && target.closest('button.figure-ref') === this.cardChip) {
      this.hideCard();
    }
  }

  onProseKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape' && this.card() !== null) this.hideCard();
  }

  private showCard(target: EventTarget | null): void {
    if (!(target instanceof Element)) return;
    const chip = target.closest('button.figure-ref');
    if (!chip || chip === this.cardChip) return;
    const index = Number(chip.getAttribute('data-query-index'));
    if (!Number.isInteger(index)) return;
    this.hideCard();
    const info: SourceInfo | undefined = sourceInfos(this.message())[index];
    const wrap = chip.closest('[data-testid="answer-prose"]');
    if (!wrap) return;
    const at = chip.getBoundingClientRect();
    const box = wrap.getBoundingClientRect();
    const also = (chip.getAttribute('data-also') ?? '')
      .split(',')
      .filter((part) => part !== '')
      .map((part) => Number(part))
      .filter((n) => Number.isInteger(n));
    const left = Math.max(0, Math.min(at.left - box.left, box.width - 288));
    this.cardChip = chip;
    chip.setAttribute('aria-describedby', this.cardId);
    this.card.set({
      label: info?.label ?? sourceLabel(index),
      purpose: info?.purpose ?? `Query ${index + 1}`,
      detail: [info?.rows, info?.coverage].filter((part) => !!part).join(' · '),
      sample: chip.getAttribute('data-sample') === 'true',
      also: also.length
        ? `Also in ${also.length > 1 ? 'sources' : 'source'} ${also.map((q) => q + 1).join(', ')}`
        : '',
      left,
      top: at.bottom - box.top + 4,
    });
  }

  private hideCard(): void {
    this.cardChip?.removeAttribute('aria-describedby');
    this.cardChip = null;
    this.card.set(null);
  }

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
