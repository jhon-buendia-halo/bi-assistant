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
import { ANSWER_BUSINESS_QUESTION_STEP_SCHEMAS } from './analysis.schemas';
import {
  ANSWER_BUSINESS_QUESTION_RUNTIME_KEY,
  ANSWER_BUSINESS_QUESTION_WORKFLOW_ID,
  planOf,
  type AnswerBusinessQuestionRuntime,
} from './analysis.steps';
import { answerBusinessQuestionWorkflow } from './answer-business-question.workflow';
import { DATA_READINESS_ASSESSMENT_STEP_SCHEMAS } from './data-readiness-assessment.schemas';
import {
  DATA_READINESS_ASSESSMENT_RUNTIME_KEY,
  DATA_READINESS_ASSESSMENT_WORKFLOW_ID,
  type DataReadinessAssessmentRuntime,
} from './data-readiness-assessment.steps';
import { dataReadinessAssessmentWorkflow } from './data-readiness-assessment.workflow';
import { MAP_DASHBOARD_DATA_STEP_SCHEMAS } from './map-dashboard-data.schemas';
import {
  MAP_DASHBOARD_DATA_RUNTIME_KEY,
  MAP_DASHBOARD_DATA_WORKFLOW_ID,
  type MapDashboardDataRuntime,
} from './map-dashboard-data.steps';
import { mapDashboardDataWorkflow } from './map-dashboard-data.workflow';
import { CONSUMPTION_GAP_STEP_SCHEMAS } from './consumption-gap-analysis.schemas';
import {
  CONFIRM_REQUIREMENTS_OPTION,
  CONSUMPTION_GAP_RUNTIME_KEY,
  CONSUMPTION_GAP_WORKFLOW_ID,
  type ConsumptionGapRuntime,
} from './consumption-gap-analysis.steps';
import { consumptionGapAnalysisWorkflow } from './consumption-gap-analysis.workflow';
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
import { REVIEW_WEBSITE_STEP_SCHEMAS } from './review-website.schemas';
import {
  REVIEW_WEBSITE_RUNTIME_KEY,
  REVIEW_WEBSITE_WORKFLOW_ID,
  type ReviewWebsiteRuntime,
} from './review-website.steps';
import { reviewWebsiteWorkflow } from './review-website.workflow';
import { ORCHESTRATED_ANSWER_STEP_SCHEMAS } from './orchestrated-answer-michael.steps';
import {
  ORCHESTRATED_ANSWER_RUNTIME_KEY,
  ORCHESTRATED_ANSWER_WORKFLOW_ID,
  ORCHESTRATED_MICHAEL_WORKFLOW_ID,
  type OrchestratedAnswerRuntime,
} from './orchestrated-answer-michael.steps';
import { orchestratedAnswerWorkflow } from './orchestrated-answer-michael.workflow';
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
    orchestratedAnswerWorkflow as unknown as ContractFixture['workflow'],
  schemas: ORCHESTRATED_ANSWER_STEP_SCHEMAS,
  input: { question: 'How many matches?', datasets: ['World Cup'] },
  requestContext: () => {
    const context = new RequestContext();
    context.set(ORCHESTRATED_ANSWER_RUNTIME_KEY, {
      orchestrate: () =>
        Promise.resolve({ answer: 'There were 64 matches.', stopped: false }),
    } satisfies OrchestratedAnswerRuntime);
    return context;
  },
};

