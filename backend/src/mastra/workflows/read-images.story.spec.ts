import { readImagesStory } from './read-images.story';
import { tellRunStep } from './workflow-stories';

describe('the Read images story (ui.md 4.4b, Story; workflows R35)', () => {
  const step = (status: string, output?: Record<string, unknown>) => ({
    id: 'read-images',
    title: 'Read images',
    status,
    ...(output ? { output } : {}),
  });

  it('counts the images it described, and says a skip means no images', () => {
    expect(
      readImagesStory(step('success', { imageNotes: '## …', imageCount: 2 })),
    ).toEqual({
      headline: 'Described 2 reference images for the team.',
      brief: '2 images',
    });
    expect(readImagesStory(step('skipped'))).toEqual({
      headline: 'Skipped: the run was given no reference images.',
      brief: 'No images',
    });
  });

  it('leaves a stopped reading and any other step alone', () => {
    expect(
      readImagesStory(step('success', { imageNotes: '', imageCount: 0 })),
    ).toBeUndefined();
    expect(
      readImagesStory({ id: 'plan', title: 'Plan', status: 'skipped' }),
    ).toBeUndefined();
  });

  it('tells Read images in every workflow that has it', () => {
    for (const workflowId of [
      'answer-business-question',
      'data-readiness-assessment',
    ]) {
      expect(
        tellRunStep(workflowId, step('skipped'), { runInput: {}, steps: [] })
          ?.brief,
      ).toBe('No images');
    }
  });
});
