import { Brand } from './brand.model';

/**
 * Agentic Hub (Mercer), as it shipped before the Halo rebrand (ADR-0007,
 * ADR-0045). Only a BRAND=mercer build uses it, in place of brand.ts.
 */
export const BRAND: Brand = {
  id: 'mercer',
  productName: 'Agentic Hub',
  headerTitle: 'US Health Agentic Hub',
  welcomeLead: 'Welcome to',
  welcomeName: 'Agentic Hub',
  shell: 'framed',
  wordmarkLabel: null,
  poweredByLenai: true,
  art: {
    frameTexture: 'brand/agentic-hub/frame-texture.webp',
    banner: 'brand/agentic-hub/banner.webp',
    logoMark: 'brand/agentic-hub/logo-mark.svg',
    lenaiMark: 'brand/agentic-hub/lenai-mark.svg',
    poweredByLenai: 'brand/agentic-hub/powered-by-lenai.svg',
  },
};
