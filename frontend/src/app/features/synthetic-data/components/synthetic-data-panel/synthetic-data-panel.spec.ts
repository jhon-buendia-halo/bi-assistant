import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Dataset } from '../../../datasets/services/datasets-api.service';
import {
  SampledColumn,
  SampledProfile,
  SampledTable,
} from '../../models/synthetic-data.model';
import {
  abbreviateCount,
  methodChipText,
  strategyChipText,
} from '../../models/synthetic-data.format';
import { SyntheticDataPanel } from './synthetic-data-panel';

const col = (over: Partial<SampledColumn>): SampledColumn => ({
  name: 'c',
  type: 'text',
  semanticType: 'text' as SampledColumn['semanticType'],
  nullable: true,
  kind: 'text',
  strategy: 'words',
  nullFraction: 0,
  distinctCount: 1,
  distinctRatio: 1,
  ...over,
});

const table = (over: Partial<SampledTable>): SampledTable => ({
  key: 'wc.players',
  namespace: 'public',
  name: 'players',
  rowCountEstimate: null,
  sampledRows: 32,
  method: 'full',
  durationMs: 5,
  primaryKey: [],
  uniqueKeys: [],
  columns: [],
  ...over,
});

function dataset(
  n: number,
  kind: Dataset['datasourceKind'] = 'postgres',
): Dataset {
  return {
    name: 'World Cup',
    datasourceId: 'ds1',
    datasourceKind: kind,
    tables: Array.from({ length: n }, (_, i) => `db.public.t${i}`),
  };
}

function profile(): SampledProfile {
  const now = Date.now();
  return {
    profileId: 'p1',
    version: 1,
    datasetName: 'World Cup',
    datasourceId: 'ds1',
    datasourceName: 'wc',
    dialect: 'postgres',
    generatedAt: new Date(now).toISOString(),
    expiresAt: new Date(now + 60 * 60000).toISOString(),
    sampleSize: 1000,
    tables: [
      table({
        key: 'db.public.t0',
        name: 't0',
        columns: [
          col({
            name: 'stage',
            kind: 'categorical',
            strategy: 'categorical',
            topValues: [
              { value: 'a', fraction: 0.5 },
              { value: 'b', fraction: 0.3 },
              { value: 'c', fraction: 0.1 },
            ],
          }),
        ],
      }),
    ],
    relationships: [],
  };
}

describe('SyntheticDataPanel', () => {
  let fixture: ComponentFixture<SyntheticDataPanel>;
  let http: HttpTestingController;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SyntheticDataPanel],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();
    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(SyntheticDataPanel);
  });

  const el = () => fixture.nativeElement as HTMLElement;
  const q = (id: string) =>
    el().querySelector(`[data-testid="${id}"]`) as HTMLElement | null;
  const render = (ds: Dataset) => {
    fixture.componentRef.setInput('dataset', ds);
    fixture.detectChanges();
  };

  it('shows the empty state and no controls for a REST dataset', () => {
    render(dataset(2, 'rest'));
    expect(q('synth-unsupported')?.textContent).toContain(
      'Profiling a sample works for PostgreSQL and Databricks datasets.',
    );
    expect(q('synth-profile')).toBeNull();
    expect(q('synth-table-count')).toBeNull();
  });

  it('checks every table by default and counts them', () => {
    render(dataset(3));
    expect(q('synth-table-count')!.textContent).toContain('3 of 3 tables');
    expect((q('synth-table-db.public.t0') as HTMLInputElement).checked).toBe(
      true,
    );
  });

  it('Clear and Select all change the selection and the Profile button', () => {
    render(dataset(3));
    q('synth-select-none')!.click();
    fixture.detectChanges();
    expect(q('synth-table-count')!.textContent).toContain('0 of 3 tables');
    expect((q('synth-profile') as HTMLButtonElement).disabled).toBe(true);
    q('synth-select-all')!.click();
    fixture.detectChanges();
    expect((q('synth-profile') as HTMLButtonElement).disabled).toBe(false);
  });

  it('disables Profile and warns above 50 checked tables', () => {
    render(dataset(51));
    expect(q('synth-too-many')!.textContent).toContain(
      'Choose at most 50 tables.',
    );
    expect((q('synth-profile') as HTMLButtonElement).disabled).toBe(true);
    q('synth-table-db.public.t0')!.click();
    fixture.detectChanges();
    expect(q('synth-too-many')).toBeNull();
    expect((q('synth-profile') as HTMLButtonElement).disabled).toBe(false);
  });

  it('posts the checked tables and renders a card with strategy chips', () => {
    render(dataset(2));
    q('synth-table-db.public.t1')!.click();
    fixture.detectChanges();
    q('synth-profile')!.click();
    fixture.detectChanges();
    expect(q('synth-profile')!.textContent).toContain('Sampling 1 tables…');

    const req = http.expectOne((r) =>
      r.url.endsWith('/synthetic-data/profiles'),
    );
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({
      datasetName: 'World Cup',
      tables: ['db.public.t0'],
      sampleSize: 1000,
    });
    req.flush(profile());
    fixture.detectChanges();

    expect(q('synth-profile-summary')!.textContent).toContain(
      '1 table · sampled just now · expires in 60 min',
    );
    expect(q('synth-method-db.public.t0')!.textContent).toContain(
      'Read all 32 rows',
    );
    expect(q('synth-col-db.public.t0-stage')!.textContent).toContain(
      'Reuses 3 values',
    );
  });

  it('destroying the panel mid-request cancels the HTTP request', () => {
    render(dataset(1));
    q('synth-profile')!.click();
    fixture.detectChanges();
    const req = http.expectOne((r) =>
      r.url.endsWith('/synthetic-data/profiles'),
    );
    expect(req.cancelled).toBe(false);
    fixture.destroy();
    expect(req.cancelled).toBe(true);
  });

  it('shows a dash for the range of an identifier without stats', () => {
    render(dataset(1));
    q('synth-profile')!.click();
    fixture.detectChanges();
    const p = profile();
    p.tables[0].columns = [
      col({
        name: 'national_id',
        type: 'bigint',
        kind: 'identifier',
        strategy: 'sequence',
      }),
    ];
    http.expectOne((r) => r.url.endsWith('/synthetic-data/profiles')).flush(p);
    fixture.detectChanges();
    const cells = q('synth-col-db.public.t0-national_id')!.querySelectorAll(
      'td',
    );
    expect(cells[4].textContent!.trim()).toBe('—');
  });

  it('Cancel aborts the HTTP request and restores the button', () => {
    render(dataset(1));
    q('synth-profile')!.click();
    fixture.detectChanges();
    const req = http.expectOne((r) =>
      r.url.endsWith('/synthetic-data/profiles'),
    );
    q('synth-cancel')!.click();
    fixture.detectChanges();
    expect(req.cancelled).toBe(true);
    expect(q('synth-cancel')).toBeNull();
    expect(q('synth-profile')!.textContent).toContain('Profile sample');
    expect(q('synth-error')).toBeNull();
    expect(q('synth-profile-view')).toBeNull();
  });

  it('shows the server message verbatim with Retry, and Retry re-posts', () => {
    render(dataset(1));
    q('synth-profile')!.click();
    http
      .expectOne((r) => r.url.endsWith('/synthetic-data/profiles'))
      .flush(
        { message: 'Datasource "ds1" not found' },
        { status: 404, statusText: 'Not Found' },
      );
    fixture.detectChanges();
    expect(q('synth-error')!.textContent).toContain(
      'Datasource "ds1" not found',
    );
    q('synth-retry')!.click();
    fixture.detectChanges();
    expect(q('synth-error')).toBeNull();
    http
      .expectOne((r) => r.url.endsWith('/synthetic-data/profiles'))
      .flush(profile());
    fixture.detectChanges();
    expect(q('synth-profile-view')).toBeTruthy();
  });
});

