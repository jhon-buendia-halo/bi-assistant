/**
 * Scripted end-to-end check for learning-from-feedback + answer pinning
 * (plan `learn-from-feedback`, §3 work unit "F").
 *
 * Proves the whole feature over real HTTP against a running backend — no
 * Nest standalone context, no direct service calls, the same surface the
 * frontend uses:
 *
 *   npm run learning:demo -- --port 3110
 *
 * What it proves, against the `retail` suite's learning-scenario case
 * (`net-revenue-fy2025` by default) and its generalisation case:
 *
 *   S1  ask the trap question (business expert mode) in a fresh session —
 *       expect it answered *wrong*, at medium (or lower) confidence.
 *   --  post the suite's scripted reviewer notes on S1's answer — expect at
 *       least one distilled lesson back.
 *   S2  ask the same question in a new session — expect it now answered
 *       *right*, at high confidence, with `consistency.kind === 'updated'`
 *       (the 👎 notes rejected S1's pin: it is never replayed, but S2 is
 *       compared against it and names the lessons learned since).
 *   S3  ask the same question again in a new session — expect a byte-for-byte
 *       replay of S2's answer (`consistency.kind === 'replay'`, same
 *       `expertTrace.id`): zero model calls, not a lucky re-derivation.
 *   S4  ask the generalisation case (no notes of its own) — expect it right
 *       and high-confidence too: the lessons are general rules, not answers.
 *   S5  ask a control question with no trap — expect high confidence already.
 *   S6  ask it again — expect a byte-identical replay.
 *
 * Exit 0 only when every hard assertion holds; the report table and summary
 * line print either way, because a failed run is exactly when the operator
 * needs to see what each step actually returned.
 *
 * See `backend/scripts/run-eval.ts` for the sibling harness this mirrors in
 * spirit (arg parsing, `--help`, a printed table) — that one talks to the
 * Nest app in-process; this one only ever speaks HTTP, because the point is
 * to prove the feature the way a real client (or the Electron app) sees it.
 */
import { HttpClient, type SseFrame } from './lib/http-client';
import {
  bandAtLeast,
  bytesEqual,
  caseMatches,
  estimateModelCalls,
  findMatchesCheck,
  formatBand,
  formatReportTable,
  formatSummary,
  type CheckLike,
  type ConfidenceBand,
  type ReportRow,
  type StepKind,
} from './lib/learning-report';
import {
  loadSuite,
  type EvalSuite,
  type EvalSuiteCase,
  type LearningComment,
} from '../src/mastra/evals/suite-loader';
import { REASONING_BLOCK_KINDS } from '../src/modules/expert-mode/entities/reasoning-trace.entity';
import type { ChatMessage, SessionDoc } from '../src/modules/sessions/entities/session.entity';
import type { LearnedLesson } from '../src/modules/learning/learning.service';
import type { LlmSettingsView } from '../src/modules/llm/llm.types';
import type { KnowledgeSnippet } from '../src/modules/knowledge/entities/knowledge-snippet.entity';
import type { DatasetDoc } from '../src/modules/datasets/repositories/datasets.repository';

/** A misconfiguration the operator must fix — reported without a stack trace. */
class DemoSetupError extends Error {}

// --------------------------------------------------------------- §2.5 contract

/** `POST /sessions/:id/expert/feedback` response (`SessionsController`). */
interface FeedbackResponse {
  ok: boolean;
  message: string;
  session?: SessionDoc;
  lessons?: LearnedLesson[];
}

// ------------------------------------------------------------------- options

interface Options {
  port: number;
  suite: string;
  caseId: string;
  controlId: string;
  keepSessions: boolean;
  noReset: boolean;
}

function parseArgs(argv: string[]): Options {
  const options: Options = {
    port: 3110,
    suite: 'retail',
    caseId: 'net-revenue-fy2025',
    controlId: 'top-category-units-march-2025',
    keepSessions: false,
    noReset: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--port') {
      const value = Number(argv[++i]);
      if (!Number.isInteger(value) || value <= 0) {
        throw new DemoSetupError(`--port needs a port number (got "${argv[i]}")`);
      }
      options.port = value;
    } else if (arg === '--suite') {
      const value = argv[++i];
      if (!value) throw new DemoSetupError('--suite needs a suite id');
      options.suite = value;
    } else if (arg === '--case') {
      const value = argv[++i];
      if (!value) throw new DemoSetupError('--case needs a case id');
      options.caseId = value;
    } else if (arg === '--control') {
      const value = argv[++i];
      if (!value) throw new DemoSetupError('--control needs a case id');
      options.controlId = value;
    } else if (arg === '--keep-sessions') {
      options.keepSessions = true;
    } else if (arg === '--no-reset') {
      options.noReset = true;
    } else if (arg === '--help' || arg === '-h') {
      printUsage();
      process.exit(0);
    } else {
      throw new DemoSetupError(`Unknown argument "${arg}" (try --help)`);
    }
  }
  return options;
}

