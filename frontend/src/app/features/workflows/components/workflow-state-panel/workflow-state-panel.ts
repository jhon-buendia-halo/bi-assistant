import { Component, computed, input, output } from '@angular/core';
import { ChevronDown, ChevronRight, LucideAngularModule } from 'lucide-angular';
import { DataMode } from '../workflow-data-view/workflow-data-view.util';
import { WorkflowDataView } from '../workflow-data-view/workflow-data-view';
import { runStepStatusLabel } from '../../services/workflows.util';
import {
  NodeInspection,
  WorkflowStateSummary,
} from '../../models/workflow-node.model';
import {
  formatNodeDuration,
  nodeKindLabel,
  nodeStatusChip,
  nodeStatusDot,
} from '../workflow-node-dialog/workflow-node-format';

const NOT_RUN =
  'This node has not run yet. Execute the workflow to see its data.';

/**
 * The Workflow state panel under the canvas (ui.md 4.4b): the run's summary,
 * the node list, and the selected node's input, output and context.
 */
@Component({
  selector: 'app-workflow-state-panel',
  imports: [LucideAngularModule, WorkflowDataView],
  templateUrl: './workflow-state-panel.html',
})
export class WorkflowStatePanel {
  readonly ChevronDown = ChevronDown;
  readonly ChevronRight = ChevronRight;

  readonly nodes = input<NodeInspection[]>([]);
  readonly summary = input.required<WorkflowStateSummary>();
  readonly selectedId = input<string | null>(null);
  readonly open = input(true);

  readonly selectNode = output<string | null>();
  readonly openNode = output<string>();
  readonly openChange = output<boolean>();

  readonly modes: DataMode[] = ['json', 'schema'];
  readonly dot = nodeStatusDot;
  readonly chip = nodeStatusChip;
  readonly kindLabel = nodeKindLabel;
  readonly duration = formatNodeDuration;

  readonly selected = computed(
    () => this.nodes().find((n) => n.nodeId === this.selectedId()) ?? null,
  );
  readonly progress = computed(
    () => `${this.summary().ran} of ${this.summary().total} nodes ran`,
  );
  readonly pill = computed(() => {
    const status = this.summary().status;
    if (!status) return null;
    const chip =
      status === 'success'
        ? 'chip chip-success'
        : status === 'failed'
          ? 'chip chip-danger'
          : status === 'stopped'
            ? 'chip chip-warning'
            : 'chip chip-info';
    return { label: status, chip };
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
