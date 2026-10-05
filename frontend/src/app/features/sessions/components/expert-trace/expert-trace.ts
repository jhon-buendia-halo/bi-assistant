import { DecimalPipe, NgTemplateOutlet } from '@angular/common';
import {
  Component,
  computed,
  inject,
  input,
  linkedSignal,
  output,
  signal,
} from '@angular/core';
import {
  ChevronDown,
  ChevronRight,
  FileCode,
  Gauge,
  GraduationCap,
  Lightbulb,
  Loader2,
  LucideAngularModule,
  LucideIconData,
  MessageSquareText,
  Network,
  NotebookPen,
  Sigma,
  ThumbsDown,
  ThumbsUp,
} from 'lucide-angular';
import { ToastService } from '../../../../core/toast/toast.service';
import {
  BlockFeedback,
  BlockFeedbackInput,
  BlockVote,
  CONFIDENCE_BANDS,
  Confidence,
  ConfidenceBand,
  EvidenceBasis,
  REASONING_BLOCK_KINDS,
  ReasoningBlock,
  ReasoningBlockKind,
  ReasoningTrace,
  SqlBlock,
} from '../../models/expert-trace.model';
import { SessionActionResult } from '../../models/session.model';
import { SessionsApiService } from '../../services/sessions-api.service';
import {
  TableJoinDiagram,
  shortEntityName,
} from '../table-join-diagram/table-join-diagram';

export const BLOCK_TITLES: Record<ReasoningBlockKind, string> = {
  interpretation: 'Interpretation',
  'data-selection': 'Data selection',
  assumptions: 'Assumptions',
  metric: 'Metric definition',
  sql: 'Annotated SQL',
};

const BLOCK_ICONS: Record<ReasoningBlockKind, LucideIconData> = {
  interpretation: MessageSquareText,
  'data-selection': Network,
  assumptions: Lightbulb,
  metric: Sigma,
  sql: FileCode,
};

const BAND_LABEL: Record<ConfidenceBand, string> = {
  high: 'High',
  medium: 'Medium',
  low: 'Low',
};

/** Badge text, e.g. "High · 86%". */
export function confidenceText(confidence: Confidence): string {
  return `${BAND_LABEL[confidence.band] ?? confidence.band} · ${percent(confidence.score)}`;
}

export function percent(value: number): string {
  return `${Math.round(Math.min(1, Math.max(0, value)) * 100)}%`;
}

const BAND_BADGE: Record<ConfidenceBand, string> = {
  high: 'border-emerald-400/20 bg-emerald-400/10 text-emerald-400',
  medium: 'border-amber-400/20 bg-amber-400/10 text-amber-400',
  low: 'border-red-400/20 bg-red-400/10 text-red-400',
};

const BAND_BAR: Record<ConfidenceBand, string> = {
  high: 'bg-emerald-400',
  medium: 'bg-amber-400',
  low: 'bg-red-400',
};

/** A signal value shares the band colours, so a weak one reads as weak. */
export function bandOf(value: number): ConfidenceBand {
  if (value >= CONFIDENCE_BANDS.high) return 'high';
  return value >= CONFIDENCE_BANDS.medium ? 'medium' : 'low';
}

const BASIS_LABEL: Record<EvidenceBasis, string> = {
  knowledge: 'Knowledge',
  metric: 'Metric',
  verified_query: 'Verified query',
  schema: 'Schema',
  data_sample: 'Data sample',
  convention: 'Convention',
  assumption: 'Assumption',
};

const BASIS_DESCRIPTION: Record<EvidenceBasis, string> = {
  knowledge: 'Backed by a curated knowledge snippet',
  metric: 'Backed by a governed metric definition',
  verified_query: 'Backed by an approved verified query',
  schema: 'Read off the dataset schema (columns, declared or inferred joins)',
  data_sample: 'Seen in the data itself',
  convention: 'Common business practice — nothing in this dataset confirms it',
  assumption: 'A guess — nothing in the context backs it',
};

/** Grounded sources emerald, the data itself sky, convention amber, guesses red. */
const BASIS_CHIP: Record<EvidenceBasis, string> = {
  knowledge: 'border-emerald-400/20 bg-emerald-400/10 text-emerald-400',
  metric: 'border-emerald-400/20 bg-emerald-400/10 text-emerald-400',
  verified_query: 'border-emerald-400/20 bg-emerald-400/10 text-emerald-400',
  schema: 'border-sky-400/20 bg-sky-400/10 text-sky-400',
  data_sample: 'border-sky-400/20 bg-sky-400/10 text-sky-400',
  convention: 'border-amber-400/20 bg-amber-400/10 text-amber-400',
  assumption: 'border-red-400/20 bg-red-400/10 text-red-400',
};

