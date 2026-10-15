import { Injectable } from '@nestjs/common';
import type { PoolClient } from 'pg';
import { DbService } from '../db/db.service';
import { isMissingRelation } from '../rfp/intellify.lookups';
import type { Rfp } from '../rfp/rfp.types';

/**
 * The live Intellify data an RFP package is projected from (api.md 2.16.5):
 * the client, its latest census, and the plan designs and financials of the
 * lines in scope. Row shapes and column names are those of the collection
 * rows of api.md 2.16.2 (I8 plan designs, I10 financials, I11 census). All
 * reads run in one `READ ONLY` transaction; `db.schema` is the only value
 * interpolated into SQL. Rows flagged deleted are left out.
 */

export interface ClientFacts {
  oneCode: string;
  name: string;
  tenantKey: string | null;
}

/** I11 `CensusRow`. */
export interface CensusRow {
  documentId: string;
  clientOneCode: string;
  effectiveYear: string;
  totalEmployees: number | null;
  eligibleEmployees: number | null;
  enrolledEmployees: number | null;
  averageAge: number | null;
  averageSalary: number | null;
  femalePct: number | null;
  malePct: number | null;
  fullTime: number | null;
  partTime: number | null;
  tierEmployeeOnly: number | null;
  tierEmployeeSpouse: number | null;
  tierEmployeeChildren: number | null;
  tierFamily: number | null;
  statesCount: number | null;
  participationRate: number | null;
  source: string | null;
  uploadedAt: string | null;
}

export interface CensusFacts {
  row: CensusRow;
  /** Employees per state, by state code. */
  byState: { state: string; employees: number }[];
}

/** I8 plan design row. */
export interface PlanDesignRow {
  id: string;
  clientOneCode: string;
  clientName: string;
  line: string;
  planType: string | null;
  carrier: string | null;
  fundingType: string | null;
  state: string | null;
  creationFlag: string | null;
  policyNumber: string | null;
  enrolledEmployees: number | null;
  annualPremium: number | null;
  planYear: number | null;
}

/** I10 `Financial`, the flattened `plan_financial`. */
export interface FinancialRow {
  coverageId: string;
  clientOneCode: string;
  line: string;
  planDesignId: string;
  carrier: string | null;
  fundingType: string | null;
  planType: string | null;
  ratingBasis: string | null;
  planYear: number | null;
  enrolledEmployees: number | null;
  coveredLives: number | null;
  monthlyPremium: number | null;
  annualPremium: number | null;
  priorYearAnnualPremium: number | null;
  renewalIncreasePct: number | null;
  employerPct: number | null;
  employeeMonthlyEmployeeOnly: number | null;
  adminFeePepm: number | null;
  stopLossPepm: number | null;
  ratePer1000: number | null;
  pepm: number | null;
  rateEmployeeOnly: number | null;
  rateEmployeeSpouse: number | null;
  rateEmployeeChildren: number | null;
  rateFamily: number | null;
  enrollEmployeeOnly: number | null;
  enrollEmployeeSpouse: number | null;
  enrollEmployeeChildren: number | null;
  enrollFamily: number | null;
}

export interface PackageData {
  /** Null when the client is no longer in `intellify.clients`. */
  client: ClientFacts | null;
  census: CensusFacts | null;
  /** The client's plan designs on the lines in scope (I8 rows). */
  planDesigns: PlanDesignRow[];
  /** Their financials (I10 rows). */
  financials: FinancialRow[];
}

export const EMPTY_PACKAGE_DATA: PackageData = {
  client: null,
  census: null,
  planDesigns: [],
  financials: [],
};

type Json = Record<string, unknown>;

const num = (value: unknown): number | null => {
  if (value === null || value === undefined || value === '') return null;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : null;
};
const str = (value: unknown): string | null => {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return JSON.stringify(value) ?? null;
};
const obj = (value: unknown): Json =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Json)
    : {};

export function toCensusFacts(row: {
  document_id: string;
  client_one_code: string;
  effective_year: string;
  answers: unknown;
  context_data: unknown;
}): CensusFacts {
  const answers = obj(row.answers);
  const gender = obj(answers.gender);
  const tiers = obj(answers.medicalTier);
  const employeeClass = obj(answers.employeeClass);
  const context = obj(row.context_data);
  const byStateRaw = obj(answers.byState);
  const byState = Object.keys(byStateRaw)
    .sort()
    .map((state) => ({ state, employees: num(byStateRaw[state]) ?? 0 }));
  const eligible = num(answers.eligibleEmployees);
  const enrolled = num(answers.enrolledEmployees);
  return {
    row: {
      documentId: row.document_id,
      clientOneCode: row.client_one_code,
      effectiveYear: row.effective_year,
      totalEmployees: num(answers.totalEmployees),
      eligibleEmployees: eligible,
      enrolledEmployees: enrolled,
      averageAge: num(answers.averageAge),
      averageSalary: num(answers.averageSalary),
      femalePct: num(gender.female),
      malePct: num(gender.male),
      fullTime: num(employeeClass.fullTime),
      partTime: num(employeeClass.partTime),
      tierEmployeeOnly: num(tiers.employeeOnly),
      tierEmployeeSpouse: num(tiers.employeeSpouse),
      tierEmployeeChildren: num(tiers.employeeChildren),
      tierFamily: num(tiers.family),
      statesCount: byState.length,
      participationRate:
        eligible && enrolled !== null
          ? Math.round((enrolled / eligible) * 1000) / 1000
          : null,
      source: str(context.source),
      uploadedAt: str(context.uploadedAt),
    },
    byState,
  };
}

