import { Component, computed, effect, inject, signal, untracked } from '@angular/core';
import {
  ArrowLeft,
  Loader2,
  LucideAngularModule,
  MessageSquareReply,
  RotateCcw,
  TriangleAlert,
  Workflow,
} from 'lucide-angular';
import { QUERY_EVIDENCE_API } from '../../../../shared/query-evidence/query-evidence.model';
import { QueryInspector } from '../../../../shared/query-evidence/query-inspector/query-inspector';
import {
  QueryOpener,
  focusQueryOpener,
  queryOpenerOf,
} from '../../../../shared/query-evidence/query-opener';
import { AnswerView } from '../../../sessions/components/answer-view/answer-view';
import {
  runOutputEntries,
  runStatusLine,
  runStepStatusLabel,
} from '../../../workflows/services/workflows.util';
import { ANSWER_BUSINESS_QUESTION_WORKFLOW_ID } from '../../../workflows/models/workflow.model';
import { RunDetailQueryEvidenceApi } from '../../services/run-detail-query-evidence-api';
import { RunVisualsState } from '../../services/run-visuals-state';
import { RunsState } from '../../services/runs-state';
import { RunVisual } from '../run-visual/run-visual';
import { WorkflowRun } from '../../../workflows/models/workflow.model';

/** One field of a run's input as `run-detail` shows it. */
export interface RunInputEntry {
  name: string;
  value: string;
}

/** A run's input, field by field: lists joined, anything else as text. */
export function runInputEntries(
  input: Record<string, unknown>,
): RunInputEntry[] {
  return Object.entries(input).map(([name, value]) => ({
    name,
    value: Array.isArray(value) ? value.join(', ') : String(value),
  }));
}

/**
 * A stored run reopened (workflows R18-R20; ui.md 4.4c `run-detail`): its result is read-only apart from the visual actions of its answer;
 * its workflow and status, its input, its steps, the answer through
 * `answer-view`, and Run again while its workflow is still in the
 * catalogue. A run of a removed workflow reads as a plain run. Only the
 * visual actions of the answer change the run.
 */
@Component({
  selector: 'app-run-detail',
  imports: [LucideAngularModule, AnswerView, QueryInspector, RunVisual],
  templateUrl: './run-detail.html',
  providers: [{ provide: QUERY_EVIDENCE_API, useClass: RunDetailQueryEvidenceApi }],
})
export class RunDetail {
  protected readonly state = inject(RunsState);
  protected readonly visuals = inject(RunVisualsState);

  /** A visual action stored the run: show it as it is now. */
  protected readonly applyRun = (run: WorkflowRun): void =>
    this.state.activeRun.set(run);

  private readonly evidenceApi = inject(QUERY_EVIDENCE_API);
  /** The runs whose evidence was already requested (api.md 139): once per run shown. */
  private readonly prepared = new Set<string>();
  private opener: QueryOpener | null = null;

  /** A run of Answer a Business Question shows its answer with the query inspector (workflows R31). */
  protected readonly inspectsQueries = computed(
    () =>
      this.state.activeRun()?.workflowId === ANSWER_BUSINESS_QUESTION_WORKFLOW_ID,
  );
  /** The query open in the sheet: an index into the answer's `data`. */
  private readonly openIndex = signal<number | null>(null);
  protected readonly openQuery = computed(() => {
    const index = this.openIndex();
    const answer = this.state.activeRun()?.answer ?? null;
    return this.inspectsQueries() &&
      index !== null &&
      answer !== null &&
      answer.data?.[index] !== undefined
      ? { index, answer }
      : null;
  });

  constructor() {
    // Another run shown: the sheet closes; its evidence is built once, in the background.
    effect(() => {
      const run = this.state.activeRun();
      const id = run?.id ?? null;
      untracked(() => {
        if (id !== this.lastRunId) {
          this.lastRunId = id;
          this.openIndex.set(null);
        }
        if (
          run === null ||
          run.workflowId !== ANSWER_BUSINESS_QUESTION_WORKFLOW_ID ||
          !run.answer?.data?.length ||
          run.status === 'running' ||
          run.status === 'suspended' ||
          this.prepared.has(run.id)
        ) {
          return;
        }
        this.prepared.add(run.id);
        this.evidenceApi.prepare().subscribe({ error: () => undefined });
      });
    });
  }
  private lastRunId: string | null = null;

  /** A chip or a row: the query opens in the sheet at the right of the page. */
  protected inspectQuery(index: number): void {
    if (this.openIndex() === null) {
      const active = window.document.activeElement;
      this.opener = active === null ? null : queryOpenerOf(active);
    }
    this.openIndex.set(index);
  }

  protected closeQuery(): void {
    this.openIndex.set(null);
    focusQueryOpener(this.opener);
    this.opener = null;
  }

  protected readonly ArrowLeft = ArrowLeft;
  protected readonly Loader2 = Loader2;
  protected readonly MessageSquareReply = MessageSquareReply;
  protected readonly RotateCcw = RotateCcw;
  protected readonly TriangleAlert = TriangleAlert;
  protected readonly Workflow = Workflow;

  protected readonly stepStatus = runStepStatusLabel;

  protected readonly status = computed(() => {
    const run = this.state.activeRun();
    return run === null ? '' : runStatusLine(run);
  });
  protected readonly inputs = computed(() =>
    runInputEntries(this.state.activeRun()?.input ?? {}),
  );
  /** A run without an answer (code-only): its output, field by field. */
  protected readonly output = computed(() => {
    const run = this.state.activeRun();
    return run === null || run.answer !== undefined
      ? []
      : runOutputEntries(run.output);
  });
}
