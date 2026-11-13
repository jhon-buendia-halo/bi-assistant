import {
  Component,
  DestroyRef,
  ElementRef,
  afterNextRender,
  computed,
  inject,
  signal,
} from '@angular/core';
import { ChevronDown, ChevronRight, LucideAngularModule } from 'lucide-angular';
import { WorkflowDesigner } from '../../services/workflow-designer.service';
import {
  DOCK_KEY_STEP,
  LOGS_DOCK,
  dockBounds,
  dockSize,
  readDockRatio,
  writeDockRatio,
} from '../workflow-run-dock/workflow-run-dock.util';
import { WorkflowStatePanel } from '../workflow-state-panel/workflow-state-panel';

/**
 * The Logs under the canvas of a workflow's page (ui.md 4.4b), at the
 * canvas's full width: every node with its live state and the selected
 * node's data. Resizable by dragging its top edge (or the arrow keys on it),
 * it folds to its header; its height is kept as a share of the column it
 * shares with the canvas.
 */
@Component({
  selector: 'app-workflow-logs-dock',
  imports: [LucideAngularModule, WorkflowStatePanel],
  templateUrl: './workflow-logs-dock.html',
  styles: `
    :host {
      position: relative;
    }
    /* The top edge: a 10 px grab area, a 2 px line on hover, focus and drag. */
    .logs-dock-handle {
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
    .logs-dock-handle::after {
      position: absolute;
      left: 0;
      right: 0;
      top: 4px;
      height: 2px;
      content: '';
      background: transparent;
      transition: background-color 120ms ease;
    }
    .logs-dock-handle:hover::after,
    .logs-dock-handle:focus-visible::after,
    .logs-dock-handle-active::after {
      background: var(--qti-border-selected);
    }
    :host(.logs-dock-resizing),
    :host(.logs-dock-resizing) * {
      user-select: none !important;
    }
  `,
  host: {
    '[class.logs-dock-resizing]': 'resizing()',
    class: 'flex min-w-0 shrink-0 flex-col border-t border-border bg-surface',
    'data-testid': 'workflow-logs-dock',
    '[style.height.px]': 'open() ? height() : null',
  },
})
export class WorkflowLogsDock {
  protected readonly ChevronDown = ChevronDown;
  protected readonly ChevronRight = ChevronRight;

  protected readonly designer = inject(WorkflowDesigner);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  /** Unfolded by default; folded, only the header shows. */
  readonly open = signal(true);
  /** The column height the canvas and the Logs share, measured. */
  private readonly room = signal(0);
  private readonly ratio = signal(readDockRatio(LOGS_DOCK));
  protected readonly resizing = signal(false);

  protected readonly bounds = computed(() =>
    dockBounds(this.room(), LOGS_DOCK),
  );
  protected readonly height = computed(() =>
    dockSize(this.room(), this.ratio(), false, LOGS_DOCK),
  );
  protected readonly progressLine = computed(() => {
    const { ran, total } = this.designer.stateSummary();
    return `${ran} of ${total} nodes ran`;
  });

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

  protected toggle(): void {
    this.open.update((open) => !open);
  }

  /** Dragging the top edge sets the height (and its share, on release). */
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
      writeDockRatio(LOGS_DOCK, this.ratio());
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
    writeDockRatio(LOGS_DOCK, this.ratio());
  }

  /** Double-click on the edge: back to the default share. */
  protected resetHeight(): void {
    this.ratio.set(LOGS_DOCK.defaultRatio);
    writeDockRatio(LOGS_DOCK, LOGS_DOCK.defaultRatio);
  }

  private setHeight(px: number): void {
    const room = this.room();
    if (room <= 0) return;
    const { min, max } = this.bounds();
    this.ratio.set(Math.min(max, Math.max(min, px)) / room);
  }
}
