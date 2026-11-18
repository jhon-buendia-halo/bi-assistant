#!/usr/bin/env node
// Metering proxy in front of an Anthropic-style LLM endpoint.
// node scripts/llm-meter-proxy.mjs --port <p> --upstream http://127.0.0.1:8317 --log <file.jsonl>
// Forwards every request unchanged, streams the reply back unchanged, and appends one JSON line
// per POST .../messages with the token usage, the caller label and the request shape.
import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import zlib from 'node:zlib';

export const LABEL_PREFIXES = [
  ['You plan a data analysis for Questions to Insights.', 'plan'],
  ['You write the final answer for Questions to Insights.', 'write-answer'],
  ['You are Questions to Insights', 'analyse'],
];

/** The system prompt as one string (a string, or an array of text blocks). */
export function systemText(system) {
  if (typeof system === 'string') return system;
  if (Array.isArray(system)) {
    return system
      .map((b) => (typeof b === 'string' ? b : b && typeof b.text === 'string' ? b.text : ''))
      .join('\n');
  }
  return '';
}

/** Classify the caller by the start of its system prompt. */
export function classifyLabel(system) {
  const text = systemText(system).trimStart();
  for (const [prefix, label] of LABEL_PREFIXES) {
    if (text.startsWith(prefix)) return label;
  }
  return 'other';
}

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** Normalise an Anthropic `usage` object; absent fields are null. */
export function normalizeUsage(usage) {
  const u = usage && typeof usage === 'object' ? usage : {};
  return {
    inputTokens: num(u.input_tokens),
    outputTokens: num(u.output_tokens),
    cacheReadTokens: num(u.cache_read_input_tokens),
    cacheCreationTokens: num(u.cache_creation_input_tokens),
  };
}

/** Merge usages: for every field take the last non-null value (Anthropic's counts only grow). */
export function mergeUsage(a, b) {
  const out = { ...a };
  for (const k of Object.keys(b)) {
    if (b[k] !== null && b[k] !== undefined) out[k] = a[k] === null || a[k] === undefined ? b[k] : Math.max(a[k], b[k]);
  }
  return out;
}

const EMPTY_USAGE = { inputTokens: null, outputTokens: null, cacheReadTokens: null, cacheCreationTokens: null };

/** Usage, tool_use count and stop reason from a non-streaming JSON reply. */
export function parseJsonReply(body) {
  let obj;
  try {
    obj = typeof body === 'string' ? JSON.parse(body) : body;
  } catch {
    return { usage: { ...EMPTY_USAGE }, toolUses: 0, stopReason: null };
  }
  if (!obj || typeof obj !== 'object') return { usage: { ...EMPTY_USAGE }, toolUses: 0, stopReason: null };
  const content = Array.isArray(obj.content) ? obj.content : [];
  return {
    usage: normalizeUsage(obj.usage),
    toolUses: content.filter((b) => b && b.type === 'tool_use').length,
    stopReason: typeof obj.stop_reason === 'string' ? obj.stop_reason : null,
  };
}

/** Usage, tool_use count and stop reason from an SSE reply text. */
export function parseSseReply(text) {
  let usage = { ...EMPTY_USAGE };
  let toolUses = 0;
  let stopReason = null;
  for (const rawLine of String(text).split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line.startsWith('data:')) continue;
    const payload = line.slice(5).trim();
    if (!payload || payload === '[DONE]') continue;
    let ev;
    try {
      ev = JSON.parse(payload);
    } catch {
      continue;
    }
    if (!ev || typeof ev !== 'object') continue;
    if (ev.type === 'message_start' && ev.message) {
      usage = mergeUsage(usage, normalizeUsage(ev.message.usage));
    } else if (ev.type === 'message_delta') {
      usage = mergeUsage(usage, normalizeUsage(ev.usage));
      if (ev.delta && typeof ev.delta.stop_reason === 'string') stopReason = ev.delta.stop_reason;
    } else if (ev.type === 'content_block_start' && ev.content_block && ev.content_block.type === 'tool_use') {
      toolUses += 1;
    }
  }
  return { usage, toolUses, stopReason };
}

/** The log record for one request/reply pair. */
export function buildRecord({ ts, durationMs, status, path: reqPath, requestBody, requestChars, reply }) {
  const req = requestBody && typeof requestBody === 'object' ? requestBody : {};
  const u = reply.usage;
  const input = u.inputTokens ?? 0;
  const read = u.cacheReadTokens ?? 0;
  const created = u.cacheCreationTokens ?? 0;
  return {
    ts,
    durationMs,
    status,
    path: reqPath,
    model: typeof req.model === 'string' ? req.model : null,
    stream: req.stream === true,
    label: classifyLabel(req.system),
    systemStart: systemText(req.system).slice(0, 80),
    requestChars,
    messageCount: Array.isArray(req.messages) ? req.messages.length : 0,
    toolCount: Array.isArray(req.tools) ? req.tools.length : 0,
    inputTokens: u.inputTokens,
    outputTokens: u.outputTokens,
    cacheReadTokens: u.cacheReadTokens,
    cacheCreationTokens: u.cacheCreationTokens,
    totalInputTokens: input + read + created,
    toolUses: reply.toolUses,
    stopReason: reply.stopReason,
  };
}

