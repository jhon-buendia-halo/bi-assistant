import { NgTemplateOutlet } from '@angular/common';
import {
  Component,
  ElementRef,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import {
  Archive,
  Brain,
  CircleCheck,
  Loader2,
  LucideAngularModule,
  MessageSquare,
  MessageSquareReply,
  RotateCcw,
  SendHorizontal,
  Square,
  SquarePen,
  Workflow,
  X,
} from 'lucide-angular';
import { ExecutionId } from '../../../../shared/execution-id/execution-id';
import { RunArtifactCard } from '../../../runs/components/run-artifact-card/run-artifact-card';
import {
  ConversationTurn,
  WorkflowConversation,
} from '../../services/workflow-conversation';
import {
  ChatHistoryItem,
  ChatHistoryNav,
} from '../../../../shared/components/chat-history-nav/chat-history-nav';
import { ArtifactSummary } from '../../../artifacts/models/artifact.model';
import { ArtifactsApiService } from '../../../artifacts/services/artifacts-api.service';
import { ArtifactsNavState } from '../../../artifacts/services/artifacts-nav-state';
import { WorkflowsNavState } from '../../services/workflows-nav-state';
import { Dataset } from '../../../datasets/services/datasets-api.service';
import { DatasetPicker } from '../../../datasets/components/dataset-picker/dataset-picker';
import { ReadinessHistory } from '../../../data-readiness/components/readiness-history/readiness-history';
import {
  ReadinessPanelItem,
  ReadinessReportRef,
  VisualEvent,
} from '../../../sessions/models/session.model';
import { PanelReadinessView } from '../../../sessions/components/panel-readiness-view/panel-readiness-view';
import {
  readinessPanelItemId,
  readinessPanelTitle,
} from '../../../sessions/models/readiness.model';
import { RunVisual } from '../../../runs/components/run-visual/run-visual';
import { RunVisualsState } from '../../../runs/services/run-visuals-state';
import { AnswerView } from '../../../sessions/components/answer-view/answer-view';
import { MarkdownPipe } from '../../../../shared/pipes/markdown.pipe';
import {
  answerHasQueries,
  WorkflowInputField,
  WorkflowRun,
} from '../../models/workflow.model';
import { WorkflowRunInputRequired } from '../workflow-run-input-required/workflow-run-input-required';
import { WorkflowDesigner } from '../../services/workflow-designer.service';
import { WorkflowRunTeam } from '../workflow-run-team/workflow-run-team';
import { RelayQueryOpen } from '../workflow-run-relay/workflow-run-relay';
import { recordIndexOf } from '../../services/team-relay';
import { AgentActivity } from '../agent-activity/agent-activity';
import { activitySteps } from '../../services/agent-activity';
import { WorkflowRunStory } from '../workflow-run-story/workflow-run-story';
import { WorkflowRunAttachments } from './workflow-run-attachments';
import {
  addImageFiles,
  dragHasFiles,
  imageFilesOf,
} from './composer-images.util';
import { WorkflowRunsApiService } from '../../services/workflow-runs-api.service';
import {
  IMAGE_ACCEPT,
  isImageDataUrl,
} from '../../services/workflow-input-validation';
import {
  IMAGES_FIELD,
  canRunFromPage,
  runOutputEntries,
  runStatusLine,
} from '../../services/workflows.util';

/** The workflow a saved dashboard is mapped in, and its artifact field. */
const MAP_WORKFLOW_ID = 'map-dashboard-data';
/** Avery, the Chief of Staff: a workflow she runs is a never-ending conversation. */
const AVERY_AGENT_KEY = 'chief-of-staff';
const MAP_ARTIFACT_FIELD = 'artifact';

/** The composer's controls Execute workflow may focus, in order. */
const FORM_CONTROLS =
  'form input:not([disabled]):not([type="hidden"]), form textarea:not([disabled]), form select:not([disabled]), form button:not([disabled])';

/**
 * The Chat column of a workflow's Run panel, under the canvas (workflows
 * R13, R21; ui.md 4.4b): the question asked, the waiting card, the agent
 * working live and the answer, then the composer: the run's input with
 * Execute and Stop, or, under a stored answer, Follow up; How it ran under
 * an ended run's answer. Each step's state is on the canvas beside it. It shares its state with the page through the
 * designer.
 */
@Component({
  selector: 'app-workflow-run-chat',
  imports: [
    AnswerView,
    NgTemplateOutlet,
    DatasetPicker,
    ExecutionId,
    LucideAngularModule,
    MarkdownPipe,
    PanelReadinessView,
    ReadinessHistory,
    RunVisual,
    WorkflowRunAttachments,
    WorkflowRunInputRequired,
    WorkflowRunStory,
    WorkflowRunTeam,
    AgentActivity,
    ChatHistoryNav,
    RunArtifactCard,
  ],
  providers: [WorkflowConversation],
  templateUrl: './workflow-run-chat.html',
  styles: `
    .composer {
      border: 1px solid var(--qti-border);
      border-radius: 0.75rem;
      background-color: var(--qti-surface);
      padding: 0.5rem 0.625rem;
      box-shadow: var(--qti-shadow-card);
    }
    .composer:focus-within,
    .composer-dragging {
      border-color: var(--qti-border-selected);
    }
    /* A long input (Review a Website has eleven fields) scrolls inside the
       composer, so the chat above keeps its room; Execute stays in view. */
    .composer-form {
      max-height: 35vh;
      overflow-y: auto;
    }
    /* The actions are the form's footer: the fields scroll under its
       divider, never under the button alone. */
    .composer-actions {
      position: sticky;
      bottom: -0.5rem;
      z-index: 1;
      margin-top: 0.5rem;
      margin-bottom: -0.5rem;
      border-top: 1px solid var(--qti-border);
      padding-top: 0.5rem;
      padding-bottom: 0.5rem;
      background-color: var(--qti-surface);
    }
    .composer-dragging {
      background-color: var(--qti-surface-selected);
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
    /* The input form: one section per field, a line between them. */
    .composer-fields > * {
      padding-block: 0.75rem;
    }
    .composer-fields > :first-child {
      padding-top: 0.25rem;
    }
    .composer-fields > * + * {
      border-top: 1px solid var(--qti-border);
    }
    .composer-input-invalid {
      box-shadow: inset 0 -1px 0 var(--qti-on-danger-soft);
    }
  `,
  host: {
    class: 'relative flex min-h-0 flex-col',
    'data-testid': 'workflow-run-chat',
  },
})
export class WorkflowRunChat {
  protected readonly hasQueries = answerHasQueries;
  protected readonly Archive = Archive;
  protected readonly Brain = Brain;
  protected readonly CircleCheck = CircleCheck;
  protected readonly Loader2 = Loader2;
  protected readonly MessageSquare = MessageSquare;
  protected readonly MessageSquareReply = MessageSquareReply;
  protected readonly RotateCcw = RotateCcw;
  protected readonly SendHorizontal = SendHorizontal;
  protected readonly Square = Square;
  protected readonly SquarePen = SquarePen;
  protected readonly Workflow = Workflow;
  protected readonly X = X;

  /**
   * `panel`: the Run panel's Chat beside the canvas. `business`: the page's
   * Business view (R38): the same chat, each message a run of the workflow,
   * with the agents' thread but no live tool calls or How it ran; a run's
   * details open in the Builder view.
   */
  readonly variant = input<'panel' | 'business'>('panel');
  protected readonly business = computed(() => this.variant() === 'business');

  /**
   * The chat reads the whole thread of earlier turns: always in the Business
   * view, and for Answer a Business Question (orchestrated) in either view,
   * since that conversation never ends.
   */
  protected readonly threaded = computed(
    () => this.business() || this.isAveryWorkflow(),
  );
  // Answer a Business Question (orchestrated) and (Avery + Michael): any
  // workflow whose step runs Avery (workflows R45).
  private readonly isAveryWorkflow = computed(
    () =>
      this.designer
        .workflow()
        ?.steps.some((step) => step.agent?.key === AVERY_AGENT_KEY) ?? false,
  );

  /** The shown run is an ended, not archived run of Avery's conversation. */
  protected readonly averyOpen = computed(() => {
    const status = this.designer.runResult()?.status;
    return (
      this.isAveryWorkflow() &&
      this.designer.run() !== null &&
      this.designer.run()?.archivedAt === undefined &&
      !this.designer.running() &&
      (status === 'success' || status === 'failed' || status === 'stopped')
    );
  });

  /** The shown run belongs to an archived Avery conversation (read-only). */
  protected readonly averyArchived = computed(
    () =>
      this.isAveryWorkflow() &&
      this.designer.run() !== null &&
      this.designer.run()?.archivedAt !== undefined &&
      !this.designer.running(),
  );

  protected readonly averyText = signal('');
  protected readonly averyError = signal<string | null>(null);
  protected readonly averyBusy = signal(false);
  protected readonly averyNotice = signal<string | null>(null);

  protected sendAvery(): void {
    const text = this.averyText().trim();
    if (!text || this.designer.running()) return;
    this.averyError.set(null);
    this.averyNotice.set(null);
    this.averyText.set('');
    this.designer.followUp(text);
  }

  protected onAveryKey(event: KeyboardEvent): void {
    if (event.key !== 'Enter' || event.shiftKey || event.isComposing) return;
    event.preventDefault();
    this.sendAvery();
  }

  protected archiveConversation(): void {
    const run = this.designer.run();
    if (run === null || this.averyBusy()) return;
    this.averyBusy.set(true);
    this.averyError.set(null);
    this.runsApi.archive(run.id).subscribe({
      next: () => {
        this.averyBusy.set(false);
        this.designer.newQuestion();
        this.averyNotice.set('Conversation archived');
      },
      error: (err: unknown) => {
        this.averyBusy.set(false);
        this.averyError.set(this.messageOf(err, 'Could not archive'));
      },
    });
  }

  protected unarchiveConversation(): void {
    const run = this.designer.run();
    if (run === null || this.averyBusy()) return;
    this.averyBusy.set(true);
    this.averyError.set(null);
    this.runsApi.unarchive(run.id).subscribe({
      next: () => {
        this.runsApi.getRun(run.id).subscribe({
          next: (fresh) => {
            this.averyBusy.set(false);
            this.designer.run.set(fresh);
          },
          error: () => {
            this.averyBusy.set(false);
            this.designer.run.set({ ...run, archivedAt: undefined });
          },
        });
      },
      error: (err: unknown) => {
        this.averyBusy.set(false);
        this.averyError.set(this.messageOf(err, 'Could not unarchive'));
      },
    });
  }

  private messageOf(err: unknown, fallback: string): string {
    const message = (err as { error?: { message?: unknown } })?.error?.message;
    return typeof message === 'string' && message !== '' ? message : fallback;
  }

  /**
   * Business view only: show the run in the Builder view, with this step's
   * dialog open when a step id is given (an agent's See its data).
   */
  readonly openInBuilder = output<string | null>();

  /** An agent's See its data: its dialog here, or in Builder from the Business view. */
  protected openStep(id: string): void {
    if (this.business()) this.openInBuilder.emit(id);
    else this.designer.openNode(id);
  }

  /**
   * A teammate's query picked in Avery's relay (ui.md 4.4b *relay*): that
   * query opens in the query inspector; while the answer is not stored yet
   * (the run still works), the step's dialog opens instead.
   */
  protected openTeamQuery(event: {
    stepId: string;
    query: RelayQueryOpen;
  }): void {
    const data = this.designer.runResult()?.answer?.data;
    const index = recordIndexOf(data, event.query.step);
    if (index >= 0) this.designer.openQuery(index, event.query.opener);
    else this.openStep(event.stepId);
  }

  protected readonly designer = inject(WorkflowDesigner);
  protected readonly visuals = inject(RunVisualsState);
  private readonly artifactsApi = inject(ArtifactsApiService);
  private readonly runsApi = inject(WorkflowRunsApiService);
  private readonly artifactsNav = inject(ArtifactsNavState);
  private readonly workflowsNav = inject(WorkflowsNavState);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly log = viewChild<ElementRef<HTMLElement>>('log');
  /** The chat follows the run's newest text while the user stays near its end. */
  private stickToEnd = true;
  /** The run whose question and answer were last scrolled into view. */
  private shownRunId: string | null = null;

  constructor() {
    // The Business view reads the whole conversation (R38).
    effect(() => {
      const on = this.threaded();
      untracked(() => this.conversation.active.set(on));
    });
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
    // A workflow with an artifact field: load the artifacts it offers.
    effect(() => {
      const workflow = this.designer.workflow();
      const wants = workflow?.input.some(
        (field) => !field.hidden && field.type === 'artifact',
      );
      if (!wants) return;
      untracked(() =>
        this.artifactsApi.list().subscribe({
          next: (artifacts) => this.artifacts.set(artifacts),
          error: () => this.artifacts.set([]),
        }),
      );
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

  /** Business view: the earlier questions of this conversation (R38). */
  protected readonly conversation = inject(WorkflowConversation);

  /** The conversation navigation's questions; empty under two (R38). */
  protected readonly navItems = computed<ChatHistoryItem[]>(() => {
    if (!this.business()) return [];
    const current = this.designer.shownQuestion();
    const items: ChatHistoryItem[] = this.conversation
      .earlier()
      .map((turn) => ({ id: turn.runId, label: turn.question }));
    if (current) items.push({ id: 'current', label: current });
    return items.length >= 2 ? items : [];
  });

  /** A question picked in the navigation: the chat stops following the run. */
  protected onHistoryPicked(): void {
    this.stickToEnd = false;
  }

  /** The chat's scrolling element, for the conversation navigation. */
  protected readonly logElement = computed(() => this.log()?.nativeElement);

  /** A figure of an earlier turn: its query opens in the sheet, from that run. */
  protected inspectEarlierQuery(turn: ConversationTurn, index: number): void {
    this.designer.openQuery(index, window.document.activeElement, turn.run);
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
    (
      first ?? root.querySelector<HTMLElement>('[data-testid="workflow-run"]')
    )?.focus();
  }

  /** Only a workflow with an input runs from its page (R21). */
  protected readonly canRun = computed(() => {
    const workflow = this.designer.workflow();
    return workflow !== null && canRunFromPage(workflow);
  });

  /** A visual action stored the run: show it as it is now. */
  protected readonly applyRun = (run: WorkflowRun): void =>
    this.designer.run.set(run);

  // No "Generate interactive visuals" here: a workflow that wants visuals
  // makes them in a step of its own, with a specialised agent (ui.md 4.4b).
  // Visuals a run already has still open under the answer.

  /** A visual card's View: open that visual under the answer. */
  /** A figure chip or query row: the query opens in the sheet beside the answer. */
  protected inspectQuery(index: number): void {
    this.designer.openQuery(index, window.document.activeElement);
  }

  /** A card's Open: the visual opens in the side panel (visuals R42). */
  protected viewVisual(event: VisualEvent): void {
    const run = this.designer.run();
    if (run !== null) this.visuals.view(run, event);
  }

  /** A gate's Open visual: the visual Ryan built opens in the side panel, answer or not. */
  protected openGateVisual(visualId: string): void {
    const found = this.designer
      .run()
      ?.visualizations?.find((visual) => visual.id === visualId);
    this.viewVisual({
      visualId,
      version: found?.currentVersion ?? 1,
      title: found?.title ?? '',
      action: 'created',
    });
  }

  /** The shown answer made a visual: its card carries Saved to Artifacts and Map to data. */
  protected readonly hasArtifactCard = computed(
    () =>
      this.designer.run() !== null &&
      this.designer.runResult()?.answer?.visual !== undefined,
  );

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
    return open !== null && open.runId === this.designer.runId()
      ? open.item
      : null;
  });

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
        (item): item is ReadinessPanelItem =>
          item.kind === 'readiness' && item.id === id,
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

  /** The agent step running now, while the run streams: its live block shows. */
  protected readonly liveAgentStep = computed(
    () =>
      this.designer.running() &&
      this.designer
        .runPanelSteps()
        .some((step) => step.kind === 'agent' && step.status === 'running'),
  );

  /**
   * The running agent step has a row in the team, where its thought and
   * steps show; a step with no persona shows them in the live block.
   */
  protected readonly liveStepInTeam = computed(() =>
    [...this.designer.agentStories().values()].some(
      (story) => story.state === 'active',
    ),
  );

  /** The running step's calls as plain-language steps, for the live block. */
  protected readonly liveActivity = computed(() =>
    activitySteps(
      this.designer.toolCalls().map((call) => ({ ...call, tool: call.name })),
      true,
    ),
  );

  /** A query line of the live block: open the running step's queries. */
  protected openRunningStep(): void {
    const step = this.designer
      .runPanelSteps()
      .find((s) => s.kind === 'agent' && s.status === 'running');
    if (step) this.openStep(step.id);
  }

  /**
   * A code step running with progress of its own (Review a Website's pages,
   * agents.md 5.19): its title, its latest progress line and the five
   * before it, newest first.
   * Its progress arrives as the run's reasoning; an agent step shows it as
   * Thinking instead. Null when no code step reports progress.
   */
  protected readonly liveCodeProgress = computed(() => {
    if (!this.designer.running() || this.liveAgentStep()) return null;
    const step = this.designer
      .runPanelSteps()
      .find((s) => s.kind === 'code' && s.status === 'running');
    const lines = this.designer
      .reasoning()
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);
    if (!step || !lines.length) return null;
    return {
      title: step.title,
      latest: lines[lines.length - 1],
      recent: lines.slice(-6, -1).reverse(),
    };
  });

  /**
   * The run's input shows only while no run is shown (2026-11-20: runs have
   * no follow-up any more). Under a run, running, waiting or ended, the
   * conversation takes the whole column; New question or Run again brings
   * the input back.
   */
  protected readonly composerShown = computed(
    () => this.designer.runResult() === null && !this.designer.running(),
  );

  /** The last file refused when adding images; cleared by the next add or remove. */
  protected readonly attachError = signal<string | null>(null);

  /** A file is being dragged over the composer. */
  protected readonly dragging = signal(false);

  /** The `images` field of the workflow (reference images), when it has one. */
  protected readonly imagesField = computed(
    () =>
      this.designer
        .workflow()
        ?.input.find((f) => !f.hidden && f.type === 'images') ?? null,
  );

  /** The single `image` field, which paste and drop fill when there is no `images` field. */
  private readonly imageField = computed(
    () =>
      this.designer
        .workflow()
        ?.input.find((f) => !f.hidden && f.type === 'image') ?? null,
  );

  /** Whether the shown composer takes pasted or dropped images. */
  private readonly takesImages = computed(
    () => this.imagesField() !== null || this.imageField() !== null,
  );

  /** The file name each image field shows, by field name. */
  private readonly imageNames = signal<Record<string, string>>({});

  /** The stored artifacts an `artifact` field offers. */
  private readonly artifacts = signal<ArtifactSummary[]>([]);

  /** The artifacts of the field's kinds (every kind when it names none). */
  protected artifactChoices(field: WorkflowInputField): ArtifactSummary[] {
    const kinds = field.artifactKinds;
    const all = this.artifacts();
    if (!kinds || kinds.length === 0) return all;
    return all.filter((artifact) => kinds.includes(artifact.kind));
  }

  /** An artifact was picked (or None): it replaces the field it is required without. */
  protected onArtifact(field: WorkflowInputField, event: Event): void {
    const value = (event.target as HTMLSelectElement).value;
    this.designer.setInput(field.name, value);
    if (value !== '') this.clearPeer(field);
  }

  /** Empties the field `field` is required without, and its file picker. */
  private clearPeer(field: WorkflowInputField): void {
    const peer = field.requiredWithout;
    if (peer === undefined) return;
    this.designer.setInput(peer, '');
    this.imageNames.update((names) => ({ ...names, [peer]: '' }));
    const control = this.host.nativeElement.querySelector<HTMLInputElement>(
      `[id="${this.inputId(peer)}"]`,
    );
    if (control !== null && control.type === 'file') control.value = '';
  }

  /**
   * The artifact the shown run saved (Dashboard Image to Artifact saves the
   * dashboard it read); null for a run that saved none.
   */
  protected readonly savedArtifactId = computed(() => {
    const result = this.designer.runResult();
    const id = result?.output?.['artifactId'];
    return result !== null &&
      result.status === 'success' &&
      typeof id === 'string' &&
      id !== ''
      ? id
      : null;
  });

  protected openSavedArtifact(id: string): void {
    this.artifactsNav.openArtifact(id);
  }

  /** Opens Map a Dashboard to Data with the saved dashboard picked. */
  protected mapSavedArtifact(id: string): void {
    this.designer.prefillOnLoad({ [MAP_ARTIFACT_FIELD]: id });
    this.workflowsNav.openWorkflow(MAP_WORKFLOW_ID);
  }

  /** The line under the workflow's name before a run. */
  protected readonly emptyHint = computed(() => {
    const workflow = this.designer.workflow();
    const datasets = workflow?.input.some(
      (field) =>
        !field.hidden &&
        (field.type === 'datasets' || field.type === 'dataset'),
    );
    const image = workflow?.input.some(
      (field) => !field.hidden && field.type === 'image',
    );
    if (image) return 'Upload an image below and press Execute.';
    if (this.designer.questionField() === null) {
      return 'Fill in the input below and press Execute.';
    }
    return datasets
      ? 'Pick the datasets below and type a question.'
      : 'Type a question below.';
  });

  /**
   * The run ended with an answer: the answer leads and how the run went
   * follows it (ui.md 4.4b, *Answer first*).
   */
  protected readonly answerFirst = computed(() => {
    const result = this.designer.runResult();
    return (
      !!result?.answer &&
      result.status !== 'running' &&
      result.status !== 'suspended' &&
      !this.designer.running()
    );
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
   * prompt first (`isPrompt`), then the others in order.
   */
  protected readonly composerFields = computed(() => {
    const fields =
      this.designer.workflow()?.input.filter((field) => !field.hidden) ?? [];
    return [
      ...fields.filter((field) => this.isPrompt(field)),
      ...fields.filter((field) => !this.isPrompt(field)),
    ];
  });

  /**
   * Whether a field is the composer's prompt: the question the user types,
   * shown first and bare, as a chat's message box. A question the workflow
   * fills in itself (it has a `default`: optional instructions) is a form
   * field like the others instead: labelled, boxed and in its own place.
   */
  protected isPrompt(field: WorkflowInputField): boolean {
    return (
      field.name === this.designer.questionField() &&
      field.default === undefined
    );
  }

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
    const value = (
      event.target as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
    ).value;
    this.designer.setInput(name, value);
  }

  /** The file types an image field's picker offers. */
  protected readonly imageAccept = IMAGE_ACCEPT;

  /** The image a field holds, to preview it; null when it holds none. */
  protected imagePreview(name: string): string | null {
    const values = this.designer.inputValues();
    const value = Object.hasOwn(values, name) ? values[name] : undefined;
    return isImageDataUrl(value) ? value : null;
  }

  /** The name of the file an image field holds; '' when it holds none. */
  protected imageName(name: string): string {
    const names = this.imageNames();
    return Object.hasOwn(names, name) ? names[name] : '';
  }

  /**
   * An image field's file was picked: the form holds it as a `data:` URL,
   * which is what a run sends (api.md 118). Clearing the picker clears it.
   */
  protected onImage(name: string, event: Event): void {
    this.setImageFile(name, (event.target as HTMLInputElement).files?.[0]);
  }

  /** Holds `file` as an image field's value (nothing clears it). */
  private setImageFile(name: string, file: File | undefined): void {
    if (!file) {
      this.imageNames.update((names) => ({ ...names, [name]: '' }));
      this.designer.setInput(name, '');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      this.imageNames.update((names) => ({ ...names, [name]: file.name }));
      this.designer.setInput(
        name,
        typeof reader.result === 'string' ? reader.result : '',
      );
      // An image picked replaces the field this one is required without.
      const field = this.designer
        .workflow()
        ?.input.find((f) => f.name === name);
      if (field !== undefined) this.clearPeer(field);
    };
    reader.onerror = () => {
      this.imageNames.update((names) => ({ ...names, [name]: '' }));
      this.designer.setInput(name, '');
    };
    reader.readAsDataURL(file);
  }

  /** What a thumbnail shows: a new image as it is, a stored path through the run's endpoint. */
  protected imageSrc(item: string): string | null {
    if (isImageDataUrl(item)) return item;
    const runId = this.designer.runId() ?? this.designer.run()?.id ?? null;
    return runId === null ? null : this.runsApi.inputImageUrl(runId, item);
  }

  /** The thumbnails of the images the composer holds. */
  protected readonly composerThumbs = computed(() =>
    this.designer
      .picked(IMAGES_FIELD)
      .map((item) => this.imageSrc(item))
      .filter((src): src is string => src !== null),
  );

  /** The thumbnails of the shown run's images, under its question. */
  protected readonly questionImages = computed(() =>
    this.designer
      .shownImages()
      .map((item) => this.imageSrc(item))
      .filter((src): src is string => src !== null),
  );

  /** The images the composer's list holds now. */
  private heldImages(): string[] {
    return this.designer.picked(IMAGES_FIELD);
  }

  private setHeldImages(list: string[]): void {
    this.designer.setInput(IMAGES_FIELD, list);
  }

  /** Files picked, pasted or dropped into the reference images. */
  protected async addImages(files: readonly File[]): Promise<void> {
    const field = this.imagesField();
    if (field !== null) {
      const max = field.max ?? 4;
      const { accepted, error } = await addImageFiles(
        files,
        this.heldImages().length,
        field.label,
        max,
      );
      this.setHeldImages([...this.heldImages(), ...accepted].slice(0, max));
      this.attachError.set(error);
      return;
    }
    // No `images` field: the one `image` field takes the first file (the
    // run form then checks its type and size on Execute).
    const image = this.imageField();
    if (image === null || files.length === 0) return;
    this.setImageFile(image.name, files[0]);
  }

  protected removeImage(index: number): void {
    this.setHeldImages(this.heldImages().filter((_, i) => i !== index));
    this.attachError.set(null);
  }

  /** The refusal shown under the attachments: a file refused, else the form's. */
  protected imagesError(): string | null {
    return this.attachError() ?? this.fieldError(IMAGES_FIELD);
  }

  /** Paste: only images are taken; a plain text paste is left alone. */
  protected onPaste(event: ClipboardEvent): void {
    if (!this.takesImages()) return;
    const files = imageFilesOf(event.clipboardData);
    if (files.length === 0) return;
    event.preventDefault();
    void this.addImages(files);
  }

  protected onDragOver(event: DragEvent): void {
    if (!this.takesImages() || !dragHasFiles(event.dataTransfer)) return;
    event.preventDefault();
    this.dragging.set(true);
  }

  protected onDrop(event: DragEvent): void {
    this.dragging.set(false);
    if (!this.takesImages() || !dragHasFiles(event.dataTransfer)) return;
    // Files dropped on the box never navigate the window.
    event.preventDefault();
    const files = imageFilesOf(event.dataTransfer);
    if (files.length > 0) void this.addImages(files);
  }

  protected onCheck(name: string, event: Event): void {
    this.designer.setInput(name, (event.target as HTMLInputElement).checked);
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

  /** Enter executes; Shift+Enter adds a line. */
  protected onEnter(event: Event): void {
    const key = event as KeyboardEvent;
    if (key.shiftKey || key.isComposing) return;
    event.preventDefault();
    this.designer.execute();
  }
}
