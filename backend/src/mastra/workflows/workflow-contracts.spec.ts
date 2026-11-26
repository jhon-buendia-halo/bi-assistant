import { edgeFlow } from './workflow-contract';
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
import { DATA_READINESS_ASSESSMENT_STEP_SCHEMAS } from './data-readiness-assessment.schemas';
import {
  DATA_READINESS_ASSESSMENT_RUNTIME_KEY,
  DATA_READINESS_ASSESSMENT_WORKFLOW_ID,
  type DataReadinessAssessmentRuntime,
} from './data-readiness-assessment.steps';
import { dataReadinessAssessmentWorkflow } from './data-readiness-assessment.workflow';
import { CONSUMPTION_GAP_STEP_SCHEMAS } from './consumption-gap-analysis.schemas';
import {
  CONFIRM_REQUIREMENTS_OPTION,
  CONSUMPTION_GAP_RUNTIME_KEY,
  CONSUMPTION_GAP_WORKFLOW_ID,
  type ConsumptionGapRuntime,
} from './consumption-gap-analysis.steps';
import { consumptionGapAnalysisWorkflow } from './consumption-gap-analysis.workflow';
import { ORCHESTRATED_MICHAEL_STEP_SCHEMAS } from './orchestrated-answer-michael.steps';
import { ORCHESTRATED_MICHAEL_WORKFLOW_ID } from './orchestrated-answer-michael.steps';
import {
  CONVERSATION_TURN_RUNTIME_KEY,
  type ConversationTurnRuntime,
} from './conversation-turn.steps';
import { orchestratedMichaelWorkflow } from './orchestrated-answer-michael.workflow';
import { CODE_WORKFLOWS } from './workflow-catalog';

interface StubStream {
  fullStream: AsyncIterable<{
    type: string;
    payload?: { id?: string; status?: string; output?: unknown };
  }>;
  result: Promise<{
    status: string;
    result?: unknown;
    error?: unknown;
    suspended?: string[][];
  }>;
}

interface StubRun {
  stream(args: { inputData: unknown; requestContext: unknown }): StubStream;
  resumeStream(args: {
    step: string[];
    resumeData: unknown;
    requestContext: unknown;
  }): StubStream;
}

/** How each catalogued workflow is run with a stubbed model, and its Zod schemas. */
interface ContractFixture {
  workflow: { createRun(): Promise<StubRun> };
  schemas: Record<string, { input: z.ZodType; output: z.ZodType }>;
  input: Record<string, unknown>;
  requestContext(): RequestContext;
  /** The user's answer when the run waits on its clear path (Confirm requirements). */
  answer?: string;
}

/** The World Cup sample's Normalized and Consumption entities (plan m1-30). */
const GAP_DATASET = {
  dataset: 'World Cup',
  datasourceId: 'ds-pg',
  datasourceKind: 'postgres',
  schemas: [
    { key: 'world_cup.wc_normalized', layer: 'normalized' },
    { key: 'world_cup.wc_consumption', layer: 'consumption' },
  ],
  entities: [
    {
      key: 'world_cup.wc_normalized.goals',
      columns: [
        { name: 'match_id', type: 'integer' },
        { name: 'player_name', type: 'text' },
        { name: 'is_penalty', type: 'boolean' },
      ],
    },
    {
      key: 'world_cup.wc_consumption.agg_player_goals',
      columns: [
        { name: 'tournament_year', type: 'integer' },
        { name: 'player', type: 'text' },
        { name: 'goals', type: 'integer' },
      ],
    },
  ],
};

const ORCHESTRATED_FIXTURE: ContractFixture = {
  workflow:
    orchestratedMichaelWorkflow as unknown as ContractFixture['workflow'],
  schemas: ORCHESTRATED_MICHAEL_STEP_SCHEMAS,
  input: { question: 'How many matches?', datasets: ['World Cup'] },
  requestContext: () => {
    const context = new RequestContext();
    context.set(CONVERSATION_TURN_RUNTIME_KEY, {
      turn: () =>
        Promise.resolve({ answer: 'There were 64 matches.', stopped: false }),
    } satisfies ConversationTurnRuntime);
    return context;
  },
};

