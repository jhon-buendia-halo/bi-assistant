import {
  genericStepStory,
  tellStep,
  type StoryContext,
  type StoryStep,
} from './workflow-story';
import type { JsonSchema } from './workflow-contract';

const CONTEXT: StoryContext = { runInput: {}, steps: [] };

function step(overrides: Partial<StoryStep>): StoryStep {
  return { id: 'score', title: 'Score leads', status: 'success', ...overrides };
}

describe('the generic step story (ui.md 4.4b, Logs Story)', () => {
  const schema: JsonSchema = {
    type: 'object',
    properties: {
      ranked: { type: 'array', description: 'The leads ranked by score.' },
      threshold: { type: 'number', description: 'The score threshold used.' },
    },
  };

  it('labels each output field with its schema description, else its name in words', () => {
    const story = genericStepStory(
      step({
        output: {
          ranked: [{ id: 1 }, { id: 2 }],
          threshold: 0.7,
          aboveThreshold: 18,
          tags: ['hot', 'warm'],
        },
      }),
      schema,
    );
    expect(story).toEqual({
      headline: 'Score leads returned 4 values.',
      facts: [
        { label: 'The leads ranked by score', values: ['2 items'] },
        { label: 'The score threshold used', values: ['0.7'] },
        { label: 'Above threshold', values: ['18'] },
        { label: 'Tags', values: ['hot', 'warm'] },
      ],
      source: 'generic',
    });
  });

  it('tells a failed, a skipped and an over-the-cap step by their state', () => {
    expect(
      genericStepStory(step({ status: 'failed', error: 'Boom' }))?.headline,
    ).toBe('It failed: Boom');
    expect(genericStepStory(step({ status: 'skipped' }))?.headline).toBe(
      'Skipped: the run took another path.',
    );
    expect(genericStepStory(step({}))?.headline).toBe(
      'It finished; what it returned was too large to keep.',
    );
  });

  it('has no story for a step that runs or waits', () => {
    expect(tellStep(step({ status: 'running' }), CONTEXT)).toBeUndefined();
    expect(tellStep(step({ status: 'suspended' }), CONTEXT)).toBeUndefined();
  });
});

describe('tellStep', () => {
  it("uses the workflow's storyteller, marked `step`, and the generic story when it has none", () => {
    const teller = (s: StoryStep) =>
      s.id === 'score' ? { headline: 'Scored 120 leads.' } : undefined;
    expect(tellStep(step({ output: {} }), CONTEXT, teller)).toEqual({
      headline: 'Scored 120 leads.',
      source: 'step',
    });
    expect(
      tellStep(step({ id: 'other', output: { a: 1 } }), CONTEXT, teller)
        ?.source,
    ).toBe('generic');
  });

  it('falls back to the generic story when the storyteller throws', () => {
    const teller = () => {
      throw new Error('bad data');
    };
    expect(tellStep(step({ output: { a: 1 } }), CONTEXT, teller)?.source).toBe(
      'generic',
    );
  });

  it('says a skipped step was not reached when the run stopped or failed', () => {
    expect(
      tellStep(step({ status: 'skipped' }), {
        ...CONTEXT,
        runStatus: 'stopped',
      })?.headline,
    ).toBe('Did not run: the run was stopped before it got here.');
    expect(
      tellStep(step({ status: 'skipped' }), { ...CONTEXT, runStatus: 'failed' })
        ?.headline,
    ).toBe('Did not run: the run failed before it got here.');
  });
});
