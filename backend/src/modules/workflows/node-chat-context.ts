/**
 * A node chat (api.md 136, 137; agents.md 5.16; data-model 3.17): its stored
 * message shape, and the context block its agent turn receives, built from
 * the stored run, never from the client. Plain data and pure functions, no
 * framework import, so Jest reads them without loading Mastra.
 */
import type {
  WorkflowRunDoc,
  WorkflowRunStep,
  WorkflowRunToolCall,
} from './workflow-run-steps';
import { STEP_OUTPUT_CAP } from './workflow-run-steps';

/** One message of a node chat, as stored and as the API shows it. */
export interface NodeChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  /** Assistant messages: the turn's tool calls, in call order. */
  toolCalls?: WorkflowRunToolCall[];
  /** Assistant messages: the turn was stopped; `content` is what came. */
  stopped?: true;
  /** Assistant messages: why the turn failed. */
  error?: string;
  createdAt: string;
}

/**
 * The longest context block, in characters. Measured (2026-11-12): the
 * Analyse step of a real-shaped Questions to Insights v2 run over the World
 * Cup dataset (15 entities, 7 tool calls of which 4 real SQL queries, a
 * 1 500-character answer) gives about 7 200 characters; the largest step a
 * run can store (20 000-character input and output, 50 calls of 2 000
 * characters) about 144 000. 40 000 (some 10 000 tokens) keeps every real
 * run whole and bounds the worst case.
 */
export const NODE_CHAT_CONTEXT_CAP = 40_000;

/** The most earlier messages of a node chat a turn replays. */
export const NODE_CHAT_HISTORY_LIMIT = 20;

/** The line that opens a block in which something was shortened. */
export const SHORTENED_NOTE =
  'Note: some parts below were shortened to fit; each is marked "[shortened: …]". Use your tools to look at the data again when you need more.';

/** One part of the block: fixed (never cut) or cuttable. */
interface Part {
  text: string;
  cuttable: boolean;
}

function json(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

/** A cuttable part cut to `limit` characters, marked as shortened. */
function shorten(text: string, limit: number): string {
  if (text.length <= limit) return text;
  return `${text.slice(0, Math.max(0, limit))}\n[shortened: ${limit} of ${text.length} characters shown]`;
}

function toolCallLines(calls: readonly WorkflowRunToolCall[]): string {
  return calls
    .map((call, index) => {
      const facts = [
        typeof call.rowCount === 'number' ? `${call.rowCount} rows` : '',
        call.error ? `error: ${call.error}` : '',
      ].filter(Boolean);
      const head = `${index + 1}. ${call.tool}${facts.length ? ` (${facts.join('; ')})` : ''}`;
      return call.input ? `${head}\n${call.input}` : head;
    })
    .join('\n\n');
}

function stepDataPart(
  step: WorkflowRunStep,
  which: 'input' | 'output',
): string {
  const value = step[which];
  if (value) return json(value);
  const truncated =
    which === 'input' ? step.inputTruncated : step.outputTruncated;
  return truncated
    ? `(not kept: larger than ${STEP_OUTPUT_CAP} characters when the run stored it)`
    : '(none recorded)';
}

/**
 * The cut every cuttable part gets so the block fits `budget`: the largest
 * per-part length L with sum(min(length, L)) <= budget (water-filling), so
 * short parts stay whole and only the long ones are shortened.
 */
function partLimit(lengths: readonly number[], budget: number): number {
  const sorted = [...lengths].sort((a, b) => a - b);
  let remaining = Math.max(0, budget);
  for (let i = 0; i < sorted.length; i += 1) {
    const share = Math.floor(remaining / (sorted.length - i));
    if (sorted[i] > share) return share;
    remaining -= sorted[i];
  }
  return Infinity;
}

/**
 * The context block of a node chat turn (agents.md 5.16): what the run was,
 * the workflow input, the step's status and error, its input and output as
 * stored, its tool calls (tool, input or SQL, rows, error), and the run's
 * final answer when there is one. At most `cap` characters: when it is
 * larger, the longest parts are shortened (marked `[shortened: …]`) and the
 * block opens with `SHORTENED_NOTE`. `stepId` must name a step of the run.
 */
export function nodeChatContextBlock(
  run: WorkflowRunDoc,
  stepId: string,
  cap: number = NODE_CHAT_CONTEXT_CAP,
): string {
  // A step that ran more than once (v2's analysis loop): its last attempt.
  const step = run.steps.findLast((candidate) => candidate.id === stepId);
  if (!step) throw new Error(`Step "${stepId}" is not in run "${run.id}"`);
  const attempts = run.steps.filter((candidate) => candidate.id === stepId);
  const calls = step.toolCalls ?? [];
  const parts: Part[] = [
    {
      cuttable: false,
      text: [
        `You are answering questions about one step of a stored workflow run: step "${step.title}" (${step.id}) of run ${run.id} of "${run.workflowName}".`,
        "The run is finished and nothing you do changes it. Use what is below as the step's data; your tools are read-only and work on the run's datasets.",
        `Run status: ${run.status}${run.error ? ` (error: ${run.error})` : ''}. Started ${run.startedAt}${run.finishedAt ? `, finished ${run.finishedAt}` : ''}.`,
        `Datasets: ${run.datasets.length ? run.datasets.join(', ') : '(none)'}.`,
        '',
        '## Workflow input',
      ].join('\n'),
    },
    { cuttable: true, text: json(run.input) },
    {
      cuttable: false,
      text: [
        '',
        `## Step "${step.title}": ${step.status}`,
        ...(attempts.length > 1
          ? [
              `This is attempt ${step.attempt ?? attempts.length} of ${attempts.length}: the step ran again after its validation failed.`,
            ]
          : []),
        ...(step.error ? [`Error: ${step.error}`] : []),
        ...(step.startedAt
          ? [
              `Started ${step.startedAt}${step.endedAt ? `, ended ${step.endedAt}` : ''}.`,
            ]
          : []),
        '',
        '### Step input',
      ].join('\n'),
    },
    { cuttable: true, text: stepDataPart(step, 'input') },
    { cuttable: false, text: '\n### Step output' },
    { cuttable: true, text: stepDataPart(step, 'output') },
    {
      cuttable: false,
      text: `\n### Tool calls of the step (${calls.length})`,
    },
    {
      cuttable: true,
      text: calls.length ? toolCallLines(calls) : '(none)',
    },
  ];
  const answer = run.answer?.content?.trim();
  if (answer) {
    parts.push(
      { cuttable: false, text: '\n## Final answer of the run' },
      { cuttable: true, text: answer },
    );
  }
  const whole = parts.map((part) => part.text).join('\n');
  if (whole.length <= cap) return whole;

  // Shorten: the note and the fixed parts first, the rest shared out.
  const marker = '\n[shortened: 00000000 of 00000000 characters shown]';
  const cuttable = parts.filter((part) => part.cuttable);
  const fixed =
    SHORTENED_NOTE.length +
    1 +
    parts
      .filter((part) => !part.cuttable)
      .reduce((sum, part) => sum + part.text.length, 0) +
    (parts.length - 1) +
    cuttable.length * marker.length;
  const limit = partLimit(
    cuttable.map((part) => part.text.length),
    cap - fixed,
  );
  const shortened = parts.map((part) =>
    part.cuttable ? shorten(part.text, limit) : part.text,
  );
  return [SHORTENED_NOTE, ...shortened].join('\n').slice(0, cap);
}