function printUsage(): void {
  console.log(
    [
      'Usage: npm run learning:demo -- [options]',
      '',
      'Proves learning-from-feedback + answer pinning end to end over HTTP',
      'against a running backend (see docker/postgres for the retail fixture',
      'and `npm run fixtures:register` to seed it into the app store).',
      '',
      '      --port <n>       backend port (default 3110)',
      '      --suite <id>     eval suite to run against (default retail)',
      '      --case <id>      the learning-scenario case (default net-revenue-fy2025)',
      '      --control <id>   the control case repeated for replay (default',
      '                       top-category-units-march-2025)',
      '      --keep-sessions  do not delete the throwaway sessions this run creates',
      '      --no-reset       skip clearing prior feedback-learned knowledge and',
      '                       answer pins for the suite dataset before running',
      '  -h, --help           show this message',
      '',
      'Exit 0 only when every hard assertion holds. The report table and',
      'summary line always print, pass or fail.',
    ].join('\n'),
  );
}

// -------------------------------------------------------------- run bookkeeping

/** Collects pass/fail as the run goes so the table prints even on a failure. */
class Ledger {
  readonly rows: ReportRow[] = [];
  readonly failures: string[] = [];
  readonly warnings: string[] = [];

  assert(ok: boolean, label: string): boolean {
    console.log(`  ${ok ? '✔' : '✖'} ${label}`);
    if (!ok) this.failures.push(label);
    return ok;
  }

  warn(label: string): void {
    console.log(`  ⚠ ${label}`);
    this.warnings.push(label);
  }

  info(label: string): void {
    console.log(`  · ${label}`);
  }
}

