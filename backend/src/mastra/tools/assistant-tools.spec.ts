import { RequestContext } from '@mastra/core/request-context';
import type { z } from 'zod';
import { setDatasetToolServices } from '../tool-services';
import type { DatasetToolServices } from '../tool-services';
import { askClarificationTool, parseJsonList } from './clarification.tool';
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
  // The tool keeps the Zod schema it was built with.
  const schema = askClarificationTool.inputSchema as unknown as z.ZodType;
  const options = [
    { label: 'Most titles', description: 'Tournaments won' },
    { label: 'Best win rate' },
  ];

  it('reads a well-formed JSON-encoded list as the list', () => {
    const parsed = schema.safeParse({
      question: 'How should I measure "best"?',
      options: JSON.stringify(options),
    });
    expect(parsed.success).toBe(true);
    expect((parsed.data as { options: unknown }).options).toEqual(options);
  });

  it('still accepts the list itself', () => {
    expect(schema.safeParse({ question: 'Which?', options }).success).toBe(
      true,
    );
  });

  it('rejects a malformed JSON string and a list outside 2-4 options', () => {
    const malformed = '[{"label": "Most titles"}, "label": "Best win rate"]';
    for (const value of [malformed, JSON.stringify(options.slice(0, 1))]) {
      expect(
        schema.safeParse({ question: 'Which?', options: value }).success,
      ).toBe(false);
    }
  });

  it('leaves anything that is not a JSON array untouched', () => {
    expect(parseJsonList('not json')).toBe('not json');
    expect(parseJsonList('{"a": 1}')).toBe('{"a": 1}');
    expect(parseJsonList(options)).toBe(options);
  });
});
