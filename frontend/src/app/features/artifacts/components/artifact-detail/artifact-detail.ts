import {
  Component,
  OnInit,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { DomSanitizer } from '@angular/platform-browser';
import {
  ArrowLeft,
  Loader2,
  LucideAngularModule,
  Pencil,
  Play,
  Trash2,
} from 'lucide-angular';
import { WorkflowDesigner } from '../../../workflows/services/workflow-designer.service';
import { WorkflowsNavState } from '../../../workflows/services/workflows-nav-state';
import { Artifact } from '../../models/artifact.model';
import { ArtifactsApiService } from '../../services/artifacts-api.service';
import {
  artifactCountsLabel,
  artifactKindLabel,
} from '../../services/artifacts.util';

/** The workflow an artifact is handed to, and the field that takes its id. */
const USE_WORKFLOW_ID = 'map-dashboard-data';
const USE_FIELD = 'artifact';

/**
 * One artifact's page: its name (renamed in place), kind, counts, the original
 * image and the document in a sandboxed frame, and Delete, which asks first.
 */
@Component({
  selector: 'app-artifact-detail',
  imports: [LucideAngularModule],
  templateUrl: './artifact-detail.html',
})
export class ArtifactDetail implements OnInit {
  protected readonly ArrowLeft = ArrowLeft;
  protected readonly Loader2 = Loader2;
  protected readonly Pencil = Pencil;
  protected readonly Play = Play;
  protected readonly Trash2 = Trash2;

  private readonly api = inject(ArtifactsApiService);
  private readonly sanitizer = inject(DomSanitizer);
  private readonly designer = inject(WorkflowDesigner);
  private readonly workflowsNav = inject(WorkflowsNavState);

  readonly artifactId = input.required<string>();
  /** Back to the list. */
  readonly back = output<void>();

  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);
  protected readonly artifact = signal<Artifact | null>(null);

  protected readonly renaming = signal(false);
  protected readonly draftName = signal('');
  protected readonly nameError = signal<string | null>(null);
  protected readonly saving = signal(false);

  protected readonly confirmingDelete = signal(false);
  protected readonly deleting = signal(false);
  protected readonly deleteError = signal<string | null>(null);

  protected readonly counts = computed(() => {
    const artifact = this.artifact();
    return artifact === null ? '' : artifactCountsLabel(artifact);
  });
  protected readonly kind = computed(() => {
    const artifact = this.artifact();
    return artifact === null ? '' : artifactKindLabel(artifact.kind);
  });
  /** The stored document is the app's own output, shown only inside a sandbox. */
  protected readonly safeDocument = computed(() =>
    this.sanitizer.bypassSecurityTrustHtml(this.artifact()?.document ?? ''),
  );
  protected readonly imageUrl = computed(() =>
    this.api.imageUrl(this.artifactId()),
  );

  ngOnInit(): void {
    this.api.get(this.artifactId()).subscribe({
      next: (artifact) => {
        this.artifact.set(artifact);
        this.loading.set(false);
      },
      error: (err) => {
        this.error.set(err?.error?.message ?? 'Backend unreachable');
        this.loading.set(false);
      },
    });
  }

  protected startRename(): void {
    const artifact = this.artifact();
    if (artifact === null) return;
    this.draftName.set(artifact.name);
    this.nameError.set(null);
    this.renaming.set(true);
  }

  protected cancelRename(): void {
    this.renaming.set(false);
    this.nameError.set(null);
  }

  protected onNameInput(event: Event): void {
    this.draftName.set((event.target as HTMLInputElement).value);
    this.nameError.set(null);
  }

  protected saveRename(): void {
    const artifact = this.artifact();
    if (artifact === null || this.saving()) return;
    const name = this.draftName().trim();
    if (!name) {
      this.nameError.set('Name is required');
      return;
    }
    if (name.length > 80) {
      this.nameError.set('Name must be at most 80 characters');
      return;
    }
    this.saving.set(true);
    this.api.rename(artifact.id, name).subscribe({
      next: (summary) => {
        this.artifact.set({ ...artifact, ...summary });
        this.saving.set(false);
        this.renaming.set(false);
      },
      error: (err) => {
        this.nameError.set(err?.error?.message ?? 'Backend unreachable');
        this.saving.set(false);
      },
    });
  }

  protected confirmDelete(): void {
    const artifact = this.artifact();
    if (artifact === null || this.deleting()) return;
    this.deleting.set(true);
    this.deleteError.set(null);
    this.api.delete(artifact.id).subscribe({
      next: () => {
        this.deleting.set(false);
        this.back.emit();
      },
      error: (err) => {
        this.deleteError.set(err?.error?.message ?? 'Backend unreachable');
        this.deleting.set(false);
      },
    });
  }

  /** Opens Map a Dashboard to Data with this artifact picked. */
  protected useInWorkflow(): void {
    const artifact = this.artifact();
    if (artifact === null) return;
    this.designer.prefillOnLoad({ [USE_FIELD]: artifact.id });
    this.workflowsNav.openWorkflow(USE_WORKFLOW_ID);
  }
}
