import {
  Component,
  DestroyRef,
  ElementRef,
  afterNextRender,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import {
  Braces,
  Check,
  CircleAlert,
  CircleX,
  Cpu,
  Ellipsis,
  Flag,
  LucideAngularModule,
  Loader2,
  LucideIconData,
  Maximize,
  Minus,
  Play,
  RotateCcw,
  Sparkles,
  Square,
  Wrench,
  X,
  Zap,
  ZoomIn,
  ZoomOut,
} from 'lucide-angular';
import { WorkflowDetail } from '../../models/workflow.model';
import { WorkflowNodeStatus } from '../../models/workflow-node.model';
import { ContractSide } from '../../services/workflow-contract';
import {
  CanvasEdge,
  CanvasNode,
  CanvasNodeKind,
  CanvasSubNode,
  MAX_ZOOM,
  MIN_ZOOM,
  fitZoom,
  workflowCanvasLayout,
  zoomIn,
  zoomOut,
} from '../../services/workflow-canvas-layout';
import { nodeStatusLabel } from '../../services/workflows.util';

/** A drag shorter than this, in pixels, is a click on the background. */
const PAN_THRESHOLD = 3;

const NODE_ICONS: Record<CanvasNodeKind, LucideIconData> = {
  trigger: Zap,
  code: Braces,
  agent: Sparkles,
  output: Flag,
};

const SUB_ICONS: Record<CanvasSubNode['kind'], LucideIconData> = {
  model: Cpu,
  tool: Wrench,
  more: Ellipsis,
};

const STATUS_ICONS: Record<WorkflowNodeStatus, LucideIconData> = {
  invalid: CircleAlert,
  success: Check,
  failed: X,
  running: Loader2,
  skipped: Minus,
  stopped: Square,
};

/**
 * The workflow page's n8n-style canvas (workflows R7, ui.md 4.4b): Start, the
 * steps and End left to right on a dotted grid, nodes as buttons over an SVG
 * layer of edges, an agent step's model and tools hanging below it, a zoom
 * toolbar at the bottom-left and Execute workflow at the top-right. Fits the
 * graph on load and on resize until the user zooms by hand; dragging the
 * background pans. Read-only: it only reports what was chosen.
 */
@Component({
  selector: 'app-workflow-canvas',
  imports: [LucideAngularModule],
  templateUrl: './workflow-canvas.html',
  styleUrl: './workflow-canvas.scss',
  host: { class: 'relative flex min-h-0 flex-col' },
})
export class WorkflowCanvas {
  protected readonly CircleX = CircleX;
  protected readonly Maximize = Maximize;
  protected readonly Play = Play;
  protected readonly RotateCcw = RotateCcw;
  protected readonly Square = Square;
  protected readonly ZoomIn = ZoomIn;
  protected readonly ZoomOut = ZoomOut;
  protected readonly MIN_ZOOM = MIN_ZOOM;
  protected readonly MAX_ZOOM = MAX_ZOOM;
  protected readonly nodeIcons = NODE_ICONS;
  protected readonly subIcons = SUB_ICONS;
  protected readonly statusIcons = STATUS_ICONS;
  protected readonly statusLabel = nodeStatusLabel;

  readonly workflow = input.required<WorkflowDetail>();
  /** The selected node: `start`, `end` or a step id. */
  readonly selectedId = input<string | null>(null);
  /** Each node's status in the run shown, by node id (incl. `start` / `end`); Start may be `invalid`. */
  readonly statuses = input<Record<string, WorkflowNodeStatus>>({});
  /**
   * The steps that failed on a contract violation, by id, with the side it
   * broke on: the edge into an input violation, or out of an output one, is
   * marked.
   */
  readonly violations = input<Record<string, ContractSide>>({});
  /** A node chosen by a single click, or null for a click on the background. */
  readonly selectNode = output<string | null>();
  /** Open a node's details: double click or Enter, or a click on an agent's sub-node (its step id). */
  readonly openNode = output<string>();
  /** The Execute workflow button. */
  readonly execute = output<void>();

  private readonly viewport =
    viewChild.required<ElementRef<HTMLElement>>('viewport');

  protected readonly layout = computed(() =>
    workflowCanvasLayout(this.workflow()),
  );

  readonly zoom = signal(1);
  /** Fit on load and on resize, until the user zooms by hand. */
  readonly autoFit = signal(true);
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
  private rendered = false;

  constructor() {
    const destroyRef = inject(DestroyRef);
    afterNextRender(() => {
      this.rendered = true;
      this.fitIfAuto();
      if (typeof ResizeObserver === 'undefined') return;
      const observer = new ResizeObserver(() => this.fitIfAuto());
      observer.observe(this.viewport().nativeElement);
      destroyRef.onDestroy(() => observer.disconnect());
    });
    // Another workflow fits again.
    effect(() => {
      this.layout();
      untracked(() => {
        this.autoFit.set(true);
        if (this.rendered) this.fitIfAuto();
      });
    });
  }

  protected status(id: string): WorkflowNodeStatus | null {
    const statuses = this.statuses();
    return Object.hasOwn(statuses, id) ? statuses[id] : null;
  }

  /** An edge is done once the node it leaves succeeded. */
  protected done(id: string): boolean {
    return this.status(id) === 'success';
  }

  /** The edge carries the data that broke a step's contract. */
  protected violated(edge: CanvasEdge): boolean {
    const violations = this.violations();
    return (
      (Object.hasOwn(violations, edge.to) && violations[edge.to] === 'input') ||
      (Object.hasOwn(violations, edge.from) &&
        violations[edge.from] === 'output')
    );
  }

  /** The edge label's title and screen-reader text. */
  protected edgeText(edge: CanvasEdge): string {
    return this.violated(edge)
      ? `${edge.passesOn}. Contract violation`
      : edge.passesOn;
  }

  protected subNodeLabel(node: CanvasNode, sub: CanvasSubNode): string {
    const what =
      sub.kind === 'model'
        ? 'Model'
        : sub.kind === 'tool'
          ? 'Tool'
          : 'More tools:';
    return `${what} ${sub.label} of ${node.title}`;
  }

  protected zoomOut(): void {
    this.setZoom(zoomOut(this.zoom()));
  }

  protected zoomIn(): void {
    this.setZoom(zoomIn(this.zoom()));
  }

  protected resetZoom(): void {
    this.setZoom(1);
  }

  /** Fit to screen, and keep fitting on resize. */
  protected fit(): void {
    this.autoFit.set(true);
    this.applyFit();
  }

  private setZoom(zoom: number): void {
    this.autoFit.set(false);
    this.zoom.set(zoom);
  }

  private fitIfAuto(): void {
    if (this.autoFit()) this.applyFit();
  }

  private applyFit(): void {
    const el = this.viewport().nativeElement;
    // Hidden (no size yet): keep the zoom until it shows.
    if (!el.clientWidth || !el.clientHeight) return;
    this.zoom.set(fitZoom(this.layout(), el.clientWidth, el.clientHeight));
  }

  protected onNodeClick(id: string): void {
    this.selectNode.emit(id);
  }

  protected onNodeDblClick(id: string): void {
    this.openNode.emit(id);
  }

  /** Enter opens, as a double click does; the button's own click would only select. */
  protected onNodeEnter(event: Event, id: string): void {
    event.preventDefault();
    this.selectNode.emit(id);
    this.openNode.emit(id);
  }

  /**
   * A tool sub-node opens that tool's details (its own id); the Model and
   * `+<n> tools` sub-nodes open their agent step's. Enter and a double click
   * click the button too.
   */
  protected onSubNodeClick(stepId: string, sub: CanvasSubNode): void {
    this.openNode.emit(sub.kind === 'tool' ? sub.id : stepId);
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
    if (!pan.moved) this.selectNode.emit(null);
  }

  protected onPointerCancel(): void {
    this.pan = null;
    this.panning.set(false);
  }
}
