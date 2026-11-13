import {
  Component,
  DestroyRef,
  computed,
  inject,
  input,
  linkedSignal,
  output,
  signal,
} from '@angular/core';
import {
  Check,
  Circle,
  Clock,
  ListTree,
  LucideAngularModule,
  Minus,
  Square,
  X,
} from 'lucide-angular';
import {
  ProgressState,
  elapsedLabel,
  nodeProgressState,
} from '../../services/workflow-run-progress';
import { DataMode } from '../workflow-data-view/workflow-data-view.util';
import { WorkflowAttemptSwitcher } from '../workflow-attempt-switcher/workflow-attempt-switcher';
import { WorkflowDataView } from '../workflow-data-view/workflow-data-view';
import { runStepStatusLabel } from '../../services/workflows.util';
import { NodeInspection } from '../../models/workflow-node.model';
import {
  formatNodeDuration,
  nodeKindLabel,
  nodeStatusChip,
} from '../workflow-node-dialog/workflow-node-format';

const STATE_LABELS: Record<ProgressState, string> = {
  pending: 'Not run',
  done: 'Done',
  current: 'Running',
  waiting: 'Waiting for you',
  failed: 'Failed',
  skipped: 'Skipped',
  stopped: 'Stopped',
};

/** One row of the Logs list: a node with its state in the run shown. */
export interface LogRow {
  node: NodeInspection;
  state: ProgressState;
  /** The screen-reader label of its state. */
  label: string;
  /** How many times it ran; 1 for a node that ran once or not at all. */
  attempts: number;
  /** Its duration, or for the running node the time since it started. */
  time: string;
}

const NOT_RUN =
  'This node has not run yet. Execute the workflow to see its data.';

/**
 * The Logs and node data of the Run panel under the canvas (ui.md 4.4b): one
 * list of every node with its state in the run shown (live, the running one
 * with its elapsed time), and the selected node's input, output and context,
 * or the All nodes table. The run's summary is in the Run panel's header.
 */
@Component({
  selector: 'app-workflow-state-panel',
  imports: [LucideAngularModule, WorkflowAttemptSwitcher, WorkflowDataView],
  templateUrl: './workflow-state-panel.html',
})
export class WorkflowStatePanel {
  readonly Check = Check;
  readonly Circle = Circle;
  readonly Clock = Clock;
  readonly ListTree = ListTree;
  readonly Minus = Minus;
  readonly Square = Square;
  readonly X = X;

  readonly nodes = input<NodeInspection[]>([]);
  readonly selectedId = input<string | null>(null);

  readonly selectNode = output<string | null>();
  readonly openNode = output<string>();

  readonly modes: DataMode[] = ['json', 'schema'];
  readonly chip = nodeStatusChip;
  readonly kindLabel = nodeKindLabel;
  readonly duration = formatNodeDuration;

  /** Ticks every second, for the running node's elapsed time. */
  private readonly now = signal(Date.now());

  constructor() {
    const timer = setInterval(() => this.now.set(Date.now()), 1000);
    inject(DestroyRef).onDestroy(() => clearInterval(timer));
  }

  /** Every node (tool nodes aside) with its state, attempts and time. */
  readonly rows = computed<LogRow[]>(() =>
    this.nodes()
      .filter((node) => node.kind !== 'tool')
      .map((node) => {
        const state = nodeProgressState(node.run?.status);
        const startedAt = node.run?.startedAt;
        return {
          node,
          state,
          label: STATE_LABELS[state],
          attempts: node.attempts?.length || 1,
          time:
            state === 'current'
              ? startedAt !== undefined
                ? elapsedLabel(startedAt, this.now())
                : ''
              : state === 'skipped'
                ? 'Skipped'
                : node.run
                  ? formatNodeDuration(node.run.durationMs)
                  : '',
        };
      }),
  );

  readonly selected = computed(
    () => this.nodes().find((n) => n.nodeId === this.selectedId()) ?? null,
  );
  /** The selected step's attempts' numbers when it ran more than once; else empty. */
  readonly attemptNumbers = computed(() =>
    (this.selected()?.attempts ?? []).map((a, i) => a.attempt ?? i + 1),
  );
  /** The attempt the detail shows: the last, until another is picked. */
  readonly selectedAttempt = linkedSignal({
    // A string, so a refresh of the same node's same attempts keeps the pick.
    source: computed(
      () =>
        `${this.selected()?.nodeId ?? ''}:${this.attemptNumbers().join(',')}`,
    ),
    computation: (key) =>
      Number(key.split(':').at(-1)?.split(',').at(-1)) || 1,
  });
  /** The selected node's run as the detail shows it: the attempt picked, or its only run. */
  readonly shown = computed(() => {
    const node = this.selected();
    if (node === null) return null;
    const attempts = node.attempts;
    if (!attempts?.length) return node.run;
    const picked = this.selectedAttempt();
    return (
      attempts.find((a, i) => (a.attempt ?? i + 1) === picked) ?? node.run
    );
  });
  readonly shownStatusLabel = computed(() => {
    const run = this.shown();
    return run ? runStepStatusLabel(run.status) : 'Not run';
  });


  statusLabel(node: NodeInspection): string {
    return node.run ? runStepStatusLabel(node.run.status) : 'Not run';
  }

  inputEmpty(node: NodeInspection): string {
    return node.run ? 'No input recorded for this run.' : NOT_RUN;
  }

  outputEmpty(node: NodeInspection): string {
    return node.run ? 'No output recorded for this run.' : NOT_RUN;
  }

  inputNames(node: NodeInspection): string {
    const input = node.context?.workflowInput;
    return input && Object.keys(input).length
      ? Object.keys(input).join(', ')
      : 'None';
  }
}
