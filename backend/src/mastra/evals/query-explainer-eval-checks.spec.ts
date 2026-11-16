import type { ToolDataRecord } from '../../modules/sessions/entities/session.entity';
import type { QueryEvidence } from '../../modules/sessions/query-evidence/query-evidence.types';
import { explanationOf } from '../agents/query-explainer.prompts';
import type { EvalCustomCheck } from './assistant.evals';
import {
  countsVerified,
  notFallback,
  startsFromATableItReads,
  textsInBusinessWords,
} from './query-explainer-eval-checks';

/**
 * The answers below are built as the target builds them: a realistic reply
 * of the explainer read by `explanationOf`, then its `stageCounts` added.
 */
const SQL =
  'SELECT team.common_name AS team, COUNT(*) AS goals FROM world_cup.goals goal JOIN world_cup.teams team ON team.id = goal.scoring_team_id GROUP BY team.common_name ORDER BY goals DESC';
const RECORD: ToolDataRecord = {
  tool: 'run_readonly_sql',
  input: SQL,
  rationale: 'Goals scored by each team, most goals first',
  columns: ['team', 'goals'],
  rows: [{ team: 'Argentina', goals: 8 }],
  rowCount: 1,
};
const EVIDENCE: QueryEvidence = {
  index: 0,
  coverage: 'whole-table',
  datasourceKind: 'postgres',
  tables: [
    { entity: 'world_cup.world_cup.goals', rows: 47 },
    { entity: 'world_cup.world_cup.teams', rows: 16 },
  ],
};

const REPLY = {
  steps: [
    {
      verb: 'start',
      text: 'every goal scored in the data',
      table: 'world_cup.goals',
      unit: 'goals',
      countSql: 'SELECT COUNT(*) FROM world_cup.world_cup.goals',
    },
    {
      verb: 'add',
      text: 'the team that scored each goal',
      table: 'world_cup.teams',
      unit: 'goals',
      countSql:
        'SELECT COUNT(*) FROM world_cup.world_cup.goals g JOIN world_cup.world_cup.teams t ON t.id = g.scoring_team_id',
    },
    {
      verb: 'count',
      text: 'goals for each team',
      unit: 'teams',
      countSql: 'SELECT 16',
    },
    {
      verb: 'sort',
      text: 'teams with the most goals first',
      unit: 'teams',
      countSql: 'SELECT 16',
    },
  ],
};

function answer(
  reply: unknown,
  stageCounts: Record<string, unknown> | null = { status: 'verified' },
): string {
  return JSON.stringify({
    ...explanationOf(reply, RECORD, EVIDENCE, '2026-11-15T00:00:00.000Z'),
    ...(stageCounts ? { stageCounts } : {}),
  });
}

async function verdict(check: EvalCustomCheck, text: string) {
  return check.run({ answer: text, toolCalls: [], datasets: [], vars: {} });
}

describe('query-explainer eval checks (agents.md 8.1, 2.12)', () => {
  const real = answer(REPLY);
  const fallback = JSON.stringify(
    explanationOf('Sorry, I cannot do that', RECORD, EVIDENCE),
  );

  describe('not-fallback', () => {
    it('passes a reply read as a JSON object with steps', async () => {
      expect(await verdict(notFallback(), real)).toBeUndefined();
    });

    it('fails the code-built steps flagged fallback', async () => {
      expect((JSON.parse(fallback) as { fallback: boolean }).fallback).toBe(
        true,
      );
      expect(await verdict(notFallback(), fallback)).toMatch(/fallback/);
    });

    it('fails an answer that is no JSON', async () => {
      expect(await verdict(notFallback(), 'not json')).toMatch(/not a JSON/);
    });
  });

  describe('starts-from-a-table-it-reads', () => {
    const reads = ['world_cup.goals', 'world_cup.teams'];

    it('passes a start on a table the query reads, by its full name', async () => {
      expect(
        (JSON.parse(real) as { steps: { table: string }[] }).steps[0].table,
      ).toBe('world_cup.world_cup.goals');
      expect(
        await verdict(startsFromATableItReads(reads), real),
      ).toBeUndefined();
    });

    it('fails a start on a table the query does not read', async () => {
      const wrong = answer({
        steps: [{ verb: 'start', text: 'every match', table: 'matches' }],
      });
      expect(await verdict(startsFromATableItReads(reads), wrong)).toMatch(
        /matches/,
      );
    });

    it('fails a first step that is not a start', async () => {
      const first = JSON.stringify({
        steps: [{ verb: 'keep', text: 'some goals', table: 'goals' }],
      });
      expect(await verdict(startsFromATableItReads(reads), first)).toMatch(
        /not start/,
      );
    });
  });

  describe('texts-in-business-words', () => {
    it('passes plain business texts', async () => {
      expect(await verdict(textsInBusinessWords(), real)).toBeUndefined();
    });

    it('fails a text that holds SQL words, in any case', async () => {
      const sql = answer({
        steps: [
          { verb: 'start', text: 'every goal', table: 'goals' },
          { verb: 'add', text: 'JOIN the teams table', table: 'teams' },
          { verb: 'count', text: 'COUNT(*) per team' },
          { verb: 'sort', text: 'order by goals' },
        ],
      });
      const reason = await verdict(textsInBusinessWords(), sql);
      expect(reason).toMatch(/step 2 holds "JOIN"/);
      expect(reason).toMatch(/step 3 holds "COUNT\("/);
      expect(reason).toMatch(/step 4 holds "order by"/);
    });

    it('reads WHERE only in capitals, joined and limited as words', async () => {
      const prose = answer({
        steps: [
          { verb: 'start', text: 'every goal', table: 'goals' },
          { verb: 'keep', text: 'goals where the scorer is known' },
          { verb: 'add', text: 'teams joined to each goal, limited to five' },
        ],
      });
      expect(await verdict(textsInBusinessWords(), prose)).toBeUndefined();
      const caps = JSON.stringify({
        steps: [{ verb: 'keep', text: 'WHERE goals > 3' }],
      });
      expect(await verdict(textsInBusinessWords(), caps)).toMatch(/WHERE/);
    });

    it('fails a text over 160 characters', async () => {
      const long = JSON.stringify({
        steps: [{ verb: 'start', text: 'a'.repeat(161) }],
      });
      expect(await verdict(textsInBusinessWords(), long)).toMatch(
        /161 characters/,
      );
    });
  });

  describe('counts-verified', () => {
    it('passes verified counts', async () => {
      expect(await verdict(countsVerified(), real)).toBeUndefined();
    });

    it('fails unverified counts with the reason', async () => {
      const bad = answer(REPLY, {
        status: 'unverified',
        reason: 'Step 3 (count) raised the count',
      });
      expect(await verdict(countsVerified(), bad)).toBe(
        'The step counts are unverified: Step 3 (count) raised the count',
      );
    });

    it('fails when the answer has no stageCounts', async () => {
      expect(await verdict(countsVerified(), answer(REPLY, null))).toMatch(
        /missing/,
      );
    });
  });
});
