// node --test scripts/llm-meter-proxy.test.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import {
  buildRecord,
  classifyLabel,
  createProxy,
  isMessagesCall,
  parseJsonReply,
  parseSseReply,
  systemText,
} from './llm-meter-proxy.mjs';

const JSON_REPLY = {
  id: 'msg_1',
  type: 'message',
  role: 'assistant',
  model: 'claude-sonnet-5-5',
  content: [
    { type: 'text', text: 'hi' },
    { type: 'tool_use', id: 't1', name: 'run_readonly_sql', input: {} },
    { type: 'tool_use', id: 't2', name: 'list_run_context', input: {} },
  ],
  stop_reason: 'tool_use',
  usage: { input_tokens: 12, output_tokens: 34, cache_read_input_tokens: 100, cache_creation_input_tokens: 5 },
};

const SSE_REPLY =
  'event: message_start\n' +
  'data: {"type":"message_start","message":{"id":"m","usage":{"input_tokens":20,"output_tokens":1,"cache_read_input_tokens":7,"cache_creation_input_tokens":0}}}\n\n' +
  'event: content_block_start\n' +
  'data: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}\n\n' +
  'event: content_block_start\n' +
  'data: {"type":"content_block_start","index":1,"content_block":{"type":"tool_use","id":"t","name":"x","input":{}}}\n\n' +
  'event: message_delta\n' +
  'data: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":55}}\n\n' +
  'event: message_stop\n' +
  'data: {"type":"message_stop"}\n\n';

test('classifyLabel by system prompt start, string or blocks', () => {
  assert.equal(classifyLabel('You plan a data analysis for Questions to Insights. Be brief.'), 'plan');
  assert.equal(classifyLabel('You write the final answer for Questions to Insights. Cite.'), 'write-answer');
  assert.equal(classifyLabel('You are Questions to Insights, an analyst.'), 'analyse');
  assert.equal(classifyLabel([{ type: 'text', text: 'You are Questions to Insights' }]), 'analyse');
  assert.equal(classifyLabel('You are a judge.'), 'other');
  assert.equal(classifyLabel(undefined), 'other');
});

test('systemText joins blocks', () => {
  assert.equal(systemText([{ type: 'text', text: 'a' }, { type: 'text', text: 'b' }]), 'a\nb');
  assert.equal(systemText(null), '');
});

test('parseJsonReply reads usage, tool_use and stop reason', () => {
  const r = parseJsonReply(JSON.stringify(JSON_REPLY));
  assert.deepEqual(r.usage, { inputTokens: 12, outputTokens: 34, cacheReadTokens: 100, cacheCreationTokens: 5 });
  assert.equal(r.toolUses, 2);
  assert.equal(r.stopReason, 'tool_use');
  assert.equal(parseJsonReply('not json').toolUses, 0);
});

test('parseSseReply merges message_start and message_delta', () => {
  const r = parseSseReply(SSE_REPLY);
  assert.deepEqual(r.usage, { inputTokens: 20, outputTokens: 55, cacheReadTokens: 7, cacheCreationTokens: 0 });
  assert.equal(r.toolUses, 1);
  assert.equal(r.stopReason, 'end_turn');
});

test('parseSseReply takes input fields that appear in message_delta', () => {
  const sse =
    'data: {"type":"message_start","message":{"usage":{"input_tokens":3,"output_tokens":1}}}\n\n' +
    'data: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"input_tokens":9,"output_tokens":4,"cache_read_input_tokens":2}}\n\n';
  const r = parseSseReply(sse);
  assert.equal(r.usage.inputTokens, 9);
  assert.equal(r.usage.outputTokens, 4);
  assert.equal(r.usage.cacheReadTokens, 2);
  assert.equal(r.usage.cacheCreationTokens, null);
});

test('buildRecord computes the shape and totals', () => {
  const rec = buildRecord({
    ts: 't',
    durationMs: 5,
    status: 200,
    path: '/v1/messages',
    requestBody: { model: 'm', stream: true, system: 'You plan a data analysis for Questions to Insights.', messages: [1, 2], tools: [1] },
    requestChars: 99,
    reply: parseJsonReply(JSON_REPLY),
  });
  assert.equal(rec.label, 'plan');
  assert.equal(rec.stream, true);
  assert.equal(rec.messageCount, 2);
  assert.equal(rec.toolCount, 1);
  assert.equal(rec.totalInputTokens, 117);
  assert.equal(rec.requestChars, 99);
  assert.equal(rec.systemStart.length <= 80, true);
});

test('isMessagesCall', () => {
  assert.equal(isMessagesCall('POST', '/v1/messages'), true);
  assert.equal(isMessagesCall('POST', '/v1/messages?beta=true'), true);
  assert.equal(isMessagesCall('GET', '/v1/messages'), false);
  assert.equal(isMessagesCall('POST', '/v1/models'), false);
});

