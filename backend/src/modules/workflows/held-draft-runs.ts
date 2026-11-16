import type { ChatMessage } from '../sessions/entities/session.entity';
import type { WorkflowRun } from './workflow-run-steps';

/** How long a finished draft run stays reachable (plan section 5). */
export const DRAFT_RUN_TTL_MS = 30 * 60 * 1000;
/** How many finished draft runs are held at most; the oldest goes first. */
export const DRAFT_RUNS_HELD = 20;

/** A finished draft run in memory, and the agent whose draft it ran. */
export interface HeldDraftRun {
  run: WorkflowRun;
  agentId: string;
}

/**
 * The finished draft runs of Try it (api.md 139-143; agents-evals R60),
 * held in memory only: never stored, listed or readable through 120-122.
 * Each one is kept for `ttlMs` from when it finished, at most `cap` of them,
 * the oldest dropped first. `now` is the clock (tests drive it).
 */
export class HeldDraftRuns {
  private readonly runs = new Map<string, HeldDraftRun & { until: number }>();

  constructor(
    private readonly now: () => number = () => Date.now(),
    private readonly ttlMs = DRAFT_RUN_TTL_MS,
    private readonly cap = DRAFT_RUNS_HELD,
  ) {}

  /** Hold a finished draft run, dropping the oldest beyond the cap. */
  hold(run: WorkflowRun, agentId: string): void {
    this.sweep();
    this.runs.delete(run.id);
    this.runs.set(run.id, { run, agentId, until: this.now() + this.ttlMs });
    while (this.runs.size > this.cap) {
      const oldest = this.runs.keys().next().value as string;
      this.runs.delete(oldest);
    }
  }

  /** The held run `id`, or undefined once it expired or was dropped. */
  get(id: string): HeldDraftRun | undefined {
    this.sweep();
    const held = this.runs.get(id);
    return held ? { run: held.run, agentId: held.agentId } : undefined;
  }

  /** Write a held run's answer (its time is not extended); the updated run. */
  setAnswer(id: string, answer: ChatMessage): WorkflowRun | undefined {
    const held = this.runs.get(id);
    if (!held) return undefined;
    held.run = { ...held.run, answer };
    return held.run;
  }

  drop(id: string): void {
    this.runs.delete(id);
  }

  private sweep(): void {
    const now = this.now();
    for (const [id, held] of this.runs) {
      if (held.until <= now) this.runs.delete(id);
    }
  }
}
