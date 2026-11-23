/**
 * The replies of the Requirements Analyst, the Layer Mapper and the Gap
 * Advisor (agents.md 2.18 to 2.20): the schemas asked for by inline JSON
 * injection, and the Requirements Analyst's lenient reader (ids and sources
 * are fixed in code). The Layer Mapper's and the Gap Advisor's replies are
 * read and checked by `checkedMappings` and `checkedFixes`
 * (./consumption-gap.gaps.ts). No framework import beyond zod.
 */
import { z } from 'zod';
import { jsonObjectOf } from './analysis.steps';
import type {
  Requirement,
  RequirementField,
} from './consumption-gap-analysis.schemas';

const fieldReplySchema = z.object({
  name: z.string(),
  role: z.string(),
  aggregation: z.string(),
  description: z.string(),
});

/** The derive reply: one requirement per question number. */
export const derivedRequirementsReplySchema = z.object({
  requirements: z.array(
    z.object({
      question: z.number(),
      fields: z.array(fieldReplySchema),
      grain: z.string(),
      periodValues: z.array(z.string()),
    }),
  ),
});

/** The revise reply: the whole revised list. */
export const revisedRequirementsReplySchema = z.object({
  requirements: z.array(
    z.object({
      id: z.string(),
      kind: z.string(),
      title: z.string(),
      fields: z.array(fieldReplySchema),
      grain: z.string(),
      periodValues: z.array(z.string()),
    }),
  ),
});

/** The Layer Mapper's reply. */
export const layerMappingsReplySchema = z.object({
  mappings: z.array(
    z.object({
      requirementId: z.string(),
      field: z.string(),
      sources: z.array(
        z.object({
          layer: z.string(),
          entity: z.string(),
          column: z.string(),
          expression: z.string(),
        }),
      ),
      note: z.string(),
    }),
  ),
});

/** The Gap Advisor's reply. */
export const gapFixesReplySchema = z.object({
  fixes: z.array(
    z.object({
      title: z.string(),
      startsIn: z.string(),
      path: z.array(z.string()),
      closes: z.array(z.string()),
      why: z.string(),
      change: z.string(),
    }),
  ),
});

function text(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }
  return '';
}

function records(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.filter(
        (item): item is Record<string, unknown> =>
          !!item && typeof item === 'object' && !Array.isArray(item),
      )
    : [];
}

const ROLES: readonly RequirementField['role'][] = [
  'measure',
  'dimension',
  'filter',
  'time',
];

/** The fields of a reply entry: unknown role is a dimension, no aggregation ''. */
function fieldsOf(value: unknown): RequirementField[] {
  const out: RequirementField[] = [];
  for (const raw of records(value)) {
    const name = text(raw['name']);
    if (!name) continue;
    const role = text(raw['role']).toLowerCase() as RequirementField['role'];
    out.push({
      name,
      role: ROLES.includes(role) ? role : 'dimension',
      aggregation: text(raw['aggregation']).toLowerCase(),
      description: text(raw['description']),
    });
  }
  return out;
}

function periodsOf(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map(text).filter((item) => item !== '')
    : [];
}

/**
 * The Derive reply read leniently (agents.md 2.18): one requirement per
 * question, `Q1`… in question order, kind `question`. A question the reply
 * misses gets a requirement with no fields; an entry for a number that is
 * no question, or a second entry for one, is ignored. A reply that is no
 * JSON object leaves every question with no fields.
 */
export function derivedRequirementsOf(
  reply: unknown,
  questions: readonly string[],
): Requirement[] {
  const raw = jsonObjectOf(reply) as Record<string, unknown> | undefined;
  const byQuestion = new Map<number, Record<string, unknown>>();
  for (const entry of records(raw?.['requirements'])) {
    const number = Number(text(entry['question']));
    if (!Number.isInteger(number) || number < 1 || number > questions.length) {
      continue;
    }
    if (!byQuestion.has(number)) byQuestion.set(number, entry);
  }
  return questions.map((question, index) => {
    const entry = byQuestion.get(index + 1);
    return {
      id: `Q${index + 1}`,
      kind: 'question',
      title: question,
      source: `Question ${index + 1}`,
      dashboardId: '',
      ref: '',
      fields: fieldsOf(entry?.['fields']),
      grain: text(entry?.['grain']),
      periodValues: periodsOf(entry?.['periodValues']),
    };
  });
}

const KIND_PREFIX = { question: 'Q', widget: 'W', filter: 'F' } as const;

function kindOfId(id: string): Requirement['kind'] {
  const prefix = id.trim().charAt(0).toUpperCase();
  if (prefix === 'W') return 'widget';
  if (prefix === 'F') return 'filter';
  return 'question';
}

/**
 * The Confirm reply read leniently (agents.md 2.18): the whole revised
 * list. A requirement whose id is one of `current` keeps it, with its
 * kind, `source`, `dashboardId` and `ref`; one the reply leaves out is
 * dropped; one without a known id is new and gets the next free id of its
 * kind (from the id's prefix, else `question`). A reply that is no JSON
 * object with a `requirements` list changes nothing.
 */
export function revisedRequirementsOf(
  reply: unknown,
  current: readonly Requirement[],
): Requirement[] {
  const raw = jsonObjectOf(reply) as Record<string, unknown> | undefined;
  if (!raw || !Array.isArray(raw['requirements'])) return [...current];
  const known = new Map(
    current.map((requirement) => [requirement.id, requirement]),
  );
  const used = new Set<string>();
  const next = { question: 0, widget: 0, filter: 0 };
  for (const requirement of current) {
    const number = Number(requirement.id.slice(1));
    if (Number.isInteger(number)) {
      next[requirement.kind] = Math.max(next[requirement.kind], number);
    }
  }
  const out: Requirement[] = [];
  for (const entry of records(raw['requirements'])) {
    const id = text(entry['id']);
    const kept = known.get(id);
    const fields = fieldsOf(entry['fields']);
    const grain = text(entry['grain']);
    const periodValues = periodsOf(entry['periodValues']);
    if (kept && !used.has(id)) {
      used.add(id);
      out.push({
        ...kept,
        title: text(entry['title']) || kept.title,
        fields,
        grain,
        periodValues,
      });
      continue;
    }
    // A new requirement with no title says nothing: skipped.
    if (!text(entry['title'])) continue;
    const kind = kindOfId(id);
    let number = next[kind];
    let fresh: string;
    do {
      number += 1;
      fresh = `${KIND_PREFIX[kind]}${number}`;
    } while (known.has(fresh) || used.has(fresh));
    next[kind] = number;
    used.add(fresh);
    out.push({
      id: fresh,
      kind,
      title: text(entry['title']),
      source: kind === 'question' ? `Question ${number}` : '',
      dashboardId: '',
      ref: '',
      fields,
      grain,
      periodValues,
    });
  }
  return out;
}