export function toFinancialRow(row: {
  coverage_id: string;
  client_one_code: string;
  line: string;
  plan_design_id: string;
  carrier: string | null;
  plan_financial: unknown;
}): FinancialRow {
  const pf = obj(row.plan_financial);
  const rates = obj(pf.rates);
  const enrollment = obj(pf.enrollment);
  const contributions = obj(pf.contributions);
  const fees = obj(pf.fees);
  return {
    coverageId: row.coverage_id.trim(),
    clientOneCode: row.client_one_code,
    line: row.line,
    planDesignId: row.plan_design_id.trim(),
    carrier: row.carrier,
    fundingType: str(pf.fundingType),
    planType: str(pf.planType),
    ratingBasis: str(pf.ratingBasis),
    planYear: num(pf.planYear),
    enrolledEmployees: num(pf.enrolledEmployees),
    coveredLives: num(pf.coveredLives),
    monthlyPremium: num(pf.monthlyPremium),
    annualPremium: num(pf.annualPremium),
    priorYearAnnualPremium: num(pf.priorYearAnnualPremium),
    renewalIncreasePct: num(pf.renewalIncreasePct),
    employerPct: num(contributions.employerPct),
    employeeMonthlyEmployeeOnly: num(contributions.employeeMonthlyEmployeeOnly),
    adminFeePepm: num(fees.adminFeePepm),
    stopLossPepm: num(fees.stopLossPepm),
    ratePer1000: num(pf.ratePer1000),
    pepm: num(pf.pepm),
    rateEmployeeOnly: num(rates.employeeOnly),
    rateEmployeeSpouse: num(rates.employeeSpouse),
    rateEmployeeChildren: num(rates.employeeChildren),
    rateFamily: num(rates.family),
    enrollEmployeeOnly: num(enrollment.employeeOnly),
    enrollEmployeeSpouse: num(enrollment.employeeSpouse),
    enrollEmployeeChildren: num(enrollment.employeeChildren),
    enrollFamily: num(enrollment.family),
  };
}

/**
 * Keeps, per line in scope, the plan designs the RFP names (or all of the
 * line's when it names none), in the order of `lines`.
 */
export function inScope<T extends { line: string }>(
  rfp: Pick<Rfp, 'lines'>,
  rows: T[],
  idOf: (row: T) => string,
): T[] {
  return rfp.lines.flatMap((line) =>
    rows.filter(
      (row) =>
        row.line === line.line &&
        (!line.planDesignIds.length || line.planDesignIds.includes(idOf(row))),
    ),
  );
}

@Injectable()
export class ExhibitsQueries {
  constructor(private readonly db: DbService) {}

  async load(rfp: Rfp): Promise<PackageData> {
    const lines = rfp.lines.map((l) => l.line);
    try {
      return await this.db.readOnly(async (client) => {
        const facts = await this.client(client, rfp.clientOneCode);
        if (!facts) return EMPTY_PACKAGE_DATA;
        const census = await this.census(client, rfp.clientOneCode);
        const designs = lines.length
          ? inScope(
              rfp,
              await this.planDesigns(client, rfp.clientOneCode, lines),
              (row) => row.id,
            )
          : [];
        const financials = designs.length
          ? inScope(
              rfp,
              await this.financials(
                client,
                rfp.clientOneCode,
                designs.map((d) => d.id),
              ),
              (row) => row.planDesignId,
            )
          : [];
        return { client: facts, census, planDesigns: designs, financials };
      });
    } catch (error) {
      // The Intellify sample is not loaded: the package renders from the record.
      if (isMissingRelation(error)) return EMPTY_PACKAGE_DATA;
      throw error;
    }
  }

