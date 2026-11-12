import { createStep, createWorkflow } from '@mastra/core/workflows';
import { z } from 'zod';
import {
  SEQ_TEXT_DEMO_STEPS,
  SEQ_TEXT_DEMO_WORKFLOW_ID,
  cleanText,
  countWords,
  formatResult,
} from './seq-text-demo.steps';

// The sequential test workflow (agents.md 5.13; plan 9.2): a run workflow of
// three code steps and no LLM. It runs once on its typed input
// (`POST /workflows/seq-text-demo/runs`, api.md 118) and nothing is stored.

const [CLEAN, COUNT, FORMAT] = SEQ_TEXT_DEMO_STEPS;

const textOnly = z.object({ text: z.string() });

const counted = z.object({
  text: z.string(),
  words: z.number(),
  characters: z.number(),
});

const summary = z.object({ summary: z.string() });

const cleanTextStep = createStep({
  id: CLEAN.id,
  description: CLEAN.title,
  inputSchema: textOnly,
  outputSchema: textOnly,
  execute: async ({ inputData }) =>
    Promise.resolve({ text: cleanText(inputData.text) }),
});

const countWordsStep = createStep({
  id: COUNT.id,
  description: COUNT.title,
  inputSchema: textOnly,
  outputSchema: counted,
  execute: async ({ inputData }) =>
    Promise.resolve({ text: inputData.text, ...countWords(inputData.text) }),
});

const formatResultStep = createStep({
  id: FORMAT.id,
  description: FORMAT.title,
  inputSchema: counted,
  outputSchema: summary,
  execute: async ({ inputData }) =>
    Promise.resolve({ summary: formatResult(inputData) }),
});

export const seqTextDemoWorkflow = createWorkflow({
  id: SEQ_TEXT_DEMO_WORKFLOW_ID,
  description:
    'A three-step example: cleans a text, counts its words and characters, and formats the result. No LLM.',
  inputSchema: textOnly,
  outputSchema: summary,
  // A run's result is returned to the caller and never stored.
  options: { shouldPersistSnapshot: () => false },
})
  .then(cleanTextStep)
  .then(countWordsStep)
  .then(formatResultStep)
  .commit();
