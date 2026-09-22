const { app, BrowserWindow, dialog, ipcMain } = require("electron");
const { spawn } = require("child_process");
const crypto = require("crypto");
const fs = require("fs");
const http = require("http");
const path = require("path");

const APP_DISPLAY_NAME = "Halo BI Assistant";
// The productName every release before the rename shipped with.
const LEGACY_APP_NAME = "Questions to Insights";
const DEV_URL = process.env.ELECTRON_DEV_URL;
const BACKEND_PORT = process.env.BACKEND_PORT || "3000";
const BACKEND_READY_TIMEOUT_MS = 30_000;
const MAX_DIAGNOSTIC_ENTRIES = 2_000;
const MAX_DIAGNOSTIC_FILE_BYTES = 5 * 1024 * 1024;

// Backend supervisor: exponential backoff for unexpected (non-quit) exits.
const RESTART_BACKOFFS_MS = [1_000, 2_000, 4_000];
const MAX_RESTART_ATTEMPTS = RESTART_BACKOFFS_MS.length;
// A backend that stays up (ready) this long is considered healthy again, so a
// later crash gets its own fresh backoff budget instead of inheriting one
// from an old, unrelated failure streak.
const STABLE_UPTIME_MS = 60_000;
const LEGACY_DATA_MARKERS = ["app.sqlite", "mastra.sqlite", "workspaces"];
const APP_SECRET_FILE_NAME = ".app-secret";
const FILE_LOAD_RECOVERY_LIMIT = 3;
const ERR_FILE_NOT_FOUND = -6;

const ANSI_ESCAPE = /\u001b\[[0-9;]*m/g;

// Integration tests use an isolated profile so they never read or overwrite a
// developer's saved datasources, sessions, panel preferences, or diagnostics.
if (process.env.QUESTIONS_TO_INSIGHTS_USER_DATA_DIR) {
  app.setPath("userData", process.env.QUESTIONS_TO_INSIGHTS_USER_DATA_DIR);
} else {
  // Renaming the app moves `userData`, which is where the profile lives
  // (app.sqlite, workspaces, diagnostics). Installs made under the old name
  // keep theirs: prefer the current directory, fall back to the legacy one
  // when only that exists.
  const current = app.getPath("userData");
  if (!fs.existsSync(current)) {
    const legacy = path.join(path.dirname(current), LEGACY_APP_NAME);
    if (fs.existsSync(legacy)) app.setPath("userData", legacy);
  }
}

// Window title and About panel. The macOS menu bar ignores this — it reads the
// running bundle's CFBundleName (build.productName when packaged, and the
// patched Electron.app when running unpackaged via `scripts/brand-electron.sh`).
app.setName(APP_DISPLAY_NAME);

let backendProcess = null;
let diagnosticsLogPath = null;
let diagnosticSequence = 0;
let diagnosticEntries = [];

// Backend supervisor state.
let backendStatus = "starting"; // 'starting' | 'ready' | 'restarting' | 'down'
let backendQuitting = false; // guards the 'exit' handler against restarting during app shutdown
let restartAttempt = 0;
let restartTimer = null;
let stableTimer = null;
let readinessPollGeneration = 0;
let resolvedAppDataDir = null;
let resolvedAppSecret = null;

function setBackendStatus(status) {
  backendStatus = status;
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) {
      window.webContents.send("backend-status", { status });
    }
  }
}

