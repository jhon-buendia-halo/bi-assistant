import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import {
  RFP_STATUSES,
  RfpSections,
  RfpStatus,
  SECTION_KEYS,
  type NewRfpCarrier,
  type NewRfpLine,
} from './rfp.types';

/** The RFP rules that need no database (api.md 2.16.4); pure, for tests. */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID.test(value);
}

/** `400 validation`, with `details` listing every problem. */
export function validationError(
  message: string,
  details: string[] = [message],
): BadRequestException {
  return new BadRequestException({ message, code: 'validation', details });
}

export function conflictError(message: string): ConflictException {
  return new ConflictException({ message, code: 'conflict' });
}

export function rfpNotFound(id: string): NotFoundException {
  return new NotFoundException(`RFP "${id}" not found`);
}

/** An ISO `YYYY-MM-DD` that names a real calendar day. */
export function isIsoDate(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const [year, month, day] = match.slice(1).map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

/** `<client name> — <planYear> benefits RFP` (I21). */
export function defaultTitle(clientName: string, planYear: number): string {
  return `${clientName} — ${planYear} benefits RFP`;
}

export function defaultEffectiveDate(planYear: number): string {
  return `${planYear}-01-01`;
}

/**
 * Status moves forward only: `draft → ready → issued → closed`. Staying put
 * and skipping ahead are allowed; a backwards move is a 409 `conflict`.
 */
export function assertStatusMove(from: RfpStatus, to: RfpStatus): void {
  if (RFP_STATUSES.indexOf(to) < RFP_STATUSES.indexOf(from)) {
    throw conflictError(
      `RFP status cannot move back from "${from}" to "${to}" (order: ${RFP_STATUSES.join(' → ')})`,
    );
  }
}

/** Only a draft can be deleted (I28). */
export function assertDeletable(id: string, status: RfpStatus): void {
  if (status !== 'draft') {
    throw conflictError(
      `RFP "${id}" is ${status}; only a draft can be deleted`,
    );
  }
}

/** Problems with a `sections` patch: unknown keys and non-text values. */
export function sectionPatchProblems(value: unknown): string[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return ['sections must be an object'];
  }
  const problems: string[] = [];
  for (const [key, text] of Object.entries(value)) {
    if (!(SECTION_KEYS as readonly string[]).includes(key)) {
      problems.push(
        `sections has an unknown key "${key}" (known: ${SECTION_KEYS.join(', ')})`,
      );
    } else if (text !== null && typeof text !== 'string') {
      problems.push(`sections.${key} must be a string or null`);
    }
  }
  return problems;
}

/**
 * Merges a `sections` patch key by key: a string sets the key, `null` or an
 * empty string removes it, an absent key is kept. Keys come out in the
 * canonical order, so the stored JSON is stable.
 */
export function mergeSections(
  current: RfpSections,
  patch: Record<string, string | null | undefined>,
): RfpSections {
  const merged: RfpSections = {};
  for (const key of SECTION_KEYS) {
    const next = key in patch ? patch[key] : current[key];
    if (typeof next === 'string' && next !== '') merged[key] = next;
  }
  return merged;
}

/** A line of coverage as `intellify.products` holds it. */
export interface ProductRef {
  id: string;
  name: string;
}

/** A plan design of the RFP's client, with its line. */
export interface PlanDesignRef {
  id: string;
  line: string;
}

export interface InsurerRef {
  id: string;
  name: string;
}

export interface LineInput {
  line: string;
  planDesignIds?: string[];
  marketBasis: NewRfpLine['marketBasis'];
  alternateFunding?: string | null;
  alternatePlanType?: string | null;
  notes?: string | null;
}

export interface CarrierInput {
  insurer: string;
  lines: string[];
  incumbent?: boolean;
  contactEmail?: string | null;
  notes?: string | null;
}

const optional = (value: string | null | undefined): string | undefined => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
};

/** Finds a product by its name, case-insensitively. */
function findProduct(
  products: ProductRef[],
  name: string,
): ProductRef | undefined {
  const wanted = name.trim().toLowerCase();
  return products.find((p) => p.name.toLowerCase() === wanted);
}

