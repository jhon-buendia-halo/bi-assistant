import { ComponentFixture, TestBed } from '@angular/core/testing';
import { OntologyItem } from '../../models/ontology.model';
import { OntologyGraph } from './ontology-graph';
import {
  GraphMetric,
  buildOntologyGraph,
  fitViewBox,
  layoutOntologyGraph,
  metricNodeId,
  sizeLabel,
} from './ontology-graph.layout';

function item(
  partial: Partial<OntologyItem> & Pick<OntologyItem, 'id' | 'kind' | 'name'>,
): OntologyItem {
  return {
    dataset: 'market insight',
    description: '',
    enabled: true,
    source: 'user',
    createdAt: '2026-11-01T00:00:00Z',
    updatedAt: '2026-11-01T00:00:00Z',
    ...partial,
  };
}

const METRICS: GraphMetric[] = [{ id: 'm1', name: 'revenue', label: 'Revenue' }];

const ITEMS: OntologyItem[] = [
  item({
    id: 'c1',
    kind: 'concept',
    name: 'Active order',
    description: 'An order still open',
    mappings: [{ entity: 'main.sales.orders', column: 'status' }],
  }),
  item({ id: 'c2', kind: 'concept', name: 'Order', description: 'A purchase' }),
  item({ id: 'c3', kind: 'concept', name: 'Customer', dataset: null }),
  item({
    id: 'c4',
    kind: 'concept',
    name: 'Churned customer',
    source: 'mined',
    enabled: false,
  }),
  item({ id: 'c5', kind: 'concept', name: 'Region' }),
  item({ id: 'r1', kind: 'relation', name: 'r1', from: 'c1', type: 'is-a', to: 'c2' }),
  item({ id: 'r2', kind: 'relation', name: 'r2', from: 'c2', type: 'measured-by', metricId: 'm1' }),
  item({ id: 'r3', kind: 'relation', name: 'r3', from: 'c3', type: 'has-many', to: 'c2' }),
  item({
    id: 'r4',
    kind: 'relation',
    name: 'r4',
    from: 'c4',
    type: 'is-a',
    to: 'c3',
    source: 'mined',
    enabled: false,
  }),
  // Dangling: unknown concept, unknown metric, missing `to`.
  item({ id: 'r5', kind: 'relation', name: 'r5', from: 'c1', type: 'part-of', to: 'gone' }),
  item({ id: 'r6', kind: 'relation', name: 'r6', from: 'c1', type: 'measured-by', metricId: 'nope' }),
  item({ id: 'r7', kind: 'relation', name: 'r7', from: 'gone', type: 'related-to', to: 'c2' }),
  item({ id: 'k1', kind: 'constraint', name: 'No tests', predicate: 'is_test = false' }),
];

