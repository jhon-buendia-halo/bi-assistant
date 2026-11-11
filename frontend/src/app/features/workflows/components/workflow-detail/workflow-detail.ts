import {
  Component,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import {
  ArrowLeft,
  Bot,
  ChevronRight,
  Loader2,
  LucideAngularModule,
  MessageSquarePlus,
  Play,
  TriangleAlert,
  Workflow,
} from 'lucide-angular';
import { Subscription } from 'rxjs';
import { AgentWorkflowView } from '../../../agents/components/agent-workflow/agent-workflow';
import {
  WorkflowDetail,
  WorkflowRunResult,
  WorkflowSummary,
} from '../../models/workflow.model';
import { WorkflowsApiService } from '../../services/workflows-api.service';
import {
  runOutputEntries,
  runStatusLine,
  runStepStatusLabel,
  workflowKindLabel,
} from '../../services/workflows.util';

/** The note under the drawing: what drives a chat's workflow bar (R10). */
export const BAR_NOTES: Record<WorkflowSummary['bar'], string> = {
  steps: 'In a chat, the workflow bar shows these steps as they run.',
  agent: "In a chat, the workflow bar shows the agent's own steps as it sets them.",
};

/**
 * A workflow's page (workflows R7, R8, R10, R12, R13; ui.md 4.4b): its
 * header and Start chat, what happens on each message (the 1.23.1 drawing,
 * fed by `GET /workflows/:id`), the workflow bar note, and the agents its
 * steps call. A run workflow has no Start chat and no bar note: its input
 * form, Run and the last run's result instead, held only while the page is
 * open (nothing is stored). Read-only (R3).
 */
@Component({
  selector: 'app-workflow-detail',
  imports: [LucideAngularModule, AgentWorkflowView],
  templateUrl: './workflow-detail.html',
})
export class WorkflowDetailPage {
  readonly ArrowLeft = ArrowLeft;
  readonly Bot = Bot;
  readonly ChevronRight = ChevronRight;
  readonly Loader2 = Loader2;
  readonly MessageSquarePlus = MessageSquarePlus;
  readonly Play = Play;
  readonly TriangleAlert = TriangleAlert;
  readonly Workflow = Workflow;

  private readonly api = inject(WorkflowsApiService);

  readonly workflowId = input.required<string>();
  /** True while a session is being created from this workflow. */
  readonly starting = input(false);
  /** All workflows. */
  readonly back = output<void>();
  readonly startChat = output<WorkflowSummary>();
  /** An agent row; the shell opens the agent's detail (R8). */
  readonly openAgent = output<string>();

  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly workflow = signal<WorkflowDetail | null>(null);

  /** The run form's values, by field name. */
  readonly inputValues = signal<Record<string, string>>({});
  readonly running = signal(false);
  /** The server's refusal of the last Run (400), or `Backend unreachable`. */
  readonly runError = signal<string | null>(null);
  /** The last run's result; running again replaces it. */
  readonly runResult = signal<WorkflowRunResult | null>(null);

  readonly runStatus = computed(() => {
    const result = this.runResult();
    return result === null ? '' : runStatusLine(result);
  });
  readonly runOutput = computed(() => {
    const result = this.runResult();
    return result === null ? [] : runOutputEntries(result.output);
  });
  readonly stepStatusLabel = runStepStatusLabel;
  private runSubscription: Subscription | null = null;

  readonly kindLabel = computed(() => {
    const workflow = this.workflow();
    return workflow === null ? '' : workflowKindLabel(workflow);
  });
  readonly barNote = computed(() => {
    const workflow = this.workflow();
    return workflow === null ? '' : BAR_NOTES[workflow.bar];
  });
  readonly missing = computed(() => {
    const workflow = this.workflow();
    return workflow === null ? '' : workflow.missingDatasets.join(', ');
  });

  constructor() {
    effect(() => this.load(this.workflowId()));
  }

  /** The id of a field's control, for its label. */
  inputId(name: string): string {
    return `workflow-input-${name}`;
  }

  /** A field's typed value; empty until typed. */
  inputValue(name: string): string {
    return Object.hasOwn(this.inputValues(), name)
      ? this.inputValues()[name]
      : '';
  }

  onInput(name: string, event: Event): void {
    const value = (event.target as HTMLInputElement | HTMLTextAreaElement)
      .value;
    this.inputValues.update((values) => ({ ...values, [name]: value }));
  }

  /** A step's output as pretty JSON. */
  pretty(output: Record<string, unknown>): string {
    return JSON.stringify(output, null, 2);
  }

  /** Run the workflow once on the form's values (api.md 118). */
  run(): void {
    const workflow = this.workflow();
    if (workflow === null || this.running()) return;
    const input: Record<string, string> = {};
    for (const field of workflow.input) {
      const value = this.inputValues()[field.name];
      if (value !== undefined) input[field.name] = value;
    }
    this.running.set(true);
    this.runError.set(null);
    this.runSubscription = this.api.runWorkflow(workflow.id, input).subscribe({
      next: (result) => {
        this.runResult.set(result);
        this.running.set(false);
      },
      error: (err) => {
        this.runResult.set(null);
        this.runError.set(err?.error?.message ?? 'Backend unreachable');
        this.running.set(false);
      },
    });
  }

  private load(id: string): void {
    this.loading.set(true);
    this.error.set(null);
    this.workflow.set(null);
    // Another workflow: the last run's result and form are discarded.
    this.runSubscription?.unsubscribe();
    this.runSubscription = null;
    this.running.set(false);
    this.inputValues.set({});
    this.runError.set(null);
    this.runResult.set(null);
    this.api.getWorkflow(id).subscribe({
      next: (workflow) => {
        this.workflow.set(workflow);
        this.loading.set(false);
      },
      error: (err) => {
        this.error.set(err?.error?.message ?? 'Backend unreachable');
        this.loading.set(false);
      },
    });
  }
}
