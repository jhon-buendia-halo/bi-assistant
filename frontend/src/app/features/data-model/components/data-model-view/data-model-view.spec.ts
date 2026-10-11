import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { DataModelView, metricsSkippedLabel } from './data-model-view';
import { DataModelApiService } from '../../services/data-model-api.service';
import {
  DataModel,
  DriftResponse,
  MetricsImportReport,
} from '../../models/data-model.model';
import { AuthService } from '../../../../core/auth/auth.service';
import { LOCAL_ME, MeView } from '../../../../core/auth/auth.models';
import { orgMe } from '../../../../core/auth/auth.testing';

const MODEL: DataModel = {
  model: 'world_cup_core',
  version: 1,
  entities: [
    {
      name: 'matches',
      bindings: [],
      attributes: [{ name: 'attendance', type: 'integer' }],
    },
  ],
  relationships: [],
  metrics: [
    {
      name: 'avg_attendance',
      label: 'Average attendance',
      entity: 'matches',
      agg: 'avg',
      of: 'attendance',
      author: 'u-ada',
      authorName: 'Ada Lovelace',
    },
    {
      name: 'match_count',
      label: 'Match count',
      entity: 'matches',
      agg: 'count',
    },
    {
      name: 'max_attendance',
      label: 'Highest attendance',
      entity: 'matches',
      agg: 'max',
      of: 'attendance',
      author: 'u-grace',
    },
  ],
};

const EMPTY_DRIFT: DriftResponse = {
  checkedAt: '2026-10-11T00:00:00.000Z',
  snapshotOf: 1,
  added: [],
  removed: [],
  changed: [],
  entitiesAdded: [],
  entitiesRemoved: [],
};

function importReport(skipped: MetricsImportReport['skipped']): MetricsImportReport {
  return {
    importedAt: '2026-10-11T00:00:00.000Z',
    imported: [
      { name: 'avg_attendance', entity: 'matches', author: 'u-ada', sourceId: 'm-1' },
    ],
    skipped,
  };
}

