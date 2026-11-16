/**
 * How a run's error reads (api.md 118, 119). No framework import, so the
 * workflows module and Jest can read it without loading Mastra.
 */

/** An error's message: an `Error`, a serialized one, or a string. */
export function runErrorMessage(error: unknown): string {
  if (typeof error === 'string') return error;
  if (
    error &&
    typeof error === 'object' &&
    typeof (error as { message?: unknown }).message === 'string'
  ) {
    return (error as { message: string }).message;
  }
  return 'The run failed';
}
