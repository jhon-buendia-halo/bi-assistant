// Elena's turn (plan Elena 2.4): one agent alone, over the conversation's
// datasets. The host opens her gated tools, runs her attempt through the
// turn engine's analysis consumer, checks it in code (agents.md 5.11
// Validate) and, when a check fails, runs exactly one repair round with the
// findings. Her dashboard is saved once, from her last accepted submission.
import {
  loadCatalog,
  planCatalogBlock,
  validateAttempt,
  type AnalyseAttempt,
  type AnalyseRuntime,
  type AnsweredClarification,
  type ValidationFinding,
} from '../../../mastra/workflows/analysis.steps';
import { earlierQueriesBlock } from '../../../mastra/workflows/analysis.prompts';
import { currentDashboardBlock } from '../../../mastra/workflows/bi-analyst.prompts';
import {
  CONVERSATION_GATES_CONTEXT_KEY,
  type ConversationGates,
} from '../../../mastra/workflows/conversation-turn.steps';
import { briefPlan } from '../../../mastra/workflows/orchestrated-answer-michael.prompts';
import {
  DASHBOARD_TOOLS_RUNTIME_KEY,
  type DashboardToolsRuntime,
} from '../../../mastra/tools/dashboard.tools';
import { EXPORT_TOOLS_RUNTIME_KEY } from '../../../mastra/tools/export.tools';
import type {
  CurrentDashboard,
  DashboardRef,
} from '../../artifacts/entities/artifact.entity';
import type { ConversationTurns } from '../../conversation-export/conversation-export.contract';
import {
  conversationFacts,
  conversationQueriesBlock,
  exportRuntime,
  type OrchestratorState,
  type OrchestratorTeam,
  type OrchestratorTurnDeps,
} from './orchestrator-turn';

/** The cue her prompt's last rule fires on: the repair round's block. */
export const SOLO_REPAIR_HEADER = 'Checks on your answer failed:';

/** The tool she builds a dashboard with. */
const SUBMIT_DASHBOARD = 'submit_dashboard';

/** What her turn keeps: it outlives a wait for the user's answer. */
export interface SoloTurnState extends OrchestratorState {
  /** The attempt the turn is in (1, or 2 in the repair round). */
  attempt?: number;
  /** The repair round's block, kept for a repair resumed after a question. */
  repair?: string;
  /** Attempt 1, kept while the repair round runs: a retry error keeps it. */
  first?: { text: string; findings: ValidationFinding[] };
}

/** A dashboard submission the host accepted (the turn engine's). */
export interface SoloAcceptedDashboard<T = unknown> {
  accepted(): T | undefined;
  save(
    accepted: T,
    current: CurrentDashboard | undefined,
    instruction: string,
  ): Promise<{ ref: DashboardRef; saved: CurrentDashboard }>;
}

/** What Elena's turn needs from the turn engine. */
export interface SoloTurnDeps<T = unknown> {
  /** One attempt of the session agent's (her) stream, with its records. */
  analyse: AnalyseRuntime['analyse'];
  state: SoloTurnState;
  datasets: string[];
  signal: AbortSignal;
  /** The turn's requestContext: her tools and skills read the gates there. */
  requestContext: { set(key: string, value: unknown): void };
  /** The user's message. */
  message: string;
  /** The conversation's dashboard (its current version), when it has one. */
  currentDashboard?: CurrentDashboard;
  /**
   * The dashboard gate's submitter (the user asked for a dashboard, or the
   * conversation has one); absent when dashboards are not available.
   */
  dashboard?: { runtime: DashboardToolsRuntime } & SoloAcceptedDashboard<T>;
  /** The dashboard gate: the message asks for a dashboard. */
  asksForDashboard: boolean;
  /** The export gate open: the conversation's turns and the export. */
  exporting?: {
    turns: ConversationTurns;
    run: NonNullable<OrchestratorTeam['exportConversation']>;
  };
  /** The queries behind the conversation's last answer, on a follow-up. */
  earlierQueries?: OrchestratorTurnDeps['earlierQueries'];
  /** Load the catalog (the analysis' own; a test's stub). */
  loadCatalog?: typeof loadCatalog;
}

/** How her turn ended (the conversation step's runtime result). */
export interface SoloTurnResult {
  answer: string;
  stopped: boolean;
  clarification?: { question: string; options: string[] };
  /** 1, or 2 after a repair round. */
  attempts: number;
  /** The last attempt's findings (`ChatMessage.checks`). */
  checks: ValidationFinding[];
}

/** The failed checks as the repair round's block reads them. */
export function repairBlock(
  findings: readonly ValidationFinding[],
  attempt: Pick<AnalyseAttempt, 'queries' | 'text'>,
): string {
  const failed = findings.filter((finding) => !finding.passed);
  const earlier = earlierQueriesBlock(attempt.queries, findings);
  return [
    SOLO_REPAIR_HEADER,
    ...failed.map((finding) => `- ${finding.check}: ${finding.detail}`),
    ...(attempt.text.trim()
      ? ['', 'Your answer before the checks:', attempt.text.trim()]
      : []),
    ...(earlier ? ['', earlier] : []),
  ].join('\n');
}

/** Whether a turn's attempt is checked (plan Elena 2.4 step 6). */
function isChecked(attempt: AnalyseAttempt, exported: boolean): boolean {
  if (attempt.clarification) return false;
  // A plain reply ("thanks"): no tool called and no figure stated, so no
  // claim from the data to check. A figure with no query is still repaired.
  if (attempt.calls.length === 0 && !/\d/.test(attempt.text)) return false;
  // An export-only message runs no query: nothing to check.
  const ranQuery = attempt.calls.some(
    (call) => call.tool === 'run_readonly_sql',
  );
  return ranQuery || !exported;
}