export function isMessagesCall(method, url) {
  const p = String(url).split('?')[0];
  return method === 'POST' && p.endsWith('/messages');
}

function decode(buffer, encoding) {
  try {
    if (encoding === 'gzip') return zlib.gunzipSync(buffer);
    if (encoding === 'br') return zlib.brotliDecompressSync(buffer);
    if (encoding === 'deflate') return zlib.inflateSync(buffer);
  } catch {
    return buffer;
  }
  return buffer;
}

export function parseReply(buffer, headers) {
  const text = decode(buffer, String(headers['content-encoding'] || '').toLowerCase()).toString('utf8');
  const type = String(headers['content-type'] || '');
  if (type.includes('text/event-stream') || /^\s*(event|data):/.test(text)) return parseSseReply(text);
  return parseJsonReply(text);
}

export function createProxy({ upstream, logFile }) {
  const target = new URL(upstream);
  const client = target.protocol === 'https:' ? https : http;
  const basePath = target.pathname.replace(/\/$/, '');
  if (logFile) fs.mkdirSync(path.dirname(path.resolve(logFile)), { recursive: true });

  return http.createServer((req, res) => {
    const started = Date.now();
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('error', () => res.destroy());
    req.on('end', () => {
      const body = Buffer.concat(chunks);
      const metered = isMessagesCall(req.method, req.url);
      const headers = { ...req.headers, host: target.host };
      // Exactly one record per metered call: complete, aborted by the client
      // (a deadline or a stop) or cut by the upstream, with the usage read so far.
      let logged = false;
      let upstreamDone = false;
      const replyChunks = [];
      let replyHeaders = {};
      let replyStatus = 0;
      const logCall = (outcome) => {
        if (logged || !metered || !logFile) return;
        logged = true;
        try {
          let requestBody = null;
          try {
            requestBody = JSON.parse(decode(body, String(req.headers['content-encoding'] || '').toLowerCase()).toString('utf8'));
          } catch {
            /* not JSON */
          }
          let reply = {};
          try {
            reply = parseReply(Buffer.concat(replyChunks), replyHeaders);
          } catch {
            /* an undecodable reply logs no usage */
          }
          const record = buildRecord({
            ts: new Date(started).toISOString(),
            durationMs: Date.now() - started,
            status: replyStatus,
            path: req.url,
            requestBody,
            requestChars: body.length,
            reply,
          });
          if (outcome !== 'complete') record.outcome = outcome;
          fs.appendFileSync(logFile, JSON.stringify(record) + '\n');
        } catch (e) {
          console.error('meter: could not log a call:', e instanceof Error ? e.message : e);
        }
      };
      // The client went away before the reply ended: stop the upstream call
      // too, so it holds no slot and its tokens are not counted as complete.
      res.on('close', () => {
        if (upstreamDone) return;
        upReq.destroy();
        logCall('aborted');
      });
      const upReq = client.request(
        {
          protocol: target.protocol,
          hostname: target.hostname,
          port: target.port || undefined,
          method: req.method,
          path: basePath + req.url,
          headers,
        },
        (upRes) => {
          replyStatus = upRes.statusCode;
          replyHeaders = upRes.headers;
          res.writeHead(upRes.statusCode || 502, upRes.headers);
          upRes.on('data', (c) => {
            if (metered) replyChunks.push(c);
            res.write(c);
          });
          upRes.on('end', () => {
            upstreamDone = true;
            logCall('complete');
            res.end();
          });
          const cut = () => {
            if (upstreamDone) return;
            upstreamDone = true;
            logCall('upstream-error');
            res.destroy();
          };
          upRes.on('error', cut);
          upRes.on('aborted', cut);
        },
      );
      upReq.on('error', (e) => {
        if (upstreamDone || logged) return;
        upstreamDone = true;
        if (!res.headersSent) res.writeHead(502, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: `meter proxy: upstream error: ${e.message}` }));
      });
      upReq.end(body);
    });
  });
}

export function parseCliArgs(argv) {
  const out = { port: 0, upstream: 'http://127.0.0.1:8317', log: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--port') out.port = Number(argv[++i]);
    else if (a === '--upstream') out.upstream = argv[++i];
    else if (a === '--log') out.log = argv[++i];
  }
  return out;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = parseCliArgs(process.argv.slice(2));
  if (!args.port || !args.log) {
    console.error('usage: node scripts/llm-meter-proxy.mjs --port <p> --upstream http://127.0.0.1:8317 --log <file.jsonl>');
    process.exit(2);
  }
  const server = createProxy({ upstream: args.upstream, logFile: args.log });
  server.listen(args.port, '127.0.0.1', () => {
    console.log(`meter listening on ${args.port} -> ${args.upstream}`);
  });
}
