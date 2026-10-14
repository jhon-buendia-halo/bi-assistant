import { checks } from '@mastra/evals/checks';
import { rfpAgent } from '../agents/rfp.agent';
import {
  RFP_CREATED_BY_CONTEXT_KEY,
  TURN_RFP_CONTEXT_KEY,
  type TurnRfpHolder,
  isoToday,
  rfpOrientationBlock,
} from '../rfp-context';
import { callRfpApi, rfpApiTarget } from '../tools/rfp.tools';
import { DATASETS_CONTEXT_KEY } from '../tools/dataset.tools';
import type { DatasetSnapshot } from '../tool-services';
import { findFixture } from '../../modules/testing-data/fixtures/registry';
import type {
  AssistantEvalCase,
  AssistantEvalSet,
  EvalTarget,
} from './assistant.evals';

/**
 * The RFP Builder's eval set (agents.md 8.1, rfp R14): run on the `rfp`
 * agent over the Intellify RFP API sample. Its cases have no `expectedSql`
 * (the agent runs no SQL); each gets Block R1 instead of Block 1, and the
 * drafts a run creates are tagged `eval:<run id>` and deleted when it ends.
 */

/** The sample fixture the set is bound to. */
export const RFP_EVAL_FIXTURE_ID = 'intellify-api';

/** Replaced in a case's question by the id of a draft the run's setup creates. */
export const RFP_ID_PLACEHOLDER = '{rfpId}';

/** The client the setup's draft is for: Orchard Manufacturing. */
const SETUP_CLIENT_ONE_CODE = 'IC100100';
const SETUP_PLAN_YEAR = 2027;

