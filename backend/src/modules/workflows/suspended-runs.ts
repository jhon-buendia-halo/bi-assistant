/**
 * The runs that wait for the user's answer (api.md 138; ADR-0043), in
 * memory: what resumes each (its turn's suspension, its run host, its step
 * tracker) is held here, keyed by run id, for `SUSPENDED_RUN_TTL_MS`. Once
 * that passes, the run expires: `onExpire` gets it (the service then stops
 * the stored run and drops its host and snapshot). Nothing here survives a
 * restart; start-up recovery stops any run still stored `suspended`. Plain
 * code, no framework import, so Jest can drive it with fake timers.
 */

/** How long a suspended run can be resumed: 30 minutes. */
export const SUSPENDED_RUN_TTL_MS = 30 * 60 * 1000;

/** A run taken out to be resumed, or found expired when it was asked for. */
export type TakenRun<T> =
  { expired: false; value: T } | { expired: true; value: T };

interface Held<T> {
  value: T;
  expiresAt: number;
  timer: ReturnType<typeof setTimeout>;
}

export class SuspendedRuns<T> {
  private readonly held = new Map<string, Held<T>>();

  constructor(
    private readonly onExpire: (runId: string, value: T) => Promise<void>,
    private readonly ttlMs = SUSPENDED_RUN_TTL_MS,
    private readonly now: () => number = () => Date.now(),
  ) {}

  /**
   * Hold a suspended run until it expires; answers that moment (epoch ms).
   * A run held already is replaced (it suspended again after a resume).
   */
  add(runId: string, value: T): number {
    this.remove(runId);
    const expiresAt = this.now() + this.ttlMs;
    const timer = setTimeout(() => {
      const held = this.held.get(runId);
      if (held?.timer !== timer) return;
      this.held.delete(runId);
      void this.onExpire(runId, held.value);
    }, this.ttlMs);
    // A waiting run never keeps the process alive.
    (timer as { unref?: () => void }).unref?.();
    this.held.set(runId, { value, expiresAt, timer });
    return expiresAt;
  }

  /** Whether a run is held and can still be resumed. */
  has(runId: string): boolean {
    const held = this.held.get(runId);
    return !!held && this.now() < held.expiresAt;
  }

  /**
   * Take a run out to resume it (so it is resumed once): undefined when none
   * is held; `expired` when its time ran out (the caller expires it).
   */
  take(runId: string): TakenRun<T> | undefined {
    const held = this.held.get(runId);
    if (!held) return undefined;
    clearTimeout(held.timer);
    this.held.delete(runId);
    return this.now() >= held.expiresAt
      ? { expired: true, value: held.value }
      : { expired: false, value: held.value };
  }

  /** Stop holding a run (it was deleted), without expiring it. */
  remove(runId: string): T | undefined {
    const held = this.held.get(runId);
    if (!held) return undefined;
    clearTimeout(held.timer);
    this.held.delete(runId);
    return held.value;
  }

  /** The ids of the runs held. */
  ids(): string[] {
    return [...this.held.keys()];
  }
}