  private async client(
    client: PoolClient,
    oneCode: string,
  ): Promise<ClientFacts | null> {
    const s = this.db.schema;
    const { rows } = await client.query<{
      one_code: string;
      name: string;
      tenant_key: string | null;
    }>(
      `SELECT one_code, name, tenant_key FROM ${s}.clients
        WHERE one_code = $1 AND deleted IS NOT TRUE LIMIT 1`,
      [oneCode],
    );
    const row = rows[0];
    return row
      ? { oneCode: row.one_code, name: row.name, tenantKey: row.tenant_key }
      : null;
  }

  private async census(
    client: PoolClient,
    oneCode: string,
  ): Promise<CensusFacts | null> {
    const s = this.db.schema;
    const { rows } = await client.query<{
      document_id: string;
      client_one_code: string;
      effective_year: string;
      answers: unknown;
      context_data: unknown;
    }>(
      `SELECT document_id, client_one_code, effective_year, answers, context_data
         FROM ${s}.census_answers
        WHERE client_one_code = $1 AND deleted IS NOT TRUE
        ORDER BY effective_year DESC, document_id DESC
        LIMIT 1`,
      [oneCode],
    );
    return rows[0] ? toCensusFacts(rows[0]) : null;
  }

  private async planDesigns(
    client: PoolClient,
    oneCode: string,
    lines: string[],
  ): Promise<PlanDesignRow[]> {
    const s = this.db.schema;
    const { rows } = await client.query<PlanDesignRow>(
      `SELECT pd.id, c.one_code AS "clientOneCode", c.name AS "clientName",
              p.name AS line, pf.plan_financial->>'planType' AS "planType",
              i.name AS carrier, ft.name AS "fundingType", ps.display_name AS state,
              pd.plan_creation_identifier_flag AS "creationFlag",
              po.number AS "policyNumber",
              (pf.plan_financial->>'enrolledEmployees')::float8 AS "enrolledEmployees",
              (pf.plan_financial->>'annualPremium')::float8 AS "annualPremium",
              (pf.plan_financial->>'planYear')::int AS "planYear"
         FROM ${s}.plan_designs pd
         JOIN ${s}.clients c ON c.id = pd.client_client_id
         JOIN ${s}.products p ON p.id = pd.loc_product_id
         LEFT JOIN ${s}.insurers i ON i.id = pd.insurer_insurer_id
         LEFT JOIN ${s}.funding_types ft ON ft.id = pd.plan_info_funding_type_id
         LEFT JOIN ${s}.plan_states ps ON ps.id = pd.plan_info_state_id
         LEFT JOIN LATERAL (
           SELECT pc.id, pc.policy_info_policy_id FROM ${s}.policy_coverages pc
            WHERE pc.plan_design_plan_design_id = pd.id AND pc.deleted IS NOT TRUE
            ORDER BY pc.id LIMIT 1) pc ON true
         LEFT JOIN ${s}.policies po
           ON po.id = pc.policy_info_policy_id AND po.deleted IS NOT TRUE
         LEFT JOIN LATERAL (
           SELECT f.plan_financial FROM ${s}.policy_financials f
            WHERE f.policy_coverage_policy_coverage_id = pc.id AND f.deleted IS NOT TRUE
            ORDER BY f.id LIMIT 1) pf ON true
        WHERE c.one_code = $1 AND c.deleted IS NOT TRUE AND pd.deleted IS NOT TRUE
          AND p.name = ANY($2::text[])
        ORDER BY p.display_order, pd.id`,
      [oneCode, lines],
    );
    return rows.map((row) => ({ ...row, id: row.id.trim() }));
  }

  private async financials(
    client: PoolClient,
    oneCode: string,
    planDesignIds: string[],
  ): Promise<FinancialRow[]> {
    const s = this.db.schema;
    const { rows } = await client.query<{
      coverage_id: string;
      client_one_code: string;
      line: string;
      plan_design_id: string;
      carrier: string | null;
      plan_financial: unknown;
    }>(
      `SELECT pc.id AS coverage_id, c.one_code AS client_one_code, p.name AS line,
              pd.id AS plan_design_id, i.name AS carrier, f.plan_financial
         FROM ${s}.policy_coverages pc
         JOIN ${s}.plan_designs pd ON pd.id = pc.plan_design_plan_design_id
         JOIN ${s}.clients c ON c.id = pd.client_client_id
         JOIN ${s}.products p ON p.id = pd.loc_product_id
         JOIN ${s}.policy_financials f
           ON f.policy_coverage_policy_coverage_id = pc.id AND f.deleted IS NOT TRUE
         LEFT JOIN ${s}.insurers i ON i.id = pc.insurer_insurer_id
        WHERE c.one_code = $1 AND pc.deleted IS NOT TRUE AND pd.deleted IS NOT TRUE
          AND pd.id = ANY($2::bpchar[])
        ORDER BY p.display_order, pd.id, pc.id, f.id`,
      [oneCode, planDesignIds],
    );
    return rows.map(toFinancialRow);
  }
}
