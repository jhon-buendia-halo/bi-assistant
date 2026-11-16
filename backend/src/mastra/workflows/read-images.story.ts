/**
 * The story of Read images (ui.md 4.4b, *Story*; workflows R35), the
 * optional first step of Answer a Business Question, Assess Data Readiness
 * and Map a Dashboard to Data: how many reference images the Image Reader
 * described, or why it did not run. Pure: no framework import.
 */
import { plural, type StepStory, type StoryStep } from './workflow-story';

/** The step id every workflow gives Read images. */
export const READ_IMAGES_STEP_ID = 'read-images';

export function readImagesStory(
  step: StoryStep,
): Omit<StepStory, 'source'> | undefined {
  if (step.id !== READ_IMAGES_STEP_ID) return undefined;
  if (step.status === 'skipped') {
    return {
      headline: 'Skipped: the run was given no reference images.',
      brief: 'No images',
    };
  }
  const count = step.output?.['imageCount'];
  if (step.status !== 'success' || typeof count !== 'number' || count < 1) {
    return undefined;
  }
  return {
    headline: `Described ${plural(count, 'reference image')} for the team.`,
    brief: plural(count, 'image'),
  };
}
