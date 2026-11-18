/**
 * Work one step of a turn's workflow starts and a later step takes
 * (agents.md 5.13, 5.20): the graph stays linear, one catalogue step runs at
 * a time, and independent work runs meanwhile. Assess Data Readiness starts
 * Read images at Resolve dataset and the rows behind findings at Save
 * report; Consumption Gap Analysis starts the lineage checks at Load layer
 * catalogs.
 *
 * - `start` gives each job its own signal, aborted with the turn's, and
 *   catches its outcome at once, so a job that fails before it is taken is
 *   never an unhandled rejection;
 * - a job's `record` calls (the sources it adds to the answer) are buffered:
 *   `take` awaits the job, replays them in order, then returns its value or
 *   rethrows its error, so the step that takes the job reports it;
 * - `settle` aborts the jobs no step took (a run stopped or failed before
 *   it reached them), awaits them and drops their buffers. The turn calls it
 *   when its run ends, fails or is stopped, before the answer is persisted.
 *
 * Framework-free: a held promise lives in the turn's closure only, never in
 * a step's output or a snapshot, and no job crosses a suspend.
 */

/** A job: the work, on its own signal, recording through `record`. */
export type EarlyJob<T> = (
  signal: AbortSignal,
  record: (replay: () => void) => void,
) => Promise<T>;

export interface EarlyWork {
  /** Start `job` under `key`; throws when `key` is already held. */
  start<T>(key: string, job: EarlyJob<T>): void;
  /** The job's records replayed, then its value; rethrows its error. */
  take<T>(key: string): Promise<T>;
  /** Abort and await the jobs no step took, and drop their records. */
  settle(): Promise<void>;
}

type Outcome = { ok: true; value: unknown } | { ok: false; error: unknown };

interface Held {
  controller: AbortController;
  outcome: Promise<Outcome>;
  buffer: (() => void)[];
  dropped: boolean;
  taken: boolean;
}

/** The holder of one turn's early work, its jobs stopped with `turnSignal`. */
export function earlyWork(turnSignal: AbortSignal): EarlyWork {
  const held = new Map<string, Held>();
  return {
    start<T>(key: string, job: EarlyJob<T>): void {
      if (held.has(key)) {
        throw new Error(`The early work "${key}" has already started`);
      }
      const controller = new AbortController();
      const stop = () => controller.abort();
      if (turnSignal.aborted) controller.abort();
      else turnSignal.addEventListener('abort', stop, { once: true });
      const entry: Held = {
        controller,
        buffer: [],
        dropped: false,
        taken: false,
        outcome: Promise.resolve({ ok: false, error: undefined }),
      };
      const record = (replay: () => void) => {
        if (!entry.dropped) entry.buffer.push(replay);
      };
      entry.outcome = (async (): Promise<Outcome> => {
        try {
          return { ok: true, value: await job(controller.signal, record) };
        } catch (error) {
          return { ok: false, error };
        } finally {
          turnSignal.removeEventListener('abort', stop);
        }
      })();
      held.set(key, entry);
    },

    async take<T>(key: string): Promise<T> {
      const entry = held.get(key);
      if (!entry) throw new Error(`No early work "${key}" is held`);
      if (entry.taken) {
        throw new Error(`The early work "${key}" was already taken`);
      }
      entry.taken = true;
      const outcome = await entry.outcome;
      const replays = entry.buffer.splice(0);
      for (const replay of replays) replay();
      if (!outcome.ok) throw outcome.error;
      return outcome.value as T;
    },

    async settle(): Promise<void> {
      const untaken = [...held].filter(([, entry]) => !entry.taken);
      for (const [key, entry] of untaken) {
        entry.dropped = true;
        entry.buffer.length = 0;
        entry.controller.abort();
        held.delete(key);
      }
      // The outcome never rejects: a job's own error is caught at start.
      await Promise.all(untaken.map(([, entry]) => entry.outcome));
    },
  };
}

/**
 * `fetch` called once per key for as long as the memo lives (one run): a
 * second call with the same key gets the first call's promise. A failed
 * call is forgotten, so the next caller tries again.
 */
export function memoisedBy<I, O>(
  fetch: (input: I) => Promise<O>,
  keyOf: (input: I) => string,
): (input: I) => Promise<O> {
  const calls = new Map<string, Promise<O>>();
  return (input: I) => {
    const key = keyOf(input);
    const known = calls.get(key);
    if (known) return known;
    const call = fetch(input);
    calls.set(key, call);
    call.catch(() => {
      if (calls.get(key) === call) calls.delete(key);
    });
    return call;
  };
}
