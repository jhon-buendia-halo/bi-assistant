// Backend PID file and stale-backend cleanup for the desktop shell
// (api.md 4.3 "Stale backend", data-model.md 1.2, roadmap 1.7.21).
//
// Windows does not end a child when its parent dies, so a crashed or
// force-ended window can leave the backend running and holding the port. The
// shell records each backend's PID and, at the next startup, stops a recorded
// process that is still alive — but only when it is the app's own executable,
// because PIDs are reused.
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const PID_FILE_NAME = "backend.pid";
const STOP_WAIT_MS = 5000;
const STOP_POLL_MS = 100;

function pidFilePath(dataDir) {
  return path.join(dataDir, PID_FILE_NAME);
}

function readBackendPid(dataDir) {
  try {
    const text = fs.readFileSync(pidFilePath(dataDir), "utf8").trim();
    if (!/^\d+$/.test(text)) return null;
    const pid = Number(text);
    return Number.isSafeInteger(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

function writeBackendPid(dataDir, pid) {
  try {
    fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(pidFilePath(dataDir), `${pid}\n`);
    return true;
  } catch {
    return false;
  }
}

/** Removes the file; with `onlyPid`, only when it still records that PID. */
function clearBackendPid(dataDir, onlyPid) {
  if (onlyPid !== undefined && readBackendPid(dataDir) !== onlyPid) return;
  try {
    fs.rmSync(pidFilePath(dataDir), { force: true });
  } catch {
    // Best effort: a leftover file is re-checked (and cleared) next startup.
  }
}

function isProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === "EPERM";
  }
}

/**
 * The image name of a running PID, or null. Windows: `tasklist` CSV
 * (`"Halo BI Assistant.exe","1234",…`). Elsewhere: `ps -o comm=`, which may be
 * a full path (macOS) or truncated to 15 characters (Linux).
 */
function processImageName(pid, platform = process.platform, run = execFileSync) {
  try {
    if (platform === "win32") {
      const out = run(
        "tasklist",
        ["/FI", `PID eq ${pid}`, "/FO", "CSV", "/NH"],
        { encoding: "utf8", windowsHide: true },
      );
      const match = /^"([^"]+)","(\d+)"/m.exec(out);
      return match && Number(match[2]) === pid ? match[1] : null;
    }
    const out = run("ps", ["-p", String(pid), "-o", "comm="], {
      encoding: "utf8",
    });
    const name = out.trim();
    return name ? path.basename(name) : null;
  } catch {
    return null;
  }
}

function imageMatches(actual, expected) {
  if (!actual || !expected) return false;
  const a = actual.toLowerCase();
  const e = expected.toLowerCase();
  // Linux truncates `comm` to 15 characters.
  return a === e || (a.length === 15 && e.startsWith(a));
}

async function waitUntilGone(pid, isAlive, sleep, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!isAlive(pid)) return true;
    await sleep(STOP_POLL_MS);
  }
  return !isAlive(pid);
}

/**
 * Stops the backend recorded in `<dataDir>/backend.pid` when it is still
 * running as `expectedImage`, then removes the file. Resolves to
 * `{ pid, stopped }` (`pid` null when no file was found).
 */
async function stopStaleBackend(
  dataDir,
  {
    expectedImage = path.basename(process.execPath),
    ownPid = process.pid,
    isAlive = isProcessAlive,
    imageName = (pid) => processImageName(pid),
    kill = (pid) => process.kill(pid),
    sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    timeoutMs = STOP_WAIT_MS,
  } = {},
) {
  const pid = readBackendPid(dataDir);
  if (pid === null) {
    clearBackendPid(dataDir);
    return { pid: null, stopped: false };
  }
  let stopped = false;
  if (
    pid !== ownPid &&
    isAlive(pid) &&
    imageMatches(imageName(pid), expectedImage)
  ) {
    try {
      kill(pid);
      stopped = await waitUntilGone(pid, isAlive, sleep, timeoutMs);
    } catch {
      stopped = false;
    }
  }
  clearBackendPid(dataDir);
  return { pid, stopped };
}

module.exports = {
  PID_FILE_NAME,
  readBackendPid,
  writeBackendPid,
  clearBackendPid,
  isProcessAlive,
  processImageName,
  imageMatches,
  stopStaleBackend,
};
