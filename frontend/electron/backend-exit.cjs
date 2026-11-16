// What the supervisor does when the backend child exits (api.md 4.3).
// Pure: no Electron, no I/O.

// Repeats PORT_IN_USE_EXIT_CODE from
// backend/src/infrastructure/process/exit-codes.ts: the shell cannot import
// the TypeScript module, so change both together.
const PORT_IN_USE_EXIT_CODE = 98;

/**
 * "restart" keeps the crash back-off path; "port-in-use" means retrying can
 * never succeed (another program holds the port), so the shell goes `down` at
 * once.
 */
function classifyBackendExit(code) {
  return code === PORT_IN_USE_EXIT_CODE ? "port-in-use" : "restart";
}

function portInUseMessage(port) {
  return `Port ${port} is already in use by another program (or another copy of the app), so the backend cannot start. Close that program and restart the app.`;
}

module.exports = {
  PORT_IN_USE_EXIT_CODE,
  classifyBackendExit,
  portInUseMessage,
};
