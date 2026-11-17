import type { Response } from 'express';

/** Gap between heartbeat comment frames (api.md 3.1). */
export const SSE_HEARTBEAT_MS = 15_000;

/**
 * Keep an open SSE response alive through a long silent stretch (api.md 3.1):
 * every `SSE_HEARTBEAT_MS` write the comment frame `: ping` plus a blank line.
 * It has no `data` line and no `seq`, so it is not an event and readers skip
 * it. The timer is unref'd, stops when the response closes, and nothing is
 * written once the response ended. Returns the stop function.
 */
export function startSseHeartbeat(
  res: Response,
  intervalMs = SSE_HEARTBEAT_MS,
): () => void {
  const stop = () => {
    clearInterval(timer);
    res.off('close', stop);
    res.off('finish', stop);
  };
  const timer = setInterval(() => {
    if (res.writableEnded || res.destroyed) {
      stop();
      return;
    }
    res.write(': ping\n\n');
    // A compression middleware buffers; flush so the ping leaves the process.
    (res as Response & { flush?: () => void }).flush?.();
  }, intervalMs);
  timer.unref();
  res.once('close', stop);
  res.once('finish', stop);
  return stop;
}
