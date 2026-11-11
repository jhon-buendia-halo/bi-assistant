// The Copilot model (BA-159, story 1.10.3, ADR-0037): an AI SDK
// LanguageModelV3 over the local GitHub Copilot runtime (llm-settings R55–R64,
// agents.md 1.3).
//
// Mastra keeps the tool loop. The step's tools are declared to Copilot without
// handlers, so a tool request ends the model step with finish reason
// `tool-calls` while the Copilot session stays open, keyed by tool-call id.
// When Mastra calls again with the tool results, they are answered through
// `session.rpc.tools.handlePendingToolCall` and the same session continues. A
// step without a live session renders the earlier messages into one prompt.
import { randomUUID } from 'node:crypto';
import type {
  LanguageModelV3,
  LanguageModelV3CallOptions,
  LanguageModelV3Content,
  LanguageModelV3FinishReason,
  LanguageModelV3Message,
  LanguageModelV3StreamPart,
  LanguageModelV3ToolResultOutput,
  LanguageModelV3ToolResultPart,
  LanguageModelV3Usage,
} from '@ai-sdk/provider';
import { ToolSet, type SessionConfig } from '@github/copilot-sdk';
import {
  COPILOT_AUTO_MODEL,
  COPILOT_EFFORT_LEVELS,
  COPILOT_PENDING_TOOL_TIMEOUT_MS,
  copilotRequestFailedMessage,
  copilotToolAsTextNudge,
  type CopilotModelOptions,
  type CopilotRuntimeApi,
} from './copilot-contracts';
import { getCopilotRuntime } from './copilot-runtime';

/** Parallel tool requests arrive as separate events; wait this long for more. */
const COLLECT_PARALLEL_MS = 150;
const DEFAULT_SYSTEM_PROMPT = 'You are a helpful assistant.';

/** The part of a Copilot session this model uses. */
interface SessionLike {
  on(handler: (event: CopilotEvent) => void): () => void;
  send(options: {
    prompt: string;
    responseSchema?: Record<string, unknown>;
  }): Promise<unknown>;
  abort(): Promise<void>;
  disconnect(): Promise<void>;
  rpc: {
    tools: {
      handlePendingToolCall(params: {
        requestId: string;
        result: string;
      }): Promise<unknown>;
    };
  };
}

interface CopilotEvent {
  type: string;
  agentId?: string;
  data?: Record<string, unknown>;
}

interface ToolRequest {
  requestId: string;
  toolCallId: string;
  toolName: string;
  arguments?: unknown;
}

interface StepUsage {
  input: number;
  output: number;
  seen: boolean;
  model?: string;
}

interface StepResult {
  kind: 'text' | 'tool-calls';
  calls: ToolRequest[];
  /** Streamed text, else the final assistant message. */
  text: string;
  usage: StepUsage;
}

interface StepSink {
  onDelta(delta: string): void;
}

interface PendingEntry {
  session: SessionLike;
  requestId: string;
}

/**
 * Sessions waiting for tool results, by tool-call id. Process-wide, because
 * the model factory may build a fresh model instance for the next step.
 */
const pending = new Map<string, PendingEntry>();
/** One timeout per waiting session (R63). */
const pendingTimers = new Map<SessionLike, NodeJS.Timeout>();

function dropSession(session: SessionLike): void {
  const timer = pendingTimers.get(session);
  if (timer) clearTimeout(timer);
  pendingTimers.delete(session);
  for (const [id, entry] of pending) {
    if (entry.session === session) pending.delete(id);
  }
}

function closeSession(session: SessionLike): void {
  dropSession(session);
  void session.disconnect().catch(() => undefined);
}

function keepWaiting(session: SessionLike, calls: ToolRequest[]): void {
  for (const call of calls) {
    pending.set(call.toolCallId, { session, requestId: call.requestId });
  }
  const old = pendingTimers.get(session);
  if (old) clearTimeout(old);
  const timer = setTimeout(
    () => closeSession(session),
    COPILOT_PENDING_TOOL_TIMEOUT_MS,
  );
  timer.unref?.();
  pendingTimers.set(session, timer);
}

