import { Brand } from './brand.model';

/** Halo Powered: the default brand (ADR-0044). BRAND=mercer swaps this file for brand.mercer.ts. */
export const BRAND: Brand = {
  id: 'halo',
  productName: 'Halo Powered',
  headerTitle: 'Halo Powered',
  welcomeLead: 'Welcome to',
  welcomeName: 'Halo Powered',
  shell: 'flat',
  poweredByLenai: false,
  art: null,
};
