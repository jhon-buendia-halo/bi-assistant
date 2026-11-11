import type { ExportFormat, SyntheticDialect } from '../types';

function slug(name: string): string {
  const s = name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase()
    .slice(0, 64)
    .replace(/-+$/g, '');
  return s || 'dataset';
}

const DIALECT_NAME: Record<SyntheticDialect, string> = {
  postgres: 'postgresql',
  databricks: 'databricks',
};

/** File names of plan 3.2 and 10. `seed` applies to synthetic content only. */
export function exportFileName(
  datasetName: string,
  content: 'synthetic' | 'sample' | 'profile',
  format: ExportFormat,
  dialect: SyntheticDialect,
  seed = 1,
): string {
  const base = slug(datasetName);
  if (content === 'profile')
    return `${base}-profile.${format === 'xlsx' ? 'xlsx' : 'csv'}`;
  const sample = content === 'sample';
  const prefix = sample ? `${base}-sample` : `${base}-synthetic`;
  const seedPart = sample ? '' : `-seed${seed}`;
  if (format === 'csv') return `${prefix}${seedPart}-csv.zip`;
  if (format === 'xlsx') return `${prefix}${seedPart}.xlsx`;
  return `${prefix}-${DIALECT_NAME[dialect]}${seedPart}.sql`;
}
