import { Component, input } from '@angular/core';

/**
 * The HALO wordmark (halopowered.com), filled with `currentColor` so it
 * inherits the surrounding text colour. Sized by height; the width follows
 * the aspect ratio. `mark` draws only the notched O, for narrow places such
 * as the collapsed navigation rail.
 */
@Component({
  selector: 'app-logo',
  templateUrl: './app-logo.html',
  styleUrl: './app-logo.scss',
})
export class AppLogo {
  /** Height in pixels; the width follows the aspect ratio. */
  readonly height = input(16);
  /** Only the O, square. */
  readonly mark = input(false);
  /** Accessible name of the image. */
  readonly label = input('Halo');

  protected get width(): number {
    return Math.round((this.height() * (this.mark() ? 48 : 187)) / 46);
  }
}