function abortError(): Error {
  return new DOMException('This operation was aborted', 'AbortError');
}

const isAbortError = (err: unknown): boolean =>
  err instanceof Error && err.name === 'AbortError';

/** Marks errors that already carry their final user-facing text. */
class CopilotRequestError extends Error {}

function requestError(err: unknown): Error {
  if (err instanceof CopilotRequestError || isAbortError(err)) {
    return err as Error;
  }
  const detail = err instanceof Error ? err.message : String(err);
  return new CopilotRequestError(copilotRequestFailedMessage(detail));
}

function textOf(content: LanguageModelV3Message['content']): string {
  if (typeof content === 'string') return content;
  const parts: ReadonlyArray<{ type: string; text?: string }> = content;
  return parts.map((part) => (part.type === 'text' ? part.text : '')).join('');
}

function toolOutput(output: LanguageModelV3ToolResultOutput): string {
  switch (output.type) {
    case 'text':
    case 'error-text':
      return output.value;
    case 'json':
    case 'error-json':
      return JSON.stringify(output.value);
    case 'execution-denied':
      return `Denied: ${output.reason ?? ''}`;
    case 'content':
      return output.value
        .map((v) => (v.type === 'text' ? v.text : ''))
        .join('');
    default:
      return JSON.stringify(output);
  }
}

/** The argument shape of a tool the step offers (R66). */
interface ToolShape {
  name: string;
  required: string[];
  properties: string[];
}

/** The offered tools' argument shapes; none for a structured-output call. */
function toolShapes(call: LanguageModelV3CallOptions): ToolShape[] {
  if (call.responseFormat?.type === 'json') return [];
  return (call.tools ?? []).flatMap((tool) => {
    if (tool.type !== 'function') return [];
    const schema = (tool.inputSchema ?? {}) as {
      properties?: Record<string, unknown>;
      required?: unknown;
    };
    const properties = Object.keys(schema.properties ?? {});
    if (!properties.length) return [];
    const required = Array.isArray(schema.required)
      ? schema.required.filter((k): k is string => typeof k === 'string')
      : [];
    return [{ name: tool.name, required, properties }];
  });
}

/** Text that may still turn out to be a tool's arguments, so it is held. */
function mayBeToolArguments(text: string): boolean {
  const start = text.trimStart();
  return (
    start.startsWith('{') ||
    start.startsWith('```json') ||
    '```json'.startsWith(start)
  );
}

/**
 * R66: the tool whose arguments `text` is, when the whole message is a JSON
 * object (optionally in a json code fence) that fits exactly one offered tool:
 * every required argument present and no unknown key.
 */
function toolWrittenAsText(
  text: string,
  shapes: ToolShape[],
): string | undefined {
  if (!shapes.length) return undefined;
  let body = text.trim();
  const fence = /^```(?:json)?\s*([\s\S]*?)\s*```$/.exec(body);
  if (fence) body = fence[1];
  if (!body.startsWith('{') || !body.endsWith('}')) return undefined;
  let value: unknown;
  try {
    value = JSON.parse(body);
  } catch {
    return undefined;
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }
  const keys = Object.keys(value);
  if (!keys.length) return undefined;
  const fits = shapes.filter(
    (shape) =>
      shape.required.every((k) => keys.includes(k)) &&
      keys.every((k) => shape.properties.includes(k)),
  );
  return fits.length === 1 ? fits[0].name : undefined;
}

/**
 * Passes deltas through, except that text which may still be a tool's
 * arguments is held until it is clearly not (R66). `release` emits whatever
 * is still held.
 */
function holdBack(
  target: StepSink,
  enabled: boolean,
): { sink: StepSink; release: () => void } {
  let held = '';
  let passing = !enabled;
  return {
    sink: {
      onDelta(delta) {
        if (passing) return target.onDelta(delta);
        held += delta;
        if (!mayBeToolArguments(held)) {
          passing = true;
          target.onDelta(held);
          held = '';
        }
      },
    },
    release: () => {
      if (held) target.onDelta(held);
      held = '';
      passing = true;
    },
  };
}

