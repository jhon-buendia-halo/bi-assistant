import {
  Component,
  ElementRef,
  computed,
  effect,
  inject,
  untracked,
  viewChild,
} from '@angular/core';
import {
  Brain,
  CircleCheck,
  Database,
  Loader2,
  LucideAngularModule,
  MessageSquare,
  MessageSquareReply,
  SendHorizontal,
  Square,
  SquarePen,
  Wrench,
} from 'lucide-angular';
import { Dataset } from '../../../datasets/services/datasets-api.service';
import { VisualEvent } from '../../../sessions/models/session.model';
import { RunVisual } from '../../../runs/components/run-visual/run-visual';
import { RunVisualsState } from '../../../runs/services/run-visuals-state';
import { AnswerView } from '../../../sessions/components/answer-view/answer-view';
import { MarkdownPipe } from '../../../../shared/pipes/markdown.pipe';
import { WorkflowInputField, WorkflowRun } from '../../models/workflow.model';
import { WorkflowRunInputRequired } from '../workflow-run-input-required/workflow-run-input-required';
import { WorkflowDesigner } from '../../services/workflow-designer.service';
import {
  canRunFromPage,
  runOutputEntries,
  runStatusLine,
} from '../../services/workflows.util';

/** The composer's controls Execute workflow may focus, in order. */
const FORM_CONTROLS =
  'form input:not([disabled]):not([type="hidden"]), form textarea:not([disabled]), form select:not([disabled]), form button:not([disabled])';

/**
 * The Chat column of a workflow's Run panel, under the canvas (workflows
 * R13, R21; ui.md 4.4b): the question asked, the waiting card, the agent
 * working live and the answer, then the composer: the run's input with
 * Execute and Stop, or, under a stored answer, Follow up. The steps are in
 * the Logs column beside it. It shares its state with the page through the
 * designer.
 */
@Component({
  selector: 'app-workflow-run-chat',
  imports: [
    AnswerView,
    LucideAngularModule,
    MarkdownPipe,
    RunVisual,
    WorkflowRunInputRequired,
  ],
  templateUrl: './workflow-run-chat.html',
  styles: `
    .composer {
      border: 1px solid var(--qti-border);
      border-radius: 0.75rem;
      background-color: var(--qti-surface);
      padding: 0.5rem 0.625rem;
      box-shadow: var(--qti-shadow-card);
    }
    .composer:focus-within {
      border-color: var(--qti-border-selected);
    }
    .composer-input {
      width: 100%;
      resize: none;
      border: 0;
      background: transparent;
      padding: 0.125rem 0.125rem;
      font-size: 13px;
      line-height: 1.25rem;
      color: var(--qti-fg);
      outline: none;
    }
    .composer-input::placeholder {
      color: var(--qti-fg-muted);
    }
    .composer-input-invalid {
      box-shadow: inset 0 -1px 0 var(--qti-on-danger-soft);
    }
    .dataset-pill {
      display: inline-flex;
      align-items: center;
      gap: 0.375rem;
      border: 1px solid var(--qti-border);
      border-radius: 9999px;
      background-color: var(--qti-surface-muted);
      padding: 0.125rem 0.625rem;
      font-size: 12px;
      color: var(--qti-fg);
      cursor: pointer;
    }
    .dataset-pill:hover {
      border-color: var(--qti-border-strong);
    }
    .dataset-pill[aria-pressed='true'] {
      border-color: var(--qti-border-selected);
      background-color: var(--qti-surface-selected);
      color: var(--qti-on-primary-soft);
    }
    .dataset-pill:focus-visible {
      outline: 2px solid var(--qti-focus);
      outline-offset: 2px;
    }
  `,
  host: {
    class: 'flex min-h-0 flex-col',
    'data-testid': 'workflow-run-chat',
  },
})
export class WorkflowRunChat {
  protected readonly Brain = Brain;
  protected readonly CircleCheck = CircleCheck;
  protected readonly Database = Database;
  protected readonly Loader2 = Loader2;
  protected readonly MessageSquare = MessageSquare;
  protected readonly MessageSquareReply = MessageSquareReply;
  protected readonly SendHorizontal = SendHorizontal;
  protected readonly Square = Square;
  protected readonly SquarePen = SquarePen;
  protected readonly Wrench = Wrench;

