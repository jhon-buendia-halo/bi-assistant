import { Brand } from './brand.model';

/**
 * Halo Workbench, the Halo Powered product: the default brand (ADR-0044,
 * ADR-0046). BRAND=mercer swaps this file for brand.mercer.ts.
 */
export const BRAND: Brand = {
  id: 'halo',
  productName: 'Halo Workbench',
  headerTitle: 'Halo Workbench',
  welcomeLead: 'Welcome to',
  welcomeName: 'Halo Workbench',
  shell: 'flat',
  wordmarkLabel: 'Workbench',
  poweredByLenai: false,
  art: null,
};