const FIXTURES: Record<string, ContractFixture> = {
  [ORCHESTRATED_ANSWER_WORKFLOW_ID]: ORCHESTRATED_FIXTURE,
  // Avery + Michael runs on the orchestrated engine (agents.md 5.23).
  [ORCHESTRATED_MICHAEL_WORKFLOW_ID]: ORCHESTRATED_FIXTURE,
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
        // The run builds a visual, so every step but Clarify runs: Ryan
        // designs one from the rows the query returned.
        buildsVisual: true,
        buildVisual: () =>
          Promise.resolve({
            visual: { visualId: 'v-1', title: 'Matches' },
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
        // The sample input has no images: Zoe never starts.
        startImageNotes: () => undefined,
        readsImages: () => false,
        imageNotes: () => Promise.reject(new Error('not used')),
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
  [RECREATE_DASHBOARD_WORKFLOW_ID]: {
    workflow:
      recreateDashboardWorkflow as unknown as ContractFixture['workflow'],
    schemas: RECREATE_DASHBOARD_STEP_SCHEMAS,
    input: { question: '', image: 'inputs/image.png' },
    requestContext: () => {
      const context = new RequestContext();
      // The stubbed run: a loaded image, the dashboard read from it and
      // the stored visual and artifact.
      context.set(RECREATE_DASHBOARD_RUNTIME_KEY, {
        loadImage: () =>
          Promise.resolve({ mediaType: 'image/png', sizeBytes: 1234 }),
        readDashboard: () =>
          Promise.resolve({
            blueprint: blueprintOf(
              SAMPLE_BLUEPRINT_REPLY,
            ) as DashboardBlueprint,
            stopped: false,
          }),
        saveDashboard: () =>
          Promise.resolve({
            visualId: 'v-1',
            artifactId: 'a-1',
            artifactName: 'Sales board',
          }),
      } satisfies RecreateDashboardRuntime);
      return context;
    },
  },
  [MAP_DASHBOARD_DATA_WORKFLOW_ID]: {
    workflow:
      mapDashboardDataWorkflow as unknown as ContractFixture['workflow'],
    schemas: MAP_DASHBOARD_DATA_STEP_SCHEMAS,
    input: { question: '', artifact: 'a-1', datasets: ['Shop'] },
    requestContext: () => {
      const context = new RequestContext();
      // The stubbed run: the saved dashboard, its mapping to the catalog
      // and the stored dashboard.
      context.set(MAP_DASHBOARD_DATA_RUNTIME_KEY, {
        loadDashboard: () =>
          Promise.resolve({
            name: 'Sales board',
            blueprint: blueprintOf(
              SAMPLE_BLUEPRINT_REPLY,
            ) as DashboardBlueprint,
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
        saveMappedDashboard: ({ bundle }) =>
          Promise.resolve({ visualId: 'v-1', title: bundle.title }),
      } satisfies MapDashboardDataRuntime);
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
        readDashboard: unused,
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
  [REVIEW_WEBSITE_WORKFLOW_ID]: {
    workflow: reviewWebsiteWorkflow as unknown as ContractFixture['workflow'],
    schemas: REVIEW_WEBSITE_STEP_SCHEMAS,
    input: {
      url: 'https://shop.example.com/',
      maxPages: 10,
      maxDepth: 2,
      mobile: true,
      tablet: false,
      laptop: true,
      desktop: false,
      exclude: '',
      needsSignIn: false,
      loginUrl: '',
      visualReview: true,
    },
    requestContext: () => {
      const context = new RequestContext();
      // The stubbed run: two pages found, one finding on one of them, and
      // the stored report.
      const unused = () => Promise.reject(new Error('not used'));
      context.set(REVIEW_WEBSITE_RUNTIME_KEY, {
        checkSignIn: unused,
        openSignIn: unused,
        finishSignIn: unused,
        discoverPages: () =>
          Promise.resolve({
            pages: [
              {
                url: 'https://shop.example.com/',
                finalUrl: 'https://shop.example.com/',
                status: 200,
                title: 'Shop',
                depth: 0,
                parent: null,
                group: '/',
                fingerprint: 'a1b2c3d4',
                error: null,
              },
              {
                url: 'https://shop.example.com/items/12',
                finalUrl: 'https://shop.example.com/items/12',
                status: 200,
                title: 'Item 12',
                depth: 1,
                parent: 'https://shop.example.com/',
                group: '/items/:id',
                fingerprint: 'e5f6a7b8',
                error: null,
              },
            ],
            skippedLinks: ['https://shop.example.com/logout'],
            capped: false,
            sessionLost: null,
          }),
        captureAndCheck: () =>
          Promise.resolve({
            captures: [
              {
                url: 'https://shop.example.com/items/12',
                screen: 'mobile',
                group: '/items/:id',
                screenshot: 'site-review/mobile/items-12.jpg',
                thumbnail: null,
                status: 200,
                error: null,
              },
            ],
            findings: [
              {
                id: 'f-00000001',
                rule: 'overflow-x',
                severity: 'major',
                title: 'Page scrolls sideways',
                screen: 'mobile',
                group: '/items/:id',
                selector: 'table.lines',
                measured: 'Content is 512 px wide in a 390 px screen',
                expected:
                  'No sideways scrolling at 390 px (WCAG 1.4.10 Reflow)',
                rect: { x: 0, y: 200, width: 512, height: 300 },
                helpUrl: null,
                pages: ['https://shop.example.com/items/12'],
                crop: null,
                source: 'measured',
                context: null,
              },
            ],
            // The item template's page, marked for Iris.
            reviewShots: [
              {
                template: '/items/:id',
                url: 'https://shop.example.com/items/12',
                screen: 'mobile',
                clean: 'site-review/review/mobile/items-12.clean.jpg',
                marked: 'site-review/review/mobile/items-12.marked.jpg',
                clip: { x: 0, y: 0, width: 390, height: 1688 },
                marks: [
                  {
                    n: 1,
                    selector: 'button.buy',
                    tag: 'button',
                    text: 'Buy',
                    rect: { x: 16, y: 300, width: 80, height: 32 },
                    crop: null,
                  },
                ],
              },
            ],
          }),
        reviewTemplate: () =>
          Promise.resolve({
            review: {
              findings: [
                {
                  mark: 1,
                  screen: 'mobile',
                  severity: 'minor',
                  category: 'consistency',
                  title: 'Buy button differs from the home page buttons',
                  observed: 'Square corners here, rounded elsewhere.',
                  suggestion: 'Use the shared button style.',
                },
              ],
              summary: 'Clean layout; one inconsistent button.',
            },
            stopped: false,
          }),
        progress: () => undefined,
        loadReportImages: () => Promise.resolve({}),
        saveReport: () =>
          Promise.resolve({
            visualId: 'v-1',
            reportFile: 'site-review/findings.json',
          }),
        showAnswer: () => Promise.resolve(),
      } satisfies ReviewWebsiteRuntime);
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
      // The clear path: every step but Clarify and Read images, whose
      // branches are not taken (the sample input has no images), and the
      // follow-up branch (a first run has no earlier result).
      const ran = source.steps.filter(
        (step) =>
          ![
            'clarify',
            'read-images',
            'page-result',
            'page-answer',
            'confirm-review',
          ].includes(step.id),
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
