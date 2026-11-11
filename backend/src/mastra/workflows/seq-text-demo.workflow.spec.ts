// The real engine pulls in ESM-only packages Jest cannot require; the stub
// runs `.then()` steps in order with the engine's step events (see it).
jest.mock('@mastra/core/workflows', () =>
  jest.requireActual<typeof import('../testing/workflows.stub')>(
    '../testing/workflows.stub',
  ),
);

import { readFileSync } from 'fs';
import { join } from 'path';
import { seqTextDemoWorkflow } from './seq-text-demo.workflow';
import {
  SEQ_TEXT_DEMO_STEPS,
  SEQ_TEXT_DEMO_WORKFLOW_ID,
} from './seq-text-demo.steps';

interface StubWorkflow {
  id: string;
  options?: { shouldPersistSnapshot?: () => boolean };
  steps: {
    id: string;
    description?: string;
    inputSchema: { shape: Record<string, unknown> };
    outputSchema: { shape: Record<string, unknown> };
  }[];
  createRun(): Promise<{
    stream(args: { inputData: unknown }): {
      fullStream: AsyncIterable<{
        type: string;
        payload?: { id?: string; status?: string };
      }>;
      result: Promise<{ status: string; result?: unknown; error?: unknown }>;
    };
  }>;
}

const workflow = seqTextDemoWorkflow as unknown as StubWorkflow;

async function run(text: string) {
  const output = (await workflow.createRun()).stream({ inputData: { text } });
  const events: string[] = [];
  for await (const event of output.fullStream) {
    if (event.payload?.id) {
      events.push(`${event.payload.id}:${event.payload.status}`);
    }
  }
  return { events, result: await output.result };
}

describe('seq-text-demo workflow (agents.md 5.13; plan 9.2)', () => {
  it('runs the three steps in order, with their titles, and persists no snapshot', () => {
    expect(workflow.id).toBe(SEQ_TEXT_DEMO_WORKFLOW_ID);
    expect(workflow.steps.map((s) => [s.id, s.description])).toEqual([
      ['clean-text', 'Clean text'],
      ['count-words', 'Count words'],
      ['format-result', 'Format result'],
    ]);
    expect(workflow.options?.shouldPersistSnapshot?.()).toBe(false);
  });

  // The workflow page draws the catalogue: its field names must be the
  // built steps' own schema fields, in order.
  it("matches the step catalogue's ids and input and output fields", () => {
    expect(
      workflow.steps.map((step) => ({
        id: step.id,
        input: Object.keys(step.inputSchema.shape),
        output: Object.keys(step.outputSchema.shape),
      })),
    ).toEqual(
      SEQ_TEXT_DEMO_STEPS.map((step) => ({
        id: step.id,
        input: [...step.input],
        output: [...step.output],
      })),
    );
  });

  it('cleans, counts and formats a text', async () => {
    const { events, result } = await run('  Hello   workflow   world  ');
    expect(events).toEqual([
      'clean-text:running',
      'clean-text:success',
      'count-words:running',
      'count-words:success',
      'format-result:running',
      'format-result:success',
    ]);
    expect(result).toEqual({
      status: 'success',
      result: { summary: '3 words, 20 characters: "Hello workflow world"' },
    });
  });

  it('fails Clean text on an empty text and runs nothing after it', async () => {
    const { events, result } = await run('   ');
    expect(events).toEqual(['clean-text:running', 'clean-text:failed']);
    expect(result.status).toBe('failed');
    expect((result.error as Error).message).toBe('The text is empty');
  });

  it('is registered on the Mastra instance as seq-text-demo', () => {
    const source = readFileSync(join(__dirname, '..', 'index.ts'), 'utf8');
    expect(source).toMatch(/'seq-text-demo':\s*seqTextDemoWorkflow/);
  });
});