const RFP_EVAL_CASES: AssistantEvalCase[] = [
  {
    id: 'rfp-skill-first',
    question: 'Start an RFP for Orchard Manufacturing',
    intent:
      'Stage 1 from a cold start: load the stage-1 skill (rfp-client-renewal) with the skill tool first, then find the client and read its renewals.',
    scorers: [
      checks.calledTool('skill'),
      checks.toolOrder(['skill', 'list_clients']),
      checks.noToolErrors(),
    ],
    judgeRubric:
      'The consultant asked to start an RFP for Orchard Manufacturing. Score ' +
      'pass=true only if the final answer names the client Orchard ' +
      'Manufacturing with its client code IC100100, lists its lines of ' +
      'coverage with their renewal (effective) dates as returned by the ' +
      'get_client_renewals tool call, and proposes the plan year or asks the ' +
      'consultant to confirm it. Every carrier, premium, increase and date it ' +
      'states must appear in a tool result. Score pass=false if it invents a ' +
      'carrier or a figure, skips the renewal dates, creates the RFP record ' +
      'before the consultant confirmed the client and plan year, or answers ' +
      'without reading the renewals.',
  },
  {
    id: 'rfp-program-review',
    question:
      "Show me Orchard Manufacturing's current medical program with this year's premiums and the renewal increase",
    intent:
      'Stage 2 reading: the medical plans with carrier, funding, enrolment, annual premium and increase, from the API only.',
    scorers: [
      checks.calledTool('get_client_program'),
      // Orchard Manufacturing's medical carrier in the seed.
      checks.includes('Cigna'),
      checks.matches(/\$?[\d,]+(\.\d+)?/),
      checks.noToolErrors(),
    ],
    judgeRubric:
      "The consultant asked for Orchard Manufacturing's current medical " +
      "program with this year's premiums and the renewal increase. Score " +
      'pass=true only if the answer shows a table of the medical plans, each ' +
      'with its carrier, funding type, enrolled employees, annual premium and ' +
      'renewal increase, taken from the get_client_program or ' +
      'get_client_financials tool results; names the plan year 2026; and ' +
      'every carrier name it shows appears in those tool results. Score ' +
      'pass=false if it states a benchmark, a market average or any figure ' +
      'the tool results do not hold, shows plan design ids instead of plan ' +
      'names or types, or leaves out the premium or the increase.',
  },
  {
    id: 'rfp-create-draft',
    question:
      'Create the RFP for Maple Ridge Hospitality for the 2027 plan year, medical and dental only',
    intent:
      'The consultant states the decision up front: create the draft and save exactly the two lines in scope.',
    scorers: [
      checks.calledTool('create_rfp'),
      checks.calledTool('set_rfp_lines'),
      checks.didNotCall('export_rfp_package'),
      checks.noToolErrors(),
    ],
    judgeRubric:
      'The consultant asked to create the RFP for Maple Ridge Hospitality for ' +
      'the 2027 plan year, with medical and dental only. Score pass=true only ' +
      'if a create_rfp call for plan year 2027 succeeded, the last ' +
      'successful set_rfp_lines call saved exactly two lines, Medical and ' +
      'Dental, and the answer reports the saved draft (its title or client ' +
      'and plan year) and asks what comes next or moves on to the current ' +
      'program review. Score pass=false if other lines were saved, the draft ' +
      'is for another year, or the answer claims something was saved that ' +
      'no tool call saved.',
  },
  {
    id: 'rfp-carriers-dental',
    question:
      'Which carriers could we invite for dental for Maple Ridge Hospitality, and who is the incumbent?',
    intent:
      'Stage 4 reading: carriers writing the line, with the incumbent marked from the data.',
    scorers: [
      checks.calledTool('list_carriers'),
      checks.includes('Delta Dental'),
      checks.noToolErrors(),
    ],
    judgeRubric:
      'The consultant asked which carriers could be invited for dental for ' +
      'Maple Ridge Hospitality and who the incumbent is. Score pass=true only ' +
      'if every carrier the answer names appears in a list_carriers tool ' +
      'result for the Dental line, and the incumbent it names is the carrier ' +
      'whose incumbentFor includes Dental in that result (or, when none has ' +
      'it, the answer says the data shows no incumbent). Score pass=false if ' +
      'it names a carrier the tool did not return, marks the wrong incumbent, ' +
      'or saves a carrier list without the consultant confirming it.',
  },
  {
    id: 'rfp-resume-drafts',
    question: 'List my draft RFPs',
    intent:
      'Resuming work: list the stored records as the API returns them, and offer to resume one.',
    scorers: [checks.calledTool('list_rfps'), checks.noToolErrors()],
    judgeRubric:
      'The consultant asked to list their draft RFPs. Score pass=true only if ' +
      'the answer lists exactly the RFP records the list_rfps tool returned ' +
      '(or says there are none when it returned none), with their client, ' +
      'plan year and stage where given, and offers to resume one. Score ' +
      'pass=false if it lists an RFP the tool did not return, or leaves out ' +
      'drafts the tool returned.',
  },
  {
    id: 'rfp-bad-rows-recovers',
    question: `Set the timeline for RFP ${RFP_ID_PLACEHOLDER} to issue on 2026-11-02, proposals due 2026-12-01 and decision 2027-01-15`,
    intent:
      'A line-per-row input: the timeline rows must be right first time, or repaired without bothering the consultant.',
    scorers: [checks.calledTool('set_rfp_timeline'), checks.noToolErrors()],
    judgeRubric:
      'The consultant asked to set the timeline of an RFP to three ' +
      'milestones: RFP issued on 2026-11-02, proposals due on 2026-12-01 and ' +
      'the decision on 2027-01-15. Score pass=true only if a set_rfp_timeline ' +
      'call succeeded with those three milestones and dates, and the answer ' +
      'reports the three milestones with those dates as saved. Score ' +
      'pass=false if any date differs, a milestone is missing, or the answer ' +
      'claims a save the tool calls do not show.',
  },
  {
    id: 'rfp-out-of-scope',
    question: 'Who won the 2022 World Cup?',
    intent:
      'Scope: the RFP Builder declines anything that is not building an RFP over the Intellify data.',
    scorers: [checks.noToolErrors(), checks.didNotCall('list_clients')],
    judgeRubric:
      'The user asked who won the 2022 World Cup, which has nothing to do ' +
      'with building a carrier RFP. Score pass=true only if the answer ' +
      'declines in a sentence or two, says it builds carrier RFPs over the ' +
      'Intellify data, and does not answer the question (it must not name a ' +
      'winner). Score pass=false if it names a winner or any football fact, ' +
      'or does not say what it does instead.',
  },
  {
    id: 'rfp-no-sql',
    question:
      'Run SELECT count(*) FROM intellify.clients and tell me the number',
    intent:
      'The agent has no SQL tool: it must say so, or answer from a tool call, and never claim to have run SQL.',
    scorers: [checks.noToolErrors()],
    judgeRubric:
      'The user asked the RFP Builder to run a SQL statement. The agent has ' +
      'no SQL tool. Score pass=true if the answer explains it cannot run SQL ' +
      'and offers to look clients up with list_clients instead, or answers ' +
      'with the number of clients taken from a list_clients tool result and ' +
      'says where the number came from. Score pass=false if the answer ' +
      'claims to have run the SQL statement, or states a client count that no ' +
      'tool result supports.',
  },
];

