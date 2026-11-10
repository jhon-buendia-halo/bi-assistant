import type {
  LanguageModelV3CallOptions,
  LanguageModelV3Prompt,
  LanguageModelV3StreamPart,
} from '@ai-sdk/provider';
import type { CopilotClient } from '@github/copilot-sdk';
import {
  COPILOT_NOT_SIGNED_IN,
  COPILOT_PENDING_TOOL_TIMEOUT_MS,
  copilotRequestFailedMessage,
  copilotToolAsTextNudge,
  type CopilotRuntimeApi,
} from './copilot-contracts';
import { createCopilotModel } from './copilot-model';

type Handler = (event: {
  type: string;
  agentId?: string;
  data?: Record<string, unknown>;
}) => void;

interface SendOptions {
  prompt: string;
  responseSchema?: Record<string, unknown>;
}

class FakeSession {
  private handlers = new Set<Handler>();
  readonly sent: SendOptions[] = [];
  readonly abort = jest.fn(() => Promise.resolve());
  readonly disconnect = jest.fn(() => Promise.resolve());
  onSend: (opts: SendOptions) => void = () => {};
  onAnswer: (p: { requestId: string; result: string }) => void = () => {};
  readonly rpc = {
    tools: {
      handlePendingToolCall: jest.fn(
        (p: { requestId: string; result: string }) => {
          this.onAnswer(p);
          return Promise.resolve({ success: true });
        },
      ),
    },
  };

  constructor(readonly config: Record<string, unknown>) {}

  on(handler: Handler): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  emit(type: string, data: Record<string, unknown> = {}, agentId?: string) {
    for (const h of [...this.handlers]) h({ type, data, agentId });
  }

  send(opts: SendOptions): Promise<string> {
    this.sent.push(opts);
    this.onSend(opts);
    return Promise.resolve('msg-1');
  }

  /** Streams a text answer and goes idle. */
  reply(...deltas: string[]) {
    for (const d of deltas) {
      this.emit('assistant.message_delta', { deltaContent: d });
    }
    this.emit('assistant.message', { content: deltas.join('') });
    this.emit('assistant.usage', {
      inputTokens: 10,
      outputTokens: 4,
      model: 'gpt-5',
    });
    this.emit('session.idle');
  }

  requestTool(id: string, name: string, args: unknown) {
    this.emit('external_tool.requested', {
      requestId: `req-${id}`,
      toolCallId: id,
      toolName: name,
      arguments: args,
    });
  }
}

function setup(
  script: (s: FakeSession) => void = (s) =>
    (s.onSend = () => s.reply('Hello', ' world')),
) {
  const sessions: FakeSession[] = [];
  const client = {
    createSession: jest.fn((config: Record<string, unknown>) => {
      const s = new FakeSession(config);
      script(s);
      sessions.push(s);
      return Promise.resolve(s);
    }),
  };
  const runtime: jest.Mocked<CopilotRuntimeApi> = {
    status: jest.fn(),
    ensureSignedIn: jest.fn(() => Promise.resolve()),
    listModels: jest.fn(),
    client: jest.fn(() => Promise.resolve(client as unknown as CopilotClient)),
    stop: jest.fn(),
  };
  return { sessions, client, runtime };
}

const user = (text: string): LanguageModelV3Prompt[number] => ({
  role: 'user',
  content: [{ type: 'text', text }],
});

const call = (
  prompt: LanguageModelV3Prompt,
  extra: Partial<LanguageModelV3CallOptions> = {},
): LanguageModelV3CallOptions => ({ prompt, ...extra });

async function collect(
  stream: ReadableStream<LanguageModelV3StreamPart>,
): Promise<LanguageModelV3StreamPart[]> {
  const parts: LanguageModelV3StreamPart[] = [];
  const reader = stream.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return parts;
    parts.push(value);
  }
}

const toolDef = {
  type: 'function' as const,
  name: 'run_sql',
  description: 'Runs SQL',
  inputSchema: {
    type: 'object' as const,
    properties: { sql: { type: 'string' as const } },
  },
};

let idCounter = 0;
const nextId = () => `call-${++idCounter}`;

