/**
 * The live-LLM integration layer of Answer a Business Question
 * (`npm run test:live-llm`): the built backend in its own process and data
 * dir, the REAL model (test/live-llm.ts) and the World Cup Postgres on
 * 55432, driven only through the HTTP API a client uses (api.md 30, 119,
 * 121, 138, 140).
 *
 * It is not an eval. The evals judge how good an agent's answer is; this
 * layer checks that the parts fit together when a real model drives them:
 * every structured step's reply parses (no lenient fallback), Analyse's
 * queries run, Validate passes within its two attempts, the figures the
 * answer states equal the ones the same data gives when queried directly,
 * each query reaches the query inspector's evidence and can be explained,
 * and a wait, a resume, a follow-up and reference images keep the run on
 * its contract. Each case also writes what it saw (steps, attempts,
 * queries, timings) to `.qa-reports/live-llm/report.md` at the repo root.
 *
 * Opt-in and not in qa.mjs: it costs model calls (about 50 per run) and a
 * real model is not deterministic. Skips, visibly, without a configured
 * model or the World Cup Postgres.
 */
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import request from 'supertest';
import { type Backend, boot, stop } from './backend-process';
import { liveLlmSettings } from './live-llm';
import {
  runClient,
  type StoredRun,
  type Streamed,
} from './workflow-run-client';
import {
  WORLD_CUP_CONNECTION,
  runSql,
  worldCupIsUp,
  worldCupPool,
} from './world-cup';

const WORKFLOW = 'answer-business-question';
const DATASET = 'World Cup Live LLM';
const TABLES = ['matches', 'teams', 'goals', 'tournaments'];
const BAR_CHART = resolve(
  __dirname,
  '../src/mastra/evals/__fixtures__/images/bar-chart-revenue.png',
);
const REPORT_DIR = resolve(__dirname, '../../.qa-reports/live-llm');

jest.setTimeout(15 * 60_000);

const settings = liveLlmSettings();
const describeLive = settings && worldCupIsUp() ? describe : describe.skip;

/** The answer's text with digit groups joined: `1,012,301` reads `1012301`. */
const digits = (text: string) =>
  text.replace(/(\d)[,\u202f\u00a0 ](?=\d{3}\b)/g, '$1');

/** Whether `text` states the whole number `value`. */
const states = (text: string, value: number) =>
  new RegExp(`(^|[^\\d.])${value}([^\\d]|$)`).test(digits(text));

type Step = StoredRun['steps'][number];

const stepsOf = (run: StoredRun, id: string): Step[] =>
  run.steps.filter((step) => step.id === id);

const sqlCalls = (run: StoredRun) =>
  stepsOf(run, 'analyse').flatMap((step) =>
    (step.toolCalls ?? []).filter((call) => call.tool === 'run_readonly_sql'),
  );

/** A whole stored run's observations for the report. */
interface Observation {
  case: string;
  runId?: string;
  status?: string;
  seconds: number;
  trail: string[];
  attempts: number;
  queries: { sql?: string; rowCount?: number; error?: string }[];
  answer?: string;
  /** The run's error and each failed step's, when it failed. */
  errors: string[];
  notes: string[];
}

