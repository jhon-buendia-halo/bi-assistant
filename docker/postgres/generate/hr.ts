/**
 * Generator for the `hr` synthetic eval fixture.
 *
 * Writes `docker/postgres/init/004_hr.sql` from one hard-coded seed, so the
 * output is byte-identical on every run and every hand-verified `expectedSql`
 * in the eval set stays valid. Every random draw comes from the single `Rng`
 * below — never `Math.random()`.
 *
 * Run from `backend/` with:
 *
 *   npm run fixtures:hr
 *
 * or from the repo root with:
 *
 *   npx ts-node -T --compilerOptions '{"module":"commonjs","moduleResolution":"node"}' \
 *     docker/postgres/generate/hr.ts
 *
 * The traps HR1-HR10 in `docs/evals/synthetic-domains.md` (Domain 3 — `hr`)
 * are planted here. The org chart that carries the exact ones — the 22/22
 * department tie, the three-level reporting line under Helena Voss, the
 * Data-family analysts sitting outside the Technology division — is laid out
 * by hand below; everything else is drawn from the seed and then asserted.
 * This script throws rather than emit a fixture with a broken trap.
 */

import { writeFileSync } from 'fs';
import { join } from 'path';
import { Rng, literal, insertRows, section } from './lib/rng';

/* ------------------------------------------------------------------ knobs */

const SEED = 20260929;
const OUTPUT_PATH = join(__dirname, '..', 'init', '004_hr.sql');

const FIRST_YEAR = 2019;
const LAST_YEAR = 2025;
const YEARS = Array.from({ length: LAST_YEAR - FIRST_YEAR + 1 }, (_, i) => FIRST_YEAR + i);
const DATA_END = `${LAST_YEAR}-12-31`;
/** Individual contributors join once the leadership team is in place. */
const FIRST_IC_HIRE = '2019-07-01';

/** HR9 — the senior manager whose reporting line is three levels deep. */
const SENIOR_MANAGER = 'Helena Voss';
/** HR5 — the two departments tied on active employees at the end of 2025. */
const TIED_DEPARTMENTS = ['Engineering', 'Sales'];
const TIE_HEADCOUNT = 22;
/** HR6 — employee terminations per calendar year, the fixed ones included. */
const TERMINATIONS_BY_YEAR: Record<number, number> = {
  2019: 1,
  2020: 3,
  2021: 4,
  2022: 5,
  2023: 6,
  2024: 8,
  2025: 12,
};
const PROMOTIONS_2025 = 12;
const PROMOTIONS_2024 = 8;
const MIN_PROMOTIONS_2025 = 10;
const MIN_MULTI_ROW_2025 = 20;
const MIN_ENGINEERING_TOP_2025 = 6;
const ENGINEERING_TOP_TARGET = 7;
const MIN_DATA_FAMILY_OUTSIDE_TECH = 3;
const MIN_TERMINATIONS_2025 = 8;

const MERIT_RATE = 0.9;
const CONTRACTOR_PREMIUM = 1.45;
const INTERN_BASE_USD = 42000;

const rng = new Rng(SEED);

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(`INVARIANT FAILED: ${message}`);
}

/* ------------------------------------------------------- reference tables */

type Currency = 'USD' | 'EUR' | 'GBP';
type WorkerType = 'employee' | 'contractor' | 'intern';
type SalaryReason = 'hire' | 'merit' | 'promotion' | 'adjustment' | 'market';
type BonusType = 'annual' | 'spot' | 'retention';
type Family =
  | 'Engineering'
  | 'Data'
  | 'IT'
  | 'Sales'
  | 'Marketing'
  | 'Support'
  | 'Finance'
  | 'People'
  | 'Legal'
  | 'Operations';

const CURRENCIES: readonly Currency[] = ['USD', 'EUR', 'GBP'];
const DIVISIONS = ['Technology', 'Commercial', 'Operations', 'Corporate'] as const;
type Division = (typeof DIVISIONS)[number];
const FAMILIES: readonly Family[] = [
  'Engineering',
  'Data',
  'IT',
  'Sales',
  'Marketing',
  'Support',
  'Finance',
  'People',
  'Legal',
  'Operations',
];
const EMPLOYMENT_TYPES: readonly WorkerType[] = ['employee', 'contractor', 'intern'];
const SALARY_REASONS: readonly SalaryReason[] = ['hire', 'merit', 'promotion', 'adjustment', 'market'];
const BONUS_TYPES: readonly BonusType[] = ['annual', 'spot', 'retention'];
const TIME_OFF_KINDS = ['vacation', 'sick', 'parental'] as const;
const TIME_OFF_STATUSES = ['approved', 'rejected', 'pending'] as const;

interface LocationSeed {
  city: string;
  country: string;
  currency: Currency;
  /** Pay level against the US baseline, in USD terms, before jitter. */
  payIndex: number;
}

const LOCATIONS: LocationSeed[] = [
  { city: 'Austin', country: 'United States', currency: 'USD', payIndex: 0.95 },
  { city: 'New York', country: 'United States', currency: 'USD', payIndex: 1.08 },
  { city: 'London', country: 'United Kingdom', currency: 'GBP', payIndex: 1.18 },
  { city: 'Berlin', country: 'Germany', currency: 'EUR', payIndex: 0.88 },
  { city: 'Lisbon', country: 'Portugal', currency: 'EUR', payIndex: 0.62 },
];

interface DepartmentSeed {
  name: string;
  division: Division;
  costCenter: string;
  /** Where the department's people sit, by relative weight. */
  locations: readonly (readonly [string, number])[];
}

const DEPARTMENTS: DepartmentSeed[] = [
  { name: 'Engineering', division: 'Technology', costCenter: 'CC-1100', locations: [['Austin', 0.45], ['Berlin', 0.25], ['London', 0.15], ['Lisbon', 0.15]] },
  { name: 'Data Platform', division: 'Technology', costCenter: 'CC-1200', locations: [['Austin', 0.4], ['Berlin', 0.3], ['London', 0.3]] },
  { name: 'IT & Security', division: 'Technology', costCenter: 'CC-1300', locations: [['Austin', 0.5], ['Lisbon', 0.3], ['London', 0.2]] },
  { name: 'Sales', division: 'Commercial', costCenter: 'CC-2100', locations: [['New York', 0.4], ['London', 0.3], ['Austin', 0.15], ['Berlin', 0.15]] },
  { name: 'Marketing', division: 'Commercial', costCenter: 'CC-2200', locations: [['New York', 0.5], ['London', 0.25], ['Lisbon', 0.25]] },
  { name: 'Customer Success', division: 'Commercial', costCenter: 'CC-2300', locations: [['Austin', 0.4], ['Lisbon', 0.4], ['London', 0.2]] },
  { name: 'Operations', division: 'Operations', costCenter: 'CC-3100', locations: [['Austin', 0.5], ['Lisbon', 0.5]] },
  { name: 'Facilities', division: 'Operations', costCenter: 'CC-3200', locations: [['Austin', 0.5], ['New York', 0.25], ['Lisbon', 0.25]] },
  { name: 'Finance', division: 'Corporate', costCenter: 'CC-4100', locations: [['New York', 0.6], ['London', 0.4]] },
  { name: 'People', division: 'Corporate', costCenter: 'CC-4200', locations: [['New York', 0.5], ['Austin', 0.25], ['London', 0.25]] },
  { name: 'Legal', division: 'Corporate', costCenter: 'CC-4300', locations: [['New York', 0.5], ['London', 0.5]] },
];

interface TitleSeed {
  title: string;
  family: Family;
  level: number;
}

const TITLES: TitleSeed[] = [
  { title: 'Chief Technology Officer', family: 'Engineering', level: 6 },
  { title: 'Director of Engineering', family: 'Engineering', level: 5 },
  { title: 'Principal Engineer', family: 'Engineering', level: 5 },
  { title: 'Engineering Manager', family: 'Engineering', level: 4 },
  { title: 'Staff Engineer', family: 'Engineering', level: 4 },
  { title: 'Senior Software Engineer', family: 'Engineering', level: 3 },
  { title: 'Software Engineer II', family: 'Engineering', level: 2 },
  { title: 'Software Engineer I', family: 'Engineering', level: 1 },
  { title: 'Engineering Intern', family: 'Engineering', level: 1 },
  { title: 'Head of Data Platform', family: 'Data', level: 5 },
  { title: 'Data Scientist', family: 'Data', level: 3 },
  { title: 'Senior Data Engineer', family: 'Data', level: 3 },
  { title: 'Senior Data Analyst', family: 'Data', level: 3 },
  { title: 'Data Engineer', family: 'Data', level: 2 },
  { title: 'Data Analyst', family: 'Data', level: 2 },
  { title: 'Data Intern', family: 'Data', level: 1 },
  { title: 'IT Manager', family: 'IT', level: 4 },
  { title: 'Security Engineer', family: 'IT', level: 3 },
  { title: 'Systems Administrator', family: 'IT', level: 2 },
  { title: 'IT Support Specialist', family: 'IT', level: 1 },
  { title: 'IT Intern', family: 'IT', level: 1 },
  { title: 'Chief Revenue Officer', family: 'Sales', level: 6 },
  { title: 'Sales Manager', family: 'Sales', level: 4 },
  { title: 'Senior Account Executive', family: 'Sales', level: 3 },
  { title: 'Account Executive', family: 'Sales', level: 2 },
  { title: 'Sales Development Representative', family: 'Sales', level: 1 },
  { title: 'Sales Intern', family: 'Sales', level: 1 },
  { title: 'Head of Marketing', family: 'Marketing', level: 5 },
  { title: 'Marketing Manager', family: 'Marketing', level: 3 },
  { title: 'Content Strategist', family: 'Marketing', level: 2 },
  { title: 'Marketing Coordinator', family: 'Marketing', level: 1 },
  { title: 'Marketing Intern', family: 'Marketing', level: 1 },
  { title: 'Head of Customer Success', family: 'Support', level: 5 },
  { title: 'Support Team Lead', family: 'Support', level: 3 },
  { title: 'Customer Success Manager', family: 'Support', level: 2 },
  { title: 'Customer Support Specialist', family: 'Support', level: 1 },
  { title: 'Support Intern', family: 'Support', level: 1 },
  { title: 'Chief Financial Officer', family: 'Finance', level: 6 },
  { title: 'Finance Manager', family: 'Finance', level: 4 },
  { title: 'Financial Analyst', family: 'Finance', level: 2 },
  { title: 'Accountant', family: 'Finance', level: 2 },
  { title: 'Finance Intern', family: 'Finance', level: 1 },
  { title: 'Head of People', family: 'People', level: 5 },
  { title: 'People Partner', family: 'People', level: 3 },
  { title: 'Recruiter', family: 'People', level: 2 },
  { title: 'HR Generalist', family: 'People', level: 2 },
  { title: 'People Intern', family: 'People', level: 1 },
  { title: 'General Counsel', family: 'Legal', level: 5 },
  { title: 'Legal Counsel', family: 'Legal', level: 3 },
  { title: 'Paralegal', family: 'Legal', level: 1 },
  { title: 'VP Operations', family: 'Operations', level: 6 },
  { title: 'Operations Manager', family: 'Operations', level: 4 },
  { title: 'Facilities Manager', family: 'Operations', level: 4 },
  { title: 'Operations Analyst', family: 'Operations', level: 2 },
  { title: 'Operations Associate', family: 'Operations', level: 1 },
  { title: 'Facilities Coordinator', family: 'Operations', level: 1 },
  { title: 'Operations Intern', family: 'Operations', level: 1 },
];

