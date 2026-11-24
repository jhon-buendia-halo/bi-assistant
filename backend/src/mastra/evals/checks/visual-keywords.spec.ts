import { visualKeywords } from './visual-keywords';
import type { CheckToolCall, CheckTurn } from './turn';

const context = { dialect: 'postgres' as const };
const keywords = { keywords: ['goal', '2022', 'knockout'] };

function visual(result: unknown, error?: string): CheckToolCall {
  return {
    name: 'create_visual',
    args: { instruction: 'A bar chart of goals per team.' },
    argsReadable: true,
    ...(result !== undefined ? { result } : {}),
    ...(error !== undefined ? { error } : {}),
  };
}

const turn = (...toolCalls: CheckToolCall[]): CheckTurn => ({
  question: 'Chart the goals scored by each team in the 2022 knockout stage.',
  answer: 'Here is the chart.',
  toolCalls,
});

describe('visualKeywords (R121, G4)', () => {
  it('passes when a created visual’s title and description hold every keyword', () => {
    expect(
      visualKeywords.evaluate(
        turn(
          visual({
            visualId: 'v1',
            version: 1,
            title: 'Goals by Team',
            description: 'Goals per team across the 2022 knockout stage.',
          }),
        ),
        keywords,
        context,
      ),
    ).toEqual({ passed: true });
  });

  it('fails naming the missing keywords and the title', () => {
    expect(
      visualKeywords.evaluate(
        turn(
          visual({
            visualId: 'v1',
            version: 1,
            title: 'Goals by Team, 2018',
            description: 'All matches.',
          }),
        ),
        keywords,
        context,
      ),
    ).toEqual({
      passed: false,
      reason:
        'the visual "Goals by Team, 2018" does not mention "2022", "knockout"',
    });
  });

  it('fails when no visual was created, with the error of the failed call', () => {
    expect(visualKeywords.evaluate(turn(), keywords, context).reason).toBe(
      'create_visual was not called',
    );
    // The baseline's create_visual calls all failed this way.
    expect(
      visualKeywords.evaluate(
        turn(visual(undefined, 'completed assistant answer not found')),
        keywords,
        context,
      ).reason,
    ).toBe('create_visual failed: completed assistant answer not found');
  });

  it('needs at least one keyword, and lists them in its description', () => {
    expect(visualKeywords.validateArgs?.({ keywords: [] })).toMatch(
      /non-empty array/,
    );
    expect(visualKeywords.describe(keywords, context)).toBe(
      'Checks that a created visual\'s title and description mention "goal", "2022", "knockout"',
    );
  });
});
