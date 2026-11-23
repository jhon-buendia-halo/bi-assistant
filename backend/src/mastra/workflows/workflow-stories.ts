/**
 * Which storyteller tells a workflow's steps (ui.md 4.4b, *Story*), and the
 * story of one step of a run: a shared step's own (Read images), else the
 * workflow's, else the generic one from the step's declared output schema
 * (agents.md 5.12). No framework import.
 */
import { answerBusinessQuestionStoryteller } from './answer-business-question.story';
import { readImagesStory } from './read-images.story';
import { ANSWER_BUSINESS_QUESTION_WORKFLOW_ID } from './analysis.steps';
import { CODE_WORKFLOWS } from './workflow-catalog';
import type { JsonSchema } from './workflow-contract';
import {
  tellStep,
  type StepStory,
  type StepStoryteller,
  type StoryContext,
  type StoryStep,
} from './workflow-story';

/** The workflows that tell their own steps, by workflow id. */
const STORYTELLERS: Readonly<Record<string, StepStoryteller>> = {
  [ANSWER_BUSINESS_QUESTION_WORKFLOW_ID]: answerBusinessQuestionStoryteller,
};

/** A catalogued step's declared output schema, if any. */
function outputSchemaOf(
  workflowId: string,
  stepId: string,
): JsonSchema | undefined {
  return CODE_WORKFLOWS.find(
    (workflow) => workflow.id === workflowId,
  )?.steps.find((step) => step.id === stepId)?.outputSchema;
}

/** The story of one step of a run of `workflowId`; undefined while it runs or waits. */
export function tellRunStep(
  workflowId: string,
  step: StoryStep,
  context: StoryContext,
): StepStory | undefined {
  const own = STORYTELLERS[workflowId];
  const teller: StepStoryteller = (s, c) => readImagesStory(s) ?? own?.(s, c);
  return tellStep(step, context, teller, outputSchemaOf(workflowId, step.id));
}
