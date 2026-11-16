// Ends a desktop-spawned backend once the Electron main process that started
// it is gone (api.md 4.3 "Orphan exit", roadmap 1.7.21). Windows does not end
// a child when its parent dies, so without this a crashed or force-ended
// window leaves the backend holding its port.

export const PARENT_CHECK_INTERVAL_MS = 2000;

/** `process.kill(pid, 0)` probes without signalling; EPERM still means alive. */
export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/** A positive integer PID from `DESKTOP_PARENT_PID`, else null (no watch). */
export function parseParentPid(value: string | undefined): number | null {
  if (!value || !/^\d+$/.test(value.trim())) return null;
  const pid = Number(value.trim());
  return Number.isSafeInteger(pid) && pid > 0 ? pid : null;
}

export interface ParentWatchOptions {
  intervalMs?: number;
  isAlive?: (pid: number) => boolean;
  onParentGone: () => void;
}

/** Polls the parent PID; calls `onParentGone` once. Returns a stop function. */
export function watchParentProcess(
  parentPid: number,
  {
    intervalMs = PARENT_CHECK_INTERVAL_MS,
    isAlive = isProcessAlive,
    onParentGone,
  }: ParentWatchOptions,
): () => void {
  const timer = setInterval(() => {
    if (isAlive(parentPid)) return;
    clearInterval(timer);
    onParentGone();
  }, intervalMs);
  // The watch alone must never keep the process running.
  timer.unref();
  return () => clearInterval(timer);
}