describe('profile copy helpers', () => {
  it('method chip copy', () => {
    expect(
      methodChipText(
        table({
          method: 'tablesample',
          sampledRows: 1000,
          rowCountEstimate: 2_300_000,
        }),
      ),
    ).toBe('Sampled 1,000 of ~2.3M rows');
    expect(methodChipText(table({ method: 'full', sampledRows: 32 }))).toBe(
      'Read all 32 rows',
    );
    expect(methodChipText(table({ method: 'limit', sampledRows: 1000 }))).toBe(
      'First 1,000 rows (sampling not supported here)',
    );
    expect(abbreviateCount(950)).toBe('950');
  });

  it('strategy chip copy', () => {
    const t = table({ key: 'a.child', name: 'child' });
    const parent = table({ key: 'a.parent', name: 'parent' });
    const rels = [
      {
        fromTable: 'a.child',
        fromColumns: ['pid'],
        toTable: 'a.parent',
        toColumns: ['id'],
        origin: 'declared' as const,
      },
    ];
    const chip = (c: Partial<SampledColumn>) =>
      strategyChipText(col(c), t, rels, [t, parent]);
    expect(chip({ strategy: 'sequence' })).toBe('Sequence 1…n');
    expect(chip({ strategy: 'unique-range' })).toBe(
      'Distinct numbers in the observed range',
    );
    expect(chip({ strategy: 'uuid' })).toBe('Random UUIDs');
    expect(chip({ strategy: 'unique-pattern' })).toBe(
      'Unique values like the pattern',
    );
    expect(chip({ strategy: 'foreign-key', name: 'pid' })).toBe(
      'Keys of parent',
    );
    expect(
      chip({
        strategy: 'categorical',
        topValues: [
          { value: 'x', fraction: 0.6 },
          { value: 'y', fraction: 0.4 },
        ],
      }),
    ).toBe('Reuses 2 values');
    expect(chip({ strategy: 'numeric-range' })).toBe(
      'Numbers in the observed range',
    );
    expect(chip({ strategy: 'temporal-range' })).toBe(
      'Dates in the observed range',
    );
    expect(
      chip({ strategy: 'boolean-rate', boolean: { trueFraction: 0.42 } }),
    ).toBe('True 42 %');
    expect(chip({ strategy: 'format-template', formatRule: 'email' })).toBe(
      'Example emails',
    );
    expect(chip({ strategy: 'pattern' })).toBe('Text like the pattern');
    expect(chip({ strategy: 'words' })).toBe('Placeholder words');
    expect(chip({ strategy: 'null-only' })).toBe('NULL (type not synthesized)');
    expect(chip({ strategy: 'constant' })).toBe(
      'Empty value (type not synthesized)',
    );
  });
});
