import {
  buildContextSegments,
  estimateTokens,
  messageText,
  type PromptMessage,
  type SegmentSources,
  type ToolDefinition,
} from './context-segments';
import { collapseSpans, toolName, type CollapsedSpan } from './span-collapse';
import {
  GEN_1,
  GEN_2,
  GEN_3,
  toSpanEventRows,
} from './testing/span-events.fixture';

const KEYS = [
  'system-prompt',
  'skills',
  'tools',
  'chat-history',
  'dataset',
  'user-prompt',
  'tool-results',
];

const spans = collapseSpans(toSpanEventRows());

function messagesOf(input: unknown): PromptMessage[] {
  return (
    Array.isArray(input) ? input : (input as { messages: unknown }).messages
  ) as PromptMessage[];
}

/** The sources of one fixture call, the way the service assembles them. */
function sourcesOf(generationId: string): SegmentSources {
  const generation = spans.get(generationId)!;
  const all = [...spans.values()];
  const steps = all
    .filter(
      (s) =>
        s.spanType === 'model_step' &&
        s.parentSpanId === generationId &&
        s.endedAt !== null,
    )
    .sort(
      (a, b) => Number(a.attributes.stepIndex) - Number(b.attributes.stepIndex),
    );
  const last: CollapsedSpan | undefined = steps[steps.length - 1];
  const end = generation.endedAt;
  const toolCalls = all
    .filter(
      (s) =>
        s.spanType === 'tool_call' &&
        s.startedAt >= generation.startedAt &&
        (end === null || s.startedAt <= end),
    )
    .map((s) => ({ name: toolName(s), input: s.input, output: s.output }));
  const usage = (last?.attributes.usage ?? null) as {
    inputTokens: number;
  } | null;
  return {
    generationMessages: messagesOf(generation.input),
    lastStepMessages: last ? messagesOf(last.input) : null,
    tools: generation.attributes.tools as ToolDefinition[],
    toolCalls,
    contextTokens: usage?.inputTokens ?? null,
  };
}

function segment(sources: SegmentSources, key: string) {
  return buildContextSegments(sources).find((s) => s.key === key)!;
}

describe('collapseSpans (fixture)', () => {
  it('folds duplicate start rows and the end row into one span', () => {
    const generation = spans.get(GEN_1)!;
    expect(generation.startedAt.toISOString()).toBe('2026-11-10T19:43:43.249Z');
    expect(generation.endedAt?.toISOString()).toBe('2026-11-10T19:44:01.510Z');
    expect(generation.attributes.finishReason).toBe('stop');
  });

  it('keeps a span with no end row open', () => {
    expect(spans.get(GEN_3)!.endedAt).toBeNull();
  });
});