/** Average annual rate to USD. USD is 1 by construction (CHECK in the DDL). */
const RATES: Record<Currency, Record<number, number>> = {
  USD: { 2019: 1, 2020: 1, 2021: 1, 2022: 1, 2023: 1, 2024: 1, 2025: 1 },
  EUR: { 2019: 1.1195, 2020: 1.1422, 2021: 1.1827, 2022: 1.053, 2023: 1.0813, 2024: 1.0824, 2025: 1.129 },
  GBP: { 2019: 1.2764, 2020: 1.2837, 2021: 1.3757, 2022: 1.2369, 2023: 1.2435, 2024: 1.2781, 2025: 1.3215 },
};

/** Base pay in USD by job level, before family, location and jitter. */
const LEVEL_BASE_USD: Record<number, number> = {
  1: 60000,
  2: 82000,
  3: 112000,
  4: 142000,
  5: 172000,
  6: 225000,
};

const FAMILY_PAY: Record<Family, number> = {
  Engineering: 1.12,
  Data: 1.08,
  IT: 0.98,
  Sales: 0.92,
  Marketing: 0.9,
  Support: 0.82,
  Finance: 1.0,
  People: 0.9,
  Legal: 1.15,
  Operations: 0.8,
};

/** Annual-bonus target as a share of base, by level; Sales adds commission. */
const BONUS_TARGET: Record<number, number> = { 1: 0.05, 2: 0.08, 3: 0.1, 4: 0.15, 5: 0.2, 6: 0.3 };
const SALES_BONUS_UPLIFT = 0.12;
const RATING_BONUS_MULTIPLIER: Record<number, number> = { 1: 0, 2: 0.5, 3: 1, 4: 1.25, 5: 1.5 };
const RATING_WEIGHTS: readonly (readonly [number, number])[] = [
  [1, 0.03],
  [2, 0.12],
  [3, 0.5],
  [4, 0.25],
  [5, 0.1],
];

/* ------------------------------------------------------------ the org chart */

interface LeaderSeed {
  key: string;
  name?: string;
  department: string;
  title: string;
  /** Leader key of the manager; null for a division head. */
  manager: string | null;
  city: string;
}

/**
 * The leadership team, hired first and never terminated, so every manager_id
 * points at someone active for the whole window. Helena Voss's line is
 * CTO -> Director of Engineering -> Engineering Managers -> engineers: three
 * levels below her, which is what makes "reports to" ambiguous (HR9).
 */
const LEADERS: LeaderSeed[] = [
  { key: 'cto', name: SENIOR_MANAGER, department: 'Engineering', title: 'Chief Technology Officer', manager: null, city: 'London' },
  { key: 'dir-eng', department: 'Engineering', title: 'Director of Engineering', manager: 'cto', city: 'Austin' },
  { key: 'principal', department: 'Engineering', title: 'Principal Engineer', manager: 'cto', city: 'Berlin' },
  { key: 'em-1', department: 'Engineering', title: 'Engineering Manager', manager: 'dir-eng', city: 'Austin' },
  { key: 'em-2', department: 'Engineering', title: 'Engineering Manager', manager: 'dir-eng', city: 'Berlin' },
  { key: 'em-3', department: 'Engineering', title: 'Engineering Manager', manager: 'dir-eng', city: 'Lisbon' },
  { key: 'head-data', department: 'Data Platform', title: 'Head of Data Platform', manager: 'cto', city: 'London' },
  { key: 'it-manager', department: 'IT & Security', title: 'IT Manager', manager: 'cto', city: 'Austin' },
  { key: 'cro', department: 'Sales', title: 'Chief Revenue Officer', manager: null, city: 'New York' },
  { key: 'sales-mgr-1', department: 'Sales', title: 'Sales Manager', manager: 'cro', city: 'New York' },
  { key: 'sales-mgr-2', department: 'Sales', title: 'Sales Manager', manager: 'cro', city: 'London' },
  { key: 'head-marketing', department: 'Marketing', title: 'Head of Marketing', manager: 'cro', city: 'New York' },
  { key: 'head-cs', department: 'Customer Success', title: 'Head of Customer Success', manager: 'cro', city: 'Austin' },
  { key: 'cs-lead', department: 'Customer Success', title: 'Support Team Lead', manager: 'head-cs', city: 'Lisbon' },
  { key: 'vp-ops', department: 'Operations', title: 'VP Operations', manager: null, city: 'Austin' },
  { key: 'facilities-mgr', department: 'Facilities', title: 'Facilities Manager', manager: 'vp-ops', city: 'Austin' },
  { key: 'cfo', department: 'Finance', title: 'Chief Financial Officer', manager: null, city: 'New York' },
  { key: 'head-people', department: 'People', title: 'Head of People', manager: 'cfo', city: 'New York' },
  { key: 'gc', department: 'Legal', title: 'General Counsel', manager: 'cfo', city: 'London' },
];

interface IcPlan {
  department: string;
  /** Individual contributors still employed (employment_type 'employee') at 2025-12-31. */
  active: number;
  titles: readonly (readonly [string, number])[];
  /** Titles placed before the weighted draw — the HR1 Data-family distractors live here. */
  fixedTitles?: string[];
  /** Leader keys, assigned round-robin. */
  managers: string[];
}

// Active employees at 2025-12-31 = leaders + `active` per department:
// Engineering 6+16 = 22 and Sales 3+19 = 22 (the HR5 tie), Customer Success
// 2+8 = 10 next. 106 in total.
const IC_PLANS: IcPlan[] = [
  {
    department: 'Engineering',
    active: 16,
    titles: [['Software Engineer I', 0.2], ['Software Engineer II', 0.35], ['Senior Software Engineer', 0.35], ['Staff Engineer', 0.1]],
    managers: ['em-1', 'em-2', 'em-3'],
  },
  {
    department: 'Data Platform',
    active: 8,
    titles: [['Data Engineer', 0.3], ['Senior Data Engineer', 0.25], ['Data Scientist', 0.2], ['Data Analyst', 0.15], ['Senior Data Analyst', 0.1]],
    managers: ['head-data'],
  },
  {
    department: 'IT & Security',
    active: 6,
    titles: [['IT Support Specialist', 0.35], ['Systems Administrator', 0.35], ['Security Engineer', 0.3]],
    managers: ['it-manager'],
  },
  {
    department: 'Sales',
    active: 19,
    titles: [['Sales Development Representative', 0.3], ['Account Executive', 0.45], ['Senior Account Executive', 0.25]],
    managers: ['sales-mgr-1', 'sales-mgr-2'],
  },
  {
    department: 'Marketing',
    active: 7,
    titles: [['Marketing Coordinator', 0.35], ['Content Strategist', 0.35], ['Marketing Manager', 0.3]],
    fixedTitles: ['Data Analyst', 'Data Analyst'],
    managers: ['head-marketing'],
  },
  {
    department: 'Customer Success',
    active: 8,
    titles: [['Customer Support Specialist', 0.5], ['Customer Success Manager', 0.5]],
    managers: ['cs-lead'],
  },
  {
    department: 'Operations',
    active: 8,
    titles: [['Operations Associate', 0.45], ['Operations Analyst', 0.4], ['Operations Manager', 0.15]],
    managers: ['vp-ops'],
  },
  {
    department: 'Facilities',
    active: 3,
    titles: [['Facilities Coordinator', 1]],
    managers: ['facilities-mgr'],
  },
  {
    department: 'Finance',
    active: 6,
    titles: [['Accountant', 0.4], ['Financial Analyst', 0.4], ['Finance Manager', 0.2]],
    fixedTitles: ['Senior Data Analyst', 'Data Scientist'],
    managers: ['cfo'],
  },
  {
    department: 'People',
    active: 4,
    titles: [['HR Generalist', 0.35], ['Recruiter', 0.35], ['People Partner', 0.3]],
    managers: ['head-people'],
  },
  {
    department: 'Legal',
    active: 2,
    titles: [['Legal Counsel', 0.5], ['Paralegal', 0.5]],
    managers: ['gc'],
  },
];

interface FixedWorkerSeed {
  department: string;
  title: string;
  manager: string;
  hiredOn: string;
  terminatedOn: string | null;
  city?: string;
}

/** Terminations placed by hand; they count toward TERMINATIONS_BY_YEAR. */
const FIXED_TERMINATIONS: FixedWorkerSeed[] = [
  // HR9 distractor: a former direct report of the senior manager, still on
  // manager_id = Helena Voss, so a direct-report count that forgets the
  // active filter comes out one too high.
  { department: 'Engineering', title: 'Principal Engineer', manager: 'cto', hiredOn: '2019-05-06', terminatedOn: '2023-03-31', city: 'Austin' },
  // HR6: hired and gone inside 2025 — in the attrition numerator, never in
  // the 1 January denominator.
  { department: 'Sales', title: 'Account Executive', manager: 'sales-mgr-1', hiredOn: '2025-02-03', terminatedOn: '2025-08-29', city: 'New York' },
];

/** HR3: contractors carry salary rows too; present in every division. */
const CONTRACTORS: FixedWorkerSeed[] = [
  { department: 'Engineering', title: 'Senior Software Engineer', manager: 'em-1', hiredOn: '2023-03-06', terminatedOn: null },
  { department: 'Engineering', title: 'Senior Software Engineer', manager: 'em-2', hiredOn: '2024-05-13', terminatedOn: null },
  { department: 'Engineering', title: 'Staff Engineer', manager: 'dir-eng', hiredOn: '2025-02-03', terminatedOn: null },
  { department: 'Engineering', title: 'Software Engineer II', manager: 'em-3', hiredOn: '2021-09-06', terminatedOn: '2023-06-30' },
  { department: 'Data Platform', title: 'Senior Data Engineer', manager: 'head-data', hiredOn: '2024-01-08', terminatedOn: null },
  { department: 'IT & Security', title: 'Security Engineer', manager: 'it-manager', hiredOn: '2022-10-03', terminatedOn: '2025-04-30' },
  { department: 'IT & Security', title: 'Systems Administrator', manager: 'it-manager', hiredOn: '2025-03-03', terminatedOn: null },
  { department: 'Sales', title: 'Account Executive', manager: 'sales-mgr-1', hiredOn: '2024-02-05', terminatedOn: null },
  { department: 'Sales', title: 'Senior Account Executive', manager: 'sales-mgr-2', hiredOn: '2023-07-10', terminatedOn: '2025-06-30' },
  { department: 'Marketing', title: 'Content Strategist', manager: 'head-marketing', hiredOn: '2022-04-04', terminatedOn: null },
  { department: 'Marketing', title: 'Marketing Manager', manager: 'head-marketing', hiredOn: '2020-09-07', terminatedOn: '2022-03-31' },
  { department: 'Customer Success', title: 'Customer Success Manager', manager: 'cs-lead', hiredOn: '2024-08-05', terminatedOn: null },
  { department: 'Operations', title: 'Operations Analyst', manager: 'vp-ops', hiredOn: '2023-01-09', terminatedOn: null },
  { department: 'Facilities', title: 'Facilities Coordinator', manager: 'facilities-mgr', hiredOn: '2019-10-07', terminatedOn: '2021-12-31' },
  { department: 'Finance', title: 'Financial Analyst', manager: 'cfo', hiredOn: '2024-10-07', terminatedOn: null },
  { department: 'Legal', title: 'Legal Counsel', manager: 'gc', hiredOn: '2025-01-13', terminatedOn: null },
];

