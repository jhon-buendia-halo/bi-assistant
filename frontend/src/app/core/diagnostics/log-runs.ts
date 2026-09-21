import { DiagnosticEntry } from './diagnostics.types';

/**
 * Diagnostic entries arrive as one flat 2,000-entry stream spanning every
 * backend restart, which makes a report impossible to read: a failure at
 * 12:14 sits next to unrelated startup noise from three process lifetimes
 * earlier. Nest stamps its own PID into every line it logs
 * (`[Nest] 17828  - 09/21/2026, 12:08:43 PM   WARN [SessionsService] …`), so
 * a PID change marks a process boundary with no backend cooperation needed.
 *
 * A run is therefore a contiguous *time window*, not a source filter: entries
 * from `backend:mastra`, `electron` and `user-visible` carry no PID, so they
 * are attributed to whichever run was alive when they were recorded. That is
 * what makes the grouping useful — the agent-runtime and user-facing errors
 * are exactly the ones you want to read next to the backend lines around them.
 *
 * These are backend process runs, not chat sessions. One run usually spans
 * several sessions; grouping by session would need a session id stamped at
 * log time, which nothing emits today.
 */
export interface LogRun {
  /** 1-based position in the stream, ascending — stable label for the UI. */
  ordinal: number;
  pid: string;
  startedAt: string;
  endedAt: string;
  /**
   * Whether a `Starting Nest application` line opened this run. False means
   * the run's beginning aged out of the ring buffer, so its first entry is
   * where the window starts rather than where the process did.
   */
  booted: boolean;
  entries: DiagnosticEntry[];
  errorCount: number;
  warningCount: number;
}

export interface GroupedEntries {
  /** Entries recorded before any backend process identified itself. */
  ungrouped: DiagnosticEntry[];
  runs: LogRun[];
}

/** Leading `[Nest] <pid>` on a backend line; other sources never match. */
const NEST_PID = /^\[Nest\]\s+(\d+)\b/;
const BOOT_MARKER = 'Starting Nest application';

function pidOf(entry: DiagnosticEntry): string | undefined {
  return NEST_PID.exec(entry.message)?.[1];
}

/**
 * Split entries into backend process runs. Input is assumed to be in
 * timestamp order, which is what `DiagnosticsService` maintains.
 *
 * A PID that reappears after a different one opens a *new* run rather than
 * reopening the old one: the stream is chronological, so that genuinely means
 * a second process (the OS does reuse PIDs), and keeping runs contiguous is
 * what lets the UI render them as ordered sections.
 */
export function groupEntriesByRun(
  entries: readonly DiagnosticEntry[],
): GroupedEntries {
  const ungrouped: DiagnosticEntry[] = [];
  const runs: LogRun[] = [];
  let current: LogRun | undefined;

  for (const entry of entries) {
    const pid = pidOf(entry);
    if (pid !== undefined && pid !== current?.pid) {
      current = {
        ordinal: runs.length + 1,
        pid,
        startedAt: entry.timestamp,
        endedAt: entry.timestamp,
        booted: false,
        entries: [],
        errorCount: 0,
        warningCount: 0,
      };
      runs.push(current);
    }
    if (!current) {
      ungrouped.push(entry);
      continue;
    }
    current.entries.push(entry);
    current.endedAt = entry.timestamp;
    if (entry.level === 'error') current.errorCount++;
    if (entry.level === 'warn') current.warningCount++;
    if (!current.booted && entry.message.includes(BOOT_MARKER)) {
      current.booted = true;
    }
  }

  return { ungrouped, runs };
}

/**
 * Apply a per-entry predicate without disturbing run boundaries. Filtering
 * before grouping would be wrong: a search that hides the `[Nest]` lines
 * would erase the PIDs the boundaries are derived from and collapse
 * everything into `ungrouped`. Run-level counts stay as recorded so a
 * filtered view still tells you how bad the whole run was.
 */
export function filterGrouped(
  grouped: GroupedEntries,
  keep: (entry: DiagnosticEntry) => boolean,
): GroupedEntries {
  return {
    ungrouped: grouped.ungrouped.filter(keep),
    runs: grouped.runs
      .map((run) => ({ ...run, entries: run.entries.filter(keep) }))
      .filter((run) => run.entries.length > 0),
  };
}
