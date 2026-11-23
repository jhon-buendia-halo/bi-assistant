/**
 * A step's story (ui.md 4.4b, Logs *Story*; api.md 3.6 `step.story`): what
 * one step of a run did, told in business words. A workflow tells its own
 * steps (`StepStoryteller`); any
 * other step gets the generic story, its output fields labelled with their
 * schema descriptions. Built only from the run's data, never by a model
 * call. Plain data and pure functions, no framework import, so the run
 * tracker, the run service and Jest share it.
 */
import type { JsonSchema } from './workflow-contract';

/** One labelled fact under a story's headline. */
export interface StoryFact {
  label: string;
  /** One value reads as text; more read as a list. */
  values: string[];
  /** The values are names from the data (tables, columns): shown as code. */
  code?: true;
  /** A check's verdict, when the fact is one. */
  verdict?: 'passed' | 'failed';
  /** A query fact: its statement, so a reader can open it among the answer's queries. */
  sql?: string;
}

/** One figure of the run (the Logs' All nodes header). */
export interface StoryStat {
  value: string;
  label: string;
}

/**
 * What one step did, as the Logs' Story tells it. `source` is `step` when
 * the workflow's own storyteller wrote it, `generic` when it was built from
 * the step's output and schema.
 */
export interface StepStory {
  /** One sentence: what the step did, or why it did not run. */
  headline: string;
  facts?: StoryFact[];
  /** What came next because of it (a branch taken, a retry). */
  next?: string;
  /** The run's figures this step accounts for (its last attempt's count). */
  stats?: StoryStat[];
  /**
   * A few words for the canvas node (ui.md 4.4b): `9 tables`, `3 queries`,
   * `1 of 5 checks failed`, `Off for this run`; absent when the headline's
   * state says it all.
   */
  brief?: string;
  /** The step finished but left something to look at (a failed check, quality issues). */
  concern?: true;
  source: 'step' | 'generic';
}

/** A step as a storyteller reads it: a run step, before or after the cap. */
export interface StoryStep {
  id: string;
  title: string;
  status: string;
  attempt?: number;
  input?: Record<string, unknown>;
  output?: Record<string, unknown>;
  error?: string;
  toolCalls?: readonly {
    tool: string;
    input?: string;
    rowCount?: number;
    error?: string;
  }[];
}

/** What a storyteller can see besides the step: the run's input and steps. */
export interface StoryContext {
  runInput: Record<string, unknown>;
  /** The run's steps so far (their stored, capped data), in order. */
  steps: readonly StoryStep[];
  /** The run's status once it ended: a step skipped by a stop or a failure says so. */
  runStatus?: string;
}

/**
 * A workflow's storyteller: the story of one of its steps, or undefined to
 * leave it to the generic story.
 */
export type StepStoryteller = (
  step: StoryStep,
  context: StoryContext,
) => Omit<StepStory, 'source'> | undefined;

/** The most facts the generic story lists. */
export const GENERIC_STORY_MAX_FACTS = 8;
/** The longest text value a fact shows, in characters. */
export const STORY_TEXT_MAX = 240;
/** The most list items a fact shows before `+<n> more`. */
export const STORY_LIST_MAX = 12;