/** HR3: interns carry salary rows too; present in every division. */
const INTERNS: FixedWorkerSeed[] = [
  { department: 'Engineering', title: 'Engineering Intern', manager: 'em-1', hiredOn: '2025-09-01', terminatedOn: null },
  { department: 'Engineering', title: 'Engineering Intern', manager: 'em-2', hiredOn: '2025-09-15', terminatedOn: null },
  { department: 'Engineering', title: 'Engineering Intern', manager: 'em-3', hiredOn: '2024-06-03', terminatedOn: '2024-08-30' },
  { department: 'Engineering', title: 'Engineering Intern', manager: 'em-1', hiredOn: '2024-09-02', terminatedOn: '2025-02-28' },
  { department: 'Data Platform', title: 'Data Intern', manager: 'head-data', hiredOn: '2023-06-05', terminatedOn: '2023-09-01' },
  { department: 'IT & Security', title: 'IT Intern', manager: 'it-manager', hiredOn: '2025-06-02', terminatedOn: '2025-08-29' },
  { department: 'Sales', title: 'Sales Intern', manager: 'sales-mgr-2', hiredOn: '2024-09-09', terminatedOn: '2025-03-14' },
  { department: 'Sales', title: 'Sales Intern', manager: 'sales-mgr-1', hiredOn: '2025-10-06', terminatedOn: null },
  { department: 'Marketing', title: 'Marketing Intern', manager: 'head-marketing', hiredOn: '2022-06-06', terminatedOn: '2022-08-26' },
  { department: 'Customer Success', title: 'Support Intern', manager: 'cs-lead', hiredOn: '2025-07-07', terminatedOn: null },
  { department: 'Operations', title: 'Operations Intern', manager: 'vp-ops', hiredOn: '2024-10-01', terminatedOn: '2025-01-31' },
  { department: 'Finance', title: 'Finance Intern', manager: 'cfo', hiredOn: '2025-06-16', terminatedOn: null },
  { department: 'People', title: 'People Intern', manager: 'head-people', hiredOn: '2021-06-07', terminatedOn: '2021-08-27' },
];

const HIRE_YEAR_WEIGHTS: readonly (readonly [number, number])[] = [
  [2019, 0.08],
  [2020, 0.1],
  [2021, 0.14],
  [2022, 0.16],
  [2023, 0.17],
  [2024, 0.18],
  [2025, 0.17],
];

const FIRST_NAMES = [
  'Amara', 'Bastian', 'Chloe', 'Dmitri', 'Elif', 'Farid', 'Greta', 'Hugo',
  'Ines', 'Jonas', 'Kavya', 'Luca', 'Maren', 'Nikhil', 'Olga', 'Pablo',
  'Quinn', 'Rhea', 'Soren', 'Tamsin', 'Umar', 'Vera', 'Wes', 'Ximena',
  'Yusuf', 'Zara', 'Aiden', 'Beatriz', 'Callum', 'Daria', 'Emeka', 'Freya',
  'Gideon', 'Hana', 'Ivo', 'Jada', 'Kenji', 'Leonie', 'Mateo', 'Nadia',
  'Oskar', 'Priya', 'Rafael', 'Saskia', 'Tobias', 'Uma', 'Viktor', 'Wren',
  'Yara', 'Zeno', 'Alma', 'Bruno', 'Celeste', 'Dario', 'Esme', 'Felix',
  'Gwen', 'Henrik', 'Iris', 'Joaquin', 'Kira', 'Lars', 'Mina', 'Noah',
];

const LAST_NAMES = [
  'Abara', 'Bergstrom', 'Castellanos', 'Dubois', 'Eriksen', 'Ferreira', 'Gallagher', 'Haddad',
  'Ishikawa', 'Jovanovic', 'Kowalski', 'Lindqvist', 'Moreau', 'Nakamura', 'Okonkwo', 'Petrov',
  'Quintero', 'Rasmussen', 'Santos', 'Takahashi', 'Umarov', 'Varga', 'Whitfield', 'Xu',
  'Yilmaz', 'Zielinski', 'Almeida', 'Brennan', 'Chowdhury', 'Delacroix', 'Esposito', 'Fischer',
  'Grant', 'Hoffmann', 'Iyer', 'Jansen', 'Kaur', 'Lowe', 'Mendes', 'Novak',
  'Oyelaran', 'Pereira', 'Rahman', 'Schmidt', 'Thornton', 'Vasquez', 'Weber', 'Adeyemi',
  'Bauer', 'Costa', 'Dvorak', 'Engel', 'Fontaine', 'Gupta', 'Holm', 'Keller',
  'Lopes', 'Marsh', 'Nilsen', 'Ortega', 'Park', 'Reyes', 'Silva', 'Torres',
];

/* --------------------------------------------------------------- helpers */

function pad(value: number, width: number): string {
  return String(value).padStart(width, '0');
}

