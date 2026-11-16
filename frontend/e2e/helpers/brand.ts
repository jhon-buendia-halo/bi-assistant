import fs from 'node:fs';
import path from 'node:path';

/** A brand the app can be built for (ADR-0045). */
export type BrandId = 'halo' | 'mercer';

/**
 * The brand of the web build under test: `backend/public/brand.json`, written
 * by `node scripts/brand.mjs ng-build` and copied there by copy-web. Halo when
 * the file is missing (an older build).
 */
export function builtBrand(): BrandId {
  try {
    const file = path.resolve(__dirname, '../../../backend/public/brand.json');
    const id = JSON.parse(fs.readFileSync(file, 'utf8')).id;
    return id === 'mercer' ? 'mercer' : 'halo';
  } catch {
    return 'halo';
  }
}

/** The brand's own settings (frontend/brands/<id>/brand.json). */
export function brandConfig(id: BrandId = builtBrand()): {
  osName: string;
  windowTitle: string;
  canvas: { light: string; dark: string };
} {
  const file = path.resolve(__dirname, '../../brands', id, 'brand.json');
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}
