/**
 * `npm run eval:export-failures -- --run <run> --out <folder>
 * [--data-dir <dir>] [--force]`
 *
 * Writes what the improvement loop's fixer may read about one run: a README
 * with the dev counts per category and only the counts of the held-out
 * split, and one Markdown file per failed dev question. Refuses a folder that
 * is not empty unless it holds an earlier export and `--force` is given.
 * Exit 0, or 2 on a bad input. No model call. Agents-evals R228.
 */
import { exportFailuresMain } from '../src/mastra/evals/loop/failure-export';

if (require.main === module) {
  void exportFailuresMain(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
