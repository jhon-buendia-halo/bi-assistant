import { Component, computed, inject, output, signal } from '@angular/core';
import {
  Bot,
  Brain,
  Check,
  ChevronRight,
  CircleCheck,
  CircleX,
  Copy,
  CornerDownRight,
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
import {
  WorkflowInputField,
  WorkflowRun,
  WorkflowSummary,
} from '../../models/workflow.model';
import { WorkflowRunFiles } from '../workflow-run-files/workflow-run-files';
import {
  WorkflowDesigner,
  WorkflowPanelTab,
} from '../../services/workflow-designer.service';
import {
  RunOutputEntry,
  runOutputEntries,
  runStatusLine,
  runStepStatusLabel,
} from '../../services/workflows.util';

/** What drives a chat's workflow bar (workflows R10). */
export const BAR_NOTES: Record<WorkflowSummary['bar'], string> = {
  steps: 'In a chat, the workflow bar shows these steps as they run.',
  agent: "In a chat, the workflow bar shows the agent's own steps as it sets them.",
};

export const TRIGGER_LABELS: Record<WorkflowSummary['trigger'], string> = {
  run: 'Runs on an input',
  chat: 'Runs in a chat',
};

export const NO_STEP_SELECTED =
  'Select a step in the graph to see its configuration.';

/** How long the Code tab's Copy says `Copied`. */
const COPIED_MS = 2000;

/**
 * The right panel of a workflow's page (workflows R7, R8, R10, R12, R13;
 * ui.md 4.4b): tabs for the workflow's configuration, the selected step,
 * the run form and result (run workflows only) and the definition as JSON.
 * Read-only (R3); it shares its state with the page through the designer.
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
  protected readonly Bot = Bot;
  protected readonly Brain = Brain;
  protected readonly Check = Check;
  protected readonly ChevronRight = ChevronRight;
  protected readonly CircleCheck = CircleCheck;
  protected readonly CircleX = CircleX;
  protected readonly Copy = Copy;
  protected readonly CornerDownRight = CornerDownRight;
  protected readonly Database = Database;
  protected readonly Loader2 = Loader2;
  protected readonly MessageSquareReply = MessageSquareReply;
  protected readonly Rocket = Rocket;
  protected readonly Square = Square;
  protected readonly Wrench = Wrench;
  protected readonly X = X;

  protected readonly designer = inject(WorkflowDesigner);
  protected readonly visuals = inject(RunVisualsState);

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

  /** An agent row; the shell opens the agent's detail (R8). */
  readonly openAgent = output<string>();

  protected readonly noStep = NO_STEP_SELECTED;
  protected readonly triggerLabels = TRIGGER_LABELS;
  protected readonly barNotes = BAR_NOTES;
  protected readonly stepStatusLabel = runStepStatusLabel;

  /** The last step's output fields: what the workflow returns. */
  protected readonly outputFields = computed(() => {
    const steps = this.designer.workflow()?.steps ?? [];
    return steps.length === 0 ? [] : steps[steps.length - 1].output;
  });

  /**
   * A chat workflow has no typed input: what it takes from each chat message
   * is its first step's input.
   */
  protected readonly chatInputKeys = computed(() => {
    const workflow = this.designer.workflow();
    // Only a chat workflow without a typed input of its own falls back to its
    // first step's inputs; once it declares one (1.23.12), that list is it.
    if (workflow === null || workflow.trigger !== 'chat') return [];
    if (workflow.input.length > 0) return [];
    return workflow.steps.length === 0 ? [] : workflow.steps[0].input;
  });

  protected readonly code = computed(() => {
    const workflow = this.designer.workflow();
    return workflow === null ? '' : JSON.stringify(workflow, null, 2);
  });

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
    if (workflow === null || workflow.picksDatasets) return [];
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

  protected readonly copied = signal(false);
  private copiedTimer: ReturnType<typeof setTimeout> | null = null;

  protected tabId(tab: WorkflowPanelTab): string {
    return `workflow-panel-tab-${tab}`;
  }

  protected panelId(tab: WorkflowPanelTab): string {
    return `workflow-panel-${tab}`;
  }

  /** Left and Right move between the tabs and focus the new one. */
  protected onTabKeydown(event: KeyboardEvent): void {
    if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
    event.preventDefault();
    const tabs = this.designer.tabs();
    const index = tabs.findIndex((tab) => tab.id === this.designer.tab());
    const step = event.key === 'ArrowRight' ? 1 : -1;
    const next = tabs[(index + step + tabs.length) % tabs.length];
    this.designer.setTab(next.id);
    const button = (event.currentTarget as HTMLElement).querySelector<HTMLElement>(
      `#${this.tabId(next.id)}`,
    );
    button?.focus();
  }

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

  /** RFP Continue (plan 4.3): the cleared message takes the focus for the reply. */
  protected continueRun(): void {
    this.designer.continueRun();
    const field = this.designer.questionField();
    if (field === null) return;
    setTimeout(() =>
      document.getElementById(this.inputId(field))?.focus(),
    );
  }

  protected copyCode(): void {
    const clipboard = window.navigator.clipboard;
    if (!clipboard) return;
    clipboard.writeText(this.code()).then(
      () => {
        this.copied.set(true);
        if (this.copiedTimer !== null) clearTimeout(this.copiedTimer);
        this.copiedTimer = setTimeout(() => this.copied.set(false), COPIED_MS);
      },
      () => this.copied.set(false),
    );
  }
}
