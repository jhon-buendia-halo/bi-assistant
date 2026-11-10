import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { MetricsApiService } from '../../../datasets/services/metrics-api.service';
import { Dataset } from '../../../datasets/services/datasets-api.service';
import { OntologyItem } from '../../models/ontology.model';
import { OntologyApiService } from '../../services/ontology-api.service';
import { OntologyItemForm } from './ontology-item-form';

const DATASET: Dataset = {
  name: 'market insight',
  tables: ['main.sales.orders', 'main.sales.customers'],
  entities: [
    {
      key: 'main.sales.orders',
      columns: [
        { name: 'status', type: 'string', nullable: false },
        { name: 'amount', type: 'double', nullable: true },
      ],
    },
    {
      key: 'main.sales.customers',
      columns: [{ name: 'segment', type: 'string', nullable: true }],
    },
  ],
};

const CONCEPTS: OntologyItem[] = [
  {
    id: 'c1',
    dataset: 'market insight',
    kind: 'concept',
    name: 'Order',
    description: 'A purchase',
    enabled: true,
    source: 'user',
    createdAt: '',
    updatedAt: '',
  },
  {
    id: 'c2',
    dataset: null,
    kind: 'concept',
    name: 'Customer',
    description: 'Who buys',
    enabled: true,
    source: 'user',
    createdAt: '',
    updatedAt: '',
  },
];

