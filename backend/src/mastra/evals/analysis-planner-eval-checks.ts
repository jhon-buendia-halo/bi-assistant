import type { EvalCustomCheck } from './assistant.evals';
import type { PlannerCatalog } from './analysis-planner-edge-catalog';

/**
 * The custom checks of the `analysis-planner` eval set (agents.md 8.1,
 * 2.11): deterministic checks over the plan Olivia's Plan call returns (the
 * scored answer is the `AnalysisPlan` as JSON). A check answers `undefined`
 * when it passes and the reason when it fails. The judge is left for the
 * one condition code cannot decide (an assumption that states a fact).
 */

/** The plan as the checks read it. */
export interface PlanView {
  question: string;
  measures: string[];
  entities: string[];
  scope: string;
  assumptions: string[];
  needsClarification: boolean;
  clarification: { question: string; options: string[] } | null;
}

function textOf(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function listOf(value: unknown): string[] | undefined {
  return Array.isArray(value) && value.every((v) => typeof v === 'string')
    ? value
    : undefined;
}

/** The plan in an answer, or the reason it is not one. */
export function planOfAnswer(answer: string): PlanView | string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(answer);
  } catch {
    return 'the answer is not JSON';
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return 'the answer is not a JSON object';
  }
  const raw = parsed as Record<string, unknown>;
  const measures = listOf(raw['measures']);
  const entities = listOf(raw['entities']);
  const assumptions = listOf(raw['assumptions']);
  if (!measures || !entities || !assumptions) {
    return 'measures, entities and assumptions must be lists of text';
  }
  if (typeof raw['needsClarification'] !== 'boolean') {
    return 'needsClarification is not true or false';
  }
  if (typeof raw['question'] !== 'string' || typeof raw['scope'] !== 'string') {
    return 'question and scope must be text';
  }
  let clarification: PlanView['clarification'] = null;
  const asked = raw['clarification'];
  if (asked !== null && asked !== undefined) {
    const options = asked && typeof asked === 'object' ? asked : {};
    const list = listOf((options as Record<string, unknown>)['options']);
    clarification = {
      question: textOf((options as Record<string, unknown>)['question']),
      options: list ?? [],
    };
  }
  return {
    question: raw['question'],
    measures,
    entities,
    scope: raw['scope'],
    assumptions,
    needsClarification: raw['needsClarification'],
    clarification,
  };
}

/** Run a check over the plan; an answer that is no plan fails it. */
function planCheck(
  id: string,
  description: string,
  test: (plan: PlanView) => string | undefined,
): EvalCustomCheck {
  return {
    id,
    description,
    run: ({ answer }) => {
      const plan = planOfAnswer(answer);
      return typeof plan === 'string' ? plan : test(plan);
    },
  };
}

/** Every text of the plan the analysis reads, one per line. */
export function planText(plan: PlanView): string {
  return [
    plan.question,
    ...plan.measures,
    plan.scope,
    ...plan.assumptions,
    plan.clarification?.question ?? '',
    ...(plan.clarification?.options ?? []),
  ].join('\n');
}

/** The plan's own statements about the data: scope, assumptions, measures. */
function statements(plan: PlanView): string {
  return [
    plan.question,
    ...plan.measures,
    plan.scope,
    ...plan.assumptions,
  ].join('\n');
}

/** The plan parses, with the shape `planSchema` asks for. */
export function planParses(): EvalCustomCheck {
  return planCheck(
    'plan-parses',
    'The answer is a plan: its fields have the types the schema asks for',
    (plan) =>
      !plan.question.trim() ? 'the restated question is empty' : undefined,
  );
}

/**
 * Whether Plan asks. `expected` true: a question and 2-4 non-empty options;
 * false: no question (`clarification` null); `undefined` accepts either but
 * holds a question it asks to the same shape.
 */
