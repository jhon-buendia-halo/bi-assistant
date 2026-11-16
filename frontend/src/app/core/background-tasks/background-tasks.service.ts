import {
  DestroyRef,
  Injectable,
  computed,
  inject,
  signal,
} from '@angular/core';
import { Observable, Subject, Subscription } from 'rxjs';
import { ToastService } from '../toast/toast.service';

/**
 * Long work the user starts and may walk away from (app-shell R57–R63,
 * ADR-0047). The work is subscribed here, at the root, so leaving the
 * screen that started it neither cancels it nor loses its result: the
 * rail's Background tasks button lists it, the screen reads its state back
 * when it is shown again, and a toast reports the end.
 */
export type BackgroundTaskKind =
  | 'dataset-save'
  | 'inventory-refresh'
  | 'testing-data-load'
  | 'ontology-bootstrap'
  | 'synthetic-profile'
  | 'visual-tailor'
  | 'visual-refresh'
  | 'eval-run'
  | 'workflow-run';

export type BackgroundTaskStatus = 'running' | 'done' | 'failed' | 'stopped';

export interface BackgroundTaskProgress {
  done: number;
  total: number;
}

export interface BackgroundTask {
  readonly id: number;
  readonly kind: BackgroundTaskKind;
  /** What the task works on (a dataset name, a fixture id, `<runId>/<visualId>`…). */
  readonly key: string;
  /** Shown while it runs, e.g. `Saving dataset "Sales"`. */
  readonly title: string;
  readonly status: BackgroundTaskStatus;
  /** The current step while running; the result or error message once finished. */
  readonly detail: string | null;
  /** Known only when the work reports it; otherwise the bar is indeterminate. */
  readonly progress: BackgroundTaskProgress | null;
  readonly startedAt: number;
  readonly finishedAt: number | null;
  /** The last value the work emitted (the response, the final event…). */
  readonly result: unknown;
  /** Whether Open and Retry are offered. */
  readonly canOpen: boolean;
  readonly canRetry: boolean;
}

export interface BackgroundTaskOutcome {
  ok: boolean;
  /** Toast and list text; a default is used when absent. */
  message?: string;
}

/** What a task's work can change on the task while it runs. */
export interface BackgroundTaskHandle {
  readonly id: number;
  update(patch: {
    detail?: string | null;
    progress?: BackgroundTaskProgress | null;
    title?: string;
  }): void;
}

export interface StartBackgroundTask<T> {
  kind: BackgroundTaskKind;
  key: string;
  title: string;
  /**
   * The work. A factory, so Retry can start it again; it is subscribed once
   * per start, at the root.
   */
  work: () => Observable<T>;
  /** Called for every value the work emits (progress events, the response). */
  onValue?: (value: T, task: BackgroundTaskHandle) => void;
  /**
   * Reads the outcome from the last value. Absent: success when the work
   * completes. A work that completes without a value counts as success.
   */
  outcome?: (last: T | undefined) => BackgroundTaskOutcome;
  /** The error text for a failed request. Default: server `message`, else "Backend unreachable". */
  errorMessage?: (err: unknown) => string;
  /** Opens the resource the task made or works on. */
  open?: () => void;
  /** Runs after the task ends, whatever the screen shown (refresh a list…). */
  onFinish?: (task: BackgroundTask) => void;
  /**
   * Toast the end of the task. Default true. A function decides at the end,
   * e.g. only when the screen that started the task is no longer shown.
   */
  toast?: boolean | ((task: BackgroundTask) => boolean);
  /** Called by Stop (cancel); the subscription is dropped either way. */
  onCancel?: () => void;
}

interface Entry {
  spec: StartBackgroundTask<unknown>;
  subscription: Subscription | null;
}

/** Finished tasks kept in the list; older ones drop off. */
export const MAX_FINISHED_TASKS = 20;

