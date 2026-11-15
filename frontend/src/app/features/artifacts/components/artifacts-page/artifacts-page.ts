import {
  Component,
  OnInit,
  computed,
  inject,
  output,
  signal,
} from '@angular/core';
import { Boxes, Loader2, LucideAngularModule, Search } from 'lucide-angular';
import { ArtifactSummary } from '../../models/artifact.model';
import { ArtifactsApiService } from '../../services/artifacts-api.service';
import {
  artifactCountsLabel,
  artifactKindLabel,
  filterArtifacts,
} from '../../services/artifacts.util';

/**
 * The Artifacts page: reusable context saved from workflow runs, newest
 * first, with search. The search resets each time the page opens.
 */
@Component({
  selector: 'app-artifacts-page',
  imports: [LucideAngularModule],
  templateUrl: './artifacts-page.html',
})
export class ArtifactsPage implements OnInit {
  readonly Boxes = Boxes;
  readonly Loader2 = Loader2;
  readonly Search = Search;

  private readonly api = inject(ArtifactsApiService);

  /** A card's name; the area opens the artifact's page. */
  readonly openArtifact = output<string>();

  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly artifacts = signal<ArtifactSummary[]>([]);
  readonly query = signal('');

  readonly shown = computed(() =>
    filterArtifacts(this.artifacts(), this.query()),
  );

  ngOnInit(): void {
    this.api.list().subscribe({
      next: (artifacts) => {
        this.artifacts.set(artifacts);
        this.loading.set(false);
      },
      error: (err) => {
        this.error.set(err?.error?.message ?? 'Backend unreachable');
        this.loading.set(false);
      },
    });
  }

  onSearch(event: Event): void {
    this.query.set((event.target as HTMLInputElement).value);
  }

  protected imageUrl(id: string): string {
    return this.api.imageUrl(id);
  }

  protected counts(artifact: ArtifactSummary): string {
    return artifactCountsLabel(artifact);
  }

  protected kind(artifact: ArtifactSummary): string {
    return artifactKindLabel(artifact.kind);
  }
}
