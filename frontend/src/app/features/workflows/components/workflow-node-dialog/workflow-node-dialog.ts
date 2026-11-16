import { NgTemplateOutlet } from '@angular/common';
import {
  Component,
  ElementRef,
  afterNextRender,
  computed,
  effect,
  input,
  linkedSignal,
  output,
  signal,
  viewChild,
} from '@angular/core';
import {
  Braces,
  Check,
  ChevronRight,
  Copy,
  FileText,
  Flag,
  LucideAngularModule,
  Sparkles,
  Wrench,
  X,
  Zap,
} from 'lucide-angular';
import {
  NodeChatAvailability,
  TRIGGER_LABELS,
  WorkflowDetail,
  WorkflowInputField,
  WorkflowRunToolCall,
} from '../../models/workflow.model';
import {
  NodeToolCallView,
  NodeInspection,
  WorkflowNodeKind,
} from '../../models/workflow-node.model';
import {
  ContractField,
  contractFields,
  parseContractViolation,
} from '../../services/workflow-contract';
import {
  fieldRulesLabel,
  usedByTitles,
} from '../../services/workflow-input-validation';
import {
  nodeStatusLabel,
  runStatusLine,
  runStepStatusLabel,
} from '../../services/workflows.util';
import { buildStepNarrative } from '../../services/workflow-step-narrative';
import {
  answerQueryIndex,
  storyMarkdown,
} from '../../services/workflow-step-story';
import { ToolDataRecord } from '../../../sessions/models/session.model';
import { WorkflowAttemptSwitcher } from '../workflow-attempt-switcher/workflow-attempt-switcher';
import { WorkflowDataView } from '../workflow-data-view/workflow-data-view';
import { WorkflowStepOutputView } from '../workflow-step-output-view/workflow-step-output-view';
import { WorkflowNodeChat } from '../workflow-node-chat/workflow-node-chat';
import {
  StoryQueryOpen,
  WorkflowStepStory,
} from '../workflow-step-story/workflow-step-story';
import { exitSentence } from '../../../agents/services/workflow-flow';
import { formatNodeDuration, nodeStatusChip } from './workflow-node-format';
import {
  DOCK_KEY_STEP,
  NODE_CHAT_PANE,
  nodeChatBounds,
  nodeChatWidth,
  readNodeChatWidth,
  writeNodeChatWidth,
} from '../workflow-run-dock/workflow-run-dock.util';

type DialogTab = 'parameters' | 'settings';

const TAB_LABELS: Record<DialogTab, string> = {
  parameters: 'Parameters',
  settings: 'Settings',
};

/** The views of an agent step's artifact (ui.md 4.4b). */
type ArtifactView = 'story' | 'data' | 'config';

const VIEW_LABELS: Record<ArtifactView, string> = {
  story: 'Story',
  data: 'Data',
  config: 'Config',
};

/** The chat's opening note quotes at most this much of the step's own words. */
const INTRO_MAX = 280;

const NOT_RUN =
  'This node has not run yet. Execute the workflow to see its data.';

const TOOL_NOT_RUN =
  'This tool has not run yet. Execute the workflow to see its calls.';

const KIND_ICONS = {
  trigger: Zap,
  code: Braces,
  agent: Sparkles,
  output: Flag,
  tool: Wrench,
} as const;

const FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * The node dialog (ui.md 4.4b). An agent step shows a chat with its agent
 * beside an artifact of its run: its Story (the server's `step.story`), its
 * Data (input and output) and its Config (parameters and settings). A code
 * step shows its Story, then its input, its parameters and settings, and
 * its output, stacked top to bottom, Input and Output collapsed; Start and
 * End the same without a Story. A query in a Story opens in the query
 * inspector (`openQuery`). The parent returns focus on `close`.
 */
@Component({
  selector: 'app-workflow-node-dialog',
  imports: [
    LucideAngularModule,
    NgTemplateOutlet,
    WorkflowAttemptSwitcher,
    WorkflowDataView,
    WorkflowNodeChat,
    WorkflowStepOutputView,
    WorkflowStepStory,
  ],
  templateUrl: './workflow-node-dialog.html',
  styles: `
    /* The chat pane's right edge: a 10 px grab area, a 2 px line on hover, focus and drag. */
    .ndv-chat-handle {
      position: absolute;
      z-index: 30;
      right: -5px;
      top: 0;
      bottom: 0;
      width: 10px;
      cursor: col-resize;
      touch-action: none;
      outline: none;
    }
    .ndv-chat-handle::after {
      position: absolute;
      top: 0;
      bottom: 0;
      left: 4px;
      width: 2px;
      content: '';
      background: transparent;
      transition: background-color 120ms ease;
    }
    .ndv-chat-handle:hover::after,
    .ndv-chat-handle:focus-visible::after,
    .ndv-chat-handle-active::after {
      background: var(--qti-border-selected);
    }
    .ndv-resizing,
    .ndv-resizing * {
      user-select: none !important;
    }
  `,
  host: {
    '(document:keydown.escape)': 'close.emit()',
  },
})
export class WorkflowNodeDialog {
  /** A step's exit as a sentence, the outcome first (ui.md 4.4b). */
  protected readonly exitSentence = exitSentence;

  readonly X = X;
  readonly ChevronRight = ChevronRight;
  readonly Check = Check;
  readonly Copy = Copy;
  readonly FileText = FileText;

  readonly node = input.required<NodeInspection>();
  readonly workflow = input.required<WorkflowDetail>();
  readonly runId = input<string | null>(null);
  /** The stored run's `contractHash`; null while live, or for an old run. */
  readonly runContractHash = input<string | null>(null);

  readonly close = output<void>();
  readonly openAgent = output<string>();
  /** A tool's Step link: open its agent step's dialog. */
  readonly openStep = output<string>();

  /** Whether this run's step can be chatted about (api.md 136, 137). */
  readonly chat = input<NodeChatAvailability>({ state: 'hidden' });

  readonly triggerLabels = TRIGGER_LABELS;
  readonly tabLabels = TAB_LABELS;
  readonly tabs: readonly DialogTab[] = ['parameters', 'settings'];
  readonly tab = signal<DialogTab>('parameters');
  /** Input (above the tabs) and Output (below them) start collapsed. */
  readonly inputOpen = signal(false);
  readonly outputOpen = signal(false);

  /** An agent step: the chat beside an artifact of its run. */
  readonly artifact = computed(() => this.node().kind === 'agent');
  /** An agent step offers its chat, unless the run's workflow is gone. */
  readonly hasChat = computed(
    () => this.artifact() && this.chat().state !== 'hidden',
  );
  readonly viewLabels = VIEW_LABELS;
  readonly views: readonly ArtifactView[] = ['story', 'data', 'config'];
  readonly view = signal<ArtifactView>('story');

  /**
   * The shown answer's records (its `data`) when the page inspects its
   * queries; null otherwise: a Story's queries then have no Open query.
   */
  readonly answerData = input<readonly ToolDataRecord[] | null>(null);
  /** A Story's query was picked: its index among the answer's queries. */
  readonly openQuery = output<StoryQueryOpen>();
  /** Where a statement is among the answer's queries; null when none can be opened. */
  readonly queryIndexOf = computed(() => {
    const data = this.answerData();
    return data?.length ? (sql: string) => answerQueryIndex(data, sql) : null;
  });
  /** A step (not Start, End or a tool) has a Story. */
  readonly hasStory = computed(
    () => this.node().kind === 'code' || this.node().kind === 'agent',
  );
  /** What the Story says for a step without one. */
  readonly storyEmpty = computed(() => {
    const run = this.run();
    if (!run) return NOT_RUN;
    if (run.status === 'running')
      return 'Running… its story appears when it ends.';
    if (run.status === 'suspended') return 'Waiting for your answer.';
    return 'No story was kept for this step. Data has what it received and returned.';
  });
  readonly copied = signal(false);

  /** Show another view of the artifact, from its top. */
  selectView(view: ArtifactView): void {
    this.view.set(view);
    const panel = this.artifactPanel()?.nativeElement;
    if (panel) panel.scrollTop = 0;
  }

  private readonly artifactPanel =
    viewChild<ElementRef<HTMLElement>>('artifactPanel');

  private readonly nodeChat = viewChild(WorkflowNodeChat);

  private readonly dialog =
    viewChild.required<ElementRef<HTMLElement>>('dialog');
  private readonly closeButton =
    viewChild.required<ElementRef<HTMLButtonElement>>('closeButton');

  /** The agent-step layout, measured: the room the chat and the artifact share. */
  private readonly artifactLayout =
    viewChild<ElementRef<HTMLElement>>('artifactLayout');
  private readonly layoutRoom = signal(0);
  /** The chat pane's width as last dragged (kept across openings). */
  private readonly wantedChatWidth = signal(readNodeChatWidth());
  readonly chatResizing = signal(false);
  readonly chatBounds = computed(() => nodeChatBounds(this.layoutRoom()));
  readonly chatWidth = computed(() =>
    nodeChatWidth(this.layoutRoom(), this.wantedChatWidth()),
  );

  constructor() {
    afterNextRender(() => this.closeButton().nativeElement.focus());
    effect((onCleanup) => {
      const layout = this.artifactLayout()?.nativeElement;
      if (!layout) return;
      this.layoutRoom.set(layout.clientWidth);
      if (typeof ResizeObserver === 'undefined') return;
      const observer = new ResizeObserver(() =>
        this.layoutRoom.set(layout.clientWidth),
      );
      observer.observe(layout);
      onCleanup(() => observer.disconnect());
    });
  }

  /** Dragging the chat pane's right edge sets its width (kept on release). */
  startChatResize(event: PointerEvent): void {
    if (!this.artifactLayout() || event.button !== 0) return;
    event.preventDefault();
    const handle = event.target as HTMLElement;
    handle.setPointerCapture?.(event.pointerId);
    this.chatResizing.set(true);
    // Relative to where it was grabbed, so the edge never jumps under the pointer.
    const startX = event.clientX;
    const startWidth = this.chatWidth();
    const move = (e: PointerEvent) =>
      this.setChatWidth(startWidth + e.clientX - startX);
    const up = () => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', up);
      handle.removeEventListener('pointercancel', up);
      this.chatResizing.set(false);
      writeNodeChatWidth(this.chatWidth());
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', up);
    handle.addEventListener('pointercancel', up);
  }

  /** Arrow Right / Left widen or narrow the chat by a step; Home and End go to the bounds. */
  resizeChatWithKeyboard(event: KeyboardEvent): void {
    const { min, max } = this.chatBounds();
    const now = this.chatWidth();
    const next =
      event.key === 'ArrowRight'
        ? now + DOCK_KEY_STEP
        : event.key === 'ArrowLeft'
          ? now - DOCK_KEY_STEP
          : event.key === 'Home'
            ? min
            : event.key === 'End'
              ? max
              : null;
    if (next === null) return;
    event.preventDefault();
    this.setChatWidth(next);
    writeNodeChatWidth(this.chatWidth());
  }

  /** Double-click on the edge: back to the default width. */
  resetChatWidth(): void {
    this.wantedChatWidth.set(NODE_CHAT_PANE.defaultWidth);
    writeNodeChatWidth(NODE_CHAT_PANE.defaultWidth);
  }

  private setChatWidth(px: number): void {
    this.wantedChatWidth.set(nodeChatWidth(this.layoutRoom(), px));
  }

  readonly icon = computed(() => KIND_ICONS[this.node().kind]);
  readonly badge = computed(() => {
    const kind: WorkflowNodeKind = this.node().kind;
    return kind === 'code'
      ? 'CODE'
      : kind === 'agent'
        ? 'LLM'
        : kind === 'tool'
          ? 'TOOL'
          : null;
  });
  readonly agentLine = computed(() => {
    const tool = this.tool();
    if (tool !== null) return `Tool of ${tool.agentName} · ${tool.stepTitle}`;
    const agent = this.node().step?.agent;
    if (!agent) return null;
    // A one-call step (Plan, Write answer) names its agent alone.
    return agent.maxSteps > 1
      ? `${agent.name} · ≤ ${agent.maxSteps} steps`
      : agent.name;
  });

  /** A tool opened from its sub-node; null for any other node. */
  readonly tool = computed(() => this.node().tool ?? null);
  readonly toolNotRun = TOOL_NOT_RUN;
  readonly toolDuration = computed(() =>
    formatNodeDuration(this.tool()?.totalDurationMs),
  );

  /** A step that ran more than once: its attempts' numbers, in order; else empty. */
  readonly attemptNumbers = computed(() =>
    (this.node().attempts ?? []).map((a, i) => a.attempt ?? i + 1),
  );
  /**
   * The attempt shown: the last one, until another is picked; back to the
   * last when another node (or a new run) shows.
   */
  readonly selectedAttempt = linkedSignal({
    // A string, so a refresh of the same node's same attempts keeps the pick.
    source: computed(
      () => `${this.node().nodeId}:${this.attemptNumbers().join(',')}`,
    ),
    computation: (key) => Number(key.split(':').at(-1)?.split(',').at(-1)) || 1,
  });
  /** What the node received and produced: the attempt picked, or its only run. */
  readonly run = computed(() => {
    const attempts = this.node().attempts;
    if (!attempts?.length) return this.node().run;
    const picked = this.selectedAttempt();
    return (
      attempts.find((a, i) => (a.attempt ?? i + 1) === picked) ??
      this.node().run
    );
  });
  /** Start: the errors that refused the last Execute; empty otherwise. */
  readonly inputErrors = computed(() => this.node().inputErrors ?? []);
  readonly statusLabel = computed(() => {
    if (this.inputErrors().length) return nodeStatusLabel('invalid');
    const run = this.run();
    return run ? runStepStatusLabel(run.status) : null;
  });
  readonly statusChip = computed(() =>
    this.inputErrors().length
      ? nodeStatusChip('failed')
      : nodeStatusChip(this.run()?.status ?? null),
  );
  readonly duration = computed(() =>
    formatNodeDuration(this.run()?.durationMs),
  );

  readonly inputEmpty = computed(() =>
    this.run() ? 'No input recorded for this run.' : NOT_RUN,
  );

  /** The agent of an agent step, by name. */
  readonly agentName = computed(
    () =>
      this.node().agent?.name ?? this.node().step?.agent?.name ?? 'the agent',
  );
  /** The Preview of an agent step's artifact: built from the attempt shown. */
  readonly narrative = computed(() => {
    const attempts = this.attemptNumbers();
    return buildStepNarrative({
      title: this.node().title,
      agentName: this.artifact() ? this.agentName() : null,
      run: this.run(),
      attempt: attempts.length ? this.selectedAttempt() : 1,
      attempts: Math.max(attempts.length, 1),
      duration: this.run()?.durationMs != null ? this.duration() : '',
    });
  });
  readonly artifactTitle = computed(() => `How ${this.node().title} ran`);
  readonly artifactCaption = computed(() => {
    if (!this.run()) return 'Report · not run yet';
    const calls = this.narrative().actions.length;
    return `Report · ${calls === 1 ? '1 tool call' : `${calls} tool calls`}`;
  });
  /** The chat's opening note: the step's own words, else what it did. */
  readonly introText = computed(() => {
    const n = this.narrative();
    if (n.error) return `This step failed: ${n.error}`;
    // The summary's first paragraph of prose: no heading, table or list.
    const paragraph = (n.summary ?? '')
      .split(/\n\s*\n/)
      .map((p) => p.trim())
      .find((p) => p && !/^(\||#|[-*] |\d+\. )/.test(p));
    if (paragraph) {
      const flat = paragraph
        .replace(/[#*_`>]/g, '')
        .replace(/\s+/g, ' ')
        .trim();
      return flat.length > INTRO_MAX
        ? `${flat.slice(0, INTRO_MAX - 1)}…`
        : flat;
    }
    const calls = n.actions.length;
    const fields = n.returned.length;
    return `${this.agentName()} made ${calls === 1 ? '1 tool call' : `${calls} tool calls`} and returned ${fields === 1 ? '1 field' : `${fields} fields`}. Ask about any of it below.`;
  });
  /** Questions to start the chat with, from what the step did. */
  readonly suggestions = computed(() => {
    const n = this.narrative();
    const out: string[] = [];
    const failed = n.actions.find((a) => a.error);
    if (failed) out.push(`Why did tool call ${failed.index} fail?`);
    if (n.table) out.push('Explain the result of the last query');
    if (n.received.some((f) => f.name === 'plan')) {
      out.push('Did it follow the plan?');
    }
    if (out.length < 3) out.push('What did this step do, step by step?');
    return out.slice(0, 3);
  });

  /** Put a suggested question in the chat's box, ready to send. */
  suggest(question: string): void {
    this.nodeChat()?.prefill(question);
  }

  /** Copy the Story as Markdown. */
  copyNarrative(): void {
    const story = this.run()?.story;
    if (!story) return;
    const text = storyMarkdown(this.artifactTitle(), story);
    void navigator.clipboard?.writeText(text).then(
      () => {
        this.copied.set(true);
        setTimeout(() => this.copied.set(false), 2000);
      },
      () => this.copied.set(false),
    );
  }
  readonly outputEmpty = computed(() =>
    this.run() ? 'No output recorded for this run.' : NOT_RUN,
  );

  /** The End node's status line (`Run succeeded`, `Run failed: …`). */
  readonly endLine = computed(() => {
    const run = this.run();
    if (this.node().kind !== 'output' || !run) return null;
    const status =
      run.status === 'success'
        ? 'success'
        : run.status === 'stopped'
          ? 'stopped'
          : run.status === 'running' || run.status === 'suspended'
            ? run.status
            : 'failed';
    return runStatusLine({ status });
  });

  /** The last step's output, typed when declared: what the workflow returns. */
  readonly outputFields = computed<ContractField[]>(() => {
    const steps = this.workflow().steps;
    const last = steps.length ? steps[steps.length - 1] : null;
    return last ? contractFields(last.outputSchema, last.output) : [];
  });

  /** A step's declared input (Receives), typed; its names when none is declared. */
  readonly receives = computed<ContractField[]>(() => {
    const step = this.node().step;
    return step ? contractFields(step.inputSchema, step.input) : [];
  });
  /** A step's declared output (Returns), typed; its names when none is declared. */
  readonly returns = computed<ContractField[]>(() => {
    const step = this.node().step;
    return step ? contractFields(step.outputSchema, step.output) : [];
  });

  /** The workflow's contract hash; null from an older backend. */
  readonly contractHash = computed(() => this.workflow().contractHash ?? null);
  /** The stored run's hash when it differs from the workflow's; else null. */
  readonly olderContract = computed(() => {
    const ran = this.runContractHash();
    const current = this.contractHash();
    return ran !== null && current !== null && ran !== current ? ran : null;
  });

  /** The node's error split for display when it is a contract violation. */
  readonly violation = computed(() =>
    this.node().tool ? null : parseContractViolation(this.run()?.error),
  );

  readonly toolCalls = computed<NodeToolCallView[]>(
    () => this.run()?.toolCalls ?? [],
  );

  readonly agentKey = computed(
    () => this.node().step?.agent?.key ?? this.node().agent?.key ?? null,
  );

  list(names: string[] | undefined): string {
    return names?.length ? names.join(', ') : 'None';
  }

  fieldNames(fields: ContractField[]): string[] {
    return fields.map((field) => field.name);
  }

  /** A Start input field's rules (`Max 4000 characters`); '' when none. */
  fieldRules(field: WorkflowInputField): string {
    return fieldRulesLabel(field);
  }

  /** The titles of the steps that read a Start input field, or `None`. */
  fieldUsedBy(field: WorkflowInputField): string {
    return this.list(usedByTitles(field, this.workflow().steps));
  }

  toolMeta(call: NodeToolCallView): string {
    if (!call.finished) return 'Running…';
    const parts: string[] = [];
    if (call.durationMs !== undefined) {
      parts.push(formatNodeDuration(call.durationMs));
    }
    if (call.rowCount !== undefined) parts.push(`${call.rowCount} rows`);
    return parts.join(' · ');
  }

  /** A tool call's result row: `Done`, `Failed`, `Running…`. */
  callStatus(call: NodeToolCallView): string {
    if (!call.finished) return 'Running…';
    return runStepStatusLabel(call.error ? 'failed' : 'success');
  }

  /** `<n> rows · <duration>` of a finished call; '' when it has neither. */
  callMeta(call: NodeToolCallView): string {
    if (!call.finished) return '';
    const parts: string[] = [];
    if (call.rowCount !== undefined) parts.push(`${call.rowCount} rows`);
    if (call.durationMs !== undefined) {
      parts.push(formatNodeDuration(call.durationMs));
    }
    return parts.join(' · ');
  }

  hasError(call: WorkflowRunToolCall): boolean {
    return !!call.error;
  }

  onKeydown(event: KeyboardEvent): void {
    if (event.key !== 'Tab') return;
    // A collapsed Input or Output body is hidden: its controls take no focus.
    const items = Array.from(
      this.dialog().nativeElement.querySelectorAll<HTMLElement>(FOCUSABLE),
    ).filter((el) => el.closest('[hidden]') === null);
    if (items.length === 0) return;
    const first = items[0];
    const last = items[items.length - 1];
    const active = document.activeElement;
    if (
      event.shiftKey &&
      (active === first || !items.includes(active as HTMLElement))
    ) {
      event.preventDefault();
      last.focus();
    } else if (
      !event.shiftKey &&
      (active === last || !items.includes(active as HTMLElement))
    ) {
      event.preventDefault();
      first.focus();
    }
  }
}
