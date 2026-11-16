// Groups the backend's stdout/stderr lines into diagnostics entries, so a
// stack trace or a multi-line error is one entry instead of 20-30
// (api.md 4.2 "Backend output capture"). Pure: no Electron, no I/O.
//
// A new entry starts on a head line: a Nest log prefix, a Mastra/pino JSON
// line, a Mastra pretty-printed `LEVEL [date …]` line, a `(node:<pid>)`
// warning, or the first line after a quiet gap on the
// same stream. Everything else (stack frames, `{`, `}`, `^`, indented text,
// the `(Use ...)` hint) is appended to the entry in progress.

const NEST_HEAD = /^\[Nest\]\s+\d+\s+- /;
const NODE_WARNING_HEAD = /^\(node:\d+\)/;
/** Mastra's pretty-printed logger: `ERROR [2026-11-13 12:21:53.410 -0500] (Mastra): …`. */
const LEVEL_TIMESTAMP_HEAD =
  /^(?:TRACE|DEBUG|INFO|WARN|ERROR|FATAL)\s+\[\d{4}-\d{2}-\d{2}[ T]/;
/** Quiet time on a stream after which the pending group is flushed. */
const GROUP_GAP_MS = 40;

function levelFromLine(line, fallbackLevel) {
  if (/\b(ERROR|FATAL)\b/i.test(line)) return "error";
  if (/\bWARN(?:ING)?\b|[A-Za-z]+Warning\b/i.test(line)) return "warn";
  if (/\bDEBUG\b/i.test(line)) return "debug";
  return fallbackLevel;
}

/** The parsed object of a Mastra/pino JSON line that has a `message`, else null. */
function parseJsonLine(line) {
  if (!line.startsWith("{")) return null;
  try {
    const parsed = JSON.parse(line);
    if (parsed && typeof parsed === "object" && parsed.message) return parsed;
  } catch {
    // Not JSON: a `{` that opens a stack-trace object literal.
  }
  return null;
}

function isHeadLine(line) {
  return (
    NEST_HEAD.test(line) ||
    NODE_WARNING_HEAD.test(line) ||
    LEVEL_TIMESTAMP_HEAD.test(line)
  );
}

/**
 * `onEntry` receives either
 *   { kind: "json", parsed }                    one Mastra/pino line, or
 *   { kind: "text", level, message, details }   a head line plus continuation
 *                                               lines (`details` is a string,
 *                                               or undefined when none).
 * `push(line)` takes one line without its newline (ANSI already stripped);
 * `end()` flushes at stream end. A pending group is also flushed after
 * `gapMs` without a new line.
 */
function createLineGrouper({
  fallbackLevel,
  onEntry,
  gapMs = GROUP_GAP_MS,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
}) {
  let head = null;
  let continuation = [];
  let timer = null;

  function flush() {
    clearTimer(timer);
    timer = null;
    if (head === null) return;
    const entry = {
      kind: "text",
      level: levelFromLine(head, fallbackLevel),
      message: head,
      details: continuation.length ? continuation.join("\n") : undefined,
    };
    head = null;
    continuation = [];
    onEntry(entry);
  }

  function arm() {
    clearTimer(timer);
    timer = setTimer(flush, gapMs);
    timer?.unref?.();
  }

  function push(rawLine) {
    const line = rawLine.trimEnd();
    if (!line.trim()) return;
    const parsed = parseJsonLine(line.trim());
    if (parsed) {
      flush();
      onEntry({ kind: "json", parsed });
      return;
    }
    if (head === null || isHeadLine(line.trim())) {
      flush();
      head = line.trim();
    } else {
      continuation.push(line);
    }
    arm();
  }

  return { push, end: flush };
}

module.exports = { createLineGrouper, levelFromLine, GROUP_GAP_MS };
