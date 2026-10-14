import { Injectable } from '@nestjs/common';
import type { PoolClient } from 'pg';
import {
  type NewRfpCarrier,
  type NewRfpLine,
  type NewRfpMilestone,
  type NewRfpRequirement,
  type Rfp,
  type RfpCarrier,
  type RfpLine,
  type RfpMilestone,
  type RfpRequirement,
  type RfpSections,
  type RfpStatus,
  type RfpSummary,
} from './rfp.types';

/**
 * SQL over schema `rfp` (data-model.md 7.2). Every value is a `$n`
 * parameter; the only identifiers in the statements are the literal `rfp`
 * tables and columns below. Callers choose the transaction
 * (`DbService.readOnly` to read, `DbService.write` to change).
 */

const HEADER_COLUMNS = `r.id, r.client_one_code, r.client_name, r.title, r.plan_year,
  to_char(r.effective_date, 'YYYY-MM-DD') AS effective_date, r.status, r.stage,
  r.sections, r.created_by, r.created_at, r.updated_at`;

interface HeaderRow {
  id: string;
  client_one_code: string;
  client_name: string;
  title: string;
  plan_year: number;
  effective_date: string;
  status: RfpStatus;
  stage: number;
  sections: RfpSections | null;
  created_by: string | null;
  created_at: Date;
  updated_at: Date;
}

interface SummaryRow extends HeaderRow {
  lines: number;
  carriers: number;
  requirements: number;
  milestones: number;
}

export type RfpHeaderRecord = Omit<
  Rfp,
  'lines' | 'carriers' | 'requirements' | 'timeline'
>;

export interface RfpListFilter {
  clientOneCode?: string;
  status?: RfpStatus;
  createdBy?: string;
}

/** Fields `PATCH` may set; the column of each is fixed here. */
export interface RfpHeaderPatch {
  title?: string;
  planYear?: number;
  effectiveDate?: string;
  status?: RfpStatus;
  stage?: number;
  sections?: RfpSections;
}

const PATCH_COLUMNS: Record<keyof RfpHeaderPatch, string> = {
  title: 'title',
  planYear: 'plan_year',
  effectiveDate: 'effective_date',
  status: 'status',
  stage: 'stage',
  sections: 'sections',
};

const iso = (value: Date | string): string =>
  value instanceof Date ? value.toISOString() : new Date(value).toISOString();