describe('ontology graph layout', () => {
  it('builds one node per concept and per targeted metric, skipping dangling relations', () => {
    const graph = buildOntologyGraph(ITEMS, METRICS);
    expect(graph.nodes.map((n) => n.id)).toEqual(['c1', 'c2', 'c3', 'c4', 'c5', metricNodeId('m1')]);
    expect(graph.nodes.find((n) => n.id === 'metric:m1')!.label).toBe('Revenue');
    expect(graph.edges.map((e) => e.id)).toEqual(['r1', 'r2', 'r3', 'r4']);
    expect(graph.edges.find((e) => e.id === 'r2')!.to).toBe('metric:m1');
  });

  it('marks disabled items faded and shared concepts shared', () => {
    const graph = buildOntologyGraph(ITEMS, METRICS);
    expect(graph.nodes.filter((n) => n.faded).map((n) => n.id)).toEqual(['c4']);
    expect(graph.edges.filter((e) => e.faded).map((e) => e.id)).toEqual(['r4']);
    expect(graph.nodes.filter((n) => n.shared).map((n) => n.id)).toEqual(['c3']);
  });

  it('truncates long labels so they fit the node', () => {
    const long = 'A very long concept name that will never fit in a node';
    const { width, shortLabel } = sizeLabel(long);
    expect(shortLabel.endsWith('…')).toBeTrue();
    expect(shortLabel.length * 7).toBeLessThanOrEqual(width);
    expect(sizeLabel('Order').shortLabel).toBe('Order');
  });

  it('lays out deterministically', () => {
    const a = layoutOntologyGraph(buildOntologyGraph(ITEMS, METRICS));
    const b = layoutOntologyGraph(buildOntologyGraph(ITEMS, METRICS));
    expect(Array.from(a.entries())).toEqual(Array.from(b.entries()));
  });

  it('keeps every node inside the area and the fitted viewBox, without overlaps collapsing', () => {
    const graph = buildOntologyGraph(ITEMS, METRICS);
    const positions = layoutOntologyGraph(graph, 900, 520);
    const view = fitViewBox(graph.nodes, positions);
    for (const node of graph.nodes) {
      const p = positions.get(node.id)!;
      expect(Number.isFinite(p.x) && Number.isFinite(p.y)).toBeTrue();
      expect(p.x - node.width / 2).toBeGreaterThanOrEqual(0);
      expect(p.x + node.width / 2).toBeLessThanOrEqual(900);
      expect(p.y - node.height / 2).toBeGreaterThanOrEqual(0);
      expect(p.y + node.height / 2).toBeLessThanOrEqual(520);
      expect(p.x - node.width / 2).toBeGreaterThanOrEqual(view.x);
      expect(p.x + node.width / 2).toBeLessThanOrEqual(view.x + view.w);
      expect(p.y - node.height / 2).toBeGreaterThanOrEqual(view.y);
      expect(p.y + node.height / 2).toBeLessThanOrEqual(view.y + view.h);
    }
    const points = Array.from(positions.values());
    for (let i = 0; i < points.length; i++) {
      for (let j = i + 1; j < points.length; j++) {
        expect(Math.hypot(points[i].x - points[j].x, points[i].y - points[j].y)).toBeGreaterThan(20);
      }
    }
  });
});