describe('OntologyItemForm', () => {
  let fixture: ComponentFixture<OntologyItemForm>;
  let component: OntologyItemForm;
  let api: { create: jasmine.Spy; update: jasmine.Spy };
  let metricsList: jasmine.Spy;

  beforeEach(async () => {
    api = {
      create: jasmine.createSpy('create').and.callFake(() => of(CONCEPTS[0])),
      update: jasmine.createSpy('update').and.callFake(() => of(CONCEPTS[0])),
    };
    metricsList = jasmine.createSpy('list').and.returnValue(
      of({
        metrics: [
          { id: 'm1', name: 'revenue', label: 'Revenue', entity: 'main.sales.orders', expression: 'SUM(amount)' },
        ],
      }),
    );
    await TestBed.configureTestingModule({
      imports: [OntologyItemForm],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: OntologyApiService, useValue: api },
        { provide: MetricsApiService, useValue: { list: metricsList } },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(OntologyItemForm);
    fixture.componentRef.setInput('dataset', DATASET);
    fixture.componentRef.setInput('concepts', CONCEPTS);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  const el = () => fixture.nativeElement as HTMLElement;
  const q = (testId: string) =>
    el().querySelector(`[data-testid="${testId}"]`) as HTMLElement | null;

  function chooseKind(kind: string): void {
    const select = q('ontology-kind') as HTMLSelectElement;
    select.value = kind;
    select.dispatchEvent(new Event('change'));
    fixture.detectChanges();
  }

  function type(testId: string, value: string, root: ParentNode = el()): void {
    const input = root.querySelector(`[data-testid="${testId}"]`) as
      | HTMLInputElement
      | HTMLTextAreaElement;
    input.value = value;
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
  }

  function pick(testId: string, value: string, root: ParentNode = el()): void {
    const select = root.querySelector(`[data-testid="${testId}"]`) as HTMLSelectElement;
    select.value = value;
    select.dispatchEvent(new Event('change'));
    fixture.detectChanges();
  }

  it('loads the metrics over the dataset entities', () => {
    expect(metricsList).toHaveBeenCalledWith(DATASET.tables);
  });

  it('shows the fields of the chosen kind', () => {
    expect(q('ontology-synonyms')).toBeTruthy();
    expect(q('add-mapping')).toBeTruthy();
    expect(q('constraint-predicate')).toBeNull();

    chooseKind('relation');
    expect(q('relation-from')).toBeTruthy();
    expect(q('relation-to')).toBeTruthy();
    expect(q('ontology-name')).toBeNull();

    chooseKind('constraint');
    expect(q('constraint-predicate')).toBeTruthy();
    expect(q('constraint-concept')).toBeTruthy();
    expect(q('ontology-entity-main.sales.orders')).toBeTruthy();

    chooseKind('instruction');
    expect(q('constraint-predicate')).toBeNull();
    expect(q('ontology-description')).toBeTruthy();
    expect(q('ontology-entity-main.sales.customers')).toBeTruthy();
  });

  describe('mappings', () => {
    const click = (testId: string, root: ParentNode = el()) => {
      (root.querySelector(`[data-testid="${testId}"]`) as HTMLElement).click();
      fixture.detectChanges();
    };
    const sentences = () =>
      Array.from(el().querySelectorAll('[data-testid="mapping-sentence"]')).map((s) =>
        s.textContent!.replace(/\s+/g, ' ').trim(),
      );

    beforeEach(() => {
      type('ontology-name', 'Open order');
      type('ontology-description', 'An order not yet shipped');
    });

    it('starts unmapped, with an Add mapping button and a help line', () => {
      expect(q('mapping-empty')!.textContent).toContain('Not mapped yet');
      expect(q('mapping-section')!.textContent).toContain('Where it lives in the data');
      expect(q('add-mapping')).toBeTruthy();
    });

    it('adds a column mapping through the picker, showing short table names', () => {
      click('add-mapping');
      const picker = q('mapping-picker')!;
      // Short names in the table list, full name kept as the value.
      const options = Array.from(
        picker.querySelectorAll('[data-testid="mapping-entity"] option'),
      ) as HTMLOptionElement[];
      expect(options.map((o) => o.textContent!.trim())).toEqual(['orders', 'customers']);
      expect(options.map((o) => o.value)).toEqual(DATASET.tables);

      pick('mapping-entity', 'main.sales.customers', picker);
      // "A column" is the default target; Add waits for a column.
      expect((q('mapping-commit') as HTMLButtonElement).disabled).toBeTrue();
      pick('mapping-column', 'segment');
      click('mapping-commit');

      expect(q('mapping-picker')).toBeNull();
      expect(sentences()).toEqual(['customers → column segment']);
    });

    it('maps the whole table or an expression, one target per mapping', () => {
      click('add-mapping');
      click('mapping-target-table');
      expect(q('mapping-column')).toBeNull();
      click('mapping-commit');

      click('add-mapping');
      click('mapping-target-expression');
      type('mapping-expression', "status = 'open'");
      click('mapping-commit');

      expect(sentences()).toEqual(['orders → whole table', "orders → status = 'open'"]);
      (q('save-ontology-item') as HTMLButtonElement).click();
      expect(api.create).toHaveBeenCalledWith('market insight', {
        kind: 'concept',
        name: 'Open order',
        description: 'An order not yet shipped',
        mappings: [
          { entity: 'main.sales.orders' },
          { entity: 'main.sales.orders', expression: "status = 'open'" },
        ],
      });
    });

    it('edits a mapping in place and keeps Save disabled while the picker is open', () => {
      click('add-mapping');
      expect((q('save-ontology-item') as HTMLButtonElement).disabled).toBeTrue();
      click('mapping-target-table');
      click('mapping-commit');
      expect((q('save-ontology-item') as HTMLButtonElement).disabled).toBeFalse();

      click('edit-mapping', q('ontology-mapping-0')!);
      expect(q('mapping-picker')!.getAttribute('aria-label')).toBe('Edit mapping');
      click('mapping-target-column');
      pick('mapping-column', 'status');
      click('mapping-commit');
      expect(sentences()).toEqual(['orders → column status']);
    });

    it('removes a mapping, and Cancel leaves the list unchanged', () => {
      click('add-mapping');
      click('mapping-target-table');
      click('mapping-commit');
      click('add-mapping');
      click('mapping-cancel');
      expect(sentences().length).toBe(1);
      click('remove-mapping', q('ontology-mapping-0')!);
      expect(sentences()).toEqual([]);
      expect(q('mapping-empty')).toBeTruthy();
    });
  });

  it('a relation measured-by needs a metric instead of a target concept', () => {
    chooseKind('relation');
    pick('relation-from', 'c1');
    pick('relation-type', 'measured-by');
    expect(q('relation-to')).toBeNull();
    expect(q('relation-metric')).toBeTruthy();
    expect((q('save-ontology-item') as HTMLButtonElement).disabled).toBe(true);

    pick('relation-metric', 'm1');
    expect((q('save-ontology-item') as HTMLButtonElement).disabled).toBe(false);
    (q('save-ontology-item') as HTMLButtonElement).click();

    expect(api.create).toHaveBeenCalledWith('market insight', {
      kind: 'relation',
      name: 'Order measured-by Revenue',
      description: '',
      from: 'c1',
      type: 'measured-by',
      metricId: 'm1',
    });
  });

  it('lists the dataset concepts, shared ones included, as relation endpoints', () => {
    chooseKind('relation');
    const options = Array.from(
      el().querySelectorAll('[data-testid="relation-to"] option'),
    ).map((o) => (o as HTMLOptionElement).value);
    expect(options).toEqual(['', 'c1', 'c2']);
  });

  it('sends a constraint with its predicate, condition, concept and entities, shared when asked', () => {
    chooseKind('constraint');
    type('ontology-name', 'No tests');
    type('constraint-predicate', 'is_test = false');
    type('ontology-description', 'Every query');
    pick('constraint-concept', 'c2');
    const box = q('ontology-entity-main.sales.orders') as HTMLInputElement;
    box.checked = true;
    box.dispatchEvent(new Event('change'));
    const shared = q('ontology-shared') as HTMLInputElement;
    shared.checked = true;
    shared.dispatchEvent(new Event('change'));
    fixture.detectChanges();

    (q('save-ontology-item') as HTMLButtonElement).click();

    expect(api.create).toHaveBeenCalledWith('market insight', {
      kind: 'constraint',
      name: 'No tests',
      predicate: 'is_test = false',
      description: 'Every query',
      conceptId: 'c2',
      entities: ['main.sales.orders'],
      shared: true,
    });
  });

  it('offers "Share with all datasets" only on create, and patches on edit without the kind', () => {
    expect(q('ontology-shared')).toBeTruthy();

    fixture.componentRef.setInput('item', {
      id: 'i1',
      dataset: 'market insight',
      kind: 'instruction',
      name: 'Coverage',
      description: 'Data spans 2020',
      enabled: true,
      source: 'user',
      createdAt: '',
      updatedAt: '',
    } satisfies OntologyItem);
    fixture.detectChanges();

    expect(q('ontology-shared')).toBeNull();
    expect((q('ontology-kind') as HTMLSelectElement).disabled).toBe(true);
    type('ontology-description', 'Data spans 2020–2024');
    (q('save-ontology-item') as HTMLButtonElement).click();

    expect(api.update).toHaveBeenCalledWith('i1', {
      name: 'Coverage',
      description: 'Data spans 2020–2024',
      entities: [],
    });
    expect(api.create).not.toHaveBeenCalled();
  });

  it('shows the backend message inline when the save fails', () => {
    api.create.and.returnValue(
      throwError(() => ({
        error: { message: 'Entity "x.y.z" is not in dataset "market insight"' },
      })),
    );
    chooseKind('instruction');
    type('ontology-name', 'Rule');
    type('ontology-description', 'Text');
    (q('save-ontology-item') as HTMLButtonElement).click();
    fixture.detectChanges();

    expect(q('ontology-form-error')!.textContent).toContain(
      'Entity "x.y.z" is not in dataset "market insight"',
    );
  });
});
