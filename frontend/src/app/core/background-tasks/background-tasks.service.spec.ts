import { TestBed } from '@angular/core/testing';
import { Subject, of, throwError } from 'rxjs';
import { ToastService } from '../toast/toast.service';
import {
  BackgroundTasksService,
  MAX_FINISHED_TASKS,
  defaultErrorMessage,
  formatElapsed,
} from './background-tasks.service';

describe('BackgroundTasksService', () => {
  let service: BackgroundTasksService;
  let toast: ToastService;

  beforeEach(() => {
    service = TestBed.inject(BackgroundTasksService);
    toast = TestBed.inject(ToastService);
  });

  it('keeps the work running at the root and lists it while it runs', () => {
    const work = new Subject<{ ok: boolean; message: string }>();
    const task = service.start({
      kind: 'dataset-save',
      key: 'Sales',
      title: 'Saving dataset "Sales"',
      work: () => work,
      outcome: (res) => ({ ok: !!res?.ok, message: res?.message }),
    });

    expect(task.status).toBe('running');
    expect(service.runningCount()).toBe(1);
    expect(service.active('dataset-save', 'Sales')?.id).toBe(task.id);

    work.next({ ok: true, message: 'Dataset "Sales" saved — 3 entities' });
    work.complete();

    const done = service.get(task.id)!;
    expect(done.status).toBe('done');
    expect(done.detail).toBe('Dataset "Sales" saved — 3 entities');
    expect(service.runningCount()).toBe(0);
    expect(toast.toasts().at(-1)?.message).toBe(
      'Dataset "Sales" saved — 3 entities',
    );
  });

  it('does not start the same kind and key twice', () => {
    const work = new Subject<void>();
    let starts = 0;
    const spec = {
      kind: 'testing-data-load' as const,
      key: 'world-cup',
      title: 'Loading',
      work: () => {
        starts++;
        return work;
      },
    };
    const a = service.start(spec);
    const b = service.start(spec);
    expect(b.id).toBe(a.id);
    expect(starts).toBe(1);
  });

  it('marks a server refusal as failed and offers Retry in the toast', () => {
    let calls = 0;
    const task = service.start({
      kind: 'dataset-save',
      key: 'Sales',
      title: 'Saving dataset "Sales"',
      work: () => {
        calls++;
        return of({ ok: false, message: 'Datasource x not found' });
      },
      outcome: (res) => ({ ok: !!res?.ok, message: res?.message }),
    });
    expect(service.get(task.id)!.status).toBe('failed');
    const last = toast.toasts().at(-1)!;
    expect(last.kind).toBe('error');
    expect(last.action?.label).toBe('Retry');

    toast.runAction(last);
    expect(calls).toBe(2);
    expect(service.get(task.id)).toBeUndefined();
  });

  it('reads the server message of a failed request', () => {
    const task = service.start({
      kind: 'inventory-refresh',
      key: 'pg',
      title: 'Refreshing',
      work: () => throwError(() => ({ error: { message: 'Timed out' } })),
    });
    expect(service.get(task.id)!.detail).toBe('Timed out');
    expect(defaultErrorMessage({ error: new ProgressEvent('error') })).toBe(
      'Backend unreachable',
    );
    expect(defaultErrorMessage(new Error('boom'))).toBe('boom');
  });

  it('reports progress and the end to listeners', () => {
    const work = new Subject<number>();
    const ended: string[] = [];
    service.finished$.subscribe((t) => ended.push(t.status));
    const task = service.start({
      kind: 'eval-run',
      key: 'assistant',
      title: 'Running evals',
      work: () => work,
      onValue: (n, handle) =>
        handle.update({ progress: { done: n, total: 4 }, detail: `${n} of 4` }),
    });
    work.next(2);
    expect(service.get(task.id)!.progress).toEqual({ done: 2, total: 4 });
    expect(service.get(task.id)!.detail).toBe('2 of 4');
    work.complete();
    expect(ended).toEqual(['done']);
  });

  it('stops a running task without a toast', () => {
    const work = new Subject<void>();
    let cancelled = false;
    const task = service.start({
      kind: 'workflow-run',
      key: 'run-1',
      title: 'Running',
      work: () => work,
      onCancel: () => (cancelled = true),
    });
    const before = toast.toasts().length;
    service.cancel(task.id);
    expect(service.get(task.id)!.status).toBe('stopped');
    expect(cancelled).toBeTrue();
    expect(work.observed).toBeFalse();
    expect(toast.toasts().length).toBe(before);
  });

  it('offers Open in the success toast when the task has a place to open', () => {
    let opened = 0;
    service.start({
      kind: 'testing-data-load',
      key: 'world-cup',
      title: 'Loading',
      work: () => of(true),
      open: () => opened++,
    });
    const last = toast.toasts().at(-1)!;
    expect(last.action?.label).toBe('Open');
    toast.runAction(last);
    expect(opened).toBe(1);
  });

  it('keeps at most the newest finished tasks and clears them on request', () => {
    for (let i = 0; i < MAX_FINISHED_TASKS + 3; i++) {
      service.start({
        kind: 'visual-refresh',
        key: `v${i}`,
        title: `t${i}`,
        work: () => of(1),
        toast: false,
      });
    }
    expect(service.finished().length).toBe(MAX_FINISHED_TASKS);
    expect(service.finished()[0].key).toBe(`v${MAX_FINISHED_TASKS + 2}`);
    service.clearFinished();
    expect(service.tasks().length).toBe(0);
  });
});

describe('formatElapsed', () => {
  it('reads as minutes and seconds, with hours when needed', () => {
    expect(formatElapsed(42_000)).toBe('0:42');
    expect(formatElapsed(130_000)).toBe('2:10');
    expect(formatElapsed(3_725_000)).toBe('1:02:05');
  });
});