function redactDiagnosticText(value) {
  return String(value)
    .replace(
      /((?:["']?(?:password|token|api[_-]?key|secret|authorization)["']?)\s*[:=]\s*)(["'])(.*?)\2/gi,
      "$1$2[REDACTED]$2",
    )
    .replace(
      /(["']?(?:password|token|api[_-]?key|secret|authorization)["']?\s*[:=]\s*["']?)[^"',\s}]+/gi,
      "$1[REDACTED]",
    )
    .replace(/(bearer\s+)[a-z0-9._~+/-]+=*/gi, "$1[REDACTED]")
    .replace(/(postgres(?:ql)?:\/\/[^:\s/]+:)[^@\s]+@/gi, "$1[REDACTED]@");
}

function safeDiagnosticDetails(details) {
  if (details === undefined) return undefined;
  try {
    return JSON.parse(redactDiagnosticText(JSON.stringify(details)));
  } catch {
    return redactDiagnosticText(details);
  }
}

function recordDiagnostic(level, source, message, details) {
  const entry = {
    id: `${Date.now()}-${++diagnosticSequence}`,
    timestamp: new Date().toISOString(),
    level: ["debug", "info", "warn", "error"].includes(level) ? level : "info",
    source: redactDiagnosticText(source || "system").slice(0, 120),
    message: redactDiagnosticText(message || "(no message)").slice(0, 10_000),
    details: safeDiagnosticDetails(details),
  };
  diagnosticEntries.push(entry);
  if (diagnosticEntries.length > MAX_DIAGNOSTIC_ENTRIES) {
    diagnosticEntries = diagnosticEntries.slice(-MAX_DIAGNOSTIC_ENTRIES);
  }
  if (diagnosticsLogPath) {
    try {
      fs.appendFileSync(
        diagnosticsLogPath,
        `${JSON.stringify(entry)}\n`,
        "utf8",
      );
    } catch {
      // Diagnostics must never crash the application they are observing.
    }
  }
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) {
      window.webContents.send("diagnostics:entry", entry);
    }
  }
  return entry;
}

function diagnosticLevelFromLine(line, fallbackLevel) {
  if (/\b(ERROR|FATAL)\b/i.test(line)) return "error";
  if (/\bWARN(?:ING)?\b|[A-Za-z]+Warning\b/i.test(line)) return "warn";
  if (/\bDEBUG\b/i.test(line)) return "debug";
  return fallbackLevel;
}

function recordBackendLine(rawLine, fallbackLevel) {
  const line = rawLine.replace(ANSI_ESCAPE, "").trim();
  if (!line) return;
  try {
    const parsed = JSON.parse(line);
    if (parsed && typeof parsed === "object" && parsed.message) {
      const { message, level, ...details } = parsed;
      recordDiagnostic(
        typeof level === "string" ? level : fallbackLevel,
        "backend:mastra",
        message,
        details,
      );
      return;
    }
  } catch {
    // Most Nest output is human-readable rather than JSON.
  }
  recordDiagnostic(
    diagnosticLevelFromLine(line, fallbackLevel),
    "backend",
    line,
  );
}

function captureBackendStream(stream, output, fallbackLevel) {
  let pending = "";
  stream.on("data", (chunk) => {
    output.write(chunk);
    pending += chunk.toString("utf8");
    const lines = pending.split(/\r?\n/);
    pending = lines.pop() ?? "";
    for (const line of lines) recordBackendLine(line, fallbackLevel);
  });
  stream.on("end", () => {
    if (pending.trim()) recordBackendLine(pending, fallbackLevel);
  });
}

function initializeDiagnostics() {
  const logsDir = path.join(app.getPath("userData"), "logs");
  fs.mkdirSync(logsDir, { recursive: true });
  diagnosticsLogPath = path.join(logsDir, "system.ndjson");
  try {
    if (
      fs.existsSync(diagnosticsLogPath) &&
      fs.statSync(diagnosticsLogPath).size > MAX_DIAGNOSTIC_FILE_BYTES
    ) {
      const previousPath = path.join(logsDir, "system.previous.ndjson");
      if (fs.existsSync(previousPath)) fs.unlinkSync(previousPath);
      fs.renameSync(diagnosticsLogPath, previousPath);
    }
    if (fs.existsSync(diagnosticsLogPath)) {
      diagnosticEntries = fs
        .readFileSync(diagnosticsLogPath, "utf8")
        .split(/\r?\n/)
        .filter(Boolean)
        .slice(-MAX_DIAGNOSTIC_ENTRIES)
        .flatMap((line) => {
          try {
            return [JSON.parse(line)];
          } catch {
            return [];
          }
        });
    }
  } catch {
    diagnosticEntries = [];
  }

  ipcMain.handle("diagnostics:list", () => diagnosticEntries);
  ipcMain.on("diagnostics:record", (_event, entry) => {
    recordDiagnostic(
      entry?.level,
      entry?.source || "renderer",
      entry?.message,
      entry?.details,
    );
  });
  ipcMain.handle("diagnostics:export", async () => {
    const result = await dialog.showSaveDialog({
      title: "Export diagnostics for an LLM",
      defaultPath: `questions-to-insights-diagnostics-${new Date()
        .toISOString()
        .slice(0, 10)}.md`,
      filters: [
        { name: "Markdown", extensions: ["md"] },
        { name: "Text", extensions: ["txt"] },
      ],
    });
    if (result.canceled || !result.filePath) {
      return { ok: false, canceled: true };
    }
    await fs.promises.writeFile(
      result.filePath,
      buildDiagnosticMarkdown(diagnosticEntries),
      "utf8",
    );
    recordDiagnostic("info", "electron", "Diagnostics report exported");
    return {
      ok: true,
      canceled: false,
      path: result.filePath,
      count: diagnosticEntries.length,
    };
  });

  recordDiagnostic("info", "electron", "Application diagnostics initialized", {
    appVersion: app.getVersion(),
    platform: process.platform,
    architecture: process.arch,
  });
}