export interface SqlSegment {
  text: string;
  highlight: boolean;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Where an annotation's clause sits in the SQL. The backend keeps a clause
 * when it matches after whitespace normalisation, case-insensitively — so the
 * lookup is just as forgiving.
 */
export function locateClause(
  sql: string,
  clause: string,
): { start: number; end: number } | null {
  const tokens = clause.trim().split(/\s+/).filter(Boolean);
  if (!tokens.length) return null;
  const match = new RegExp(tokens.map(escapeRegExp).join('\\s+'), 'i').exec(sql);
  return match ? { start: match.index, end: match.index + match[0].length } : null;
}

/** The SQL split around one highlighted range (or whole, when there is none). */
export function sqlSegments(
  sql: string,
  range: { start: number; end: number } | null,
): SqlSegment[] {
  if (!range) return [{ text: sql, highlight: false }];
  return [
    { text: sql.slice(0, range.start), highlight: false },
    { text: sql.slice(range.start, range.end), highlight: true },
    { text: sql.slice(range.end), highlight: false },
  ].filter((segment) => segment.text);
}

type FeedbackMap = Partial<Record<ReasoningBlockKind, BlockFeedback>>;

/**
 * Business expert mode: how an answer was reasoned, block by block —
 * interpretation, data selection (as a table/join diagram), assumptions,
 * metric definition and annotated SQL. Every confidence badge opens the
 * measured signals behind it, and every block can be rated on its own.
 */
@Component({
  selector: 'app-expert-trace',
  imports: [DecimalPipe, LucideAngularModule, NgTemplateOutlet, TableJoinDiagram],
  templateUrl: './expert-trace.html',
  styleUrl: './expert-trace.scss',
})
export class ExpertTrace {
  readonly ChevronDown = ChevronDown;
  readonly ChevronRight = ChevronRight;
  readonly Gauge = Gauge;
  readonly GraduationCap = GraduationCap;
  readonly Loader2 = Loader2;
  readonly NotebookPen = NotebookPen;
  readonly ThumbsDown = ThumbsDown;
  readonly ThumbsUp = ThumbsUp;

  readonly shortEntityName = shortEntityName;
  readonly percent = percent;

  private readonly api = inject(SessionsApiService);
  private readonly toast = inject(ToastService);

  readonly trace = input.required<ReasoningTrace>();
  readonly sessionId = input.required<string>();
  /** `at` of the assistant message the trace belongs to — the feedback key. */
  readonly messageAt = input.required<string>();
  /**
   * Titles of this answer's `source: 'feedback'` knowledge — lessons learned
   * from a reviewer's note. A basis chip whose `sourceRef` matches one of
   * them (case-insensitive substring, either direction) gets a small
   * "Learned from your note" chip alongside it.
   */
  readonly learnedTitles = input<string[]>([]);
  /** A block rating was persisted; carries the refreshed session. */
  readonly feedbackSaved = output<SessionActionResult>();

  readonly expanded = signal(true);
  /** Which confidence panels are open: a block kind, or `overall`. */
  readonly openSignals = signal<ReadonlySet<string>>(new Set());
  /**
   * Local copy of the per-block feedback so a click shows at once; re-seeded
   * whenever the host hands in a refreshed trace.
   */
  readonly feedback = linkedSignal<FeedbackMap>(() => ({
    ...(this.trace().feedback ?? {}),
  }));
  readonly pending = signal<ReadonlySet<ReasoningBlockKind>>(new Set());
  /** Block whose note editor is open (one at a time). */
  readonly noteOpen = signal<ReasoningBlockKind | null>(null);
  readonly noteDraft = signal('');
  /** Index of the SQL annotation under the pointer / keyboard focus. */
  readonly hoveredAnnotation = signal<number | null>(null);

  /** Blocks in contract order, whatever order they were stored in. */
  readonly blocks = computed<ReasoningBlock[]>(() =>
    [...this.trace().blocks].sort(
      (a, b) =>
        REASONING_BLOCK_KINDS.indexOf(a.kind) -
        REASONING_BLOCK_KINDS.indexOf(b.kind),
    ),
  );

  private readonly sqlBlock = computed(
    () =>
      this.trace().blocks.find((block): block is SqlBlock => block.kind === 'sql'),
  );

  private readonly annotationRanges = computed(() => {
    const block = this.sqlBlock();
    return block
      ? block.annotations.map((a) => locateClause(block.sql, a.clause))
      : [];
  });

  readonly sqlParts = computed<SqlSegment[]>(() => {
    const block = this.sqlBlock();
    if (!block) return [];
    const index = this.hoveredAnnotation();
    const range = index === null ? null : (this.annotationRanges()[index] ?? null);
    return sqlSegments(block.sql, range);
  });

  title(kind: ReasoningBlockKind): string {
    return BLOCK_TITLES[kind];
  }

  icon(kind: ReasoningBlockKind): LucideIconData {
    return BLOCK_ICONS[kind];
  }

  confidenceText(confidence: Confidence): string {
    return confidenceText(confidence);
  }

  round100(value: number): number {
    return Math.round(value * 100);
  }

  badgeClass(band: ConfidenceBand): string {
    return BAND_BADGE[band] ?? BAND_BADGE.low;
  }

  barClass(value: number): string {
    return BAND_BAR[bandOf(value)];
  }

  basisLabel(basis: EvidenceBasis): string {
    return BASIS_LABEL[basis] ?? basis;
  }

