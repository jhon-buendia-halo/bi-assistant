import { WorkflowTeamMember } from '../models/workflow.model';
import { ActivityState, ActivityStep } from './agent-activity';

/**
 * An orchestrator's step told as a relay (ui.md 4.4b *relay*): Avery's own
 * steps in her words, and each hand-off to a teammate followed by that
 * teammate's own work, nested under it. Built from the step's activity: her
 * calls are signed (`agent`), a team call names its teammate (`teammate`),
 * and the unsigned calls after a team call are that teammate's, up to her
 * next own call. A pure function of the activity and the step's team.
 */

/** A teammate as the relay names it: their portrait key, name and job title. */
export interface RelayTeammate {
  key: string;
  name: string;
  role: string;
}

/** One of Avery's own steps, in her words. */
export interface RelayStep {
  kind: 'step';
  step: ActivityStep;
}

/** A hand-off and the teammate's work under it. */
export interface RelayHandOff {
  kind: 'teammate';
  teammate: RelayTeammate;
  /** The teammate's own steps, then what they handed back (`Wrote the answer`). */
  steps: ActivityStep[];
  /** The SQL queries among their steps. */
  queries: number;
  /** The team call's state: `current` while the teammate works. */
  state: ActivityState;
  /** What Avery asked them, in a line (her brief's question); absent without a brief. */
  asked?: string;
}

export type RelayItem = RelayStep | RelayHandOff;

/** A stored query of the answer (`answer.data`), as a relay matches it. */
export interface RelayRecord {
  tool: string;
  input?: string;
  rationale?: string;
}

/** Where a query sits in a relay: whose it is, and which of their queries. */
export interface RelayQueryPlace {
  teammate: RelayTeammate;
  /** 1-based, among the teammate's queries in this hand-off. */
  position: number;
  of: number;
  asked?: string;
}

/**
 * Whether a stored record and a relay step are the same query: their SQL,
 * whitespace aside (a step's is clipped at 2 000 characters), else, with no
 * SQL on one side, their stated reason.
 */
export function sameQuery(record: RelayRecord, step: ActivityStep): boolean {
  if (!record.tool.endsWith('run_readonly_sql') || !step.query) return false;
  const flat = (text: string | undefined) =>
    (text ?? '').replace(/\s+/g, ' ').trim().slice(0, 1900);
  if (record.input && step.input)
    return flat(record.input) === flat(step.input);
  const reason = flat(record.rationale);
  return !!reason && flat(step.label).startsWith(reason.slice(0, 120));
}

/** The answer record (`answer.data` index) of a relay's query step; -1 when none matches. */
export function recordIndexOf(
  data: readonly RelayRecord[] | undefined,
  step: ActivityStep,
): number {
  return (data ?? []).findIndex((record) => sameQuery(record, step));
}

/** Whose query a stored record is in a relay, and which of theirs; null when no teammate ran it. */
export function relayQueryOf(
  items: readonly RelayItem[] | null | undefined,
  record: RelayRecord | undefined,
): RelayQueryPlace | null {
  if (!items || !record) return null;
  for (const item of items) {
    if (item.kind !== 'teammate') continue;
    const queries = item.steps.filter((s) => s.query);
    const at = queries.findIndex((s) => sameQuery(record, s));
    if (at >= 0) {
      return {
        teammate: item.teammate,
        position: at + 1,
        of: queries.length,
        ...(item.asked ? { asked: item.asked } : {}),
      };
    }
  }
  return null;
}

/** Avery's playbooks (avery-playbooks `reference/`), as she would name them. */
const PLAYBOOKS: Record<string, string> = {
  ranking: 'how to rank, ties included',
  'period-change': 'how to explain a change between two periods',
  ambiguous: 'how to handle a question with two readings',
  'failed-check': 'how to fix a check that did not pass',
  'no-answer': "what to do when the data can't answer it all",
};

/** What each team call asks for, after the teammate's name. */
const ASKS: Record<string, string> = {
  plan_analysis: ' for a plan',
  write_answer: ' to write the answer',
  read_reference_images: ' to read the images',
  build_visual: ' for a chart',
  build_dashboard: ' for a dashboard',
};

/** What a teammate hands back once their call is done, by the tool that called them. */
const HANDED_BACK: Record<string, string> = {
  answer_from_data: 'Wrote the answer',
  plan_analysis: 'Made the plan',
  write_answer: 'Wrote the answer',
  read_reference_images: 'Read the images',
  build_visual: 'Built the chart',
  build_dashboard: 'Built the dashboard',
};

