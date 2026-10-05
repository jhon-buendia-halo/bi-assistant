/**
 * Give a CLI script its own Mastra observability file.
 *
 * `src/mastra/storage.ts` writes traces to DuckDB, which allows one writer per
 * file. The desktop app's backend holds `<APP_DATA_DIR>/observability.duckdb`
 * while it runs, so a script booting the Nest graph against the same
 * APP_DATA_DIR (the eval CLI, `fixtures:register`) would fail every agent call
 * with a lock error. Called before the graph loads, this points the script at
 * a throwaway per-process file under the OS temp dir and removes it on exit —
 * a script's traces are not worth keeping: the eval run log is the record.
 *
 * An operator who sets MASTRA_OBSERVABILITY_PATH themselves keeps it.
 */
import { rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

export function isolateObservability(scriptName: string): void {
  if (process.env.MASTRA_OBSERVABILITY_PATH?.trim()) return;
  const file = join(
    tmpdir(),
    `qti-${scriptName}-observability-${process.pid}.duckdb`,
  );
  process.env.MASTRA_OBSERVABILITY_PATH = file;
  process.once('exit', () => {
    for (const path of [file, `${file}.wal`]) {
      try {
        rmSync(path, { force: true });
      } catch {
        // Best effort: a leftover temp file is harmless.
      }
    }
  });
}
