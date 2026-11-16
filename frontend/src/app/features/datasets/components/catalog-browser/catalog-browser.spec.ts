import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { BackgroundTasksService } from '../../../../core/background-tasks/background-tasks.service';
import { Dataset } from '../../services/datasets-api.service';
import { DatasetTasksService } from '../../services/dataset-tasks.service';
import { CatalogBrowser } from './catalog-browser';

const DATASET: Dataset = {
  name: 'market insight',
  datasourceId: 'ds1',
  tables: ['main.sales.orders'],
  entities: [{ key: 'main.sales.orders', columns: [] }],
};

describe('CatalogBrowser tabs (BA-320)', () => {
  let fixture: ComponentFixture<CatalogBrowser>;

  beforeEach(async () => {
    // HTTP stays unanswered: these tests only look at the tab strip.
    await TestBed.configureTestingModule({
      imports: [CatalogBrowser],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();
    fixture = TestBed.createComponent(CatalogBrowser);
  });

  const el = () => fixture.nativeElement as HTMLElement;
  const q = (testId: string) =>
    el().querySelector(`[data-testid="${testId}"]`) as HTMLElement | null;

  it('shows no tab strip for a new dataset', () => {
    fixture.detectChanges();
    expect(el().querySelector('[role="tablist"]')).toBeNull();
    expect(q('dataset-tab-schema')).toBeNull();
    expect(q('dataset-tab-ontology')).toBeNull();
    expect(el().querySelector('app-ontology-panel')).toBeNull();
    expect(el().textContent).toContain('New dataset');
  });

  it('shows Schema | Ontology when editing a saved dataset, Schema first', () => {
    fixture.componentRef.setInput('initial', DATASET);
    fixture.detectChanges();

    const schema = q('dataset-tab-schema')!;
    const ontology = q('dataset-tab-ontology')!;
    expect(schema.getAttribute('role')).toBe('tab');
    expect(schema.getAttribute('aria-selected')).toBe('true');
    expect(ontology.getAttribute('aria-selected')).toBe('false');
    expect(el().textContent).toContain('Edit dataset');
    expect(el().querySelector('app-ontology-panel')).toBeNull();
  });

  it('has a third Profile & synthesize tab and arrow keys cycle all three', async () => {
    fixture.componentRef.setInput('initial', DATASET);
    fixture.detectChanges();

    const synth = q('dataset-tab-synthesize')!;
    expect(synth.getAttribute('role')).toBe('tab');
    expect(synth.textContent).toContain('Profile & synthesize');
    const press = (id: string, key: string) => {
      q(id)!.dispatchEvent(new KeyboardEvent('keydown', { key }));
      fixture.detectChanges();
    };
    const selected = () =>
      ['schema', 'ontology', 'synthesize'].find(
        (t) => q('dataset-tab-' + t)!.getAttribute('aria-selected') === 'true',
      );

    press('dataset-tab-schema', 'ArrowRight');
    expect(selected()).toBe('ontology');
    press('dataset-tab-ontology', 'ArrowRight');
    expect(selected()).toBe('synthesize');
    await fixture.whenStable();
    fixture.detectChanges();
    expect(
      el().querySelector('#dataset-panel-synthesize app-synthetic-data-panel'),
    ).toBeTruthy();
    press('dataset-tab-synthesize', 'ArrowRight');
    expect(selected()).toBe('schema');
    press('dataset-tab-schema', 'ArrowLeft');
    expect(selected()).toBe('synthesize');
  });

  it('switches to the Ontology panel and back', async () => {
    fixture.componentRef.setInput('initial', DATASET);
    fixture.detectChanges();

    q('dataset-tab-ontology')!.click();
    fixture.detectChanges();
    // The panel is deferred (kept out of the initial bundle).
    await fixture.whenStable();
    fixture.detectChanges();
    expect(q('dataset-tab-ontology')!.getAttribute('aria-selected')).toBe(
      'true',
    );
    const panel = el().querySelector('#dataset-panel-ontology')!;
    expect(panel.getAttribute('role')).toBe('tabpanel');
    expect(panel.querySelector('app-ontology-panel')).toBeTruthy();
    expect(el().textContent).not.toContain('Edit dataset');

    q('dataset-tab-schema')!.click();
    fixture.detectChanges();
    expect(el().querySelector('app-ontology-panel')).toBeNull();
    expect(el().textContent).toContain('Edit dataset');
  });
});

describe('CatalogBrowser background tasks (M1-26)', () => {
  let http: HttpTestingController;
  let tasks: BackgroundTasksService;

  const DATASOURCE = {
    id: 'ds1',
    name: 'Warehouse',
    kind: 'postgres',
    summary: '',
    config: {},
  };
  const CATALOGS = [
    {
      name: 'main',
      schemas: [
        {
          name: 'sales',
          tables: [{ name: 'orders', columns: [] }],
        },
      ],
    },
  ];
  const isDatasources = (r: { url: string }) => r.url.endsWith('/datasources');
  const isInventory = (r: { url: string }) => r.url.includes('/inventory');
  const isCreate = (r: { method: string; url: string }) =>
    r.method === 'POST' && r.url.endsWith('/datasets');

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [CatalogBrowser],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();
    http = TestBed.inject(HttpTestingController);
    tasks = TestBed.inject(BackgroundTasksService);
  });

  afterEach(() => {
    for (const t of tasks.running()) tasks.cancel(t.id);
  });

  function create(initial: Dataset | null = DATASET) {
    const fixture = TestBed.createComponent(CatalogBrowser);
    fixture.componentRef.setInput('initial', initial);
    fixture.detectChanges();
    http.expectOne(isDatasources).flush({ datasources: [DATASOURCE] });
    fixture.detectChanges();
    return fixture;
  }

  it('saving starts one background task and returns to the list', () => {
    const fixture = create();
    http.expectOne(isInventory).flush({ ok: true, catalogs: CATALOGS });
    fixture.detectChanges();
    const saved = jasmine.createSpy('saved');
    fixture.componentInstance.saved.subscribe(saved);

    fixture.componentInstance.saveDataset();
    fixture.componentInstance.saveDataset();
    fixture.detectChanges();

    expect(saved).toHaveBeenCalledTimes(1);
    const running = tasks.running().filter((t) => t.kind === 'dataset-save');
    expect(running.length).toBe(1);
    expect(running[0].title).toBe('Saving dataset "market insight"');
    http.expectOne(isCreate);
    // The component's own state follows the task if the user comes back.
    expect(fixture.componentInstance.saving()).toBeTrue();
  });

  it('a re-created browser shows loading while the inventory task runs and applies its result', () => {
    const first = create();
    const request = http.expectOne(isInventory);
    first.destroy();
    // Leaving does not cancel the load.
    expect(request.cancelled).toBeFalse();
    expect(tasks.active('inventory-refresh', 'ds1')).toBeTruthy();

    const second = create();
    expect(second.componentInstance.loading()).toBeTrue();
    expect(second.nativeElement.textContent).toContain('Loading inventory');
    http.expectNone(isInventory);

    request.flush({ ok: true, catalogs: CATALOGS });
    second.detectChanges();

    expect(second.componentInstance.loading()).toBeFalse();
    expect(second.componentInstance.catalogs().length).toBe(1);
    expect(tasks.active('inventory-refresh')).toBeUndefined();
  });

  it('Cancel stops the inventory task', () => {
    const fixture = create();
    const request = http.expectOne(isInventory);
    fixture.componentInstance.cancelLoad();
    fixture.detectChanges();

    expect(request.cancelled).toBeTrue();
    expect(tasks.latest('inventory-refresh', 'ds1')?.status).toBe('stopped');
    expect(fixture.componentInstance.awaitingChoice()).toBeTrue();
    expect(TestBed.inject(DatasetTasksService).shownDatasourceId()).toBe('ds1');
  });
});
