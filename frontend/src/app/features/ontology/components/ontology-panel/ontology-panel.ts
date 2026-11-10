import { NgTemplateOutlet } from '@angular/common';
import {
  Component,
  ElementRef,
  Injector,
  OnInit,
  afterNextRender,
  computed,
  inject,
  input,
  signal,
} from '@angular/core';
import {
  LucideAngularModule,
  Check,
  FileText,
  Filter,
  Globe,
  Loader2,
  Network,
  Pencil,
  Plus,
  Share2,
  Sparkles,
  Tag,
  Trash2,
  Wand2,
  X,
} from 'lucide-angular';
import {
  OntologyApiService,
  OntologyBootstrapProgress,
} from '../../services/ontology-api.service';
import {
  ONTOLOGY_KINDS,
  OntologyItem,
  OntologyKind,
  isPending,
  mappingLabel,
  ontologyKindAccentClass,
  ontologyKindDescription,
  ontologyKindLabel,
} from '../../models/ontology.model';
import { Dataset } from '../../../datasets/services/datasets-api.service';
import { MetricsApiService } from '../../../datasets/services/metrics-api.service';
import { Metric } from '../../../datasets/models/metric.model';
import { ToastService } from '../../../../core/toast/toast.service';
import { OntologyItemForm } from '../ontology-item-form/ontology-item-form';
import { OntologyGraph } from '../ontology-graph/ontology-graph';

/** `graph` swaps the sections list for the relations graph (1.21.10). */
type KindFilter = 'all' | OntologyKind | 'graph';

/**
 * The dataset editor's Ontology tab (BA-320): the dataset's concepts,
 * relations, constraints and instructions plus the shared ones, with the
 * mined suggestions waiting for review.
 */
@Component({
  selector: 'app-ontology-panel',
  imports: [LucideAngularModule, NgTemplateOutlet, OntologyItemForm, OntologyGraph],
  templateUrl: './ontology-panel.html',
})
export class OntologyPanel implements OnInit {
  readonly Check = Check;
  readonly Globe = Globe;
  readonly Loader2 = Loader2;
  readonly Network = Network;
  readonly Pencil = Pencil;
  readonly Plus = Plus;
  readonly Sparkles = Sparkles;
  readonly Trash2 = Trash2;
  readonly Wand2 = Wand2;
  readonly X = X;

  readonly kinds = ONTOLOGY_KINDS;
  readonly kindLabel = ontologyKindLabel;
  readonly kindDescription = ontologyKindDescription;
  readonly kindAccentClass = ontologyKindAccentClass;

  private readonly api = inject(OntologyApiService);
  private readonly metricsApi = inject(MetricsApiService);
  private readonly toast = inject(ToastService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);

  /** The dataset being edited, with its tables and entities snapshot. */
  readonly dataset = input.required<Dataset>();

  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly items = signal<OntologyItem[]>([]);
  readonly metrics = signal<Metric[]>([]);

  readonly kindFilter = signal<KindFilter>('all');
  readonly pendingOnly = signal(false);

  readonly formOpen = signal(false);
  readonly editingItem = signal<OntologyItem | null>(null);

  readonly generateOpen = signal(false);
  readonly generating = signal(false);
  /** What the run is doing, oldest first — the last one is still in flight. */
  readonly generateSteps = signal<OntologyBootstrapProgress[]>([]);

  readonly togglingId = signal<string | null>(null);
  readonly deletingId = signal<string | null>(null);

  readonly concepts = computed(() =>
    this.items().filter((i) => i.kind === 'concept'),
  );

  readonly pendingItems = computed(() => this.items().filter(isPending));
  readonly pendingCount = computed(() => this.pendingItems().length);

  readonly graphView = computed(() => this.kindFilter() === 'graph');

  /**
   * What the graph draws: every concept and relation, or — with Pending
   * suggestions on — only the pending ones plus the concepts they connect.
   */
  readonly graphItems = computed(() => {
    const drawable = this.items().filter(
      (i) => i.kind === 'concept' || i.kind === 'relation',
    );
    if (!this.pendingOnly()) return drawable;
    const pending = drawable.filter(isPending);
    const endpoints = new Set<string>();
    for (const rel of pending) {
      if (rel.kind !== 'relation') continue;
      if (rel.from) endpoints.add(rel.from);
      if (rel.to) endpoints.add(rel.to);
    }
    return drawable.filter(
      (i) => isPending(i) || (i.kind === 'concept' && endpoints.has(i.id)),
    );
  });

