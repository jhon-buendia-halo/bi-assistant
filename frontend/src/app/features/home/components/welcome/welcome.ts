import {
  Component,
  ElementRef,
  computed,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import {
  ArrowRight,
  Bot,
  CircleAlert,
  LucideAngularModule,
  SendHorizontal,
  Workflow,
} from 'lucide-angular';
import { BRAND } from '../../../../core/brand/brand';
import { ShellState } from '../../../../core/shell/shell-state';
import { DatasetPicker } from '../../../datasets/components/dataset-picker/dataset-picker';
import {
  Dataset,
  DatasetsApiService,
} from '../../../datasets/services/datasets-api.service';
import { LlmApiService } from '../../../llm/services/llm-api.service';
import { RunsState } from '../../../runs/services/runs-state';
import { sessionActivityLabel } from '../../../sessions/components/sessions-list/sessions-list';
import { SettingsState } from '../../../settings/services/settings-state';
import {
  WorkflowRunSummary,
  WorkflowSummary,
} from '../../../workflows/models/workflow.model';
import { WorkflowDesigner } from '../../../workflows/services/workflow-designer.service';
import { WorkflowsApiService } from '../../../workflows/services/workflows-api.service';
import { WorkflowsNavState } from '../../../workflows/services/workflows-nav-state';
import { runRowStatus } from '../../../workflows/services/workflows.util';

/** The workflow the home's question box runs (app-shell R51). */
export const ASK_WORKFLOW_ID = 'orchestrated-answer-michael';

/** How many runs the home lists; the rest are one click away in Runs. */
export const HOME_RECENT_RUNS = 5;

/** What still blocks a first question, in the order to fix it. */
export type SetupGap = 'llm' | 'datasets';

/**
 * The start page (ui.md 4.1, app-shell R51): a question box that runs
 * Answer a Business Question (Avery + Michael) on the picked datasets, the latest runs, the
 * other workflows, and what is still missing before a first question.
 */
@Component({
  selector: 'app-welcome',
  imports: [LucideAngularModule, DatasetPicker],
  templateUrl: './welcome.html',
  host: { class: 'flex min-h-0 flex-col' },
})
export class Welcome {
  protected readonly ArrowRight = ArrowRight;
  protected readonly Bot = Bot;
  protected readonly CircleAlert = CircleAlert;
  protected readonly SendHorizontal = SendHorizontal;
  protected readonly Workflow = Workflow;

  /** The welcome heading's words and look follow the brand (app-shell R51, ADR-0045). */
  readonly brand = BRAND;
  readonly flat = BRAND.shell === 'flat';

  private readonly shell = inject(ShellState);
  private readonly settings = inject(SettingsState);
  private readonly designer = inject(WorkflowDesigner);
  private readonly workflowsNav = inject(WorkflowsNavState);
  private readonly workflowsApi = inject(WorkflowsApiService);
  private readonly datasetsApi = inject(DatasetsApiService);
  private readonly llmApi = inject(LlmApiService);
  protected readonly runsState = inject(RunsState);

  private readonly questionBox =
    viewChild<ElementRef<HTMLTextAreaElement>>('questionBox');

  /** The catalogue; null until it loads. */
  readonly workflows = signal<WorkflowSummary[] | null>(null);
  /** The datasets; null until they load (or when they can't be read). */
  readonly datasets = signal<Dataset[] | null>(null);
  /** Whether a model is configured; null until known. */
  readonly llmConfigured = signal<boolean | null>(null);

  readonly question = signal('');
  readonly picked = signal<string[]>([]);
  /** The field Ask refused, with its message; null when none. */
  readonly refused = signal<{
    field: 'question' | 'datasets';
    message: string;
  } | null>(null);
  readonly error = computed(() => this.refused()?.message ?? null);
  readonly errorField = computed(() => this.refused()?.field ?? null);

  /** Answer a Business Question, as the catalogue lists it. */
  readonly askWorkflow = computed(
    () => this.workflows()?.find((w) => w.id === ASK_WORKFLOW_ID) ?? null,
  );

  /** Every other workflow, in catalogue order. */
  readonly otherWorkflows = computed(
    () => this.workflows()?.filter((w) => w.id !== ASK_WORKFLOW_ID) ?? [],
  );

  /** What still blocks a first question; empty while unknown. */
  readonly setupGaps = computed<SetupGap[]>(() => {
    const gaps: SetupGap[] = [];
    if (this.llmConfigured() === false) gaps.push('llm');
    if (this.datasets()?.length === 0) gaps.push('datasets');
    return gaps;
  });

  /** Why Ask can't run now, else null. */
  readonly blocked = computed(() => {
    if (this.setupGaps().length > 0) return 'Finish the setup above first.';
    return this.askWorkflow()?.runRequirement ?? null;
  });

  readonly recentRuns = computed(() =>
    this.runsState.runs().slice(0, HOME_RECENT_RUNS),
  );

  constructor() {
    this.runsState.loadRuns();
    this.workflowsApi.getWorkflows().subscribe({
      next: (res) => this.workflows.set(res.workflows ?? []),
      error: () => this.workflows.set([]),
    });
    // The light listing (api.md 21, view=summary) is all the picker needs.
    this.datasetsApi.getDatasetSummaries().subscribe({
      next: (res) => {
        const datasets = res.datasets ?? [];
        this.datasets.set(datasets);
        // With one dataset there is nothing to choose.
        if (datasets.length === 1) this.picked.set([datasets[0].name]);
      },
      error: () => this.datasets.set(null),
    });
    this.llmApi.getSettings().subscribe({
      next: (view) =>
        this.llmConfigured.set(view.configured && view.keyUnreadable !== true),
      error: () => this.llmConfigured.set(null),
    });
  }

  onQuestion(event: Event): void {
    this.question.set((event.target as HTMLTextAreaElement).value);
    if (this.errorField() === 'question') this.refused.set(null);
  }

  onPicked(names: string[]): void {
    this.picked.set(names);
    if (this.errorField() === 'datasets') this.refused.set(null);
  }

  /** Enter asks; Shift+Enter starts a new line. */
  onEnter(event: Event): void {
    const key = event as KeyboardEvent;
    if (key.shiftKey || key.isComposing) return;
    event.preventDefault();
    this.ask();
  }

  /**
   * Ask: Answer a Business Question (Avery + Michael) opens on its page and runs on the
   * question and the picked datasets, with its Run panel and query
   * inspector (workflows R31). Nothing runs from this page itself.
   */
  ask(): void {
    if (this.blocked() !== null) return;
    const question = this.question().trim();
    if (question === '') {
      this.refused.set({
        field: 'question',
        message: 'Type a question first.',
      });
      this.questionBox()?.nativeElement.focus();
      return;
    }
    if (this.picked().length === 0) {
      this.refused.set({
        field: 'datasets',
        message: 'Pick at least one dataset to ask about.',
      });
      return;
    }
    this.designer.prefillOnLoad(
      { question, datasets: [...this.picked()] },
      { execute: true },
    );
    this.workflowsNav.openWorkflow(ASK_WORKFLOW_ID);
  }

  openRun(run: WorkflowRunSummary): void {
    this.runsState.openRun(run.id);
  }

  openWorkflow(workflow: WorkflowSummary): void {
    this.workflowsNav.openWorkflow(workflow.id);
  }

  openLlmSettings(): void {
    this.settings.settingsSection.set('llm');
    this.shell.selectArea('settings');
  }

  openArea(area: 'datasets' | 'workflows' | 'agents' | 'runs'): void {
    this.shell.selectArea(area);
  }

  protected status = runRowStatus;

  protected when(run: WorkflowRunSummary): string {
    return sessionActivityLabel(run.startedAt);
  }
}
