/**
 * `npm run eval:leak-check -- [--base <ref>] [--staged] [--diff-file <path>]
 * [--fixer] [--json]`
 *
 * Rejects added lines in the improvement loop's lever files that quote a
 * question bank (question words, entity names, numbers, quoted values) from
 * any split, or a planted-facts file. Exit 1 on a rejection, 0 otherwise, 2
 * on a bad input. `--fixer` names no held-out case. Agents-evals R229, R230.
 */
import { leakCheckMain } from '../src/mastra/evals/loop/leak-check';

if (require.main === module) {
  void leakCheckMain(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
