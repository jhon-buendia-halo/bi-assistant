// The real engine pulls in ESM-only packages Jest cannot require; the stub
// runs `.then()` steps in order with the engine's step events (see it).
jest.mock('@mastra/core/workflows', () =>
  jest.requireActual<typeof import('../testing/workflows.stub')>(
    '../testing/workflows.stub',
  ),
);
jest.mock('../tool-services', () => ({
  getDatasetToolServices: () => ({
    getDatasets: (names: string[]) =>
      Promise.resolve(
        names.map((name) => ({
          name,
          datasourceId: 'ds-pg',
          datasourceKind: 'postgres',
          tables: ['wc.public.matches'],
          entities: [{ key: 'wc.public.matches', columns: [{ name: 'id' }] }],
        })),
      ),
  }),
}));

import { RequestContext } from '@mastra/core/request-context';
import type { z } from 'zod';
import { QTI_V2_TURN_STEP_SCHEMAS } from './qti-v2-turn.schemas';
import {
  QTI_V2_TURN_RUNTIME_KEY,
  QTI_V2_TURN_WORKFLOW_ID,
  planOf,
  type QtiV2TurnRuntime,
} from './qti-v2-turn.steps';
import { qtiV2TurnWorkflow } from './qti-v2-turn.workflow';
import { CODE_WORKFLOWS } from './workflow-catalog';

interface StubRun {
  stream(args: { inputData: unknown; requestContext: unknown }): {
    fullStream: AsyncIterable<{
      type: string;
      payload?: { id?: string; status?: string; output?: unknown };
    }>;
    result: Promise<{ status: string; result?: unknown; error?: unknown }>;
  };
}

/** How each catalogued workflow is run with a stubbed model, and its Zod schemas. */
interface ContractFixture {
  workflow: { createRun(): Promise<StubRun> };
  schemas: Record<string, { input: z.ZodType; output: z.ZodType }>;
  input: Record<string, unknown>;
  requestContext(): RequestContext;
}

const FIXTURES: Record<string, ContractFixture> = {
  [QTI_V2_TURN_WORKFLOW_ID]: {
    workflow: qtiV2TurnWorkflow as unknown as ContractFixture['workflow'],
    schemas: QTI_V2_TURN_STEP_SCHEMAS,
    input: { question: 'How many matches?', datasets: ['World Cup'] },
    requestContext: () => {
      const context = new RequestContext();
      // The stubbed model: a plan, one SQL call that returned 4 rows, an
      // answer.
      context.set(QTI_V2_TURN_RUNTIME_KEY, {
        plan: ({ question }) =>
          Promise.resolve({ plan: planOf({}, question), stopped: false }),
        clarify: () => Promise.resolve(),
        analyse: () =>
          Promise.resolve({
            calls: [{ tool: 'run_readonly_sql', rowCount: 4, failed: false }],
            queries: [
              {
                sql: 'SELECT * FROM wc.public.matches LIMIT 4',
                rows: [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }],
                rowCount: 4,
                truncated: false,
              },
            ],
            text: '',
            stopped: false,
          }),
        writeAnswer: () =>
          Promise.resolve({
            answer: { headline: '4 matches.', answer: '4 matches.' },
            stopped: false,
          }),
      } satisfies QtiV2TurnRuntime);
      return context;
    },
  },
};

describe('every catalogued workflow keeps its data contract at run time (agents.md 5.12)', () => {
  it.each(CODE_WORKFLOWS.map((source) => [source.id, source]))(
    '%s runs end to end on a sample input, every step output parsing with its schema',
    async (id, source) => {
      const fixture = FIXTURES[id];
      expect(fixture).toBeDefined();
      const output = (await fixture.workflow.createRun()).stream({
        inputData: fixture.input,
        requestContext: fixture.requestContext(),
      });
      const outputs = new Map<string, unknown>();
      for await (const event of output.fullStream) {
        // A nested workflow's step is `<workflow>.<step>`: the step's id is
        // the last segment; the nested workflows are not catalogue steps.
        const id = event.payload?.id?.split('.').at(-1);
        if (
          event.type === 'workflow-step-result' &&
          id &&
          fixture.schemas[id] &&
          event.payload?.status === 'success'
        ) {
          outputs.set(id, event.payload.output);
        }
      }
      expect((await output.result).status).toBe('success');
      // The clear path: every step but Clarify, whose branch is not taken.
      const ran = source.steps.filter((step) => step.id !== 'clarify');
      expect([...outputs.keys()]).toEqual(ran.map((step) => step.id));
      for (const step of ran) {
        const parsed = fixture.schemas[step.id].output.safeParse(
          outputs.get(step.id),
        );
        expect({ step: step.id, ok: parsed.success }).toEqual({
          step: step.id,
          ok: true,
        });
      }
    },
  );

  // Any change to a workflow's contract is a reviewed diff: its input
  // fields, every step's JSON Schemas and the hash all live in the snapshot.
  it.each(CODE_WORKFLOWS.map((source) => [source.id, source]))(
    "%s's contract (JSON Schemas and hash) is the reviewed one",
    (_id, source) => {
      expect({
        contractHash: source.contractHash,
        input: source.input.map(({ name, type, required }) => ({
          name,
          type,
          required,
        })),
        steps: source.steps.map((step) => ({
          id: step.id,
          inputSchema: step.inputSchema,
          outputSchema: step.outputSchema,
        })),
        edges: source.edges,
      }).toMatchSnapshot();
    },
  );
});
