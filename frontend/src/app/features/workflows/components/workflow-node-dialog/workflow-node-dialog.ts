import { NgTemplateOutlet } from '@angular/common';
import {
  Component,
  ElementRef,
  afterNextRender,
  computed,
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
  NodeToolView,
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
  personaLabel,
  runStatusLine,
  runStepStatusLabel,
} from '../../services/workflows.util';
import {
  buildStepNarrative,
  readSummary,
} from '../../services/workflow-step-narrative';
import {
  answerQueryIndex,
  storyMarkdown,
} from '../../services/workflow-step-story';
import { ToolDataRecord } from '../../../sessions/models/session.model';
import { AgentAvatar } from '../../../../shared/components/agent-avatar/agent-avatar';
import { WorkflowAttemptSwitcher } from '../workflow-attempt-switcher/workflow-attempt-switcher';
import { WorkflowDataView } from '../workflow-data-view/workflow-data-view';
import { WorkflowNodeChat } from '../workflow-node-chat/workflow-node-chat';
import { WorkflowStepEvidence } from '../workflow-step-evidence/workflow-step-evidence';
import { WorkflowTeammateWork } from '../workflow-teammate-work/workflow-teammate-work';
import { WorkflowLeadWork } from '../workflow-lead-work/workflow-lead-work';
import { RelayItem } from '../../services/team-relay';
import {
  StoryQueryOpen,
  WorkflowStepStory,
} from '../workflow-step-story/workflow-step-story';
import { exitSentence } from '../../../agents/services/workflow-flow';
import { formatNodeDuration, nodeStatusChip } from './workflow-node-format';

type DialogTab = 'parameters' | 'settings';

const TAB_LABELS: Record<DialogTab, string> = {
  parameters: 'Parameters',
  settings: 'Settings',
};

/** What a Copy button copies: the Story, or the input or output as JSON. */
export type CopyTarget = 'story' | 'input' | 'output';

const NOT_RUN =
  'This node has not run yet. Run the workflow to see its data.';

const TOOL_NOT_RUN =
  'This tool has not run yet. Run the workflow to see its calls.';

const KIND_ICONS = {
  trigger: Zap,
  code: Braces,
  agent: Sparkles,
  output: Flag,
  tool: Wrench,
} as const;

const FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** A card's one-line summary lists at most this many field names. */
const SUMMARY_FIELDS = 4;

/**
 * The node dialog (ui.md 4.4b). An agent step reads as one centred column,
 * in the Business view's style: its Story told by its persona, what the
 * persona used (its tool calls as evidence rows), what it received, what it
 * returned and how it is set up (collapsed cards), then the chat with the
 * persona. A code step shows its Story, then its input, its parameters and
 * settings, and its output, stacked top to bottom, Input and Output
 * collapsed; Start and End the same without a Story. A query in a Story
 * opens in the query inspector (`openQuery`). The parent returns focus on
 * `close`.
 */