  /** One section per kind, in the contract's order, after the kind filter. */
  readonly sections = computed(() => {
    const filter = this.kindFilter();
    return this.kinds
      .filter((k) => filter === 'all' || k.value === filter)
      .map((k) => ({
        kind: k.value,
        title: k.section,
        items: this.items().filter((i) => i.kind === k.value),
      }));
  });

  ngOnInit(): void {
    this.loadItems();
    this.metricsApi.list(this.dataset().tables ?? []).subscribe({
      next: (res) => this.metrics.set(res.metrics ?? []),
      error: () => this.metrics.set([]),
    });
  }

  loadItems(): void {
    this.loading.set(true);
    this.error.set(null);
    this.api.list(this.dataset().name).subscribe({
      next: (items) => {
        this.items.set(items);
        this.loading.set(false);
      },
      error: (err) => {
        this.error.set(err?.error?.message ?? 'Backend unreachable');
        this.loading.set(false);
      },
    });
  }

  setKindFilter(kind: KindFilter): void {
    this.pendingOnly.set(false);
    this.kindFilter.set(kind);
  }

  /** The graph keeps the Pending suggestions toggle as it is. */
  showGraph(): void {
    this.kindFilter.set('graph');
  }

  togglePendingOnly(): void {
    this.pendingOnly.set(!this.pendingOnly());
  }

  kindIcon(kind: OntologyKind) {
    switch (kind) {
      case 'concept':
        return Tag;
      case 'relation':
        return Share2;
      case 'constraint':
        return Filter;
      case 'instruction':
        return FileText;
    }
  }

  /** The one-line body summary a row shows, per kind. */
  summary(item: OntologyItem): string {
    switch (item.kind) {
      case 'concept': {
        const maps = (item.mappings ?? []).map(mappingLabel);
        return maps.length
          ? `${item.description} · maps to ${maps.join(', ')}`
          : item.description;
      }
      case 'relation': {
        const target =
          item.type === 'measured-by'
            ? this.metricLabel(item.metricId)
            : this.conceptName(item.to);
        return [this.conceptName(item.from), item.type, target]
          .filter(Boolean)
          .join(' ');
      }
      case 'constraint':
        return item.description
          ? `${item.predicate ?? ''} · when ${item.description}`
          : (item.predicate ?? '');
      case 'instruction':
        return item.description;
    }
  }

  private conceptName(id: string | undefined): string {
    if (!id) return '';
    return this.items().find((i) => i.id === id)?.name ?? '(missing concept)';
  }

  private metricLabel(id: string | undefined): string {
    if (!id) return '';
    const metric = this.metrics().find((m) => m.id === id);
    return metric ? metric.label || metric.name : id;
  }

  openNew(): void {
    this.generateOpen.set(false);
    this.editingItem.set(null);
    this.formOpen.set(true);
  }

  /**
   * Opens the editor in place: the row turns into the form where it was
   * clicked (in the graph view, under the graph). The form is then brought
   * fully into view, since a row near the bottom would leave it cut off.
   */
  openEdit(item: OntologyItem): void {
    this.generateOpen.set(false);
    this.editingItem.set(item);
    this.formOpen.set(true);
    afterNextRender(
      () =>
        this.host.nativeElement
          .querySelector('[data-testid="ontology-form-anchor"]')
          ?.scrollIntoView?.({ block: 'nearest' }),
      { injector: this.injector },
    );
  }

  /** The graph's Edit: the same in-place editor, under the graph. */
  editFromGraph(item: OntologyItem): void {
    this.openEdit(item);
  }

  cancelForm(): void {
    this.formOpen.set(false);
    this.editingItem.set(null);
  }

  onItemSaved(): void {
    this.formOpen.set(false);
    this.editingItem.set(null);
    this.loadItems();
  }