export function defaultErrorMessage(err: unknown): string {
  const e = err as {
    error?: { message?: unknown };
    message?: unknown;
  } | null;
  const server = e?.error?.message;
  if (typeof server === 'string' && server) return server;
  if (
    e &&
    typeof e === 'object' &&
    !('error' in e) &&
    typeof e.message === 'string' &&
    e.message
  ) {
    return e.message;
  }
  return 'Backend unreachable';
}

@Injectable({ providedIn: 'root' })
export class BackgroundTasksService {
  private readonly toast = inject(ToastService);
  private seq = 0;
  private readonly entries = new Map<number, Entry>();
  private readonly finishedSubject = new Subject<BackgroundTask>();
  private clock: ReturnType<typeof setInterval> | null = null;

  /** Newest first. */
  readonly tasks = signal<readonly BackgroundTask[]>([]);
  readonly running = computed(() =>
    this.tasks().filter((t) => t.status === 'running'),
  );
  readonly finished = computed(() =>
    this.tasks().filter((t) => t.status !== 'running'),
  );
  readonly runningCount = computed(() => this.running().length);
  /** Ticks every second while a task runs, for elapsed times. */
  readonly now = signal(Date.now());
  /** Every task that ends (done, failed or stopped). */
  readonly finished$: Observable<BackgroundTask> =
    this.finishedSubject.asObservable();

  constructor() {
    inject(DestroyRef).onDestroy(() => {
      this.stopClock();
      for (const entry of this.entries.values())
        entry.subscription?.unsubscribe();
    });
  }

  /**
   * Starts a task, or returns the one of the same kind and key that is
   * already running (a second click does not start the work twice).
   */
  start<T>(spec: StartBackgroundTask<T>): BackgroundTask {
    const existing = this.active(spec.kind, spec.key);
    if (existing) return existing;
    const id = ++this.seq;
    const task: BackgroundTask = {
      id,
      kind: spec.kind,
      key: spec.key,
      title: spec.title,
      status: 'running',
      detail: null,
      progress: null,
      startedAt: Date.now(),
      finishedAt: null,
      result: undefined,
      canOpen: !!spec.open,
      canRetry: true,
    };
    this.tasks.set([task, ...this.tasks()]);
    const entry: Entry = {
      spec: spec as StartBackgroundTask<unknown>,
      subscription: null,
    };
    this.entries.set(id, entry);
    this.startClock();
    this.subscribe(id, entry);
    return this.get(id)!;
  }

  /** The running task of this kind (and key, when given), if any. */
  active(kind: BackgroundTaskKind, key?: string): BackgroundTask | undefined {
    return this.tasks().find(
      (t) =>
        t.status === 'running' &&
        t.kind === kind &&
        (key === undefined || t.key === key),
    );
  }

  /** The newest task of this kind and key, whatever its status. */
  latest(kind: BackgroundTaskKind, key: string): BackgroundTask | undefined {
    return this.tasks().find((t) => t.kind === kind && t.key === key);
  }

  get(id: number): BackgroundTask | undefined {
    return this.tasks().find((t) => t.id === id);
  }

  update(
    id: number,
    patch: {
      detail?: string | null;
      progress?: BackgroundTaskProgress | null;
      title?: string;
    },
  ): void {
    this.patch(id, (t) => (t.status === 'running' ? { ...t, ...patch } : t));
  }

  /** Stops a running task: drops its work and marks it stopped. */
  cancel(id: number): void {
    const entry = this.entries.get(id);
    const task = this.get(id);
    if (!entry || !task || task.status !== 'running') return;
    entry.subscription?.unsubscribe();
    entry.subscription = null;
    entry.spec.onCancel?.();
    this.finish(id, 'stopped', 'Stopped', task.result, false);
  }

  /** Starts a failed or stopped task's work again, as a new task. */
  retry(id: number): BackgroundTask | undefined {
    const entry = this.entries.get(id);
    const task = this.get(id);
    if (!entry || !task || task.status === 'running') return undefined;
    this.dismiss(id);
    return this.start(entry.spec);
  }

  open(id: number): void {
    this.entries.get(id)?.spec.open?.();
  }

