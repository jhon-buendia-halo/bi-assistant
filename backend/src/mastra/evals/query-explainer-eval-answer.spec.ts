import { answerResult } from './query-explainer-eval-answer';

/**
 * Mastra cannot load in Jest, so the built-in `includes` check is read as it
 * is written (`@mastra/evals` checks, `getTextContentFromMastraDBMessage`):
 * it joins the text of every `assistant` message of `scoringData.output`,
 * taking `content.content` first, else the last text part. An empty output
 * (the first shape of this target) gave "the agent produced no answer text".
 */
function builtInIncludesReads(output: unknown): string {
  return (output as { role: string; content: Record<string, unknown> }[])
    .filter((m) => m.role === 'assistant')
    .map((m) => {
      const { content, parts } = m.content as {
        content?: string;
        parts?: { type: string; text: string }[];
      };
      if (typeof content === 'string' && content !== '') return content;
      return (parts ?? []).filter((p) => p.type === 'text').pop()?.text ?? '';
    })
    .join(' ');
}

describe('the answer the query-explainer target returns', () => {
  const answer = JSON.stringify({ steps: [{ verb: 'start' }] });

  it('puts the explanation where the built-in checks read the answer', () => {
    const result = answerResult('SELECT 1', answer);
    expect(result.text).toBe(answer);
    expect(builtInIncludesReads(result.scoringData.output)).toContain(
      '"steps"',
    );
  });

  it('keeps the parts shape too, for a reader that takes the last text part', () => {
    const [message] = answerResult('SELECT 1', answer).scoringData.output;
    expect(message.role).toBe('assistant');
    expect(message.content.parts).toEqual([{ type: 'text', text: answer }]);
  });
});