function toHeader(row: HeaderRow): RfpHeaderRecord {
  return {
    id: row.id,
    clientOneCode: row.client_one_code,
    clientName: row.client_name,
    title: row.title,
    planYear: Number(row.plan_year),
    effectiveDate: row.effective_date,
    status: row.status,
    stage: Number(row.stage),
    sections: row.sections ?? {},
    createdBy: row.created_by,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

function toSummary(row: SummaryRow): RfpSummary {
  const header: Partial<RfpHeaderRecord> = toHeader(row);
  delete header.sections;
  return {
    ...(header as Omit<RfpHeaderRecord, 'sections'>),
    lines: Number(row.lines),
    carriers: Number(row.carriers),
    requirements: Number(row.requirements),
    milestones: Number(row.milestones),
  };
}

/** Sets `target[key]` only for a non-null value (the `?` fields). */
function withOptional<T extends object>(
  target: T,
  values: Record<string, string | null>,
): T {
  for (const [key, value] of Object.entries(values)) {
    if (value !== null && value !== undefined) {
      (target as Record<string, unknown>)[key] = value;
    }
  }
  return target;
}

const trimmedIds = (ids: string[] | null): string[] =>
  (ids ?? []).map((id) => id.trim());

@Injectable()
export class RfpRepository {
  async insert(
    client: PoolClient,
    values: {
      clientOneCode: string;
      clientName: string;
      title: string;
      planYear: number;
      effectiveDate: string;
      createdBy: string | null;
    },
  ): Promise<string> {
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO rfp.rfps (client_one_code, client_name, title, plan_year, effective_date, created_by)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [
        values.clientOneCode,
        values.clientName,
        values.title,
        values.planYear,
        values.effectiveDate,
        values.createdBy,
      ],
    );
    return rows[0].id;
  }

  /** The header, or null; `forUpdate` locks the row for the transaction. */
  async findHeader(
    client: PoolClient,
    id: string,
    forUpdate = false,
  ): Promise<RfpHeaderRecord | null> {
    const { rows } = await client.query<HeaderRow>(
      `SELECT ${HEADER_COLUMNS} FROM rfp.rfps r WHERE r.id = $1${forUpdate ? ' FOR UPDATE' : ''}`,
      [id],
    );
    return rows[0] ? toHeader(rows[0]) : null;
  }

  /** The record with its four lists, each in `position` order; or null. */
  async findFull(client: PoolClient, id: string): Promise<Rfp | null> {
    const header = await this.findHeader(client, id);
    if (!header) return null;
    // One client runs one query at a time.
    const lines = await this.lines(client, id);
    const carriers = await this.carriers(client, id);
    const requirements = await this.requirements(client, id);
    const timeline = await this.timeline(client, id);
    return { ...header, lines, carriers, requirements, timeline };
  }

  private async lines(client: PoolClient, id: string): Promise<RfpLine[]> {
    const { rows } = await client.query<{
      id: string;
      position: number;
      line: string;
      product_id: string;
      plan_design_ids: string[] | null;
      market_basis: RfpLine['marketBasis'];
      alternate_funding: string | null;
      alternate_plan_type: string | null;
      notes: string | null;
    }>(
      `SELECT id, position, line, product_id, plan_design_ids, market_basis,
              alternate_funding, alternate_plan_type, notes
         FROM rfp.rfp_lines WHERE rfp_id = $1 ORDER BY position`,
      [id],
    );
    return rows.map((row) =>
      withOptional<RfpLine>(
        {
          id: row.id,
          position: row.position,
          line: row.line,
          productId: row.product_id.trim(),
          planDesignIds: trimmedIds(row.plan_design_ids),
          marketBasis: row.market_basis,
        },
        {
          alternateFunding: row.alternate_funding,
          alternatePlanType: row.alternate_plan_type,
          notes: row.notes,
        },
      ),
    );
  }

  private async carriers(
    client: PoolClient,
    id: string,
  ): Promise<RfpCarrier[]> {
    const { rows } = await client.query<{
      id: string;
      position: number;
      insurer_id: string;
      insurer_name: string;
      lines: string[] | null;
      incumbent: boolean;
      contact_email: string | null;
      notes: string | null;
    }>(
      `SELECT id, position, insurer_id, insurer_name, lines, incumbent, contact_email, notes
         FROM rfp.rfp_carriers WHERE rfp_id = $1 ORDER BY position`,
      [id],
    );
    return rows.map((row) =>
      withOptional<RfpCarrier>(
        {
          id: row.id,
          position: row.position,
          insurerId: row.insurer_id.trim(),
          insurerName: row.insurer_name,
          lines: row.lines ?? [],
          incumbent: row.incumbent,
        },
        { contactEmail: row.contact_email, notes: row.notes },
      ),
    );
  }

  private async requirements(
    client: PoolClient,
    id: string,
  ): Promise<RfpRequirement[]> {
    const { rows } = await client.query<{
      id: string;
      position: number;
      section: string;
      question: string;
      required: boolean;
      answer_type: RfpRequirement['answerType'];
    }>(
      `SELECT id, position, section, question, required, answer_type
         FROM rfp.rfp_requirements WHERE rfp_id = $1 ORDER BY position`,
      [id],
    );
    return rows.map((row) => ({
      id: row.id,
      position: row.position,
      section: row.section,
      question: row.question,
      required: row.required,
      answerType: row.answer_type,
    }));
  }

  private async timeline(
    client: PoolClient,
    id: string,
  ): Promise<RfpMilestone[]> {
    const { rows } = await client.query<{
      id: string;
      position: number;
      milestone: string;
      due_date: string;
      owner: string | null;
      notes: string | null;
    }>(
      `SELECT id, position, milestone, to_char(due_date, 'YYYY-MM-DD') AS due_date, owner, notes
         FROM rfp.rfp_timeline WHERE rfp_id = $1 ORDER BY position`,
      [id],
    );
    return rows.map((row) =>
      withOptional<RfpMilestone>(
        {
          id: row.id,
          position: row.position,
          milestone: row.milestone,
          dueDate: row.due_date,
        },
        { owner: row.owner, notes: row.notes },
      ),
    );
  }

  /** One page of summaries, newest (`created_at`) first, and the total. */
  async list(
    client: PoolClient,
    filter: RfpListFilter,
    limit: number,
    offset: number,
  ): Promise<{ total: number; rows: RfpSummary[] }> {
    const where = `($1::text IS NULL OR r.client_one_code = $1)
      AND ($2::text IS NULL OR r.status = $2)
      AND ($3::text IS NULL OR r.created_by = $3)`;
    const params = [
      filter.clientOneCode ?? null,
      filter.status ?? null,
      filter.createdBy ?? null,
    ];
    const total = await client.query<{ total: number }>(
      `SELECT count(*)::int AS total FROM rfp.rfps r WHERE ${where}`,
      params,
    );
    const { rows } = await client.query<SummaryRow>(
      `SELECT ${HEADER_COLUMNS},
         (SELECT count(*)::int FROM rfp.rfp_lines x WHERE x.rfp_id = r.id) AS lines,
         (SELECT count(*)::int FROM rfp.rfp_carriers x WHERE x.rfp_id = r.id) AS carriers,
         (SELECT count(*)::int FROM rfp.rfp_requirements x WHERE x.rfp_id = r.id) AS requirements,
         (SELECT count(*)::int FROM rfp.rfp_timeline x WHERE x.rfp_id = r.id) AS milestones
       FROM rfp.rfps r WHERE ${where}
       ORDER BY r.created_at DESC, r.id DESC
       LIMIT $4 OFFSET $5`,
      [...params, limit, offset],
    );
    return { total: total.rows[0]?.total ?? 0, rows: rows.map(toSummary) };
  }

  /** Sets the given header fields and stamps `updated_at`. */
  async updateHeader(
    client: PoolClient,
    id: string,
    patch: RfpHeaderPatch,
  ): Promise<void> {
    const sets: string[] = [];
    const params: unknown[] = [id];
    for (const key of Object.keys(PATCH_COLUMNS) as (keyof RfpHeaderPatch)[]) {
      const value = patch[key];
      if (value === undefined) continue;
      params.push(key === 'sections' ? JSON.stringify(value) : value);
      const cast =
        key === 'sections'
          ? '::jsonb'
          : key === 'effectiveDate'
            ? '::date'
            : '';
      sets.push(`${PATCH_COLUMNS[key]} = $${params.length}${cast}`);
    }
    sets.push('updated_at = now()');
    await client.query(
      `UPDATE rfp.rfps SET ${sets.join(', ')} WHERE id = $1`,
      params,
    );
  }

  async touch(client: PoolClient, id: string): Promise<void> {
    await client.query('UPDATE rfp.rfps SET updated_at = now() WHERE id = $1', [
      id,
    ]);
  }

  async replaceLines(
    client: PoolClient,
    id: string,
    rows: NewRfpLine[],
  ): Promise<void> {
    await client.query('DELETE FROM rfp.rfp_lines WHERE rfp_id = $1', [id]);
    for (const [index, row] of rows.entries()) {
      await client.query(
        `INSERT INTO rfp.rfp_lines (rfp_id, position, line, product_id, plan_design_ids,
           market_basis, alternate_funding, alternate_plan_type, notes)
         VALUES ($1, $2, $3, $4, $5::bpchar[], $6, $7, $8, $9)`,
        [
          id,
          index + 1,
          row.line,
          row.productId,
          row.planDesignIds,
          row.marketBasis,
          row.alternateFunding ?? null,
          row.alternatePlanType ?? null,
          row.notes ?? null,
        ],
      );
    }
    await this.touch(client, id);
  }

  async replaceCarriers(
    client: PoolClient,
    id: string,
    rows: NewRfpCarrier[],
  ): Promise<void> {
    await client.query('DELETE FROM rfp.rfp_carriers WHERE rfp_id = $1', [id]);
    for (const [index, row] of rows.entries()) {
      await client.query(
        `INSERT INTO rfp.rfp_carriers (rfp_id, position, insurer_id, insurer_name, lines,
           incumbent, contact_email, notes)
         VALUES ($1, $2, $3, $4, $5::text[], $6, $7, $8)`,
        [
          id,
          index + 1,
          row.insurerId,
          row.insurerName,
          row.lines,
          row.incumbent,
          row.contactEmail ?? null,
          row.notes ?? null,
        ],
      );
    }
    await this.touch(client, id);
  }

  async replaceRequirements(
    client: PoolClient,
    id: string,
    rows: NewRfpRequirement[],
  ): Promise<void> {
    await client.query('DELETE FROM rfp.rfp_requirements WHERE rfp_id = $1', [
      id,
    ]);
    for (const [index, row] of rows.entries()) {
      await client.query(
        `INSERT INTO rfp.rfp_requirements (rfp_id, position, section, question, required, answer_type)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          id,
          index + 1,
          row.section,
          row.question,
          row.required,
          row.answerType,
        ],
      );
    }
    await this.touch(client, id);
  }

  async replaceTimeline(
    client: PoolClient,
    id: string,
    rows: NewRfpMilestone[],
  ): Promise<void> {
    await client.query('DELETE FROM rfp.rfp_timeline WHERE rfp_id = $1', [id]);
    for (const [index, row] of rows.entries()) {
      await client.query(
        `INSERT INTO rfp.rfp_timeline (rfp_id, position, milestone, due_date, owner, notes)
         VALUES ($1, $2, $3, $4::date, $5, $6)`,
        [
          id,
          index + 1,
          row.milestone,
          row.dueDate,
          row.owner ?? null,
          row.notes ?? null,
        ],
      );
    }
    await this.touch(client, id);
  }

  async delete(client: PoolClient, id: string): Promise<void> {
    await client.query('DELETE FROM rfp.rfps WHERE id = $1', [id]);
  }

  /** Deletes the drafts `createdBy` created; returns how many. */
  async deleteDraftsBy(client: PoolClient, createdBy: string): Promise<number> {
    const result = await client.query(
      `DELETE FROM rfp.rfps WHERE created_by = $1 AND status = 'draft'`,
      [createdBy],
    );
    return result.rowCount ?? 0;
  }
}
