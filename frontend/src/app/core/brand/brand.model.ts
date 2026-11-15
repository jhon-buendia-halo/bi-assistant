/**
 * What the renderer needs to know about the brand it was built for
 * (ADR-0045). The build picks one: `brand.ts` (Halo Powered, the default) or,
 * for BRAND=mercer, `brand.mercer.ts` swapped in by Angular's
 * fileReplacements, so one brand's names never reach the other's bundle.
 * Colours, fonts and images are per brand too, under frontend/brands/<id>/.
 */
export interface Brand {
  readonly id: 'halo' | 'mercer';
  /** Window and document title, and the Settings build identity ("<name> v1.2.3"). */
  readonly productName: string;
  /** The header's level-one heading (app-shell R7). */
  readonly headerTitle: string;
  /** The welcome heading: `welcomeLead` then `welcomeName` (app-shell R51). */
  readonly welcomeLead: string;
  readonly welcomeName: string;
  /**
   * `flat`: full-height rail, 48 px header with the open area as a breadcrumb,
   * dotted canvas (ADR-0044). `framed`: textured gradient frame, photo banner
   * and rounded panels (ADR-0007).
   */
  readonly shell: 'flat' | 'framed';
  /** The "Powered by LenAI" mark at the foot of the rail. */
  readonly poweredByLenai: boolean;
  /** Images of the framed shell, under the brand's public/ folder; null for the flat shell. */
  readonly art: BrandArt | null;
}

export interface BrandArt {
  /** Texture laid over the frame gradient (multiply). */
  readonly frameTexture: string;
  /** Photo behind the banner title. */
  readonly banner: string;
  /** White mark inside the rail's gradient logo circle. */
  readonly logoMark: string;
  readonly lenaiMark: string;
  readonly poweredByLenai: string;
}