  basisClass(basis: EvidenceBasis): string {
    return BASIS_CHIP[basis] ?? BASIS_CHIP.assumption;
  }

  /** Chip tooltip: the backing source when there is one, else what the basis means. */
  basisTitle(basis: EvidenceBasis, sourceRef?: string): string {
    const description = BASIS_DESCRIPTION[basis] ?? basis;
    return sourceRef?.trim() ? `${description}: ${sourceRef.trim()}` : description;
  }

  /**
   * Whether a basis chip's `sourceRef` names a lesson learned from feedback —
   * matched loosely (case-insensitive, either side containing the other)
   * since a `sourceRef` and a knowledge title are not always spelled alike.
   */
  isLearned(sourceRef?: string): boolean {
    const ref = sourceRef?.trim().toLowerCase();
    if (!ref) return false;
    return this.learnedTitles().some((title) => {
      const t = title.trim().toLowerCase();
      return !!t && (ref.includes(t) || t.includes(ref));
    });
  }

  isLocated(index: number): boolean {
    return !!this.annotationRanges()[index];
  }

  signalsOpen(key: string): boolean {
    return this.openSignals().has(key);
  }

  toggleSignals(key: string): void {
    this.openSignals.update((open) => {
      const next = new Set(open);
      if (!next.delete(key)) next.add(key);
      return next;
    });
  }

  isPending(kind: ReasoningBlockKind): boolean {
    return this.pending().has(kind);
  }

  /** Same vote twice clears it; the other vote switches. */
  vote(kind: ReasoningBlockKind, vote: BlockVote): void {
    const current = this.feedback()[kind];
    const next = current?.vote === vote ? null : vote;
    this.save(kind, { vote: next }, this.merge(current, { vote: next }));
  }

  toggleNote(kind: ReasoningBlockKind): void {
    if (this.noteOpen() === kind) {
      this.noteOpen.set(null);
      return;
    }
    this.noteDraft.set(this.feedback()[kind]?.comment ?? '');
    this.noteOpen.set(kind);
  }

  onNoteKeydown(event: KeyboardEvent, kind: ReasoningBlockKind): void {
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      this.saveNote(kind);
    } else if (event.key === 'Escape') {
      this.noteOpen.set(null);
    }
  }

  /**
   * An empty note clears a saved one; an unchanged note just closes. The
   * editor stays open (button reading "Save & teach") while the comment is
   * actually being persisted, since saving it also triggers learning.
   */
  saveNote(kind: ReasoningBlockKind): void {
    const comment = this.noteDraft().trim();
    const current = this.feedback()[kind];
    if (comment === (current?.comment ?? '')) {
      this.noteOpen.set(null);
      return;
    }
    this.save(kind, { comment }, this.merge(current, { comment }), comment, true);
  }

  private merge(
    current: BlockFeedback | undefined,
    change: { vote?: BlockVote | null; comment?: string },
  ): BlockFeedback | undefined {
    const vote = change.vote === undefined ? current?.vote : change.vote;
    const comment =
      change.comment === undefined ? current?.comment : change.comment;
    if (!vote && !comment) return undefined;
    return {
      ...(vote ? { vote } : {}),
      ...(comment ? { comment } : {}),
      at: new Date().toISOString(),
    };
  }

  private save(
    kind: ReasoningBlockKind,
    patch: Pick<BlockFeedbackInput, 'vote' | 'comment'>,
    optimistic: BlockFeedback | undefined,
    draft?: string,
    closeNoteOnSuccess = false,
  ): void {
    if (this.isPending(kind)) return;
    const previous = this.feedback()[kind];
    this.setLocal(kind, optimistic);
    this.setPending(kind, true);
    const revert = (message: string) => {
      this.setPending(kind, false);
      this.setLocal(kind, previous);
      if (draft !== undefined) {
        // Give the note back rather than losing what the user typed.
        this.noteDraft.set(draft);
        this.noteOpen.set(kind);
      }
      this.toast.error(message);
    };

    this.api
      .sendBlockFeedback(this.sessionId(), {
        messageAt: this.messageAt(),
        block: kind,
        ...patch,
      })
      .subscribe({
        next: (result) => {
          if (!result.ok) {
            revert(result.message || 'Could not save feedback');
            return;
          }
          this.setPending(kind, false);
          if (closeNoteOnSuccess) this.noteOpen.set(null);
          this.feedbackSaved.emit(result);
          this.toast.success(result.message || 'Feedback saved');
        },
        error: (err) => revert(err?.error?.message ?? 'Backend unreachable'),
      });
  }

  private setLocal(kind: ReasoningBlockKind, value: BlockFeedback | undefined): void {
    this.feedback.update((map) => {
      const next = { ...map };
      if (value) next[kind] = value;
      else delete next[kind];
      return next;
    });
  }

  private setPending(kind: ReasoningBlockKind, on: boolean): void {
    this.pending.update((set) => {
      const next = new Set(set);
      if (on) next.add(kind);
      else next.delete(kind);
      return next;
    });
  }
}
