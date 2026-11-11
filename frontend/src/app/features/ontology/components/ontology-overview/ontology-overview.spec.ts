import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Component, input } from '@angular/core';
import { of, throwError } from 'rxjs';
import { OntologyOverview } from './ontology-overview';
import { OntologyPanel } from '../ontology-panel/ontology-panel';
import { DatasetsApiService } from '../../../datasets/services/datasets-api.service';
import { OntologyApiService } from '../../services/ontology-api.service';
import type { OntologyItem } from '../../models/ontology.model';

function item(
  id: string,
  kind: OntologyItem['kind'],
  dataset: string | null,
  extra: Partial<OntologyItem> = {},
): OntologyItem {
  return {
    id,
    kind,
    name: id,
    description: '',
    dataset,
    enabled: true,
    source: 'user',
    createdAt: '2026-11-09T00:00:00Z',
    updatedAt: '2026-11-09T00:00:00Z',
    ...extra,
  } as OntologyItem;
}

/** Stands in for the real panel, which has its own spec. */
@Component({ selector: 'app-ontology-panel', standalone: true, template: '' })
class PanelStub {
  readonly dataset = input<unknown>();
}

describe('OntologyOverview (dataset-ontology R40)', () => {
  let fixture: ComponentFixture<OntologyOverview>;
  let list: jasmine.Spy;

  const ITEMS: Record<string, OntologyItem[]> = {
    'World Cup': [
      item('c1', 'concept', 'World Cup'),
      item('c2', 'concept', 'World Cup', { source: 'mined', enabled: false }),
      item('r1', 'relation', 'World Cup'),
      item('s1', 'instruction', null),
    ],
    'Formula 1': [item('s1', 'instruction', null)],
  };

  async function setup(failFor?: string): Promise<void> {
    list = jasmine
      .createSpy('list')
      .and.callFake((name: string) =>
        name === failFor ? throwError(() => new Error('x')) : of(ITEMS[name] ?? []),
      );
    await TestBed.configureTestingModule({
      imports: [OntologyOverview],
      providers: [
        {
          provide: DatasetsApiService,
          useValue: {
            getDatasets: () =>
              of({
                datasets: [
                  { name: 'World Cup', tables: [] },
                  { name: 'Formula 1', tables: [] },
                ],
              }),
          },
        },
        { provide: OntologyApiService, useValue: { list } },
      ],
    })
      // The panel has its own spec; here it only needs to render by name.
      .overrideComponent(OntologyOverview, {
        remove: { imports: [OntologyPanel] },
        add: { imports: [PanelStub] },
      })
      .compileComponents();
    fixture = TestBed.createComponent(OntologyOverview);
    fixture.detectChanges();
  }

  const el = () => fixture.nativeElement as HTMLElement;
  const q = (id: string) => el().querySelector(`[data-testid="${id}"]`) as HTMLElement | null;

  it('lists every dataset by name with the size of its own ontology', async () => {
    await setup();
    const rows = Array.from(el().querySelectorAll('[data-testid^="ontology-dataset-"]'));
    expect(rows.map((r) => r.getAttribute('data-testid'))).toEqual([
      'ontology-dataset-Formula 1',
      'ontology-dataset-World Cup',
    ]);
    expect(q('ontology-dataset-World Cup')!.textContent).toContain('2 concepts · 1 relation');
    expect(q('ontology-dataset-Formula 1')!.textContent).toContain('No ontology yet');
    expect(q('ontology-pending-World Cup')!.textContent).toContain('1 pending');
    expect(q('ontology-pending-Formula 1')).toBeNull();
    // Shared items are counted once, not per dataset.
    expect(q('ontologies-shared')!.textContent).toContain('1 shared item applies to every dataset');
  });

  it('opens the Ontology panel for a dataset and comes back with fresh counts', async () => {
    await setup();
    q('ontology-dataset-World Cup')!.click();
    fixture.detectChanges();
    // The panel is deferred (kept out of the initial bundle).
    await fixture.whenStable();
    fixture.detectChanges();
    expect(q('ontology-overview-dataset')).toBeTruthy();
    expect(el().querySelector('app-ontology-panel')).toBeTruthy();
    expect(el().textContent).toContain('World Cup');

    const calls = list.calls.count();
    q('ontologies-back')!.click();
    fixture.detectChanges();
    expect(q('ontology-overview')).toBeTruthy();
    expect(list.calls.count()).toBeGreaterThan(calls);
  });

  it('marks a dataset whose ontology cannot be read, and still lists the others', async () => {
    await setup('Formula 1');
    expect(q('ontology-dataset-Formula 1')!.textContent).toContain('Could not read this ontology');
    expect(q('ontology-dataset-World Cup')!.textContent).toContain('2 concepts');
  });
});
