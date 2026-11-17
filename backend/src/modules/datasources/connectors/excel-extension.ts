import { existsSync } from 'fs';
import { join } from 'path';
import { version as duckdbVersion } from '@duckdb/node-api';

/**
 * The `excelExtension` option every caller of the importer passes
 * (`detectSheets`, `importFiles`; ADR-0052, plan m1-31 section 9): the path of
 * the shipped `excel.duckdb_extension`, so `LOAD` never reaches the network.
 *
 * The file lives at `<backend root>/vendor/duckdb-extensions/v<version>/
 * <platform>/excel.duckdb_extension` (delivery.md 2): `scripts/bootstrap.mjs`
 * fetches it in development, the staged backend and the npm package carry it.
 * `<version>` is the loaded DuckDB library's own `version()` (`v1.5.2`), not a
 * constant, so a DuckDB upgrade without a matching fetch fails with the
 * missing-file error instead of loading an incompatible binary. `__dirname`
 * keeps meaning this file's place in `dist/` once bundled, so four levels up is
 * the backend root from `src/`, `dist/` and the bundle alike.
 */
export function excelExtension(): string {
  const version = duckdbVersion();
  const platform = duckdbPlatform();
  const file = join(
    __dirname,
    '..',
    '..',
    '..',
    '..',
    'vendor',
    'duckdb-extensions',
    version,
    platform,
    'excel.duckdb_extension',
  );
  if (!existsSync(file)) {
    throw new Error(
      `Excel support is missing from this installation (DuckDB ${version}, ${platform})`,
    );
  }
  return file;
}

/** DuckDB's platform name for this machine (`windows_amd64`, `osx_arm64`, …). */
export function duckdbPlatform(
  platform: string = process.platform,
  arch: string = process.arch,
): string {
  const os = { win32: 'windows', darwin: 'osx', linux: 'linux' }[platform] ?? platform;
  const cpu = { x64: 'amd64', arm64: 'arm64' }[arch] ?? arch;
  return `${os}_${cpu}`;
}
