import { Component, inject } from '@angular/core';
import { ShellState } from '../../../../core/shell/shell-state';
import { ArtifactsNavState } from '../../services/artifacts-nav-state';
import { ArtifactDetail } from '../artifact-detail/artifact-detail';
import { ArtifactsPage } from '../artifacts-page/artifacts-page';

/** The Artifacts area: the list and one artifact's page. */
@Component({
  selector: 'app-artifacts-area',
  imports: [ArtifactsPage, ArtifactDetail],
  templateUrl: './artifacts-area.html',
  styles: ':host { display: contents; }',
})
export class ArtifactsArea {
  readonly shell = inject(ShellState);
  readonly artifacts = inject(ArtifactsNavState);
}
