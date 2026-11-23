/**
 * The runs that run detached from any request (api.md 119, 138, 149, 150;
 * ADR-0048), in memory: per run id the `AbortController` that stops it, a
 * numbered log of the events it sent (so a client that left can come back
 * and replay them), the clients following it, and when it ended. A closed
 * connection only stops following; Stop (150) aborts. An ended run stays
 * here `LIVE_RUN_RETENTION_MS`, then it is dropped (121 still reads it).
 * A started run holds one of `MAX_LIVE_RUNS` slots until it ends; a run
 * accepted while every slot is taken waits for one in line, oldest first
 * (119 `queued`). Nothing here survives a restart (workflows R20; the
 * stored `queued` runs do). Plain code, no framework import, so Jest can
 * drive it with fake timers.
 */

/** How long an ended run's events can still be replayed: 10 minutes. */
export const LIVE_RUN_RETENTION_MS = 10 * 60 * 1000;

/** The most entries one run's log keeps; older ones drop off (not `run`). */
export const LIVE_RUN_MAX_EVENTS = 5_000;

/** How many runs may run at once when nothing overrides it (api.md 119). */
export const MAX_LIVE_RUNS_DEFAULT = 8;

/**
 * The cap on live runs from `WORKFLOW_MAX_LIVE_RUNS`: a whole number of at
 * least 1, else `MAX_LIVE_RUNS_DEFAULT`.
 */
export function liveRunCap(raw: string | undefined): number {
  const text = raw?.trim() ?? '';
  if (!/^\d+$/.test(text)) return MAX_LIVE_RUNS_DEFAULT;
  const cap = Number(text);
  return Number.isSafeInteger(cap) && cap >= 1 ? cap : MAX_LIVE_RUNS_DEFAULT;
}

/** The cap on live runs, read once from the environment (api.md 119). */
export const MAX_LIVE_RUNS = liveRunCap(process.env.WORKFLOW_MAX_LIVE_RUNS);

/**
 * How long Stop (150) and a stalled run wait for the run's work to unwind
 * after its abort before the run is stored ended without it: 10 seconds.
 */
export const RUN_UNWIND_MS = 10_000;

/** How long a turn may report nothing when nothing overrides it, in minutes. */
export const RUN_IDLE_MINUTES_DEFAULT = 15;

/**
 * The longest no-progress limit, in whole minutes: a timer cannot hold more
 * than 2^31-1 ms (Node turns a longer delay into 1 ms, so the watchdog would
 * fire at once). 35,791 minutes is just under that.
 */
export const RUN_IDLE_MINUTES_MAX = Math.floor((2 ** 31 - 1) / 60_000);

/**
 * The no-progress limit of a turn from `WORKFLOW_RUN_IDLE_MINUTES`, in
 * milliseconds: a number of minutes above 0 (capped at
 * `RUN_IDLE_MINUTES_MAX`), 0 to turn the watchdog off (answers 0), else
 * `RUN_IDLE_MINUTES_DEFAULT`.
 */
export function runIdleLimitMs(raw: string | undefined): number {
  const text = raw?.trim() ?? '';
  const minutes = text ? Number(text) : NaN;
  if (minutes === 0) return 0;
  return Number.isFinite(minutes) && minutes > 0
    ? Math.min(minutes, RUN_IDLE_MINUTES_MAX) * 60_000
    : RUN_IDLE_MINUTES_DEFAULT * 60_000;
}

/** The no-progress limit, read once from the environment (workflows spec). */
export const RUN_IDLE_LIMIT_MS = runIdleLimitMs(
  process.env.WORKFLOW_RUN_IDLE_MINUTES,
);

/** The error a run ends `failed` with when it made no progress for `limitMs`. */
export function runStalledMessage(limitMs: number): string {
  const minutes = limitMs / 60_000;
  return `The run made no progress for ${minutes} minute${minutes === 1 ? '' : 's'} and was stopped`;
}

/**
 * A turn's no-progress clock: `onIdle` fires once when `limitMs` passes with
 * no `touch` (every event the turn reports touches it). `stop` clears it for
 * good, when the turn ends or waits for the user. A limit of 0 never fires.
 * The timer is unref'd: it never keeps the process alive. A limit above
 * `RUN_IDLE_MINUTES_MAX` minutes is held at that cap, never overflowed.
 */
export class IdleWatchdog {
  private timer: ReturnType<typeof setTimeout> | undefined;
  private done = false;
  private readonly limitMs: number;

  constructor(
    limitMs: number,
    private readonly onIdle: () => void,
  ) {
    this.limitMs = Math.min(limitMs, RUN_IDLE_MINUTES_MAX * 60_000);
    this.touch();
  }

  /** The turn reported something: the clock starts again. */
  touch(): void {
    if (this.done || this.limitMs <= 0) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.done = true;
      this.timer = undefined;
      this.onIdle();
    }, this.limitMs);
    (this.timer as { unref?: () => void }).unref?.();
  }

  /** The turn ended or suspended: the clock never fires. */
  stop(): void {
    this.done = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
  }
}

