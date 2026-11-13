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
  Hourglass,
  Cpu,
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
import {
  WorkflowNodeStatus,
  toolNodeId,
} from '../../models/workflow-node.model';
import { ContractSide } from '../../services/workflow-contract';
import {
  CANVAS,
  CanvasEdge,
  CanvasNode,
  CanvasNodeKind,
  CanvasSubNode,
  MAX_ZOOM,
  MIN_ZOOM,
  agentLineParts,
  fitZoom,
  subLabelWidth,
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
  tools: Wrench,
};

/** The Tools sub-node's open list: its step, the tools and where it shows in the host. */
interface ToolsMenu {
  stepId: string;
  stepTitle: string;
  tools: string[];
  left: number;
  top: number;
  /** Opens above the sub-node when there is no room below it. */
  above: boolean;
}

/** A menu row's height and the menu's padding, to decide above or below. */
const MENU_ROW = 32;
const MENU_PAD = 10;
/** Between the sub-node and its menu. */
const MENU_GAP = 6;

const STATUS_ICONS: Record<WorkflowNodeStatus, LucideIconData> = {
  invalid: CircleAlert,
  success: Check,
  failed: X,
  running: Loader2,
  skipped: Minus,
  stopped: Square,
  suspended: Hourglass,
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
  host: {
    class: 'relative flex min-h-0 flex-col',
    '(document:pointerdown)': 'onDocumentPointerDown($event)',
  },
})
export class WorkflowCanvas {
  protected readonly CircleX = CircleX;
  protected readonly Maximize = Maximize;
  protected readonly Play = Play;
  protected readonly RotateCcw = RotateCcw;
  protected readonly Square = Square;
  protected readonly Hourglass = Hourglass;
  protected readonly ZoomIn = ZoomIn;
  protected readonly ZoomOut = ZoomOut;
  protected readonly Wrench = Wrench;
  protected readonly subLabelWidth = subLabelWidth;
  protected readonly agentLineParts = agentLineParts;
  protected readonly MIN_ZOOM = MIN_ZOOM;
  /** A square node's label box. */
  protected readonly labelWidth = CANVAS.labelWidth;
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
  /** How many times each step ran in the run shown, for a step that ran more than once (a loop's retry). */
  readonly attempts = input<Record<string, number>>({});
  /** A node chosen by a single click, or null for a click on the background. */
  readonly selectNode = output<string | null>();
  /** Open a node's details: double click or Enter, or a click on an agent's sub-node (its step id). */
  readonly openNode = output<string>();
  /** The Execute workflow button. */
  readonly execute = output<void>();

  private readonly viewport =
    viewChild.required<ElementRef<HTMLElement>>('viewport');
  private readonly menuEl = viewChild<ElementRef<HTMLElement>>('toolsMenu');
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  /** The Tools sub-node's list, while open. */
  protected readonly toolsMenu = signal<ToolsMenu | null>(null);
  /** The Tools sub-node that opened the list: the focus goes back to it. */
  private menuTrigger: HTMLElement | null = null;

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

  /** A step the run skipped (the branch not taken, or after a failure): drawn muted. */
  protected skipped(id: string): boolean {
    return this.status(id) === 'skipped';
  }

  /** How many times a step ran, when more than once; else null. */
  protected attemptCount(id: string): number | null {
    const attempts = this.attempts();
    return Object.hasOwn(attempts, id) && attempts[id] > 1 ? attempts[id] : null;
  }

  /** An edge into or out of a skipped step is muted. */
  protected edgeSkipped(edge: CanvasEdge): boolean {
    return this.skipped(edge.from) || this.skipped(edge.to);
  }