function roundTo(value: number, step: number): number {
  return Math.round(value / step) * step;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function minDate(a: string, b: string): string {
  return a < b ? a : b;
}

function maxDate(a: string, b: string): string {
  return a > b ? a : b;
}

function yearEnd(year: number): string {
  return `${year}-12-31`;
}

function yearStart(year: number): string {
  return `${year}-01-01`;
}

function mean(values: readonly number[]): number {
  assert(values.length > 0, 'mean() of an empty list');
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

function sum(values: readonly number[]): number {
  return values.reduce((total, v) => total + v, 0);
}

function indexOf<T>(items: readonly T[], predicate: (item: T) => boolean, what: string): number {
  const index = items.findIndex(predicate);
  assert(index >= 0, `unknown ${what}`);
  return index;
}

const departmentIdx = (name: string) => indexOf(DEPARTMENTS, (d) => d.name === name, `department "${name}"`);
const locationIdx = (city: string) => indexOf(LOCATIONS, (l) => l.city === city, `location "${city}"`);
const titleIdx = (title: string) => indexOf(TITLES, (t) => t.title === title, `job title "${title}"`);

function rate(currency: Currency, year: number): number {
  const value = RATES[currency][year];
  assert(value !== undefined, `no ${currency} rate for ${year}`);
  return value;
}

/* --------------------------------------------------------- build workers */

interface Worker {
  /** Creation order — stable, and the tie-break when two hire dates match. */
  idx: number;
  /** 1..N after sorting by hire date; the identity value Postgres assigns. */
  id: number;
  key?: string;
  employeeNumber: string;
  fullName: string;
  deptIdx: number;
  locationIdx: number;
  titleIdx: number;
  managerIdx: number | null;
  type: WorkerType;
  hiredOn: string;
  terminatedOn: string | null;
  /** The one promotion this worker gets inside the window, if any. */
  promotedOn: string | null;
}

const workers: Worker[] = [];
const leaderIdx = new Map<string, number>();

function addWorker(fields: {
  key?: string;
  fullName?: string;
  deptIdx: number;
  locationIdx: number;
  titleIdx: number;
  managerIdx: number | null;
  type: WorkerType;
  hiredOn: string;
  terminatedOn: string | null;
}): Worker {
  const worker: Worker = {
    ...fields,
    idx: workers.length,
    id: 0,
    employeeNumber: '',
    fullName: fields.fullName ?? '',
    promotedOn: null,
  };
  workers.push(worker);
  return worker;
}

function pickLocation(deptIdx: number): number {
  return locationIdx(rng.weighted(DEPARTMENTS[deptIdx].locations));
}

function leader(key: string): number {
  const idx = leaderIdx.get(key);
  assert(idx !== undefined, `unknown leader "${key}"`);
  return idx;
}

function activeOn(worker: Worker, date: string): boolean {
  return worker.hiredOn <= date && (worker.terminatedOn === null || worker.terminatedOn > date);
}

// Leaders first, a few days apart, so each one's manager is already on file.
{
  let hiredOn = '2019-01-07';
  for (const seed of LEADERS) {
    const manager = seed.manager === null ? null : leader(seed.manager);
    const worker = addWorker({
      key: seed.key,
      fullName: seed.name,
      deptIdx: departmentIdx(seed.department),
      locationIdx: locationIdx(seed.city),
      titleIdx: titleIdx(seed.title),
      managerIdx: manager,
      type: 'employee',
      hiredOn,
      terminatedOn: null,
    });
    leaderIdx.set(seed.key, worker.idx);
    hiredOn = rng.dateAfter(hiredOn, rng.int(4, 9));
  }
  assert(hiredOn < FIRST_IC_HIRE, 'the leadership team must be hired before the first individual contributor');
}

function hireWindow(year: number): [string, string] {
  if (year === FIRST_YEAR) return [FIRST_IC_HIRE, '2019-12-20'];
  if (year === LAST_YEAR) return ['2025-01-06', '2025-11-28'];
  return [`${year}-01-06`, `${year}-12-19`];
}

// Individual contributors still employed at the end of the data.
for (const plan of IC_PLANS) {
  const deptIdx = departmentIdx(plan.department);
  const titles = [...(plan.fixedTitles ?? [])];
  while (titles.length < plan.active) titles.push(rng.weighted(plan.titles));
  titles.forEach((title, i) => {
    const [from, to] = hireWindow(rng.weighted(HIRE_YEAR_WEIGHTS));
    addWorker({
      deptIdx,
      locationIdx: pickLocation(deptIdx),
      titleIdx: titleIdx(title),
      managerIdx: leader(plan.managers[i % plan.managers.length]),
      type: 'employee',
      hiredOn: rng.dateBetween(from, to),
      terminatedOn: null,
    });
  });
}

function addFixed(seed: FixedWorkerSeed, type: WorkerType): Worker {
  const deptIdx = departmentIdx(seed.department);
  return addWorker({
    deptIdx,
    locationIdx: seed.city ? locationIdx(seed.city) : pickLocation(deptIdx),
    titleIdx: titleIdx(seed.title),
    managerIdx: leader(seed.manager),
    type,
    hiredOn: seed.hiredOn,
    terminatedOn: seed.terminatedOn,
  });
}

// HR6: terminated employees — the fixed ones, then drawn ones per year.
const terminatedEmployees: Worker[] = FIXED_TERMINATIONS.map((seed) => addFixed(seed, 'employee'));
{
  const planWeights = IC_PLANS.map((plan, i) => [i, plan.active] as const);
  const perPlan = IC_PLANS.map(() => 0);
  for (const year of YEARS) {
    const fixed = FIXED_TERMINATIONS.filter((seed) => seed.terminatedOn?.startsWith(String(year))).length;
    const drawn = TERMINATIONS_BY_YEAR[year] - fixed;
    assert(drawn >= 0, `more fixed terminations than planned in ${year}`);
    // At least 150 days of tenure, and nobody leaves on 1 January or at year end.
    const from = maxDate(`${year}-01-06`, rng.dateAfter(FIRST_IC_HIRE, 150));
    const to = year === LAST_YEAR ? '2025-12-12' : `${year}-12-19`;
    for (let k = 0; k < drawn; k++) {
      const planIdx = rng.weighted(planWeights);
      const plan = IC_PLANS[planIdx];
      const deptIdx = departmentIdx(plan.department);
      const terminatedOn = rng.dateBetween(from, to);
      const hiredOn = rng.dateBetween(FIRST_IC_HIRE, rng.dateAfter(terminatedOn, -150));
      terminatedEmployees.push(
        addWorker({
          deptIdx,
          locationIdx: pickLocation(deptIdx),
          titleIdx: titleIdx(rng.weighted(plan.titles)),
          managerIdx: leader(plan.managers[perPlan[planIdx]++ % plan.managers.length]),
          type: 'employee',
          hiredOn,
          terminatedOn,
        }),
      );
    }
  }
}

// HR5 must not survive dropping the termination filter: if the tied
// departments also lost the same number of people, move one Sales leaver to
// Customer Success (same division, same manager chain above).
{
  const leaversIn = (name: string) =>
    terminatedEmployees.filter((w) => DEPARTMENTS[w.deptIdx].name === name);
  if (leaversIn('Engineering').length === leaversIn('Sales').length) {
    const movable = leaversIn('Sales').filter((w) => !FIXED_TERMINATIONS.some((s) => s.hiredOn === w.hiredOn && s.department === 'Sales'));
    const moved = movable[movable.length - 1];
    assert(moved !== undefined, 'HR5: no Sales leaver to move');
    const cs = IC_PLANS.find((plan) => plan.department === 'Customer Success')!;
    moved.deptIdx = departmentIdx('Customer Success');
    moved.locationIdx = pickLocation(moved.deptIdx);
    moved.titleIdx = titleIdx(rng.weighted(cs.titles));
    moved.managerIdx = leader(cs.managers[0]);
  }
}

for (const seed of CONTRACTORS) addFixed(seed, 'contractor');
for (const seed of INTERNS) addFixed(seed, 'intern');

// Ids follow hire date, the way an HRIS assigns employee numbers.
const ordered = [...workers].sort((a, b) =>
  a.hiredOn < b.hiredOn ? -1 : a.hiredOn > b.hiredOn ? 1 : a.idx - b.idx,
);
ordered.forEach((worker, i) => {
  worker.id = i + 1;
  worker.employeeNumber = `E-${pad(1000 + i + 1, 4)}`;
});

{
  const used = new Set(workers.filter((w) => w.fullName).map((w) => w.fullName));
  for (const worker of ordered) {
    if (worker.fullName) continue;
    let name: string;
    do {
      name = `${rng.pick(FIRST_NAMES)} ${rng.pick(LAST_NAMES)}`;
    } while (used.has(name));
    used.add(name);
    worker.fullName = name;
  }
}

const isLeader = (w: Worker) => w.key !== undefined;
const departmentOf = (w: Worker) => DEPARTMENTS[w.deptIdx];
const titleOf = (w: Worker) => TITLES[w.titleIdx];
const locationOf = (w: Worker) => LOCATIONS[w.locationIdx];
const currencyOf = (w: Worker) => locationOf(w).currency;
const idOf = (idx: number) => workers[idx].id;
const senior = workers[leader('cto')];

/* --------------------------------------------------- HR8: the promotions */

// 2025: still employed, hired before 2024 (so an April 2025 merit row sits
// between the 2024 row and the promotion), a title at level 2 or above.
// Data Platform and IT & Security take a market adjustment on 1 October, so
// their promotions land on 1 July.
const promoted2025 = rng
  .shuffle(
    ordered.filter(
      (w) =>
        w.type === 'employee' &&
        !isLeader(w) &&
        w.terminatedOn === null &&
        w.hiredOn < '2024-01-01' &&
        titleOf(w).level >= 2,
    ),
  )
  .slice(0, PROMOTIONS_2025);
assert(promoted2025.length === PROMOTIONS_2025, `HR8: only ${promoted2025.length} promotion candidates for 2025`);
for (const worker of promoted2025) {
  const dept = departmentOf(worker).name;
  worker.promotedOn =
    dept === 'Data Platform' || dept === 'IT & Security'
      ? '2025-07-01'
      : rng.pick(['2025-07-01', '2025-10-01']);
}

const promoted2024 = rng
  .shuffle(
    ordered.filter(
      (w) =>
        w.type === 'employee' &&
        !isLeader(w) &&
        w.promotedOn === null &&
        w.hiredOn < '2023-04-01' &&
        activeOn(w, '2024-10-01') &&
        titleOf(w).level >= 2,
    ),
  )
  .slice(0, PROMOTIONS_2024);
assert(promoted2024.length === PROMOTIONS_2024, `HR8: only ${promoted2024.length} promotion candidates for 2024`);
for (const worker of promoted2024) worker.promotedOn = rng.pick(['2024-07-01', '2024-10-01']);

/* ------------------------------------------------------- salary history */

interface SalaryRow {
  workerIdx: number;
  effectiveFrom: string;
  effectiveTo: string | null;
  amount: number;
  currency: Currency;
  reason: SalaryReason;
}

interface PayEvent {
  date: string;
  reason: SalaryReason;
  pct: number;
}

const salaryByWorker = new Map<number, SalaryRow[]>();

function hireAmount(worker: Worker): number {
  const title = titleOf(worker);
  const location = locationOf(worker);
  const hireYear = Number(worker.hiredOn.slice(0, 4));
  let usd: number;
  if (worker.type === 'intern') {
    usd = INTERN_BASE_USD * location.payIndex * rng.float(0.95, 1.05, 4);
  } else {
    // A promoted worker was hired one level below the title they hold now.
    const level = worker.promotedOn ? Math.max(1, title.level - 1) : title.level;
    usd =
      LEVEL_BASE_USD[level] *
      FAMILY_PAY[title.family] *
      location.payIndex *
      rng.float(0.92, 1.08, 4) *
      (worker.type === 'contractor' ? CONTRACTOR_PREMIUM : 1);
  }
  return roundTo(usd / rate(location.currency, hireYear), 100);
}

for (const worker of ordered) {
  const dept = departmentOf(worker).name;
  const employed = (date: string) => activeOn(worker, date);
  const events: PayEvent[] = [];

  if (worker.type === 'employee') {
    // Merit every 1 April from 2021 (2020 was a pay freeze), for anyone hired
    // before the previous October.
    for (let year = 2021; year <= LAST_YEAR; year++) {
      const date = `${year}-04-01`;
      if (!(worker.hiredOn < `${year - 1}-10-01`) || !employed(date)) continue;
      const forced = worker.promotedOn !== null && worker.promotedOn.startsWith(String(year));
      if (forced || rng.chance(MERIT_RATE)) {
        events.push({ date, reason: 'merit', pct: rng.float(0.02, 0.045, 4) });
      }
    }
    if ((dept === 'Engineering' || dept === 'Data Platform') && worker.hiredOn < '2022-01-01' && employed('2022-07-01')) {
      events.push({ date: '2022-07-01', reason: 'market', pct: rng.float(0.05, 0.07, 4) });
    }
    if (
      (dept === 'Customer Success' || dept === 'Operations' || dept === 'Facilities') &&
      worker.hiredOn < '2022-07-01' &&
      employed('2023-01-16') &&
      rng.chance(0.5)
    ) {
      events.push({ date: '2023-01-16', reason: 'adjustment', pct: rng.float(0.02, 0.04, 4) });
    }
    if ((dept === 'Data Platform' || dept === 'IT & Security') && worker.hiredOn < '2025-01-01' && employed('2025-10-01')) {
      events.push({ date: '2025-10-01', reason: 'market', pct: rng.float(0.04, 0.06, 4) });
    }
    if (worker.promotedOn) {
      events.push({ date: worker.promotedOn, reason: 'promotion', pct: rng.float(0.08, 0.15, 4) });
    }
  } else if (worker.type === 'contractor') {
    // Contract renewals, each 15 January after a full half-year on the books.
    const hireYear = Number(worker.hiredOn.slice(0, 4));
    for (let year = hireYear + 1; year <= LAST_YEAR; year++) {
      const date = `${year}-01-15`;
      if (!(worker.hiredOn < `${year - 1}-07-01`) || !employed(date)) continue;
      if (rng.chance(0.6)) events.push({ date, reason: 'adjustment', pct: rng.float(0.02, 0.05, 4) });
    }
  }

  events.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  for (let i = 1; i < events.length; i++) {
    assert(events[i].date !== events[i - 1].date, `worker ${worker.id}: two pay changes on ${events[i].date}`);
  }

  const currency = currencyOf(worker);
  let amount = hireAmount(worker);
  const rows: SalaryRow[] = [
    { workerIdx: worker.idx, effectiveFrom: worker.hiredOn, effectiveTo: null, amount, currency, reason: 'hire' },
  ];
  for (const event of events) {
    assert(event.date > worker.hiredOn, `worker ${worker.id}: pay change before hire`);
    amount = roundTo(amount * (1 + event.pct), 100);
    rows.push({ workerIdx: worker.idx, effectiveFrom: event.date, effectiveTo: null, amount, currency, reason: event.reason });
  }
  // Contiguous, non-overlapping intervals; the last one closes on termination.
  for (let i = 0; i < rows.length - 1; i++) rows[i].effectiveTo = rows[i + 1].effectiveFrom;
  rows[rows.length - 1].effectiveTo = worker.terminatedOn;
  salaryByWorker.set(worker.idx, rows);
}

function salaryOn(worker: Worker, date: string): SalaryRow | undefined {
  return (salaryByWorker.get(worker.idx) ?? []).find(
    (row) => row.effectiveFrom <= date && (row.effectiveTo === null || row.effectiveTo > date),
  );
}

/* --------------------------------------------------- performance reviews */

interface ReviewRow {
  workerIdx: number;
  year: number;
  rating: number;
  reviewerIdx: number;
}

// Employees only, reviewed by their manager for every year they were on the
// books at 31 December, having joined before October. Division heads have no
// manager and are not rated; contractors and interns are never rated.
const reviews: ReviewRow[] = [];
for (const worker of ordered) {
  if (worker.type !== 'employee' || worker.managerIdx === null) continue;
  for (const year of YEARS) {
    if (!(worker.hiredOn < `${year}-10-01`) || !activeOn(worker, yearEnd(year))) continue;
    reviews.push({ workerIdx: worker.idx, year, rating: rng.weighted(RATING_WEIGHTS), reviewerIdx: worker.managerIdx });
  }
}

function reviewOf(worker: Worker, year: number): ReviewRow | undefined {
  return reviews.find((review) => review.workerIdx === worker.idx && review.year === year);
}

const inDepartment = (name: string) => (review: ReviewRow) => departmentOf(workers[review.workerIdx]).name === name;
const inDivision = (division: Division) => (review: ReviewRow) => departmentOf(workers[review.workerIdx]).division === division;

// HR10: lift Engineering's 2025 top-performer list to its target, keep both a
// 4 and a 5 in it (so "rated 5" is a different, shorter list), and make sure
// the rest of the Technology division has top performers of its own.
{
  const engineering2025 = () => reviews.filter((r) => r.year === LAST_YEAR && inDepartment('Engineering')(r));
  const threes = engineering2025().filter((r) => r.rating === 3);
  for (const review of threes) {
    if (engineering2025().filter((r) => r.rating >= 4).length >= ENGINEERING_TOP_TARGET) break;
    review.rating = 4;
  }
  const top = engineering2025().filter((r) => r.rating >= 4);
  if (!top.some((r) => r.rating === 5)) top[0].rating = 5;
  if (!top.some((r) => r.rating === 4)) top[top.length - 1].rating = 4;

  const otherTech = reviews.filter(
    (r) => r.year === LAST_YEAR && inDivision('Technology')(r) && !inDepartment('Engineering')(r),
  );
  for (const review of otherTech.filter((r) => r.rating === 3)) {
    if (otherTech.filter((r) => r.rating >= 4).length >= 3) break;
    review.rating = 4;
  }
}

/* ------------------------------------------------------- bonus payments */

interface BonusRow {
  workerIdx: number;
  fiscalYear: number;
  amount: number;
  currency: Currency;
  paidOn: string;
  type: BonusType;
}

const bonuses: BonusRow[] = [];

function lastDayEmployed(worker: Worker, year: number): string {
  return worker.terminatedOn ? minDate(rng.dateAfter(worker.terminatedOn, -1), yearEnd(year)) : yearEnd(year);
}

for (const worker of ordered) {
  const title = titleOf(worker);
  const currency = currencyOf(worker);

  // Annual: earned for fiscal year FY (= the calendar year), paid on
  // 14 March of FY+1 to employees on the books at both dates. FY2025's annual
  // bonus falls due in March 2026 and is therefore not in the data.
  if (worker.type === 'employee') {
    for (let fy = FIRST_YEAR; fy < LAST_YEAR; fy++) {
      const paidOn = `${fy + 1}-03-14`;
      if (!(worker.hiredOn < `${fy}-10-01`) || !activeOn(worker, yearEnd(fy)) || !activeOn(worker, paidOn)) continue;
      const base = salaryOn(worker, yearEnd(fy));
      assert(base !== undefined, `worker ${worker.id}: no salary at the end of ${fy}`);
      const review = reviewOf(worker, fy);
      const multiplier = review ? RATING_BONUS_MULTIPLIER[review.rating] : 1;
      if (multiplier === 0) continue;
      const target = BONUS_TARGET[title.level] + (title.family === 'Sales' ? SALES_BONUS_UPLIFT : 0);
      const amount = roundTo(base.amount * target * multiplier * rng.float(0.95, 1.05, 4), 10);
      bonuses.push({ workerIdx: worker.idx, fiscalYear: fy, amount, currency, paidOn, type: 'annual' });
    }
  }

  // Spot awards (employees and, occasionally, contractors) and retention
  // bonuses (senior employees), paid inside the year they are booked to.
  if (worker.type === 'intern') continue;
  for (let year = 2021; year <= LAST_YEAR; year++) {
    const from = maxDate(worker.hiredOn, yearStart(year));
    const to = lastDayEmployed(worker, year);
    if (from > to) continue;
    if (rng.chance(worker.type === 'employee' ? 0.12 : 0.1)) {
      bonuses.push({ workerIdx: worker.idx, fiscalYear: year, amount: rng.int(10, 50) * 50, currency, paidOn: rng.dateBetween(from, to), type: 'spot' });
    }
    if (worker.type === 'employee' && year >= 2022 && title.level >= 3 && rng.chance(0.05)) {
      bonuses.push({ workerIdx: worker.idx, fiscalYear: year, amount: rng.int(10, 30) * 500, currency, paidOn: rng.dateBetween(from, to), type: 'retention' });
    }
  }
}

// HR7 needs a contractor bonus booked to FY2024, so "employees only" moves the total.
if (!bonuses.some((b) => b.fiscalYear === 2024 && workers[b.workerIdx].type === 'contractor')) {
  const contractor = ordered.find((w) => w.type === 'contractor' && activeOn(w, '2024-06-30'));
  assert(contractor !== undefined, 'HR7: no contractor employed in mid-2024');
  bonuses.push({
    workerIdx: contractor.idx,
    fiscalYear: 2024,
    amount: rng.int(10, 50) * 50,
    currency: currencyOf(contractor),
    paidOn: rng.dateBetween(maxDate(contractor.hiredOn, '2024-01-01'), lastDayEmployed(contractor, 2024)),
    type: 'spot',
  });
}

bonuses.sort((a, b) => (a.paidOn < b.paidOn ? -1 : a.paidOn > b.paidOn ? 1 : workers[a.workerIdx].id - workers[b.workerIdx].id));

/* ---------------------------------------------------- time-off requests */

interface TimeOffRow {
  workerIdx: number;
  kind: (typeof TIME_OFF_KINDS)[number];
  startsOn: string;
  endsOn: string;
  days: number;
  status: (typeof TIME_OFF_STATUSES)[number];
}

const timeOff: TimeOffRow[] = [];

function request(worker: Worker, kind: TimeOffRow['kind'], from: string, to: string): void {
  const days =
    kind === 'vacation'
      ? rng.pick([0.5, 1, 2, 3, 4, 5, 5, 8, 10])
      : kind === 'sick'
        ? rng.pick([0.5, 1, 1, 2, 3])
        : rng.int(20, 70);
  const startsOn = rng.dateBetween(from, to);
  const span = kind === 'parental' ? Math.ceil((days * 7) / 5) - 1 : Math.max(0, Math.ceil(days) - 1);
  const endsOn = minDate(rng.dateAfter(startsOn, span), to);
  const status =
    kind === 'sick'
      ? 'approved'
      : startsOn > '2025-11-15'
        ? rng.weighted([['pending', 0.6], ['approved', 0.4]] as const)
        : rng.weighted([['approved', 0.9], ['rejected', 0.1]] as const);
  timeOff.push({ workerIdx: worker.idx, kind, startsOn, endsOn, days, status });
}

for (const worker of ordered) {
  if (worker.type === 'contractor') continue;
  for (const year of [2023, 2024, 2025]) {
    const from = maxDate(worker.hiredOn, yearStart(year));
    const to = lastDayEmployed(worker, year);
    if (from > to) continue;
    const vacations = worker.type === 'intern' ? rng.int(0, 1) : rng.int(1, 4);
    for (let k = 0; k < vacations; k++) request(worker, 'vacation', from, to);
    const sick = worker.type === 'intern' ? 0 : rng.int(0, 2);
    for (let k = 0; k < sick; k++) request(worker, 'sick', from, to);
    if (worker.type === 'employee' && rng.chance(0.03)) request(worker, 'parental', from, to);
  }
}

timeOff.sort((a, b) =>
  a.startsOn < b.startsOn ? -1 : a.startsOn > b.startsOn ? 1 : workers[a.workerIdx].id - workers[b.workerIdx].id,
);

/* ------------------------------------------- the measures the traps probe */

const salaryRows: SalaryRow[] = ordered.flatMap((w) => salaryByWorker.get(w.idx) ?? []);

type Filter = (worker: Worker) => boolean;

const ofTypes = (...types: WorkerType[]): Filter => (w) => types.includes(w.type);
const EMPLOYEES = ofTypes('employee');
const EVERYONE = ofTypes('employee', 'contractor', 'intern');
const inTechDivision: Filter = (w) => departmentOf(w).division === 'Technology';
const TECH_FAMILIES: readonly Family[] = ['Engineering', 'Data', 'IT'];
const inTechFamily: Filter = (w) => TECH_FAMILIES.includes(titleOf(w).family);
const both = (a: Filter, b: Filter): Filter => (w) => a(w) && b(w);

/** Headcount at a date: hired_on <= date AND (terminated_on IS NULL OR terminated_on > date). */
function headcount(date: string, filter: Filter): number {
  return ordered.filter((w) => filter(w) && activeOn(w, date)).length;
}

/** AVG base for a year under a given salary-row rule, in USD or unconverted. */
function averageSalary(
  year: number,
  filter: Filter,
  options: { rule?: 'dec31' | 'startedInYear' | 'overlapsYear'; convert?: boolean } = {},
): number {
  const rule = options.rule ?? 'dec31';
  const convert = options.convert ?? true;
  const values: number[] = [];
  for (const worker of ordered) {
    if (!filter(worker)) continue;
    const rows = salaryByWorker.get(worker.idx) ?? [];
    let picked: SalaryRow[];
    if (rule === 'dec31') {
      if (!activeOn(worker, yearEnd(year))) continue;
      const row = salaryOn(worker, yearEnd(year));
      picked = row ? [row] : [];
    } else if (rule === 'startedInYear') {
      picked = rows.filter((row) => row.effectiveFrom.startsWith(String(year)));
    } else {
      picked = rows.filter(
        (row) => row.effectiveFrom <= yearEnd(year) && (row.effectiveTo === null || row.effectiveTo > yearStart(year)),
      );
    }
    for (const row of picked) values.push(convert ? row.amount * rate(row.currency, year) : row.amount);
  }
  return mean(values);
}

function averageSalaryByLocation(year: number, filter: Filter, convert: boolean): { city: string; avg: number }[] {
  return LOCATIONS.map((location, i) => ({
    city: location.city,
    avg: averageSalary(year, (w) => filter(w) && w.locationIdx === i, { convert }),
  })).sort((a, b) => b.avg - a.avg);
}

function departmentHeadcounts(date: string, filter: Filter, activeOnly = true): { name: string; count: number }[] {
  return DEPARTMENTS.map((dept, i) => ({
    name: dept.name,
    count: ordered.filter((w) => w.deptIdx === i && filter(w) && (activeOnly ? activeOn(w, date) : w.hiredOn <= date)).length,
  })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

/**
 * A bonus total in dollars, already rounded to the cent. Summed in integer
 * millionths (cents x rate/10^4) so the printed answer matches Postgres's
 * exact numeric ROUND(SUM(amount * rate_to_usd), 2) — a float sum can land on
 * the other side of a half-cent.
 */
function bonusTotal(options: { fiscalYear?: number; paidYear?: number; filter: Filter; convert: boolean; rateYear?: 'fiscal' | 'paid' }): number {
  const rateYear = options.rateYear ?? 'fiscal';
  const micros = sum(
    bonuses
      .filter(
        (b) =>
          options.filter(workers[b.workerIdx]) &&
          (options.fiscalYear === undefined || b.fiscalYear === options.fiscalYear) &&
          (options.paidYear === undefined || b.paidOn.startsWith(String(options.paidYear))),
      )
      .map((b) => {
        const fx = options.convert ? rate(b.currency, rateYear === 'fiscal' ? b.fiscalYear : Number(b.paidOn.slice(0, 4))) : 1;
        return Math.round(b.amount * 100) * Math.round(fx * 10000);
      }),
  );
  assert(Number.isSafeInteger(micros), 'bonus total overflowed exact integer arithmetic');
  return Math.round(micros / 10000) / 100;
}

function averageTotalCompensation(
  year: number,
  filter: Filter,
  options: { convert?: boolean; includeBonus?: boolean; bonusByPaidYear?: boolean } = {},
): number {
  const convert = options.convert ?? true;
  const includeBonus = options.includeBonus ?? true;
  const values: number[] = [];
  for (const worker of ordered) {
    if (!filter(worker) || !activeOn(worker, yearEnd(year))) continue;
    const base = salaryOn(worker, yearEnd(year));
    assert(base !== undefined, `worker ${worker.id}: active at the end of ${year} with no salary row`);
    const bonus = includeBonus
      ? sum(
          bonuses
            .filter(
              (b) =>
                b.workerIdx === worker.idx &&
                (options.bonusByPaidYear ? b.paidOn.startsWith(String(year)) : b.fiscalYear === year),
            )
            .map((b) => b.amount),
        )
      : 0;
    values.push((base.amount + bonus) * (convert ? rate(base.currency, year) : 1));
  }
  return mean(values);
}

function attrition(year: number, filter: Filter): { leavers: number; startHeadcount: number; endHeadcount: number } {
  return {
    leavers: ordered.filter((w) => filter(w) && w.terminatedOn !== null && w.terminatedOn.startsWith(String(year))).length,
    startHeadcount: headcount(yearStart(year), filter),
    endHeadcount: headcount(yearEnd(year), filter),
  };
}

interface Promotion {
  worker: Worker;
  row: SalaryRow;
  previous: SalaryRow;
  hire: SalaryRow;
}

function promotionsIn(year: number, filter: Filter): Promotion[] {
  const out: Promotion[] = [];
  for (const worker of ordered) {
    if (!filter(worker)) continue;
    const rows = salaryByWorker.get(worker.idx) ?? [];
    rows.forEach((row, i) => {
      if (row.reason !== 'promotion' || !row.effectiveFrom.startsWith(String(year))) return;
      out.push({ worker, row, previous: rows[i - 1], hire: rows[0] });
    });
  }
  return out;
}

function reportingLine(rootIdx: number, date: string, filter: Filter): { direct: number; total: number; depth: number } {
  let direct = 0;
  let total = 0;
  let depth = 0;
  const walk = (managerIdx: number, level: number) => {
    for (const worker of ordered) {
      if (worker.managerIdx !== managerIdx || !filter(worker) || !activeOn(worker, date)) continue;
      if (level === 1) direct++;
      total++;
      depth = Math.max(depth, level);
      walk(worker.idx, level + 1);
    }
  };
  walk(rootIdx, 1);
  return { direct, total, depth };
}

function topPerformers(year: number, predicate: (review: ReviewRow) => boolean, minRating = 4): string[] {
  return reviews
    .filter((r) => r.year === year && r.rating >= minRating && predicate(r))
    .map((r) => workers[r.workerIdx].fullName)
    .sort();
}

const pctDiff = (a: number, b: number) => Math.abs(a - b) / Math.abs(b);

/* -------------------------------------------------------------- invariants */

// Row-level rules, mirroring the CHECK constraints and the salary contract.
{
  const names = new Set<string>();
  for (const worker of ordered) {
    assert(!names.has(worker.fullName), `duplicate name ${worker.fullName}`);
    names.add(worker.fullName);
    assert(worker.hiredOn >= yearStart(FIRST_YEAR) && worker.hiredOn <= DATA_END, `worker ${worker.id}: hire date outside the window`);
    if (worker.terminatedOn !== null) {
      assert(worker.terminatedOn > worker.hiredOn && worker.terminatedOn <= DATA_END, `worker ${worker.id}: bad termination date`);
    }
    if (worker.managerIdx !== null) {
      const manager = workers[worker.managerIdx];
      assert(manager.id < worker.id, `worker ${worker.id}: manager must be inserted first`);
      assert(manager.terminatedOn === null && manager.hiredOn <= worker.hiredOn, `worker ${worker.id}: manager not employed throughout`);
      assert(manager.type === 'employee', `worker ${worker.id}: managed by a non-employee`);
    }

    const rows = salaryByWorker.get(worker.idx) ?? [];
    assert(rows.length > 0 && rows[0].reason === 'hire' && rows[0].effectiveFrom === worker.hiredOn, `worker ${worker.id}: needs a hire row on the hire date`);
    assert(rows.filter((row) => row.reason === 'hire').length === 1, `worker ${worker.id}: exactly one hire row`);
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      assert(row.amount > 0 && row.currency === currencyOf(worker), `worker ${worker.id}: salary amount/currency`);
      assert(row.effectiveTo === null || row.effectiveTo > row.effectiveFrom, `worker ${worker.id}: empty salary interval`);
      if (i > 0) assert(rows[i - 1].effectiveTo === row.effectiveFrom, `worker ${worker.id}: salary intervals must be contiguous`);
    }
    assert(rows[rows.length - 1].effectiveTo === worker.terminatedOn, `worker ${worker.id}: last salary row must close on termination`);
    // "Salary for a year" and "employed at year end" are the same population.
    for (const year of YEARS) {
      assert(
        (salaryOn(worker, yearEnd(year)) !== undefined) === activeOn(worker, yearEnd(year)),
        `worker ${worker.id}: salary row at the end of ${year} must exist exactly when employed`,
      );
    }
  }
  for (const bonus of bonuses) {
    const worker = workers[bonus.workerIdx];
    assert(bonus.amount > 0 && bonus.currency === currencyOf(worker), `bonus for ${worker.id}: amount/currency`);
    assert(activeOn(worker, bonus.paidOn), `bonus for ${worker.id}: paid while not employed (${bonus.paidOn})`);
    assert(Number(bonus.paidOn.slice(0, 4)) >= bonus.fiscalYear, `bonus for ${worker.id}: paid before its fiscal year`);
    assert(bonus.paidOn <= DATA_END, `bonus for ${worker.id}: paid after the data ends`);
    assert(worker.type !== 'intern', 'interns receive no bonuses');
  }
  for (const review of reviews) {
    const worker = workers[review.workerIdx];
    assert(worker.type === 'employee' && review.reviewerIdx === worker.managerIdx, `review of ${worker.id}: reviewer must be the manager`);
    assert(activeOn(worker, yearEnd(review.year)), `review of ${worker.id}: not employed at the end of ${review.year}`);
  }
  for (const entry of timeOff) {
    assert(entry.endsOn >= entry.startsOn && entry.days > 0, 'time-off request with a bad span');
  }
}

// HR1 - "tech" by division is not "tech" by job family.
const dataOutsideTech = ordered.filter(
  (w) => EMPLOYEES(w) && activeOn(w, DATA_END) && titleOf(w).family === 'Data' && !inTechDivision(w),
);
assert(
  dataOutsideTech.length >= MIN_DATA_FAMILY_OUTSIDE_TECH,
  `HR1: need ${MIN_DATA_FAMILY_OUTSIDE_TECH} Data-family employees outside Technology, got ${dataOutsideTech.length}`,
);
const techAvg2025 = averageSalary(LAST_YEAR, both(EMPLOYEES, inTechDivision));
const techByFamilyAvg2025 = averageSalary(LAST_YEAR, both(EMPLOYEES, inTechFamily));
assert(pctDiff(techByFamilyAvg2025, techAvg2025) >= 0.01, 'HR1: the job-family average must differ visibly from the division average');

// HR2 - the salary for a year is the row effective on 31 December.
const multiRow2025 = ordered.filter(
  (w) =>
    EMPLOYEES(w) &&
    activeOn(w, DATA_END) &&
    (salaryByWorker.get(w.idx) ?? []).filter((row) => row.effectiveFrom.startsWith(String(LAST_YEAR))).length >= 2,
);
assert(
  multiRow2025.length >= MIN_MULTI_ROW_2025,
  `HR2: need ${MIN_MULTI_ROW_2025} employees with 2+ salary rows starting in 2025, got ${multiRow2025.length}`,
);
const techStarted2025 = averageSalary(LAST_YEAR, both(EMPLOYEES, inTechDivision), { rule: 'startedInYear' });
const techOverlaps2025 = averageSalary(LAST_YEAR, both(EMPLOYEES, inTechDivision), { rule: 'overlapsYear' });
assert(pctDiff(techStarted2025, techAvg2025) >= 0.005, 'HR2: "rows starting in 2025" must give a different average');
assert(pctDiff(techOverlaps2025, techAvg2025) >= 0.005, 'HR2: "rows touching 2025" must give a different average');

// HR3 - contractors and interns move the averages.
const techAllTypesAvg2025 = averageSalary(LAST_YEAR, both(EVERYONE, inTechDivision));
assert(pctDiff(techAllTypesAvg2025, techAvg2025) >= 0.01, 'HR3: contractors/interns must move the Technology average');
const salesDept: Filter = (w) => departmentOf(w).name === 'Sales';
const salesComp2024 = averageTotalCompensation(2024, both(EMPLOYEES, salesDept));
const salesCompAllTypes2024 = averageTotalCompensation(2024, both(EVERYONE, salesDept));
assert(pctDiff(salesCompAllTypes2024, salesComp2024) >= 0.01, 'HR3: contractors/interns must move the Sales total-compensation average');
for (const division of DIVISIONS) {
  for (const type of ['contractor', 'intern'] as const) {
    assert(
      ordered.some((w) => w.type === type && departmentOf(w).division === division),
      `HR3: ${division} needs at least one ${type}`,
    );
  }
}

// HR4 - the Technology division is paid in more than one currency.
{
  const techCurrencies = new Set(
    ordered.filter((w) => EMPLOYEES(w) && inTechDivision(w) && activeOn(w, DATA_END)).map(currencyOf),
  );
  assert(techCurrencies.size >= 2, `HR4: Technology must span 2+ currencies, got ${[...techCurrencies].join(', ')}`);
  const unconverted = averageSalary(LAST_YEAR, both(EMPLOYEES, inTechDivision), { convert: false });
  assert(pctDiff(unconverted, techAvg2025) >= 0.02, 'HR4: the unconverted Technology average must be visibly wrong');
}
const locationsConverted = averageSalaryByLocation(LAST_YEAR, EMPLOYEES, true);
const locationsUnconverted = averageSalaryByLocation(LAST_YEAR, EMPLOYEES, false);
assert(locationsConverted[0].avg >= locationsConverted[1].avg * 1.02, 'HR4: the USD location winner must be clear of the runner-up');
assert(locationsUnconverted[0].city !== locationsConverted[0].city, 'HR4: the unconverted location winner must differ from the USD one');

// HR5 - an exact tie at the top, employees only; broken by any looser count.
const headcountByDept = departmentHeadcounts(DATA_END, EMPLOYEES);
{
  const top = headcountByDept.filter((row) => row.count === headcountByDept[0].count).map((row) => row.name).sort();
  assert(
    top.join('|') === [...TIED_DEPARTMENTS].sort().join('|') && headcountByDept[0].count === TIE_HEADCOUNT,
    `HR5: ${TIED_DEPARTMENTS.join(' and ')} must tie on ${TIE_HEADCOUNT}, got ${JSON.stringify(headcountByDept)}`,
  );
  const looser: [string, { name: string; count: number }[]][] = [
    ['employees + contractors', departmentHeadcounts(DATA_END, ofTypes('employee', 'contractor'))],
    ['all worker types', departmentHeadcounts(DATA_END, EVERYONE)],
    ['employees, terminated included', departmentHeadcounts(DATA_END, EMPLOYEES, false)],
  ];
  for (const [label, rows] of looser) {
    assert(rows[0].count > rows[1].count, `HR5: the tie must break under "${label}", got ${JSON.stringify(rows.slice(0, 3))}`);
  }
}

// HR6 - terminations every year, enough of them in 2025.
for (const year of YEARS) {
  const leavers = attrition(year, EMPLOYEES).leavers;
  assert(leavers === TERMINATIONS_BY_YEAR[year], `HR6: expected ${TERMINATIONS_BY_YEAR[year]} terminations in ${year}, got ${leavers}`);
}
const attrition2025 = attrition(LAST_YEAR, EMPLOYEES);
assert(attrition2025.leavers >= MIN_TERMINATIONS_2025, 'HR6: not enough terminations in 2025');

// HR7 - a bonus is not salary, and its fiscal year is not its payment year.
const bonusFy2024 = bonusTotal({ fiscalYear: 2024, filter: EMPLOYEES, convert: true });
const bonusPaid2024 = bonusTotal({ paidYear: 2024, filter: EMPLOYEES, convert: true, rateYear: 'paid' });
assert(pctDiff(bonusPaid2024, bonusFy2024) >= 0.02, 'HR7: bonuses paid in 2024 must differ from bonuses for fiscal 2024');
assert(pctDiff(bonusTotal({ fiscalYear: 2024, filter: EMPLOYEES, convert: false }), bonusFy2024) >= 0.02, 'HR7: the unconverted bonus total must be visibly wrong');
assert(
  bonuses.some((b) => b.fiscalYear === 2024 && workers[b.workerIdx].type === 'contractor'),
  'HR7: a contractor bonus must be booked to FY2024',
);

// HR8 - 2025 promotions, each against a previous row in the same currency.
const promotions2025 = promotionsIn(LAST_YEAR, EMPLOYEES);
assert(promotions2025.length >= MIN_PROMOTIONS_2025, `HR8: need ${MIN_PROMOTIONS_2025} promotions in 2025, got ${promotions2025.length}`);
for (const p of promotions2025) {
  assert(p.previous !== undefined && p.previous.currency === p.row.currency, `HR8: promotion of ${p.worker.id} has no comparable previous row`);
  assert(p.previous.effectiveFrom.startsWith(String(LAST_YEAR)), `HR8: promotion of ${p.worker.id} must follow a 2025 merit row`);
  assert(p.worker.terminatedOn === null, `HR8: promoted worker ${p.worker.id} must still be employed`);
}
assert(new Set(promotions2025.map((p) => p.row.currency)).size >= 2, 'HR8: 2025 promotions must span currencies');
const raiseVsPrevious = mean(promotions2025.map((p) => (100 * (p.row.amount - p.previous.amount)) / p.previous.amount));
const raiseVsHire = mean(promotions2025.map((p) => (100 * (p.row.amount - p.hire.amount)) / p.hire.amount));
assert(raiseVsHire - raiseVsPrevious >= 2, 'HR8: comparing with the hire row must overstate the raise');

// HR9 - three levels under the senior manager; direct and total differ.
const seniorLine = reportingLine(senior.idx, DATA_END, EMPLOYEES);
assert(seniorLine.depth >= 3, `HR9: ${SENIOR_MANAGER}'s line must be 3+ levels deep, got ${seniorLine.depth}`);
assert(seniorLine.total > seniorLine.direct * 3, 'HR9: total reports must dwarf direct reports');
const seniorDirectEver = ordered.filter((w) => w.managerIdx === senior.idx && EMPLOYEES(w)).length;
assert(seniorDirectEver > seniorLine.direct, 'HR9: a former direct report must still point at the senior manager');

// HR10 - top performers: rating >= 4, Engineering department.
const engineeringTop2025 = topPerformers(LAST_YEAR, inDepartment('Engineering'));
assert(engineeringTop2025.length >= MIN_ENGINEERING_TOP_2025, `HR10: need ${MIN_ENGINEERING_TOP_2025} Engineering top performers, got ${engineeringTop2025.length}`);
const engineeringFives2025 = topPerformers(LAST_YEAR, inDepartment('Engineering'), 5);
assert(engineeringFives2025.length > 0 && engineeringFives2025.length < engineeringTop2025.length, 'HR10: "rated 5" must be a shorter, non-empty list');
const techTop2025 = topPerformers(LAST_YEAR, inDivision('Technology'));
assert(techTop2025.length > engineeringTop2025.length, 'HR10: the Technology division must add top performers beyond Engineering');
{
  const top2024 = new Set(topPerformers(2024, inDepartment('Engineering')));
  assert([...top2024].some((name) => !engineeringTop2025.includes(name)), 'HR10: 2024 and 2025 lists must differ');
}

/* ----------------------------------------------------------------- DDL */

const list = (values: readonly string[]) => values.map((v) => literal(v)).join(', ');

const HEADER = `-- =============================================================================
-- hr -- synthetic fixture for the Questions to Insights eval set
--
-- GENERATED FILE. DO NOT EDIT BY HAND.
-- Edit the generator and regenerate; hand edits are lost on the next run.
--
--   generator : docker/postgres/generate/hr.ts
--   seed      : ${SEED}   (single hard-coded constant -- the output is
--               byte-identical on every run, so hand-verified eval SQL stays valid)
--   regenerate: cd backend && npm run fixtures:hr
--
-- Surrogate keys are left to the identity columns: rows are inserted in the
-- order the generator emits them, so id 1..N follows that order and the foreign
-- keys below are the matching literals. employees are inserted by hire date,
-- so every manager_id points at an earlier row.
--
-- Hires run from 2019 to 2025 and the data ends on 2025-12-31: nothing is
-- future-dated and no value depends on the date this file was generated.
-- =============================================================================

BEGIN;

CREATE SCHEMA hr;
SET search_path TO hr, public;

CREATE TABLE departments (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name text NOT NULL UNIQUE,
  division text NOT NULL CHECK (division IN (${list(DIVISIONS)})),
  cost_center text NOT NULL UNIQUE
);

CREATE TABLE locations (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  city text NOT NULL UNIQUE,
  country text NOT NULL,
  currency text NOT NULL CHECK (currency IN (${list(CURRENCIES)}))
);

CREATE TABLE job_titles (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  title text NOT NULL UNIQUE,
  family text NOT NULL CHECK (family IN (${list(FAMILIES)})),
  level integer NOT NULL CHECK (level BETWEEN 1 AND 6)
);

CREATE TABLE exchange_rates (
  currency text NOT NULL CHECK (currency IN (${list(CURRENCIES)})),
  year integer NOT NULL CHECK (year BETWEEN ${FIRST_YEAR} AND ${LAST_YEAR}),
  rate_to_usd numeric(8,4) NOT NULL CHECK (rate_to_usd > 0),
  PRIMARY KEY (currency, year),
  CHECK (currency <> 'USD' OR rate_to_usd = 1)
);

CREATE TABLE employees (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  employee_number text NOT NULL UNIQUE,
  full_name text NOT NULL,
  department_id bigint NOT NULL REFERENCES departments(id),
  location_id bigint NOT NULL REFERENCES locations(id),
  job_title_id bigint NOT NULL REFERENCES job_titles(id),
  manager_id bigint REFERENCES employees(id),
  employment_type text NOT NULL CHECK (employment_type IN (${list(EMPLOYMENT_TYPES)})),
  hired_on date NOT NULL CHECK (hired_on BETWEEN DATE '${yearStart(FIRST_YEAR)}' AND DATE '${DATA_END}'),
  terminated_on date CHECK (terminated_on <= DATE '${DATA_END}'),
  CHECK (terminated_on IS NULL OR terminated_on > hired_on),
  CHECK (manager_id IS NULL OR manager_id <> id)
);

CREATE TABLE salary_history (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  employee_id bigint NOT NULL REFERENCES employees(id),
  effective_from date NOT NULL,
  effective_to date,
  annual_base_amount numeric(12,2) NOT NULL CHECK (annual_base_amount > 0),
  currency text NOT NULL CHECK (currency IN (${list(CURRENCIES)})),
  reason text NOT NULL CHECK (reason IN (${list(SALARY_REASONS)})),
  UNIQUE (employee_id, effective_from),
  CHECK (effective_to IS NULL OR effective_to > effective_from)
);

CREATE TABLE bonus_payments (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  employee_id bigint NOT NULL REFERENCES employees(id),
  fiscal_year integer NOT NULL CHECK (fiscal_year BETWEEN ${FIRST_YEAR} AND ${LAST_YEAR}),
  amount numeric(12,2) NOT NULL CHECK (amount > 0),
  currency text NOT NULL CHECK (currency IN (${list(CURRENCIES)})),
  paid_on date NOT NULL CHECK (paid_on <= DATE '${DATA_END}'),
  bonus_type text NOT NULL CHECK (bonus_type IN (${list(BONUS_TYPES)})),
  CHECK (EXTRACT(YEAR FROM paid_on) >= fiscal_year)
);

CREATE TABLE performance_reviews (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  employee_id bigint NOT NULL REFERENCES employees(id),
  review_year integer NOT NULL CHECK (review_year BETWEEN ${FIRST_YEAR} AND ${LAST_YEAR}),
  rating integer NOT NULL CHECK (rating BETWEEN 1 AND 5),
  reviewer_id bigint NOT NULL REFERENCES employees(id),
  UNIQUE (employee_id, review_year),
  CHECK (reviewer_id <> employee_id)
);

CREATE TABLE time_off_requests (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  employee_id bigint NOT NULL REFERENCES employees(id),
  kind text NOT NULL CHECK (kind IN (${list(TIME_OFF_KINDS)})),
  starts_on date NOT NULL,
  ends_on date NOT NULL,
  days numeric(5,1) NOT NULL CHECK (days > 0),
  status text NOT NULL CHECK (status IN (${list(TIME_OFF_STATUSES)})),
  CHECK (ends_on >= starts_on)
);

CREATE INDEX employees_department_idx ON employees (department_id);
CREATE INDEX employees_location_idx ON employees (location_id);
CREATE INDEX employees_manager_idx ON employees (manager_id);
CREATE INDEX salary_history_employee_idx ON salary_history (employee_id, effective_from);
CREATE INDEX bonus_payments_employee_idx ON bonus_payments (employee_id);
CREATE INDEX bonus_payments_fiscal_year_idx ON bonus_payments (fiscal_year);
CREATE INDEX performance_reviews_year_idx ON performance_reviews (review_year);
CREATE INDEX time_off_requests_employee_idx ON time_off_requests (employee_id);
`;

/* -------------------------------------------------------------- the views */

const VIEWS = `CREATE VIEW v_salary_by_year AS
SELECT
  salary.employee_id,
  calendar.year,
  salary.id AS salary_history_id,
  salary.annual_base_amount,
  salary.currency,
  rate.rate_to_usd,
  ROUND(salary.annual_base_amount * rate.rate_to_usd, 2) AS annual_base_usd
FROM generate_series(${FIRST_YEAR}, ${LAST_YEAR}) AS calendar(year)
JOIN salary_history salary
  ON salary.effective_from <= make_date(calendar.year, 12, 31)
 AND (salary.effective_to IS NULL OR salary.effective_to > make_date(calendar.year, 12, 31))
JOIN exchange_rates rate
  ON rate.currency = salary.currency
 AND rate.year = calendar.year;

CREATE VIEW v_current_employees AS
SELECT
  employee.id AS employee_id,
  employee.employee_number,
  employee.full_name,
  employee.employment_type,
  department.name AS department,
  department.division,
  location.city AS location,
  location.country,
  title.title AS job_title,
  title.family AS job_family,
  title.level AS job_level,
  employee.manager_id,
  employee.hired_on,
  salary.annual_base_amount,
  salary.currency,
  rate.rate_to_usd,
  ROUND(salary.annual_base_amount * rate.rate_to_usd, 2) AS annual_base_usd
FROM employees employee
JOIN departments department ON department.id = employee.department_id
JOIN locations location ON location.id = employee.location_id
JOIN job_titles title ON title.id = employee.job_title_id
JOIN salary_history salary ON salary.employee_id = employee.id AND salary.effective_to IS NULL
JOIN exchange_rates rate
  ON rate.currency = salary.currency
 AND rate.year = (SELECT max(latest.year) FROM exchange_rates latest)
WHERE employee.terminated_on IS NULL;

COMMENT ON SCHEMA hr IS
  ${literal(`Synthetic eval fixture: a mid-size software company's HR records, ${FIRST_YEAR}-${LAST_YEAR}. Amounts are in the employee's location currency.`)};
COMMENT ON COLUMN employees.employment_type IS
  ${literal("employee, contractor or intern. Contractors and interns also have salary rows.")};
COMMENT ON COLUMN employees.terminated_on IS
  ${literal('First day no longer employed; NULL while employed.')};
COMMENT ON COLUMN employees.manager_id IS
  ${literal('Direct manager (self-reference); NULL for the division heads.')};
COMMENT ON COLUMN salary_history.annual_base_amount IS
  ${literal("Annual base pay in the row's currency (the employee's location currency). Bonuses are in bonus_payments.")};
COMMENT ON COLUMN salary_history.effective_to IS
  ${literal('Exclusive end of the interval; NULL for the row still in force. A leaver\'s last row ends on terminated_on.')};
COMMENT ON COLUMN bonus_payments.fiscal_year IS
  ${literal('Calendar year the bonus was earned for. Annual bonuses are paid in March of the following year.')};
COMMENT ON COLUMN performance_reviews.rating IS
  ${literal('1-5, 5 is best. Employees only; contractors and interns are not rated.')};
COMMENT ON TABLE exchange_rates IS
  ${literal('Average rate to USD per currency and calendar year; USD is 1.')};
COMMENT ON VIEW v_salary_by_year IS
  ${literal('One row per worker per year: the salary row effective on 31 December of that year, with that year\'s rate. All employment types.')};
COMMENT ON VIEW v_current_employees IS
  ${literal(`Everyone still employed at the end of the data (${DATA_END}) with the salary row in force, converted at the latest year's rate. All employment types.`)};

COMMIT;
`;

/* ------------------------------------------------------------ INSERT rows */

const blocks: string[] = [
  HEADER,
  section('departments'),
  insertRows('departments', ['name', 'division', 'cost_center'], DEPARTMENTS.map((d) => [d.name, d.division, d.costCenter])),
  section('locations'),
  insertRows('locations', ['city', 'country', 'currency'], LOCATIONS.map((l) => [l.city, l.country, l.currency])),
  section('job_titles'),
  insertRows('job_titles', ['title', 'family', 'level'], TITLES.map((t) => [t.title, t.family, t.level])),
  section('exchange_rates'),
  insertRows(
    'exchange_rates',
    ['currency', 'year', 'rate_to_usd'],
    CURRENCIES.flatMap((currency) => YEARS.map((year) => [currency, year, rate(currency, year)])),
  ),
  section('employees'),
  insertRows(
    'employees',
    ['employee_number', 'full_name', 'department_id', 'location_id', 'job_title_id', 'manager_id', 'employment_type', 'hired_on', 'terminated_on'],
    ordered.map((w) => [
      w.employeeNumber,
      w.fullName,
      w.deptIdx + 1,
      w.locationIdx + 1,
      w.titleIdx + 1,
      w.managerIdx === null ? null : idOf(w.managerIdx),
      w.type,
      w.hiredOn,
      w.terminatedOn,
    ]),
    500,
  ),
  section('salary_history'),
  insertRows(
    'salary_history',
    ['employee_id', 'effective_from', 'effective_to', 'annual_base_amount', 'currency', 'reason'],
    salaryRows.map((row) => [idOf(row.workerIdx), row.effectiveFrom, row.effectiveTo, row.amount, row.currency, row.reason]),
  ),
  section('bonus_payments'),
  insertRows(
    'bonus_payments',
    ['employee_id', 'fiscal_year', 'amount', 'currency', 'paid_on', 'bonus_type'],
    bonuses.map((b) => [idOf(b.workerIdx), b.fiscalYear, b.amount, b.currency, b.paidOn, b.type]),
  ),
  section('performance_reviews'),
  insertRows(
    'performance_reviews',
    ['employee_id', 'review_year', 'rating', 'reviewer_id'],
    [...reviews]
      .sort((a, b) => a.year - b.year || idOf(a.workerIdx) - idOf(b.workerIdx))
      .map((r) => [idOf(r.workerIdx), r.year, r.rating, idOf(r.reviewerIdx)]),
  ),
  section('time_off_requests'),
  insertRows(
    'time_off_requests',
    ['employee_id', 'kind', 'starts_on', 'ends_on', 'days', 'status'],
    timeOff.map((t) => [idOf(t.workerIdx), t.kind, t.startsOn, t.endsOn, t.days, t.status]),
  ),
  section('analytics views'),
  VIEWS,
];

writeFileSync(OUTPUT_PATH, `${blocks.join('\n\n')}`, 'utf8');

/* -------------------------------------------------------------- stdout */

const counts: [string, number][] = [
  ['departments', DEPARTMENTS.length],
  ['locations', LOCATIONS.length],
  ['job_titles', TITLES.length],
  ['exchange_rates', CURRENCIES.length * YEARS.length],
  ['employees', ordered.length],
  ['salary_history', salaryRows.length],
  ['bonus_payments', bonuses.length],
  ['performance_reviews', reviews.length],
  ['time_off_requests', timeOff.length],
];

console.log(`hr fixture written to ${OUTPUT_PATH} (seed ${SEED})`);
for (const [table, count] of counts) {
  console.log(`  ${table.padEnd(20)} ${String(count).padStart(6)}`);
}

const money = (value: number) => round2(value).toFixed(2);
const pct = (value: number) => value.toFixed(2);
const byType = (type: WorkerType) => ordered.filter((w) => w.type === type).length;

console.log('\n  planted answers (employees only unless stated; USD at the same year\'s rate)');
console.log(`    workers                 : ${byType('employee')} employees, ${byType('contractor')} contractors, ${byType('intern')} interns`);
console.log(`    HR1 tech avg 2025       : ${money(techAvg2025)} by division, ${money(techByFamilyAvg2025)} by job family`);
console.log(`    HR1 Data family outside : ${dataOutsideTech.map((w) => `${w.fullName} (${departmentOf(w).name})`).join(', ')}`);
console.log(`    HR2 rows in 2025        : ${multiRow2025.length} employees with 2+ rows starting in 2025; tech avg ${money(techStarted2025)} (rows starting in 2025), ${money(techOverlaps2025)} (rows touching 2025)`);
console.log(`    HR3 all worker types    : tech avg 2025 ${money(techAllTypesAvg2025)}; Sales total comp 2024 ${money(salesCompAllTypes2024)} vs ${money(salesComp2024)}`);
console.log(`    HR4 tech avg unconverted: ${money(averageSalary(LAST_YEAR, both(EMPLOYEES, inTechDivision), { convert: false }))}`);
console.log(`    HR4 location avg USD    : ${locationsConverted.map((r) => `${r.city} ${money(r.avg)}`).join(', ')}`);
console.log(`    HR4 location unconverted: ${locationsUnconverted.map((r) => `${r.city} ${money(r.avg)}`).join(', ')}`);
console.log(`    HR5 headcount end 2025  : ${headcountByDept.map((r) => `${r.name} ${r.count}`).join(', ')} (total ${headcount(DATA_END, EMPLOYEES)}, all types ${headcount(DATA_END, EVERYONE)})`);
console.log(`    HR6 attrition 2025      : ${attrition2025.leavers} / ${attrition2025.startHeadcount} = ${pct((100 * attrition2025.leavers) / attrition2025.startHeadcount)}% (end headcount ${attrition2025.endHeadcount})`);
console.log(`    HR7 bonus FY2024 USD    : ${money(bonusFy2024)}; paid in 2024 ${money(bonusPaid2024)}`);
console.log(`    HR7 Sales total comp 24 : ${money(salesComp2024)} (base only ${money(averageTotalCompensation(2024, both(EMPLOYEES, salesDept), { includeBonus: false }))})`);
console.log(`    HR8 promotions 2025     : ${promotions2025.length}, avg raise ${pct(raiseVsPrevious)}% vs previous row, ${pct(raiseVsHire)}% vs hire row`);
console.log(`    HR9 reports to manager  : ${SENIOR_MANAGER}: ${seniorLine.direct} direct, ${seniorLine.total} in total, ${seniorLine.depth} levels (all types: ${reportingLine(senior.idx, DATA_END, EVERYONE).total})`);
console.log(`    HR10 Engineering top 25 : ${engineeringTop2025.join(', ')}`);
console.log(`    HR10 Technology top 25  : ${techTop2025.length} names; rated 5 in Engineering: ${engineeringFives2025.join(', ')}`);
