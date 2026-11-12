import {
  Component,
  ElementRef,
  computed,
  effect,
  inject,
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
} from 'lucide-angular';
import { Dataset } from '../../../datasets/services/datasets-api.service';
import { VisualEvent } from '../../../sessions/models/session.model';
import { RunVisual } from '../../../runs/components/run-visual/run-visual';
import { RunVisualsState } from '../../../runs/services/run-visuals-state';
import { AnswerView } from '../../../sessions/components/answer-view/answer-view';
import { MarkdownPipe } from '../../../../shared/pipes/markdown.pipe';
import { WorkflowInputField, WorkflowRun } from '../../models/workflow.model';
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
  imports: [AnswerView, LucideAngularModule, MarkdownPipe, RunVisual],
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
    // A refused Execute: focus the first field with an error.
    effect(() => {
      if (this.designer.invalidFocusRequest() === 0) return;
      untracked(() => {
        this.designer.invalidFocusRequest.set(0);
        setTimeout(() => this.focusFirstInvalid());
      });
    });
  }

  /** The first invalid control; a dataset group focuses its first choice, else itself. */
  private focusFirstInvalid(): void {
    const invalid = this.host.nativeElement.querySelector<HTMLElement>(
      'form [aria-invalid="true"]',
    );
    if (invalid === null) return;
    const target =
      invalid.getAttribute('role') === 'group'
        ? (invalid.querySelector<HTMLElement>('button') ?? invalid)
        : invalid;
    target.focus();
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

  /** The latest line of the agent's reasoning, for the Thinking block. */
  protected readonly reasoningSnippet = computed(() => {
    const text = this.designer.reasoning().replace(/\s+/g, ' ').trim();
    return text.length > 120 ? `…${text.slice(-120)}` : text;
  });

  protected inputId(name: string): string {
    return `workflow-input-${name}`;
  }

  /** The id (and test id) of a field's error message. */
  protected errorId(name: string): string {
    return `workflow-input-error-${name}`;
  }

  /** A field's error from the last refused Execute; null when it has none. */
  protected fieldError(name: string): string | null {
    const errors = this.designer.fieldErrors();
    return Object.hasOwn(errors, name) ? errors[name] : null;
  }

  /** `aria-describedby` of a field's control: its error, while it has one. */
  protected describedBy(name: string): string | null {
    return this.fieldError(name) !== null ? this.errorId(name) : null;
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

  /** The datasets a `datasets` field offers: its kinds only, when it names some. */
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

  protected onFollowUpInput(event: Event): void {
    this.designer.followUpText.set((event.target as HTMLInputElement).value);
  }

  protected sendFollowUp(): void {
    this.designer.followUp(this.designer.followUpText());
  }
}