  /** Removes a finished task from the list. A running one stays. */
  dismiss(id: number): void {
    const task = this.get(id);
    if (!task || task.status === 'running') return;
    this.entries.delete(id);
    this.tasks.set(this.tasks().filter((t) => t.id !== id));
  }

  clearFinished(): void {
    for (const t of this.finished()) this.entries.delete(t.id);
    this.tasks.set(this.running());
  }

  private subscribe(id: number, entry: Entry): void {
    const spec = entry.spec;
    let last: unknown = undefined;
    const handle: BackgroundTaskHandle = {
      id,
      update: (patch) => this.update(id, patch),
    };
    let source: Observable<unknown>;
    try {
      source = spec.work();
    } catch (err) {
      this.fail(id, spec, err);
      return;
    }
    entry.subscription = source.subscribe({
      next: (value) => {
        last = value;
        this.patch(id, (t) => ({ ...t, result: value }));
        try {
          spec.onValue?.(value, handle);
        } catch {
          // A broken progress reader must not end the work.
        }
      },
      error: (err) => {
        entry.subscription = null;
        this.fail(id, spec, err);
      },
      complete: () => {
        entry.subscription = null;
        const outcome = spec.outcome
          ? spec.outcome(last)
          : ({ ok: true } as BackgroundTaskOutcome);
        const task = this.get(id);
        const message =
          outcome.message ??
          (outcome.ok
            ? `${task?.title ?? 'Task'}: done`
            : `${task?.title ?? 'Task'}: failed`);
        this.finish(id, outcome.ok ? 'done' : 'failed', message, last);
      },
    });
  }

  private fail(
    id: number,
    spec: StartBackgroundTask<unknown>,
    err: unknown,
  ): void {
    const message = (spec.errorMessage ?? defaultErrorMessage)(err);
    this.finish(id, 'failed', message, this.get(id)?.result);
  }

  private finish(
    id: number,
    status: Exclude<BackgroundTaskStatus, 'running'>,
    message: string,
    result: unknown,
    toast = true,
  ): void {
    const entry = this.entries.get(id);
    const before = this.get(id);
    if (!entry || !before || before.status !== 'running') return;
    const ended: BackgroundTask = {
      ...before,
      status,
      detail: message,
      result,
      finishedAt: Date.now(),
      progress:
        status === 'done' && before.progress
          ? { ...before.progress, done: before.progress.total }
          : before.progress,
    };
    this.patch(id, () => ended);
    this.trimFinished();
    if (this.runningCount() === 0) this.stopClock();
    const spec = entry.spec;
    const wantsToast =
      typeof spec.toast === 'function'
        ? spec.toast(ended)
        : spec.toast !== false;
    if (toast && wantsToast) {
      if (status === 'done') {
        this.toast.success(
          message,
          spec.open ? { label: 'Open', run: () => spec.open?.() } : undefined,
        );
      } else if (status === 'failed') {
        this.toast.error(message, {
          label: 'Retry',
          run: () => this.retry(id),
        });
      }
    }
    try {
      spec.onFinish?.(ended);
    } catch {
      // A broken follow-up must not hide the end of the task.
    }
    this.finishedSubject.next(ended);
  }

  private patch(id: number, fn: (t: BackgroundTask) => BackgroundTask): void {
    this.tasks.set(this.tasks().map((t) => (t.id === id ? fn(t) : t)));
  }

  private trimFinished(): void {
    const finished = this.finished();
    if (finished.length <= MAX_FINISHED_TASKS) return;
    const drop = new Set(finished.slice(MAX_FINISHED_TASKS).map((t) => t.id));
    for (const id of drop) this.entries.delete(id);
    this.tasks.set(this.tasks().filter((t) => !drop.has(t.id)));
  }

  private startClock(): void {
    this.now.set(Date.now());
    if (this.clock) return;
    this.clock = setInterval(() => this.now.set(Date.now()), 1000);
  }

  private stopClock(): void {
    if (this.clock) clearInterval(this.clock);
    this.clock = null;
  }
}

/** `0:42`, `2:10`, `1:02:05`. */
export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}