@Component({
  selector: 'app-workflow-node-dialog',
  imports: [
    AgentAvatar,
    LucideAngularModule,
    NgTemplateOutlet,
    WorkflowAttemptSwitcher,
    WorkflowDataView,
    WorkflowNodeChat,
    WorkflowStepEvidence,
    WorkflowStepStory,
    WorkflowTeammateWork,
    WorkflowLeadWork,
  ],
  templateUrl: './workflow-node-dialog.html',
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
  /** Input and Output (and an agent step's set-up card) start collapsed. */
  readonly inputOpen = signal(false);
  readonly outputOpen = signal(false);
  readonly setupOpen = signal(false);

  /** An agent step: one column of its Story, evidence, cards and chat. */
  readonly artifact = computed(() => this.node().kind === 'agent');
  /** An agent step offers its chat, unless the run's workflow is gone. */
  readonly hasChat = computed(
    () => this.artifact() && this.chat().state !== 'hidden',
  );

  /**
   * The shown answer's records (its `data`) when the page inspects its
   * queries; null otherwise: a Story's queries then have no Open query.
   */
  readonly answerData = input<readonly ToolDataRecord[] | null>(null);
  /** A Story's query was picked: its index among the answer's queries. */
  readonly openQuery = output<StoryQueryOpen>();
  /**
   * The orchestrator step's relay in the run shown (ui.md 4.4b *relay*): a
   * teammate's dialog tells their work from it. Null without one.
   */
  readonly relay = input<readonly RelayItem[] | null>(null);
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
    return 'No story was kept for this step. What it received and returned are below.';
  });
  /** The Copy button that just copied, for its two seconds of `Copied`. */
  readonly copied = signal<CopyTarget | null>(null);

  private readonly dialog =
    viewChild.required<ElementRef<HTMLElement>>('dialog');
  private readonly closeButton =
    viewChild.required<ElementRef<HTMLButtonElement>>('closeButton');

  constructor() {
    afterNextRender(() => this.closeButton().nativeElement.focus());
  }

  readonly icon = computed(() => KIND_ICONS[this.node().kind]);
  readonly badge = computed(() => {
    if (this.persona()) return null;
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
    if (tool !== null) {
      const persona = personaLabel({
        name: tool.agentName,
        role: tool.agentRole,
      });
      return tool.teammate
        ? `Works for ${persona} · ${tool.stepTitle}`
        : `Tool of ${persona} · ${tool.stepTitle}`;
    }
    const agent = this.node().step?.agent;
    if (!agent) return null;
    // An orchestrator told as her work: her portrait and name head it, the step names what she does.
    if (this.leadWork()) return this.node().title;
    // A one-call step (Plan, Write answer) names its agent alone, with its role (R39).
    return agent.maxSteps > 1
      ? `${personaLabel(agent)} · ≤ ${agent.maxSteps} steps`
      : personaLabel(agent);
  });

  /** A tool opened from its sub-node; null for any other node. */
  readonly tool = computed(() => this.node().tool ?? null);
  /**
   * An orchestrator's step with her relay in the run shown (ui.md 4.4b): the
   * dialog tells her work as a teammate's tells theirs, instead of its Story
   * and tool calls. Null for any other node.
   */
  readonly leadWork = computed(() => {
    const step = this.node().step;
    const relay = this.relay();
    const run = this.run();
    if (
      !this.artifact() ||
      !step?.agent?.team?.length ||
      !relay?.length ||
      !run
    )
      return null;
    const text = (value: unknown) =>
      typeof value === 'string' && value.trim() ? value : null;
    return {
      stepId: step.id,
      team: step.agent.team,
      relay,
      question: text(run.input?.['question']),
      answer: text(run.output?.['answer']),
      running: run.status === 'running',
    };
  });
  /**
   * Who heads a dialog told as someone's work (a teammate, an orchestrator):
   * their portrait, name and role, and their agent definition one link away.
   */
  readonly persona = computed(() => {
    const mate = this.teammate();
    if (mate) return mate;
    const key = this.agentKey();
    return this.leadWork() && key
      ? { key, name: this.agentName(), role: this.agentRole() }
      : null;
  });
  /** A team tool's teammate (their portrait sub-node): the dialog tells their work. */
  readonly teammate = computed(() => this.tool()?.teammate ?? null);
  /** The teammate's chip in the run shown: `Working`, `Failed`, `Done · 27.1 s`; null when not called. */
  readonly teammateStatus = computed(() => {
    const calls = this.teammate() ? (this.tool()?.calls ?? []) : [];
    if (calls.length === 0) return null;
    if (calls.some((call) => !call.finished))
      return { label: 'Working', chip: nodeStatusChip('running') };
    if (calls.some((call) => call.error))
      return { label: 'Failed', chip: nodeStatusChip('failed') };
    return {
      label: `Done · ${this.toolDuration()}`,
      chip: nodeStatusChip('success'),
    };
  });
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
  /** The agent of an agent step, by name. */
  readonly agentName = computed(
    () =>
      this.node().agent?.name ??
      this.node().step?.agent?.name ??
      'the agent persona',
  );
  /** The persona's role (job title); '' without one. */
  readonly agentRole = computed(
    () => (this.node().agent ?? this.node().step?.agent)?.role?.trim() ?? '',
  );
  /** The same with its role, where the dialog introduces the persona (R39). */
  readonly agentLabel = computed(() => {
    const agent = this.node().agent ?? this.node().step?.agent;
    return agent ? personaLabel(agent) : 'the agent persona';
  });
  protected readonly personaLabel = personaLabel;
  /** A tool's agent persona with its role. */
  protected toolPersona(tool: NodeToolView): string {
    return personaLabel({ name: tool.agentName, role: tool.agentRole });
  }
  /** What the attempt shown did, built from its run data (for the chat's suggestions). */
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
  /** The Story's title when copied as Markdown. */
  readonly storyTitle = computed(() => `How ${this.node().title} ran`);
  /** What a step with no tool calls read, as its one evidence row; else null. */
  readonly evidenceSummary = computed(() => readSummary(this.run()?.input));
  /** A card's one-line summary: the first field names of a value. */
  readonly receivedSummary = computed(() =>
    this.fieldSummary(this.run()?.input),
  );
  readonly returnedSummary = computed(() =>
    this.fieldSummary(this.run()?.output),
  );
  /** The set-up card's summary: the persona's model and step limit. */
  readonly setupSummary = computed(() => {
    const agent = this.node().step?.agent;
    if (!agent) return '';
    const model = this.node().agent?.model ?? null;
    return [
      model,
      agent.maxSteps > 1 ? `≤ ${agent.maxSteps} steps` : 'one call',
    ]
      .filter(Boolean)
      .join(' · ');
  });

  private fieldSummary(value: Record<string, unknown> | undefined): string {
    const names = Object.keys(value ?? {});
    if (!names.length) return '';
    const shown = names.slice(0, SUMMARY_FIELDS).join(', ');
    return names.length > SUMMARY_FIELDS
      ? `${shown} +${names.length - SUMMARY_FIELDS}`
      : shown;
  }

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

  /** Whether a Copy button has something to copy in the attempt shown. */
  canCopy(target: CopyTarget): boolean {
    const run = this.run();
    if (target === 'story') return !!run?.story;
    return (target === 'input' ? run?.input : run?.output) !== undefined;
  }

  /** Copy the Story as Markdown, or the input or output as JSON. */
  copy(target: CopyTarget): void {
    const run = this.run();
    let text: string | null = null;
    if (target === 'story') {
      text = run?.story ? storyMarkdown(this.storyTitle(), run.story) : null;
    } else {
      const value = target === 'input' ? run?.input : run?.output;
      text = value === undefined ? null : JSON.stringify(value, null, 2);
    }
    if (text === null) return;
    void navigator.clipboard?.writeText(text).then(
      () => {
        this.copied.set(target);
        setTimeout(() => {
          if (this.copied() === target) this.copied.set(null);
        }, 2000);
      },
      () => this.copied.set(null),
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