function buildDiagnosticMarkdown(entries) {
  const counts = { debug: 0, info: 0, warn: 0, error: 0 };
  const sources = new Map();
  for (const entry of entries) {
    counts[entry.level] = (counts[entry.level] ?? 0) + 1;
    sources.set(entry.source, (sources.get(entry.source) ?? 0) + 1);
  }
  const issues = entries
    .map((entry, index) => ({ entry, index }))
    .filter(({ entry }) => entry.level === "error" || entry.level === "warn")
    .slice(-50);
  const lines = [
    "# Questions to Insights — Diagnostics Report",
    "",
    `Generated: ${new Date().toISOString()}`,
    `Application version: ${app.getVersion()}`,
    `Platform: ${process.platform} (${process.arch})`,
    `Entries included: ${entries.length}`,
    "",
    "> Secrets and connection credentials are automatically redacted. This report is intended to be attached to an LLM or support request.",
    "",
    "## Instructions for the analyzing LLM",
    "",
    "Identify the earliest likely root cause, distinguish it from downstream symptoms, cite timestamps and sources, and propose safe next diagnostic or remediation steps. State uncertainty explicitly.",
    "",
    "## Summary",
    "",
    `- Errors: ${counts.error}`,
    `- Warnings: ${counts.warn}`,
    `- Info: ${counts.info}`,
    `- Debug: ${counts.debug}`,
    `- Sources: ${
      Array.from(sources.entries())
        .map(([source, count]) => `${source} (${count})`)
        .join(", ") || "none"
    }`,
    "",
    "## Errors and warnings with nearby context",
    "",
  ];
  if (issues.length === 0) {
    lines.push("No errors or warnings were captured.", "");
  } else {
    issues.forEach(({ entry, index }, issueIndex) => {
      lines.push(
        `### ${issueIndex + 1}. ${entry.level.toUpperCase()} — ${entry.source}`,
        "",
        `Timestamp: ${entry.timestamp}`,
        "",
        safeMarkdownLogText(entry.message),
        "",
        "Context:",
        "```text",
        ...entries
          .slice(Math.max(0, index - 3), index + 2)
          .map(formatDiagnosticLine),
        "```",
        "",
      );
      if (entry.details !== undefined) {
        lines.push(
          "Details:",
          "```json",
          safeMarkdownLogText(JSON.stringify(entry.details, null, 2)),
          "```",
          "",
        );
      }
    });
  }
  lines.push(
    "## Chronological log",
    "",
    "```text",
    ...entries.map(formatDiagnosticLine),
    "```",
    "",
  );
  return redactDiagnosticText(lines.join("\n"));
}

function formatDiagnosticLine(entry) {
  return `${entry.timestamp} ${entry.level.toUpperCase().padEnd(5)} [${entry.source}] ${safeMarkdownLogText(entry.message).replace(/\r?\n/g, "\\n")}`;
}

