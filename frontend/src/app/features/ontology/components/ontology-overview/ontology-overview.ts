import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { forkJoin, of } from 'rxjs';
import { catchError, map, switchMap } from 'rxjs/operators';
import {
  ArrowLeft,
  ChevronRight,
  Globe,
  Loader2,
  LucideAngularModule,
  Network,
} from 'lucide-angular';
import {
  Dataset,
  DatasetsApiService,
} from '../../../datasets/services/datasets-api.service';
import { OntologyApiService } from '../../services/ontology-api.service';
import { isPending, OntologyItem } from '../../models/ontology.model';
import { OntologyPanel } from '../ontology-panel/ontology-panel';

/** One dataset's row on the Ontologies page: its own items, by kind. */
export interface OntologySummary {
  dataset: Dataset;
  concepts: number;
  relations: number;
  constraints: number;
  instructions: number;
  pending: number;
  /** True when this dataset's ontology could not be read. */
  failed: boolean;
}

/**
 * The Context area's Ontologies section (dataset-ontology R40): every
 * dataset with the size of its ontology; choosing one opens the same
 * Ontology panel the dataset editor shows, so both places edit one thing.
 */
@Component({
  selector: 'app-ontology-overview',
  standalone: true,
  imports: [LucideAngularModule, OntologyPanel],
  templateUrl: './ontology-overview.html',
})
export class OntologyOverview implements OnInit {
  private readonly datasetsApi = inject(DatasetsApiService);
  private readonly ontologyApi = inject(OntologyApiService);

  protected readonly ArrowLeft = ArrowLeft;
  protected readonly ChevronRight = ChevronRight;
  protected readonly Globe = Globe;
  protected readonly Loader2 = Loader2;
  protected readonly Network = Network;

  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly summaries = signal<OntologySummary[]>([]);
  /** Items shared by every dataset (counted once, not per dataset). */
  readonly sharedCount = signal(0);
  readonly selected = signal<Dataset | null>(null);

  readonly totalItems = computed(() =>
    this.summaries().reduce(
      (n, s) => n + s.concepts + s.relations + s.constraints + s.instructions,
      0,
    ),
  );

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.loading.set(true);
    this.error.set(null);
    this.datasetsApi
      .getDatasets()
      .pipe(
        map((res) => res.datasets ?? []),
        switchMap((datasets) =>
          datasets.length === 0
            ? of([] as { dataset: Dataset; items: OntologyItem[] | null }[])
            : forkJoin(
                datasets.map((dataset) =>
                  this.ontologyApi.list(dataset.name).pipe(
                    map((items) => ({ dataset, items })),
                    catchError(() => of({ dataset, items: null })),
                  ),
                ),
              ),
        ),
      )
      .subscribe({
        next: (rows) => {
          let shared = 0;
          this.summaries.set(
            [...rows]
              .sort((a, b) =>
                a.dataset.name.localeCompare(b.dataset.name, undefined, {
                  sensitivity: 'base',
                }),
              )
              .map(({ dataset, items }) => {
                const own = (items ?? []).filter((i) => i.dataset !== null);
                shared = Math.max(
                  shared,
                  (items ?? []).filter((i) => i.dataset === null).length,
                );
                const count = (kind: OntologyItem['kind']) =>
                  own.filter((i) => i.kind === kind).length;
                return {
                  dataset,
                  concepts: count('concept'),
                  relations: count('relation'),
                  constraints: count('constraint'),
                  instructions: count('instruction'),
                  pending: own.filter(isPending).length,
                  failed: items === null,
                };
              }),
          );
          this.sharedCount.set(shared);
          this.loading.set(false);
        },
        error: () => {
          this.error.set('Could not load the datasets');
          this.loading.set(false);
        },
      });
  }

  open(dataset: Dataset): void {
    this.selected.set(dataset);
  }

  /** Back to the list; counts are reloaded since the user may have edited. */
  back(): void {
    this.selected.set(null);
    this.load();
  }

  /** "3 concepts · 1 relation" — only the kinds present. */
  countsLine(s: OntologySummary): string {
    const part = (n: number, one: string, many: string) =>
      n ? `${n} ${n === 1 ? one : many}` : '';
    const parts = [
      part(s.concepts, 'concept', 'concepts'),
      part(s.relations, 'relation', 'relations'),
      part(s.constraints, 'constraint', 'constraints'),
      part(s.instructions, 'instruction', 'instructions'),
    ].filter(Boolean);
    return parts.length ? parts.join(' · ') : 'No ontology yet';
  }
}
