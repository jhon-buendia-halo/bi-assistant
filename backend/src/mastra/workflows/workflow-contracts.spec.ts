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
import { ANSWER_BUSINESS_QUESTION_STEP_SCHEMAS } from './answer-business-question.schemas';
import {
  ANSWER_BUSINESS_QUESTION_RUNTIME_KEY,
  ANSWER_BUSINESS_QUESTION_WORKFLOW_ID,
  planOf,
  type AnswerBusinessQuestionRuntime,
} from './answer-business-question.steps';
import { answerBusinessQuestionWorkflow } from './answer-business-question.workflow';
import { DATA_READINESS_ASSESSMENT_STEP_SCHEMAS } from './data-readiness-assessment.schemas';
import {
  DATA_READINESS_ASSESSMENT_RUNTIME_KEY,
  DATA_READINESS_ASSESSMENT_WORKFLOW_ID,
  type DataReadinessAssessmentRuntime,
} from './data-readiness-assessment.steps';
import { dataReadinessAssessmentWorkflow } from './data-readiness-assessment.workflow';
import { RECREATE_DASHBOARD_STEP_SCHEMAS } from './recreate-dashboard.schemas';
import {
  SAMPLE_BLUEPRINT_REPLY,
  SAMPLE_MAPPING_REPLY,
} from './recreate-dashboard.sample';
import {
  RECREATE_DASHBOARD_RUNTIME_KEY,
  RECREATE_DASHBOARD_WORKFLOW_ID,
  blueprintOf,
  mappingOf,
  type DashboardBlueprint,
  type RecreateDashboardRuntime,
} from './recreate-dashboard.steps';
import { recreateDashboardWorkflow } from './recreate-dashboard.workflow';
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
  [ANSWER_BUSINESS_QUESTION_WORKFLOW_ID]: {
    workflow:
      answerBusinessQuestionWorkflow as unknown as ContractFixture['workflow'],
    schemas: ANSWER_BUSINESS_QUESTION_STEP_SCHEMAS,
    input: { question: 'How many matches?', datasets: ['World Cup'] },
    requestContext: () => {
      const context = new RequestContext();
      // The stubbed model: a plan, one SQL call that returned 4 rows, an
      // answer.
      context.set(ANSWER_BUSINESS_QUESTION_RUNTIME_KEY, {
        plan: ({ question }) =>
          Promise.resolve({ plan: planOf({}, question), stopped: false }),
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
        // The run asks for the data-quality check, so every step but
        // Clarify runs: Sarah finds one issue on the table it read.
        checksDataQuality: true,
        checkDataQuality: () =>
          Promise.resolve({
            findings: [
              {
                check: 'Data quality: public.matches.id (uniqueness, medium)',
                passed: false,
                detail: 'id has 2 duplicates. Matches may be counted twice.',
              },
            ],
            dataQuality: {
              tables: ['wc.public.matches'],
              reportIds: ['r-1'],
              findingCount: 1,
              issues: 1,
              skipped: [],
            },
            stopped: false,
          }),
        writeAnswer: () =>
          Promise.resolve({
            answer: { headline: '4 matches.', answer: '4 matches.' },
            stopped: false,
          }),
      } satisfies AnswerBusinessQuestionRuntime);
      return context;
    },
  },
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
        explain: () =>
          Promise.resolve({ answer: 'Managed (84).', stopped: false }),
      } satisfies DataReadinessAssessmentRuntime);
      return context;
    },
  },
  [RECREATE_DASHBOARD_WORKFLOW_ID]: {
    workflow:
      recreateDashboardWorkflow as unknown as ContractFixture['workflow'],
    schemas: RECREATE_DASHBOARD_STEP_SCHEMAS,
    input: { question: '', image: 'inputs/image.png', datasets: ['Shop'] },
    requestContext: () => {
      const context = new RequestContext();
      // The stubbed run: a loaded image, the dashboard read from it, its
      // mapping to the catalog and the stored dashboard.
      context.set(RECREATE_DASHBOARD_RUNTIME_KEY, {
        loadImage: () => Promise.resolve(),
        loadArtifact: () =>
          Promise.resolve(
            blueprintOf(SAMPLE_BLUEPRINT_REPLY) as DashboardBlueprint,
          ),
        readDashboard: () =>
          Promise.resolve({
            blueprint: blueprintOf(
              SAMPLE_BLUEPRINT_REPLY,
            ) as DashboardBlueprint,
            stopped: false,
          }),
        mapData: ({ blueprint, catalog, columns }) =>
          Promise.resolve({
            mapping: mappingOf(
              SAMPLE_MAPPING_REPLY,
              blueprint,
              catalog,
              columns,
            ),
            stopped: false,
          }),
        saveDashboard: ({ bundle }) =>
          Promise.resolve({ visualId: 'v-1', title: bundle.title }),
      } satisfies RecreateDashboardRuntime);
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
