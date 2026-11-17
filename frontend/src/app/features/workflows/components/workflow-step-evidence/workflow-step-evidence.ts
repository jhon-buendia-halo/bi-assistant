import {
  Component,
  computed,
  input,
  linkedSignal,
  output,
} from '@angular/core';
import { ChevronRight, LucideAngularModule } from 'lucide-angular';
import { NodeToolCallView } from '../../models/workflow-node.model';
import {
  NarrativeAction,
  callActions,
} from '../../services/workflow-step-narrative';
import { WorkflowDataView } from '../workflow-data-view/workflow-data-view';

/** A Failed chip quotes at most this much of the error; the detail has it all. */
const CHIP_ERROR_MAX = 48;

/** One evidence row: a tool call in business words, with its status chip. */
export interface EvidenceRow {
  action: NarrativeAction;
  chip: { label: string; tone: 'success' | 'danger' | 'info'; title: string };
}

function chipOf(action: NarrativeAction): EvidenceRow['chip'] {
  if (action.running) {
    return { label: 'Running…', tone: 'info', title: 'Still running' };
  }
  if (action.error) {
    const flat = action.error.replace(/\s+/g, ' ').trim();
    const short =
      flat.length > CHIP_ERROR_MAX
        ? `${flat.slice(0, CHIP_ERROR_MAX - 1)}…`
        : flat;
    return { label: `Failed · ${short}`, tone: 'danger', title: flat };
  }
  return { label: 'Done', tone: 'success', title: 'Done' };
}

/**
 * What an agent step used (ui.md 4.4b): its tool calls as evidence rows in
 * the Business view's style (a numbered pill, the call in business words, its
 * rows and time, a status chip). A row opens its detail in place: what the
 * call ran and the rows it returned. A step with no tool calls shows the one
 * row of what it read (`summary`), when it has one. Presentational.
 */
@Component({
  selector: 'app-workflow-step-evidence',
  imports: [LucideAngularModule, WorkflowDataView],
  templateUrl: './workflow-step-evidence.html',
})
export class WorkflowStepEvidence {
  protected readonly ChevronRight = ChevronRight;

  readonly calls = input.required<NodeToolCallView[]>();
  readonly agentName = input.required<string>();
  /** The step's output: its stored queries give a call its rationale and rows. */
  readonly output = input<Record<string, unknown> | undefined>(undefined);
  /** What a step with no tool calls read (`Based on 7 rows from 2 queries`). */
  readonly summary = input<string | null>(null);
  /** A row was opened: the call's index (0-based). */
  readonly openCall = output<number>();

  readonly rows = computed<EvidenceRow[]>(() =>
    callActions(this.calls(), this.output()).map((action) => ({
      action,
      chip: chipOf(action),
    })),
  );

  readonly heading = computed(() => `What ${this.agentName()} used`);
  readonly count = computed(() => {
    const n = this.rows().length;
    return n === 0 ? '' : n === 1 ? '1 tool call' : `${n} tool calls`;
  });

  /**
   * The rows open; none again for another step or attempt (its first call
   * differs), kept while a live step adds calls. A string, so a refresh of
   * the same calls keeps them.
   */
  readonly expanded = linkedSignal<string, ReadonlySet<number>>({
    source: computed(() => {
      const first = this.calls()[0];
      return first ? `${first.tool}\u0000${first.input ?? ''}` : '';
    }),
    computation: () => new Set<number>(),
  });

  isOpen(index: number): boolean {
    return this.expanded().has(index);
  }

  toggle(index: number): void {
    const next = new Set(this.expanded());
    if (next.has(index)) {
      next.delete(index);
    } else {
      next.add(index);
      this.openCall.emit(index);
    }
    this.expanded.set(next);
  }

  chipClass(tone: EvidenceRow['chip']['tone']): string {
    return `chip chip-${tone} max-w-[260px] shrink-0 truncate`;
  }
}