function findCase(suite: EvalSuite, id: string): EvalSuiteCase {
  const found = suite.cases.find((c) => c.id === id);
  if (!found) {
    const available = suite.cases.map((c) => c.id).join(', ');
    throw new DemoSetupError(
      `Suite "${suite.id}" has no case "${id}". Available cases: ${available}.`,
    );
  }
  return found;
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// -------------------------------------------------------------------- HTTP steps

async function preflight(
  http: HttpClient,
  ledger: Ledger,
  datasetName: string,
): Promise<void> {
  console.log(`Preflight: LLM configured, dataset "${datasetName}" registered...`);
  const llm = await http.getJson<LlmSettingsView>('/llm/settings');
  if (!llm.configured) {
    throw new DemoSetupError(
      'No LLM is configured (GET /llm/settings → configured: false). ' +
        'Configure a provider in Settings → LLM (or against the scratch store this ' +
        'backend was started with) before running the demo.',
    );
  }
  ledger.info(`LLM configured: ${llm.provider}/${llm.model}, reasoning ${llm.reasoningEffort}`);
  const { datasets } = await http.getJson<{ datasets: DatasetDoc[] }>('/datasets');
  const dataset = datasets.find((d) => d.name === datasetName);
  if (!dataset) {
    const known = datasets.map((d) => d.name).join(', ') || '(none)';
    throw new DemoSetupError(
      `Dataset "${datasetName}" is not registered (GET /datasets found: ${known}). ` +
        'Run `npm run fixtures:register` against the same APP_DATA_DIR this backend uses.',
    );
  }
  ledger.info(`Dataset "${datasetName}" found (${dataset.tables.length} entities).`);
}

async function reset(
  http: HttpClient,
  ledger: Ledger,
  datasetName: string,
): Promise<void> {
  console.log(`Reset: clearing prior feedback-learned knowledge + answer pins for "${datasetName}"...`);
  const learned = await http.getJson<KnowledgeSnippet[]>(
    `/knowledge?datasetId=${encodeURIComponent(datasetName)}&source=feedback`,
  );
  for (const snippet of learned) {
    await http.deleteJson(`/knowledge/${snippet.id}`);
  }
  ledger.info(`Deleted ${learned.length} previously learned knowledge snippet(s).`);
  const pins = await http.deleteJson<{ deleted: number }>(
    `/answer-pins?datasetId=${encodeURIComponent(datasetName)}`,
  );
  ledger.info(`Deleted ${pins.deleted ?? 0} previously saved answer pin(s).`);
}

interface AskResult {
  sessionId: string;
  sessionName: string;
  message: ChatMessage;
  band?: ConfidenceBand;
  score?: number;
  correct?: boolean;
}

/** One new session, one expert-mode ask, the persisted assistant message back. */
async function ask(
  http: HttpClient,
  ledger: Ledger,
  step: string,
  question: string,
  datasetName: string,
  evalCase: { checks?: CheckLike[] },
  createdSessionIds: string[],
): Promise<AskResult> {
  const sessionName = `learning-demo ${step} ${new Date().toISOString()}`;
  const created = await http.postJson<{
    ok: boolean;
    message: string;
    session?: SessionDoc;
  }>('/sessions', { name: sessionName, datasets: [datasetName] });
  if (!created.ok || !created.session) {
    throw new Error(`${step}: could not create a session — ${created.message}`);
  }
  const sessionId = created.session.id;
  createdSessionIds.push(sessionId);

  const frames: SseFrame[] = await http.streamMessage(
    `/sessions/${sessionId}/messages/stream`,
    { content: question, expert: true },
  );
  const errorFrame = frames.find((f) => f.type === 'error');
  if (errorFrame) {
    throw new Error(`${step}: turn errored — ${String(errorFrame.content)}`);
  }
  const doneFrame = frames.find((f) => f.type === 'done');
  if (!doneFrame || !doneFrame.session) {
    throw new Error(`${step}: stream ended without a "done" event carrying the session`);
  }
  const session = doneFrame.session as SessionDoc;
  const last = session.messages.at(-1);
  if (!last || last.role !== 'assistant') {
    throw new Error(`${step}: the session's last message is not an assistant answer`);
  }
  if (last.clarification) {
    throw new Error(
      `${step}: the assistant asked a clarifying question instead of answering ` +
        `("${last.clarification.question}") — the demo requires a direct, gradable answer. ` +
        'Check the suite case still matches the retail schema/knowledge.',
    );
  }

  const band = last.expertTrace?.overall.band;
  const score = last.expertTrace?.overall.score;
  const matchSpec = findMatchesCheck(evalCase.checks);
  const correct = matchSpec ? caseMatches(evalCase.checks, last.content) : undefined;
  const kind: StepKind = last.consistency?.kind === 'replay' ? 'ask-replay' : 'ask-fresh';

  ledger.rows.push({
    step,
    session: sessionName,
    question,
    band: formatBand(score, band),
    correct: correct === undefined ? '-' : correct ? 'yes' : 'no',
    consistency: last.consistency?.kind ?? '-',
    crossCheck: last.crossCheck?.status ?? '-',
    modelCalls:
      kind === 'ask-replay' ? '0 (replay)' : String(estimateModelCalls(kind)),
  });

  return { sessionId, sessionName, message: last, band, score, correct };
}

async function postComment(
  http: HttpClient,
  sessionId: string,
  messageAt: string,
  comment: LearningComment,
): Promise<FeedbackResponse> {
  // The suite loader already validates this; the guard keeps a hand-edited
  // suite from reaching the backend with a typo.
  if (!REASONING_BLOCK_KINDS.includes(comment.block)) {
    throw new Error(
      `learningScenario comment names an unknown block "${comment.block}" — ` +
        `expected one of ${REASONING_BLOCK_KINDS.join(', ')}`,
    );
  }
  const body: Record<string, unknown> = {
    messageAt,
    block: comment.block,
    comment: comment.comment,
  };
  if (comment.vote) body.vote = comment.vote;
  return http.postJson<FeedbackResponse>(
    `/sessions/${sessionId}/expert/feedback`,
    body,
  );
}

async function deleteSession(http: HttpClient, id: string): Promise<void> {
  try {
    await http.deleteJson(`/sessions/${id}`);
  } catch (err) {
    console.error(`  (could not delete session ${id}: ${message(err)})`);
  }
}

// -------------------------------------------------------------------------- main

async function main(): Promise<number> {
  const options = parseArgs(process.argv.slice(2));
  const http = new HttpClient(`http://localhost:${options.port}`);
  const ledger = new Ledger();
  const createdSessionIds: string[] = [];

  let bandBefore: ConfidenceBand | undefined;
  let bandAfter: ConfidenceBand | undefined;
  let liftPassed = 0;
  const liftTotal = 2;
  let consistencyPassed = 0;
  const consistencyTotal = 2;

  try {
    const suite = loadSuite(options.suite);
    const trapCase = findCase(suite, options.caseId);
    const controlCase = findCase(suite, options.controlId);
    const scenario = trapCase.learningScenario;
    if (!scenario || !scenario.comments.length) {
      throw new DemoSetupError(
        `Case "${trapCase.id}" in suite "${suite.id}" has no learningScenario.comments — ` +
          'nothing for this demo to teach. Give it a learningScenario (§2.6).',
      );
    }
    const generalizationId = scenario.generalisesTo?.[0];
    if (!generalizationId) {
      throw new DemoSetupError(
        `Case "${trapCase.id}"'s learningScenario has no generalisesTo — the demo needs one ` +
          'case that must pass after learning with no comments of its own.',
      );
    }
    const generalizationCase = findCase(suite, generalizationId);
    const datasetName = suite.datasets[0];
    if (!datasetName) {
      throw new DemoSetupError(`Suite "${suite.id}" declares no datasets.`);
    }

    await preflight(http, ledger, datasetName);
    if (!options.noReset) await reset(http, ledger, datasetName);

    // S1 — ask the trap question before any learning.
    console.log(`\nS1: "${trapCase.question}" (expert, fresh session)`);
    const s1 = await ask(
      http,
      ledger,
      'S1',
      trapCase.question,
      datasetName,
      trapCase,
      createdSessionIds,
    );
    bandBefore = s1.band;
    ledger.assert(
      s1.correct !== true,
      'S1 answers wrong before learning (the trap has not been taught yet)',
    );
    ledger.assert(
      !bandAtLeast(s1.band, 'high'),
      `S1 confidence is not high before learning (got ${s1.band ?? 'unknown'})`,
    );
    if (!bandAtLeast(s1.band, 'medium')) {
      ledger.warn(
        `S1 confidence is low, not medium (${formatBand(s1.score, s1.band)}). ` +
          `cross-check: ${s1.message.crossCheck?.status ?? 'n/a'}` +
          (s1.message.crossCheck?.note ? ` — ${s1.message.crossCheck.note}` : ''),
      );
    }

    // Teach it — post the scripted reviewer notes on S1's answer.
    console.log(`\nTeaching: posting ${scenario.comments.length} reviewer note(s) on S1's answer`);
    let lessonsLearned = 0;
    for (const comment of scenario.comments) {
      const resp = await postComment(http, s1.sessionId, s1.message.at, comment);
      lessonsLearned += resp.lessons?.length ?? 0;
      ledger.info(`${comment.block} (${comment.vote ?? 'no vote'}): ${resp.message}`);
    }
    ledger.assert(
      lessonsLearned >= 1,
      `at least one lesson was learned from the scripted notes (got ${lessonsLearned})`,
    );

    // S2 — ask the same question again, in a new session, after learning.
    console.log(`\nS2: "${trapCase.question}" (expert, fresh session, after learning)`);
    const s2 = await ask(
      http,
      ledger,
      'S2',
      trapCase.question,
      datasetName,
      trapCase,
      createdSessionIds,
    );
    bandAfter = s2.band;
    const s2Correct = ledger.assert(
      s2.correct === true,
      'S2 answers correctly after learning',
    );
    const s2High = ledger.assert(
      bandAtLeast(s2.band, 'high'),
      `S2 confidence is high after learning (got ${s2.band ?? 'unknown'})`,
    );
    if (s2.message.consistency) {
      ledger.assert(
        s2.message.consistency.kind === 'updated',
        `S2 is marked "updated" (the fingerprint moved after learning) — got "${s2.message.consistency.kind}"`,
      );
    } else {
      ledger.warn(
        'S2 carries no consistency field — either S1 was not pin-eligible ' +
          '(check S1 for a clarification, a visual, or a result-guard warning), ' +
          "or S2 reproduced the rows of S1's rejected answer (then S2 is wrong too)",
      );
    }
    if (s2Correct && s2High) liftPassed++;

    // S3 — ask the same question a third time: must be an exact replay.
    console.log(`\nS3: "${trapCase.question}" (expert, fresh session, repeat of S2)`);
    const s3 = await ask(
      http,
      ledger,
      'S3',
      trapCase.question,
      datasetName,
      trapCase,
      createdSessionIds,
    );
    const s3Replay = ledger.assert(
      s3.message.consistency?.kind === 'replay',
      `S3 is a replay of S2 (got consistency "${s3.message.consistency?.kind ?? 'none'}")`,
    );
    const s3Bytes = ledger.assert(
      bytesEqual(s3.message.content, s2.message.content),
      'S3 content is byte-identical to S2',
    );
    const s3Trace = ledger.assert(
      Boolean(s3.message.expertTrace?.id) &&
        s3.message.expertTrace?.id === s2.message.expertTrace?.id,
      'S3 expertTrace.id matches S2 (the trace was replayed, not rebuilt)',
    );
    if (s3Replay && s3Bytes && s3Trace) consistencyPassed++;

    // S4 — the generalisation case: never taught directly, must pass anyway.
    console.log(
      `\nS4: "${generalizationCase.question}" (expert, fresh session, generalisation of ${trapCase.id})`,
    );
    const s4 = await ask(
      http,
      ledger,
      'S4',
      generalizationCase.question,
      datasetName,
      generalizationCase,
      createdSessionIds,
    );
    const s4Correct = ledger.assert(
      s4.correct === true,
      `S4 (${generalizationCase.id}) answers correctly without its own reviewer notes`,
    );
    const s4High = ledger.assert(
      bandAtLeast(s4.band, 'high'),
      `S4 confidence is high (got ${s4.band ?? 'unknown'})`,
    );
    if (s4Correct && s4High) liftPassed++;

    // S5 — a control question with no trap: should already be high confidence.
    console.log(`\nS5: "${controlCase.question}" (expert, fresh session, control)`);
    const s5 = await ask(
      http,
      ledger,
      'S5',
      controlCase.question,
      datasetName,
      controlCase,
      createdSessionIds,
    );
    ledger.assert(
      bandAtLeast(s5.band, 'high'),
      `S5 (control) confidence is high (got ${s5.band ?? 'unknown'})`,
    );

    // S6 — repeat the control question: must replay S5 byte-identically.
    console.log(`\nS6: "${controlCase.question}" (expert, fresh session, repeat of S5)`);
    const s6 = await ask(
      http,
      ledger,
      'S6',
      controlCase.question,
      datasetName,
      controlCase,
      createdSessionIds,
    );
    const s6Replay = ledger.assert(
      s6.message.consistency?.kind === 'replay',
      `S6 is a replay of S5 (got consistency "${s6.message.consistency?.kind ?? 'none'}")`,
    );
    const s6Bytes = ledger.assert(
      bytesEqual(s6.message.content, s5.message.content),
      'S6 content is byte-identical to S5',
    );
    if (s6Replay && s6Bytes) consistencyPassed++;
  } catch (err) {
    ledger.failures.push(message(err));
    console.error(`\n✖ ${message(err)}`);
  } finally {
    if (!options.keepSessions && createdSessionIds.length) {
      console.log(`\nCleaning up ${createdSessionIds.length} throwaway session(s)...`);
      for (const id of createdSessionIds) await deleteSession(http, id);
    } else if (options.keepSessions && createdSessionIds.length) {
      console.log(`\n--keep-sessions: leaving ${createdSessionIds.length} session(s) in place.`);
    }
  }

  console.log('');
  for (const line of formatReportTable(ledger.rows)) console.log(line);
  console.log('');
  console.log(
    formatSummary({
      liftPassed,
      liftTotal,
      bandBefore,
      bandAfter,
      consistencyPassed,
      consistencyTotal,
    }),
  );

  if (ledger.warnings.length) {
    console.log(`\n${ledger.warnings.length} warning(s):`);
    for (const w of ledger.warnings) console.log(`  ⚠ ${w}`);
  }
  if (ledger.failures.length) {
    console.log(`\n${ledger.failures.length} failure(s):`);
    for (const f of ledger.failures) console.log(`  ✖ ${f}`);
    return 1;
  }
  console.log('\nAll assertions passed.');
  return 0;
}

export { parseArgs, findCase, DemoSetupError, type Options };

if (require.main === module) {
  main()
    .then((code) => process.exit(code))
    .catch((error: unknown) => {
      if (error instanceof DemoSetupError) {
        console.error(`\n✖ ${error.message}\n`);
      } else {
        console.error('\n✖ learning-demo crashed:');
        console.error(error);
      }
      process.exit(1);
    });
}