  /** Enable/disable — also how a pending suggestion is accepted. */
  toggleEnabled(item: OntologyItem): void {
    if (this.togglingId()) return;
    const next = !item.enabled;
    this.togglingId.set(item.id);
    this.api.update(item.id, { enabled: next }).subscribe({
      next: (updated) => {
        this.togglingId.set(null);
        this.items.update((list) =>
          list.map((i) => (i.id === updated.id ? updated : i)),
        );
        this.toast.success(next ? 'Item enabled' : 'Item disabled');
      },
      error: (err) => {
        this.togglingId.set(null);
        this.toast.error(err?.error?.message ?? 'Backend unreachable');
      },
    });
  }

  /** The confirm text the contract fixes for a delete. */
  deleteConfirmText(item: OntologyItem): string {
    const base = `Delete “${item.name}”? The assistant will stop using it.`;
    return item.kind === 'concept'
      ? `${base} Its relations are deleted too.`
      : base;
  }

  deleteItem(item: OntologyItem): void {
    if (!window.confirm(this.deleteConfirmText(item))) return;
    this.remove(item);
  }

  /** Reject a mined suggestion — deletes it, same as a regular delete. */
  rejectSuggestion(item: OntologyItem): void {
    const confirmed = window.confirm(
      `Reject “${item.name}”?\n\nThis permanently removes the suggestion.`,
    );
    if (!confirmed) return;
    this.remove(item);
  }

  private remove(item: OntologyItem): void {
    this.deletingId.set(item.id);
    this.api.remove(item.id).subscribe({
      next: () => {
        this.deletingId.set(null);
        this.toast.success('Item deleted');
        if (item.kind === 'concept') {
          // Its relations went with it, and constraints lost the link.
          this.loadItems();
        } else {
          this.items.update((list) => list.filter((i) => i.id !== item.id));
        }
      },
      error: (err) => {
        this.deletingId.set(null);
        this.toast.error(err?.error?.message ?? 'Backend unreachable');
      },
    });
  }

  openGenerate(): void {
    this.formOpen.set(false);
    this.generateSteps.set([]);
    this.generateOpen.set(true);
  }

  cancelGenerate(): void {
    if (this.generating()) return;
    this.generateOpen.set(false);
    this.generateSteps.set([]);
  }

  /**
   * The step currently in flight — the last one reported. Falls back to a
   * starting line so the panel never shows an empty box between the click
   * and the backend's first progress event.
   */
  currentStep(): OntologyBootstrapProgress | null {
    if (!this.generating()) return null;
    const steps = this.generateSteps();
    return steps.length
      ? steps[steps.length - 1]
      : { key: 'start', message: 'Starting' };
  }

  /** Steps already finished — everything before the one in flight. */
  finishedSteps(): OntologyBootstrapProgress[] {
    const steps = this.generateSteps();
    return this.generating() ? steps.slice(0, -1) : steps;
  }

  generateSuggestions(): void {
    if (this.generating()) return;
    this.generating.set(true);
    this.generateSteps.set([]);
    void this.api.bootstrapStream(this.dataset().name, {
      onProgress: (progress) => this.recordStep(progress),
      onDone: (created) => {
        this.generating.set(false);
        this.generateOpen.set(false);
        this.generateSteps.set([]);
        const count = created.length;
        this.toast.success(
          count === 0
            ? 'No new suggestions this time'
            : `${count} suggestion${count === 1 ? '' : 's'} generated — review in Pending suggestions`,
        );
        this.pendingOnly.set(true);
        this.loadItems();
      },
      onError: (message) => {
        this.generating.set(false);
        this.generateSteps.set([]);
        this.toast.error(
          message || 'Could not generate suggestions — try again shortly',
        );
      },
    });
  }

  /**
   * Append a step, or replace the last one when it is the same stage — a
   * stage that counts up (sampling 2 of 5 tables) rewrites its own line.
   */
  private recordStep(progress: OntologyBootstrapProgress): void {
    this.generateSteps.update((steps) => {
      const last = steps[steps.length - 1];
      return last?.key === progress.key
        ? [...steps.slice(0, -1), progress]
        : [...steps, progress];
    });
  }
}
