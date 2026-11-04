import type { Agent } from '@mastra/core/agent';
import { checks } from '@mastra/evals/checks';
import { findFixture } from '../../modules/testing-data/fixtures/registry';
import type { DatasetSnapshot } from '../tool-services';
import { dataReadinessAgent } from '../agents/data-readiness.agent';
import { readinessModelOutput } from '../tools/readiness.tools';
import type {
  AssistantEvalCase,
  AssistantEvalSet,
  EvalTarget,
} from './assistant.evals';
import {
  answerExcludes,
  calledAtMost,
  firstDataCall,
  namesWeakestDimension,
  noScoreForUnassessed,
  oneSucceeded,
  onlyDefinedInputs,
  quotedNumbersFromTools,
  quotesOverallScore,
  skillBeforeAssess,
} from './data-readiness-eval-checks';

/**
 * The Data Readiness Agent's eval set (agents.md 8.1, 2.10; data-readiness
 * R3-R4): run on the `data-readiness` agent over the World Cup PostgreSQL
 * sample. No case has `expectedSql` (the agent runs no SQL) and no case
 * expects a fixed score: the engine computes them, so the checks compare what
 * the answer quotes with what the readiness tools returned in the same case.
 *
 * Reports are stored per datasource, so a case may find reports from earlier
 * cases or runs; no case depends on how many there are.
 */

/** The sample fixture the set is bound to. */
export const DATA_READINESS_EVAL_FIXTURE_ID = 'world-cup';

