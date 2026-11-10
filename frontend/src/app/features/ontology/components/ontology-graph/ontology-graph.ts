import {
  Component,
  ElementRef,
  computed,
  input,
  linkedSignal,
  output,
  signal,
  viewChild,
} from '@angular/core';
import {
  LucideAngularModule,
  Globe,
  Maximize2,
  Minus,
  Network,
  Pencil,
  Plus,
  Sparkles,
  X,
} from 'lucide-angular';
import {
  OntologyItem,
  RELATION_TYPES,
  RelationType,
  mappingLabel,
} from '../../models/ontology.model';
import {
  GraphMetric,
  OntologyGraph as OntologyGraphData,
  OntologyGraphEdge,
  OntologyGraphNode,
  Point,
  ViewBox,
  buildOntologyGraph,
  edgeGeometries,
  fitViewBox,
  layoutOntologyGraph,
} from './ontology-graph.layout';

type Selection = { type: 'node' | 'edge'; id: string } | null;

interface Drag {
  mode: 'pan' | 'node';
  nodeId?: string;
  pointerId: number;
  startClient: Point;
  lastClient: Point;
  /** Node drag: node centre minus the pointer, in SVG units, at the press. */
  grab: Point;
  moved: boolean;
}

const ZOOM_STEP = 1.25;
const MIN_ZOOM_W = 120;
const MAX_ZOOM_W = 6000;
/** Pointer travel (px) after which a press counts as a drag, not a click. */
const DRAG_THRESHOLD = 4;
let instanceCount = 0;

/**
 * The Ontology tab's relations graph (1.21.10): concepts and the metrics they
 * are measured by as nodes, relations as labelled arrows. Pan, zoom, drag a
 * node, select one to trace its neighbours and edit it.
 */
@Component({
  selector: 'app-ontology-graph',
  imports: [LucideAngularModule],
  templateUrl: './ontology-graph.html',
  styleUrl: './ontology-graph.scss',
  host: { class: 'block' },
})
export class OntologyGraph {
  readonly Globe = Globe;
  readonly Maximize2 = Maximize2;
  readonly Minus = Minus;
  readonly Network = Network;
  readonly Pencil = Pencil;
  readonly Plus = Plus;
  readonly Sparkles = Sparkles;
  readonly X = X;

  /** Arrow marker ids must be unique per page, not per component. */
  readonly markerId = `ontology-graph-${++instanceCount}-arrow-`;

  /** Concepts and relations of the dataset, shared ones included. */
  readonly items = input.required<OntologyItem[]>();
  readonly metrics = input<GraphMetric[]>([]);
  /** The item to open in the editor (concepts and relations only). */
  readonly edit = output<OntologyItem>();

  private readonly svg = viewChild<ElementRef<SVGSVGElement>>('svg');

  readonly graph = computed(() => buildOntologyGraph(this.items(), this.metrics()));

  /** The simulation's result — recomputed only when the inputs change. */
  private readonly baseLayout = computed(() => layoutOntologyGraph(this.graph()));

  /** Laid-out positions; a dragged node overrides its own until items change. */
  readonly positions = linkedSignal(() => this.baseLayout());

  /** The camera: fitted to the layout, then moved by pan and zoom. */
  readonly viewBox = linkedSignal<ViewBox>(() =>
    fitViewBox(this.graph().nodes, this.baseLayout()),
  );
  readonly viewBoxAttr = computed(() => {
    const v = this.viewBox();
    return `${v.x} ${v.y} ${v.w} ${v.h}`;
  });

  readonly geometries = computed(() => edgeGeometries(this.graph(), this.positions()));

  /** Cleared whenever the drawn graph changes. */
  readonly selection = linkedSignal<OntologyGraphData, Selection>({
    source: this.graph,
    computation: () => null,
  });

  readonly conceptCount = computed(
    () => this.graph().nodes.filter((n) => n.kind === 'concept').length,
  );

  readonly summaryLabel = computed(() => {
    const concepts = this.conceptCount();
    const relations = this.graph().edges.length;
    const metrics = this.graph().nodes.length - concepts;
    const parts = [
      `${concepts} concept${concepts === 1 ? '' : 's'}`,
      `${relations} relation${relations === 1 ? '' : 's'}`,
    ];
    if (metrics) parts.push(`${metrics} metric${metrics === 1 ? '' : 's'}`);
    return `Ontology relations graph: ${parts.join(', ')}`;
  });

  /** Relation types drawn, in the contract's order, for the legend. */
  readonly typesPresent = computed(() => {
    const present = new Set(this.graph().edges.map((e) => e.type));
    return RELATION_TYPES.filter((t) => present.has(t));
  });

