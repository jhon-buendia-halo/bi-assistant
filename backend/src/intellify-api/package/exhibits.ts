import type { Rfp } from '../rfp/rfp.types';
import type {
  CensusRow,
  FinancialRow,
  PackageData,
  PlanDesignRow,
} from './exhibits.queries';

/** The four exhibits of an RFP package (api.md 2.16.5, I32-I33). */

export const EXHIBIT_NAMES = [
  'exhibit-a-census',
  'exhibit-b-plan-designs',
  'exhibit-c-financials',
  'exhibit-d-carriers',
] as const;
export type ExhibitName = (typeof EXHIBIT_NAMES)[number];

export const EXHIBIT_TITLES: Record<ExhibitName, string> = {
  'exhibit-a-census': 'Exhibit A — Census',
  'exhibit-b-plan-designs': 'Exhibit B — Plan designs',
  'exhibit-c-financials': 'Exhibit C — Financials',
  'exhibit-d-carriers': 'Exhibit D — Carriers invited',
};

export type ExhibitRow = Record<string, unknown>;

export interface Exhibit {
  name: ExhibitName;
  title: string;
  /** The CSV header, in order; every row has exactly these keys. */
  columns: string[];
  rows: ExhibitRow[];
}

export function isExhibitName(name: string): name is ExhibitName {
  return (EXHIBIT_NAMES as readonly string[]).includes(name);
}

const CENSUS_COLUMNS: (keyof CensusRow)[] = [
  'documentId',
  'clientOneCode',
  'effectiveYear',
  'totalEmployees',
  'eligibleEmployees',
  'enrolledEmployees',
  'averageAge',
  'averageSalary',
  'femalePct',
  'malePct',
  'fullTime',
  'partTime',
  'tierEmployeeOnly',
  'tierEmployeeSpouse',
  'tierEmployeeChildren',
  'tierFamily',
  'statesCount',
  'participationRate',
  'source',
  'uploadedAt',
];

const PLAN_DESIGN_COLUMNS: (keyof PlanDesignRow)[] = [
  'id',
  'clientOneCode',
  'clientName',
  'line',
  'planType',
  'carrier',
  'fundingType',
  'state',
  'creationFlag',
  'policyNumber',
  'enrolledEmployees',
  'annualPremium',
  'planYear',
];

const FINANCIAL_COLUMNS: (keyof FinancialRow)[] = [
  'coverageId',
  'clientOneCode',
  'line',
  'planDesignId',
  'carrier',
  'fundingType',
  'planType',
  'ratingBasis',
  'planYear',
  'enrolledEmployees',
  'coveredLives',
  'monthlyPremium',
  'annualPremium',
  'priorYearAnnualPremium',
  'renewalIncreasePct',
  'employerPct',
  'employeeMonthlyEmployeeOnly',
  'adminFeePepm',
  'stopLossPepm',
  'ratePer1000',
  'pepm',
  'rateEmployeeOnly',
  'rateEmployeeSpouse',
  'rateEmployeeChildren',
  'rateFamily',
  'enrollEmployeeOnly',
  'enrollEmployeeSpouse',
  'enrollEmployeeChildren',
  'enrollFamily',
];

/** `RfpCarrier` without its ids. */
const CARRIER_COLUMNS = [
  'position',
  'insurerName',
  'lines',
  'incumbent',
  'contactEmail',
  'notes',
];

const pick = (row: object, columns: string[]): ExhibitRow =>
  Object.fromEntries(
    columns.map((c) => [c, (row as Record<string, unknown>)[c] ?? null]),
  );

/**
 * The exhibits for an RFP: A the latest census, one row per state (the
 * `CensusRow` columns, then `state` and `stateEmployees`); B the plan
 * designs of the lines in scope; C their financials; D the invited carriers.
 */
export function buildExhibits(rfp: Rfp, data: PackageData): Exhibit[] {
  const censusColumns = [...CENSUS_COLUMNS, 'state', 'stateEmployees'];
  const census = data.census;
  const states: { state: string | null; employees: number | null }[] = census
    ?.byState.length
    ? census.byState
    : [{ state: null, employees: null }];
  const censusRows: ExhibitRow[] = !census
    ? []
    : states.map((s) =>
        pick(
          { ...census.row, state: s.state, stateEmployees: s.employees },
          censusColumns,
        ),
      );
  return [
    {
      name: 'exhibit-a-census',
      title: EXHIBIT_TITLES['exhibit-a-census'],
      columns: censusColumns,
      rows: censusRows,
    },
    {
      name: 'exhibit-b-plan-designs',
      title: EXHIBIT_TITLES['exhibit-b-plan-designs'],
      columns: PLAN_DESIGN_COLUMNS,
      rows: data.planDesigns.map((r) => pick(r, PLAN_DESIGN_COLUMNS)),
    },
    {
      name: 'exhibit-c-financials',
      title: EXHIBIT_TITLES['exhibit-c-financials'],
      columns: FINANCIAL_COLUMNS,
      rows: data.financials.map((r) => pick(r, FINANCIAL_COLUMNS)),
    },
    {
      name: 'exhibit-d-carriers',
      title: EXHIBIT_TITLES['exhibit-d-carriers'],
      columns: CARRIER_COLUMNS,
      rows: rfp.carriers.map((c) => pick(c, CARRIER_COLUMNS)),
    },
  ];
}

/** One CSV field: arrays joined with `; `, null as empty, quoted when needed. */
export function csvField(value: unknown): string {
  let text: string;
  if (value === null || value === undefined) text = '';
  else if (typeof value === 'string') text = value;
  else if (Array.isArray(value)) text = value.map(String).join('; ');
  else if (typeof value === 'object') text = JSON.stringify(value);
  else if (
    typeof value === 'number' ||
    typeof value === 'boolean' ||
    typeof value === 'bigint'
  ) {
    text = String(value);
  } else text = '';
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** RFC 4180: a header row, CRLF line breaks, a CRLF after the last record. */
export function toCsv(columns: string[], rows: ExhibitRow[]): string {
  return [columns, ...rows.map((row) => columns.map((c) => row[c]))]
    .map((fields) => fields.map(csvField).join(',') + '\r\n')
    .join('');
}

export function exhibitCsv(exhibit: Exhibit): string {
  return toCsv(exhibit.columns, exhibit.rows);
}
