/**
 * An agent step's work, step by step, in plain words (ui.md 4.4b, *Agents at
 * work*): each tool call becomes one line that says what the agent did — its
 * own stated reason when it gave one, else a phrase for the tool — with its
 * state, its rows and, for a tooltip, the technical details. Pure, so the
 * Run panel's team, its live block and their tests share it.
 */

/** A tool call as the activity reads it: a stored call, or a streamed one. */
export interface ActivityCall {
  tool: string;
  input?: string;
  /** Why the agent made the call, in its words. */
  rationale?: string;
  rowCount?: number;
  error?: string;
  durationMs?: number;
  /** A streamed call: false until its result arrived. Absent for a stored call. */
  finished?: boolean;
  /** The latest progress message of a long-running tool. */
  progress?: string;
  /** Who made it, when the step's agent delegates: Avery signs her own calls. */
  agent?: string;
  /** A team call (Avery's): the agent it hands the work to. */
  teammate?: string;
}

/** `current` is the one step under way; there is at most one. */
export type ActivityState = 'done' | 'current' | 'failed';

export interface ActivityStep {
  /** What the agent did or is doing, in business words. */
  label: string;
  state: ActivityState;
  /** `1 row`, `66 rows`; null when the call returns no rows. */
  rows: string | null;
  /** A SQL query: its line opens the step's queries. */
  query: boolean;
  /** The tool's own name, for the tooltip and tests. */
  tool: string;
  /** The tooltip's technical line: `run_readonly_sql · 66 rows · 0.4 s`. */
  detail: string;
  /** What the call was about (its brief, skill file or table), as it came. */
  input?: string;
  /** Who made it, when the step's agent delegates: Avery signs her own calls. */
  agent?: string;
  /** A team call (Avery's): the agent it hands the work to. */
  teammate?: string;
}

/** What a tool call is said to do, in three forms. */
export interface ToolPhrase {
  /** After `Couldn't`: `read the columns of goals`. */
  base: string;
  /** Once done: `Read the columns of goals`. */
  done: string;
  /** While it runs: `Reading the columns of goals`. */
  doing: string;
}

/** A tool's own name, without any namespace prefix (`mcp.x.list_entities`). */
export function shortToolName(tool: string): string {
  return tool.replace(/^.*?([a-z_]+)$/, '$1');
}

/** Whether a call is a SQL query. */
export function isQueryTool(tool: string): boolean {
  return tool.endsWith('run_readonly_sql');
}

/**
 * A tool call said as a person would. `input` names what it is about: the
 * table (`db.public.goals` reads as `goals`) or the skill.
 */
export function toolPhrase(tool: string, input?: string): ToolPhrase {
  const name = shortToolName(tool);
  const table = input ? (input.split('.').pop() ?? input).trim() : '';
  const skill = input ? humanise(input.split('/')[0]) : '';
  const forms = (verb: [string, string, string], object: string) => ({
    base: `${verb[0]} ${object}`,
    done: `${capitalise(verb[1])} ${object}`,
    doing: `${capitalise(verb[2])} ${object}`,
  });
  switch (name) {
    case 'list_entities':
      return forms(['look at', 'looked at', 'looking at'], 'the tables');
    case 'describe_entity':
      return forms(
        ['read', 'read', 'reading'],
        table ? `the columns of ${table}` : 'the columns',
      );
    case 'sample_rows':
      return forms(
        ['sample', 'sampled', 'sampling'],
        table ? `a few rows of ${table}` : 'a few rows',
      );
    case 'run_readonly_sql':
      return forms(['run', 'ran', 'running'], 'a query');
    case 'explore_result':
      return forms(['explore', 'explored', 'exploring'], 'a result');
    case 'ask_clarification':
      return forms(['ask', 'asked', 'asking'], 'you a question');
    case 'skill':
    case 'skill_read':
      return forms(
        ['read', 'read', 'reading'],
        skill ? `the ${skill} skill` : 'a skill',
      );
    case 'skill_search':
      return forms(['search', 'searched', 'searching'], 'the skills');
    case 'create_visual':
      return forms(['build', 'built', 'building'], 'the visual');
    case 'update_visual':
      return forms(['update', 'updated', 'updating'], 'the visual');
    default:
      return forms(['use', 'used', 'using'], humanise(name));
  }
}

/**
 * Each call of a step as one line, in order. While the step streams
 * (`live`), the latest call still waiting for its result is the `current`
 * one; any earlier unfinished call reads as done, so at most one spinner
 * shows.
 */
export function activitySteps(
  calls: readonly ActivityCall[],
  live: boolean,
): ActivityStep[] {
  let current = -1;
  if (live) {
    for (let i = calls.length - 1; i >= 0; i--) {
      if (calls[i].finished === false) {
        current = i;
        break;
      }
    }
  }
  return calls.map((call, i) => stepOf(call, i === current));
}

function stepOf(call: ActivityCall, current: boolean): ActivityStep {
  const query = isQueryTool(call.tool);
  const phrase = toolPhrase(call.tool, call.input);
  const reason = statedReason(call.rationale);
  const rows =
    call.rowCount !== undefined && !call.error
      ? `${call.rowCount} ${call.rowCount === 1 ? 'row' : 'rows'}`
      : null;
  const detail = [
    shortToolName(call.tool),
    rows,
    call.durationMs !== undefined ? seconds(call.durationMs) : null,
    call.error ? clip(call.error, 200) : null,
  ]
    .filter((part): part is string => !!part)
    .join(' · ');
  let state: ActivityState = 'done';
  let label: string;
  if (call.error) {
    state = 'failed';
    label = query
      ? `Couldn't run this query${reason ? `: ${lowerFirst(reason)}` : ''}`
      : `Couldn't ${phrase.base}`;
  } else if (current) {
    state = 'current';
    label = reason || `${phrase.doing}…`;
    if (call.progress) label = `${label} · ${call.progress}`;
  } else {
    label = reason || phrase.done;
  }
  return {
    label,
    state,
    rows,
    query,
    tool: shortToolName(call.tool),
    detail,
    ...(call.input ? { input: call.input } : {}),
    ...(call.agent ? { agent: call.agent } : {}),
    ...(call.teammate ? { teammate: call.teammate } : {}),
  };
}

/**
 * The agent's reason as a step's words: one line, without a leading
 * `I'm` / `I am` / `I'll` / `I will`, so `I'm checking the stages.` reads
 * `Checking the stages.`, the same whether the step is done or under way.
 */
function statedReason(rationale: string | undefined): string {
  const flat = rationale?.replace(/\s+/g, ' ').trim() ?? '';
  const bare = flat.replace(/^(?:I['’]m|I am|I['’]ll|I will)\s+/i, '');
  return bare ? capitalise(bare) : '';
}

/** Words a tool or skill name may hold that read as capitals. */
const ACRONYMS = new Set(['sql', 'csv', 'kpi', 'api', 'ai', 'bi', 'url', 'id']);

/** `sql-analysis` → `SQL analysis`. */
function humanise(name: string): string {
  return name
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((word) =>
      ACRONYMS.has(word.toLowerCase()) ? word.toUpperCase() : word,
    )
    .join(' ');
}

function capitalise(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function lowerFirst(text: string): string {
  // A sentence's first word, not an acronym (`SQL` stays).
  return /^[A-Z][a-z]/.test(text)
    ? text.charAt(0).toLowerCase() + text.slice(1)
    : text;
}

function seconds(ms: number): string {
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`;
}

function clip(text: string, max: number): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}
