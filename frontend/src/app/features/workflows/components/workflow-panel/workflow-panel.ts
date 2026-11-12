import { Component, computed, inject, output, signal } from '@angular/core';
import {
  Bot,
  Check,
  ChevronRight,
  CircleX,
  Copy,
  Loader2,
  LucideAngularModule,
  Rocket,
  Square,
} from 'lucide-angular';
import { WorkflowSummary } from '../../models/workflow.model';
import {
  WorkflowDesigner,
  WorkflowPanelTab,
} from '../../services/workflow-designer.service';
import {
  runOutputEntries,
  runStatusLine,
  runStepStatusLabel,
} from '../../services/workflows.util';

/** What drives a chat's workflow bar (workflows R10). */
export const BAR_NOTES: Record<WorkflowSummary['bar'], string> = {
  steps: 'In a chat, the workflow bar shows these steps as they run.',
  agent: "In a chat, the workflow bar shows the agent's own steps as it sets them.",
};

export const TRIGGER_LABELS: Record<WorkflowSummary['trigger'], string> = {
  run: 'Runs on an input',
  chat: 'Runs in a chat',
};

export const NO_STEP_SELECTED =
  'Select a step in the graph to see its configuration.';

/** How long the Code tab's Copy says `Copied`. */
const COPIED_MS = 2000;

/**
 * The right panel of a workflow's page (workflows R7, R8, R10, R12, R13;
 * ui.md 4.4b): tabs for the workflow's configuration, the selected step,
 * the run form and result (run workflows only) and the definition as JSON.
 * Read-only (R3); it shares its state with the page through the designer.
 */
@Component({
  selector: 'app-workflow-panel',
  imports: [LucideAngularModule],
  templateUrl: './workflow-panel.html',
  host: { class: 'flex min-h-0 flex-col', 'data-testid': 'workflow-panel' },
})
export class WorkflowPanel {
  protected readonly Bot = Bot;
  protected readonly Check = Check;
  protected readonly ChevronRight = ChevronRight;
  protected readonly CircleX = CircleX;
  protected readonly Copy = Copy;
  protected readonly Loader2 = Loader2;
  protected readonly Rocket = Rocket;
  protected readonly Square = Square;

  protected readonly designer = inject(WorkflowDesigner);

  /** An agent row; the shell opens the agent's detail (R8). */
  readonly openAgent = output<string>();

  protected readonly noStep = NO_STEP_SELECTED;
  protected readonly triggerLabels = TRIGGER_LABELS;
  protected readonly barNotes = BAR_NOTES;
  protected readonly stepStatusLabel = runStepStatusLabel;

  /** The last step's output fields: what the workflow returns. */
  protected readonly outputFields = computed(() => {
    const steps = this.designer.workflow()?.steps ?? [];
    return steps.length === 0 ? [] : steps[steps.length - 1].output;
  });

  /**
   * A chat workflow has no typed input: what it takes from each chat message
   * is its first step's input.
   */
  protected readonly chatInputKeys = computed(() => {
    const workflow = this.designer.workflow();
    if (workflow === null || workflow.trigger !== 'chat') return [];
    return workflow.steps.length === 0 ? [] : workflow.steps[0].input;
  });

  protected readonly code = computed(() => {
    const workflow = this.designer.workflow();
    return workflow === null ? '' : JSON.stringify(workflow, null, 2);
  });

  protected readonly runStatus = computed(() => {
    const result = this.designer.runResult();
    return result === null ? '' : runStatusLine(result);
  });
  protected readonly runOutput = computed(() => {
    const result = this.designer.runResult();
    return result === null ? [] : runOutputEntries(result.output);
  });

  protected readonly copied = signal(false);
  private copiedTimer: ReturnType<typeof setTimeout> | null = null;

  protected tabId(tab: WorkflowPanelTab): string {
    return `workflow-panel-tab-${tab}`;
  }

  protected panelId(tab: WorkflowPanelTab): string {
    return `workflow-panel-${tab}`;
  }

  /** Left and Right move between the tabs and focus the new one. */
  protected onTabKeydown(event: KeyboardEvent): void {
    if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
    event.preventDefault();
    const tabs = this.designer.tabs();
    const index = tabs.findIndex((tab) => tab.id === this.designer.tab());
    const step = event.key === 'ArrowRight' ? 1 : -1;
    const next = tabs[(index + step + tabs.length) % tabs.length];
    this.designer.setTab(next.id);
    const button = (event.currentTarget as HTMLElement).querySelector<HTMLElement>(
      `#${this.tabId(next.id)}`,
    );
    button?.focus();
  }

  protected inputId(name: string): string {
    return `workflow-input-${name}`;
  }

  protected onInput(name: string, event: Event): void {
    const value = (event.target as HTMLInputElement | HTMLTextAreaElement)
      .value;
    this.designer.setInput(name, value);
  }

  /** A step's output as pretty JSON. */
  protected pretty(value: Record<string, unknown>): string {
    return JSON.stringify(value, null, 2);
  }

  protected copyCode(): void {
    const clipboard = window.navigator.clipboard;
    if (!clipboard) return;
    clipboard.writeText(this.code()).then(
      () => {
        this.copied.set(true);
        if (this.copiedTimer !== null) clearTimeout(this.copiedTimer);
        this.copiedTimer = setTimeout(() => this.copied.set(false), COPIED_MS);
      },
      () => this.copied.set(false),
    );
  }
}