function mergedUsage(first: StepUsage, second: StepUsage): StepUsage {
  return {
    input: first.input + second.input,
    output: first.output + second.output,
    seen: first.seen || second.seen,
    model: second.model ?? first.model,
  };
}

/** Renders a conversation the Copilot session has not seen as one prompt. */
function transcript(messages: LanguageModelV3Message[]): string {
  if (messages.length === 1 && messages[0].role === 'user') {
    return textOf(messages[0].content);
  }
  return messages
    .map((m) => {
      switch (m.role) {
        case 'user':
          return `User: ${textOf(m.content)}`;
        case 'assistant':
          return m.content
            .map((p) =>
              p.type === 'text'
                ? `Assistant: ${p.text}`
                : p.type === 'tool-call'
                  ? `Assistant called ${p.toolName}(${JSON.stringify(p.input)})`
                  : '',
            )
            .filter(Boolean)
            .join('\n');
        case 'tool':
          return m.content
            .filter((p) => p.type === 'tool-result')
            .map((p) => `Tool ${p.toolName} returned: ${toolOutput(p.output)}`)
            .join('\n');
        default:
          return '';
      }
    })
    .filter(Boolean)
    .join('\n\n');
}

function effortOf(options: LanguageModelV3CallOptions): string | undefined {
  const effort = options.providerOptions?.copilot?.reasoningEffort;
  return typeof effort === 'string' &&
    (COPILOT_EFFORT_LEVELS as readonly string[]).includes(effort)
    ? effort
    : undefined;
}

/**
 * Resolves on the step's next stop: the root agent's tool requests, or idle
 * with its final message. Rejects on a session error or an abort.
 */
function watchStep(
  session: SessionLike,
  sink: StepSink,
  signal: AbortSignal,
): Promise<StepResult> {
  let off: (() => void) | undefined;
  let timer: NodeJS.Timeout | undefined;
  let onAbort: (() => void) | undefined;
  const promise = new Promise<StepResult>((resolve, reject) => {
    const calls: ToolRequest[] = [];
    const usage: StepUsage = { input: 0, output: 0, seen: false };
    let streamed = '';
    let lastMessage = '';
    const done = (kind: StepResult['kind']) =>
      resolve({ kind, calls, text: streamed || lastMessage, usage });

    onAbort = () => reject(abortError());
    if (signal.aborted) return onAbort();
    signal.addEventListener('abort', onAbort, { once: true });

    off = session.on((event) => {
      if (event.agentId) return; // sub-agent traffic is not ours
      const data = event.data ?? {};
      switch (event.type) {
        case 'assistant.message_delta': {
          const delta = data.deltaContent;
          if (typeof delta === 'string' && delta) {
            streamed += delta;
            sink.onDelta(delta);
          }
          break;
        }
        case 'assistant.message':
          if (typeof data.content === 'string') lastMessage = data.content;
          break;
        case 'assistant.usage':
          usage.seen = true;
          usage.input += Number(data.inputTokens ?? 0);
          usage.output += Number(data.outputTokens ?? 0);
          if (typeof data.model === 'string') usage.model = data.model;
          break;
        case 'external_tool.requested':
          calls.push({
            requestId: String(data.requestId),
            toolCallId: String(data.toolCallId),
            toolName: String(data.toolName),
            arguments: data.arguments,
          });
          clearTimeout(timer);
          timer = setTimeout(() => done('tool-calls'), COLLECT_PARALLEL_MS);
          break;
        case 'session.idle':
          done(calls.length ? 'tool-calls' : 'text');
          break;
        case 'session.error': {
          const message =
            typeof data.message === 'string'
              ? data.message
              : JSON.stringify(data);
          reject(new CopilotRequestError(copilotRequestFailedMessage(message)));
          break;
        }
      }
    });
  });
  return promise.finally(() => {
    off?.();
    clearTimeout(timer);
    if (onAbort) signal.removeEventListener('abort', onAbort);
  });
}

function usageOf(usage: StepUsage): LanguageModelV3Usage {
  return {
    inputTokens: {
      total: usage.seen ? usage.input : undefined,
      noCache: undefined,
      cacheRead: undefined,
      cacheWrite: undefined,
    },
    outputTokens: {
      total: usage.seen ? usage.output : undefined,
      text: undefined,
      reasoning: undefined,
    },
  };
}

