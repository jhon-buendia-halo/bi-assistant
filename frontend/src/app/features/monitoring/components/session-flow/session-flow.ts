import { Component, computed, inject, input, output, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { catchError, map, of, switchMap, tap } from 'rxjs';
import {
  ChartGantt,
  ExternalLink,
  Loader2,
  LucideAngularModule,
  MessageSquare,
  TriangleAlert,
} from 'lucide-angular';
import { MonitoringApiService } from '../../services/monitoring-api.service';
import {
  STATUS_CHIPS,
  STATUS_LABELS,
  formatCost,
  formatDuration,
  formatTokens,
} from '../../models/llm-call.model';
import {
  SessionDetail,
  ToolGroup,
  Turn,
  formatSeconds,
  plural,
  sessionName,
  spanColour,
} from '../../models/session-flow.model';
import { TraceWaterfall } from '../trace-waterfall/trace-waterfall';

type Outcome =
  | { ok: true; session: SessionDetail }
  | { ok: false; message: string };

/** An answer longer than this, or than six lines, starts clamped. */
const LONG_ANSWER_CHARS = 480;

/**
 * One session's execution flow (roadmap 1.21.16): its totals, then each turn
 * as the question, the path the agent took (model requests and the tools
 * they called) and the answer. A turn's timeline opens its waterfall inline.
 */
@Component({
  selector: 'app-session-flow',
  imports: [LucideAngularModule, TraceWaterfall],
  templateUrl: './session-flow.html',
})
export class SessionFlowPage {
  readonly ChartGantt = ChartGantt;
  readonly ExternalLink = ExternalLink;
  readonly Loader2 = Loader2;
  readonly MessageSquare = MessageSquare;
  readonly TriangleAlert = TriangleAlert;

  readonly statusLabels = STATUS_LABELS;
  readonly statusChips = STATUS_CHIPS;
  readonly formatTokens = formatTokens;
  readonly formatDuration = formatDuration;
  readonly formatCost = formatCost;
  readonly formatSeconds = formatSeconds;
  readonly colour = spanColour;

  readonly sessionId = input.required<string>();
  /** A model call to open (its model_generation span id). */
  readonly openCall = output<string>();
  /** The session whose chat should open. */
  readonly openChat = output<string>();

  private readonly api = inject(MonitoringApiService);

  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly session = signal<SessionDetail | null>(null);

  /** Turns (by index) whose timeline is open. */
  readonly openTimelines = signal<ReadonlySet<number>>(new Set());
  /** Turns (by index) whose long answer is shown in full. */
  readonly expandedAnswers = signal<ReadonlySet<number>>(new Set());

  readonly title = computed(() => {
    const session = this.session();
    return session === null ? '' : sessionName(session);
  });

  constructor() {
    toObservable(this.sessionId)
      .pipe(
        tap(() => {
          this.loading.set(true);
          this.error.set(null);
          this.session.set(null);
          this.openTimelines.set(new Set());
          this.expandedAnswers.set(new Set());
        }),
        switchMap((id) =>
          this.api.getSession(id).pipe(
            map((session): Outcome => ({ ok: true, session })),
            catchError((err) => {
              const detail = err?.error?.message;
              return of<Outcome>({
                ok: false,
                message:
                  typeof detail === 'string' && detail
                    ? detail
                    : 'Could not load the session',
              });
            }),
          ),
        ),
        takeUntilDestroyed(),
      )
      .subscribe((outcome) => {
        if (outcome.ok) this.session.set(outcome.session);
        else this.error.set(outcome.message);
        this.loading.set(false);
      });
  }

  /** "Turn 1 · 18.31 s · 4 model requests · 6 tools · 61,185 in / 2,445 out · $0.0729". */
  meta(turn: Turn): string {
    const requests = turn.steps.filter((step) => step.kind === 'model').length;
    const tools = this.toolCount(turn);
    return [
      `Turn ${turn.index}`,
      formatSeconds(turn.durationMs),
      plural(requests, 'model request', 'model requests'),
      tools === 0 ? 'no tools' : plural(tools, 'tool', 'tools'),
      `${formatTokens(turn.inputTokens)} in / ${formatTokens(turn.outputTokens)} out`,
      formatCost(turn.costUsd),
    ].join(' · ');
  }

  toolCount(turn: Turn): number {
    return turn.steps.reduce(
      (sum, step) =>
        step.kind === 'tools'
          ? sum + step.tools.reduce((n, tool) => n + tool.count, 0)
          : sum,
      0,
    );
  }

  /** "describe_entity ×3"; no "×1". */
  toolLabel(tool: ToolGroup): string {
    return tool.count > 1 ? `${tool.name} ×${tool.count}` : tool.name;
  }

  /** "12 rows", "1 row". */
  rowsLabel(rows: number): string {
    return plural(rows, 'row', 'rows');
  }

  isTimelineOpen(turn: Turn): boolean {
    return this.openTimelines().has(turn.index);
  }

  toggleTimeline(turn: Turn): void {
    this.openTimelines.update((open) => toggled(open, turn.index));
  }

  isLong(answer: string): boolean {
    return answer.length > LONG_ANSWER_CHARS || answer.split('\n').length > 6;
  }

  isAnswerExpanded(turn: Turn): boolean {
    return this.expandedAnswers().has(turn.index);
  }

  toggleAnswer(turn: Turn): void {
    this.expandedAnswers.update((open) => toggled(open, turn.index));
  }
}

function toggled(set: ReadonlySet<number>, value: number): Set<number> {
  const next = new Set(set);
  if (next.has(value)) next.delete(value);
  else next.add(value);
  return next;
}
