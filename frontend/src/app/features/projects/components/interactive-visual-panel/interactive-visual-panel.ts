import { Component, computed, inject, input, output, signal } from '@angular/core';
import { DomSanitizer } from '@angular/platform-browser';
import {
  BarChart3,
  ChevronDown,
  Download,
  GalleryVerticalEnd,
  Loader2,
  LucideAngularModule,
  Sparkles,
} from 'lucide-angular';
import {
  InteractiveVisualization,
  ProjectVisualization,
} from '../../models/project.model';

@Component({
  selector: 'app-interactive-visual-panel',
  imports: [LucideAngularModule],
  templateUrl: './interactive-visual-panel.html',
  styleUrl: './interactive-visual-panel.scss',
})
export class InteractiveVisualPanel {
  readonly BarChart3 = BarChart3;
  readonly ChevronDown = ChevronDown;
  readonly Download = Download;
  readonly GalleryVerticalEnd = GalleryVerticalEnd;
  readonly Loader2 = Loader2;
  readonly Sparkles = Sparkles;

  readonly visualization = input<InteractiveVisualization | null>(null);
  readonly visualizations = input<ProjectVisualization[]>([]);
  readonly loading = input(false);
  readonly error = input<string | null>(null);
  readonly downloading = input(false);
  readonly viewVisual = output<ProjectVisualization>();
  readonly downloadVisual = output<InteractiveVisualization>();
  readonly visualMenuOpen = signal(false);

  readonly savedVisualizations = computed(() =>
    this.visualizations().slice().reverse(),
  );

  private readonly sanitizer = inject(DomSanitizer);
  readonly safeDocument = computed(() =>
    this.sanitizer.bypassSecurityTrustHtml(
      this.visualization()?.document ?? '',
    ),
  );

  selectVisualization(visualization: ProjectVisualization): void {
    this.visualMenuOpen.set(false);
    this.viewVisual.emit(visualization);
  }

  formatCreatedAt(createdAt: string): string {
    const date = new Date(createdAt);
    return Number.isNaN(date.getTime())
      ? createdAt
      : date.toLocaleString(undefined, {
          dateStyle: 'medium',
          timeStyle: 'short',
        });
  }
}
