import {
  answerReviewOutputSchema,
  buildReviewPrompt,
  reviewAnswer,
  reviewNudge,
  type AnswerReviewInput,
  type ReviewAgentLike,
} from './answer-review';

/**
 * `answer-review.ts` is a pure module (no `@mastra/core` import — see its
 * top-of-file comment), so unlike `sessions.service.spec.ts` this file needs
 * no `jest.mock` at all: `ReviewAgentLike` is a plain structural type and a
 * bare `{ generate: jest.fn() }` satisfies it.
 */

const baseInput: AnswerReviewInput = {
  question: 'How many claims were processed last month?',
  finalText: 'There were 1,204 claims processed last month.',
  sql: [
    {
      sql: 'SELECT COUNT(*) AS n FROM claims WHERE claim_month = date_trunc(\'month\', current_date - interval \'1 month\')',
      ok: true,
      rowCount: 1,
    },
  ],
  resultShape: '1 row x 1 column',
  warnings: [],
};

function mockAgent(): ReviewAgentLike & { generate: jest.Mock } {
  return { generate: jest.fn() };
}

describe('reviewAnswer', () => {
  it('returns status ok with no findings and no nudge when the review passes', async () => {
    const agent = mockAgent();
    agent.generate.mockResolvedValue({
      object: { ok: true, findings: [], confidence: 'high' },
      usage: { inputTokens: 120, outputTokens: 40 },
    });

    const result = await reviewAnswer(agent, baseInput, {});

    expect(result.review).toEqual({ status: 'ok', findings: [] });
    expect(result.nudge).toBeUndefined();
    expect(result.usage).toEqual({
      inputTokens: 120,
      outputTokens: 40,
      totalTokens: 160,
      reasoningTokens: 0,
      cachedInputTokens: 0,
      calls: 1,
    });
  });

  it('calls the agent with maxSteps 1, tools off and structured output, and forwards providerOptions/abortSignal', async () => {
    const agent = mockAgent();
    agent.generate.mockResolvedValue({
      object: { ok: true, findings: [], confidence: 'high' },
    });
    const controller = new AbortController();
    const providerOptions = { openai: { reasoningEffort: 'low' } };

    await reviewAnswer(agent, baseInput, {
      providerOptions,
      abortSignal: controller.signal,
    });

    expect(agent.generate).toHaveBeenCalledTimes(1);
    const [prompt, callOptions] = agent.generate.mock.calls[0];
    expect(prompt).toEqual(expect.stringContaining('<question>'));
    expect(prompt).toEqual(expect.stringContaining(baseInput.question));
    expect(callOptions).toMatchObject({
      maxSteps: 1,
      toolChoice: 'none',
      providerOptions,
      abortSignal: controller.signal,
      structuredOutput: {
        schema: answerReviewOutputSchema,
        jsonPromptInjection: 'inline',
      },
    });
  });

  it('returns status flagged with a note and a nudge when a high-confidence finding is reported', async () => {
    const agent = mockAgent();
    const findings = [
      {
        code: 'unsupported-claim' as const,
        detail: 'The answer says 1,204 but the query returned n=1204... no wait, 1,150.',
      },
    ];
    agent.generate.mockResolvedValue({
      object: { ok: false, findings, confidence: 'high' },
    });

    const result = await reviewAnswer(agent, baseInput, {});

    expect(result.review.status).toBe('flagged');
    expect(result.review.findings).toEqual(findings);
    expect(result.review.note).toBeDefined();
    expect(result.review.note).toContain('unsupported-claim');
    expect(result.nudge).toBeDefined();
    expect(result.nudge).toContain('unsupported-claim');
    expect(result.nudge).toContain(findings[0].detail);
  });

  it('keeps a low-confidence finding on the record but reports ok and skips the nudge', async () => {
    const agent = mockAgent();
    const findings = [
      { code: 'degenerate-query' as const, detail: 'Possibly a ratio of a column by itself.' },
    ];
    agent.generate.mockResolvedValue({
      object: { ok: false, findings, confidence: 'low' },
    });

    const result = await reviewAnswer(agent, baseInput, {});

    expect(result.review).toEqual({ status: 'ok', findings });
    expect(result.nudge).toBeUndefined();
  });

  it('falls back to parsing a fenced JSON text reply when there is no .object', async () => {
    const agent = mockAgent();
    const payload = {
      ok: false,
      findings: [{ code: 'date-filter', detail: 'Filter uses fiscal month, question asked calendar month.' }],
      confidence: 'high',
    };
    agent.generate.mockResolvedValue({
      text: '```json\n' + JSON.stringify(payload) + '\n```',
    });

    const result = await reviewAnswer(agent, baseInput, {});

    expect(result.review.status).toBe('flagged');
    expect(result.review.findings).toEqual(payload.findings);
  });

  it('returns status error when the reply is not valid JSON', async () => {
    const agent = mockAgent();
    agent.generate.mockResolvedValue({ text: 'not json at all' });

    const result = await reviewAnswer(agent, baseInput, {});

    expect(result.review).toEqual({
      status: 'error',
      findings: [],
      note: 'review response could not be parsed',
    });
  });

  it('reads usage even when the reply cannot be parsed', async () => {
    const agent = mockAgent();
    agent.generate.mockResolvedValue({
      text: 'garbage, not json',
      usage: { inputTokens: 30, outputTokens: 10 },
    });

    const result = await reviewAnswer(agent, baseInput, {});

    expect(result.review.status).toBe('error');
    expect(result.usage).toEqual({
      inputTokens: 30,
      outputTokens: 10,
      totalTokens: 40,
      reasoningTokens: 0,
      cachedInputTokens: 0,
      calls: 1,
    });
  });

  it('returns status error and never throws when the agent call rejects', async () => {
    const agent = mockAgent();
    agent.generate.mockRejectedValue(new Error('provider unavailable'));

    const result = await reviewAnswer(agent, baseInput, {});

    expect(result.review.status).toBe('error');
    expect(result.review.findings).toEqual([]);
    expect(result.review.note).toContain('provider unavailable');
    expect(result.usage).toBeUndefined();
  });

  it('returns a clean status error with no note when the call was aborted', async () => {
    const agent = mockAgent();
    const controller = new AbortController();
    controller.abort();
    agent.generate.mockRejectedValue(new DOMException('This operation was aborted', 'AbortError'));

    const result = await reviewAnswer(agent, baseInput, {
      abortSignal: controller.signal,
    });

    expect(result.review).toEqual({ status: 'error', findings: [] });
    expect(result.usage).toBeUndefined();
  });

  it('treats an ok:false reply with an empty findings list as ok (defensive)', async () => {
    const agent = mockAgent();
    agent.generate.mockResolvedValue({
      object: { ok: false, findings: [], confidence: 'high' },
    });

    const result = await reviewAnswer(agent, baseInput, {});

    expect(result.review).toEqual({ status: 'ok', findings: [] });
    expect(result.nudge).toBeUndefined();
  });
});