export function clarificationDecision(
  expected: boolean | undefined,
): EvalCustomCheck {
  return planCheck(
    'clarification-decision',
    expected === undefined
      ? 'A clarification, when asked, is a question with 2-4 options'
      : expected
        ? 'Plan asks a clarifying question, with 2-4 non-empty options'
        : 'Plan does not ask: needsClarification is false and clarification is null',
    (plan) => {
      if (expected === true && !plan.needsClarification) {
        return 'needsClarification is false, but the question needs one';
      }
      if (expected === false && plan.needsClarification) {
        return 'needsClarification is true, but the plan should go on';
      }
      if (!plan.needsClarification) {
        return plan.clarification
          ? 'needsClarification is false but clarification is not null'
          : undefined;
      }
      const asked = plan.clarification;
      if (!asked || !asked.question.trim()) {
        return 'needsClarification is true but the clarifying question is empty';
      }
      const options = asked.options.map((o) => o.trim()).filter(Boolean);
      if (options.length < 2 || options.length > 4) {
        return `the clarification has ${options.length} usable options, not 2-4`;
      }
      if (new Set(options.map((o) => o.toLowerCase())).size < options.length) {
        return 'the clarification repeats an option';
      }
      return undefined;
    },
  );
}

/** Whether the entity a plan names is one of the catalog's (key, or its tail). */
function entityKnown(name: string, catalog: PlannerCatalog): boolean {
  return catalog.entities.some(
    (key) => key === name || key.endsWith(`.${name}`),
  );
}

/** The catalog table a plan's entity name stands for, by table name. */
function tableOf(name: string): string {
  return name.split('.').pop() ?? name;
}

/** Every entity the plan names is in the catalog it was given. */
export function entitiesInCatalog(catalog: PlannerCatalog): EvalCustomCheck {
  return planCheck(
    'entities-in-catalog',
    'Every entity the plan names is an entity of the catalog it was given',
    (plan) => {
      const unknown = plan.entities.filter((e) => !entityKnown(e, catalog));
      return unknown.length
        ? `entities not in the catalog: ${unknown.join(', ')}`
        : undefined;
    },
  );
}

/** The plan reads each of these tables (by table name). */
export function readsTables(tables: string[]): EvalCustomCheck {
  return planCheck(
    'reads-tables',
    `The plan's entities include ${tables.join(', ')}`,
    (plan) => {
      const named = plan.entities.map(tableOf);
      const missing = tables.filter((table) => !named.includes(table));
      return missing.length
        ? `entities lack ${missing.join(', ')} (got ${plan.entities.join(', ') || 'none'})`
        : undefined;
    },
  );
}

/**
 * Names the plan puts in backticks, or writes as `table.column`, are
 * columns or entities of the catalog: no invented column.
 */