/** The relay of a delegating step; empty when its activity holds no signed call. */
export function relayOf(
  activity: readonly ActivityStep[],
  team: readonly WorkflowTeamMember[],
): RelayItem[] {
  if (!activity.some((step) => step.agent)) return [];
  const items: RelayItem[] = [];
  let open: RelayHandOff | null = null;
  for (const step of activity) {
    if (!step.agent) {
      // A teammate's own call, under the hand-off it follows.
      if (open) {
        open.steps.push(step);
        if (step.query) open.queries += 1;
      } else {
        items.push({ kind: 'step', step });
      }
      continue;
    }
    if (open) close(open);
    open = null;
    const teammate = step.teammate
      ? teammateOf(step.teammate, step.tool, team)
      : null;
    items.push({
      kind: 'step',
      step: { ...step, label: averyLabel(step, teammate) },
    });
    if (teammate) {
      open = {
        kind: 'teammate',
        teammate,
        steps: [],
        queries: 0,
        state: step.state,
        ...(step.input ? { asked: briefLead(step.input) } : {}),
      };
      items.push(open);
    }
  }
  if (open) close(open);
  return items;

  /** A hand-off ends with what the teammate handed back, or that they work on. */
  function close(handOff: RelayHandOff): void {
    const ask = [...items]
      .reverse()
      .find(
        (item): item is RelayStep =>
          item.kind === 'step' && item.step.teammate === handOff.teammate.key,
      );
    const tool = ask?.step.tool ?? '';
    // While a teammate's own call runs, the hand-off is still under way.
    if (handOff.steps.some((s) => s.state === 'current')) {
      handOff.state = 'current';
    }
    if (handOff.state === 'current') {
      if (handOff.steps.length === 0) {
        handOff.steps.push(line('Working on it…', 'current'));
      }
      return;
    }
    if (handOff.state === 'done' && HANDED_BACK[tool]) {
      handOff.steps.push(line(HANDED_BACK[tool], 'done'));
    }
  }
}

/**
 * Avery's sentence over her relay: who she asked, then that she checked the
 * answer; null when she asked no one (the step's own sentence stands).
 */
export function relaySentence(
  state: 'active' | 'done' | string,
  items: readonly RelayItem[],
): string | null {
  const names = [
    ...new Set(
      items
        .filter((item): item is RelayHandOff => item.kind === 'teammate')
        .map((item) => item.teammate.name),
    ),
  ];
  if (names.length === 0) return null;
  const who = listOf(names);
  if (state === 'active') return `Working with ${who} on your question.`;
  if (state === 'done') {
    return `I asked ${who} to work on your question, then checked the answer before handing it to you.`;
  }
  return null;
}

/** One of Avery's steps in her words; any other call keeps its line. */
function averyLabel(
  step: ActivityStep,
  teammate: RelayTeammate | null,
): string {
  const doing = step.state === 'current';
  const failed = step.state === 'failed';
  if (teammate) {
    const brief = step.input ? `: “${briefLead(step.input)}”` : '';
    const ask = ASKS[step.tool] ?? '';
    if (failed) return `Couldn't reach ${teammate.name}`;
    return `${doing ? 'Asking' : 'Asked'} ${teammate.name}${ask}${brief}`;
  }
  switch (step.tool) {
    case 'skill':
      return doing
        ? 'Checking my playbook for this kind of question…'
        : 'Checked my playbook for this kind of question';
    case 'skill_read': {
      const page = playbookOf(step.input);
      const what = page ? `${page}` : 'a page of my playbook';
      return doing ? `Reading ${what}…` : `Read ${what}`;
    }
    case 'ask_clarification':
      return doing ? 'Asking you a question…' : 'Asked you a question';
    default:
      return step.label;
  }
}

/** `references/no-answer.md` → `what to do when the data can't answer it all`. */
function playbookOf(path: string | undefined): string | null {
  const file = path?.split('/').pop()?.replace(/\.md$/, '');
  return file && PLAYBOOKS[file] ? PLAYBOOKS[file] : null;
}

function teammateOf(
  key: string,
  tool: string,
  team: readonly WorkflowTeamMember[],
): RelayTeammate {
  const member =
    team.find((m) => m.key === key && m.tool === tool) ??
    team.find((m) => m.key === key);
  return { key, name: member?.name ?? key, role: member?.role ?? '' };
}

function line(label: string, state: ActivityState): ActivityStep {
  return { label, state, rows: null, query: false, tool: '', detail: '' };
}

/**
 * What a brief asks, in a line: the question it quotes (a brief starts with
 * the user's question restated, often quoted: `User's question: "…?" …`),
 * else its first sentence; at most 140 characters.
 */
function briefLead(brief: string): string {
  const flat = brief.replace(/\s+/g, ' ').trim();
  const quoted = /["“«]([^"”»]{3,200}?\?)["”»]/.exec(flat)?.[1];
  if (quoted) return clip(quoted, 140);
  const sentence = /^.*?[.?!](?=\s|$)/.exec(flat)?.[0] ?? flat;
  return clip(sentence, 140);
}

function clip(text: string, max: number): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1).trimEnd()}…` : flat;
}

/** `Olivia`, `Olivia and Michael`, `Olivia, Michael and Jessica`. */
function listOf(names: readonly string[]): string {
  if (names.length <= 1) return names.join('');
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}
