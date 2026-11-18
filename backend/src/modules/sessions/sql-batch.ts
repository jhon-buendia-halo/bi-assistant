/**
 * The SQL batches of a run (agents.md 5.13 Rows behind findings, 5.20 Infer
 * lineage and Probe evidence): a few statements at a time, each outcome
 * committed in the batch's order, so what a batch records, and every event
 * it emits, is exactly the sequence a one-by-one run produces.
 */

/** Statements of one batch that may run at the same time. */
export const SQL_BATCH_CONCURRENCY = 4;

/** How one statement of a batch ended. */
export type BatchOutcome<R> =
  { ok: true; value: R } | { ok: false; error: unknown };

/**
 * Start `items` at most `limit` at a time, each given the run's `signal`,
 * and hand each outcome to `commit` in item order: an outcome is committed
 * only once every earlier one is. A failed statement is committed as a
 * failure and the batch goes on.
 *
 * Once `signal` aborts no statement starts; the ones in flight end through
 * the signal (their runner cancels them), and the batch stops committing at
 * the first statement that did not run or failed under the stop, so what was
 * committed is a prefix, as a one-by-one run's is.
 */
export async function runOrderedBatch<T, R>(input: {
  items: readonly T[];
  signal: AbortSignal;
  limit?: number;
  start: (item: T, signal: AbortSignal) => Promise<R>;
  commit: (item: T, outcome: BatchOutcome<R>) => void;
}): Promise<{ stopped: boolean }> {
  const { items, signal } = input;
  const outcomes: (BatchOutcome<R> | undefined)[] = [];
  let next = 0;
  let committed = 0;
  let halted = false;
  const flush = () => {
    while (!halted && committed < items.length) {
      const outcome = outcomes[committed];
      if (!outcome) return;
      if (!outcome.ok && signal.aborted) {
        halted = true;
        return;
      }
      input.commit(items[committed], outcome);
      committed += 1;
    }
  };
  const runner = async () => {
    while (next < items.length && !signal.aborted) {
      const index = next++;
      try {
        outcomes[index] = {
          ok: true,
          value: await input.start(items[index], signal),
        };
      } catch (error) {
        outcomes[index] = { ok: false, error };
      }
      flush();
    }
  };
  const width = Math.max(
    1,
    Math.min(input.limit ?? SQL_BATCH_CONCURRENCY, items.length),
  );
  await Promise.all(Array.from({ length: width }, runner));
  return { stopped: signal.aborted };
}
