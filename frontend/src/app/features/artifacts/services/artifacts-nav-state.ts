import { Injectable, inject, signal } from '@angular/core';
import { ShellState } from '../../../core/shell/shell-state';

/** The Artifacts area's navigation state: the list and one artifact's page. */
@Injectable({ providedIn: 'root' })
export class ArtifactsNavState {
  private readonly shell = inject(ShellState);

  /** Id of the artifact open on its page. */
  readonly activeArtifactId = signal<string | null>(null);

  /** A card's name, or Open under a saved run, shows the artifact's page. */
  openArtifact(id: string): void {
    if (!this.shell.confirmLeaveAgentEditor()) return;
    this.shell.settingsOpen.set(false);
    this.activeArtifactId.set(id);
    this.shell.mainView.set('artifact-detail');
  }

  /** All artifacts, from an artifact's page. */
  closeArtifactDetail(): void {
    this.shell.mainView.set('artifacts');
  }
}
