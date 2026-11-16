/**
 * The runs that run detached from any request (api.md 119, 138, 149, 150;
 * ADR-0048), in memory: per run id the `AbortController` that stops it, a
 * numbered log of the events it sent (so a client that left can come back
 * and replay them), the clients following it, and when it ended. A closed
 * connection only stops following; Stop (150) aborts. An ended run stays
 * here `LIVE_RUN_RETENTION_MS`, then it is dropped (121 still reads it).
 * Nothing here survives a restart (workflows R20). Plain code, no framework
 * import, so Jest can drive it with fake timers.
 */

/** How long an ended run's events can still be replayed: 10 minutes. */
export const LIVE_RUN_RETENTION_MS = 10 * 60 * 1000;

/** The most entries one run's log keeps; older ones drop off (not `run`). */
export const LIVE_RUN_MAX_EVENTS = 5_000;

/** One event of a run's stream, as sent: its `type` and payload. */
export type LiveRunEvent = { type: string } & Record<string, unknown>;

/** An event with its number in the run's log, from 1. */
export interface LiveRunFrame {
  seq: number;
  event: LiveRunEvent;
}

/** A client following a run: its events, then its end. */
export interface LiveRunListener {
  event(frame: LiveRunFrame): void;
  end(): void;
}

/**
 * A logged event. Consecutive `text` and `reasoning` deltas merge into one
 * entry (`firstSeq` to `seq`), `offsets[i]` the start of delta `firstSeq + i`
 * in its `content`, so a replay after any of them sends only what follows.
 */
interface Logged {
  seq: number;
  firstSeq: number;
  event: LiveRunEvent;
  offsets: number[];
}

interface Entry {
  controller: AbortController;
  log: Logged[];
  listeners: Set<LiveRunListener>;
  ended: boolean;
  whenEnded: Promise<void>;
  resolveEnded: () => void;
  timer: ReturnType<typeof setTimeout> | null;
}

/** A delta that merges into the one before it: `text` or `reasoning` with only a `content`. */
function mergeable(event: LiveRunEvent): event is LiveRunEvent & {
  content: string;
} {
  if (event.type !== 'text' && event.type !== 'reasoning') return false;
  if (typeof event['content'] !== 'string') return false;
  return Object.keys(event).every((key) => key === 'type' || key === 'content');
}

export class LiveRuns {
  private readonly runs = new Map<string, Entry>();
  /** The last number given per run, kept across its segments (a resume). */
  private readonly lastSeq = new Map<string, number>();

  constructor(
    private readonly retentionMs = LIVE_RUN_RETENTION_MS,
    private readonly maxEvents = LIVE_RUN_MAX_EVENTS,
  ) {}

  /**
   * A run starts (119) or resumes (138): answers the signal that stops it.
   * A resumed run starts a fresh log; its numbers go on from the last one.
   */
  begin(runId: string): AbortSignal {
    const before = this.runs.get(runId);
    if (before && !before.ended) {
      throw new Error(`Run "${runId}" is already running`);
    }
    if (before?.timer) clearTimeout(before.timer);
    let resolveEnded!: () => void;
    const whenEnded = new Promise<void>((resolve) => (resolveEnded = resolve));
    const entry: Entry = {
      controller: new AbortController(),
      log: [],
      listeners: new Set(),
      ended: false,
      whenEnded,
      resolveEnded,
      timer: null,
    };
    this.runs.set(runId, entry);
    return entry.controller.signal;
  }

  /** Log an event of a running run and send it to every follower. */
  publish(runId: string, event: LiveRunEvent): void {
    const entry = this.runs.get(runId);
    if (!entry || entry.ended) return;
    const seq = (this.lastSeq.get(runId) ?? 0) + 1;
    this.lastSeq.set(runId, seq);
    const last = entry.log.at(-1);
    if (
      last &&
      last.seq === seq - 1 &&
      mergeable(event) &&
      mergeable(last.event) &&
      last.event.type === event.type
    ) {
      last.offsets.push(last.event.content.length);
      last.event = {
        ...last.event,
        content: last.event.content + event.content,
      };
      last.seq = seq;
    } else {
      entry.log.push({ seq, firstSeq: seq, event: { ...event }, offsets: [0] });
      if (entry.log.length > this.maxEvents) {
        // The first entry (`run`) stays; the oldest after it drops off.
        entry.log.splice(1, 1);
      }
    }
    for (const listener of [...entry.listeners]) {
      listener.event({ seq, event });
    }
  }

  /**
   * The run ended (done, failed, stopped, or waiting for the user): every
   * follower is told and let go; the log stays `retentionMs`.
   */
  end(runId: string): void {
    const entry = this.runs.get(runId);
    if (!entry || entry.ended) return;
    entry.ended = true;
    const listeners = [...entry.listeners];
    entry.listeners.clear();
    for (const listener of listeners) listener.end();
    entry.resolveEnded();
    entry.timer = setTimeout(() => {
      if (this.runs.get(runId) !== entry) return;
      this.runs.delete(runId);
      this.lastSeq.delete(runId);
    }, this.retentionMs);
    // An ended run never keeps the process alive.
    (entry.timer as { unref?: () => void }).unref?.();
  }

  /**
   * Follow a run: the logged events after `after` are sent at once, then the
   * live ones; a run that ended already ends at once after its replay.
   * Answers the way to stop following (it never stops the run), or
   * undefined when the run is not held.
   */
  subscribe(
    runId: string,
    after: number,
    listener: LiveRunListener,
  ): (() => void) | undefined {
    const entry = this.runs.get(runId);
    if (!entry) return undefined;
    for (const logged of entry.log) {
      if (logged.seq <= after) continue;
      if (logged.firstSeq > after) {
        listener.event({ seq: logged.seq, event: logged.event });
        continue;
      }
      // Part of a merged delta was sent already: send the rest.
      const offset = logged.offsets[after - logged.firstSeq + 1];
      const raw = logged.event['content'];
      const content = typeof raw === 'string' ? raw : '';
      listener.event({
        seq: logged.seq,
        event: { ...logged.event, content: content.slice(offset) },
      });
    }
    if (entry.ended) {
      listener.end();
      return () => undefined;
    }
    entry.listeners.add(listener);
    return () => {
      entry.listeners.delete(listener);
    };
  }

  /**
   * Stop a running run (150): its signal aborts. Answers whether it was
   * running; an ended or unknown run is left as it is.
   */
  stop(runId: string): boolean {
    const entry = this.runs.get(runId);
    if (!entry || entry.ended) return false;
    entry.controller.abort();
    return true;
  }

  /** Whether the run is held (running, or ended and still replayable). */
  has(runId: string): boolean {
    return this.runs.has(runId);
  }

  /** Whether the run is held and still running. */
  isRunning(runId: string): boolean {
    const entry = this.runs.get(runId);
    return !!entry && !entry.ended;
  }

  /** Settles when the run ends; undefined when it is not held. */
  whenEnded(runId: string): Promise<void> | undefined {
    return this.runs.get(runId)?.whenEnded;
  }

  /** The ids of the runs still running. */
  running(): string[] {
    return [...this.runs.entries()]
      .filter(([, entry]) => !entry.ended)
      .map(([id]) => id);
  }
}