export function namedColumnsExist(catalog: PlannerCatalog): EvalCustomCheck {
  const columns = new Set(Object.values(catalog.columns).flat());
  const tables = new Set(catalog.entities.map(tableOf));
  return planCheck(
    'named-columns-exist',
    'Every column the plan names in backticks or as table.column exists in the catalog',
    (plan) => {
      const text = statements(plan);
      const unknown = new Set<string>();
      for (const [, name] of text.matchAll(/`([^`]+)`/g)) {
        const [table, column] = name.includes('.')
          ? [tableOf(name.split('.').slice(0, -1).join('.')), tableOf(name)]
          : ['', name];
        if (column === name && !columns.has(name) && !tables.has(name)) {
          unknown.add(name);
        } else if (table && !tables.has(table)) {
          unknown.add(name);
        } else if (table && !columns.has(column)) {
          unknown.add(name);
        }
      }
      return unknown.size
        ? `names not in the catalog: ${[...unknown].join(', ')}`
        : undefined;
    },
  );
}

/** The plan names an entity or a measure the catalog cannot hold (matched case-blind). */
export function noInvented(words: RegExp, label: string): EvalCustomCheck {
  return planCheck(
    'no-invented-entity-or-measure',
    `The plan's entities and measures do not include ${label}`,
    (plan) => {
      const hit = [...plan.entities, ...plan.measures].find((t) =>
        words.test(t),
      );
      return hit ? `the plan invents ${label}: "${hit}"` : undefined;
    },
  );
}

/**
 * The plan states the gap: the text matches `topic` and a word of absence,
 * in the assumptions, the scope or the clarification.
 */
export function statesGap(topic: RegExp, label: string): EvalCustomCheck {
  const absence =
    /\b(no|not|none|n't|without|lack|lacks|missing|absent|unavailable|cannot|can't|isn't|aren't|doesn't|don't)\b|n't\b|\bnot (available|in|part)/i;
  return planCheck(
    'states-the-gap',
    `The plan says ${label} is not in the data, in its assumptions, scope or clarification`,
    (plan) => {
      const found = [
        ...plan.assumptions,
        plan.scope,
        plan.clarification?.question ?? '',
        ...(plan.clarification?.options ?? []),
      ].some((t) => topic.test(t) && absence.test(t));
      return found ? undefined : `no statement says ${label} is missing`;
    },
  );
}

/** Each name appears exactly as the catalog spells it, and no mangled variant does. */
export function namesSpelledExactly(
  names: string[],
  mangled: RegExp[],
): EvalCustomCheck {
  return planCheck(
    'names-spelled-exactly',
    `The plan spells ${names.map((n) => `"${n}"`).join(', ')} as the catalog does`,
    (plan) => {
      const text = planText(plan);
      const missing = names.filter((name) => !text.includes(name));
      if (missing.length) {
        return `the plan never spells ${missing.map((n) => `"${n}"`).join(', ')} exactly`;
      }
      const bad = mangled.find((pattern) => pattern.test(text));
      return bad ? `the plan has a mangled name (${bad})` : undefined;
    },
  );
}

/** The plan's statements (question, measures, scope, assumptions) match `pattern`. */
export function statementsMention(
  pattern: RegExp,
  label: string,
  id: string,
): EvalCustomCheck {
  return planCheck(id, `The plan ${label}`, (plan) =>
    pattern.test(statements(plan)) ? undefined : `the plan never ${label}`,
  );
}

/** The scope or an assumption matches `pattern` (not the restated question). */
export function scopeOrAssumptionsMention(
  pattern: RegExp,
  label: string,
  id: string,
): EvalCustomCheck {
  return planCheck(id, `The plan ${label}`, (plan) =>
    pattern.test([plan.scope, ...plan.assumptions].join('\n'))
      ? undefined
      : `neither the scope nor the assumptions ${label}`,
  );
}

/** An assumption names the column and that it may hold no values. */
export function assumesMayBeEmpty(column: string): EvalCustomCheck {
  const empty =
    /\b(empty|null|nulls|blank|missing|sparse|no values?|unpopulated|not populated|rarely (filled|populated)|may (be|have)|might)\b/i;
  return planCheck(
    'assumes-may-be-empty',
    `An assumption says ${column} may be empty or sparse`,
    (plan) =>
      plan.assumptions.some((a) => a.includes(column) && empty.test(a))
        ? undefined
        : `no assumption says ${column} may be empty`,
  );
}

/** Every measure the plan lists is one short phrase, and there is at least one. */
export function hasMeasures(minimum: number): EvalCustomCheck {
  return planCheck(
    'has-measures',
    `The plan lists at least ${minimum} measure${minimum === 1 ? '' : 's'}`,
    (plan) =>
      plan.measures.filter((m) => m.trim()).length >= minimum
        ? undefined
        : `the plan lists ${plan.measures.length} measures, needs ${minimum}`,
  );
}

/** The plan goes on to plan: it names at least one entity. */
export function namesEntities(): EvalCustomCheck {
  return planCheck(
    'names-entities',
    'The plan names at least one entity to read',
    (plan) => (plan.entities.length ? undefined : 'the plan names no entity'),
  );
}

/** The plan asks nothing and its restated question carries the user's answer. */
export function restatesAnswer(answer: RegExp): EvalCustomCheck {
  return planCheck(
    'restates-the-answer',
    "The restated question carries the user's answer to Clarify",
    (plan) =>
      answer.test(plan.question)
        ? undefined
        : `the restated question "${plan.question}" leaves out the answer`,
  );
}
