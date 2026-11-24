import type { ExportBrand } from './conversation-export.contract';

/**
 * The brand an export is drawn in (agents.md 3.18): `APP_BRAND=mercer` for
 * an Agentic Hub build, Halo otherwise. The backend has no other word of
 * the build's brand (the renderer's brand.json stays in the app).
 */
export function exportBrand(
  value: string | undefined = process.env.APP_BRAND,
): ExportBrand {
  return value?.trim().toLowerCase() === 'mercer' ? 'mercer' : 'halo';
}
