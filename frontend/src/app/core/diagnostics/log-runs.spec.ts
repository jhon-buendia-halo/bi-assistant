import { DiagnosticEntry, DiagnosticLevel } from './diagnostics.types';
import { filterGrouped, groupEntriesByRun } from './log-runs';

let sequence = 0;

function entry(
  message: string,
  options: {
    source?: string;
    level?: DiagnosticLevel;
    timestamp?: string;
  } = {},
): DiagnosticEntry {
  sequence++;
  return {
    id: `e${sequence}`,
    timestamp:
      options.timestamp ??
      `2026-09-21T17:00:${`${sequence}`.padStart(2, '0')}.000Z`,
    level: options.level ?? 'info',
    source: options.source ?? 'backend',
    message,
  };
}

/** A real backend line, as `main.cjs` records it (source prefix stripped). */
function nest(pid: number, rest: string, level: DiagnosticLevel = 'info') {
  return entry(`[Nest] ${pid}  - 09/21/2026, 12:08:43 PM   LOG ${rest}`, {
    level,
  });
}

beforeEach(() => {
  sequence = 0;
});

describe('groupEntriesByRun', () => {
  it('opens a run per backend PID and keeps them in stream order', () => {
    const { runs, ungrouped } = groupEntriesByRun([
      nest(14324, '[NestFactory] Starting Nest application...'),
      nest(14324, '[RoutesResolver] SessionsController'),
      nest(17828, '[NestFactory] Starting Nest application...'),
      nest(17828, '[NestApplication] Nest application successfully started'),
    ]);

    expect(ungrouped).toEqual([]);
    expect(runs.map((r) => [r.ordinal, r.pid, r.entries.length])).toEqual([
      [1, '14324', 2],
      [2, '17828', 2],
    ]);
  });

  it('attributes PID-less sources to the run that was alive at the time', () => {
    // The whole point of the grouping: mastra and user-visible errors carry no
    // PID, and they are the entries you actually want to read in context.
    const { runs } = groupEntriesByRun([
      nest(17828, '[NestFactory] Starting Nest application...'),
      entry('Created DBSQLClient', { source: 'backend:mastra' }),
      entry('Structured output validation failed', {
        source: 'user-visible',
        level: 'error',
      }),
    ]);

    expect(runs.length).toBe(1);
    expect(runs[0].entries.map((e) => e.source)).toEqual([
      'backend',
      'backend:mastra',
      'user-visible',
    ]);
    expect(runs[0].errorCount).toBe(1);
  });

  it('keeps pre-backend entries ungrouped rather than inventing a run', () => {
    const { runs, ungrouped } = groupEntriesByRun([
      entry('Application diagnostics initialized', { source: 'electron' }),
      entry('Backend unreachable', { source: 'user-visible', level: 'error' }),
      nest(17828, '[NestFactory] Starting Nest application...'),
    ]);

    expect(ungrouped.map((e) => e.source)).toEqual([
      'electron',
      'user-visible',
    ]);
    expect(runs.length).toBe(1);
    expect(runs[0].entries.length).toBe(1);
  });

  it('marks a run booted only when it carries the startup line', () => {
    // PID 384 in the 2026-09-21 report: its boot aged out of the ring buffer,
    // so its first entry is where the window starts, not where the process did.
    const { runs } = groupEntriesByRun([
      nest(384, '[RouterExplorer] Mapped {/sessions, GET} route'),
      nest(17828, '[NestFactory] Starting Nest application...'),
    ]);

    expect(runs.map((r) => r.booted)).toEqual([false, true]);
  });

  it('tallies errors and warnings per run and tracks its time span', () => {
    const { runs } = groupEntriesByRun([
      nest(1, 'boot', 'info'),
      entry('a', { level: 'error', timestamp: '2026-09-21T17:05:00.000Z' }),
      entry('b', { level: 'warn' }),
      entry('c', { level: 'warn', timestamp: '2026-09-21T17:09:00.000Z' }),
      nest(2, 'boot'),
      entry('d', { level: 'error' }),
    ]);

    expect(runs[0].errorCount).toBe(1);
    expect(runs[0].warningCount).toBe(2);
    expect(runs[0].endedAt).toBe('2026-09-21T17:09:00.000Z');
    expect(runs[1].errorCount).toBe(1);
    expect(runs[1].warningCount).toBe(0);
  });

  it('treats a reused PID after a different one as a separate run', () => {
    const { runs } = groupEntriesByRun([
      nest(100, 'boot'),
      nest(200, 'boot'),
      nest(100, 'boot'),
    ]);

    expect(runs.map((r) => r.pid)).toEqual(['100', '200', '100']);
  });

  it('does not treat a PID mentioned mid-message as a boundary', () => {
    const { runs } = groupEntriesByRun([
      nest(17828, 'boot'),
      entry('spawned child [Nest] 999 earlier', { source: 'electron' }),
    ]);

    expect(runs.length).toBe(1);
    expect(runs[0].entries.length).toBe(2);
  });

  it('returns nothing for an empty stream', () => {
    expect(groupEntriesByRun([])).toEqual({ ungrouped: [], runs: [] });
  });
});

describe('filterGrouped', () => {
  const grouped = () =>
    groupEntriesByRun([
      entry('before any backend', { source: 'electron' }),
      nest(1, '[NestFactory] Starting Nest application...'),
      entry('keep me', { level: 'error' }),
      nest(2, '[NestFactory] Starting Nest application...'),
      entry('nothing matches here', { level: 'info' }),
    ]);

  it('filters within runs without disturbing boundaries', () => {
    // Filtering *before* grouping would hide the `[Nest]` lines the PIDs come
    // from and collapse everything into `ungrouped`.
    const result = filterGrouped(grouped(), (e) => e.level === 'error');

    expect(result.runs.length).toBe(1);
    expect(result.runs[0].pid).toBe('1');
    expect(result.runs[0].entries.map((e) => e.message)).toEqual(['keep me']);
  });

  it('drops runs left empty but keeps their recorded counts on survivors', () => {
    const result = filterGrouped(grouped(), (e) => e.message === 'keep me');

    expect(result.runs.map((r) => r.pid)).toEqual(['1']);
    expect(result.runs[0].errorCount).toBe(1);
  });

  it('filters ungrouped entries too', () => {
    expect(filterGrouped(grouped(), () => false)).toEqual({
      ungrouped: [],
      runs: [],
    });
    expect(
      filterGrouped(grouped(), (e) => e.source === 'electron').ungrouped.length,
    ).toBe(1);
  });
});
