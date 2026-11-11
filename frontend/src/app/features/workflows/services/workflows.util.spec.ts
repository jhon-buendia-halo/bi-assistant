import { WorkflowSummary } from '../models/workflow.model';
import {
  buildWorkflowSections,
  composerCreateBody,
  composerWorkflowId,
  workflowKindLabel,
  workflowStartAction,
  workflowUsesLabel,
  workflowsEmptyMessage,
} from './workflows.util';

function workflow(
  id: string,
  name: string,
  overrides: Partial<WorkflowSummary> = {},
): WorkflowSummary {
  return {
    id,
    name,
    description: `${name} description`,
    kind: 'agent',
    owner: 'Official',
    agents: [{ key: id.replace(/^agent:/, ''), name }],
    stepCount: 1,
    bar: 'agent',
    picksDatasets: false,
    datasets: [],
    missingDatasets: [],
    starterQuestions: [],
    ...overrides,
  };
}

/** The catalogue as `GET /workflows` orders it (workflows R1). */
const CATALOGUE: WorkflowSummary[] = [
  workflow('agent:assistant', 'Assistant', {
    agents: [{ key: 'assistant', name: 'Questions to Insights Assistant' }],
    picksDatasets: true,
  }),
  workflow('qti-v2-turn', 'Questions to Insights v2', {
    kind: 'code',
    stepCount: 4,
    bar: 'steps',
    agents: [{ key: 'assistant-v2', name: 'Questions to Insights v2' }],
    picksDatasets: true,
  }),
  workflow('agent:data-readiness', 'Data Readiness Agent'),
  workflow('agent:rfp', 'RFP Builder', {
    chatRequirement:
      'Load the "Intellify RFP API" sample in Settings → Testing Data first',
  }),
  workflow('agent:u2', 'Zeta analyst', { owner: 'You' }),
  workflow('agent:u1', 'Alpha analyst', {
    owner: 'You',
    description: 'Answers about the health plan',
  }),
];