  /**
   * An edge was followed: the node it leaves succeeded and the one it enters
   * was not skipped; a loop, only once the step it goes back to ran again.
   */
  protected edgeDone(edge: CanvasEdge): boolean {
    if (!this.done(edge.from) || this.edgeSkipped(edge)) return false;
    return edge.kind !== 'loop' || (this.attemptCount(edge.to) ?? 1) > 1;
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
    return sub.kind === 'model'
      ? `Model ${sub.label} of ${node.title}`
      : `Tools of ${node.title}: ${sub.subtitle}`;
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
    this.closeToolsMenu(false);
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
    const zoom = fitZoom(this.layout(), el.clientWidth, el.clientHeight);
    if (zoom !== this.zoom()) this.closeToolsMenu(false);
    this.zoom.set(zoom);
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
   * The Model sub-node opens its agent step's details; the Tools sub-node
   * opens the list of its tools (a click, Enter or a double click).
   */
  protected onSubNodeClick(
    node: CanvasNode,
    sub: CanvasSubNode,
    event: Event,
  ): void {
    if (sub.kind === 'model') {
      this.openNode.emit(node.id);
      return;
    }
    this.openToolsMenu(node, sub, event.currentTarget as HTMLElement);
  }

  /** The list under the Tools sub-node (above it near the window's bottom), its first tool focused. */
  private openToolsMenu(
    node: CanvasNode,
    sub: CanvasSubNode,
    trigger: HTMLElement,
  ): void {
    const host = this.host.nativeElement.getBoundingClientRect();
    const r = trigger.getBoundingClientRect();
    const height = sub.tools.length * MENU_ROW + MENU_PAD;
    // It may run past the canvas; above only when it would leave the window.
    const above =
      r.bottom + MENU_GAP + height > window.innerHeight &&
      r.top - MENU_GAP - height >= 0;
    this.menuTrigger = trigger;
    this.toolsMenu.set({
      stepId: node.id,
      stepTitle: node.title,
      tools: sub.tools,
      left: r.left + r.width / 2 - host.left,
      top: above ? r.top - host.top - MENU_GAP : r.bottom - host.top + MENU_GAP,
      above,
    });
    setTimeout(() => this.menuItems()[0]?.focus());
  }

  private menuItems(): HTMLElement[] {
    const menu = this.menuEl()?.nativeElement;
    return menu
      ? Array.from(menu.querySelectorAll<HTMLElement>('[role="menuitem"]'))
      : [];
  }

  /** Close the list; the focus goes back to its Tools sub-node when asked. */
  protected closeToolsMenu(refocus: boolean): void {
    if (this.toolsMenu() === null) return;
    this.toolsMenu.set(null);
    const trigger = this.menuTrigger;
    this.menuTrigger = null;
    if (refocus) trigger?.focus();
  }

  /** A tool picked from the list opens that tool's details. */
  protected chooseTool(stepId: string, tool: string): void {
    this.closeToolsMenu(false);
    this.openNode.emit(toolNodeId(stepId, tool));
  }

  /** Arrow keys, Home and End move through the list; Escape and Tab close it. */
  protected onMenuKeydown(event: KeyboardEvent): void {
    const items = this.menuItems();
    const at = items.indexOf(document.activeElement as HTMLElement);
    const move = (i: number) => {
      event.preventDefault();
      items[(i + items.length) % items.length]?.focus();
    };
    switch (event.key) {
      case 'ArrowDown':
        return move(at + 1);
      case 'ArrowUp':
        return move(at < 0 ? items.length - 1 : at - 1);
      case 'Home':
        return move(0);
      case 'End':
        return move(items.length - 1);
      case 'Escape':
      case 'Tab':
        event.preventDefault();
        event.stopPropagation();
        this.closeToolsMenu(true);
    }
  }

  /** A press outside the list and its sub-node closes it. */
  protected onDocumentPointerDown(event: Event): void {
    if (this.toolsMenu() === null) return;
    const target = event.target as Node | null;
    if (
      target &&
      (this.menuEl()?.nativeElement.contains(target) ||
        this.menuTrigger?.contains(target))
    ) {
      return;
    }
    this.closeToolsMenu(false);
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
