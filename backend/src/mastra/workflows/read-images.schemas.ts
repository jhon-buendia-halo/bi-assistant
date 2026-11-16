/**
 * The Zod schemas of Read images, the optional first step of Answer a
 * Business Question, Assess Data Readiness and Map a Dashboard to Data
 * (agents.md 2.15; workflows R35), and of the Image Reader's reply. Zod
 * only, no framework import: the Mastra step (./read-images.workflow.ts),
 * its catalogue entry (./read-images.steps.ts) and the model call
 * (./read-images.agents.ts) all read them.
 */
import { z } from 'zod';

/** What the step reads: the question and the run's stored image paths. */
export const readImagesInputSchema = z.object({
  question: z.string().describe("The user's question."),
  images: z
    .array(z.string())
    .default([])
    .describe(
      "The paths of the run's reference images in its workspace (inputs/images/<n>.<ext>).",
    ),
});

/**
 * What the step passes on: the notes (Markdown, `''` when the run has no
 * image or was stopped) and how many images they describe.
 */
export const readImagesOutputSchema = z.object({
  imageNotes: z
    .string()
    .describe(
      "The Image Reader's notes on the reference images, as Markdown; empty when there are none.",
    ),
  imageCount: z.number().describe('How many images the notes describe.'),
});

/** The step's declared schemas (agents.md 5.12). */
export const READ_IMAGES_STEP_SCHEMAS = {
  input: readImagesInputSchema,
  output: readImagesOutputSchema,
} as const;

/** What an image is, as the Image Reader names it. */
export const IMAGE_KINDS = [
  'chart',
  'table',
  'dashboard',
  'report',
  'other',
] as const;

/** One image as the Image Reader describes it (agents.md 2.15). */
export const imageDescriptionSchema = z.object({
  index: z.number().describe('The image number, from 1, in the order given.'),
  kind: z.enum(IMAGE_KINDS).describe('What the image is.'),
  title: z.string().describe('Its title as shown, or a short fitting one.'),
  shows: z.string().describe('What it shows, in one to three sentences.'),
  figures: z
    .array(z.string())
    .describe('The figures and labels it carries, one per item.'),
  text: z.string().describe('Any other visible text worth keeping, or "".'),
});

/** The Image Reader's reply: one description per image, in order. */
export const imageDescriptionsSchema = z.object({
  images: z.array(imageDescriptionSchema),
});