  readonly hasFaded = computed(
    () =>
      this.graph().nodes.some((n) => n.faded) || this.graph().edges.some((e) => e.faded),
  );
  readonly hasMetrics = computed(() => this.graph().nodes.some((n) => n.kind === 'metric'));

  /** Ids of the selection, its neighbours and the edges between them. */
  readonly highlighted = computed<Set<string> | null>(() => {
    const sel = this.selection();
    if (!sel) return null;
    const set = new Set<string>([sel.id]);
    const { edges } = this.graph();
    if (sel.type === 'node') {
      for (const e of edges) {
        if (e.from === sel.id || e.to === sel.id) {
          set.add(e.id);
          set.add(e.from);
          set.add(e.to);
        }
      }
    } else {
      const edge = edges.find((e) => e.id === sel.id);
      if (edge) {
        set.add(edge.from);
        set.add(edge.to);
      }
    }
    return set;
  });

  readonly selectedNode = computed<OntologyGraphNode | null>(() => {
    const sel = this.selection();
    return sel?.type === 'node'
      ? (this.graph().nodes.find((n) => n.id === sel.id) ?? null)
      : null;
  });

  readonly selectedEdge = computed<OntologyGraphEdge | null>(() => {
    const sel = this.selection();
    return sel?.type === 'edge'
      ? (this.graph().edges.find((e) => e.id === sel.id) ?? null)
      : null;
  });

  /** The ontology item behind the selection, if it can be edited. */
  readonly selectedItem = computed<OntologyItem | null>(
    () => this.selectedNode()?.item ?? this.selectedEdge()?.item ?? null,
  );

  private drag: Drag | null = null;
  /** Swallows the click that ends a drag. */
  private suppressClick = false;

  isDimmed(id: string): boolean {
    const set = this.highlighted();
    return !!set && !set.has(id);
  }

  isActive(id: string): boolean {
    return !!this.highlighted()?.has(id);
  }

  position(id: string): Point {
    return this.positions().get(id) ?? { x: 0, y: 0 };
  }

  nodeTransform(node: OntologyGraphNode): string {
    const p = this.position(node.id);
    return `translate(${(p.x - node.width / 2).toFixed(1)} ${(p.y - node.height / 2).toFixed(1)})`;
  }

  nodeName(id: string): string {
    return this.graph().nodes.find((n) => n.id === id)?.label ?? '';
  }

  nodeAriaLabel(node: OntologyGraphNode): string {
    const kind = node.kind === 'metric' ? 'Metric' : 'Concept';
    const states = [
      node.faded ? (node.item?.source === 'mined' ? 'pending' : 'disabled') : '',
      node.shared ? 'all datasets' : '',
    ].filter(Boolean);
    return `${kind} ${node.label}${states.length ? ` (${states.join(', ')})` : ''}`;
  }

  edgeSentence(edge: OntologyGraphEdge): string {
    return `${this.nodeName(edge.from)} ${edge.type} ${this.nodeName(edge.to)}`;
  }

  edgeAriaLabel(edge: OntologyGraphEdge): string {
    return `Relation ${this.edgeSentence(edge)}${edge.faded ? ' (disabled)' : ''}`;
  }

  mappingsSummary(item: OntologyItem): string {
    return (item.mappings ?? []).map(mappingLabel).join(', ');
  }

  typeClass(type: RelationType): string {
    return `type-${type}`;
  }

  /* ---- Selection ---- */

  select(type: 'node' | 'edge', id: string, event?: Event): void {
    event?.stopPropagation();
    if (this.suppressClick) {
      this.suppressClick = false;
      return;
    }
    const sel = this.selection();
    this.selection.set(sel?.type === type && sel.id === id ? null : { type, id });
  }

  onKeySelect(type: 'node' | 'edge', id: string, event: Event): void {
    event.preventDefault();
    event.stopPropagation();
    this.selection.set({ type, id });
  }

  clearSelection(): void {
    this.selection.set(null);
  }

  onBackgroundClick(): void {
    if (this.suppressClick) {
      this.suppressClick = false;
      return;
    }
    this.clearSelection();
  }

  emitEdit(): void {
    const item = this.selectedItem();
    if (item) this.edit.emit(item);
  }

  /* ---- Zoom ---- */

  zoomIn(): void {
    this.zoomAt(1 / ZOOM_STEP);
  }

  zoomOut(): void {
    this.zoomAt(ZOOM_STEP);
  }

  fit(): void {
    this.viewBox.set(fitViewBox(this.graph().nodes, this.positions()));
  }

  onWheel(event: WheelEvent): void {
    event.preventDefault();
    const factor = event.deltaY > 0 ? ZOOM_STEP : 1 / ZOOM_STEP;
    this.zoomAt(factor, this.toSvgPoint(event.clientX, event.clientY));
  }

