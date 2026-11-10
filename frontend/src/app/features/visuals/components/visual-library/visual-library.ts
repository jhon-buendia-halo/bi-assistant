import {
  Component,
  ElementRef,
  Injector,
  OnInit,
  afterNextRender,
  computed,
  inject,
  signal,
} from '@angular/core';
import {
  ChartColumn,
  LucideAngularModule,
  Loader2,
  Pencil,
  Plus,
  Search,
} from 'lucide-angular';
import { VisualsApiService } from '../../services/visuals-api.service';
import {
  VisualChart,
  compareCategories,
} from '../../models/visual-chart.model';
import { VisualChartForm } from '../visual-chart-form/visual-chart-form';
import { VisualPreview } from '../visual-preview/visual-preview';

export interface VisualGroup {
  category: string;
  charts: VisualChart[];
}

function byName(a: VisualChart, b: VisualChart): number {
  return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
}

/**
 * The Context area's "Visuals" section (roadmap 1.21.12): chart types grouped
 * by category, with search, category chips and an in-place editor.
 */
@Component({
  selector: 'app-visual-library',
  imports: [LucideAngularModule, VisualChartForm, VisualPreview],
  templateUrl: './visual-library.html',
})
export class VisualLibrary implements OnInit {
  readonly ChartColumn = ChartColumn;
  readonly Loader2 = Loader2;
  readonly Pencil = Pencil;
  readonly Plus = Plus;
  readonly Search = Search;

  private readonly api = inject(VisualsApiService);
  private readonly host = inject(ElementRef<HTMLElement>);
  private readonly injector = inject(Injector);

  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly charts = signal<VisualChart[]>([]);

  readonly search = signal('');
  /** null = "All". */
  readonly categoryFilter = signal<string | null>(null);

  /** The chart whose card is replaced by the editor, if any. */
  readonly editingId = signal<string | null>(null);
  /** The empty "Add chart" form at the top of the list. */
  readonly adding = signal(false);

  /** Every category present, in heading order. */
  readonly categories = computed(() =>
    [...new Set(this.charts().map((c) => c.category))].sort(compareCategories),
  );

  readonly filtered = computed(() => {
    const query = this.search().trim().toLowerCase();
    const category = this.categoryFilter();
    const editing = this.editingId();
    return this.charts().filter((chart) => {
      // The chart being edited stays put while the filters change.
      if (chart.id === editing) return true;
      if (category !== null && chart.category !== category) return false;
      if (query === '') return true;
      return [
        chart.name,
        chart.description,
        chart.whenToUse,
        chart.category,
      ].some((text) => (text ?? '').toLowerCase().includes(query));
    });
  });

  readonly groups = computed<VisualGroup[]>(() => {
    const byCategory = new Map<string, VisualChart[]>();
    for (const chart of this.filtered()) {
      const list = byCategory.get(chart.category) ?? [];
      list.push(chart);
      byCategory.set(chart.category, list);
    }
    return [...byCategory.keys()].sort(compareCategories).map((category) => ({
      category,
      charts: [...(byCategory.get(category) ?? [])].sort(byName),
    }));
  });

  readonly editingChart = computed(() => {
    const id = this.editingId();
    return id === null
      ? null
      : (this.charts().find((c) => c.id === id) ?? null);
  });

  ngOnInit(): void {
    this.load();
  }

  private load(): void {
    this.loading.set(true);
    this.error.set(null);
    this.api.list().subscribe({
      next: (charts) => {
        this.charts.set(charts);
        this.loading.set(false);
      },
      error: (err) => {
        const detail = err?.error?.message;
        this.error.set(
          typeof detail === 'string' && detail
            ? `Could not load charts: ${detail}`
            : 'Could not load charts',
        );
        this.loading.set(false);
      },
    });
  }

  setCategory(category: string | null): void {
    this.categoryFilter.set(category);
  }

  openNew(): void {
    this.editingId.set(null);
    this.adding.set(true);
    this.scrollToForm();
  }

  /** Opens the editor in place of the clicked card and brings it into view. */
  openEdit(chart: VisualChart): void {
    this.adding.set(false);
    this.editingId.set(chart.id);
    this.scrollToForm();
  }

  closeForm(): void {
    this.adding.set(false);
    this.editingId.set(null);
  }

  onSaved(): void {
    this.closeForm();
    this.load();
  }

  onDeleted(id: string): void {
    this.closeForm();
    this.charts.update((list) => list.filter((c) => c.id !== id));
  }

  private scrollToForm(): void {
    afterNextRender(
      () =>
        (this.host.nativeElement as HTMLElement)
          .querySelector('[data-testid="visual-chart-form"]')
          ?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' }),
      { injector: this.injector },
    );
  }
}