describe('DataModelView', () => {
  let fixture: ComponentFixture<DataModelView>;

  function render(me: MeView, drift: DriftResponse = EMPTY_DRIFT): HTMLElement {
    const api = {
      get: () =>
        of({
          dataset: 'World Cup Core',
          currentVersion: 1,
          version: {
            version: 1,
            createdAt: '2026-10-11T00:00:00.000Z',
            source: 'bootstrap',
            yaml: 'model: world_cup_core\nversion: 1\n',
            model: MODEL,
          },
        }),
      drift: () => of(drift),
      listVersions: () => of({ versions: [] }),
      listModelMetrics: () => of({ metrics: MODEL.metrics }),
      modelMetricCandidates: () => of({ candidates: [] }),
    };
    TestBed.configureTestingModule({
      imports: [DataModelView],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: DataModelApiService, useValue: api },
      ],
    });
    const auth = TestBed.inject(AuthService);
    auth.me.set(me);
    auth.status.set('signed-in');
    fixture = TestBed.createComponent(DataModelView);
    fixture.componentRef.setInput('datasetName', 'World Cup Core');
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  const byTestId = (el: HTMLElement, id: string) =>
    el.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;

  function openTab(el: HTMLElement, id: string): void {
    byTestId(el, `tab-${id}`)!.click();
    fixture.detectChanges();
  }

  it('shows Bootstrap, Export and Import with Manage datasources', () => {
    const el = render(LOCAL_ME);
    expect(byTestId(el, 'bootstrap-model')).not.toBeNull();
    expect(byTestId(el, 'export-model')).not.toBeNull();
    expect(byTestId(el, 'import-model')).not.toBeNull();
    expect(byTestId(el, 'import-file-input')).not.toBeNull();
  });

  it('hides Bootstrap and Import without Manage datasources, keeping Export and the tabs', () => {
    const el = render(orgMe(['use-agents']));
    expect(byTestId(el, 'bootstrap-model')).toBeNull();
    expect(byTestId(el, 'import-model')).toBeNull();
    expect(byTestId(el, 'import-file-input')).toBeNull();
    expect(byTestId(el, 'export-model')).not.toBeNull();
    expect(byTestId(el, 'tab-overview')).not.toBeNull();
    expect(byTestId(el, 'tab-metrics')).not.toBeNull();
  });

  it('labels the tabs Overview, YAML, Versions and Metrics', () => {
    const el = render(LOCAL_ME);
    const labels = ['overview', 'yaml', 'versions', 'metrics'].map((id) =>
      byTestId(el, `tab-${id}`)!.textContent!.trim(),
    );
    expect(labels).toEqual(['Overview', 'YAML', 'Versions', 'Metrics']);
  });

  it('shows the version chip', () => {
    const el = render(LOCAL_ME);
    expect(byTestId(el, 'model-version-badge')!.textContent!.trim()).toBe(
      'v1 · bootstrap',
    );
  });

  it('passes read-only to the YAML editor without Manage datasources', () => {
    const el = render(orgMe(['use-agents']));
    openTab(el, 'yaml');
    const textarea = byTestId(el, 'yaml-textarea') as HTMLTextAreaElement;
    expect(textarea.readOnly).toBe(true);
    expect(byTestId(el, 'save-yaml')).toBeNull();
  });

  it('keeps the YAML editor writable with Manage datasources', () => {
    const el = render(LOCAL_ME);
    openTab(el, 'yaml');
    const textarea = byTestId(el, 'yaml-textarea') as HTMLTextAreaElement;
    expect(textarea.readOnly).toBe(false);
    expect(byTestId(el, 'save-yaml')).not.toBeNull();
  });

  it('passes read-only to the Metrics tab without Manage datasources', () => {
    const el = render(orgMe(['use-agents']));
    openTab(el, 'metrics');
    expect(byTestId(el, 'model-metric-avg_attendance')).not.toBeNull();
    expect(byTestId(el, 'new-model-metric')).toBeNull();
  });

  it("shows a metric's author name on the Overview, its author id without a name, and none for a metric without one", () => {
    const el = render(LOCAL_ME);
    expect(
      byTestId(el, 'model-metric-author-avg_attendance')!.textContent!.trim(),
    ).toBe('by Ada Lovelace');
    expect(
      byTestId(el, 'model-metric-author-max_attendance')!.textContent!.trim(),
    ).toBe('by u-grace');
    expect(byTestId(el, 'model-metric-author-match_count')).toBeNull();
  });

  it('shows no metrics-import chip when nothing was skipped or no import ran', () => {
    const el = render(LOCAL_ME, {
      ...EMPTY_DRIFT,
      metricsImport: importReport([]),
    });
    expect(byTestId(el, 'metrics-import-pill')).toBeNull();
  });

  it('shows the metrics-import chip, singular, with each skipped metric in its title', () => {
    const el = render(LOCAL_ME, {
      ...EMPTY_DRIFT,
      metricsImport: importReport([
        {
          name: 'avg_attendance',
          author: 'u-grace',
          authorName: 'Grace Hopper',
          sourceId: 'm-2',
          reason: 'name_clash',
          keptSourceId: 'm-1',
        },
      ]),
    });
    const chip = byTestId(el, 'metrics-import-pill')!;
    expect(chip.textContent!.trim()).toBe('1 metric skipped on import');
    expect(chip.classList).toContain('chip-info');
    expect(chip.title).toBe('avg_attendance by Grace Hopper — name clash with m-1');
  });

  it('pluralises the chip and lists one title line per skipped metric', () => {
    const el = render(LOCAL_ME, {
      ...EMPTY_DRIFT,
      metricsImport: importReport([
        {
          name: 'avg_attendance',
          author: 'u-grace',
          sourceId: 'm-2',
          reason: 'name_clash',
          keptSourceId: 'm-1',
        },
        {
          name: 'goals',
          sourceId: 'm-4',
          reason: 'name_clash',
          keptSourceId: 'm-3',
        },
        {
          name: 'wins',
          author: 'u-ada',
          sourceId: 'm-5',
          reason: 'name_clash',
        },
      ]),
    });
    const chip = byTestId(el, 'metrics-import-pill')!;
    expect(chip.textContent!.trim()).toBe('3 metrics skipped on import');
    expect(chip.title.split('\n')).toEqual([
      'avg_attendance by u-grace — name clash with m-1',
      'goals — name clash with m-3',
      'wins by u-ada — name clash',
    ]);
  });

  it('formats the skipped count', () => {
    expect(metricsSkippedLabel(1)).toBe('1 metric skipped on import');
    expect(metricsSkippedLabel(3)).toBe('3 metrics skipped on import');
  });
});