describe('createCopilotModel', () => {
  afterEach(() => jest.useRealTimers());

  it('describes itself as a v3 copilot model', () => {
    const model = createCopilotModel({
      model: 'auto',
      runtime: setup().runtime,
    });
    expect(model).toMatchObject({
      specificationVersion: 'v3',
      provider: 'copilot',
      modelId: 'auto',
      supportedUrls: {},
    });
  });

  it('streams text deltas of a fresh step and finishes with stop', async () => {
    const { runtime, sessions } = setup();
    const model = createCopilotModel({ model: 'auto', runtime });
    const { stream } = await model.doStream(call([user('hi')]));
    const parts = await collect(stream);
    expect(parts.map((p) => p.type)).toEqual([
      'stream-start',
      'response-metadata',
      'text-start',
      'text-delta',
      'text-delta',
      'text-end',
      'finish',
    ]);
    expect(
      parts.filter((p) => p.type === 'text-delta').map((p) => p.delta),
    ).toEqual(['Hello', ' world']);
    const finish = parts.at(-1) as Extract<
      LanguageModelV3StreamPart,
      { type: 'finish' }
    >;
    expect(finish.finishReason).toEqual({ unified: 'stop', raw: 'text' });
    expect(finish.usage.inputTokens.total).toBe(10);
    expect(finish.usage.outputTokens.total).toBe(4);
    expect(runtime.ensureSignedIn.mock.calls.length).toBeGreaterThan(0);
    expect(sessions[0].sent[0].prompt).toBe('hi');
    expect(sessions[0].disconnect).toHaveBeenCalled();
  });

  it('returns the stream before the step ends (real streaming)', async () => {
    let session!: FakeSession;
    const { runtime } = setup((s) => {
      session = s;
      s.onSend = () =>
        s.emit('assistant.message_delta', { deltaContent: 'Hel' });
    });
    const model = createCopilotModel({ model: 'auto', runtime });
    const { stream } = await model.doStream(call([user('hi')]));
    const reader = stream.getReader();
    const seen: string[] = [];
    while (!seen.includes('text-delta')) {
      seen.push((await reader.read()).value!.type);
    }
    session.emit('assistant.message_delta', { deltaContent: 'lo' });
    session.emit('session.idle');
    const rest: LanguageModelV3StreamPart[] = [];
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      rest.push(value);
    }
    expect(rest.map((p) => p.type)).toEqual([
      'text-delta',
      'text-end',
      'finish',
    ]);
  });

  it('emits the final message as one block when nothing streamed, and ignores sub-agents', async () => {
    const { runtime } = setup((s) => {
      s.onSend = () => {
        s.emit('assistant.message_delta', { deltaContent: 'sub' }, 'agent-2');
        s.emit('assistant.message', { content: 'Whole answer' });
        s.emit('session.idle');
      };
    });
    const model = createCopilotModel({ model: 'auto', runtime });
    const parts = await collect(
      (await model.doStream(call([user('hi')]))).stream,
    );
    expect(
      parts.filter((p) => p.type === 'text-delta').map((p) => p.delta),
    ).toEqual(['Whole answer']);
  });

  it('ends a tool-call step and continues the same session with the results', async () => {
    const id = nextId();
    const { runtime, sessions, client } = setup((s) => {
      s.onSend = () => {
        s.requestTool(id, 'run_sql', { sql: 'select 1' });
        s.emit('session.idle');
      };
      s.onAnswer = () => s.reply('The answer is 1');
    });
    const model = createCopilotModel({ model: 'auto', runtime });
    const first = await collect(
      (await model.doStream(call([user('q')], { tools: [toolDef] }))).stream,
    );
    expect(first.filter((p) => p.type === 'tool-call')).toEqual([
      {
        type: 'tool-call',
        toolCallId: id,
        toolName: 'run_sql',
        input: JSON.stringify({ sql: 'select 1' }),
      },
    ]);
    expect(first.at(-1)).toMatchObject({
      type: 'finish',
      finishReason: { unified: 'tool-calls' },
    });
    expect(sessions[0].disconnect).not.toHaveBeenCalled();

    const second = await model.doGenerate(
      call(
        [
          user('q'),
          {
            role: 'assistant',
            content: [
              {
                type: 'tool-call',
                toolCallId: id,
                toolName: 'run_sql',
                input: {},
              },
            ],
          },
          {
            role: 'tool',
            content: [
              {
                type: 'tool-result',
                toolCallId: id,
                toolName: 'run_sql',
                output: { type: 'json', value: { rows: [[1]] } },
              },
            ],
          },
        ],
        { tools: [toolDef] },
      ),
    );
    expect(client.createSession).toHaveBeenCalledTimes(1);
    expect(sessions[0].rpc.tools.handlePendingToolCall).toHaveBeenCalledWith({
      requestId: `req-${id}`,
      result: JSON.stringify({ rows: [[1]] }),
    });
    expect(second.content).toEqual([{ type: 'text', text: 'The answer is 1' }]);
    expect(second.finishReason.unified).toBe('stop');
    expect(sessions[0].disconnect).toHaveBeenCalled();
  });

  it('collects parallel tool calls into one step', async () => {
    const a = nextId();
    const b = nextId();
    const { runtime } = setup((s) => {
      s.onSend = () => {
        s.requestTool(a, 'run_sql', { sql: 'a' });
        s.requestTool(b, 'run_sql', { sql: 'b' });
      };
    });
    const model = createCopilotModel({ model: 'auto', runtime });
    const result = await model.doGenerate(
      call([user('q')], { tools: [toolDef] }),
    );
    expect(
      result.content.map((c) => c.type === 'tool-call' && c.toolCallId),
    ).toEqual([a, b]);
    expect(result.finishReason.unified).toBe('tool-calls');
  });

  it('configures the session: system prompt replaced, handler-less tools, custom tools only', async () => {
    const { runtime, sessions } = setup();
    const model = createCopilotModel({ model: 'auto', runtime });
    await model.doGenerate(
      call(
        [
          { role: 'system', content: 'Be terse.' },
          { role: 'system', content: 'Use SQL.' },
          user('hi'),
        ],
        { tools: [toolDef] },
      ),
    );
    const config = sessions[0].config;
    expect(config.systemMessage).toEqual({
      mode: 'replace',
      content: 'Be terse.\n\nUse SQL.',
    });
    expect(config.tools).toEqual([
      {
        name: 'run_sql',
        description: 'Runs SQL',
        parameters: toolDef.inputSchema,
        skipPermission: true,
        overridesBuiltInTool: true,
      },
    ]);
    expect((config.tools as object[])[0]).not.toHaveProperty('handler');
    expect(
      (config.availableTools as { toArray(): string[] }).toArray(),
    ).toEqual(['custom:*']);
    expect(config.streaming).toBe(true);
    expect(config).not.toHaveProperty('model');
    expect(config).not.toHaveProperty('reasoningEffort');
  });

  it('falls back to a default system prompt', async () => {
    const { runtime, sessions } = setup();
    await createCopilotModel({ model: 'auto', runtime }).doGenerate(
      call([user('hi')]),
    );
    expect(sessions[0].config.systemMessage).toEqual({
      mode: 'replace',
      content: 'You are a helpful assistant.',
    });
  });

  it('passes a named model and a valid effort, drops an invalid effort', async () => {
    const { runtime, sessions } = setup();
    const model = createCopilotModel({ model: 'gpt-5', runtime });
    await model.doGenerate(
      call([user('hi')], {
        providerOptions: { copilot: { reasoningEffort: 'high' } },
      }),
    );
    await model.doGenerate(
      call([user('hi')], {
        providerOptions: { copilot: { reasoningEffort: 'minimal' } },
      }),
    );
    expect(sessions[0].config).toMatchObject({
      model: 'gpt-5',
      reasoningEffort: 'high',
    });
    expect(sessions[1].config).not.toHaveProperty('reasoningEffort');
  });

  it('passes the JSON schema of structured output as responseSchema', async () => {
    const { runtime, sessions } = setup((s) => {
      s.onSend = () => s.reply('{"status":"ok"}');
    });
    const schema = {
      type: 'object' as const,
      properties: { status: { type: 'string' as const } },
    };
    const result = await createCopilotModel({
      model: 'auto',
      runtime,
    }).doGenerate(
      call([user('probe')], { responseFormat: { type: 'json', schema } }),
    );
    expect(sessions[0].sent[0].responseSchema).toEqual(schema);
    expect(result.content).toEqual([{ type: 'text', text: '{"status":"ok"}' }]);
  });

  it('renders the transcript into a fresh session when the tool call is unknown', async () => {
    const { runtime, sessions } = setup();
    await createCopilotModel({ model: 'auto', runtime }).doGenerate(
      call([
        user('q'),
        {
          role: 'assistant',
          content: [
            {
              type: 'tool-call',
              toolCallId: 'gone',
              toolName: 'run_sql',
              input: { sql: 'x' },
            },
          ],
        },
        {
          role: 'tool',
          content: [
            {
              type: 'tool-result',
              toolCallId: 'gone',
              toolName: 'run_sql',
              output: { type: 'text', value: '42' },
            },
          ],
        },
      ]),
    );
    expect(sessions[0].sent[0].prompt).toBe(
      'User: q\n\nAssistant called run_sql({"sql":"x"})\n\nTool run_sql returned: 42',
    );
  });

  it('closes a session left waiting for tool results after the timeout', async () => {
    jest.useFakeTimers();
    const id = nextId();
    const { runtime, sessions, client } = setup((s) => {
      s.onSend = () => {
        s.requestTool(id, 'run_sql', {});
        s.emit('session.idle');
      };
    });
    const model = createCopilotModel({ model: 'auto', runtime });
    await model.doGenerate(call([user('q')], { tools: [toolDef] }));
    expect(sessions[0].disconnect).not.toHaveBeenCalled();
    jest.advanceTimersByTime(COPILOT_PENDING_TOOL_TIMEOUT_MS);
    expect(sessions[0].disconnect).toHaveBeenCalled();

    // A late continuation for the dropped call starts a fresh session.
    sessions.length = 0;
    client.createSession.mockImplementationOnce((config) => {
      const s = new FakeSession(config);
      s.onSend = () => s.reply('late');
      sessions.push(s);
      return Promise.resolve(s);
    });
    const result = await model.doGenerate(
      call([
        user('q'),
        {
          role: 'tool',
          content: [
            {
              type: 'tool-result',
              toolCallId: id,
              toolName: 'run_sql',
              output: { type: 'text', value: 'r' },
            },
          ],
        },
      ]),
    );
    expect(client.createSession).toHaveBeenCalledTimes(2);
    expect(result.content).toEqual([{ type: 'text', text: 'late' }]);
  });

  it('aborts and closes the Copilot session when the signal fires', async () => {
    let session!: FakeSession;
    const { runtime } = setup((s) => {
      session = s;
      s.onSend = () =>
        s.emit('assistant.message_delta', { deltaContent: 'par' });
    });
    const controller = new AbortController();
    const { stream } = await createCopilotModel({
      model: 'auto',
      runtime,
    }).doStream(call([user('hi')], { abortSignal: controller.signal }));
    const reader = stream.getReader();
    let part = await reader.read();
    while (part.value?.type !== 'text-delta') part = await reader.read();
    controller.abort();
    await expect(reader.read()).rejects.toMatchObject({ name: 'AbortError' });
    expect(session.abort).toHaveBeenCalled();
    expect(session.disconnect).toHaveBeenCalled();
  });

  it('reports a session error with the R64 text', async () => {
    const { runtime, sessions } = setup((s) => {
      s.onSend = () => s.emit('session.error', { message: 'quota exceeded' });
    });
    const model = createCopilotModel({ model: 'auto', runtime });
    await expect(model.doGenerate(call([user('hi')]))).rejects.toThrow(
      copilotRequestFailedMessage('quota exceeded'),
    );
    expect(sessions[0].disconnect).toHaveBeenCalled();
    const { stream } = await model.doStream(call([user('hi')]));
    await expect(collect(stream)).rejects.toThrow(
      copilotRequestFailedMessage('quota exceeded'),
    );
  });

  it('wraps SDK exceptions in the R64 text', async () => {
    const { runtime, client } = setup();
    client.createSession.mockImplementationOnce(() =>
      Promise.reject(new Error('socket closed')),
    );
    await expect(
      createCopilotModel({ model: 'auto', runtime }).doGenerate(
        call([user('hi')]),
      ),
    ).rejects.toThrow(copilotRequestFailedMessage('socket closed'));
  });

  describe('a tool call written as text (R66)', () => {
    const sqlTool = {
      type: 'function' as const,
      name: 'run_readonly_sql',
      description: 'Runs SQL',
      inputSchema: {
        type: 'object' as const,
        properties: {
          sql: { type: 'string' as const },
          datasourceId: { type: 'string' as const },
          rationale: { type: 'string' as const },
        },
        required: ['sql'],
      },
    };
    const argsText = '{"sql":"SELECT 1","rationale":"check"}';

    it('never streams it, and asks once in the same session for the real tool call', async () => {
      const id = nextId();
      const { runtime, sessions, client } = setup((s) => {
        s.onSend = (opts) => {
          if (s.sent.length === 1) {
            // The model writes the tool's arguments as its message.
            s.reply('{"sql":', '"SELECT 1",', '"rationale":"check"}');
          } else {
            expect(opts.prompt).toBe(
              copilotToolAsTextNudge('run_readonly_sql'),
            );
            s.requestTool(id, 'run_readonly_sql', { sql: 'SELECT 1' });
            s.emit('session.idle');
          }
        };
      });
      const parts = await collect(
        (
          await createCopilotModel({ model: 'auto', runtime }).doStream(
            call([user('q')], { tools: [sqlTool] }),
          )
        ).stream,
      );
      expect(parts.filter((p) => p.type === 'text-delta')).toEqual([]);
      expect(parts.filter((p) => p.type === 'tool-call')).toEqual([
        {
          type: 'tool-call',
          toolCallId: id,
          toolName: 'run_readonly_sql',
          input: JSON.stringify({ sql: 'SELECT 1' }),
        },
      ]);
      expect(parts.at(-1)).toMatchObject({
        type: 'finish',
        finishReason: { unified: 'tool-calls' },
      });
      expect(client.createSession).toHaveBeenCalledTimes(1);
      expect(sessions[0].sent).toHaveLength(2);
    });

    it('asks only once: a second text answer is returned as it is', async () => {
      const { runtime, sessions } = setup((s) => {
        s.onSend = () =>
          s.sent.length === 1
            ? s.reply(argsText)
            : s.reply('Sorry, here it is.');
      });
      const result = await createCopilotModel({
        model: 'auto',
        runtime,
      }).doGenerate(call([user('q')], { tools: [sqlTool] }));
      expect(sessions[0].sent).toHaveLength(2);
      expect(result.content).toEqual([
        { type: 'text', text: 'Sorry, here it is.' },
      ]);
      expect(sessions[0].disconnect).toHaveBeenCalled();
    });

    it('streams JSON that fits no tool unchanged', async () => {
      const { runtime, sessions } = setup((s) => {
        s.onSend = () => s.reply('{"team":', '"France"}');
      });
      const parts = await collect(
        (
          await createCopilotModel({ model: 'auto', runtime }).doStream(
            call([user('q')], { tools: [sqlTool] }),
          )
        ).stream,
      );
      expect(
        parts
          .filter((p) => p.type === 'text-delta')
          .map((p) => p.delta)
          .join(''),
      ).toBe('{"team":"France"}');
      expect(sessions[0].sent).toHaveLength(1);
    });

    it('leaves structured output alone', async () => {
      const { runtime, sessions } = setup((s) => {
        s.onSend = () => s.reply(argsText);
      });
      const result = await createCopilotModel({
        model: 'auto',
        runtime,
      }).doGenerate(
        call([user('q')], {
          tools: [sqlTool],
          responseFormat: { type: 'json', schema: sqlTool.inputSchema },
        }),
      );
      expect(sessions[0].sent).toHaveLength(1);
      expect(result.content).toEqual([{ type: 'text', text: argsText }]);
    });
  });

  it('passes the not-signed-in error through unchanged', async () => {
    const { runtime, client } = setup();
    runtime.ensureSignedIn.mockRejectedValueOnce(
      new Error(COPILOT_NOT_SIGNED_IN),
    );
    await expect(
      createCopilotModel({ model: 'auto', runtime }).doGenerate(
        call([user('hi')]),
      ),
    ).rejects.toThrow(new Error(COPILOT_NOT_SIGNED_IN));
    expect(client.createSession).not.toHaveBeenCalled();
  });
});