describe('buildReviewPrompt', () => {
  it('renders every given section, tagged', () => {
    const prompt = buildReviewPrompt({
      ...baseInput,
      metricsBlock: 'claims_per_member: SUM(claims.count) / COUNT(DISTINCT members.id)',
      defaultFilters: ['claims.is_test = false'],
    });
    expect(prompt).toContain('<question>');
    expect(prompt).toContain('<final-answer>');
    expect(prompt).toContain('<sql>');
    expect(prompt).toContain('<result-shape>');
    expect(prompt).toContain('<metrics>');
    expect(prompt).toContain('<default-filters>');
  });

  it('omits optional sections that are absent, and reports no SQL plainly', () => {
    const prompt = buildReviewPrompt({
      question: 'q',
      finalText: 'a',
      sql: [],
      warnings: [],
    });
    expect(prompt).not.toContain('<result-shape>');
    expect(prompt).not.toContain('<metrics>');
    expect(prompt).not.toContain('<default-filters>');
    expect(prompt).not.toContain('<warnings>');
    expect(prompt).toContain('no SQL was executed this turn');
  });

  it('clips every section to a bounded prompt instead of growing without limit', () => {
    const longText = 'x'.repeat(10000);
    const manySql = Array.from({ length: 20 }, (_, i) => ({
      sql: `SELECT ${i} FROM very_long_table_name_repeated_many_times_over`.repeat(20),
      ok: i % 2 === 0,
      error: i % 2 === 0 ? undefined : 'column does not exist',
      rowCount: i,
    }));
    const prompt = buildReviewPrompt({
      question: longText,
      finalText: longText,
      sql: manySql,
      resultShape: longText,
      warnings: [longText],
      metricsBlock: longText,
      defaultFilters: [longText],
    });

    // The unclipped inputs alone total well over 70,000 chars; a compact,
    // budgeted prompt stays in the low thousands.
    expect(prompt.length).toBeLessThan(8000);
    expect(prompt).toContain('…');
    expect(prompt).toContain('more statement(s) omitted');
  });
});

describe('reviewNudge', () => {
  it('returns an empty string for no findings', () => {
    expect(reviewNudge([])).toBe('');
  });

  it('lists each finding by code and detail, and tells the assistant not to mention the review', () => {
    const text = reviewNudge([
      { code: 'unsupported-claim', detail: 'Claims 1,204 but no query returned that figure.' },
      { code: 'ignored-breakdown', detail: 'Question asked by region; answer gives one total.' },
    ]);
    expect(text).toContain('- [unsupported-claim] Claims 1,204 but no query returned that figure.');
    expect(text).toContain('- [ignored-breakdown] Question asked by region; answer gives one total.');
    const flat = text.toLowerCase().replace(/\s+/g, ' ');
    expect(flat).toContain('do not mention this review');
    expect(flat).toContain('correct the answer');
  });
});