/** `text`, cut at `max` characters with an ellipsis. */
export function clip(text: string, max = STORY_TEXT_MAX): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1).trimEnd()}…` : flat;
}

/** `1 query`, `3 queries`: a count and its noun. */
export function plural(count: number, one: string, many = `${one}s`): string {
  return `${count.toLocaleString('en-US')} ${count === 1 ? one : many}`;
}

/** `a`, `a and b`, `a, b and c`. */
export function listPhrase(items: readonly string[]): string {
  if (items.length <= 1) return items[0] ?? '';
  return `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`;
}

/** At most `STORY_LIST_MAX` items, the rest as `+<n> more`. */
export function capList(items: readonly string[]): string[] {
  if (items.length <= STORY_LIST_MAX) return [...items];
  const rest = items.length - STORY_LIST_MAX;
  return [...items.slice(0, STORY_LIST_MAX), `+${rest} more`];
}

/** The strings of an array value; anything else is dropped. */
export function strings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

/** A string value, else `fallback`. */
export function textOf(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

/** A record value, or undefined. */
export function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

/** A field's label: its schema description without the final stop, else its name in words. */
function fieldLabel(name: string, schema: JsonSchema | undefined): string {
  const described = schema?.properties?.[name]?.description?.trim();
  if (described) return clip(described.replace(/\.$/, ''), 80);
  const words = name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[-_]+/g, ' ')
    .toLowerCase()
    .trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** A value as one fact's values: text, a short list, or a count. */
function factValues(value: unknown): string[] | undefined {
  if (value === null || value === undefined) return undefined;
  if (typeof value === 'string')
    return value.trim() ? [clip(value)] : undefined;
  if (typeof value === 'number' || typeof value === 'boolean') {
    return [
      typeof value === 'number'
        ? value.toLocaleString('en-US')
        : value
          ? 'Yes'
          : 'No',
    ];
  }
  if (Array.isArray(value)) {
    const texts = strings(value);
    if (
      texts.length === value.length &&
      texts.length > 0 &&
      texts.length <= 5
    ) {
      return texts.map((text) => clip(text, 80));
    }
    return [plural(value.length, 'item')];
  }
  const fields = Object.keys(value).length;
  return [plural(fields, 'field')];
}

/**
 * The generic story of a step (ui.md 4.4b): a failed step's error, a
 * skipped or stopped step's state, else its output fields, each labelled
 * by its schema description (else its name in words), at most
 * `GENERIC_STORY_MAX_FACTS`. Undefined for a step still running or waiting.
 */
export function genericStepStory(
  step: StoryStep,
  outputSchema?: JsonSchema,
): StepStory | undefined {
  if (step.status === 'failed') {
    return {
      headline: `It failed: ${clip(step.error ?? 'the step failed')}`,
      source: 'generic',
    };
  }
  if (step.status === 'skipped') {
    return {
      headline: 'Skipped: the run took another path.',
      brief: 'Another path taken',
      source: 'generic',
    };
  }
  if (step.status !== 'success' && step.status !== 'stopped') return undefined;
  const output = step.output;
  if (!output) {
    return {
      headline:
        step.status === 'stopped'
          ? 'Stopped before it finished.'
          : 'It finished; what it returned was too large to keep.',
      source: 'generic',
    };
  }
  const facts: StoryFact[] = [];
  for (const [name, value] of Object.entries(output)) {
    const values = factValues(value);
    if (!values) continue;
    facts.push({ label: fieldLabel(name, outputSchema), values });
  }
  const count = Object.keys(output).length;
  return {
    headline:
      step.status === 'stopped'
        ? `Stopped early, returning ${plural(count, 'value')}.`
        : count
          ? `${step.title} returned ${plural(count, 'value')}.`
          : `${step.title} finished and returned nothing.`,
    ...(facts.length ? { facts: facts.slice(0, GENERIC_STORY_MAX_FACTS) } : {}),
    source: 'generic',
  };
}

/**
 * The story of one step: the workflow's storyteller's, else the generic
 * one; undefined while the step runs or waits.
 */
export function tellStep(
  step: StoryStep,
  context: StoryContext,
  storyteller?: StepStoryteller,
  outputSchema?: JsonSchema,
): StepStory | undefined {
  if (step.status === 'running' || step.status === 'suspended')
    return undefined;
  let told: Omit<StepStory, 'source'> | undefined;
  try {
    told = storyteller?.(step, context);
  } catch {
    // A story is never worth a broken run view: the generic one stands in.
    told = undefined;
  }
  if (told) return { ...told, source: 'step' };
  // A skipped step the workflow cannot explain, in a run that stopped or
  // failed: the run never got to it.
  if (
    step.status === 'skipped' &&
    (context.runStatus === 'stopped' || context.runStatus === 'failed')
  ) {
    return {
      headline: `Did not run: the run ${
        context.runStatus === 'stopped' ? 'was stopped' : 'failed'
      } before it got here.`,
      brief: 'Not reached',
      source: 'generic',
    };
  }
  return genericStepStory(step, outputSchema);
}
