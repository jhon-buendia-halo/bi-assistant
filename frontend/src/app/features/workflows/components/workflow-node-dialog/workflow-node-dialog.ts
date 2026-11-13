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
  ChevronRight,
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
import { WorkflowAttemptSwitcher } from '../workflow-attempt-switcher/workflow-attempt-switcher';
import { WorkflowDataView } from '../workflow-data-view/workflow-data-view';
import { WorkflowStepOutputView } from '../workflow-step-output-view/workflow-step-output-view';
import { WorkflowNodeChat } from '../workflow-node-chat/workflow-node-chat';
import { formatNodeDuration, nodeStatusChip } from './workflow-node-format';

type DialogTab = 'parameters' | 'settings' | 'chat';

const TAB_LABELS: Record<DialogTab, string> = {
  parameters: 'Parameters',
  settings: 'Settings',
  chat: 'Chat',
};

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
 * The node dialog (ui.md 4.4b): a node's input, its parameters and settings
 * (and, for an agent step, a chat about its run data), and its output in
 * three columns. The parent returns focus on `close`.
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
  ],
  templateUrl: './workflow-node-dialog.html',
  host: {
    '(document:keydown.escape)': 'close.emit()',
  },
})
export class WorkflowNodeDialog {
  readonly X = X;
  readonly ChevronRight = ChevronRight;

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
  readonly tab = signal<DialogTab>('parameters');

  /** An agent step offers Chat, unless the run's workflow is gone. */
  readonly hasChat = computed(
    () => this.node().kind === 'agent' && this.chat().state !== 'hidden',
  );
  readonly tabs = computed<DialogTab[]>(() =>
    this.hasChat()
      ? ['parameters', 'settings', 'chat']
      : ['parameters', 'settings'],
  );
  /** The tab shown: Chat falls back to Parameters on a node without it. */
  readonly activeTab = computed<DialogTab>(() => {
    const tab = this.tab();
    return tab === 'chat' && !this.hasChat() ? 'parameters' : tab;
  });
  /** The chat panel is created when Chat first shows, then kept while other tabs show. */
  readonly chatMounted = signal(false);

  selectTab(tab: DialogTab): void {
    this.tab.set(tab);
    if (tab === 'chat') this.chatMounted.set(true);
  }

  private readonly dialog =
    viewChild.required<ElementRef<HTMLElement>>('dialog');
  private readonly closeButton =
    viewChild.required<ElementRef<HTMLButtonElement>>('closeButton');

  constructor() {
    afterNextRender(() => this.closeButton().nativeElement.focus());
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
    return agent ? `${agent.name} · ≤ ${agent.maxSteps} steps` : null;
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
          : run.status === 'running'
            ? 'running'
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
    const items = Array.from(
      this.dialog().nativeElement.querySelectorAll<HTMLElement>(FOCUSABLE),
    );
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
