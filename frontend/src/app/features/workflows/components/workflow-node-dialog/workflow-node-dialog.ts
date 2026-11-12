import {
  Component,
  ElementRef,
  afterNextRender,
  computed,
  input,
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
  TRIGGER_LABELS,
  WorkflowDetail,
  WorkflowRunToolCall,
} from '../../models/workflow.model';
import {
  NodeToolCallView,
  NodeInspection,
  WorkflowNodeKind,
} from '../../models/workflow-node.model';
import {
  runStatusLine,
  runStepStatusLabel,
} from '../../services/workflows.util';
import { WorkflowDataView } from '../workflow-data-view/workflow-data-view';
import { formatNodeDuration, nodeStatusChip } from './workflow-node-format';

type DialogTab = 'parameters' | 'settings';

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
 * The node dialog (ui.md 4.4b): a node's input, its parameters and settings,
 * and its output in three columns. The parent returns focus on `close`.
 */
@Component({
  selector: 'app-workflow-node-dialog',
  imports: [LucideAngularModule, WorkflowDataView],
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

  readonly close = output<void>();
  readonly openAgent = output<string>();
  /** A tool's Step link: open its agent step's dialog. */
  readonly openStep = output<string>();

  readonly triggerLabels = TRIGGER_LABELS;
  readonly tab = signal<DialogTab>('parameters');

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

  readonly run = computed(() => this.node().run);
  readonly statusLabel = computed(() => {
    const run = this.run();
    return run ? runStepStatusLabel(run.status) : null;
  });
  readonly statusChip = computed(() =>
    nodeStatusChip(this.run()?.status ?? null),
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

  /** Names of the last step's output: what the workflow returns. */
  readonly outputFields = computed(() => {
    const steps = this.workflow().steps;
    return steps.length ? steps[steps.length - 1].output : [];
  });

  readonly toolCalls = computed<NodeToolCallView[]>(
    () => this.run()?.toolCalls ?? [],
  );

  readonly agentKey = computed(
    () => this.node().step?.agent?.key ?? this.node().agent?.key ?? null,
  );

  list(names: string[] | undefined): string {
    return names?.length ? names.join(', ') : 'None';
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
