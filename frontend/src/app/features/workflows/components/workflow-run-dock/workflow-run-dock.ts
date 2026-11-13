import {
  Component,
  DestroyRef,
  ElementRef,
  afterNextRender,
  computed,
  inject,
  signal,
} from '@angular/core';
import {
  ChevronDown,
  ChevronRight,
  LucideAngularModule,
  Maximize2,
  Minimize2,
} from 'lucide-angular';
import { WorkflowDesigner } from '../../services/workflow-designer.service';
import {
  activityLine,
  progressSteps,
} from '../../services/workflow-run-progress';
import { formatNodeDuration } from '../workflow-node-dialog/workflow-node-format';
import { WorkflowRunActivity } from '../workflow-run-activity/workflow-run-activity';
import { WorkflowRunChat } from '../workflow-run-chat/workflow-run-chat';
import { WorkflowStatePanel } from '../workflow-state-panel/workflow-state-panel';
import {
  DOCK_DEFAULT_RATIO,
  DOCK_KEY_STEP,
  dockBounds,
  dockHeight,
  readDockRatio,
  writeDockRatio,
} from './workflow-run-dock.util';

/**
 * The Run panel under the canvas of a workflow's page (n8n-style; ui.md
 * 4.4b): a header with the run's summary and live activity, then the Chat
 * (question, answer, composer), the Logs (every node, live) and the selected
 * node's data side by side. It is resizable by dragging its top edge (or
 * the arrow keys on it), maximizable, and folds to its header; its height is
 * kept as a share of the page. The app's right panel is not used here.
 */
@Component({
  selector: 'app-workflow-run-dock',
  imports: [
    LucideAngularModule,
    WorkflowRunActivity,
    WorkflowRunChat,
    WorkflowStatePanel,
  ],
  templateUrl: './workflow-run-dock.html',
  styles: `
    :host {
      position: relative;
    }
    /* The top edge: a 10 px grab area, a 2 px line on hover, focus and drag. */
    .run-dock-handle {
      position: absolute;
      z-index: 30;
      top: -5px;
      left: 0;
      right: 0;
      height: 10px;
      cursor: row-resize;
      touch-action: none;
      outline: none;
    }
    .run-dock-handle::after {
      position: absolute;
      left: 0;
      right: 0;
      top: 4px;
      height: 2px;
      content: '';
      background: transparent;
      transition: background-color 120ms ease;
    }
    .run-dock-handle:hover::after,
    .run-dock-handle:focus-visible::after,
    .run-dock-handle-active::after {
      background: var(--qti-border-selected);
    }
    :host(.run-dock-resizing),
    :host(.run-dock-resizing) * {
      user-select: none !important;
    }
  `,
  host: {
    '[class.run-dock-resizing]': 'resizing()',
    class: 'flex shrink-0 flex-col border-t border-border bg-surface',
    'data-testid': 'workflow-run-dock',
    '[style.height.px]': 'designer.stateOpen() ? height() : null',
  },
})
export class WorkflowRunDock {
  protected readonly ChevronDown = ChevronDown;
  protected readonly ChevronRight = ChevronRight;
  protected readonly Maximize2 = Maximize2;
  protected readonly Minimize2 = Minimize2;

  protected readonly designer = inject(WorkflowDesigner);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  /** The page room the canvas and the dock share, measured. */
  private readonly room = signal(0);
  /** The dock's share of that room, as last dragged (kept across pages). */
  private readonly ratio = signal(readDockRatio());
  protected readonly maximized = signal(false);
  protected readonly resizing = signal(false);

  protected readonly bounds = computed(() => dockBounds(this.room()));
  protected readonly height = computed(() =>
    dockHeight(this.room(), this.ratio(), this.maximized()),
  );

