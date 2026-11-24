/**
 * `npm run eval:diff -- --before <runs> --after <runs> [--data-dir <dir>]
 * [--target <categories>] [--round <n>] [--lever "<text>"]
 * [--hypothesis "<text>"] [--tsv]`
 *
 * Compares two sides of saved eval runs (run ids, whole or 8-character
 * prefixes, read without writing from `<data dir>/app.sqlite`, or exported
 * run files) and, with `--target`, checks the improvement loop's accept rule.
 * Exit 0, 1 when the accept rule is not met, 2 on a bad input. No model call.
 * What it prints: agents-evals R225 to R227; the loop: docs/evals/loop/.
 */
import { evalDiffMain } from '../src/mastra/evals/loop/eval-diff';

if (require.main === module) {
  void evalDiffMain(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
