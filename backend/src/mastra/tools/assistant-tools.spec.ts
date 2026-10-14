import { RequestContext } from '@mastra/core/request-context';
import type { z } from 'zod';
import { setDatasetToolServices } from '../tool-services';
import type { DatasetToolServices } from '../tool-services';
import {
  askClarificationTool,
  clarificationOptions,
  parseClarification,
  optionLines,
} from './clarification.tool';
import {
  SESSION_ID_CONTEXT_KEY,
  TURN_QUESTION_CONTEXT_KEY,
  createVisualTool,
} from './visual.tools';

type CreateVisual = DatasetToolServices['createVisual'];
type CreateVisualMock = jest.Mock<
  ReturnType<CreateVisual>,
  Parameters<CreateVisual>
>;

type Execute = (
  input: Record<string, unknown>,
  context: { requestContext: RequestContext },
) => Promise<unknown>;

function servicesWith(createVisual: CreateVisualMock): DatasetToolServices {
  return {
    getDatasets: jest.fn(),
    sampleRows: jest.fn(),
    runReadOnlySql: jest.fn(),
    createVisual,
    updateVisual: jest.fn(),
    restTarget: jest.fn(),
    exportRfpPackage: jest.fn(),
  };
}

describe('create_visual (agents.md 3.6)', () => {
  const execute = createVisualTool.execute as unknown as Execute;
  let createVisual: CreateVisualMock;
  let requestContext: RequestContext;

  beforeEach(() => {
    createVisual = jest.fn<
      ReturnType<CreateVisual>,
      Parameters<CreateVisual>
    >();
    createVisual.mockResolvedValue({
      visualId: 'v1',
      version: 1,
      title: 'Goals',
      description: '',
    });
    setDatasetToolServices(servicesWith(createVisual));
    requestContext = new RequestContext();
    requestContext.set(SESSION_ID_CONTEXT_KEY, 'session-1');
    requestContext.set(
      TURN_QUESTION_CONTEXT_KEY,
      'Chart the goals scored by each team in the 2022 knockout stage.',
    );
  });

  const instructionSent = (): unknown => createVisual.mock.calls[0][2];

  it("uses the turn's question when the model passes no instruction", async () => {
    await execute({}, { requestContext });
    expect(createVisual).toHaveBeenCalledWith(
      'session-1',
      undefined,
      'Chart the goals scored by each team in the 2022 knockout stage.',
      undefined,
    );
  });

  it('treats a blank instruction as none', async () => {
    await execute({ instruction: '   ' }, { requestContext });
    expect(instructionSent()).toBe(
      'Chart the goals scored by each team in the 2022 knockout stage.',
    );
  });

  it("keeps the model's own instruction", async () => {
    await execute({ instruction: 'Bar chart, sorted' }, { requestContext });
    expect(instructionSent()).toBe('Bar chart, sorted');
  });

  it('passes no instruction when the turn has no question either', async () => {
    const bare = new RequestContext();
    bare.set(SESSION_ID_CONTEXT_KEY, 'session-1');
    await execute({}, { requestContext: bare });
    expect(instructionSent()).toBeUndefined();
  });
});

describe('ask_clarification options (agents.md 3.5)', () => {
  const schema = askClarificationTool.inputSchema as unknown as z.ZodType;
  const lines = 'Most titles — tournaments won\nBest win rate';
  const valid = (options: unknown) =>
    schema.safeParse({ question: 'Which?', options }).success;

  it('takes one string with 2-4 options, one per line', () => {
    expect(valid(lines)).toBe(true);
    expect(valid('- Most titles\n- Best win rate\n- Most goals')).toBe(true);
  });

  it('joins a list, or a JSON-encoded one, into lines', () => {
    const list = ['Most titles — tournaments won', 'Best win rate'];
    expect(optionLines(list)).toBe(lines);
    expect(optionLines(JSON.stringify(list))).toBe(lines);
    expect(valid(list)).toBe(true);
  });

  it('drops a leaked tool-call parameter wrapper', () => {
    const leaked = `\n<parameter name="options">${lines}</parameter>`;
    expect(optionLines(leaked)).toBe(lines);
    expect(
      optionLines(
        '\n<parameter name="options">["Most titles", "Best win rate"]',
      ),
    ).toBe('Most titles\nBest win rate');
    expect(valid(leaked)).toBe(true);
  });

  it('rejects fewer than 2 or more than 4 options, objects and blanks', () => {
    for (const value of [
      '\n<parameter name="label">Most titles',
      '["Most titles", "label": "Best win rate"]',
      [{ label: 'Most titles' }, { label: 'Best win rate' }],
      ['Most titles', '  '],
      'Only one',
      'a\nb\nc\nd\ne',
      '',
    ]) {
      expect(valid(value)).toBe(false);
    }
  });

  it('splits each option at the first spaced dash into label and description', () => {
    expect(
      clarificationOptions(
        [
          '1. Most titles — tournaments won outright',
          'Win rate – share of matches won — all tournaments',
          '- Goals scored',
          'Ratio — ',
          'Head-to-head',
        ].join('\n'),
      ),
    ).toEqual([
      { label: 'Most titles', description: 'tournaments won outright' },
      {
        label: 'Win rate',
        description: 'share of matches won — all tournaments',
      },
      { label: 'Goals scored' },
      { label: 'Ratio' },
      { label: 'Head-to-head' },
    ]);
  });

  it('turns only a valid call into a clarification', () => {
    expect(parseClarification({ question: 'Which?', options: lines })).toEqual({
      question: 'Which?',
      options: [
        { label: 'Most titles', description: 'tournaments won' },
        { label: 'Best win rate' },
      ],
    });
    expect(
      parseClarification({ question: 'Which?', options: 'Most titles' }),
    ).toBeUndefined();
    expect(parseClarification(undefined)).toBeUndefined();
  });
});
