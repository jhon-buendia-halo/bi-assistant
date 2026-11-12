import {
  Component,
  ElementRef,
  computed,
  effect,
  input,
  output,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import {
  Check,
  CircleX,
  LucideAngularModule,
  Loader2,
  Maximize,
  Square,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-angular';
import { WorkflowDetail, WorkflowRunStepStatus } from '../../models/workflow.model';
import {
  MAX_ZOOM,
  MIN_ZOOM,
  fitZoom,
  workflowCanvasLayout,
  zoomIn,
  zoomOut,
} from '../../services/workflow-canvas-layout';
import { runStepStatusLabel } from '../../services/workflows.util';

/** A drag shorter than this, in pixels, is a click on the background. */
const PAN_THRESHOLD = 3;

/**
 * The workflow designer's canvas (workflows R7, ui.md 4.4b): the graph from
 * Start to End on a dotted grid, nodes as buttons over an SVG layer of
 * connectors, a zoom toolbar at the top-left, panning by dragging the
 * background, and each step's run status while a run is shown. Read-only:
 * selecting a node only reports it.
 */
@Component({
  selector: 'app-workflow-canvas',
  imports: [LucideAngularModule],
  templateUrl: './workflow-canvas.html',
  styleUrl: './workflow-canvas.scss',
  host: { class: 'relative flex min-h-0 flex-col' },
})
export class WorkflowCanvas {
  protected readonly Check = Check;
  protected readonly CircleX = CircleX;
  protected readonly Loader2 = Loader2;
  protected readonly Maximize = Maximize;
  protected readonly Square = Square;
  protected readonly X = X;
  protected readonly ZoomIn = ZoomIn;
  protected readonly ZoomOut = ZoomOut;
  protected readonly MIN_ZOOM = MIN_ZOOM;
  protected readonly MAX_ZOOM = MAX_ZOOM;

  readonly workflow = input.required<WorkflowDetail>();
  readonly selectedId = input<string | null>(null);
  /** Each step's status in the run shown, by step id. */
  readonly statuses = input<Record<string, WorkflowRunStepStatus>>(
    {},
  );
  /** A node chosen (its step id), or null for a click on the background. */
  readonly selectStep = output<string | null>();

  private readonly viewport =
    viewChild.required<ElementRef<HTMLElement>>('viewport');

  protected readonly layout = computed(() =>
    workflowCanvasLayout(this.workflow().steps),
  );
  protected readonly lastConnector = computed(() => {
    const connectors = this.layout().connectors;
    return connectors[connectors.length - 1];
  });
  protected readonly steps = computed(() =>
    this.layout().nodes.filter((node) => node.kind === 'step'),
  );
  protected readonly start = computed(() => this.layout().nodes[0]);
  protected readonly end = computed(() => {
    const nodes = this.layout().nodes;
    return nodes[nodes.length - 1];
  });

  readonly zoom = signal(1);
  protected readonly zoomPercent = computed(
    () => `${Math.round(this.zoom() * 100)}%`,
  );
  protected readonly panning = signal(false);
  private pan: {
    x: number;
    y: number;
    left: number;
    top: number;
    moved: boolean;
  } | null = null;

  protected readonly statusLabel = runStepStatusLabel;

  constructor() {
    // Another workflow opens at 100%.
    effect(() => {
      this.workflow();
      untracked(() => this.zoom.set(1));
    });
  }

  protected status(id: string): WorkflowRunStepStatus | null {
    const statuses = this.statuses();
    return Object.hasOwn(statuses, id) ? statuses[id] : null;
  }

  /** The connector that ends on the given node (the one drawn above it). */
  protected connectorInto(index: number) {
    return this.layout().connectors[index];
  }

  protected zoomOut(): void {
    this.zoom.set(zoomOut(this.zoom()));
  }

  protected zoomIn(): void {
    this.zoom.set(zoomIn(this.zoom()));
  }

  /** The zoom at which the whole graph shows, between 75% and 150%. */
  protected fit(): void {
    const el = this.viewport().nativeElement;
    this.zoom.set(fitZoom(this.layout(), el.clientWidth, el.clientHeight));
  }

  protected onNodeClick(id: string): void {
    this.selectStep.emit(id);
  }

  protected onPointerDown(event: PointerEvent): void {
    if (event.button !== 0) return;
    if ((event.target as Element | null)?.closest('button')) return;
    const el = this.viewport().nativeElement;
    this.pan = {
      x: event.clientX,
      y: event.clientY,
      left: el.scrollLeft,
      top: el.scrollTop,
      moved: false,
    };
    try {
      el.setPointerCapture(event.pointerId);
    } catch {
      // A synthetic pointer has no capture; panning still follows moves.
    }
  }

  protected onPointerMove(event: PointerEvent): void {
    const pan = this.pan;
    if (pan === null) return;
    const dx = event.clientX - pan.x;
    const dy = event.clientY - pan.y;
    if (!pan.moved && Math.abs(dx) + Math.abs(dy) < PAN_THRESHOLD) return;
    pan.moved = true;
    this.panning.set(true);
    const el = this.viewport().nativeElement;
    el.scrollLeft = pan.left - dx;
    el.scrollTop = pan.top - dy;
  }

  /** The end of a drag; without a drag, a click on the background clears the selection. */
  protected onPointerUp(): void {
    const pan = this.pan;
    if (pan === null) return;
    this.pan = null;
    this.panning.set(false);
    if (!pan.moved) this.selectStep.emit(null);
  }

  protected onPointerCancel(): void {
    this.pan = null;
    this.panning.set(false);
  }
}
