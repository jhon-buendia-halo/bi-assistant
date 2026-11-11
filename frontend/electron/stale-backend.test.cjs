// node --test frontend/electron/stale-backend.test.cjs (roadmap 1.7.21)
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const {
  PID_FILE_NAME,
  readBackendPid,
  writeBackendPid,
  clearBackendPid,
  processImageName,
  imageMatches,
  stopStaleBackend,
} = require("./stale-backend.cjs");

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "qti-stale-backend-"));
}

const noSleep = async () => {};

test("writes, reads and clears the PID file", () => {
  const dir = tempDir();
  assert.equal(readBackendPid(dir), null);
  assert.equal(writeBackendPid(dir, 4242), true);
  assert.equal(fs.readFileSync(path.join(dir, PID_FILE_NAME), "utf8"), "4242\n");
  assert.equal(readBackendPid(dir), 4242);
  clearBackendPid(dir, 1111);
  assert.equal(readBackendPid(dir), 4242, "a different PID leaves the file");
  clearBackendPid(dir, 4242);
  assert.equal(fs.existsSync(path.join(dir, PID_FILE_NAME)), false);
});

test("reads a damaged PID file as no PID", () => {
  const dir = tempDir();
  for (const text of ["", "abc", "-3", "0", "12 34"]) {
    fs.writeFileSync(path.join(dir, PID_FILE_NAME), text);
    assert.equal(readBackendPid(dir), null, JSON.stringify(text));
  }
});

test("stops a live backend running as the app's executable", async () => {
  const dir = tempDir();
  writeBackendPid(dir, 500);
  let alive = true;
  const killed = [];
  const result = await stopStaleBackend(dir, {
    expectedImage: "Halo BI Assistant.exe",
    ownPid: 1,
    isAlive: () => alive,
    imageName: () => "Halo BI Assistant.exe",
    kill: (pid) => {
      killed.push(pid);
      alive = false;
    },
    sleep: noSleep,
  });
  assert.deepEqual(killed, [500]);
  assert.deepEqual(result, { pid: 500, stopped: true });
  assert.equal(readBackendPid(dir), null);
});

test("leaves a reused PID that belongs to another program", async () => {
  const dir = tempDir();
  writeBackendPid(dir, 500);
  const killed = [];
  const result = await stopStaleBackend(dir, {
    expectedImage: "Halo BI Assistant.exe",
    ownPid: 1,
    isAlive: () => true,
    imageName: () => "chrome.exe",
    kill: (pid) => killed.push(pid),
    sleep: noSleep,
  });
  assert.deepEqual(killed, []);
  assert.deepEqual(result, { pid: 500, stopped: false });
  assert.equal(readBackendPid(dir), null, "the stale file is still cleared");
});

test("only clears the file when the recorded backend is already gone", async () => {
  const dir = tempDir();
  writeBackendPid(dir, 500);
  const killed = [];
  const result = await stopStaleBackend(dir, {
    ownPid: 1,
    isAlive: () => false,
    imageName: () => "Halo BI Assistant.exe",
    kill: (pid) => killed.push(pid),
  });
  assert.deepEqual(killed, []);
  assert.deepEqual(result, { pid: 500, stopped: false });
  assert.equal(readBackendPid(dir), null);
});

test("never kills its own process", async () => {
  const dir = tempDir();
  writeBackendPid(dir, 77);
  const killed = [];
  await stopStaleBackend(dir, {
    expectedImage: "Electron",
    ownPid: 77,
    isAlive: () => true,
    imageName: () => "Electron",
    kill: (pid) => killed.push(pid),
  });
  assert.deepEqual(killed, []);
});

test("reports not stopped when the process outlives the wait", async () => {
  const dir = tempDir();
  writeBackendPid(dir, 500);
  const result = await stopStaleBackend(dir, {
    expectedImage: "Electron",
    ownPid: 1,
    isAlive: () => true,
    imageName: () => "Electron",
    kill: () => {},
    sleep: noSleep,
    timeoutMs: 0,
  });
  assert.deepEqual(result, { pid: 500, stopped: false });
});

test("reads the image name from tasklist on Windows", () => {
  const run = (cmd, args) => {
    assert.equal(cmd, "tasklist");
    assert.deepEqual(args, ["/FI", "PID eq 1234", "/FO", "CSV", "/NH"]);
    return '"Halo BI Assistant.exe","1234","Console","1","180,512 K"\r\n';
  };
  assert.equal(processImageName(1234, "win32", run), "Halo BI Assistant.exe");
  const none = () => "INFO: No tasks are running which match the specified criteria.\r\n";
  assert.equal(processImageName(1234, "win32", none), null);
});

test("reads the image name from ps elsewhere", () => {
  const run = () => "/Applications/Halo BI Assistant.app/Contents/MacOS/Halo BI Assistant\n";
  assert.equal(processImageName(9, "darwin", run), "Halo BI Assistant");
  const fails = () => {
    throw new Error("exit 1");
  };
  assert.equal(processImageName(9, "darwin", fails), null);
});

test("matches image names case-insensitively and Linux-truncated", () => {
  assert.equal(imageMatches("halo bi assistant.exe", "Halo BI Assistant.exe"), true);
  assert.equal(imageMatches("halo-bi-assist", "halo-bi-assistant"), false);
  assert.equal(imageMatches("halo-bi-assista", "halo-bi-assistant"), true);
  assert.equal(imageMatches(null, "Electron"), false);
});
