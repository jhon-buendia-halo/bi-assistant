import { imageNotesBlock } from '../../../mastra/workflows/read-images.steps';

/**
 * A model step's input as the turn hands it to its model call, with Read
 * images' notes (agents.md 2.15, 5.11, 5.18) only when the run has some: a
 * blank or absent `imageNotes` is dropped, so a run without images makes
 * the call it made before Read images existed.
 */
export function withImageNotes<T extends { imageNotes?: string }>(
  input: T,
): Omit<T, 'imageNotes'> & { imageNotes?: string } {
  const { imageNotes, ...rest } = input;
  return imageNotesBlock(imageNotes) ? { ...rest, imageNotes } : rest;
}