const FIXTURES: Record<string, ContractFixture> = {
  [ORCHESTRATED_MICHAEL_WORKFLOW_ID]: ORCHESTRATED_FIXTURE,
  [DATA_READINESS_ASSESSMENT_WORKFLOW_ID]: {
    workflow:
      dataReadinessAssessmentWorkflow as unknown as ContractFixture['workflow'],
    schemas: DATA_READINESS_ASSESSMENT_STEP_SCHEMAS,
    input: { question: '', dataset: 'World Cup' },
    requestContext: () => {
      const context = new RequestContext();
      // The stubbed assessment: a profiled, scored and stored report, and
      // the agent's explanation.
      context.set(DATA_READINESS_ASSESSMENT_RUNTIME_KEY, {
        resolve: ({ dataset }) =>
          Promise.resolve({
            dataset,
            datasourceName: 'World Cup DB',
            datasourceKind: 'postgres',
            tableCount: 2,
          }),
        profile: () =>
          Promise.resolve({
            entityCount: 2,
            relationshipCount: 1,
            notProfiledCount: 0,
            stopped: false,
          }),
        score: () => ({
          overallScore: 84,
          maturity: 'Managed',
          findingCount: 1,
          dimensionScores: [
            {
              dimension: 'completeness',
              score: 90,
              assessed: true,
              findingCount: 1,
            },
          ],
        }),
        save: () => Promise.resolve({ reportId: 'r-1' }),
        startFindingRows: () => undefined,
        findingRows: () =>
          Promise.resolve({
            sourceCount: 1,
            failedSourceCount: 0,
            stopped: false,
          }),
        explain: () =>
          Promise.resolve({ answer: 'Managed (84).', stopped: false }),
      } satisfies DataReadinessAssessmentRuntime);
      return context;
    },
  },
  [CONSUMPTION_GAP_WORKFLOW_ID]: {
    workflow:
      consumptionGapAnalysisWorkflow as unknown as ContractFixture['workflow'],
    schemas: CONSUMPTION_GAP_STEP_SCHEMAS,
    input: {
      question: 'Who scored the most goals in each World Cup?',
      datasets: ['World Cup'],
      artifact: '',
    },
    // The requirements are confirmed as they are.
    answer: CONFIRM_REQUIREMENTS_OPTION,
    requestContext: () => {
      const context = new RequestContext();
      const unused = () => Promise.reject(new Error('not used'));
      const failedAll = (queries: { id: string }[]) => ({
        results: queries.map((query) => ({
          id: query.id,
          columns: [],
          rows: [],
          error: 'not run in this test',
        })),
        stopped: false,
      });
      // The lineage checks Load layer catalogs started, for Infer lineage.
      let lineage: { id: string }[] = [];
      // The stubbed run: two tagged schemas, every query failed (a failed
      // query is a result, never a failed run), one question requirement
      // mapped to a Consumption column, no fix, and the stored report.
      context.set(CONSUMPTION_GAP_RUNTIME_KEY, {
        loadDashboard: unused,
        datasetLayers: () => Promise.resolve([GAP_DATASET]),
        runQueries: ({ queries }) => Promise.resolve(failedAll(queries)),
        startLineage: ({ queries }) => {
          lineage = queries;
        },
        takeLineage: () => Promise.resolve(failedAll(lineage)),
        deriveRequirements: ({ questions }) =>
          Promise.resolve({
            requirements: questions.map((title, index) => ({
              id: `Q${index + 1}`,
              kind: 'question' as const,
              title,
              source: `Question ${index + 1}`,
              dashboardId: '',
              ref: '',
              fields: [
                {
                  name: 'goals',
                  role: 'measure' as const,
                  aggregation: 'sum',
                  description: 'Goals scored.',
                },
              ],
              grain: 'player × tournament',
              periodValues: [],
            })),
            stopped: false,
          }),
        reviseRequirements: unused,
        mapRequirements: ({ requirements }) =>
          Promise.resolve({
            mappings: requirements.flatMap((requirement) =>
              requirement.fields.map((field) => ({
                requirementId: requirement.id,
                field: field.name,
                sources: [
                  {
                    layer: 'consumption' as const,
                    entity: 'world_cup.wc_consumption.agg_player_goals',
                    column: 'goals',
                    expression: '',
                  },
                ],
                note: '',
              })),
            ),
            stopped: false,
          }),
        recommendFixes: () => Promise.resolve({ fixes: [], stopped: false }),
        saveReport: ({ title }) => Promise.resolve({ visualId: 'v-1', title }),
      } satisfies ConsumptionGapRuntime);
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
      const engineRun = await fixture.workflow.createRun();
      const requestContext = fixture.requestContext();
      let output = engineRun.stream({
        inputData: fixture.input,
        requestContext,
      });
      const outputs = new Map<string, unknown>();
      const drain = async () => {
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
        return output.result;
      };
      let result = await drain();
      // A run that waits on its clear path goes on with the fixture's answer.
      if (result.status === 'suspended' && fixture.answer !== undefined) {
        output = engineRun.resumeStream({
          step: result.suspended![0],
          resumeData: { answer: fixture.answer },
          requestContext,
        });
        result = await drain();
      }
      expect(result.status).toBe('success');
      // The clear path: every step but Clarify, whose branch is not taken,
      // and the follow-up branch (a first run has no earlier result).
      const ran = source.steps.filter(
        (step) => !['clarify', 'page-result', 'page-answer'].includes(step.id),
      );
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
        // A note is prose about the path (workflows R42), not the contract.
        edges: source.edges.map(edgeFlow),
      }).toMatchSnapshot();
    },
  );

  // Answer a Business Question (Avery + Michael) keeps the contract it had
  // before the two other Answer a Business Question workflows were removed.
  it("orchestrated-answer-michael's contract hash is the base one", () => {
    expect(
      CODE_WORKFLOWS.find(
        (source) => source.id === 'orchestrated-answer-michael',
      )?.contractHash,
    ).toBe('2217391f68ac');
  });
});
