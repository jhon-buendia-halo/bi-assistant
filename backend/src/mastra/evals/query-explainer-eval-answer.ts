/**
 * What `runEvals` reads of a target's result without any tool call. The
 * built-in scorers read the answer from `scoringData.output`, the agent's
 * output as assistant messages (not from `text`).
 */
export function answerResult(input: unknown, answer: string) {
  return {
    text: answer,
    steps: [],
    toolCalls: [],
    toolResults: [],
    scoringData: {
      input,
      output: [
        {
          id: 'query-explainer-eval-answer',
          role: 'assistant',
          createdAt: new Date(),
          content: {
            format: 2,
            parts: [{ type: 'text', text: answer }],
            content: answer,
          },
        },
      ],
    },
  };
}