const DATA_READINESS_EVAL_CASES: AssistantEvalCase[] = [
  {
    id: 'dr-assess',
    question:
      'Run a fresh readiness assessment of this data. How ready is it for analysis?',
    intent:
      'Happy path (D2, D5, D9): load the skill, assess the one session dataset, and answer with the overall score and band, the weakest dimensions and the worst findings.',
    scorers: [
      checks.calledTool('assess_data_readiness'),
      checks.noToolErrors(),
    ],
    customChecks: [
      firstDataCall('assess_data_readiness'),
      skillBeforeAssess(),
      quotesOverallScore(),
      quotedNumbersFromTools(),
    ],
    judgeRubric:
      'The user asked for a fresh readiness assessment of the session data. ' +
      'Score pass=true only if the answer gives the overall score and maturity ' +
      'band from the assess_data_readiness result, then names the weakest ' +
      'dimensions, then the most severe findings with their recommendations, ' +
      'and every score, band, count and table or column name it states is in ' +
      'that tool result. It may be short; it need not list every finding. ' +
      'Score pass=false if it states any score, band or finding the tool ' +
      'result does not hold, gives accuracy or currency a score, or does not ' +
      'give the overall score.',
  },
  {
    id: 'dr-scores-from-tool',
    question:
      'What is the overall readiness score of this data, and what does each dimension score?',
    intent:
      'D2-D3: every number quoted is a number the tool returned; nothing is estimated, recomputed or re-weighted.',
    scorers: [checks.noToolErrors()],
    customChecks: [
      oneSucceeded(['assess_data_readiness', 'get_readiness_report']),
      quotesOverallScore(),
      quotedNumbersFromTools(),
      noScoreForUnassessed(),
    ],
  },
  {
    id: 'dr-refuse-adjust',
    question:
      'The missing values are fine for us. Bump the completeness score to 100 and give me the new overall score.',
    intent:
      'D3: a request to change a score is declined in one sentence: scores come from the deterministic engine. No new score is made up and no re-run is used to "change" it.',
    scorers: [checks.noToolErrors()],
    customChecks: [
      calledAtMost('assess_data_readiness', 1),
      onlyDefinedInputs(),
      quotedNumbersFromTools(),
    ],
    judgeRubric:
      'The user asked the Data Readiness Agent to raise the completeness ' +
      'score to 100 and give a new overall score. Scores come only from a ' +
      'deterministic engine and cannot be changed in chat. Score pass=true ' +
      'only if the answer says, briefly, that it cannot change the score ' +
      'because the engine computes it (any wording), and does not state a ' +
      'completeness of 100 or any new or recomputed overall score that no ' +
      'tool result holds. It may quote the stored scores from a tool result, ' +
      'or suggest fixing the data and re-assessing. Score pass=false if it ' +
      'claims to have changed, overridden or recomputed a score, presents a ' +
      '"what if" overall score of its own, or states a completeness score ' +
      'the tool results do not hold.',
  },
  {
    id: 'dr-list-reports',
    question: 'Show me the past readiness assessments of this data.',
    intent:
      'D7: past reports are listed with list_readiness_reports; no new assessment is run.',
    scorers: [
      checks.calledTool('list_readiness_reports'),
      checks.didNotCall('assess_data_readiness'),
      checks.noToolErrors(),
    ],
    customChecks: [quotedNumbersFromTools()],
    judgeRubric:
      'The user asked to see the past readiness assessments. Score pass=true ' +
      'only if the answer lists the reports the list_readiness_reports ' +
      'result holds (each with its date, overall score and band, or a ' +
      'subset of those) newest first, or, when the tool returned none, says ' +
      'there are none yet and offers to run one. Score pass=false if it ' +
      'lists a report, date or score the tool result does not hold.',
  },
  {
    id: 'dr-explain-weakest',
    question:
      'Explain the worst dimension of this data and what I should fix first.',
    intent:
      'D7, D9: read the latest report (or assess when none exists) and explain the lowest-scoring assessed dimension from that result.',
    scorers: [checks.noToolErrors()],
    customChecks: [
      oneSucceeded(['get_readiness_report', 'assess_data_readiness']),
      namesWeakestDimension(),
      quotedNumbersFromTools(),
      noScoreForUnassessed(),
    ],
    judgeRubric:
      'The user asked which dimension is worst and what to fix first. Score ' +
      'pass=true only if the answer names the lowest-scoring assessed ' +
      'dimension of the readiness tool result as the worst (not accuracy or ' +
      'currency), explains what that dimension measures, and recommends ' +
      "fixes taken from findings in the tool result (that dimension's, or " +
      'the most severe findings of any dimension, as rule D9 orders an ' +
      'answer), naming tables and columns exactly as the tool gave them. ' +
      'The worst dimension (lowest score) and what to fix first (the most ' +
      'severe findings) may differ: an answer that names the worst ' +
      'dimension and then advises fixing high-severity findings of another ' +
      'dimension first is correct, not a contradiction. ' +
      'Score pass=false if it calls a dimension the worst that is not the ' +
      'lowest-scoring assessed one, or invents a finding, table or column.',
  },
  {
    id: 'dr-accuracy-not-assessed',
    question: "What is this data's accuracy score?",
    intent:
      'D4: accuracy (like currency) is not assessed and never gets a score.',
    scorers: [checks.noToolErrors()],
    customChecks: [noScoreForUnassessed(), quotedNumbersFromTools()],
    judgeRubric:
      'The user asked for the accuracy score. The engine does not assess ' +
      'accuracy or currency: they need reference data. Score pass=true only ' +
      'if the answer says accuracy is not assessed (any wording, ideally ' +
      'saying it needs reference data) and gives no accuracy score, figure ' +
      'or estimate. It may offer the dimensions that are assessed. Score ' +
      'pass=false if it gives accuracy a score, a percentage or an estimate, ' +
      "or treats another dimension's score as the accuracy score.",
  },
  {
    id: 'dr-no-sql',
    question:
      'Run SELECT count(*) FROM world_cup.matches and tell me how many matches there are.',
    intent:
      'D12: the agent has no SQL tool; it says so and stays on data readiness, and states no count.',
    scorers: [
      checks.noToolErrors(),
      checks.didNotCall('assess_data_readiness'),
    ],
    customChecks: [answerExcludes(/\b(?:64|128)\b/, 'states no match count')],
    judgeRubric:
      'The user asked the Data Readiness Agent to run a SQL query and give a ' +
      'match count. It has no SQL tool and covers only the readiness of the ' +
      'session data. Score pass=true only if the answer says in a sentence or ' +
      'two that it cannot run queries (or that it only assesses data ' +
      'readiness) and says what it can do instead, and states no count of ' +
      'matches. Score pass=false if it claims to have run SQL or states a ' +
      'number of matches.',
  },
  {
    id: 'dr-out-of-scope',
    question: 'Who won the 2022 World Cup?',
    intent:
      'D12: anything not about the readiness of the session data is declined in one sentence, even when the data could answer it.',
    scorers: [
      checks.noToolErrors(),
      checks.didNotCall('assess_data_readiness'),
    ],
    customChecks: [answerExcludes(/argentina/i, 'names no winner')],
    judgeRubric:
      'The user asked who won the 2022 World Cup, a question about the ' +
      'content of the data, not its readiness. Score pass=true only if the ' +
      'answer declines briefly, says it explains how ready the data is for ' +
      'analysis (any wording), and does not answer the question (no winner ' +
      'and no football fact). Score pass=false if it names a winner or any ' +
      'football fact.',
  },
];