function listen(server) {
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));
}

function request(port, pathname, body, method = 'POST') {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: pathname, method, headers: { 'content-type': 'application/json', 'x-api-key': 'k1' } }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
    req.end(body);
  });
}

test('end to end: forwards unchanged and logs stream and non-stream calls', async () => {
  const seen = [];
  const upstream = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      seen.push({ method: req.method, url: req.url, key: req.headers['x-api-key'], raw });
      if (req.url === '/v1/models') {
        res.writeHead(200, { 'content-type': 'application/json' });
        return res.end('{"data":[]}');
      }
      if (JSON.parse(raw).stream) {
        res.writeHead(200, { 'content-type': 'text/event-stream' });
        const parts = SSE_REPLY.split('\n\n').filter(Boolean);
        let i = 0;
        const tick = () => {
          if (i >= parts.length) return res.end();
          res.write(parts[i++] + '\n\n');
          setTimeout(tick, 5);
        };
        return tick();
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(JSON_REPLY));
    });
  });
  const upPort = await listen(upstream);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'meter-test-'));
  const logFile = path.join(dir, 'meter.jsonl');
  const proxy = createProxy({ upstream: `http://127.0.0.1:${upPort}`, logFile });
  const proxyPort = await listen(proxy);
  try {
    const nonStream = JSON.stringify({ model: 'claude-sonnet-5-5', system: [{ type: 'text', text: 'You are Questions to Insights, analyst' }], messages: [{ role: 'user', content: 'q' }], tools: [{ name: 'a' }, { name: 'b' }] });
    const r1 = await request(proxyPort, '/v1/messages', nonStream);
    assert.equal(r1.status, 200);
    assert.deepEqual(JSON.parse(r1.body), JSON_REPLY);

    const stream = JSON.stringify({ model: 'claude-sonnet-5-5', stream: true, system: 'You are a judge', messages: [] });
    const r2 = await request(proxyPort, '/v1/messages', stream);
    assert.equal(r2.body, SSE_REPLY);

    const r3 = await request(proxyPort, '/v1/models', undefined, 'GET');
    assert.equal(r3.body, '{"data":[]}');

    assert.equal(seen[0].raw, nonStream);
    assert.equal(seen[0].key, 'k1');
    assert.equal(seen.length, 3);

    await new Promise((r) => setTimeout(r, 50));
    const lines = fs.readFileSync(logFile, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    assert.equal(lines.length, 2);
    assert.equal(lines[0].label, 'analyse');
    assert.equal(lines[0].stream, false);
    assert.equal(lines[0].toolCount, 2);
    assert.equal(lines[0].totalInputTokens, 117);
    assert.equal(lines[0].toolUses, 2);
    assert.equal(lines[0].requestChars, nonStream.length);
    assert.equal(lines[1].label, 'other');
    assert.equal(lines[1].stream, true);
    assert.equal(lines[1].outputTokens, 55);
    assert.equal(lines[1].totalInputTokens, 27);
    assert.equal(lines[1].stopReason, 'end_turn');
  } finally {
    await new Promise((r) => proxy.close(r));
    await new Promise((r) => upstream.close(r));
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a client that aborts stops the upstream call and logs it as aborted', async () => {
  let upstreamClosed = false;
  const upstream = http.createServer((req, res) => {
    req.resume();
    req.on('end', () => {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      // The first event only; the reply never ends on its own.
      res.write(SSE_REPLY.split('\n\n')[0] + '\n\n');
      res.on('close', () => {
        upstreamClosed = true;
      });
    });
  });
  const upPort = await listen(upstream);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'meter-abort-'));
  const logFile = path.join(dir, 'meter.jsonl');
  const proxy = createProxy({ upstream: `http://127.0.0.1:${upPort}`, logFile });
  const proxyPort = await listen(proxy);
  try {
    await new Promise((resolve) => {
      const req = http.request({ port: proxyPort, path: '/v1/messages', method: 'POST', headers: { 'content-type': 'application/json' } }, (res) => {
        res.once('data', () => {
          req.destroy();
          resolve();
        });
      });
      req.on('error', () => {});
      req.end(JSON.stringify({ model: 'm', stream: true, system: 'You plan a data analysis for Questions to Insights.', messages: [] }));
    });
    await new Promise((r) => setTimeout(r, 100));
    assert.equal(upstreamClosed, true);
    const lines = fs.readFileSync(logFile, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    assert.equal(lines.length, 1);
    assert.equal(lines[0].outcome, 'aborted');
    assert.equal(lines[0].label, 'plan');
  } finally {
    await new Promise((r) => proxy.close(r));
    upstream.closeAllConnections?.();
    await new Promise((r) => upstream.close(r));
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
