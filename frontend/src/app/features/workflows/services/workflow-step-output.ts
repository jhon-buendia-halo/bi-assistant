import {
  PlanOutput,
  ValidateFinding,
  ValidateOutput,
} from '../models/workflow.model';

/**
 * Reads a step's output as one of the analyst workflow's structured shapes
 * (Questions to Insights v2: Plan's `PlanOutput`, Validate's
 * `ValidateOutput`), so the node dialog can show it as a panel above the
 * raw data. By shape, not by step id; the shape may sit under its own key
 * (`{ plan: … }`). Null when the output is not that shape.
 */

type Output = Record<string, unknown> | null | undefined;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function strings(value: unknown): string[] | null {
  return Array.isArray(value) && value.every((v) => typeof v === 'string')
    ? (value as string[])
    : null;
}

function asPlan(value: unknown): PlanOutput | null {
  if (!isRecord(value)) return null;
  const measures = strings(value['measures']);
  const entities = strings(value['entities']);
  const assumptions = strings(value['assumptions']) ?? [];
  if (
    measures === null ||
    entities === null ||
    typeof value['needsClarification'] !== 'boolean'
  ) {
    return null;
  }
  const raw = value['clarification'];
  const options = isRecord(raw) ? strings(raw['options']) : null;
  const clarification =
    isRecord(raw) && typeof raw['question'] === 'string' && options !== null
      ? { question: raw['question'], options }
      : null;
  return {
    question: typeof value['question'] === 'string' ? value['question'] : '',
    measures,
    entities,
    scope: typeof value['scope'] === 'string' ? value['scope'] : '',
    assumptions,
    needsClarification: value['needsClarification'],
    clarification,
  };
}

function asValidate(value: unknown): ValidateOutput | null {
  if (!isRecord(value)) return null;
  const findings = value['findings'];
  if (typeof value['ok'] !== 'boolean' || !Array.isArray(findings)) return null;
  const parsed: ValidateFinding[] = [];
  for (const f of findings) {
    if (!isRecord(f) || typeof f['passed'] !== 'boolean') return null;
    parsed.push({
      check: typeof f['check'] === 'string' ? f['check'] : '',
      passed: f['passed'],
      detail: typeof f['detail'] === 'string' ? f['detail'] : '',
    });
  }
  return {
    ok: value['ok'],
    attempt: typeof value['attempt'] === 'number' ? value['attempt'] : 1,
    findings: parsed,
  };
}

/** The output as a plan, itself or under `plan`; null otherwise. */
export function planOutputOf(output: Output): PlanOutput | null {
  if (!output) return null;
  return asPlan(output) ?? asPlan(output['plan']);
}

/** The output as a validation, itself or under `validation`; null otherwise. */
export function validateOutputOf(output: Output): ValidateOutput | null {
  if (!output) return null;
  return asValidate(output) ?? asValidate(output['validation']);
}
