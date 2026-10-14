/**
 * Pure shaping of Intellify rows into the API's response shapes (api.md 2.16):
 * flattening `plan_financial`, census aggregation, the current line status and
 * the renewal dates. No I/O, so every rule is unit-tested without a database.
 */

type Json = Record<string, unknown>;

const obj = (v: unknown): Json =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Json) : {};

/** A finite number, or null: absent keys and non-numbers both read as null. */
export function num(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

export function str(v: unknown): string | null {
  return typeof v === 'string' ? v : null;
}

const round = (n: number, digits: number): number => {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
};

// --- plan_financial ---------------------------------------------------------

export interface Financial {
  coverageId: string;
  clientOneCode: string;
  line: string;
  planDesignId: string | null;
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

export interface FinancialContext {
  coverageId: string;
  clientOneCode: string;
  line: string;
  planDesignId: string | null;
  carrier: string | null;
  /** Funding type of the plan design; falls back to `plan_financial.fundingType`. */
  fundingType: string | null;
}

/** Flattens the `plan_financial` jsonb; keys that don't apply to the line are null. */
export function flattenFinancial(
  planFinancial: unknown,
  ctx: FinancialContext,
): Financial {
  const pf = obj(planFinancial);
  const rates = obj(pf.rates);
  const enrollment = obj(pf.enrollment);
  const contributions = obj(pf.contributions);
  const fees = obj(pf.fees);
  return {
    ...ctx,
    fundingType: ctx.fundingType ?? str(pf.fundingType),
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

export interface FinancialTotals {
  annualPremium: number;
  priorYearAnnualPremium: number;
  renewalIncreasePct: number | null;
  enrolledEmployees: number;
}

/** Sums over `rows`; the increase is derived from the two sums, not averaged. */
export function financialTotals(
  rows: Pick<
    Financial,
    'annualPremium' | 'priorYearAnnualPremium' | 'enrolledEmployees'
  >[],
): FinancialTotals {
  let annual = 0;
  let prior = 0;
  let enrolled = 0;
  for (const r of rows) {
    annual += r.annualPremium ?? 0;
    prior += r.priorYearAnnualPremium ?? 0;
    enrolled += r.enrolledEmployees ?? 0;
  }
  return {
    annualPremium: round(annual, 2),
    priorYearAnnualPremium: round(prior, 2),
    renewalIncreasePct: prior > 0 ? round(annual / prior - 1, 4) : null,
    enrolledEmployees: enrolled,
  };
}

// --- renewal dates ------------------------------------------------------------

/** Plans are calendar-year: the renewal takes effect 1 January after `planYear`. */
export function renewalEffectiveDate(planYear: number | null): string | null {
  return planYear === null ? null : `${planYear + 1}-01-01`;
}

/** `effectiveDate` minus `days`, as `YYYY-MM-DD`; null when either is missing. */
export function kickOffDate(
  effectiveDate: string | null,
  days: number | null,
): string | null {
  if (!effectiveDate || days === null) return null;
  const d = new Date(`${effectiveDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

// --- loc statuses -------------------------------------------------------------

export interface LocStatusRow {
  productId: string;
  status: string | null;
  /** `YYYY-MM-DD` */
  startDate: string | null;
  id?: string;
}

/** Current status of each line: the row with the latest `start_date`. */
export function currentStatuses(
  rows: LocStatusRow[],
): Map<string, { status: string | null; since: string | null }> {
  const best = new Map<string, LocStatusRow>();
  for (const r of rows) {
    const cur = best.get(r.productId);
    const a = r.startDate ?? '';
    const b = cur?.startDate ?? '';
    if (!cur || a > b || (a === b && (r.id ?? '') > (cur.id ?? ''))) {
      best.set(r.productId, r);
    }
  }
  return new Map(
    [...best].map(([k, r]) => [k, { status: r.status, since: r.startDate }]),
  );
}

// --- census -------------------------------------------------------------------

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
  statesCount: number;
  participationRate: number | null;
  source: string | null;
  uploadedAt: string | null;
}

export interface RawCensus {
  documentId: string;
  clientOneCode: string;
  effectiveYear: string;
  answers: unknown;
  contextData: unknown;
}

export function mapCensusRow(raw: RawCensus): CensusRow {
  const a = obj(raw.answers);
  const gender = obj(a.gender);
  const tiers = obj(a.medicalTier);
  const cls = obj(a.employeeClass);
  const ctx = obj(raw.contextData);
  const eligible = num(a.eligibleEmployees);
  const enrolled = num(a.enrolledEmployees);
  return {
    documentId: raw.documentId,
    clientOneCode: raw.clientOneCode,
    effectiveYear: raw.effectiveYear,
    totalEmployees: num(a.totalEmployees),
    eligibleEmployees: eligible,
    enrolledEmployees: enrolled,
    averageAge: num(a.averageAge),
    averageSalary: num(a.averageSalary),
    femalePct: num(gender.female),
    malePct: num(gender.male),
    fullTime: num(cls.fullTime),
    partTime: num(cls.partTime),
    tierEmployeeOnly: num(tiers.employeeOnly),
    tierEmployeeSpouse: num(tiers.employeeSpouse),
    tierEmployeeChildren: num(tiers.employeeChildren),
    tierFamily: num(tiers.family),
    statesCount: Object.keys(obj(a.byState)).length,
    participationRate:
      enrolled !== null && eligible ? round(enrolled / eligible, 3) : null,
    source: str(ctx.source),
    uploadedAt: str(ctx.uploadedAt),
  };
}

export interface CensusDetail extends CensusRow {
  gender: { female: number | null; male: number | null };
  byState: { state: string; employees: number }[];
  tiers: { tier: string; employees: number; share: number | null }[];
  employeeClass: { fullTime: number | null; partTime: number | null };
}

const TIER_ORDER = [
  'employeeOnly',
  'employeeSpouse',
  'employeeChildren',
  'family',
];

/** The selected census with its breakdowns: states (largest first) and tiers. */
export function censusDetail(raw: RawCensus): CensusDetail {
  const row = mapCensusRow(raw);
  const a = obj(raw.answers);
  const byState = Object.entries(obj(a.byState))
    .map(([state, n]) => ({ state, employees: num(n) ?? 0 }))
    .sort(
      (x, y) => y.employees - x.employees || x.state.localeCompare(y.state),
    );
  const tierMap = obj(a.medicalTier);
  const names = [
    ...TIER_ORDER.filter((t) => t in tierMap),
    ...Object.keys(tierMap).filter((t) => !TIER_ORDER.includes(t)),
  ];
  const total = names.reduce((s, t) => s + (num(tierMap[t]) ?? 0), 0);
  const tiers = names.map((tier) => {
    const employees = num(tierMap[tier]) ?? 0;
    return {
      tier,
      employees,
      share: total > 0 ? round(employees / total, 3) : null,
    };
  });
  return {
    ...row,
    gender: { female: row.femalePct, male: row.malePct },
    byState,
    tiers,
    employeeClass: { fullTime: row.fullTime, partTime: row.partTime },
  };
}

export interface AggregatedCensus {
  headcount: number | null;
  enrolled: number | null;
  participationRate: number | null;
  averageAge: number | null;
  femalePct: number | null;
  tierMix: Record<string, number>;
  statesCount: number | null;
}

/** `aggregated_census_answers.census` of the selected year, or null. */
export function mapAggregated(census: unknown): AggregatedCensus | null {
  if (!census || typeof census !== 'object') return null;
  const c = obj(census);
  const tierMix: Record<string, number> = {};
  for (const [k, v] of Object.entries(obj(c.tierMix))) {
    const n = num(v);
    if (n !== null) tierMix[k] = n;
  }
  return {
    headcount: num(c.headcount),
    enrolled: num(c.enrolled),
    participationRate: num(c.participationRate),
    averageAge: num(c.averageAge),
    femalePct: num(c.femalePct),
    tierMix,
    statesCount: num(c.statesCount),
  };
}

/** Latest year first; the default `year` of the census route is the first. */
export function sortYearsDesc(years: string[]): string[] {
  return [...new Set(years)].sort((a, b) => (a < b ? 1 : a > b ? -1 : 0));
}
