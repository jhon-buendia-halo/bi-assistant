import { Zip, ZipDeflate, strToU8 } from 'fflate';
import type { GeneratedTable } from '../generator/contract';
import { csvRow, csvValuesRow } from './csv';

const BATCH_ROWS = 1000;

/**
 * Streams one `<targetName>.csv` per table plus `README.txt` into `out`, table by table
 * (the zip is never held whole in memory). Resolves with the rows written.
 */
export function writeCsvZip(
  tables: Iterable<GeneratedTable>,
  readme: string[],
  out: NodeJS.WritableStream,
): Promise<{ rows: number }> {
  return new Promise((resolve, reject) => {
    let rows = 0;
    let failed = false;
    const fail = (err: unknown) => {
      if (failed) return;
      failed = true;
      reject(err instanceof Error ? err : new Error(String(err)));
    };
    const zip = new Zip((err, chunk, final) => {
      if (err) return fail(err);
      out.write(Buffer.from(chunk));
      if (final) out.end(() => resolve({ rows }));
    });
    try {
      const readmeFile = new ZipDeflate('README.txt', { level: 6 });
      zip.add(readmeFile);
      readmeFile.push(strToU8(readme.join('\r\n') + '\r\n'), true);

      for (const table of tables) {
        const file = new ZipDeflate(`${table.targetName}.csv`, { level: 6 });
        zip.add(file);
        file.push(strToU8(csvRow(table.columns.map((c) => c.name))), false);
        let batch: string[] = [];
        for (const row of table.rows) {
          batch.push(csvValuesRow(row));
          rows++;
          if (batch.length >= BATCH_ROWS) {
            file.push(strToU8(batch.join('')), false);
            batch = [];
          }
        }
        file.push(strToU8(batch.join('')), true);
      }
      zip.end();
    } catch (err) {
      fail(err);
    }
  });
}