describe('OntologyGraph', () => {
  let fixture: ComponentFixture<OntologyGraph>;
  let component: OntologyGraph;
  let edited: OntologyItem[];

  function render(items: OntologyItem[], metrics: GraphMetric[] = METRICS): void {
    fixture.componentRef.setInput('items', items);
    fixture.componentRef.setInput('metrics', metrics);
    fixture.detectChanges();
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [OntologyGraph] }).compileComponents();
    fixture = TestBed.createComponent(OntologyGraph);
    component = fixture.componentInstance;
    edited = [];
    component.edit.subscribe((i) => edited.push(i));
    render(ITEMS);
  });

  const el = () => fixture.nativeElement as HTMLElement;
  const q = (testId: string) =>
    el().querySelector(`[data-testid="${testId}"]`) as HTMLElement | null;
  const all = (prefix: string) =>
    Array.from(el().querySelectorAll(`[data-testid^="${prefix}"]`));

  it('draws the nodes and edges, metrics included, dangling relations skipped', () => {
    expect(all('ontology-graph-node-').length).toBe(6);
    expect(all('ontology-graph-edge-').length).toBe(4);
    expect(q('ontology-graph-node-metric:m1')!.classList).toContain('metric');
    expect(q('ontology-graph-edge-r5')).toBeNull();
    expect(q('ontology-graph-svg')!.getAttribute('aria-label')).toBe(
      'Ontology relations graph: 5 concepts, 4 relations, 1 metric',
    );
  });

  it('fades disabled and pending items and lists them in the legend', () => {
    expect(q('ontology-graph-node-c4')!.classList).toContain('faded');
    expect(q('ontology-graph-edge-r4')!.classList).toContain('faded');
    expect(q('ontology-graph-node-c1')!.classList).not.toContain('faded');
    const legend = q('ontology-graph-legend')!.textContent!;
    expect(legend).toContain('Disabled or pending');
    expect(legend).toContain('Metric');
    expect(q('ontology-graph-legend-is-a')).toBeTruthy();
    expect(q('ontology-graph-legend-part-of')).toBeNull();
  });

  it('gives shared concepts an "All datasets" marker and every node a tooltip', () => {
    expect(q('ontology-graph-node-c3')!.querySelector('.shared')).toBeTruthy();
    expect(q('ontology-graph-node-c1')!.querySelector('.shared')).toBeNull();
    expect(q('ontology-graph-node-c1')!.querySelector('title')!.textContent).toBe('Active order');
    expect(q('ontology-graph-node-c1')!.getAttribute('tabindex')).toBe('0');
  });

  it('selecting a node highlights its neighbours, dims the rest and edits from the card', () => {
    q('ontology-graph-node-c2')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    fixture.detectChanges();

    // c2's neighbours: c1 (r1), metric (r2), c3 (r3).
    for (const id of ['c1', 'c3', 'metric:m1']) {
      expect(q(`ontology-graph-node-${id}`)!.classList).not.toContain('dim');
    }
    expect(q('ontology-graph-node-c4')!.classList).toContain('dim');
    expect(q('ontology-graph-node-c5')!.classList).toContain('dim');
    expect(q('ontology-graph-edge-r1')!.classList).toContain('active');
    expect(q('ontology-graph-edge-r4')!.classList).toContain('dim');

    const details = q('ontology-graph-details')!;
    expect(details.textContent).toContain('Concept');
    expect(details.textContent).toContain('A purchase');
    (q('ontology-graph-edit') as HTMLButtonElement).click();
    expect(edited.map((i) => i.id)).toEqual(['c2']);
  });

  it('shows a relation sentence and its state chips when an edge is selected', () => {
    const edge = q('ontology-graph-edge-r4')!;
    edge.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    fixture.detectChanges();
    const details = q('ontology-graph-details')!;
    expect(q('ontology-graph-details-sentence')!.textContent!.trim()).toBe(
      'Churned customer is-a Customer',
    );
    expect(details.textContent).toContain('Mined');
    expect(details.textContent).toContain('Disabled');
    expect(q('ontology-graph-node-c4')!.classList).not.toContain('dim');
    expect(q('ontology-graph-node-c1')!.classList).toContain('dim');
  });

  it('offers no Edit for a metric node', () => {
    q('ontology-graph-node-metric:m1')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    fixture.detectChanges();
    expect(q('ontology-graph-details')!.textContent).toContain('Metric');
    expect(q('ontology-graph-edit')).toBeNull();
  });

  it('clears the selection on Escape and on a background click', () => {
    component.select('node', 'c1');
    fixture.detectChanges();
    expect(q('ontology-graph-details')).toBeTruthy();
    q('ontology-graph-svg')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    fixture.detectChanges();
    expect(q('ontology-graph-details')).toBeNull();

    component.select('node', 'c1');
    fixture.detectChanges();
    q('ontology-graph-svg')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    fixture.detectChanges();
    expect(q('ontology-graph-details')).toBeNull();
  });

  it('zooms with the buttons and fits back', () => {
    const fitted = component.viewBox();
    (q('ontology-graph-zoom-in') as HTMLButtonElement).click();
    expect(component.viewBox().w).toBeLessThan(fitted.w);
    (q('ontology-graph-zoom-out') as HTMLButtonElement).click();
    (q('ontology-graph-zoom-out') as HTMLButtonElement).click();
    expect(component.viewBox().w).toBeGreaterThan(fitted.w);
    (q('ontology-graph-fit') as HTMLButtonElement).click();
    expect(component.viewBox()).toEqual(fitted);
  });

  it('keeps a dragged node where it was dropped until the items change', () => {
    const before = component.position('c5');
    component.onPointerDown(
      new PointerEvent('pointerdown', { button: 0, pointerId: 7, clientX: 10, clientY: 10 }),
      'c5',
    );
    component.onPointerMove(new PointerEvent('pointermove', { pointerId: 7, clientX: 90, clientY: 60 }));
    component.onPointerUp(new PointerEvent('pointerup', { pointerId: 7, clientX: 90, clientY: 60 }));
    fixture.detectChanges();
    const moved = component.position('c5');
    expect(moved).not.toEqual(before);
    // The release's click does not select the dragged node.
    component.select('node', 'c5');
    expect(component.selection()).toBeNull();

    render([...ITEMS]);
    expect(component.position('c5')).toEqual(before);
  });

  it('shows the empty state when there are no concepts', () => {
    render([ITEMS[ITEMS.length - 1]]);
    expect(q('ontology-graph-empty')!.textContent).toContain('No concepts to draw yet');
    expect(q('ontology-graph-svg')).toBeNull();
  });
});
