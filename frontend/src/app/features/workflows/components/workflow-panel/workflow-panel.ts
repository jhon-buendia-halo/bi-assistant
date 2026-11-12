import {
  Component,
  ElementRef,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import {
  Brain,
  CircleCheck,
  Database,
  Loader2,
  LucideAngularModule,
  MessageSquareReply,
  Rocket,
  Square,
  Wrench,
  X,
} from 'lucide-angular';
import { Dataset } from '../../../datasets/services/datasets-api.service';
import { ReadinessHistory } from '../../../data-readiness/components/readiness-history/readiness-history';
import { VisualEvent } from '../../../sessions/models/session.model';
import { RunVisual } from '../../../runs/components/run-visual/run-visual';
import { RunVisualsState } from '../../../runs/services/run-visuals-state';
import { AnswerView } from '../../../sessions/components/answer-view/answer-view';
import { PanelReadinessView } from '../../../sessions/components/panel-readiness-view/panel-readiness-view';
import {
  readinessPanelItemId,
  readinessPanelTitle,
} from '../../../sessions/models/readiness.model';
import {
  FilePanelItem,
  ReadinessPanelItem,
  ReadinessReportRef,
} from '../../../sessions/models/session.model';
import { MarkdownPipe } from '../../../../shared/pipes/markdown.pipe';
import { WorkflowInputField, WorkflowRun } from '../../models/workflow.model';
import { WorkflowRunFiles } from '../workflow-run-files/workflow-run-files';
import { WorkflowDesigner } from '../../services/workflow-designer.service';
import {
  RunOutputEntry,
  canRunFromPage,
  runOutputEntries,
  runStatusLine,
  runStepStatusLabel,
} from '../../services/workflows.util';

/** The run form's controls Execute workflow may focus, in order. */
const FORM_CONTROLS =
  'form input:not([disabled]):not([type="hidden"]), form textarea:not([disabled]), form select:not([disabled]), form button:not([disabled])';

/**
 * The right panel of a workflow's page, headed Run (workflows R13, R21;
 * ui.md 4.4b): the run form and the run shown, for a workflow that runs from
 * its page. The workflow's configuration is in the node dialogs on the page.
 * It shares its state with the page through the designer.
 */
@Component({
  selector: 'app-workflow-panel',
  imports: [
    AnswerView,
    LucideAngularModule,
    MarkdownPipe,
    PanelReadinessView,
    ReadinessHistory,
    RunVisual,
    WorkflowRunFiles,
  ],
  templateUrl: './workflow-panel.html',
  host: { class: 'flex min-h-0 flex-col', 'data-testid': 'workflow-panel' },
})
export class WorkflowPanel {
  protected readonly Brain = Brain;
  protected readonly CircleCheck = CircleCheck;
  protected readonly Database = Database;
  protected readonly Loader2 = Loader2;
  protected readonly MessageSquareReply = MessageSquareReply;
  protected readonly Rocket = Rocket;
  protected readonly Square = Square;
  protected readonly Wrench = Wrench;
  protected readonly X = X;

  protected readonly designer = inject(WorkflowDesigner);
  protected readonly visuals = inject(RunVisualsState);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  constructor() {
    // Execute workflow on the canvas: focus the run form, once per request.
    effect(() => {
      const request = this.designer.runFormRequest();
      if (request === 0) return;
      untracked(() => {
        this.designer.runFormRequest.set(0);
        setTimeout(() => this.focusRunForm());
      });
    });
  }

  /** The first visible, enabled control of the run form, else its Execute. */
  private focusRunForm(): void {
    const root = this.host.nativeElement;
    const controls = Array.from(
      root.querySelectorAll<HTMLElement>(FORM_CONTROLS),
    );
    const first = controls.find((el) => el.getClientRects().length > 0);
    (first ?? root.querySelector<HTMLElement>('[data-testid="workflow-run"]'))?.focus();
  }

  /** Only a workflow with an input runs from its page (R21). */
  protected readonly canRun = computed(() => {
    const workflow = this.designer.workflow();
    return workflow !== null && canRunFromPage(workflow);
  });

  /** A visual action stored the run: show it as it is now. */
  protected readonly applyRun = (run: WorkflowRun): void =>
    this.designer.run.set(run);

  protected readonly visualGenerating = computed(
    () => this.visuals.generating() === this.designer.run()?.id,
  );

  /** "Generate interactive visuals" on the stored run's answer. */
  protected generateVisual(): void {
    const run = this.designer.run();
    if (run !== null) this.visuals.generate(run, this.applyRun);
  }

  /** A visual card's View: open that visual under the answer. */
  protected viewVisual(event: VisualEvent): void {
    const run = this.designer.run();
    if (run !== null) this.visuals.view(run, event);
  }

  protected readonly stepStatusLabel = runStepStatusLabel;

  protected readonly runStatus = computed(() => {
    const result = this.designer.runResult();
    return result === null ? '' : runStatusLine(result);
  });
  /** The final output, field by field: for a run without an answer (code-only). */
  protected readonly runOutput = computed(() => {
    const result = this.designer.runResult();
    if (result === null || result.answer !== undefined) return [];
    return runOutputEntries(result.output);
  });

  /** The form's controls: every field the app does not set itself. */
  protected readonly visibleFields = computed(
    () => this.designer.workflow()?.input.filter((field) => !field.hidden) ?? [],
  );

  /**
   * A workflow over its own datasets (a user agent's): they are shown
   * read-only above the form, not picked (plan 4.2).
   */
  protected readonly fixedDatasets = computed(() => {
    const workflow = this.designer.workflow();
    if (workflow === null) return [];
    if (workflow.input.some((f) => f.type === 'datasets' || f.type === 'dataset')) {
      return [];
    }
    return workflow.datasets;
  });

  /** The latest line of the agent's reasoning, for the Thinking block. */
  protected readonly reasoningSnippet = computed(() => {
    const text = this.designer.reasoning().replace(/\s+/g, ' ').trim();
    return text.length > 120 ? `…${text.slice(-120)}` : text;
  });

  /**
   * The scorecard opened from the run's readiness card (data-readiness R5),
   * kept with the run it belongs to: a new run shows none.
   */
  private readonly scorecard = signal<{
    runId: string | null;
    item: ReadinessPanelItem;
  } | null>(null);
  protected readonly shownScorecard = computed(() => {
    const open = this.scorecard();
    return open !== null && open.runId === this.designer.runId() ? open.item : null;
  });

  /** The files the stored run saved (synthetic SQL scripts), to download. */
  protected readonly runFiles = computed(() =>
    (this.designer.run()?.panelItems ?? []).filter(
      (item): item is FilePanelItem => item.kind === 'file',
    ),
  );

  protected inputId(name: string): string {
    return `workflow-input-${name}`;
  }

  protected onInput(name: string, event: Event): void {
    const value = (event.target as HTMLInputElement | HTMLTextAreaElement)
      .value;
    this.designer.setInput(name, value);
  }

  protected onCheck(name: string, event: Event): void {
    this.designer.setInput(name, (event.target as HTMLInputElement).checked);
  }

  /** A step's output, field by field (texts unescaped). */
  protected stepOutput(value: Record<string, unknown>): RunOutputEntry[] {
    return runOutputEntries(value);
  }

  /** The datasets a `dataset` or `datasets` field offers: its kinds only, when it names some. */
  protected datasetChoices(field: WorkflowInputField): Dataset[] {
    const kinds = field.datasourceKinds;
    const all = this.designer.datasets();
    if (!kinds || kinds.length === 0) return all;
    return all.filter(
      (d) => d.datasourceKind !== undefined && kinds.includes(d.datasourceKind),
    );
  }

  /** An example chip fills the question and does not run (plan 4.2). */
  protected pickExample(text: string): void {
    const field = this.designer.questionField();
    if (field !== null) this.designer.setInput(field, text);
  }

  /**
   * Open scorecard: the run's saved panel item for the report, else the same
   * item the orchestrator writes; always a fresh object, so a scorecard
   * showing a past assessment comes back to this one.
   */
  protected openScorecard(ref: ReadinessReportRef): void {
    const id = readinessPanelItemId(ref.reportId);
    const saved = this.designer
      .run()
      ?.panelItems?.find(
        (item): item is ReadinessPanelItem => item.kind === 'readiness' && item.id === id,
      );
    this.scorecard.set({
      runId: this.designer.runId(),
      item: saved
        ? { ...saved }
        : {
            id,
            kind: 'readiness',
            title: readinessPanelTitle(ref.datasourceName),
            shownAt: ref.generatedAt,
            reportId: ref.reportId,
          },
    });
  }

  protected closeScorecard(): void {
    this.scorecard.set(null);
  }

  protected onFollowUpInput(event: Event): void {
    this.designer.followUpText.set((event.target as HTMLInputElement).value);
  }

  protected sendFollowUp(): void {
    this.designer.followUp(this.designer.followUpText());
  }
}