describe('buildContextSegments', () => {
  it('always returns the seven boxes in order, with labels and owners', () => {
    const segments = buildContextSegments({
      generationMessages: [],
      lastStepMessages: null,
      tools: [],
      toolCalls: [],
      contextTokens: null,
    });
    expect(segments.map((s) => s.key)).toEqual(KEYS);
    expect(segments.map((s) => s.label)).toEqual([
      'System prompt',
      'Skill injection',
      'Tools injection',
      'Chat history',
      'Dataset',
      'User prompt',
      'Tool calls and results',
    ]);
    expect(segments.map((s) => s.owner)).toEqual([
      'US Health',
      'US Health',
      'US Health',
      'Custom',
      'Custom',
      'Custom',
      'Custom',
    ]);
    expect(segments.every((s) => s.tokens === 0 && s.share === 0)).toBe(true);
    expect(segments.every((s) => s.items.length === 0)).toBe(true);
  });

  describe('turn 1 (four steps, three tool calls)', () => {
    const sources = sourcesOf(GEN_1);

    it('puts the system prompt and the workspace message under System prompt', () => {
      const items = segment(sources, 'system-prompt').items;
      expect(items).toHaveLength(2);
      expect(items[0].text).toMatch(/^You are the Questions to Insights/);
      expect(items[1].text).toMatch(/^Local filesystem at/);
    });

    it('puts the skills listing and the skills notice under Skill injection', () => {
      const items = segment(sources, 'skills').items;
      expect(items.map((i) => i.text.slice(0, 20))).toEqual([
        '<available_skills>\n ',
        'IMPORTANT: Skills ar',
      ]);
    });

    it('lists one item per tool definition', () => {
      const items = segment(sources, 'tools').items;
      expect(items.map((i) => i.title)).toEqual([
        'describe_entity',
        'run_readonly_sql',
        'skill',
        'skill_read',
      ]);
      expect(items[1].text).toContain('Run a single read-only SELECT');
      expect(items[1].text).toContain('"sql"');
    });

    it('puts the per-turn context blocks under Dataset', () => {
      const items = segment(sources, 'dataset').items;
      expect(items).toHaveLength(1);
      expect(items[0].text).toMatch(/^Datasets for this session: World Cup/);
    });

    it('has the question as User prompt and no chat history', () => {
      expect(segment(sources, 'user-prompt').items).toEqual([
        { title: 'User', text: 'Which team scored the most goals in total?' },
      ]);
      expect(segment(sources, 'chat-history').items).toEqual([]);
    });

    it('lists each tool call with its input and output', () => {
      const items = segment(sources, 'tool-results').items;
      expect(items.map((i) => i.title)).toEqual([
        'describe_entity',
        'run_readonly_sql',
        'run_readonly_sql',
      ]);
      expect(items[0].text).toContain('"entity": "world_cup.world_cup.goals"');
      expect(items[0].text).toContain('"datasourceKind": "postgres"');
    });

    it('scales the estimates to the last step input tokens', () => {
      const segments = buildContextSegments(sources);
      expect(sources.contextTokens).toBe(17647);
      expect(segments.reduce((sum, s) => sum + s.tokens, 0)).toBe(17647);
      expect(segments.reduce((sum, s) => sum + s.share, 0)).toBeCloseTo(1, 10);
      for (const s of segments) {
        expect(s.chars).toBe(
          s.items.reduce((sum, item) => sum + item.text.length, 0),
        );
      }
    });
  });

  describe('turn 2 (a follow-up question)', () => {
    const sources = sourcesOf(GEN_2);

    it('puts the earlier turn under Chat history, tool results included', () => {
      const items = segment(sources, 'chat-history').items;
      expect(items.map((i) => i.title)).toEqual([
        'User',
        'Assistant',
        'Tool results',
        'Assistant',
        'Tool results',
        'Assistant',
        'Tool results',
        'Assistant',
      ]);
      expect(items[0].text).toBe('Which team scored the most goals in total?');
      expect(items[1].text).toContain('[tool call: describe_entity]');
      expect(items[2].text).toContain('[tool result: describe_entity]');
    });

    it('has only the last user message as User prompt', () => {
      expect(segment(sources, 'user-prompt').items).toEqual([
        { title: 'User', text: 'And the second?' },
      ]);
    });

    it('has no tool calls of its own and adds up to its context size', () => {
      expect(segment(sources, 'tool-results').items).toEqual([]);
      const segments = buildContextSegments(sources);
      expect(segments.reduce((sum, s) => sum + s.tokens, 0)).toBe(18040);
    });
  });

  describe('a running call (no finished step)', () => {
    const sources = sourcesOf(GEN_3);

    it('uses the generation input only and estimates chars / 4', () => {
      expect(sources.lastStepMessages).toBeNull();
      const segments = buildContextSegments(sources);
      expect(segments.find((s) => s.key === 'dataset')!.items).toHaveLength(2);
      for (const s of segments) {
        expect(s.tokens).toBe(Math.round(s.chars / 4));
      }
    });
  });

  it('counts skill and skill_read calls as Skill injection, not Tool calls', () => {
    const segments = buildContextSegments({
      generationMessages: [{ role: 'user', content: 'Hi' }],
      lastStepMessages: null,
      tools: [],
      toolCalls: [
        { name: 'skill', input: { name: 'curated-knowledge' }, output: 'ok' },
        { name: 'skill_read', input: { path: 'a.md' }, output: 'text' },
        { name: 'run_readonly_sql', input: { sql: 'SELECT 1' }, output: [] },
      ],
      contextTokens: null,
    });
    const skills = segments.find((s) => s.key === 'skills')!;
    const toolResults = segments.find((s) => s.key === 'tool-results')!;
    expect(skills.items.map((i) => i.title)).toEqual(['skill', 'skill_read']);
    expect(skills.items[0].text).toBe(
      '{\n  "name": "curated-knowledge"\n}\n\nok',
    );
    expect(toolResults.items.map((i) => i.title)).toEqual(['run_readonly_sql']);
  });
});

describe('messageText', () => {
  it('joins text, reasoning, tool calls and results; skips signatures', () => {
    expect(
      messageText({
        role: 'assistant',
        content: [
          {
            type: 'reasoning',
            text: 'thinking',
            providerOptions: { anthropic: { signature: 'SIG' } },
          },
          { type: 'text', text: 'Answer' },
          { type: 'tool-call', toolName: 'sample_rows', input: { n: 1 } },
          { type: 'tool-result', toolName: 'sample_rows', output: 'rows' },
        ],
      }),
    ).toBe(
      'thinking\nAnswer\n[tool call: sample_rows] {\n  "n": 1\n}\n[tool result: sample_rows] rows',
    );
  });
});

describe('estimateTokens', () => {
  it('is chars / 4 when the context size is unknown', () => {
    expect(estimateTokens([400, 2, 0], null)).toEqual([100, 1, 0]);
  });

  it('scales to the context size and puts the rounding remainder on the largest', () => {
    // 1/3 each of 100 rounds to 33 + 33 + 33 = 99; the largest takes the 1.
    expect(estimateTokens([40, 40, 40], 100)).toEqual([34, 33, 33]);
    const scaled = estimateTokens([10, 30, 960, 0], 1001);
    expect(scaled.reduce((a, b) => a + b, 0)).toBe(1001);
    expect(scaled[3]).toBe(0);
    expect(scaled[2]).toBeGreaterThan(scaled[1]);
  });

  it('cannot scale an empty prompt', () => {
    expect(estimateTokens([0, 0], 500)).toEqual([0, 0]);
  });
});