  protected readonly designer = inject(WorkflowDesigner);
  protected readonly visuals = inject(RunVisualsState);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly log = viewChild<ElementRef<HTMLElement>>('log');
  /** The chat follows the run's newest text while the user stays near its end. */
  private stickToEnd = true;
  /** The run whose question and answer were last scrolled into view. */
  private shownRunId: string | null = null;

  constructor() {
    // While a run streams, keep its newest text in view; once it ends, show
    // its question and the start of its answer.
    effect(() => {
      this.designer.streamingText();
      this.designer.reasoning();
      this.designer.toolCalls().length;
      const status = this.designer.runResult()?.status ?? null;
      const runId = this.designer.run()?.id ?? null;
      untracked(() => setTimeout(() => this.follow(status, runId)));
    });
    // Execute workflow on the canvas: focus the composer, once per request.
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

  /** Scrolling the chat by hand: it follows the run again only near its end. */
  protected onLogScroll(): void {
    const el = this.log()?.nativeElement;
    if (el === undefined) return;
    this.stickToEnd = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  }

  private follow(status: string | null, runId: string | null): void {
    const el = this.log()?.nativeElement;
    if (el === undefined) return;
    if (status === 'running') {
      if (this.shownRunId !== null) {
        this.shownRunId = null;
        this.stickToEnd = true;
      }
      if (this.stickToEnd) el.scrollTop = el.scrollHeight;
      return;
    }
    if (runId === null || runId === this.shownRunId) return;
    this.shownRunId = runId;
    const question = el.querySelector<HTMLElement>(
      '[data-testid="workflow-run-question"]',
    );
    el.scrollTop =
      question === null
        ? 0
        : question.getBoundingClientRect().top -
          el.getBoundingClientRect().top +
          el.scrollTop -
          8;
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

  /** The agent step running now, while the run streams: its live block shows. */
  protected readonly liveAgentStep = computed(
    () =>
      this.designer.running() &&
      this.designer
        .runPanelSteps()
        .some((step) => step.kind === 'agent' && step.status === 'running'),
  );

  /** Under a stored answer that asks nothing: the composer follows up on it. */
  protected readonly followUpMode = computed(
    () =>
      this.designer.canFollowUp() &&
      !this.designer.runResult()?.answer?.clarification,
  );

  /** The line under the workflow's name before a run. */
  protected readonly emptyHint = computed(() => {
    const workflow = this.designer.workflow();
    const datasets = workflow?.input.some(
      (field) => !field.hidden && field.type === 'datasets',
    );
    if (this.designer.questionField() === null) {
      return 'Fill in the input below and press Execute.';
    }
    return datasets
      ? 'Pick the datasets below and type a question.'
      : 'Type a question below.';
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

  /**
   * The composer's controls: every field the app does not set itself, the
   * question first, then the others in order.
   */
  protected readonly composerFields = computed(() => {
    const fields =
      this.designer.workflow()?.input.filter((field) => !field.hidden) ?? [];
    const question = this.designer.questionField();
    return [
      ...fields.filter((field) => field.name === question),
      ...fields.filter((field) => field.name !== question),
    ];
  });

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

  /** Enter sends (Execute or Follow up); Shift+Enter adds a line. */
  protected onEnter(event: Event, action: 'execute' | 'follow-up'): void {
    const key = event as KeyboardEvent;
    if (key.shiftKey || key.isComposing) return;
    event.preventDefault();
    if (action === 'follow-up') this.sendFollowUp();
    else this.designer.execute();
  }

  protected sendFollowUp(): void {
    this.designer.followUp(this.designer.followUpText());
  }
}
