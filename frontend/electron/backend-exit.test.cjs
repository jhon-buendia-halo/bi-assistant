// node --test frontend/electron/backend-exit.test.cjs
const test = require("node:test");
const assert = require("node:assert/strict");
const {
  PORT_IN_USE_EXIT_CODE,
  classifyBackendExit,
  portInUseMessage,
} = require("./backend-exit.cjs");

test("exit code 98 is a taken port and is not restarted", () => {
  assert.equal(PORT_IN_USE_EXIT_CODE, 98);
  assert.equal(classifyBackendExit(98), "port-in-use");
});

test("every other exit code stays on the restart path", () => {
  for (const code of [0, 1, 2, 137, null, undefined]) {
    assert.equal(classifyBackendExit(code), "restart");
  }
});

test("the message names the port and the other program", () => {
  const message = portInUseMessage("3000");
  assert.match(message, /Port 3000 is already in use/);
  assert.match(message, /another program/);
});
