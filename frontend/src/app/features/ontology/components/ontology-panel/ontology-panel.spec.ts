import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { MetricsApiService } from '../../../datasets/services/metrics-api.service';
import { Dataset } from '../../../datasets/services/datasets-api.service';
import { OntologyItem } from '../../models/ontology.model';
import {
  OntologyApiService,
  OntologyBootstrapProgress,
} from '../../services/ontology-api.service';
import { OntologyPanel } from './ontology-panel';

const DATASET: Dataset = {
  name: 'market insight',
  tables: ['main.sales.orders'],
  entities: [
    {
      key: 'main.sales.orders',
      columns: [{ name: 'status', type: 'string', nullable: false }],
    },
  ],
};

function item(partial: Partial<OntologyItem> & Pick<OntologyItem, 'id' | 'kind' | 'name'>): OntologyItem {
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

const ITEMS: OntologyItem[] = [
  item({
    id: 'c1',
    kind: 'concept',
    name: 'Active order',
    description: 'An order still open',
    mappings: [{ entity: 'main.sales.orders', column: 'status', expression: "status = 'open'" }],
  }),
  item({ id: 'c2', kind: 'concept', name: 'Order', description: 'A purchase' }),
  item({ id: 'r1', kind: 'relation', name: 'Active order is-a Order', from: 'c1', type: 'is-a', to: 'c2' }),
  item({ id: 'r2', kind: 'relation', name: 'Order measured-by Revenue', from: 'c2', type: 'measured-by', metricId: 'm1' }),
  item({ id: 'k1', kind: 'constraint', name: 'No tests', predicate: 'is_test = false' }),
  item({
    id: 'i1',
    kind: 'instruction',
    name: 'Coverage',
    description: 'Data spans 2020–2024',
    dataset: null,
  }),
  item({
    id: 'p1',
    kind: 'instruction',
    name: 'Mined rule',
    description: 'Suggested',
    source: 'mined',
    enabled: false,
  }),
];

describe('OntologyPanel', () => {
  let fixture: ComponentFixture<OntologyPanel>;
  let component: OntologyPanel;
  let api: {
    list: jasmine.Spy;
    update: jasmine.Spy;
    remove: jasmine.Spy;
    bootstrapStream: jasmine.Spy;
  };
  /** Drives the fake stream: emit a stage, or finish the run. */
  let emit: (progress: OntologyBootstrapProgress) => void;
  let finish: () => void;

  beforeEach(async () => {
    api = {
      list: jasmine.createSpy('list').and.callFake(() => of(ITEMS)),
      update: jasmine
        .createSpy('update')
        .and.callFake((id: string, patch: Partial<OntologyItem>) =>
          of({ ...ITEMS.find((i) => i.id === id)!, ...patch }),
        ),
      remove: jasmine.createSpy('remove').and.returnValue(of(null)),
      bootstrapStream: jasmine
        .createSpy('bootstrapStream')
        .and.callFake(
          (
            _dataset: string,
            handlers: {
              onProgress?: (p: OntologyBootstrapProgress) => void;
              onDone?: (created: unknown[]) => void;
            },
          ) => {
            emit = (progress) => handlers.onProgress?.(progress);
            finish = () => handlers.onDone?.([]);
            return Promise.resolve();
          },
        ),
    };
    const metrics = {
      list: () =>
        of({
          metrics: [
            { id: 'm1', name: 'revenue', label: 'Revenue', entity: 'main.sales.orders', expression: 'SUM(x)' },
          ],
        }),
    };
    await TestBed.configureTestingModule({
      imports: [OntologyPanel],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: OntologyApiService, useValue: api },
        { provide: MetricsApiService, useValue: metrics },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(OntologyPanel);
    fixture.componentRef.setInput('dataset', DATASET);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  const el = () => fixture.nativeElement as HTMLElement;
  const q = (testId: string) =>
    el().querySelector(`[data-testid="${testId}"]`) as HTMLElement | null;

  it('lists the dataset ontology by name', () => {
    expect(api.list).toHaveBeenCalledWith('market insight');
  });

  it('shows one section per kind, in order, each with its items', () => {
    const sections = Array.from(
      el().querySelectorAll('[data-testid^="ontology-section-"]'),
    );
    expect(sections.map((s) => s.querySelector('h3 span')?.textContent?.trim())).toEqual([
      'Concepts',
      'Relations',
      'Constraints',
      'Instructions',
    ]);
    const concepts = q('ontology-section-concept')!;
    expect(concepts.querySelector('[data-testid="ontology-item-c1"]')).toBeTruthy();
    expect(concepts.querySelector('[data-testid="ontology-item-r1"]')).toBeNull();
  });

  it('summarises each kind', () => {
    const summary = (id: string) =>
      q(`ontology-item-${id}`)!.querySelector('[data-testid="ontology-item-summary"]')!
        .textContent!.trim();
    expect(summary('c1')).toBe(
      "An order still open · maps to status = 'open' (main.sales.orders.status)",
    );
    expect(summary('r1')).toBe('Active order is-a Order');
    expect(summary('r2')).toBe('Order measured-by Revenue');
    expect(summary('k1')).toBe('is_test = false');
    expect(summary('i1')).toBe('Data spans 2020–2024');
  });

  it('marks shared items "All datasets" and mined items "Mined"', () => {
    expect(q('ontology-item-i1')!.textContent).toContain('All datasets');
    expect(q('ontology-item-c1')!.textContent).not.toContain('All datasets');
    expect(q('ontology-item-p1')!.textContent).toContain('Mined');
  });

  it('filters to one kind with the pills', () => {
    (q('ontology-filter-relation') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(q('ontology-section-relation')).toBeTruthy();
    expect(q('ontology-section-concept')).toBeNull();
  });

  it('counts pending suggestions and shows only them with Accept/Reject', () => {
    expect(q('pending-count')!.textContent!.trim()).toBe('1');
    (q('pending-suggestions-filter') as HTMLButtonElement).click();
    fixture.detectChanges();

    const rows = q('pending-list')!.querySelectorAll(':scope > div');
    expect(Array.from(rows).map((r) => r.getAttribute('data-testid'))).toEqual([
      'ontology-item-p1',
    ]);
    expect(q('accept-suggestion')).toBeTruthy();
    expect(q('reject-suggestion')).toBeTruthy();

    (q('accept-suggestion') as HTMLButtonElement).click();
    expect(api.update).toHaveBeenCalledWith('p1', { enabled: true });
  });

  describe('editing in place', () => {
    const anchors = () =>
      Array.from(el().querySelectorAll('[data-testid="ontology-form-anchor"]'));

    it('opens the editor where the row was, from the pencil', () => {
      const row = q('ontology-item-k1')!;
      (row.querySelector('[data-testid="edit-ontology-item"]') as HTMLButtonElement).click();
      fixture.detectChanges();

      // The row itself became the form, inside its own section.
      expect(q('ontology-item-k1')).toBeNull();
      expect(anchors().length).toBe(1);
      const anchor = anchors()[0] as HTMLElement;
      expect(anchor.getAttribute('data-editing')).toBe('k1');
      expect(q('ontology-section-constraint')!.contains(anchor)).toBeTrue();
      expect(anchor.querySelector('app-ontology-item-form')).toBeTruthy();
      // Other rows stay as rows.
      expect(q('ontology-item-c1')).toBeTruthy();
    });

    it('opens the editor by clicking the row text, and Cancel returns the row', () => {
      (q('ontology-item-i1')!.querySelector('[data-testid="open-ontology-item"]') as HTMLElement).click();
      fixture.detectChanges();
      expect(anchors()[0].getAttribute('data-editing')).toBe('i1');

      component.cancelForm();
      fixture.detectChanges();
      expect(anchors().length).toBe(0);
      expect(q('ontology-item-i1')).toBeTruthy();
    });

    it('opens from the keyboard with Enter on the row text', () => {
      const target = q('ontology-item-c1')!.querySelector(
        '[data-testid="open-ontology-item"]',
      ) as HTMLElement;
      target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
      fixture.detectChanges();
      expect(component.editingItem()?.id).toBe('c1');
    });

    it('keeps the New item form at the top, above the sections', () => {
      component.openNew();
      fixture.detectChanges();
      const anchor = anchors()[0] as HTMLElement;
      expect(anchor.getAttribute('data-editing')).toBeNull();
      expect(
        anchor.compareDocumentPosition(q('ontology-section-concept')!) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    });
  });

  it('confirms a delete with the contract text, adding the relations note for a concept', () => {
    const confirm = spyOn(window, 'confirm').and.returnValue(false);
    component.deleteItem(ITEMS[4]);
    expect(confirm).toHaveBeenCalledWith(
      'Delete “No tests”? The assistant will stop using it.',
    );
    expect(api.remove).not.toHaveBeenCalled();

    confirm.and.returnValue(true);
    component.deleteItem(ITEMS[0]);
    expect(confirm).toHaveBeenCalledWith(
      'Delete “Active order”? The assistant will stop using it. Its relations are deleted too.',
    );
    expect(api.remove).toHaveBeenCalledWith('c1');
    // A concept delete takes its relations with it, so the list reloads.
    expect(api.list).toHaveBeenCalledTimes(2);
  });

  describe('graph view', () => {
    const graphNodes = () =>
      Array.from(el().querySelectorAll('[data-testid^="ontology-graph-node-"]')).map((n) =>
        n.getAttribute('data-testid')!.replace('ontology-graph-node-', ''),
      );

    beforeEach(() => {
      (q('ontology-filter-graph') as HTMLButtonElement).click();
      fixture.detectChanges();
    });

    it('swaps the sections for the graph and back to the list with another filter', () => {
      expect(q('ontology-graph')).toBeTruthy();
      expect(q('ontology-section-concept')).toBeNull();
      expect(q('ontology-filter-graph')!.getAttribute('aria-pressed')).toBe('true');
      expect(q('ontology-filter-all')!.getAttribute('aria-pressed')).toBe('false');
      expect(graphNodes()).toEqual(['c1', 'c2', 'metric:m1']);
      expect(el().querySelectorAll('[data-testid^="ontology-graph-edge-"]').length).toBe(2);

      (q('ontology-filter-all') as HTMLButtonElement).click();
      fixture.detectChanges();
      expect(q('ontology-graph')).toBeNull();
      expect(q('ontology-section-concept')).toBeTruthy();
    });

    it('opens the existing editor from the details card and keeps the graph', () => {
      q('ontology-graph-node-c1')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      fixture.detectChanges();
      (q('ontology-graph-edit') as HTMLButtonElement).click();
      fixture.detectChanges();

      expect(component.formOpen()).toBeTrue();
      expect(component.editingItem()?.id).toBe('c1');
      expect(el().querySelector('app-ontology-item-form')).toBeTruthy();
      // The editor opens under the graph, not at the top of the panel.
      const anchor = el().querySelector('[data-testid="ontology-form-anchor"]')!;
      expect(
        q('ontology-graph')!.compareDocumentPosition(anchor) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();

      component.cancelForm();
      fixture.detectChanges();
      expect(el().querySelector('app-ontology-item-form')).toBeNull();
      expect(q('ontology-graph')).toBeTruthy();
    });

    it('draws only pending items and their endpoints with Pending suggestions on', () => {
      const pendingItems: OntologyItem[] = [
        ...ITEMS,
        item({ id: 'c3', kind: 'concept', name: 'Lead', source: 'mined', enabled: false }),
        item({
          id: 'r3',
          kind: 'relation',
          name: 'Lead related-to Order',
          from: 'c3',
          type: 'related-to',
          to: 'c2',
          source: 'mined',
          enabled: false,
        }),
      ];
      component.items.set(pendingItems);
      fixture.detectChanges();
      expect(graphNodes()).toEqual(['c1', 'c2', 'c3', 'metric:m1']);

      (q('pending-suggestions-filter') as HTMLButtonElement).click();
      fixture.detectChanges();
      expect(q('ontology-graph')).toBeTruthy();
      expect(q('pending-list')).toBeNull();
      // The pending concept and the enabled concept its pending relation reaches.
      expect(graphNodes()).toEqual(['c2', 'c3']);
      expect(q('ontology-graph-node-c3')!.classList).toContain('faded');
      expect(q('ontology-graph-node-c2')!.classList).not.toContain('faded');
      expect(
        Array.from(el().querySelectorAll('[data-testid^="ontology-graph-edge-"]')).map((e) =>
          e.getAttribute('data-testid'),
        ),
      ).toEqual(['ontology-graph-edge-r3']);
    });
  });

  describe('generate progress', () => {
    beforeEach(() => {
      component.openGenerate();
      component.generateSuggestions();
      fixture.detectChanges();
    });

    function progressText(): string {
      return q('generate-progress')?.textContent ?? '';
    }

    it('runs for this dataset and shows a starting line first', () => {
      expect(api.bootstrapStream.calls.mostRecent().args[0]).toBe('market insight');
      expect(progressText()).toContain('Starting');
    });

    it('renders the stage in flight and keeps the finished ones above it', () => {
      emit({ key: 'dataset', message: 'Opening dataset “market insight”' });
      emit({ key: 'schema', message: 'Reading schema — 3 tables' });
      fixture.detectChanges();

      expect(component.finishedSteps().map((s) => s.key)).toEqual(['dataset']);
      expect(component.currentStep()?.key).toBe('schema');
      expect(progressText()).toContain('Opening dataset');
      expect(progressText()).toContain('Reading schema — 3 tables');
    });

    it('rewrites a counting stage in place instead of stacking lines', () => {
      emit({ key: 'sample', message: 'Sampling rows — 1 of 3 tables' });
      emit({ key: 'sample', message: 'Sampling rows — 2 of 3 tables' });
      fixture.detectChanges();

      expect(component.generateSteps().length).toBe(1);
      expect(progressText()).toContain('Sampling rows — 2 of 3 tables');
      expect(progressText()).not.toContain('1 of 3');
    });

    it('clears the panel and opens Pending suggestions when the run finishes', () => {
      emit({ key: 'draft', message: 'Drafting' });
      finish();
      fixture.detectChanges();

      expect(component.generating()).toBe(false);
      expect(component.generateSteps()).toEqual([]);
      expect(component.pendingOnly()).toBe(true);
      expect(progressText()).toBe('');
    });
  });
});
