import { servesClaude, stepModelFrom, TEAM_STEP_MODEL } from './step-model';

describe("a workflow's step model (agents.md 1.3)", () => {
  it('runs the agents Avery calls on Opus 5.5 at medium effort', () => {
    expect(TEAM_STEP_MODEL).toEqual({
      model: 'claude-opus-5-5',
      reasoningEffort: 'medium',
    });
  });

  it('swaps the model only when the saved one is served as a Claude model', () => {
    expect(servesClaude('anthropic/claude-sonnet-4-6')).toBe(true);
    expect(
      servesClaude({
        kind: 'custom-anthropic',
        id: 'anthropic/claude-sonnet-5-5',
        baseUrl: 'http://127.0.0.1:8317/v1',
      }),
    ).toBe(true);
    expect(
      servesClaude({
        id: 'custom/claude-sonnet-5-5',
        apiKey: 'k',
        url: 'http://127.0.0.1:8317/v1',
      }),
    ).toBe(true);
    expect(servesClaude('openai/gpt-5.2')).toBe(false);
    expect(
      servesClaude({ id: 'lenai/mmc-gpt-52', apiKey: 'k', url: 'https://x' }),
    ).toBe(false);
    expect(servesClaude({ kind: 'copilot', id: 'copilot/claude-opus' })).toBe(
      false,
    );
  });

  it('reads the step model from a context, and nothing from one without it', () => {
    const context = new Map<string, unknown>([['step-model', TEAM_STEP_MODEL]]);
    expect(stepModelFrom(context)).toEqual(TEAM_STEP_MODEL);
    expect(stepModelFrom(new Map())).toBeUndefined();
    expect(stepModelFrom(undefined)).toBeUndefined();
    expect(stepModelFrom({} as never)).toBeUndefined();
  });
});