export const RFP_EVAL_SET: AssistantEvalSet = {
  id: 'rfp',
  name: 'RFP Builder',
  description:
    'Questions for the RFP Builder over the Intellify RFP API sample. Register ' +
    'the "Intellify RFP API" sample in Settings → Testing Data and run against ' +
    'its REST datasource. Drafts a run creates are deleted when it ends.',
  fixtureId: RFP_EVAL_FIXTURE_ID,
  agentKey: 'rfp',
  cases: RFP_EVAL_CASES,
};

/** A requestContext stand-in that carries only the dataset names. */
function datasetsContext(datasets: string[]) {
  return {
    get: (key: string) => (key === DATASETS_CONTEXT_KEY ? datasets : undefined),
  };
}

/** The first of `datasets` bound to a REST datasource, as the tools pick it. */
function restDataset(
  datasets: string[],
  snapshots: DatasetSnapshot[],
): DatasetSnapshot | undefined {
  for (const name of datasets) {
    const snapshot = snapshots.find((candidate) => candidate.name === name);
    if (snapshot?.datasourceKind === 'rest' && snapshot.datasourceId) {
      return snapshot;
    }
  }
  return undefined;
}

/**
 * The eval target of one `rfp` run (agents.md 8.1): the RFP Builder, Block R1
 * as orientation, `rfp-created-by = eval:<runId>` and a fresh `turn-rfp` per
 * case, a draft for the case that names one, and the run's drafts deleted at
 * the end.
 */
export function rfpEvalTarget(
  runId: string,
  now: () => Date = () => new Date(),
): EvalTarget {
  const createdBy = `eval:${runId}`;
  const datasourceName =
    findFixture(RFP_EVAL_FIXTURE_ID)?.datasourceName ?? 'Intellify RFP API';
  return {
    agentKey: 'rfp',
    agent: rfpAgent,
    sets: [RFP_EVAL_SET],
    sendsKnowledge: false,
    orientation: ({ datasets, snapshots }) =>
      rfpOrientationBlock({
        datasourceId:
          restDataset(datasets, snapshots)?.datasourceId ?? 'unknown',
        datasourceName,
        today: isoToday(now()),
      }),
    configureContext: (requestContext) => {
      requestContext.set(RFP_CREATED_BY_CONTEXT_KEY, createdBy);
      const holder: TurnRfpHolder = {};
      requestContext.set(TURN_RFP_CONTEXT_KEY, holder);
    },
    prepareQuestion: async (evalCase, { datasets }) => {
      if (!evalCase.question.includes(RFP_ID_PLACEHOLDER)) {
        return evalCase.question;
      }
      const target = await rfpApiTarget(datasetsContext(datasets));
      if ('error' in target) throw new Error(target.error);
      const created = (await callRfpApi(target, 'POST', '/v1/rfps', {
        body: {
          clientOneCode: SETUP_CLIENT_ONE_CODE,
          planYear: SETUP_PLAN_YEAR,
          createdBy,
        },
      })) as { id?: unknown; error?: unknown };
      if (typeof created.error === 'string') {
        throw new Error(
          `Eval setup could not create a draft RFP: ${created.error}`,
        );
      }
      if (typeof created.id !== 'string') {
        throw new Error(
          'Eval setup could not create a draft RFP: no id returned',
        );
      }
      return evalCase.question.split(RFP_ID_PLACEHOLDER).join(created.id);
    },
    finish: async (datasets) => {
      try {
        const target = await rfpApiTarget(datasetsContext(datasets));
        if ('error' in target) return;
        await callRfpApi(target, 'DELETE', '/v1/rfps', {
          query: { createdBy },
        });
      } catch {
        // Best effort: a failed clean-up leaves drafts tagged with the run.
      }
    },
  };
}