  /** Scale the viewBox by `factor` (> 1 zooms out) around `anchor`. */
  private zoomAt(factor: number, anchor?: Point): void {
    const v = this.viewBox();
    const w = v.w * factor;
    if (w < MIN_ZOOM_W || w > MAX_ZOOM_W) return;
    const h = v.h * factor;
    const ax = anchor?.x ?? v.x + v.w / 2;
    const ay = anchor?.y ?? v.y + v.h / 2;
    this.viewBox.set({
      x: ax - (ax - v.x) * factor,
      y: ay - (ay - v.y) * factor,
      w,
      h,
    });
  }

  onSvgKeydown(event: KeyboardEvent): void {
    const v = this.viewBox();
    const step = v.w * 0.1;
    const pans: Record<string, Point> = {
      ArrowLeft: { x: -step, y: 0 },
      ArrowRight: { x: step, y: 0 },
      ArrowUp: { x: 0, y: -step },
      ArrowDown: { x: 0, y: step },
    };
    if (event.key === 'Escape') {
      this.clearSelection();
    } else if (event.key === '+' || event.key === '=') {
      this.zoomIn();
    } else if (event.key === '-') {
      this.zoomOut();
    } else if (pans[event.key]) {
      // Only pan when the canvas itself has focus, not a node.
      if (event.target !== event.currentTarget) return;
      const d = pans[event.key];
      this.viewBox.set({ ...v, x: v.x + d.x, y: v.y + d.y });
    } else {
      return;
    }
    event.preventDefault();
  }

  /* ---- Pan and node drag ---- */

  onPointerDown(event: PointerEvent, nodeId?: string): void {
    if (event.button !== 0) return;
    event.stopPropagation();
    this.suppressClick = false;
    const pointer = this.toSvgPoint(event.clientX, event.clientY);
    const center = nodeId ? this.position(nodeId) : pointer;
    this.drag = {
      mode: nodeId ? 'node' : 'pan',
      nodeId,
      pointerId: event.pointerId,
      startClient: { x: event.clientX, y: event.clientY },
      lastClient: { x: event.clientX, y: event.clientY },
      grab: { x: center.x - pointer.x, y: center.y - pointer.y },
      moved: false,
    };
  }

  onPointerMove(event: PointerEvent): void {
    const drag = this.drag;
    if (!drag || drag.pointerId !== event.pointerId) return;
    if (
      !drag.moved &&
      Math.hypot(event.clientX - drag.startClient.x, event.clientY - drag.startClient.y) <
        DRAG_THRESHOLD
    ) {
      return;
    }
    if (!drag.moved) {
      drag.moved = true;
      // Capture only once it is a drag, so a plain click keeps its target.
      try {
        this.svg()?.nativeElement.setPointerCapture?.(event.pointerId);
      } catch {
        // Synthetic pointers (tests) cannot be captured; moves still bubble.
      }
    }
    if (drag.mode === 'node' && drag.nodeId) {
      const point = this.toSvgPoint(event.clientX, event.clientY);
      const next = new Map(this.positions());
      next.set(drag.nodeId, { x: point.x + drag.grab.x, y: point.y + drag.grab.y });
      this.positions.set(next);
    } else {
      // Convert the pixel delta to SVG units; the viewBox moves under the
      // pointer, so absolute SVG points would drift.
      const units = this.unitsPerPixel();
      const v = this.viewBox();
      this.viewBox.set({
        ...v,
        x: v.x - (event.clientX - drag.lastClient.x) * units,
        y: v.y - (event.clientY - drag.lastClient.y) * units,
      });
    }
    drag.lastClient = { x: event.clientX, y: event.clientY };
  }

  private unitsPerPixel(): number {
    const ctm = this.svg()?.nativeElement.getScreenCTM?.();
    return ctm && ctm.a ? 1 / ctm.a : 1;
  }

  onPointerUp(event: PointerEvent): void {
    const drag = this.drag;
    if (!drag || drag.pointerId !== event.pointerId) return;
    this.drag = null;
    if (drag.moved) this.suppressClick = true;
  }

  /** Client pixels to SVG user units, honouring preserveAspectRatio. */
  private toSvgPoint(clientX: number, clientY: number): Point {
    const svg = this.svg()?.nativeElement;
    const ctm = svg?.getScreenCTM?.();
    if (svg && ctm) {
      const inverse = ctm.inverse();
      return {
        x: inverse.a * clientX + inverse.c * clientY + inverse.e,
        y: inverse.b * clientX + inverse.d * clientY + inverse.f,
      };
    }
    const v = this.viewBox();
    return { x: v.x + v.w / 2, y: v.y + v.h / 2 };
  }
}