function safeMarkdownLogText(value) {
  return String(value).replace(/```/g, "~~~");
}

function migrateDataEntry(src, dest) {
  try {
    fs.renameSync(src, dest);
  } catch (error) {
    if (error && error.code === "EXDEV") {
      // Cross-device (common when the roaming profile is redirected to a
      // network share) — rename can't cross devices, so copy then remove.
      fs.cpSync(src, dest, { recursive: true });
      fs.rmSync(src, { recursive: true, force: true });
    } else {
      throw error;
    }
  }
}

// Windows roaming profiles (AppData\Roaming, which is what app.getPath
// "userData" resolves to) are frequently synced by VDI/enterprise policy and
// can end up locked or slow to write to. Redirect the backend's SQLite data
// to the local, non-roaming profile (AppData\Local) instead. One-time
// migration moves any existing data across; any failure logs a diagnostic
// and keeps using the roaming directory so data is never lost.
function computeAppDataDir() {
  const roamingDir = app.getPath("userData");
  // Integration tests pin an isolated profile dir; never redirect that one.
  if (process.env.QUESTIONS_TO_INSIGHTS_USER_DATA_DIR) return roamingDir;
  if (process.platform !== "win32") return roamingDir;
  if (!process.env.LOCALAPPDATA) return roamingDir;

  const localDir = path.join(process.env.LOCALAPPDATA, APP_DISPLAY_NAME);
  if (fs.existsSync(localDir)) return localDir;

  const hasLegacyData = LEGACY_DATA_MARKERS.some((name) =>
    fs.existsSync(path.join(roamingDir, name)),
  );
  if (!hasLegacyData) {
    try {
      fs.mkdirSync(localDir, { recursive: true });
      return localDir;
    } catch (error) {
      recordDiagnostic(
        "error",
        "electron",
        "Could not create the local app data directory; using the roaming profile",
        { message: error.message, stack: error.stack },
      );
      return roamingDir;
    }
  }

  const migrated = [];
  try {
    fs.mkdirSync(localDir, { recursive: true });
    for (const name of LEGACY_DATA_MARKERS) {
      const src = path.join(roamingDir, name);
      const dest = path.join(localDir, name);
      if (!fs.existsSync(src)) continue;
      migrateDataEntry(src, dest);
      migrated.push(name);
    }
    recordDiagnostic(
      "info",
      "electron",
      "Migrated backend data off the roaming profile to the local app data directory",
      { from: roamingDir, to: localDir },
    );
    return localDir;
  } catch (error) {
    // Best-effort rollback of anything already moved so the roaming copy
    // stays authoritative and we never end up with data split across both.
    for (const name of migrated) {
      const src = path.join(roamingDir, name);
      const dest = path.join(localDir, name);
      try {
        if (fs.existsSync(dest) && !fs.existsSync(src)) {
          fs.renameSync(dest, src);
        }
      } catch {
        // Leave the partially migrated entry where it landed rather than
        // risk deleting anything.
      }
    }
    recordDiagnostic(
      "error",
      "electron",
      "Backend data migration to the local app data directory failed; continuing on the roaming profile",
      { message: error.message, stack: error.stack },
    );
    return roamingDir;
  }
}

// The backend uses APP_SECRET to encrypt stored API keys, so it must stay
// stable across launches. Generate it once and persist it alongside the
// resolved backend data directory (so the secret and the data it protects
// always travel together, including through the Windows migration above).
function resolveAppSecret(dataDir) {
  if (process.env.APP_SECRET) return process.env.APP_SECRET;

  const secretPath = path.join(dataDir, APP_SECRET_FILE_NAME);
  try {
    if (fs.existsSync(secretPath)) {
      const existing = fs.readFileSync(secretPath, "utf8").trim();
      if (existing) return existing;
    }
  } catch (error) {
    recordDiagnostic(
      "warn",
      "electron",
      "Could not read the persisted APP_SECRET file; generating a new one",
      { message: error.message },
    );
  }

  const secret = crypto.randomBytes(32).toString("hex");
  try {
    fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(secretPath, secret, { mode: 0o600 });
  } catch (error) {
    recordDiagnostic(
      "error",
      "electron",
      "Could not persist the APP_SECRET file; a new secret will be generated on next launch, invalidating previously encrypted data",
      { message: error.message, stack: error.stack },
    );
  }
  return secret;
}

function backendEntry() {
  if (app.isPackaged) {
    // Staged by scripts/stage-backend.sh and copied via electron-builder extraResources.
    return path.join(process.resourcesPath, "backend", "dist", "main.js");
  }
  return path.join(__dirname, "..", "..", "backend", "dist", "main.js");
}

function startBackend() {
  const entry = backendEntry();
  if (!fs.existsSync(entry)) {
    console.warn(`[backend] not started, entry missing: ${entry}`);
    recordDiagnostic("error", "electron", "Backend entry file is missing", {
      entry,
    });
    return;
  }
  // Reuse Electron's binary as plain Node so packaged apps don't need a system Node.
  backendProcess = spawn(process.execPath, [entry], {
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: "1",
      PORT: BACKEND_PORT,
      // SQLite app database lives in the OS-standard per-user app folder
      // (redirected off Windows roaming profiles — see computeAppDataDir).
      APP_DATA_DIR: resolvedAppDataDir || app.getPath("userData"),
      APP_SECRET: resolvedAppSecret,
    },
    cwd: path.dirname(entry),
    stdio: ["ignore", "pipe", "pipe"],
  });
  captureBackendStream(backendProcess.stdout, process.stdout, "info");
  captureBackendStream(backendProcess.stderr, process.stderr, "error");
  backendProcess.on("error", (error) => {
    recordDiagnostic("error", "electron", "Backend process failed to start", {
      message: error.message,
      stack: error.stack,
    });
  });
  backendProcess.on("exit", (code) => {
    console.log(`[backend] exited (code ${code})`);
    recordDiagnostic(
      code === 0 || code === null ? "info" : "error",
      "electron",
      `Backend process exited${code === null ? "" : ` with code ${code}`}`,
    );
    backendProcess = null;
    clearTimeout(stableTimer);
    stableTimer = null;
    // A quit-initiated kill must not trigger a restart.
    if (backendQuitting) return;
    scheduleBackendRestart(code);
  });
}

// Once the backend has been ready for STABLE_UPTIME_MS without exiting, treat
// it as healthy again: a later crash gets a fresh restart budget instead of
// inheriting one from an old, unrelated failure streak.
function armStableResetTimer() {
  clearTimeout(stableTimer);
  const processAtArmTime = backendProcess;
  stableTimer = setTimeout(() => {
    if (backendProcess === processAtArmTime && backendProcess) {
      restartAttempt = 0;
      recordDiagnostic(
        "info",
        "electron",
        "Backend has been stable; restart budget reset",
      );
    }
  }, STABLE_UPTIME_MS);
}

// Polls the existing readiness endpoint (works the same after a restart as
// on first launch) and pushes 'ready' once it responds. Guarded by a
// generation counter so a stale poll from an earlier restart can't clobber
// the status set by a more recent one.
async function pollUntilReadyThenNotify() {
  const myGeneration = ++readinessPollGeneration;
  const ready = await waitForBackend();
  if (backendQuitting || myGeneration !== readinessPollGeneration) return;
  if (ready) {
    setBackendStatus("ready");
    armStableResetTimer();
  }
}

function scheduleBackendRestart(exitCode) {
  if (restartAttempt >= MAX_RESTART_ATTEMPTS) {
    setBackendStatus("down");
    recordDiagnostic(
      "error",
      "electron",
      "Backend restart budget exhausted after repeated rapid failures; giving up",
      { attempts: restartAttempt, exitCode },
    );
    return;
  }

  const delay = RESTART_BACKOFFS_MS[restartAttempt];
  restartAttempt += 1;
  setBackendStatus("restarting");
  recordDiagnostic(
    "warn",
    "electron",
    `Restarting backend in ${delay}ms (attempt ${restartAttempt}/${MAX_RESTART_ATTEMPTS})`,
    { exitCode },
  );
  clearTimeout(restartTimer);
  restartTimer = setTimeout(() => {
    restartTimer = null;
    if (backendQuitting) return;
    startBackend();
    void pollUntilReadyThenNotify();
  }, delay);
}

function stopBackend() {
  backendQuitting = true;
  clearTimeout(restartTimer);
  restartTimer = null;
  clearTimeout(stableTimer);
  stableTimer = null;
  if (backendProcess) {
    backendProcess.kill();
    backendProcess = null;
  }
}

function backendIsReady() {
  return new Promise((resolve) => {
    const request = http.get(
      {
        hostname: "127.0.0.1",
        port: BACKEND_PORT,
        path: "/sessions",
        timeout: 500,
      },
      (response) => {
        response.resume();
        resolve(response.statusCode === 200);
      },
    );
    request.on("timeout", () => request.destroy());
    request.on("error", () => resolve(false));
  });
}

async function waitForBackend() {
  const deadline = Date.now() + BACKEND_READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (await backendIsReady()) return true;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return false;
}

// The Halo BI mark lives in build resources (electron-builder turns it into the
// .icns/.ico) and is copied into the renderer bundle, which is the copy that
// survives packaging.
function resolveAppIcon() {
  const candidates = [
    path.join(__dirname, "../build/icon.png"),
    path.join(__dirname, "../dist/frontend/browser/brand/icon.png"),
  ];
  return candidates.find((candidate) => fs.existsSync(candidate));
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 600,
    title: APP_DISPLAY_NAME,
    titleBarStyle: "hiddenInset",
    backgroundColor: "#1c1c1c",
    // Packaged macOS builds take the icon from the bundle; this covers the
    // window/taskbar icon everywhere else (dev runs, Windows, Linux).
    icon: resolveAppIcon(),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, "preload.cjs"),
    },
  });

  let fileLoadRecoveries = 0;

  win.webContents.on("did-fail-load", (_event, code, description, url) => {
    recordDiagnostic(
      "error",
      "electron:renderer",
      "Application page failed to load",
      {
        code,
        description,
        url,
      },
    );
    // A directory file:// URL (e.g. after an in-app reload lands on
    // .../browser/ instead of .../browser/index.html) 404s as
    // ERR_FILE_NOT_FOUND. Recover by reloading the real entry point, capped
    // so a persistently broken bundle doesn't loop forever.
    if (
      typeof url === "string" &&
      url.startsWith("file://") &&
      code === ERR_FILE_NOT_FOUND
    ) {
      if (fileLoadRecoveries >= FILE_LOAD_RECOVERY_LIMIT) {
        recordDiagnostic(
          "error",
          "electron:renderer",
          "Exhausted file load recovery attempts; leaving the page as-is",
          { url, attempts: fileLoadRecoveries },
        );
        return;
      }
      fileLoadRecoveries += 1;
      recordDiagnostic(
        "warn",
        "electron:renderer",
        "Recovering from a missing file:// load by reloading the app entry point",
        { url, attempt: fileLoadRecoveries },
      );
      win.loadFile(path.join(__dirname, "../dist/frontend/browser/index.html"));
    }
  });
  win.webContents.on("did-finish-load", () => {
    fileLoadRecoveries = 0;
    if (!win.isDestroyed()) {
      win.webContents.send("backend-status", { status: backendStatus });
    }
  });
  win.webContents.on("render-process-gone", (_event, details) => {
    recordDiagnostic(
      "error",
      "electron:renderer",
      "Renderer process stopped",
      details,
    );
  });
  win.on("unresponsive", () => {
    recordDiagnostic(
      "warn",
      "electron:renderer",
      "Application window became unresponsive",
    );
  });

  if (DEV_URL) {
    win.loadURL(DEV_URL);
  } else {
    win.loadFile(path.join(__dirname, "../dist/frontend/browser/index.html"));
  }
}

app.whenReady().then(async () => {
  initializeDiagnostics();
  // Unpackaged macOS runs keep Electron's own dock icon unless we set it; the
  // packaged bundle already carries the Halo BI icon.
  if (process.platform === "darwin" && !app.isPackaged) {
    const icon = resolveAppIcon();
    if (icon) app.dock?.setIcon(icon);
  }
  resolvedAppDataDir = computeAppDataDir();
  resolvedAppSecret = resolveAppSecret(resolvedAppDataDir);

  setBackendStatus("starting");
  startBackend();
  if (await waitForBackend()) {
    setBackendStatus("ready");
    armStableResetTimer();
  } else {
    console.warn(
      `[backend] was not ready after ${BACKEND_READY_TIMEOUT_MS}ms; opening the window anyway`,
    );
    recordDiagnostic(
      "error",
      "electron",
      "Backend did not become ready before timeout",
      {
        timeoutMs: BACKEND_READY_TIMEOUT_MS,
      },
    );
    // The supervisor keeps polling and the backend-status banner keeps the
    // user informed; open the window rather than block on it indefinitely.
    void pollUntilReadyThenNotify();
  }
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("before-quit", stopBackend);

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