  constructor() {
    const destroyRef = inject(DestroyRef);
    afterNextRender(() => {
      const parent = this.host.nativeElement.parentElement;
      if (parent === null) return;
      this.room.set(parent.clientHeight);
      if (typeof ResizeObserver === 'undefined') return;
      const observer = new ResizeObserver(() =>
        this.room.set(parent.clientHeight),
      );
      observer.observe(parent);
      destroyRef.onDestroy(() => observer.disconnect());
    });
  }

  /** The run's steps in path order with their state, for the activity line. */
  private readonly progress = computed(() => {
    const workflow = this.designer.workflow();
    const result = this.designer.runResult();
    return workflow === null || result === null
      ? []
      : progressSteps(workflow, result);
  });

  /** What the run is doing now; null when it neither runs nor waits. */
  protected readonly activity = computed(() => {
    const result = this.designer.runResult();
    return result === null
      ? null
      : activityLine(this.progress(), result.status, this.designer.toolCalls());
  });

  protected readonly summary = this.designer.stateSummary;
  protected readonly duration = formatNodeDuration;

  protected readonly progressLine = computed(
    () => `${this.summary().ran} of ${this.summary().total} nodes ran`,
  );
  /** `Input invalid: <n> field(s)` after a refused Execute; null otherwise. */
  protected readonly invalidLine = computed(() => {
    const n = this.summary().invalidFields;
    return n > 0 ? `Input invalid: ${n} ${n === 1 ? 'field' : 'fields'}` : null;
  });
  protected readonly pill = computed(() => {
    const status = this.summary().status;
    if (!status) return null;
    const chip =
      status === 'success'
        ? 'chip chip-success'
        : status === 'failed'
          ? 'chip chip-danger'
          : status === 'stopped' || status === 'suspended'
            ? 'chip chip-warning'
            : 'chip chip-info';
    return {
      label: status === 'suspended' ? 'Waiting for you' : status,
      chip,
    };
  });

  protected toggle(): void {
    this.designer.stateOpen.update((open) => !open);
  }

  /** Maximize: the canvas keeps its minimum; again restores the dragged height. */
  protected toggleMaximized(): void {
    this.designer.stateOpen.set(true);
    this.maximized.update((max) => !max);
  }

  /** Dragging the top edge sets the dock's height (and its share, on release). */
  protected startResize(event: PointerEvent): void {
    const parent = this.host.nativeElement.parentElement;
    if (parent === null || event.button !== 0) return;
    event.preventDefault();
    const handle = event.target as HTMLElement;
    handle.setPointerCapture?.(event.pointerId);
    this.resizing.set(true);
    const move = (e: PointerEvent) => {
      const rect = parent.getBoundingClientRect();
      this.setHeight(rect.bottom - e.clientY);
    };
    const up = () => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', up);
      handle.removeEventListener('pointercancel', up);
      this.resizing.set(false);
      writeDockRatio(this.ratio());
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', up);
    handle.addEventListener('pointercancel', up);
  }

  /** Arrow Up / Down grow or shrink it by a step; Home and End go to the bounds. */
  protected resizeWithKeyboard(event: KeyboardEvent): void {
    const { min, max } = this.bounds();
    const now = this.height();
    const next =
      event.key === 'ArrowUp'
        ? now + DOCK_KEY_STEP
        : event.key === 'ArrowDown'
          ? now - DOCK_KEY_STEP
          : event.key === 'Home'
            ? max
            : event.key === 'End'
              ? min
              : null;
    if (next === null) return;
    event.preventDefault();
    this.setHeight(next);
    writeDockRatio(this.ratio());
  }

  /** Double-click on the edge: back to the default share. */
  protected resetHeight(): void {
    this.maximized.set(false);
    this.ratio.set(DOCK_DEFAULT_RATIO);
    writeDockRatio(DOCK_DEFAULT_RATIO);
  }

  private setHeight(px: number): void {
    const room = this.room();
    if (room <= 0) return;
    const { min, max } = this.bounds();
    this.maximized.set(false);
    this.ratio.set(Math.min(max, Math.max(min, px)) / room);
  }
}