describe('workflows.util', () => {
  describe('buildWorkflowSections', () => {
    it('groups Official then Mine and keeps the catalogue order in each (R5)', () => {
      const sections = buildWorkflowSections(CATALOGUE, '');
      expect(sections.map((section) => section.id)).toEqual([
        'official',
        'mine',
      ]);
      expect(sections.map((section) => section.label)).toEqual([
        'Official',
        'Mine',
      ]);
      expect(sections[0].workflows.map((w) => w.id)).toEqual([
        'agent:assistant',
        'qti-v2-turn',
        'agent:data-readiness',
        'agent:rfp',
      ]);
      // The server orders user workflows by name; the list never re-sorts.
      expect(sections[1].workflows.map((w) => w.id)).toEqual([
        'agent:u2',
        'agent:u1',
      ]);
    });

    it('omits Mine when there are no user workflows', () => {
      const sections = buildWorkflowSections(
        CATALOGUE.filter((w) => w.owner === 'Official'),
        '',
      );
      expect(sections.map((section) => section.id)).toEqual(['official']);
    });

    it('filters by name or description, ignoring case and spaces around', () => {
      expect(
        buildWorkflowSections(CATALOGUE, '  rfp ').flatMap((section) =>
          section.workflows.map((w) => w.id),
        ),
      ).toEqual(['agent:rfp']);
      const byDescription = buildWorkflowSections(CATALOGUE, 'HEALTH PLAN');
      expect(byDescription.map((section) => section.id)).toEqual(['mine']);
      expect(byDescription[0].workflows.map((w) => w.id)).toEqual([
        'agent:u1',
      ]);
    });

    it('returns no section when nothing matches', () => {
      expect(buildWorkflowSections(CATALOGUE, 'zzz')).toEqual([]);
    });
  });

  describe('workflowsEmptyMessage', () => {
    it('names the query when nothing matches', () => {
      expect(workflowsEmptyMessage(' zzz ', [])).toBe(
        'No workflows match "zzz"',
      );
    });

    it('is null while a section shows', () => {
      expect(
        workflowsEmptyMessage('rfp', buildWorkflowSections(CATALOGUE, 'rfp')),
      ).toBeNull();
    });
  });

  describe('labels', () => {
    it('reads "<n> steps" for a code-defined workflow and "One step" otherwise', () => {
      expect(workflowKindLabel(CATALOGUE[1])).toBe('4 steps');
      expect(workflowKindLabel(CATALOGUE[0])).toBe('One step');
    });

    it('lists the agents the steps call', () => {
      expect(workflowUsesLabel(CATALOGUE[0])).toBe(
        'Uses Questions to Insights Assistant',
      );
      expect(
        workflowUsesLabel(
          workflow('x', 'X', {
            agents: [
              { key: 'a', name: 'A' },
              { key: 'b', name: 'B' },
            ],
          }),
        ),
      ).toBe('Uses A, B');
    });
  });

  describe('workflowStartAction (R6)', () => {
    it('opens the composer on the assistant workflow for the assistant workflow', () => {
      expect(workflowStartAction(CATALOGUE[0])).toEqual({
        kind: 'composer',
        workflowId: 'agent:assistant',
      });
    });

    it('opens the composer preselected to a dataset-picking code workflow', () => {
      expect(workflowStartAction(CATALOGUE[1])).toEqual({
        kind: 'composer',
        workflowId: 'qti-v2-turn',
      });
    });

    it('creates the session at once for any other workflow', () => {
      expect(workflowStartAction(CATALOGUE[2])).toEqual({ kind: 'create' });
      expect(workflowStartAction(CATALOGUE[4])).toEqual({ kind: 'create' });
    });
  });

  describe('composerWorkflowId (sessions-chat R64)', () => {
    it('keeps a preselected workflow that can start a chat', () => {
      expect(composerWorkflowId(CATALOGUE, 'qti-v2-turn')).toBe('qti-v2-turn');
      expect(composerWorkflowId(CATALOGUE, 'agent:u1')).toBe('agent:u1');
    });

    it('falls back to Assistant with nothing preselected, an unknown id or a disabled workflow', () => {
      expect(composerWorkflowId(CATALOGUE, undefined)).toBe('agent:assistant');
      expect(composerWorkflowId(CATALOGUE, 'agent:gone')).toBe(
        'agent:assistant',
      );
      expect(composerWorkflowId(CATALOGUE, 'agent:rfp')).toBe(
        'agent:assistant',
      );
      expect(composerWorkflowId([], 'qti-v2-turn')).toBe('agent:assistant');
    });

    it("maps the agent key of a dataset-picking workflow's agent to that workflow", () => {
      expect(composerWorkflowId(CATALOGUE, 'assistant-v2')).toBe('qti-v2-turn');
    });
  });

  describe('composerCreateBody (sessions-chat R64; api.md 3)', () => {
    it('sends the name and the picked datasets for a workflow that picks datasets', () => {
      expect(
        composerCreateBody(CATALOGUE[1], 'V2 check', ['World Cup Core']),
      ).toEqual({
        workflowId: 'qti-v2-turn',
        name: 'V2 check',
        datasets: ['World Cup Core'],
      });
      expect(composerCreateBody(null, 'Q', ['Core'])).toEqual({
        workflowId: 'agent:assistant',
        name: 'Q',
        datasets: ['Core'],
      });
    });

    it('sends no datasets, and the name only when typed, for any other workflow', () => {
      expect(composerCreateBody(CATALOGUE[3], 'Acme', ['Core'])).toEqual({
        workflowId: 'agent:rfp',
        name: 'Acme',
      });
      expect(composerCreateBody(CATALOGUE[3], '', ['Core'])).toEqual({
        workflowId: 'agent:rfp',
      });
    });
  });
});