/**
 * Elena's turn: her gates, her tools' runtimes, attempt 1 and, when a check
 * fails, exactly one repair round; then her dashboard, saved once.
 */
export async function runSoloTurn<T>(
  deps: SoloTurnDeps<T>,
  input: { question: string; answered?: AnsweredClarification },
): Promise<SoloTurnResult> {
  const { state } = deps;
  const question = input.question;
  // The gates (plan Elena 2.3): her tools and skills read them.
  const gates: ConversationGates = {
    dashboard:
      !!deps.dashboard &&
      (deps.asksForDashboard || deps.currentDashboard !== undefined),
    export: deps.exporting !== undefined,
  };
  deps.requestContext.set(CONVERSATION_GATES_CONTEXT_KEY, gates);
  if (gates.dashboard && deps.dashboard) {
    deps.requestContext.set(
      DASHBOARD_TOOLS_RUNTIME_KEY,
      deps.dashboard.runtime,
    );
  }
  if (deps.exporting) {
    deps.requestContext.set(
      EXPORT_TOOLS_RUNTIME_KEY,
      exportRuntime(state, deps.exporting.turns, {
        exportConversation: deps.exporting.run,
      }),
    );
  }
  if (!state.catalog || !state.columns) {
    const loaded = await (deps.loadCatalog ?? loadCatalog)(deps.datasets);
    state.catalog = loaded.catalog;
    state.columns = loaded.columns;
  }
  const catalog = state.catalog;
  const catalogBlock = planCatalogBlock(catalog, state.columns, { question });
  // Her facts (plan Elena 2.4 step 4): the datasets, the open gates, the
  // conversation's dashboard, then the last answer's queries.
  const facts = [
    `Run facts: datasets ${deps.datasets.length ? deps.datasets.join(', ') : 'none'}.`,
    ...conversationFacts(
      {
        buildsDashboard: gates.dashboard,
        ...(deps.currentDashboard
          ? { currentDashboard: deps.currentDashboard }
          : {}),
        exportsConversation: gates.export,
        ...(deps.exporting ? { earlierTurns: deps.exporting.turns } : {}),
      },
      SUBMIT_DASHBOARD,
    ),
    ...(gates.dashboard && deps.currentDashboard
      ? ['', currentDashboardBlock(deps.currentDashboard, 'the user')]
      : []),
  ].join('\n');
  const earlier = conversationQueriesBlock(deps.earlierQueries);
  const planBlock = (repair?: string) =>
    [facts, earlier, repair].filter((block) => block?.trim()).join('\n\n');
  const plan = briefPlan(question);
  const run = (attempt: number, repair?: string) =>
    deps.analyse({
      question,
      catalog,
      catalogBlock,
      plan,
      attempt,
      planBlock: planBlock(repair),
      ...(input.answered ? { answered: input.answered } : {}),
    });
  const check = (attempt: AnalyseAttempt) =>
    validateAttempt({
      plan,
      calls: attempt.calls,
      queries: attempt.queries,
      catalog,
      question,
    });
  const exported = () => state.export !== undefined;

  // Resumed after her question: the attempt she asked in goes on.
  let attemptNumber = input.answered ? (state.attempt ?? 1) : 1;
  state.attempt = attemptNumber;
  state.attempts = attemptNumber;
  let current = await run(
    attemptNumber,
    attemptNumber > 1 ? state.repair : undefined,
  );
  if (current.clarification && !current.stopped) {
    return {
      answer: '',
      stopped: false,
      clarification: current.clarification,
      attempts: attemptNumber,
      checks: state.findings,
    };
  }
  let text = current.text;
  if (attemptNumber === 1) {
    const checked = isChecked(current, exported())
      ? check(current)
      : { ok: true, findings: [] as ValidationFinding[] };
    state.findings = checked.findings;
    if (!checked.ok && !current.stopped) {
      // One repair round (plan Elena 2.4 step 7): the failed checks, her
      // answer and her queries; a retry's error keeps attempt 1.
      state.first = { text: current.text, findings: checked.findings };
      state.repair = repairBlock(checked.findings, current);
      attemptNumber = 2;
      state.attempt = 2;
      state.attempts = 2;
      current = await run(2, state.repair);
      if (current.clarification && !current.stopped) {
        return {
          answer: '',
          stopped: false,
          clarification: current.clarification,
          attempts: 2,
          checks: state.findings,
        };
      }
    }
  }
  if (attemptNumber === 2) {
    if (current.retryError !== undefined) {
      state.findings = state.first?.findings ?? state.findings;
      text = state.first?.text ?? '';
    } else {
      state.findings = isChecked(current, exported())
        ? check(current).findings
        : [];
      text = current.text.trim() ? current.text : (state.first?.text ?? '');
    }
  }
  const stopped = current.stopped || deps.signal.aborted;
  let answer = text.trim();
  // Her dashboard (plan Elena 2.4 step 8): saved once, from the last
  // accepted submission of the turn, its instruction the user's message.
  const accepted = gates.dashboard ? deps.dashboard?.accepted() : undefined;
  if (accepted !== undefined && deps.dashboard && !stopped) {
    try {
      const { ref, saved } = await deps.dashboard.save(
        accepted,
        deps.currentDashboard,
        deps.message,
      );
      state.dashboard = ref;
      state.builtDashboard = saved;
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      answer = [answer, `The dashboard could not be saved: ${reason}`]
        .filter(Boolean)
        .join('\n\n');
    }
  }
  return {
    answer,
    stopped,
    attempts: attemptNumber,
    checks: state.findings,
  };
}
