// node --test frontend/electron/log-lines.test.cjs
const test = require("node:test");
const assert = require("node:assert/strict");
const { createLineGrouper, levelFromLine } = require("./log-lines.cjs");

function collect(fallbackLevel, lines) {
  const entries = [];
  const grouper = createLineGrouper({
    fallbackLevel,
    onEntry: (entry) => entries.push(entry),
  });
  for (const line of lines) grouper.push(line);
  grouper.end();
  return entries;
}

test("a Nest error with a Node stack is one entry", () => {
  const entries = collect("error", [
    "[Nest] 100  - 11/13/2026, 12:22:11 PM   ERROR [ExceptionsHandler] boom",
    "Error: boom",
    "    at Object.<anonymous> (/app/x.js:1:1)",
    "    at Module._compile (node:internal/modules/cjs/loader:1:1)",
  ]);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].level, "error");
  assert.match(entries[0].message, /^\[Nest\] 100 {2}- .*boom$/);
  assert.equal(
    entries[0].details,
    [
      "Error: boom",
      "    at Object.<anonymous> (/app/x.js:1:1)",
      "    at Module._compile (node:internal/modules/cjs/loader:1:1)",
    ].join("\n"),
  );
});

test("the EADDRINUSE crash block is one entry", () => {
  const entries = collect("error", [
    "[Nest] 20376  - 11/13/2026, 12:22:11 PM   ERROR [NestApplication] Error: listen EADDRINUSE: address already in use :::3000 +2ms",
    "node:net:1940",
    "    const ex = new UVExceptionWithHostPort(err, 'listen', address, port);",
    "               ^",
    "Error: listen EADDRINUSE: address already in use :::3000",
    "    at Server.setupListenHandle [as _listen2] (node:net:1940:16)",
    "    at async bootstrap (C:\\app\\backend\\dist\\main.js:8:5) {",
    "  code: 'EADDRINUSE',",
    "  port: 3000",
    "}",
    "Node.js v24.20.0",
  ]);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].level, "error");
  assert.match(entries[0].message, /EADDRINUSE/);
  const details = entries[0].details.split("\n");
  assert.equal(details.length, 10);
  assert.equal(details[0], "node:net:1940");
  assert.equal(details.at(-1), "Node.js v24.20.0");
});

test("a Mastra JSON line is its own entry and splits surrounding groups", () => {
  const entries = collect("info", [
    "[Nest] 1  - 11/13/2026   LOG [A] first",
    '{"level":"error","message":"Agent failed","runId":"r1"}',
    "    at stray frame",
  ]);
  assert.equal(entries.length, 3);
  assert.equal(entries[0].kind, "text");
  assert.equal(entries[1].kind, "json");
  assert.equal(entries[1].parsed.message, "Agent failed");
  assert.equal(entries[2].message, "at stray frame");
});

test("a lone { or } is a continuation, not JSON", () => {
  const entries = collect("error", [
    "[Nest] 1  - x   ERROR [A] thing {",
    "{",
    "  a: 1",
    "}",
  ]);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].details, "{\n  a: 1\n}");
});

test("a (node:) warning keeps its (Use ...) follow-up and is a warn", () => {
  const entries = collect("error", [
    "(node:4321) [DEP0040] DeprecationWarning: The `punycode` module is deprecated.",
    "(Use `node --trace-deprecation ...` to show where the warning was created)",
  ]);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].level, "warn");
  assert.match(entries[0].details, /^\(Use `node --trace-deprecation/);
});

test("two Nest lines stay two entries", () => {
  const entries = collect("info", [
    "[Nest] 1  - 11/13/2026   LOG [A] one",
    "[Nest] 1  - 11/13/2026   LOG [B] two",
  ]);
  assert.equal(entries.length, 2);
  assert.equal(entries[0].details, undefined);
  assert.equal(entries[1].details, undefined);
  assert.equal(entries[0].level, "info");
});

test("a quiet gap flushes the group so the next line starts a new entry", () => {
  const entries = [];
  let scheduled = null;
  const grouper = createLineGrouper({
    fallbackLevel: "error",
    onEntry: (entry) => entries.push(entry),
    setTimer: (fn) => {
      scheduled = fn;
      return 1;
    },
    clearTimer: () => {
      scheduled = null;
    },
  });
  grouper.push("plain failure one");
  scheduled();
  grouper.push("plain failure two");
  grouper.end();
  assert.deepEqual(
    entries.map((e) => e.message),
    ["plain failure one", "plain failure two"],
  );
});

test("a Mastra pretty-printed error starts its own entry and keeps its stack", () => {
  const entries = collect("info", [
    "[Nest] 5424  - 11/15/2026, 8:29:11 PM     LOG [SessionsService] run started",
    "ERROR [2026-11-15 20:29:11.573 -0500] (Mastra): Error executing step workflow.data-readiness-assessment.step.profile-source: BadRequestException: None of the entities to assess exist",
    "    at async Object.profile (C:\\app\\dist\\main.js:892718:22)",
    "    at async executeStep (C:\\app\\dist\\main.js:556724:31)",
  ]);
  assert.equal(entries.length, 2);
  assert.equal(entries[1].level, "error");
  assert.match(entries[1].message, /\(Mastra\): Error executing step/);
  assert.equal(entries[1].details.split("\n").length, 2);
});

test("levelFromLine reads the level word", () => {
  assert.equal(levelFromLine("x ERROR y", "info"), "error");
  assert.equal(levelFromLine("x WARN y", "info"), "warn");
  assert.equal(levelFromLine("x DEBUG y", "error"), "debug");
  assert.equal(levelFromLine("x LOG y", "info"), "info");
});