/**
 * One run's place under the cap: given to a waiting run in turn (119), or
 * claimed by a resume (138); freed once, when the run ends.
 */
export interface LiveRunSlot {
  release(): void;
}

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
  /** Its place under the cap; none for a run that holds no slot (yet). */
  slot?: LiveRunSlot;
}

/** A run waiting in line for a slot (`waitForSlot`). */
interface Waiter {
  entry: Entry;
  seated: () => void;
  refused: (failure: Error) => void;
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
  /** The slots taken and not yet freed. */
  private held = 0;
  /** The runs waiting for a slot, oldest first. */
  private readonly line: Waiter[] = [];

  /** `cap`: how many slots the waiting runs are given at most (api.md 119). */
  constructor(
    private readonly retentionMs = LIVE_RUN_RETENTION_MS,
    private readonly maxEvents = LIVE_RUN_MAX_EVENTS,
    readonly cap = MAX_LIVE_RUNS,
  ) {}

  /** Take a slot whatever the cap: a resume (138) is never refused. */
  claim(): LiveRunSlot {
    this.held += 1;
    let freed = false;
    return {
      release: () => {
        if (freed) return;
        freed = true;
        this.held -= 1;
        this.seatNext();
      },
    };
  }

  /**
   * Seat a held run now, when a slot is free and no run waits before it
   * (api.md 119): answers whether it holds a slot. Synchronous, so two runs
   * arriving together for one free slot get one slot.
   */
  seat(runId: string): boolean {
    const entry = this.runs.get(runId);
    if (!entry || entry.ended) return false;
    if (entry.slot) return true;
    if (this.held >= this.cap || this.line.length) return false;
    entry.slot = this.claim();
    return true;
  }

  /**
   * Settles once the held run holds a slot (`end` frees it): at once when
   * it is seated, else when its turn in line comes, oldest first. The line
   * is joined as this is called. Rejects when the run is stopped (150) or
   * ended before then.
   */
  waitForSlot(runId: string): Promise<void> {
    const entry = this.runs.get(runId);
    if (!entry || entry.ended) {
      return Promise.reject(new Error(`Run "${runId}" is not running`));
    }
    if (this.seat(runId)) return Promise.resolve();
    const signal = entry.controller.signal;
    if (signal.aborted) return Promise.reject(new Error('Run stopped'));
    return new Promise<void>((resolve, reject) => {
      const onAbort = () => waiter.refused(new Error('Run stopped'));
      const waiter: Waiter = {
        entry,
        seated: () => {
          signal.removeEventListener('abort', onAbort);
          resolve();
        },
        refused: (failure) => {
          signal.removeEventListener('abort', onAbort);
          this.leaveLine(entry);
          reject(failure);
        },
      };
      signal.addEventListener('abort', onAbort, { once: true });
      this.line.push(waiter);
    });
  }

  /** Give the free slots to the runs waiting longest. */
  private seatNext(): void {
    while (this.held < this.cap && this.line.length) {
      const waiter = this.line.shift()!;
      waiter.entry.slot = this.claim();
      waiter.seated();
    }
  }

  private leaveLine(entry: Entry): void {
    const at = this.line.findIndex((waiter) => waiter.entry === entry);
    if (at >= 0) this.line.splice(at, 1);
  }

  /**
   * A run starts (119) or resumes (138): answers the signal that stops it.
   * A resumed run starts a fresh log; its numbers go on from the last one.
   * `slot`, when given, is the run's place under the cap: `end` frees it.
   */
  begin(runId: string, slot?: LiveRunSlot): AbortSignal {
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
      ...(slot ? { slot } : {}),
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
    this.line
      .find((waiter) => waiter.entry === entry)
      ?.refused(new Error(`Run "${runId}" ended`));
    entry.slot?.release();
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

/**
 * A running turn's progress, written to its stored run as it happens
 * (data-model 3.16; workflows R20): `save` never waits, at most one write is
 * in flight, and a newer state replaces the one queued behind it. A failed
 * write is reported to `failed` and never stops the run. `close`, before the
 * write that ends the turn, drops what is queued and waits for the write in
 * flight, so that end write lands last; nothing is saved after it.
 */
export class RunCheckpoint<Patch> {
  private queued: Patch | undefined;
  private draining: Promise<void> | undefined;
  private closed = false;

  constructor(
    private readonly write: (patch: Patch) => Promise<unknown>,
    private readonly failed: (failure: unknown) => void,
  ) {}

  /** Queue the turn's latest state; the write starts now when none is in flight. */
  save(patch: Patch): void {
    if (this.closed) return;
    this.queued = patch;
    this.draining ??= this.drain();
  }

  /** Stop saving: the queued state is dropped, the write in flight awaited. */
  async close(): Promise<void> {
    this.closed = true;
    this.queued = undefined;
    await this.draining;
  }

  private async drain(): Promise<void> {
    while (this.queued !== undefined && !this.closed) {
      const patch = this.queued;
      this.queued = undefined;
      try {
        await this.write(patch);
      } catch (failure) {
        this.failed(failure);
      }
    }
    this.draining = undefined;
  }
}
