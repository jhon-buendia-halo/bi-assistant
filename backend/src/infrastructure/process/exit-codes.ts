// Dedicated backend exit codes the desktop shell acts on (api.md 4.3).
// The shell cannot import this file: `frontend/electron/backend-exit.cjs`
// repeats the value 98, so change both together.

/**
 * The HTTP port is already taken by another program (or another copy of the
 * app). Retrying cannot help, so the shell does not restart the backend.
 */
export const PORT_IN_USE_EXIT_CODE = 98;

/** `listen` failed with EADDRINUSE; carries the port for the one-line message. */
export class PortInUseError extends Error {
  constructor(readonly port: number) {
    super(`Port ${port} is already in use by another process`);
    this.name = 'PortInUseError';
  }
}

export function isAddressInUse(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as NodeJS.ErrnoException).code === 'EADDRINUSE'
  );
}

/** Exit code for a failed bootstrap: 98 for a taken port, else 1. */
export function bootstrapExitCode(error: unknown): number {
  return error instanceof PortInUseError ? PORT_IN_USE_EXIT_CODE : 1;
}
