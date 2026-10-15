import {
  Component,
  ChangeDetectorRef,
  ElementRef,
  HostListener,
  OnDestroy,
  afterNextRender,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import {
  Check,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Clock,
  LucideAngularModule,
} from 'lucide-angular';
import { MarkdownPipe } from '../../../../shared/pipes/markdown.pipe';
import { WorkflowPhase, WorkflowView } from '../../models/session.model';

const NO_WORKFLOW: WorkflowView = {
  phases: [],
  current: null,
  done: [],
  skipped: [],
  source: 'agent',
};

export type WorkflowStepStatus =
  'done' | 'current' | 'waiting' | 'skipped' | 'upcoming';

export const WORKFLOW_BAR_COLLAPSED_KEY =
  'questions-to-insights:workflow-bar-collapsed';

/** Below this width only the current step and `n/m` show. */
const NARROW_WIDTH = 720;

const STATUS_LABEL: Record<WorkflowStepStatus, string> = {
  done: 'Done',
  current: 'Current',
  waiting: 'Waiting for you',
  skipped: 'Skipped',
  upcoming: 'Upcoming',
};

/** Status of a step in a workflow view. */
export function workflowStepStatus(
  wf: WorkflowView,
  number: number,
): WorkflowStepStatus {
  if (wf.done.includes(number)) return 'done';
  if (wf.skipped?.includes(number)) return 'skipped';
  if (wf.current === number) return wf.waiting ? 'waiting' : 'current';
  return 'upcoming';
}

/**
 * The workflow status bar pinned above the chat: the steps of the process the
 * agent guides the user through and where they are (BA-231 addendum).
 */
@Component({
  selector: 'app-workflow-bar',
  imports: [LucideAngularModule, MarkdownPipe],
  templateUrl: './workflow-bar.html',
})
export class WorkflowBar implements OnDestroy {
  readonly Check = Check;
  readonly ChevronDown = ChevronDown;
  readonly ChevronRight = ChevronRight;
  readonly ChevronUp = ChevronUp;
  readonly Clock = Clock;
  readonly fadeMask =
    'linear-gradient(to right, #000 calc(100% - 28px), transparent)';

  /** The session's workflow; none yet shows the empty state (agent-panel R16). */
  readonly workflow = input<WorkflowView | null | undefined>(null);
  readonly empty = computed(() => !this.workflow());
  /** The workflow, or no steps while there is none. */
  readonly view = computed<WorkflowView>(() => this.workflow() ?? NO_WORKFLOW);

  readonly collapsed = signal(readCollapsed());
  readonly detailsOpen = signal(false);
  readonly popoverStep = signal<number | null>(null);
  private readonly width = signal(0);
  /** The step row is wider than its space: done and skipped steps show icon only. */
  readonly compact = signal(false);
  /** Still wider in compact mode: a fade on the right edge marks the scroll edge. */
  readonly fade = signal(false);
  private readonly cdr = inject(ChangeDetectorRef);

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly list = viewChild<ElementRef<HTMLElement>>('list');
  private observer?: ResizeObserver;

  readonly narrow = computed(
    () => this.width() > 0 && this.width() < NARROW_WIDTH,
  );

  readonly steps = computed(() =>
    this.view().phases.map((phase) => ({
      phase,
      status: workflowStepStatus(this.view(), phase.number),
    })),
  );

  readonly visibleSteps = computed(() =>
    this.narrow()
      ? this.steps().filter((s) => s.phase.number === this.view().current)
      : this.steps(),
  );

  readonly total = computed(
    () => this.steps().filter((s) => s.status !== 'skipped').length,
  );
  readonly doneCount = computed(
    () => this.steps().filter((s) => s.status === 'done').length,
  );

  readonly currentTitle = computed(() => {
    const wf = this.view();
    const phase =
      wf.phases.find((p) => p.number === wf.current) ??
      this.steps().find((s) => s.status === 'upcoming')?.phase;
    return phase?.title ?? 'Not started';
  });

  /**
   * The action of the step to do next: the current step (current or
   * waiting), else, before the agent has marked one, the first open step.
   */
  readonly currentAction = computed(() => {
    const step =
      this.steps().find(
        (s) => s.status === 'current' || s.status === 'waiting',
      ) ?? this.steps().find((s) => s.status === 'upcoming');
    return step?.phase.action ?? null;
  });

  /** Every step is done or skipped: the workflow is finished. */
  readonly allDone = computed(
    () =>
      this.steps().length > 0 &&
      this.steps().every((s) => s.status === 'done' || s.status === 'skipped'),
  );

  readonly hasCard = computed(
    () => this.allDone() || !!this.view().note || !!this.currentAction(),
  );

  /** Tooltip of a step button. */
  tooltip(step: { phase: WorkflowPhase; status: WorkflowStepStatus }): string {
    if (step.status === 'waiting') return 'Waiting for you';
    if (step.status === 'upcoming' && step.phase.action) {
      return `To do: ${step.phase.action}`;
    }
    return step.phase.title;
  }

  /** The first line of the note as plain text, for the next-step row when no action is set. */
  readonly noteFirstLine = computed(() => {
    const line = (this.view().note ?? '')
      .split('\n')
      .map((l) => l.replace(/^\s*(?:#{1,6}|[-*+>]|\d+[.)])\s+/, '').trim())
      .find(Boolean);
    return (line ?? '').replace(/[*_`~]/g, '');
  });

  /** Text of the one-line next-step row after "Your next step:". */
  readonly nextStepText = computed(
    () => this.currentAction() ?? this.noteFirstLine(),
  );

  readonly popover = computed(() => {
    const number = this.popoverStep();
    if (number === null) return null;
    return this.steps().find((s) => s.phase.number === number) ?? null;
  });

  constructor() {
    // A workflow that goes away takes its details with it.
    effect(() => {
      if (!this.workflow()) this.detailsOpen.set(false);
    });
    // Keep the current step in view when the stepper overflows.
    effect(() => {
      void this.view().current;
      void this.visibleSteps();
      void this.collapsed();
      setTimeout(() => {
        this.measure();
        this.scrollCurrentIntoView();
      });
    });
    afterNextRender(() => {
      if (typeof ResizeObserver === 'undefined') return;
      this.observer = new ResizeObserver((entries) => {
        const w = entries[0]?.contentRect.width ?? 0;
        this.width.set(Math.round(w));
        this.measure();
      });
      this.observer.observe(this.host.nativeElement);
    });
  }

  ngOnDestroy(): void {
    this.observer?.disconnect();
  }

  /** True when the step list is wider than the room it has. Stubbed in tests. */
  protected overflows(): boolean {
    const el = this.list()?.nativeElement;
    return !!el && el.scrollWidth > el.clientWidth + 1;
  }

  /**
   * Lays the steps out in full, then icon-only for done and skipped steps if
   * that overflows, then adds the edge fade if it still does.
   */
  measure(): void {
    this.compact.set(false);
    this.fade.set(false);
    this.cdr.detectChanges();
    if (!this.overflows()) return;
    this.compact.set(true);
    this.cdr.detectChanges();
    if (this.overflows()) {
      this.fade.set(true);
      this.cdr.detectChanges();
    }
  }

  /** Done and skipped steps lose their title while the row overflows. */
  iconOnly(status: WorkflowStepStatus): boolean {
    return this.compact() && (status === 'done' || status === 'skipped');
  }

  label(status: WorkflowStepStatus): string {
    return STATUS_LABEL[status];
  }

  toggleCollapsed(): void {
    const next = !this.collapsed();
    this.collapsed.set(next);
    this.popoverStep.set(null);
    this.detailsOpen.set(false);
    try {
      localStorage.setItem(WORKFLOW_BAR_COLLAPSED_KEY, next ? '1' : '0');
    } catch {
      // Storage unavailable: the fold just isn't remembered.
    }
  }

  openStep(phase: WorkflowPhase): void {
    this.detailsOpen.set(false);
    this.popoverStep.set(
      this.popoverStep() === phase.number ? null : phase.number,
    );
  }

  @HostListener('document:keydown.escape')
  closePopover(): void {
    this.popoverStep.set(null);
    this.detailsOpen.set(false);
  }

  /** A click outside the Details panel and its buttons closes it. */
  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent): void {
    if (!this.detailsOpen()) return;
    const target = event.target as Element | null;
    if (target?.closest?.('[data-details-root]')) return;
    this.detailsOpen.set(false);
  }

  toggleDetails(): void {
    const open = !this.detailsOpen();
    this.popoverStep.set(null);
    this.detailsOpen.set(open);
    // Details opens on the current step, its note included.
    if (open) setTimeout(() => this.scrollDetailsToCurrent());
  }

  /**
   * Puts the current step just under the Details header. A spacer after
   * the list makes that reachable for the last steps too, so the steps
   * above it hide fully behind the header instead of showing half-cut.
   */
  private scrollDetailsToCurrent(): void {
    const details = this.host.nativeElement.querySelector<HTMLElement>(
      '[data-testid="workflow-details"]',
    );
    const current = details?.querySelector<HTMLElement>(
      '[data-current="true"]',
    );
    const header = details?.querySelector<HTMLElement>(
      '[data-testid="workflow-details-header"]',
    );
    const spacer = details?.querySelector<HTMLElement>(
      '[data-testid="workflow-details-spacer"]',
    );
    if (!details || !current || !header || !spacer) return;
    spacer.style.height = '0px';
    const gap = 8;
    const target = current.offsetTop - header.offsetHeight - gap;
    const max = details.scrollHeight - details.clientHeight;
    if (target > max) spacer.style.height = `${target - max}px`;
    details.scrollTop = Math.max(0, target);
  }

  private scrollCurrentIntoView(): void {
    const el = this.list()?.nativeElement.querySelector(
      '[aria-current="step"]',
    ) as HTMLElement | null;
    if (el && typeof el.scrollIntoView === 'function') {
      el.scrollIntoView({ inline: 'nearest', block: 'nearest' });
    }
  }
}

function readCollapsed(): boolean {
  try {
    return localStorage.getItem(WORKFLOW_BAR_COLLAPSED_KEY) === '1';
  } catch {
    return false;
  }
}