const finishReasonOf = (step: StepResult): LanguageModelV3FinishReason => ({
  unified: step.kind === 'tool-calls' ? 'tool-calls' : 'stop',
  raw: step.kind,
});

const toolCallsOf = (step: StepResult): LanguageModelV3Content[] =>
  step.calls.map((c) => ({
    type: 'tool-call',
    toolCallId: c.toolCallId,
    toolName: c.toolName,
    input: JSON.stringify(c.arguments ?? {}),
  }));

/** Links the caller's abort signal to one we can also fire (stream cancel). */
function linkedAbort(signal: AbortSignal | undefined): AbortController {
  const controller = new AbortController();
  if (signal?.aborted) controller.abort();
  else
    signal?.addEventListener('abort', () => controller.abort(), {
      once: true,
    });
  return controller;
}

export function createCopilotModel(
  options: CopilotModelOptions,
): LanguageModelV3 {
  const model = options.model;
  const runtime = (): CopilotRuntimeApi =>
    options.runtime ?? getCopilotRuntime();

  /** One model step on Copilot. */
  async function run(
    call: LanguageModelV3CallOptions,
    sink: StepSink,
    signal: AbortSignal,
  ): Promise<StepResult> {
    if (signal.aborted) throw abortError();
    const system = call.prompt
      .filter((m) => m.role === 'system')
      .map((m) => m.content)
      .join('\n\n');
    const rest = call.prompt.filter((m) => m.role !== 'system');
    const last = rest.at(-1);

    // Continuation: Mastra ran the tools this session asked for.
    const results: LanguageModelV3ToolResultPart[] =
      last?.role === 'tool'
        ? last.content.filter(
            (p): p is LanguageModelV3ToolResultPart => p.type === 'tool-result',
          )
        : [];
    if (results.length && results.every((r) => pending.has(r.toolCallId))) {
      const session = pending.get(results[0].toolCallId)!.session;
      const answers = results.map((r) => ({
        requestId: pending.get(r.toolCallId)!.requestId,
        result: toolOutput(r.output),
      }));
      for (const r of results) pending.delete(r.toolCallId);
      const timer = pendingTimers.get(session);
      if (timer) clearTimeout(timer);
      pendingTimers.delete(session);
      return drive(
        session,
        sink,
        signal,
        async () => {
          for (const answer of answers) {
            await session.rpc.tools.handlePendingToolCall(answer);
          }
        },
        toolShapes(call),
      );
    }

    // Fresh step: a new session with only the step's tools enabled.
    await runtime().ensureSignedIn(); // its errors pass through unchanged
    if (signal.aborted) throw abortError();
    let session: SessionLike;
    try {
      const client = await runtime().client();
      const effort = effortOf(call);
      const config: SessionConfig = {
        ...(model && model !== COPILOT_AUTO_MODEL ? { model } : {}),
        ...(effort ? { reasoningEffort: effort } : {}),
        tools: (call.tools ?? [])
          .filter((t) => t.type === 'function')
          .map((t) => ({
            name: t.name,
            description: t.description,
            parameters: t.inputSchema as Record<string, unknown>,
            skipPermission: true,
            overridesBuiltInTool: true,
          })),
        availableTools: new ToolSet().addCustom('*'),
        systemMessage: {
          mode: 'replace',
          content: system || DEFAULT_SYSTEM_PROMPT,
        },
        onPermissionRequest: () => ({ kind: 'denied-by-rules', rules: [] }),
        infiniteSessions: { enabled: false },
        enableSessionStore: false,
        streaming: true,
      };
      session = (await client.createSession(config)) as unknown as SessionLike;
    } catch (err) {
      throw requestError(err);
    }
    const format = call.responseFormat;
    const prompt = transcript(rest);
    return drive(
      session,
      sink,
      signal,
      () =>
        session.send({
          prompt,
          ...(format?.type === 'json' && format.schema
            ? { responseSchema: format.schema as Record<string, unknown> }
            : {}),
        }),
      toolShapes(call),
    );
  }

  /** Starts the turn, waits for its stop and settles the session. */
  async function drive(
    session: SessionLike,
    sink: StepSink,
    signal: AbortSignal,
    begin: () => Promise<unknown>,
    shapes: ToolShape[],
  ): Promise<StepResult> {
    let aborted = false;
    const onAbort = () => {
      if (aborted) return;
      aborted = true;
      void session.abort().catch(() => undefined);
      closeSession(session);
    };
    if (signal.aborted) {
      onAbort();
      throw abortError();
    }
    signal.addEventListener('abort', onAbort, { once: true });
    try {
      const watch = async (
        start: () => Promise<unknown>,
      ): Promise<{ step: StepResult; release: () => void }> => {
        const hold = holdBack(sink, shapes.length > 0);
        const stop = watchStep(session, hold.sink, signal);
        stop.catch(() => undefined); // observed below, after start()
        await start();
        return { step: await stop, release: hold.release };
      };
      let { step, release } = await watch(begin);
      const writtenTool =
        step.kind === 'text' ? toolWrittenAsText(step.text, shapes) : undefined;
      if (writtenTool) {
        // R66: the arguments are never shown; ask once for the real call.
        const first = step.usage;
        ({ step, release } = await watch(() =>
          session.send({ prompt: copilotToolAsTextNudge(writtenTool) }),
        ));
        step = { ...step, usage: mergedUsage(first, step.usage) };
      }
      release();
      if (step.kind === 'tool-calls') keepWaiting(session, step.calls);
      else closeSession(session);
      return step;
    } catch (err) {
      if (signal.aborted) {
        onAbort();
        throw abortError();
      }
      closeSession(session);
      throw requestError(err);
    } finally {
      signal.removeEventListener('abort', onAbort);
    }
  }

  const metadata = (step?: StepResult) => ({
    id: randomUUID(),
    modelId: step?.usage.model ?? model,
    timestamp: new Date(),
  });

  return {
    specificationVersion: 'v3',
    provider: 'copilot',
    modelId: model,
    supportedUrls: {},

    async doGenerate(call) {
      const controller = linkedAbort(call.abortSignal);
      const step = await run(
        call,
        { onDelta: () => undefined },
        controller.signal,
      );
      const content: LanguageModelV3Content[] = [];
      if (step.text || step.kind === 'text') {
        content.push({ type: 'text', text: step.text });
      }
      content.push(...toolCallsOf(step));
      return {
        content,
        finishReason: finishReasonOf(step),
        usage: usageOf(step.usage),
        warnings: [],
        response: metadata(step),
      };
    },

    doStream(call) {
      const controller = linkedAbort(call.abortSignal);
      const stream = new ReadableStream<LanguageModelV3StreamPart>({
        start(out) {
          const enqueue = (part: LanguageModelV3StreamPart) => {
            try {
              out.enqueue(part);
            } catch {
              // the reader went away
            }
          };
          enqueue({ type: 'stream-start', warnings: [] });
          enqueue({ type: 'response-metadata', ...metadata() });
          let textId: string | undefined;
          const sink: StepSink = {
            onDelta(delta) {
              if (!textId) {
                textId = randomUUID();
                enqueue({ type: 'text-start', id: textId });
              }
              enqueue({ type: 'text-delta', id: textId, delta });
            },
          };
          run(call, sink, controller.signal).then(
            (step) => {
              if (!textId && step.text) sink.onDelta(step.text);
              if (textId) enqueue({ type: 'text-end', id: textId });
              for (const part of toolCallsOf(step)) {
                enqueue(part as LanguageModelV3StreamPart);
              }
              enqueue({
                type: 'finish',
                usage: usageOf(step.usage),
                finishReason: finishReasonOf(step),
              });
              try {
                out.close();
              } catch {
                // already cancelled
              }
            },
            (err: unknown) => {
              try {
                out.error(err);
              } catch {
                // already cancelled
              }
            },
          );
        },
        cancel() {
          controller.abort();
        },
      });
      return Promise.resolve({ stream });
    },
  };
}