/**
 * Resolves `PUT …/lines` items (I24): the canonical line name and its
 * `productId`, and checks that each plan design id is one of the client's
 * plan designs on that line. Every problem is collected; any problem refuses
 * the whole list.
 */
export function resolveLines(
  items: LineInput[],
  products: ProductRef[],
  planDesigns: PlanDesignRef[],
  clientOneCode: string,
): NewRfpLine[] {
  const problems: string[] = [];
  const seen = new Set<string>();
  const rows: NewRfpLine[] = [];
  items.forEach((item, index) => {
    const product = findProduct(products, item.line);
    if (!product) {
      problems.push(
        `Item ${index + 1}: unknown line "${item.line}". Known: ${products.map((p) => p.name).join(', ')}`,
      );
      return;
    }
    if (seen.has(product.name)) {
      problems.push(
        `Item ${index + 1}: line "${product.name}" is listed twice`,
      );
      return;
    }
    seen.add(product.name);
    const ids = [
      ...new Set((item.planDesignIds ?? []).map((id) => id.trim())),
    ].filter(Boolean);
    for (const id of ids) {
      const design = planDesigns.find((d) => d.id === id);
      if (!design) {
        problems.push(
          `Item ${index + 1}: plan design "${id}" does not belong to client "${clientOneCode}"`,
        );
      } else if (design.line !== product.name) {
        problems.push(
          `Item ${index + 1}: plan design "${id}" is a ${design.line} plan, not ${product.name}`,
        );
      }
    }
    const row: NewRfpLine = {
      line: product.name,
      productId: product.id,
      planDesignIds: ids,
      marketBasis: item.marketBasis,
    };
    const alternateFunding = optional(item.alternateFunding);
    const alternatePlanType = optional(item.alternatePlanType);
    const notes = optional(item.notes);
    if (alternateFunding) row.alternateFunding = alternateFunding;
    if (alternatePlanType) row.alternatePlanType = alternatePlanType;
    if (notes) row.notes = notes;
    rows.push(row);
  });
  if (problems.length) {
    throw validationError(
      problems.length === 1 ? problems[0] : 'Invalid lines',
      problems,
    );
  }
  return rows;
}

/**
 * Resolves `PUT …/carriers` items (I25): `insurer` is an insurer id or its
 * exact name (case-insensitive); each line must be a known line of coverage.
 * An unknown carrier answers `Unknown carrier "<x>". Known: <names>`.
 */
export function resolveCarriers(
  items: CarrierInput[],
  insurers: InsurerRef[],
  products: ProductRef[],
): NewRfpCarrier[] {
  const known = insurers.map((i) => i.name).join(', ');
  const problems: string[] = [];
  const rows: NewRfpCarrier[] = [];
  items.forEach((item, index) => {
    const wanted = item.insurer.trim();
    const insurer =
      insurers.find((i) => i.id === wanted) ??
      insurers.find((i) => i.name.toLowerCase() === wanted.toLowerCase());
    if (!insurer) {
      problems.push(`Unknown carrier "${wanted}". Known: ${known}`);
      return;
    }
    const lines: string[] = [];
    for (const name of item.lines) {
      const product = findProduct(products, name);
      if (!product) {
        problems.push(
          `Item ${index + 1}: unknown line "${name}". Known: ${products.map((p) => p.name).join(', ')}`,
        );
      } else if (!lines.includes(product.name)) {
        lines.push(product.name);
      }
    }
    const row: NewRfpCarrier = {
      insurerId: insurer.id,
      insurerName: insurer.name,
      lines,
      incumbent: item.incumbent ?? false,
    };
    const contactEmail = optional(item.contactEmail);
    const notes = optional(item.notes);
    if (contactEmail) row.contactEmail = contactEmail;
    if (notes) row.notes = notes;
    rows.push(row);
  });
  if (problems.length) throw validationError(problems[0], problems);
  return rows;
}