describeLive(
  'Answer a Business Question on the real model (live LLM, World Cup Postgres)',
  () => {
    let backend: Backend | undefined;
    const dataDir = mkdtempSync(join(tmpdir(), 'qti-abq-live-llm-'));
    const http = () => request.agent(backend!.url);
    const client = runClient(() => backend!.url);
    const observations: Observation[] = [];
    const truth = {
      matches: 0,
      attendance: 0,
      topScorer: '',
      topGoals: 0,
      finals: 0,
    };

    const ask = (
      question: string,
      extra: Record<string, unknown> = {},
      context?: { fromRunId: string },
    ) =>
      client.run(WORKFLOW, {
        input: { question, datasets: [DATASET], buildVisual: false, ...extra },
        ...(context ? { context } : {}),
      });

    /** Run `act`, record what the run did, and hand back its stored run. */
    const observe = async (
      name: string,
      act: () => Promise<Streamed>,
      notes: string[] = [],
    ): Promise<{ res: Streamed; run: StoredRun; seen: Observation }> => {
      const started = Date.now();
      const res = await act();
      expect(res.status).toBe(200);
      const runId = res.frames[0]?.runId;
      const run = runId ? await client.stored(runId) : res.run!;
      const seen: Observation = {
        case: name,
        runId: run?.id,
        status: run?.status,
        seconds: Math.round((Date.now() - started) / 1000),
        trail: res.steps.filter((s) => !s.endsWith(':running')),
        attempts: stepsOf(run, 'analyse').filter((s) => s.status !== 'skipped')
          .length,
        queries: sqlCalls(run).map((call) => ({
          sql: call.input,
          rowCount: call.rowCount,
          error: call.error,
        })),
        answer: run?.answer?.content,
        errors: [
          ...(run?.error ? [`run: ${run.error}`] : []),
          ...(run?.steps ?? [])
            .filter((step) => step.status === 'failed')
            .map((step) => `${step.id}: ${step.error ?? '(no error stored)'}`),
        ],
        notes,
      };
      observations.push(seen);
      return { res, run, seen };
    };

    /** The contract every answered run keeps, whatever the model said. */
    const expectAnswered = (run: StoredRun, seen: Observation) => {
      expect(run.status).toBe('success');
      expect(run.answer?.content?.trim().length).toBeGreaterThan(0);
      // Plan's reply parsed: the lenient fallback leaves the scope empty.
      const plan = stepsOf(run, 'plan').at(-1)?.output as
        { plan?: { scope?: string; question?: string } } | undefined;
      expect(plan?.plan?.question).toBeTruthy();
      if (!plan?.plan?.scope)
        seen.notes.push('Plan has no scope: its reply may not have parsed.');
      expect(plan?.plan?.scope).toBeTruthy();
      // At least one query ran, and the analysis ended within its attempts.
      const calls = sqlCalls(run);
      expect(calls.some((call) => !call.error)).toBe(true);
      expect(seen.attempts).toBeGreaterThanOrEqual(1);
      expect(seen.attempts).toBeLessThanOrEqual(2);
      const last = stepsOf(run, 'validate').at(-1)?.output as
        | {
            ok?: boolean;
            findings?: { check: string; passed: boolean; detail: string }[];
          }
        | undefined;
      if (seen.attempts > 1) {
        const first = stepsOf(run, 'validate')[0]?.output as typeof last;
        seen.notes.push(
          `Validate sent the analysis back: ${(first?.findings ?? [])
            .filter((f) => !f.passed)
            .map((f) => `${f.check} (${f.detail})`)
            .join('; ')}`,
        );
      }
      if (last && !last.ok) {
        seen.notes.push(
          `The last attempt did not pass Validate: ${(last.findings ?? [])
            .filter((f) => !f.passed)
            .map((f) => f.check)
            .join(', ')}`,
        );
      }
      // Wrap up counts the last attempt's queries.
      expect(run.output).toMatchObject({
        sqlQueries: expect.any(Number) as number,
      });
    };

    /** The query inspector's evidence (agent-answers): one per query record, explainable. */
    const expectInspectable = async (run: StoredRun, seen: Observation) => {
      const stored = (await http().get(`/workflow-runs/${run.id}`).expect(200))
        .body as {
        answer?: { evidence?: { index: number; coverage?: string }[] };
      };
      const evidence = stored.answer?.evidence ?? [];
      expect(evidence.length).toBeGreaterThan(0);
      const explainable = evidence.find((entry) => entry.coverage);
      expect(explainable).toBeDefined();
      const explained = await http()
        .post(
          `/workflow-runs/${run.id}/answer/queries/${explainable!.index}/explanation`,
        )
        .send();
      expect(explained.status).toBe(201);
      const entry = (
        explained.body as {
          run: {
            answer: {
              evidence: {
                index: number;
                explanation?: { steps: unknown[]; fallback?: true };
              }[];
            };
          };
        }
      ).run.answer.evidence.find((e) => e.index === explainable!.index);
      expect(entry?.explanation?.steps.length).toBeGreaterThanOrEqual(2);
      if (entry?.explanation?.fallback) {
        seen.notes.push(
          'The query explainer reply did not parse: steps built by code.',
        );
      }
      expect(entry?.explanation?.fallback).toBeUndefined();
      seen.notes.push(
        `Evidence: ${evidence.length} quer${evidence.length === 1 ? 'y' : 'ies'}, coverage ${evidence
          .map((e) => e.coverage ?? 'failed')
          .join(
            ', ',
          )}; explanation of query ${explainable!.index + 1}: ${entry?.explanation?.steps.length} steps.`,
      );
    };

    beforeAll(async () => {
      const pool = worldCupPool();
      try {
        truth.matches = Number(
          (
            await runSql(pool, 'SELECT COUNT(*) AS n FROM world_cup.matches')
          )[0]['n'],
        );
        truth.attendance = Number(
          (
            await runSql(
              pool,
              'SELECT SUM(attendance) AS n FROM world_cup.matches',
            )
          )[0]['n'],
        );
        truth.finals = Number(
          (
            await runSql(
              pool,
              "SELECT COUNT(*) AS n FROM world_cup.matches WHERE stage = 'final'",
            )
          )[0]['n'],
        );
        const top = await runSql(
          pool,
          `SELECT t.common_name AS team, COUNT(*) AS goals
           FROM world_cup.goals g JOIN world_cup.teams t ON t.id = g.scoring_team_id
          GROUP BY t.common_name ORDER BY goals DESC LIMIT 2`,
        );
        // The question has one right answer only when the top is no tie.
        expect(Number(top[0]['goals'])).toBeGreaterThan(
          Number(top[1]['goals']),
        );
        truth.topScorer = String(top[0]['team']);
        truth.topGoals = Number(top[0]['goals']);
        const columns = await runSql(
          pool,
          `SELECT table_name, column_name, data_type, is_nullable
           FROM information_schema.columns
          WHERE table_schema = 'world_cup' AND table_name IN (${TABLES.map((t) => `'${t}'`).join(', ')})
          ORDER BY table_name, ordinal_position`,
        );
        backend = await boot(dataDir);
        const saved = (await http().put('/llm/settings').send(settings))
          .body as {
          ok: boolean;
          message: string;
        };
        expect(saved).toMatchObject({ ok: true });
        const source = (
          await http()
            .post('/datasources')
            .send({
              kind: 'postgres',
              name: 'World Cup',
              config: { ...WORLD_CUP_CONNECTION, ssl: false },
            })
        ).body as { ok: boolean; message: string; datasource: { id: string } };
        expect(source).toMatchObject({ ok: true });
        const key = (table: string) => `world_cup.world_cup.${table}`;
        const dataset = (
          await http()
            .post('/datasets')
            .send({
              name: DATASET,
              tables: TABLES.map(key),
              entities: TABLES.map((table) => ({
                key: key(table),
                columns: columns
                  .filter((c) => c['table_name'] === table)
                  .map((c) => ({
                    name: String(c['column_name']),
                    type: String(c['data_type']),
                    nullable: c['is_nullable'] === 'YES',
                  })),
              })),
              datasourceId: source.datasource.id,
              datasourceKind: 'postgres',
            })
        ).body as { ok: boolean; message: string };
        expect(dataset).toMatchObject({ ok: true });
      } finally {
        await pool.end();
      }
    });

    afterAll(async () => {
      await stop(backend);
      mkdirSync(REPORT_DIR, { recursive: true });
      // The backend's own output and system log, to trace a failed run.
      writeFileSync(
        join(REPORT_DIR, 'backend.log'),
        backend?.output.join('') ?? '',
      );
      const systemLog = join(dataDir, 'logs', 'system.ndjson');
      if (existsSync(systemLog)) {
        copyFileSync(systemLog, join(REPORT_DIR, 'system.ndjson'));
      }
      rmSync(dataDir, { recursive: true, force: true });
      const lines = [
        `# Answer a Business Question on the real model`,
        '',
        `Model: ${settings?.provider} ${settings?.model} at ${settings?.baseUrl}. ${new Date().toISOString()}.`,
        `Truth from Postgres: ${truth.matches} matches, attendance ${truth.attendance}, top scorer ${truth.topScorer} (${truth.topGoals}).`,
        '',
      ];
      for (const seen of observations) {
        lines.push(
          `## ${seen.case}`,
          '',
          `- Run ${seen.runId}: **${seen.status}** in ${seen.seconds}s, ${seen.attempts} analysis attempt(s).`,
          `- Steps: ${seen.trail.join(' → ')}`,
          ...seen.queries.map(
            (q, i) =>
              `- Query ${i + 1}: ${q.error ? `failed (${q.error})` : `${q.rowCount ?? '?'} rows`}: \`${(q.sql ?? '').replace(/\s+/g, ' ').slice(0, 300)}\``,
          ),
          ...seen.errors.map((error) => `- **Error** ${error}`),
          ...seen.notes.map((note) => `- Note: ${note}`),
          '',
          '> ' +
            (seen.answer ?? '(no answer)')
              .replace(/\n/g, '\n> ')
              .slice(0, 1500),
          '',
        );
      }
      writeFileSync(join(REPORT_DIR, 'report.md'), lines.join('\n'));
      writeFileSync(
        join(REPORT_DIR, 'report.json'),
        JSON.stringify(
          { settings: { ...settings, apiKey: undefined }, truth, observations },
          null,
          2,
        ),
      );
    });

    it('a count: one answer that states the count the data gives, with its queries in the inspector', async () => {
      const { run, seen } = await observe('Count', () =>
        ask('How many matches were played in total?'),
      );
      expectAnswered(run, seen);
      expect(states(run.answer!.content, truth.matches)).toBe(true);
      await expectInspectable(run, seen);
    });

    it('a ranking over a join: the answer names the team the data ranks first, with its goals', async () => {
      const { run, seen } = await observe('Ranking over a join', () =>
        ask('Which team scored the most goals?'),
      );
      expectAnswered(run, seen);
      expect(run.answer!.content).toContain(truth.topScorer);
      expect(states(run.answer!.content, truth.topGoals)).toBe(true);
      await expectInspectable(run, seen);
    });

    it("Build visual: Ryan charts the answer's rows; the answer still states the true total", async () => {
      const { run, seen } = await observe('Build visual on', () =>
        ask('What was the total attendance across all matches?', {
          buildVisual: true,
        }),
      );
      expectAnswered(run, seen);
      const built = stepsOf(run, 'build-visual')[0];
      expect(built?.status).toBe('success');
      expect(built?.output).toHaveProperty('visual');
      seen.notes.push(
        `Build visual: ${JSON.stringify(
          (built?.output as { visual?: unknown }).visual,
        ).slice(0, 400)}`,
      );
      expect(states(run.answer!.content, truth.attendance)).toBe(true);
    });

    it('an ambiguous question either asks first (and the answer resumes the same run) or states its assumption', async () => {
      const first = await observe('Ambiguous question', () =>
        ask('Which team was the best?'),
      );
      expect(['suspended', 'success']).toContain(first.run.status);
      if (first.run.status === 'success') {
        first.seen.notes.push(
          'The model did not ask: it answered with its own reading.',
        );
        expectAnswered(first.run, first.seen);
        return;
      }
      const waiting = first.run.waitingFor as
        { stepId: string; question: string; options: string[] } | undefined;
      expect(['clarify', 'analyse']).toContain(waiting?.stepId);
      expect(waiting?.question).toBeTruthy();
      first.seen.notes.push(
        `Asked at ${waiting!.stepId}: "${waiting!.question}" (${(waiting!.options ?? []).join(' | ')})`,
      );
      if (waiting!.stepId === 'clarify') {
        expect(waiting!.options.length).toBeGreaterThanOrEqual(2);
        expect(waiting!.options.length).toBeLessThanOrEqual(4);
      }
      const answer = waiting!.options?.[0] ?? 'The team with the most wins';
      const resumed = await observe('Ambiguous question, answered', () =>
        client.resume(first.run.id, { stepId: waiting!.stepId, answer }),
      );
      expect(resumed.run.id).toBe(first.run.id);
      expectAnswered(resumed.run, resumed.seen);
      // Plan never asks twice.
      expect(resumed.res.frames.some((f) => f.type === 'input-required')).toBe(
        false,
      );
    });

    it('a follow-up "only the finals" is read as a filter of the earlier result, not a new analysis', async () => {
      const list = await observe('Follow-up: the list', () =>
        ask('List every match with its stage and attendance.'),
      );
      expectAnswered(list.run, list.seen);
      const follow = await observe('Follow-up: only the finals', () =>
        ask('Only the finals, please.', {}, { fromRunId: list.run.id }),
      );
      expect(follow.run.status).toBe('success');
      const explored = follow.res.steps.includes('page-result:success');
      follow.seen.notes.push(
        explored
          ? 'Interpret follow-up explored the earlier result.'
          : 'Interpret follow-up planned a new analysis instead of filtering the earlier result.',
      );
      expect(follow.res.steps).toContain('interpret-follow-up:success');
      expect(explored).toBe(true);
      // Plan and Analyse did not run (the branch not taken reads skipped).
      expect(follow.res.steps).not.toContain('plan:success:1');
      expect(follow.res.steps).not.toContain('analyse:success:1');
      const page = follow.run.answer?.content ?? '';
      expect(page).toMatch(/final/i);
      // The page's rows are the ones the data gives for the filter, and its
      // cells read as stored (an instant is no JSON string).
      expect(page).toContain(`of ${truth.finals} matching`);
      expect(page).not.toMatch(/\| "\d{4}-/);
    });

    it("a reference image: Zoe's notes reach Plan, and an unrelated chart does not change the data's answer", async () => {
      const png = `data:image/png;base64,${readFileSync(BAR_CHART).toString('base64')}`;
      const { run, seen } = await observe('Reference image', () =>
        ask('How many matches were played in total?', { images: [png] }),
      );
      expectAnswered(run, seen);
      const read = stepsOf(run, 'read-images')[0];
      expect(read?.status).toBe('success');
      const imageNotes = (read?.output as { imageNotes?: unknown } | undefined)
        ?.imageNotes;
      const notes = typeof imageNotes === 'string' ? imageNotes : '';
      seen.notes.push(
        `Image notes: ${notes.replace(/\s+/g, ' ').slice(0, 300)}`,
      );
      expect(notes).toContain('1,204.50');
      expect(notes).not.toContain('The Image Reader returned no description.');
      const planInput = JSON.stringify(stepsOf(run, 'plan')[0]?.input ?? {});
      expect(planInput).toContain('1,204.50');
      expect(states(run.answer!.content, truth.matches)).toBe(true);
    });
  },
);
