const { app, BrowserWindow } = require('electron');
const { spawn } = require('child_process');
const fs = require('fs');
const http = require('http');
const path = require('path');

const DEV_URL = process.env.ELECTRON_DEV_URL;
const BACKEND_PORT = process.env.BACKEND_PORT || '3000';
const BACKEND_READY_TIMEOUT_MS = 15_000;

let backendProcess = null;

function backendEntry() {
  if (app.isPackaged) {
    // Staged by scripts/stage-backend.sh and copied via electron-builder extraResources.
    return path.join(process.resourcesPath, 'backend', 'dist', 'main.js');
  }
  return path.join(__dirname, '..', '..', 'backend', 'dist', 'main.js');
}

function startBackend() {
  const entry = backendEntry();
  if (!fs.existsSync(entry)) {
    console.warn(`[backend] not started, entry missing: ${entry}`);
    return;
  }
  // Reuse Electron's binary as plain Node so packaged apps don't need a system Node.
  backendProcess = spawn(process.execPath, [entry], {
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1',
      PORT: BACKEND_PORT,
      // SQLite app database lives in the OS-standard per-user app folder.
      APP_DATA_DIR: app.getPath('userData'),
    },
    cwd: path.dirname(entry),
    stdio: 'inherit',
  });
  backendProcess.on('exit', (code) => {
    console.log(`[backend] exited (code ${code})`);
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
        hostname: '127.0.0.1',
        port: BACKEND_PORT,
        path: '/projects',
        timeout: 500,
      },
      (response) => {
        response.resume();
        resolve(response.statusCode === 200);
      },
    );
    request.on('timeout', () => request.destroy());
    request.on('error', () => resolve(false));
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

function createWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 600,
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#1c1c1c',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (DEV_URL) {
    win.loadURL(DEV_URL);
  } else {
    win.loadFile(path.join(__dirname, '../dist/frontend/browser/index.html'));
  }
}

app.whenReady().then(async () => {
  startBackend();
  if (!(await waitForBackend())) {
    console.warn(
      `[backend] was not ready after ${BACKEND_READY_TIMEOUT_MS}ms; opening the window anyway`,
    );
  }
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('before-quit', stopBackend);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
