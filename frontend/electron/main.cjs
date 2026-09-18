const { app, BrowserWindow, dialog, ipcMain } = require("electron");
const { spawn } = require("child_process");
const fs = require("fs");
const http = require("http");
const path = require("path");

const APP_DISPLAY_NAME = "Halo BI Assistant";
// The productName every release before the rename shipped with.
const LEGACY_APP_NAME = "Questions to Insights";
const DEV_URL = process.env.ELECTRON_DEV_URL;
const BACKEND_PORT = process.env.BACKEND_PORT || "3000";
const BACKEND_READY_TIMEOUT_MS = 15_000;
const MAX_DIAGNOSTIC_ENTRIES = 2_000;
const MAX_DIAGNOSTIC_FILE_BYTES = 5 * 1024 * 1024;
const ANSI_ESCAPE = /\u001b\[[0-9;]*m/g;

// Integration tests use an isolated profile so they never read or overwrite a
// developer's saved datasources, projects, panel preferences, or diagnostics.
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
      // SQLite app database lives in the OS-standard per-user app folder.
      APP_DATA_DIR: app.getPath("userData"),
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
  });
}

function stopBackend() {
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
        path: "/projects",
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
  startBackend();
  if (!(await waitForBackend())) {
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
