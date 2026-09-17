import { Component, input } from '@angular/core';

/**
 * Halo BI wordmark. Drawn as strokes in `currentColor` so it inherits the
 * surrounding text colour, and sized by cap height rather than by a fixed
 * width so it lines up with the text next to it.
 */
@Component({
  selector: 'app-logo',
  templateUrl: './app-logo.html',
  styleUrl: './app-logo.scss',
})
export class AppLogo {
  /** Cap height of the wordmark in pixels; the width follows the aspect ratio. */
  readonly height = input(14);

  protected get width(): number {
    return Math.round((this.height() * 573) / 113);
  }
}