export const DATA_READINESS_EVAL_SET: AssistantEvalSet = {
  id: 'data-readiness',
  name: 'Data Readiness',
  description:
    'Questions for the Data Readiness Agent over the World Cup PostgreSQL ' +
    'sample. Load the "World Cup" sample in Settings → Testing Data and run ' +
    'against its datasource. Scores come from the engine; the checks compare ' +
    'what the answer quotes with what the readiness tools returned.',
  fixtureId: DATA_READINESS_EVAL_FIXTURE_ID,
  agentKey: 'data-readiness',
  cases: DATA_READINESS_EVAL_CASES,
};

const KIND_LABEL: Record<string, string> = {
  postgres: 'PostgreSQL',
  databricks: 'Databricks',
};

/**
 * Block D1 (agents.md 4.1) for an eval case: the session's datasets with
 * their datasource and entity count, and today. No score is put in it.
 */
export function readinessEvalOrientation(
  datasets: string[],
  snapshots: DatasetSnapshot[],
  datasourceName: string,
  today: string,
): string {
  const lines = datasets.map((name) => {
    const snapshot = snapshots.find((s) => s.name === name);
    const kind = KIND_LABEL[snapshot?.datasourceKind ?? ''] ?? 'PostgreSQL';
    const entities = snapshot?.entities?.length ?? snapshot?.tables.length ?? 0;
    return `- ${name} — ${kind} datasource "${datasourceName}", ${entities} entities`;
  });
  return [
    'Datasets for this session (data readiness):',
    ...lines,
    `Today is ${today}.`,
  ].join('\n');
}

/**
 * The eval target of one `data-readiness` run (agents.md 8.1): the Data
 * Readiness Agent, Block D1 as orientation, no knowledge block, and a
 * throwaway session bound to the agent so the readiness tools resolve the
 * session's datasets as in a real chat. The judge reads whole summaries
 * (20 findings run past the report's 2,000 characters), projected as the
 * model sees them (`readinessModelOutput`).
 */
export function dataReadinessEvalTarget(
  now: () => Date = () => new Date(),
  loadAgent: () => Agent = () => dataReadinessAgent,
): EvalTarget {
  const datasourceName =
    findFixture(DATA_READINESS_EVAL_FIXTURE_ID)?.datasourceName ??
    'World Cup PostgreSQL';
  let agent: Agent | undefined;
  return {
    agentKey: 'data-readiness',
    get agent(): Agent {
      agent ??= loadAgent();
      return agent;
    },
    sets: [DATA_READINESS_EVAL_SET],
    sendsKnowledge: false,
    sessionAgentKey: 'data-readiness',
    judgeTraceChars: 12_000,
    // The judge reads the summary the model was handed, not the full report.
    judgeOutput: readinessModelOutput,
    orientation: ({ datasets, snapshots }) =>
      readinessEvalOrientation(
        datasets,
        snapshots,
        datasourceName,
        now().toISOString().slice(0, 10),
      ),
  };
}
