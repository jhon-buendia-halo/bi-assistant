/**
 * Generator for the `finance` synthetic eval fixture (BA-185).
 *
 * Writes `backend/src/modules/testing-data/fixtures/006_finance.sql`, the
 * Testing Data seed, and `backend/scripts/fixtures/finance/facts.json`, the
 * planted truths every reference query is checked against. Every random draw
 * comes from the two seeded `Rng`s below — never `Math.random()`, never
 * `Date.now()` — so the output is byte-identical on every run.
 *
 * Run with (identical to the `fixtures:finance` npm script):
 *
 *   cd backend && npx ts-node -T -P tsconfig.json ../docker/postgres/generate/finance.ts
 *
 * The domain is "Meridian Trust Bank", a fictional US retail bank that also
 * manages money for wealth clients. The retail-banking half is the branch's
 * banking generator (`feat/engine-eval-loop`, seed 20260929) kept draw for
 * draw, so its rows and its traps B1-B15 are unchanged; only the schema is
 * renamed. The wealth half (fiscal periods, securities, portfolios, holdings,
 * fees) draws from its own seed and plants the traps W1-W12 of
 * `docs/evals/domains/finance.md`. The traps that must hold exactly are
 * enforced by deterministic adjustment and then asserted: this script throws
 * rather than emit a fixture with a broken trap.
 */

import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { Rng, literal, insertRows, section } from './lib/rng';

/* ------------------------------------------------------------------ knobs */

/** The one knob. Change it and every hand-verified answer must be re-checked. */
const SEED = 20260929;
const OUTPUT_PATH = join(
  __dirname,
  '..', '..', '..',
  'backend', 'src', 'modules', 'testing-data', 'fixtures',
  '006_finance.sql',
);
const FACTS_PATH = join(
  __dirname,
  '..', '..', '..',
  'backend', 'scripts', 'fixtures', 'finance', 'facts.json',
);

const WINDOW_START = '2024-01-01';
const WINDOW_END = '2025-12-31';
const PRODUCTS_FROM = '2019-01-01';
const CUSTOMERS_FROM = '2015-01-01';

const TOTAL_TRANSACTIONS = 5400;
const TRANSFER_PAIRS = 300;
const CARD_PURCHASES = 800; // on real (non-test) accounts
const TOTAL_CARDS = 150;
const EUR_ACCOUNTS = { CHK: 4, SAV: 6, MMA: 4 };
const GBP_ACCOUNTS = { CHK: 3, SAV: 4, MMA: 3 };

const TEST_ACCOUNT_COUNT = 6;
const MARCH_2025_START = '2025-03-01';
const MARCH_2025_END = '2025-03-31';
const MARCH_2025_TEST_TRANSACTIONS = 14;
const OTHER_TEST_TRANSACTIONS = 22;

const TIE_COUNT = 12;
const TIE_YEAR = '2024';
const OTHER_BRANCH_CAP = 10;
const TIED_BRANCHES = ['Chicago Loop', 'Atlanta Midtown'];

const LOAN_STATUS_TARGETS = { DELINQUENT: 8, DEFAULTED: 4, CHARGED_OFF: 3 };
const MIN_PAID_OFF = 12;
/** Mortgages repaid early (a home sale or a refinance elsewhere) inside the window. */
const MORTGAGE_EARLY_PAYOFFS = 2;

const DEC_2025_START = '2025-12-01';
const MIN_DEC_PENDING_CARD = 5;
const MIN_DEC_REVERSED_CARD = 3;

const rng = new Rng(SEED);

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(`INVARIANT FAILED: ${message}`);
}

/* ------------------------------------------------------- reference tables */

const REGIONS = [
  { code: 'NORTHEAST', name: 'Northeast' },
  { code: 'SOUTHEAST', name: 'Southeast' },
  { code: 'MIDWEST', name: 'Midwest' },
  { code: 'WEST', name: 'West' },
];

const BRANCHES = [
  { code: 'BR-BOS', name: 'Boston Back Bay', region: 'NORTHEAST', city: 'Boston', state: 'MA', openedOn: '1998-04-14', weight: 0.17 },
  { code: 'BR-HFD', name: 'Hartford Downtown', region: 'NORTHEAST', city: 'Hartford', state: 'CT', openedOn: '2003-09-02', weight: 0.1 },
  { code: 'BR-PVD', name: 'Providence College Hill', region: 'NORTHEAST', city: 'Providence', state: 'RI', openedOn: '2011-05-23', weight: 0.08 },
  { code: 'BR-ATL', name: 'Atlanta Midtown', region: 'SOUTHEAST', city: 'Atlanta', state: 'GA', openedOn: '2001-03-19', weight: 0.15 },
  { code: 'BR-CLT', name: 'Charlotte Uptown', region: 'SOUTHEAST', city: 'Charlotte', state: 'NC', openedOn: '2008-10-06', weight: 0.11 },
  { code: 'BR-CHI', name: 'Chicago Loop', region: 'MIDWEST', city: 'Chicago', state: 'IL', openedOn: '1999-11-08', weight: 0.16 },
  { code: 'BR-CMH', name: 'Columbus Short North', region: 'MIDWEST', city: 'Columbus', state: 'OH', openedOn: '2014-06-16', weight: 0.1 },
  { code: 'BR-DEN', name: 'Denver LoDo', region: 'WEST', city: 'Denver', state: 'CO', openedOn: '2016-02-29', weight: 0.13 },
];

type TypeCode = 'CHK' | 'SAV' | 'MMA' | 'CC' | 'LOC';

const ACCOUNT_TYPES: { code: TypeCode; name: string; category: 'DEPOSIT' | 'CREDIT'; rateBps: number }[] = [
  { code: 'CHK', name: 'Everyday Checking', category: 'DEPOSIT', rateBps: 0 },
  { code: 'SAV', name: 'High-Yield Savings', category: 'DEPOSIT', rateBps: 420 },
  { code: 'MMA', name: 'Money Market Account', category: 'DEPOSIT', rateBps: 385 },
  { code: 'CC', name: 'Rewards Credit Card', category: 'CREDIT', rateBps: 2299 },
  { code: 'LOC', name: 'Personal Line of Credit', category: 'CREDIT', rateBps: 1150 },
];
const TYPE_BY_CODE = new Map(ACCOUNT_TYPES.map((t, i) => [t.code, { ...t, id: i + 1 }]));
const isDepositType = (code: TypeCode) => TYPE_BY_CODE.get(code)!.category === 'DEPOSIT';

type Segment = 'RETAIL' | 'PREMIER' | 'BUSINESS';
const SEGMENTS: readonly (readonly [Segment, number])[] = [
  ['RETAIL', 0.6],
  ['PREMIER', 0.22],
  ['BUSINESS', 0.18],
];

type TxnType = 'DEPOSIT' | 'WITHDRAWAL' | 'CARD_PURCHASE' | 'TRANSFER_IN' | 'TRANSFER_OUT' | 'FEE' | 'INTEREST';
const TXN_TYPES: TxnType[] = ['DEPOSIT', 'WITHDRAWAL', 'CARD_PURCHASE', 'TRANSFER_IN', 'TRANSFER_OUT', 'FEE', 'INTEREST'];
const CREDIT_TYPES: readonly TxnType[] = ['DEPOSIT', 'TRANSFER_IN', 'INTEREST'];
const CHANNELS = ['BRANCH', 'ATM', 'ONLINE', 'MOBILE', 'CARD', 'SYSTEM'];
const TXN_STATUSES = ['POSTED', 'PENDING', 'REVERSED'];

const MERCHANT_CATEGORIES: { name: string; weight: number; min: number; max: number }[] = [
  { name: 'GROCERY', weight: 0.24, min: 1500, max: 18000 },
  { name: 'RESTAURANTS', weight: 0.18, min: 1200, max: 12000 },
  { name: 'FUEL', weight: 0.12, min: 2500, max: 9000 },
  { name: 'ONLINE_RETAIL', weight: 0.16, min: 1000, max: 25000 },
  { name: 'TRAVEL', weight: 0.06, min: 15000, max: 120000 },
  { name: 'UTILITIES', weight: 0.08, min: 4000, max: 30000 },
  { name: 'ENTERTAINMENT', weight: 0.09, min: 800, max: 9000 },
  { name: 'HEALTH', weight: 0.07, min: 1500, max: 40000 },
];

const CUSTOMER_NAMES = [
  'Adaeze Okafor', 'Bram Vandersloot', 'Celestine Moreau', 'Dariusz Wojcik',
  'Eleanor Ashcombe', 'Farid Haddad', 'Gwendolyn Pryce', 'Hideo Tanabe',
  'Isolde Brennan', 'Jasper Kowalczyk', 'Keziah Montgomery', 'Leopold Varga',
  'Mireille Dubois', 'Nikhil Deshpande', 'Oona Fitzgerald', 'Paloma Ibarra',
  'Quentin Radcliffe', 'Rosalie Achterberg', 'Soren Halvorsen', 'Tamsin Whitlock',
  'Ulrich Brandt', 'Valentina Russo', 'Winston Adebayo', 'Xiomara Castellanos',
  'Yusuf Karaman', 'Zelda Harrington', 'Ambrose Delacroix', 'Beatriz Salgado',
  'Cornelius Oyelowo', 'Dagny Solberg', 'Evander Blackwood', 'Fiorella Conti',
  'Gideon Marsh', 'Henrietta Vos', 'Ignatius Mbeki', 'Juniper Calloway',
  'Kasimir Novak', 'Lucinda Ferreira', 'Magnus Thorvaldsen', 'Noemi Albrecht',
  'Octavia Pembroke', 'Pradeep Venkataraman', 'Rhiannon Ellwood', 'Sebastian Oduro',
  'Thea Lindgren', 'Umberto Galli', 'Verity Hollingsworth', 'Wolfgang Richter',
  'Yara Nasser', 'Zachary Pendleton', 'Anouk Verbeek', 'Barnaby Cole',
  'Cassia Montrose', 'Dmitri Volkonsky', 'Esme Carrington', 'Florian Weiss',
  'Georgina Mbatha', 'Horatio Finch', 'Ilse Bergmann', 'Joaquin Ortega',
  'Katarina Horvat', 'Lysander Graves', 'Marisa Quintero', 'Nathaniel Osei',
  'Ottilie Sandberg', 'Percy Llewellyn', 'Rafaela Mendes', 'Silas Thornbury',
  'Talulah Greer', 'Ulysses Marangoni', 'Vivienne Saint-Clair', 'Warrick Dunleavy',
  'Ximena Arriaga', 'Yannick Fournier', 'Zora Petrovic', 'Alistair Buchanan',
  'Bettany Rourke', 'Cyrus Farahani', 'Delia Montague', 'Emrys Vaughan',
  'Felicity Wainwright', 'Gaspard Leclerc', 'Hollis Abernathy', 'Imara Kiplagat',
  'Jovan Stojanovic', 'Kerensa Trelawney', 'Lorcan Doherty', 'Minerva Castile',
  'Oswin Harcourt', 'Philippa Egerton',
];

/* --------------------------------------------------------------- helpers */

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function pad(value: number, width: number): string {
  return String(value).padStart(width, '0');
}

function minDate(a: string, b: string): string {
  return a < b ? a : b;
}

function maxDate(a: string, b: string): string {
  return a > b ? a : b;
}

function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

function lastDayOfMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** `date` moved by `months` whole months, on `day` (clamped to the month's length). */
function addMonths(date: string, months: number, day: number): string {
  const year = Number(date.slice(0, 4));
  const month = Number(date.slice(5, 7)) - 1 + months;
  const y = year + Math.floor(month / 12);
  const m = (((month % 12) + 12) % 12) + 1;
  return `${y}-${pad(m, 2)}-${pad(Math.min(day, lastDayOfMonth(y, m)), 2)}`;
}

function monthEnd(date: string): string {
  const y = Number(date.slice(0, 4));
  const m = Number(date.slice(5, 7));
  return `${y}-${pad(m, 2)}-${pad(lastDayOfMonth(y, m), 2)}`;
}

/** Every month (`YYYY-MM`) from `from` to `to`, inclusive. */
function monthsBetween(from: string, to: string): string[] {
  const out: string[] = [];
  let cursor = `${from}-01`;
  while (cursor.slice(0, 7) <= to) {
    out.push(cursor.slice(0, 7));
    cursor = addMonths(cursor, 1, 1);
  }
  return out;
}

function dateInYears(weights: readonly (readonly [number, number])[], min: string, max: string): string {
  const year = rng.weighted(weights);
  return rng.dateBetween(maxDate(`${year}-01-01`, min), minDate(`${year}-12-31`, max));
}

function roundTo(value: number, step: number): number {
  return Math.max(step, Math.round(value / step) * step);
}

const WINDOW_MONTHS = monthsBetween('2024-01', '2025-12');
const DEC_2025_RATE_MONTH = '2025-12';

/* --------------------------------------------------------------- fx rates */

interface FxRow {
  currency: 'EUR' | 'GBP';
  rateMonth: string;
  /** usd_per_unit × 1,000,000 — kept as an integer so the conversion is exact. */
  micro: number;
}

const FX_BANDS = {
  EUR: { start: 1_086_000, step: 9_000, min: 1_052_000, max: 1_118_000 },
  GBP: { start: 1_268_000, step: 11_000, min: 1_222_000, max: 1_318_000 },
};

const fxRates: FxRow[] = [];
const fxMicro = new Map<string, number>();
for (const currency of ['EUR', 'GBP'] as const) {
  const band = FX_BANDS[currency];
  let micro = band.start;
  for (const month of WINDOW_MONTHS) {
    micro = clamp(micro + rng.int(-band.step, band.step), band.min, band.max);
    fxRates.push({ currency, rateMonth: `${month}-01`, micro });
    fxMicro.set(`${currency}|${month}`, micro);
  }
}

/**
 * The booking month's rate, applied in integer arithmetic and rounded half up
 * — exactly what Postgres `round(amount_minor * usd_per_unit)` does on these
 * positive numerics, so the stored column can be recomputed from the table.
 */
function toUsdMinor(amount: number, currency: string, date: string): number {
  if (currency === 'USD') return amount;
  const micro = fxMicro.get(`${currency}|${date.slice(0, 7)}`);
  assert(micro !== undefined, `no ${currency} rate for ${date}`);
  return Math.floor((amount * micro + 500_000) / 1_000_000);
}

function balanceToUsd(amount: number, currency: string): number {
  if (currency === 'USD') return amount;
  return (amount * fxMicro.get(`${currency}|${DEC_2025_RATE_MONTH}`)!) / 1_000_000;
}

/* -------------------------------------------------------------- customers */

interface CustomerRow {
  idx: number;
  customerNumber: string;
  fullName: string;
  dateOfBirth: string;
  segment: Segment;
  homeBranchIdx: number;
  joinedOn: string;
  activity: number;
}

const branchWeights = BRANCHES.map((b, i) => [i, b.weight] as const);

const customers: CustomerRow[] = CUSTOMER_NAMES.map((fullName, idx) => ({
  idx,
  customerNumber: `C-${pad(300000 + idx * 17 + 5, 6)}`,
  fullName,
  dateOfBirth: `${rng.int(1946, 1997)}-${pad(rng.int(1, 12), 2)}-${pad(rng.int(1, 28), 2)}`,
  segment: rng.weighted(SEGMENTS),
  homeBranchIdx: rng.weighted(branchWeights),
  joinedOn: '',
  activity: rng.float(0.5, 1.8, 4),
}));

assert(new Set(customers.map((c) => c.fullName)).size === customers.length, 'customer names must be unique');
assert(customers.length === 90, 'expected 90 customers');

/* --------------------------------------------------------------- accounts */

interface AccountRow {
  idx: number;
  accountNumber: string;
  customerIdx: number;
  typeCode: TypeCode;
  branchIdx: number;
  currency: 'USD' | 'EUR' | 'GBP';
  openedOn: string;
  closedOn: string | null;
  status: 'ACTIVE' | 'DORMANT' | 'FROZEN' | 'CLOSED';
  balance: number;
  /** A typical balance, used for interest while the account was open. */
  notional: number;
  isTest: boolean;
  primary: boolean;
  activity: number;
}

const OPEN_YEAR_WEIGHTS: readonly (readonly [number, number])[] = [
  [2019, 0.06],
  [2020, 0.06],
  [2021, 0.08],
  [2022, 0.1],
  [2023, 0.14],
  [2024, 0.3],
  [2025, 0.26],
];

// Every customer holds one primary deposit account; the other 110 accounts
// follow segment preferences.
const PRIMARY_TYPES: TypeCode[] = [...Array(72).fill('CHK'), ...Array(18).fill('SAV')];
const SECONDARY_TYPES: TypeCode[] = [
  ...Array(6).fill('CHK'),
  ...Array(26).fill('SAV'),
  ...Array(22).fill('MMA'),
  ...Array(40).fill('CC'),
  ...Array(16).fill('LOC'),
];
const SEGMENT_AFFINITY: Record<TypeCode, Record<Segment, number>> = {
  CHK: { RETAIL: 0.6, PREMIER: 0.8, BUSINESS: 1.6 },
  SAV: { RETAIL: 1.0, PREMIER: 1.6, BUSINESS: 1.0 },
  MMA: { RETAIL: 0.4, PREMIER: 2.5, BUSINESS: 1.2 },
  CC: { RETAIL: 1.2, PREMIER: 1.3, BUSINESS: 0.8 },
  LOC: { RETAIL: 0.5, PREMIER: 0.8, BUSINESS: 2.2 },
};

const accounts: AccountRow[] = [];

function newAccount(customerIdx: number, typeCode: TypeCode, primary: boolean): AccountRow {
  const customer = customers[customerIdx];
  const openedOn = dateInYears(OPEN_YEAR_WEIGHTS, PRODUCTS_FROM, WINDOW_END);
  const branchIdx = rng.chance(0.82)
    ? customer.homeBranchIdx
    : rng.pick(BRANCHES.map((_, i) => i).filter((i) => i !== customer.homeBranchIdx));
  return {
    idx: accounts.length,
    accountNumber: '',
    customerIdx,
    typeCode,
    branchIdx,
    currency: 'USD',
    openedOn,
    closedOn: null,
    status: 'ACTIVE',
    balance: 0,
    notional: 0,
    isTest: false,
    primary,
    activity: rng.float(0.5, 1.6, 4),
  };
}

const primaryOrder = rng.shuffle(customers.map((c) => c.idx));
primaryOrder.forEach((customerIdx, i) => {
  accounts.push(newAccount(customerIdx, PRIMARY_TYPES[i], true));
});
for (const typeCode of rng.shuffle(SECONDARY_TYPES)) {
  let customerIdx = 0;
  for (let attempt = 0; attempt < 25; attempt++) {
    customerIdx = rng.weighted(
      customers.map((c) => [c.idx, SEGMENT_AFFINITY[typeCode][c.segment] * c.activity] as const),
    );
    // One credit card and one line of credit per customer at most.
    const duplicate =
      (typeCode === 'CC' || typeCode === 'LOC') &&
      accounts.some((a) => a.customerIdx === customerIdx && a.typeCode === typeCode);
    if (!duplicate) break;
  }
  accounts.push(newAccount(customerIdx, typeCode, false));
}
assert(accounts.length === 200, `expected 200 accounts, got ${accounts.length}`);

// Currencies: a few EUR and GBP deposit accounts, mostly held by premier customers.
{
  const currencyWeight = (a: AccountRow) =>
    ({ RETAIL: 0.5, PREMIER: 3, BUSINESS: 1.5 })[customers[a.customerIdx].segment];
  for (const [currency, plan] of [['EUR', EUR_ACCOUNTS], ['GBP', GBP_ACCOUNTS]] as const) {
    for (const typeCode of ['CHK', 'SAV', 'MMA'] as const) {
      for (let k = 0; k < plan[typeCode]; k++) {
        const pool = accounts.filter((a) => a.typeCode === typeCode && a.currency === 'USD');
        const chosen = rng.weighted(pool.map((a) => [a.idx, currencyWeight(a)] as const));
        accounts[chosen].currency = currency;
      }
    }
  }
}

// Status as of 2025-12-31. Primary accounts are never closed.
for (const account of accounts) {
  const roll = rng.next();
  if (roll < 0.09) {
    if (!account.primary && account.openedOn <= '2025-09-30') {
      account.status = 'CLOSED';
      account.closedOn = rng.dateBetween(addDays(account.openedOn, 60), '2025-12-20');
    }
  } else if (roll < 0.16) {
    if (account.openedOn <= '2024-06-30') account.status = 'DORMANT';
  } else if (roll < 0.18) {
    account.status = 'FROZEN';
  }
}

/* --------------------------------- B4: exactly two branches on 12 accounts */

const tiedBranchIdx = TIED_BRANCHES.map((name) => BRANCHES.findIndex((b) => b.name === name));
assert(tiedBranchIdx.every((i) => i >= 0), 'tied branches must exist');
const otherBranchIdx = BRANCHES.map((_, i) => i).filter((i) => !tiedBranchIdx.includes(i));

function openedInTieYear(branchIdx: number, includeTest = true): AccountRow[] {
  return accounts.filter(
    (a) => a.branchIdx === branchIdx && a.openedOn.startsWith(TIE_YEAR) && (includeTest || !a.isTest),
  );
}
const tieYearCount = (branchIdx: number, includeTest = true) => openedInTieYear(branchIdx, includeTest).length;
const quietestOther = () =>
  [...otherBranchIdx].sort((x, y) => tieYearCount(x) - tieYearCount(y) || x - y)[0];
const busiestOther = () =>
  [...otherBranchIdx].sort((x, y) => tieYearCount(y) - tieYearCount(x) || x - y)[0];

for (const tied of tiedBranchIdx) {
  while (tieYearCount(tied) > TIE_COUNT) {
    const list = openedInTieYear(tied);
    list[list.length - 1].branchIdx = quietestOther();
  }
  while (tieYearCount(tied) < TIE_COUNT) {
    const list = openedInTieYear(busiestOther());
    assert(list.length > 0, 'B4: no 2024 account left to move onto a tied branch');
    list[list.length - 1].branchIdx = tied;
  }
}
for (const other of otherBranchIdx) {
  while (tieYearCount(other) > OTHER_BRANCH_CAP) {
    const list = openedInTieYear(other);
    list[list.length - 1].branchIdx = quietestOther();
  }
}

/* ------------------------- B13: every branch keeps a credit account on file */

for (let branchIdx = 0; branchIdx < BRANCHES.length; branchIdx++) {
  const hasCredit = accounts.some((a) => a.branchIdx === branchIdx && !isDepositType(a.typeCode));
  if (hasCredit) continue;
  // Move a credit account opened outside the tie year, so B4 is untouched.
  const donor = accounts.find(
    (a) =>
      !isDepositType(a.typeCode) &&
      !a.openedOn.startsWith(TIE_YEAR) &&
      accounts.filter((o) => o.branchIdx === a.branchIdx && !isDepositType(o.typeCode)).length > 1,
  );
  assert(donor !== undefined, `B13: no credit account available for ${BRANCHES[branchIdx].name}`);
  donor.branchIdx = branchIdx;
}

/* ----------------------------------------- B10: the sandbox (test) accounts */

// Chosen before anything that plants a winner, so no winner can own one. Never
// at a tied branch, never a customer's only account, always open in March 2025.
const testAccountIdx: number[] = [];
{
  const candidates = rng.shuffle(
    accounts.filter(
      (a) =>
        !a.primary &&
        a.currency === 'USD' &&
        isDepositType(a.typeCode) &&
        !tiedBranchIdx.includes(a.branchIdx) &&
        a.openedOn <= '2025-02-28',
    ),
  );
  const in2024 = candidates.find((a) => a.openedOn.startsWith('2024'));
  assert(in2024 !== undefined, 'B10: need a test-account candidate opened in 2024');
  testAccountIdx.push(in2024.idx);
  for (const a of candidates.filter((c) => c.typeCode === 'CHK')) {
    if (testAccountIdx.length >= 3) break;
    if (!testAccountIdx.includes(a.idx)) testAccountIdx.push(a.idx);
  }
  for (const a of candidates) {
    if (testAccountIdx.length >= TEST_ACCOUNT_COUNT) break;
    if (!testAccountIdx.includes(a.idx)) testAccountIdx.push(a.idx);
  }
  assert(testAccountIdx.length === TEST_ACCOUNT_COUNT, `B10: expected ${TEST_ACCOUNT_COUNT} test accounts`);
  for (const idx of testAccountIdx) {
    const a = accounts[idx];
    a.isTest = true;
    a.status = 'ACTIVE';
    a.closedOn = null;
  }
}
const testOwners = new Set(testAccountIdx.map((idx) => accounts[idx].customerIdx));

/* ----------------------------------------------------------- balances */

function typicalBalance(a: AccountRow): number {
  const segment = customers[a.customerIdx].segment;
  switch (a.typeCode) {
    case 'CHK':
      return segment === 'PREMIER'
        ? rng.int(200_000, 3_500_000)
        : segment === 'BUSINESS'
          ? rng.int(300_000, 6_000_000)
          : rng.int(30_000, 900_000);
    case 'SAV':
      return rng.int(50_000, 4_000_000) * (segment === 'PREMIER' ? 3 : 1);
    case 'MMA':
      return Math.round(rng.int(1_000_000, 18_000_000) * (segment === 'PREMIER' ? 1.5 : 1));
    case 'CC':
      return rng.int(0, 650_000);
    case 'LOC':
      return rng.int(0, 2_000_000);
  }
}

for (const a of accounts) {
  a.notional = typicalBalance(a);
  if (a.isTest) {
    a.balance = rng.pick([0, 100, 1000, 12345, 50000]);
  } else if (a.status === 'CLOSED') {
    a.balance = 0;
  } else if (a.status === 'DORMANT') {
    a.balance = Math.round(a.notional * 0.3);
  } else {
    a.balance = a.notional;
  }
}

/* ------------------------------------------------------------------ cards */

interface CardRow {
  accountIdx: number;
  network: 'VISA' | 'MASTERCARD';
  cardType: 'DEBIT' | 'CREDIT';
  issuedOn: string;
  expiresOn: string;
  status: 'ACTIVE' | 'BLOCKED' | 'EXPIRED' | 'CANCELLED';
  masked: string;
}

const cards: CardRow[] = [];
const CARD_LIFE_MONTHS = 48;

function cardExpiry(issuedOn: string): string {
  return monthEnd(addMonths(issuedOn, CARD_LIFE_MONTHS, 1));
}

function cardStatus(a: AccountRow, expiresOn: string, issuedOn: string): CardRow['status'] {
  if (a.closedOn !== null && expiresOn >= a.closedOn && issuedOn <= a.closedOn) return 'CANCELLED';
  if (expiresOn < WINDOW_END) return 'EXPIRED';
  return rng.chance(0.05) ? 'BLOCKED' : 'ACTIVE';
}

for (const a of accounts) {
  if (a.typeCode !== 'CHK' && a.typeCode !== 'CC') continue;
  const network = rng.chance(0.62) ? 'VISA' : 'MASTERCARD';
  const cardType = a.typeCode === 'CHK' ? 'DEBIT' : 'CREDIT';
  let issuedOn = minDate(addDays(a.openedOn, rng.int(0, 10)), WINDOW_END);
  for (;;) {
    const expiresOn = cardExpiry(issuedOn);
    cards.push({ accountIdx: a.idx, network, cardType, issuedOn, expiresOn, status: cardStatus(a, expiresOn, issuedOn), masked: '' });
    const accountEnd = a.closedOn ?? WINDOW_END;
    if (expiresOn >= accountEnd) break;
    issuedOn = addDays(expiresOn, -rng.int(10, 25));
  }
}
{
  // Supplementary cards (a second card holder) top the population up to the plan.
  const natural = cards.length;
  assert(natural <= TOTAL_CARDS, `cards: ${natural} natural cards already exceed ${TOTAL_CARDS}`);
  const eligible = rng.shuffle(
    accounts.filter((a) => (a.typeCode === 'CHK' || a.typeCode === 'CC') && a.status !== 'CLOSED' && !a.isTest),
  );
  for (const a of eligible) {
    if (cards.length >= TOTAL_CARDS) break;
    const first = cards.find((c) => c.accountIdx === a.idx)!;
    const from = maxDate(addDays(a.openedOn, 30), '2022-01-01');
    if (from > '2025-10-31') continue;
    const issuedOn = rng.dateBetween(from, '2025-10-31');
    const expiresOn = cardExpiry(issuedOn);
    cards.push({
      accountIdx: a.idx,
      network: first.network,
      cardType: first.cardType,
      issuedOn,
      expiresOn,
      status: cardStatus(a, expiresOn, issuedOn),
      masked: '',
    });
  }
  assert(cards.length === TOTAL_CARDS, `cards: expected ${TOTAL_CARDS}, got ${cards.length}`);
}
{
  const last4 = rng.shuffle(Array.from({ length: 9000 }, (_, i) => 1000 + i));
  const BINS = { VISA: ['4539', '4716', '4929'], MASTERCARD: ['5412', '5287', '5199'] };
  cards.forEach((card, i) => {
    card.masked = `${rng.pick(BINS[card.network])} **** **** ${last4[i]}`;
  });
  assert(new Set(cards.map((c) => c.masked)).size === cards.length, 'masked card numbers must be unique');
}

function cardsOf(accountIdx: number): CardRow[] {
  return cards.filter((c) => c.accountIdx === accountIdx);
}

function validCardOn(accountIdx: number, date: string): number | null {
  const valid = cards
    .map((c, i) => ({ c, i }))
    .filter(({ c }) => c.accountIdx === accountIdx && c.issuedOn <= date && date <= c.expiresOn);
  if (valid.length === 0) return null;
  return valid[rng.int(0, valid.length - 1)].i;
}

/* ------------------------------------------------------------------ loans */

type Product = 'MORTGAGE' | 'AUTO' | 'PERSONAL';
type LoanStatus = 'CURRENT' | 'DELINQUENT' | 'DEFAULTED' | 'PAID_OFF' | 'CHARGED_OFF';

interface LoanRow {
  idx: number;
  customerIdx: number;
  branchIdx: number;
  product: Product;
  principal: number;
  rateBps: number;
  termMonths: number;
  originatedOn: string;
  status: LoanStatus;
  outstanding: number;
  /** Last scheduled payment made (DELINQUENT/DEFAULTED/CHARGED_OFF). */
  stopAfter: string | null;
  /** Early payoff date (PAID_OFF before term). */
  payoffOn: string | null;
}

const LOAN_PLAN: { product: Product; count: number; years: readonly (readonly [number, number])[] }[] = [
  {
    product: 'MORTGAGE',
    count: 24,
    years: [[2019, 0.14], [2020, 0.15], [2021, 0.17], [2022, 0.14], [2023, 0.13], [2024, 0.14], [2025, 0.13]],
  },
  {
    product: 'AUTO',
    count: 46,
    years: [[2019, 0.2], [2020, 0.18], [2021, 0.17], [2022, 0.14], [2023, 0.12], [2024, 0.1], [2025, 0.09]],
  },
  {
    product: 'PERSONAL',
    count: 40,
    years: [[2019, 0.12], [2020, 0.14], [2021, 0.16], [2022, 0.16], [2023, 0.15], [2024, 0.14], [2025, 0.13]],
  },
];
const LOAN_AFFINITY: Record<Product, Record<Segment, number>> = {
  MORTGAGE: { RETAIL: 1.0, PREMIER: 2.2, BUSINESS: 0.6 },
  AUTO: { RETAIL: 1.2, PREMIER: 1.0, BUSINESS: 1.0 },
  PERSONAL: { RETAIL: 1.3, PREMIER: 0.4, BUSINESS: 1.4 },
};

function loanTerms(product: Product, originatedOn: string): { principal: number; rateBps: number; termMonths: number } {
  const year = Number(originatedOn.slice(0, 4));
  switch (product) {
    case 'MORTGAGE':
      return {
        principal: roundTo(rng.int(15_000_000, 60_000_000), 100_000),
        rateBps: year <= 2021 ? rng.int(275, 425) : year === 2022 ? rng.int(450, 625) : rng.int(600, 725),
        termMonths: rng.chance(0.55) ? 360 : 180,
      };
    case 'AUTO':
      return {
        principal: roundTo(rng.int(1_500_000, 6_500_000), 10_000),
        rateBps: rng.int(650, 1150),
        termMonths: rng.pick([36, 48, 60, 72]),
      };
    case 'PERSONAL':
      return {
        principal: roundTo(rng.int(300_000, 3_500_000), 10_000),
        rateBps: rng.int(1100, 2200),
        termMonths: rng.pick([24, 36, 48, 60]),
      };
  }
}

const loans: LoanRow[] = [];
for (const plan of LOAN_PLAN) {
  for (let k = 0; k < plan.count; k++) {
    const customerIdx = rng.weighted(
      customers.map((c) => [c.idx, LOAN_AFFINITY[plan.product][c.segment]] as const),
    );
    const originatedOn = dateInYears(plan.years, PRODUCTS_FROM, '2025-11-30');
    const terms = loanTerms(plan.product, originatedOn);
    loans.push({
      idx: loans.length,
      customerIdx,
      branchIdx: rng.chance(0.85) ? customers[customerIdx].homeBranchIdx : rng.int(0, BRANCHES.length - 1),
      product: plan.product,
      ...terms,
      originatedOn,
      status: 'CURRENT',
      outstanding: 0,
      stopAfter: null,
      payoffOn: null,
    });
  }
}

/* ------------- B2: loans are USD even for customers holding EUR/GBP accounts */

const holdsForeign = (customerIdx: number, currency: 'EUR' | 'GBP') =>
  accounts.some((a) => a.customerIdx === customerIdx && a.currency === currency && !a.isTest);
for (const currency of ['EUR', 'GBP'] as const) {
  let loanHolders = new Set(loans.filter((l) => holdsForeign(l.customerIdx, currency)).map((l) => l.customerIdx));
  const foreignCustomers = customers.filter((c) => holdsForeign(c.idx, currency) && !loanHolders.has(c.idx));
  for (const c of foreignCustomers) {
    if (loanHolders.size >= 2) break;
    const loan = loans.find((l) => l.product !== 'MORTGAGE' && loans.filter((o) => o.customerIdx === l.customerIdx).length > 1);
    assert(loan !== undefined, 'B2: no loan to reassign');
    loan.customerIdx = c.idx;
    loanHolders = new Set(loans.filter((l) => holdsForeign(l.customerIdx, currency)).map((l) => l.customerIdx));
  }
}

/* -------------------- B7 (loan principal): one customer clearly borrowed most */

function principalTotals(): number[] {
  const totals = customers.map(() => 0);
  for (const loan of loans) totals[loan.customerIdx] += loan.principal;
  return totals;
}

function argmaxExcept(values: number[], exclude: Set<number>): number {
  let best = -1;
  for (let i = 0; i < values.length; i++) {
    if (exclude.has(i)) continue;
    if (best < 0 || values[i] > values[best]) best = i;
  }
  return best;
}

const principalWinner = (() => {
  const totals = principalTotals();
  const eligible = new Set(customers.map((c) => c.idx).filter((i) => testOwners.has(i) || !loans.some((l) => l.customerIdx === i && l.product === 'MORTGAGE')));
  const winner = argmaxExcept(totals, eligible);
  const others = totals.filter((_, i) => i !== winner);
  const target = Math.ceil(Math.max(...others) * 1.15);
  const delta = target - totals[winner];
  if (delta > 0) {
    const mortgage = loans
      .filter((l) => l.customerIdx === winner && l.product === 'MORTGAGE')
      .sort((a, b) => b.principal - a.principal || a.idx - b.idx)[0];
    mortgage.principal = Math.ceil((mortgage.principal + delta) / 100_000) * 100_000;
    assert(mortgage.principal <= 95_000_000, `B7: boosted mortgage principal ${mortgage.principal} is implausible`);
  }
  return winner;
})();

/* ------------------ B7 (deposit balances): a different customer holds the most */

function depositTotals(includeTest: boolean): number[] {
  const totals = customers.map(() => 0);
  for (const a of accounts) {
    if (!isDepositType(a.typeCode) || (!includeTest && a.isTest)) continue;
    totals[a.customerIdx] += balanceToUsd(a.balance, a.currency);
  }
  return totals;
}

const depositWinner = (() => {
  const totals = depositTotals(false);
  const winner = argmaxExcept(totals, new Set([principalWinner, ...testOwners]));
  const withTest = depositTotals(true);
  const others = withTest.filter((_, i) => i !== winner);
  const targetUsd = Math.max(...others) * 1.15;
  const deltaUsd = targetUsd - totals[winner];
  if (deltaUsd > 0) {
    const account = accounts
      .filter((a) => a.customerIdx === winner && isDepositType(a.typeCode) && a.status !== 'CLOSED' && a.currency === 'USD')
      .sort((a, b) => b.balance - a.balance || a.idx - b.idx)[0];
    assert(account !== undefined, 'B7: deposit winner needs an open USD deposit account');
    account.balance = Math.ceil((account.balance + deltaUsd) / 100) * 100;
    account.notional = Math.max(account.notional, account.balance);
  }
  return winner;
})();

/* ------------------------------------------------ loan amortization + status */

interface PaymentRow {
  loanIdx: number;
  paidOn: string;
  amount: number;
  principal: number;
  interest: number;
}

function monthlyPayment(loan: LoanRow): number {
  const r = loan.rateBps / 120_000;
  return Math.round((loan.principal * r) / (1 - Math.pow(1 + r, -loan.termMonths)));
}

/** Walk the schedule to 2025-12-31 under the loan's status plan. */
function amortize(loan: LoanRow): { payments: PaymentRow[]; balance: number; paidOffOn: string | null } {
  const payment = monthlyPayment(loan);
  const day = Math.min(Number(loan.originatedOn.slice(8, 10)), 28);
  let balance = loan.principal;
  const payments: PaymentRow[] = [];
  let paidOffOn: string | null = null;
  for (let k = 1; k <= loan.termMonths && balance > 0; k++) {
    const due = addMonths(loan.originatedOn, k, day);
    if (due > WINDOW_END) break;
    if (loan.stopAfter !== null && due > loan.stopAfter) break;
    const interest = Math.round((balance * loan.rateBps) / 120_000);
    let principal = Math.min(balance, payment - interest);
    const payoff = loan.payoffOn !== null && due >= loan.payoffOn;
    if (k === loan.termMonths || payoff) principal = balance;
    assert(principal >= 0, `loan ${loan.idx}: negative principal`);
    balance -= principal;
    if (due >= WINDOW_START) {
      payments.push({ loanIdx: loan.idx, paidOn: due, amount: principal + interest, principal, interest });
    }
    if (balance === 0) paidOffOn = due;
    if (payoff) break;
  }
  return { payments, balance, paidOffOn };
}

// Natural payoffs first; then plant the distressed statuses and early payoffs.
for (const loan of loans) {
  if (amortize(loan).paidOffOn !== null) loan.status = 'PAID_OFF';
}
{
  const active = () => loans.filter((l) => l.status === 'CURRENT');
  const planted = (status: LoanStatus, pool: LoanRow[], count: number, plan: (l: LoanRow) => void) => {
    const chosen = rng.shuffle(pool).slice(0, count);
    assert(chosen.length === count, `loans: not enough candidates for ${count} ${status}`);
    for (const loan of chosen) {
      loan.status = status;
      plan(loan);
    }
  };
  planted(
    'CHARGED_OFF',
    active().filter((l) => l.product !== 'MORTGAGE' && l.originatedOn <= '2023-06-30'),
    LOAN_STATUS_TARGETS.CHARGED_OFF,
    (l) => (l.stopAfter = rng.dateBetween('2024-01-01', '2024-08-31')),
  );
  planted(
    'DEFAULTED',
    active().filter((l) => l.product !== 'MORTGAGE' && l.originatedOn <= '2024-03-31' && l.customerIdx !== principalWinner),
    LOAN_STATUS_TARGETS.DEFAULTED,
    (l) => (l.stopAfter = rng.dateBetween('2024-10-01', '2025-05-31')),
  );
  planted(
    'DELINQUENT',
    active().filter((l) => l.originatedOn <= '2025-06-30' && l.customerIdx !== principalWinner),
    LOAN_STATUS_TARGETS.DELINQUENT,
    (l) => (l.stopAfter = rng.dateBetween('2025-09-01', '2025-11-15')),
  );
  const earlyPayoff = (l: LoanRow) =>
    (l.payoffOn = rng.dateBetween(maxDate(addDays(l.originatedOn, 400), '2024-03-01'), '2025-11-30'));
  planted(
    'PAID_OFF',
    active().filter((l) => l.product === 'MORTGAGE' && l.originatedOn <= '2023-06-30' && l.customerIdx !== principalWinner),
    MORTGAGE_EARLY_PAYOFFS,
    earlyPayoff,
  );
  const paidOff = loans.filter((l) => l.status === 'PAID_OFF').length;
  if (paidOff < MIN_PAID_OFF) {
    planted(
      'PAID_OFF',
      active().filter((l) => l.product !== 'MORTGAGE' && l.originatedOn <= '2024-06-30'),
      MIN_PAID_OFF - paidOff,
      earlyPayoff,
    );
  }
}

const payments: PaymentRow[] = [];
for (const loan of loans) {
  const result = amortize(loan);
  payments.push(...result.payments);
  loan.outstanding = loan.status === 'CHARGED_OFF' || loan.status === 'PAID_OFF' ? 0 : result.balance;
  if (loan.status === 'PAID_OFF') {
    assert(result.balance === 0, `loan ${loan.idx}: PAID_OFF must amortize to zero`);
  }
}

/* ---------------------------------------------- customers join before products */

for (const customer of customers) {
  const firstProduct = [
    ...accounts.filter((a) => a.customerIdx === customer.idx).map((a) => a.openedOn),
    ...loans.filter((l) => l.customerIdx === customer.idx).map((l) => l.originatedOn),
  ].sort()[0];
  assert(firstProduct !== undefined, `${customer.fullName} holds no product`);
  // Half joined within a month of their first product; the rest were customers
  // for up to four years before it (one draw either way, so nothing downstream moves).
  const draw = rng.int(0, 1500);
  const offset = draw < 750 ? Math.floor(draw / 25) : draw;
  customer.joinedOn = maxDate(addDays(firstProduct, -offset), CUSTOMERS_FROM);
}

/* ------------------------------------------------------------ transactions */

interface TxnRow {
  seq: number;
  accountIdx: number;
  cardIdx: number | null;
  bookedOn: string;
  type: TxnType;
  channel: string;
  status: 'POSTED' | 'PENDING' | 'REVERSED';
  amount: number;
  merchantCategory: string | null;
  counterpartyIdx: number | null;
  pairId: number | null;
}

const txns: TxnRow[] = [];
let seq = 0;

/** Customer-initiated activity window inside 2024-2025, or null. */
function activityWindow(a: AccountRow): [string, string] | null {
  const start = maxDate(a.openedOn, WINDOW_START);
  let end = minDate(a.closedOn ?? WINDOW_END, WINDOW_END);
  if (a.status === 'DORMANT') end = minDate(end, '2024-12-31');
  if (a.status === 'FROZEN') end = minDate(end, '2025-10-31');
  return start <= end ? [start, end] : null;
}

function drawStatus(type: TxnType, date: string): TxnRow['status'] {
  if (type === 'INTEREST') return 'POSTED';
  if (type === 'FEE') return rng.chance(0.05) ? 'REVERSED' : 'POSTED';
  // Recent activity is still settling at the snapshot date.
  const pending = date >= '2025-12-20' ? 0.3 : 0.035;
  return rng.weighted([['POSTED', 1 - pending - 0.042], ['PENDING', pending], ['REVERSED', 0.042]] as const);
}

function push(row: Omit<TxnRow, 'seq'>): TxnRow {
  const full = { ...row, seq: seq++ };
  txns.push(full);
  return full;
}

const realAccounts = accounts.filter((a) => !a.isTest);

// INTEREST: posted at every month-end a savings or money-market account is open.
for (const a of realAccounts) {
  if (a.typeCode !== 'SAV' && a.typeCode !== 'MMA') continue;
  const rateBps = TYPE_BY_CODE.get(a.typeCode)!.rateBps;
  for (const month of WINDOW_MONTHS) {
    const date = monthEnd(`${month}-01`);
    if (date < a.openedOn || (a.closedOn !== null && date > a.closedOn)) continue;
    push({
      accountIdx: a.idx,
      cardIdx: null,
      bookedOn: date,
      type: 'INTEREST',
      channel: 'SYSTEM',
      status: 'POSTED',
      amount: Math.max(1, Math.round(((a.notional * rateBps) / 120_000) * rng.float(0.85, 1.15, 4))),
      merchantCategory: null,
      counterpartyIdx: null,
      pairId: null,
    });
  }
}

// TRANSFERS: internal, USD accounts only, two legs per transfer.
{
  interface TransferCandidate {
    from: number;
    to: number;
    kind: 'to-savings' | 'from-savings' | 'card-payment' | 'loc-draw' | 'loc-repay' | 'p2p';
    weight: number;
    start: string;
    end: string;
  }
  const usd = realAccounts.filter((a) => a.currency === 'USD');
  const candidates: TransferCandidate[] = [];
  const addCandidate = (from: AccountRow, to: AccountRow, kind: TransferCandidate['kind'], weight: number) => {
    const wf = activityWindow(from);
    const wt = activityWindow(to);
    if (!wf || !wt) return;
    const start = maxDate(wf[0], wt[0]);
    const end = minDate(wf[1], wt[1]);
    if (start > end) return;
    candidates.push({ from: from.idx, to: to.idx, kind, weight: weight * (daysBetween(start, end) + 1), start, end });
  };
  for (const from of usd) {
    for (const to of usd) {
      if (from.idx === to.idx) continue;
      const same = from.customerIdx === to.customerIdx;
      if (same && from.typeCode === 'CHK' && (to.typeCode === 'SAV' || to.typeCode === 'MMA')) addCandidate(from, to, 'to-savings', 3);
      if (same && (from.typeCode === 'SAV' || from.typeCode === 'MMA') && to.typeCode === 'CHK') addCandidate(from, to, 'from-savings', 1.6);
      if (same && from.typeCode === 'CHK' && to.typeCode === 'CC') addCandidate(from, to, 'card-payment', 3);
      if (same && from.typeCode === 'LOC' && to.typeCode === 'CHK') addCandidate(from, to, 'loc-draw', 1.2);
      if (same && from.typeCode === 'CHK' && to.typeCode === 'LOC') addCandidate(from, to, 'loc-repay', 1.5);
      if (!same && from.typeCode === 'CHK' && to.typeCode === 'CHK') addCandidate(from, to, 'p2p', 0.02);
    }
  }
  const byIndex = candidates.map((c, i) => [i, c.weight] as const);
  for (let pair = 0; pair < TRANSFER_PAIRS; pair++) {
    const c = candidates[rng.weighted(byIndex)];
    const bookedOn = rng.dateBetween(c.start, c.end);
    const amount =
      c.kind === 'to-savings'
        ? roundTo(rng.int(10_000, 300_000), 100)
        : c.kind === 'from-savings'
          ? roundTo(rng.int(20_000, 250_000), 100)
          : c.kind === 'card-payment'
            ? rng.int(5_000, 180_000)
            : c.kind === 'loc-draw'
              ? roundTo(rng.int(50_000, 400_000), 10_000)
              : c.kind === 'loc-repay'
                ? roundTo(rng.int(20_000, 200_000), 100)
                : rng.int(2_000, 60_000);
    const channel = rng.weighted([['ONLINE', 0.45], ['MOBILE', 0.45], ['BRANCH', 0.1]] as const);
    const status = drawStatus('TRANSFER_OUT', bookedOn);
    push({ accountIdx: c.from, cardIdx: null, bookedOn, type: 'TRANSFER_OUT', channel, status, amount, merchantCategory: null, counterpartyIdx: c.to, pairId: pair });
    push({ accountIdx: c.to, cardIdx: null, bookedOn, type: 'TRANSFER_IN', channel, status, amount, merchantCategory: null, counterpartyIdx: c.from, pairId: pair });
  }
}

function windowWeight(a: AccountRow): number {
  const w = activityWindow(a);
  return w ? daysBetween(w[0], w[1]) + 1 : 0;
}

function cardPurchaseAmount(): { category: string; amount: number } {
  const category = MERCHANT_CATEGORIES[rng.weighted(MERCHANT_CATEGORIES.map((m, i) => [i, m.weight] as const))];
  return { category: category.name, amount: rng.int(category.min, category.max) };
}

// CARD_PURCHASE: on checking (debit card) and credit-card accounts.
{
  const pool = realAccounts
    .filter((a) => (a.typeCode === 'CHK' || a.typeCode === 'CC') && cardsOf(a.idx).length > 0)
    .map((a) => [a.idx, a.activity * customers[a.customerIdx].activity * windowWeight(a) * (a.typeCode === 'CC' ? 1.25 : 1)] as const)
    .filter(([, w]) => w > 0);
  let made = 0;
  while (made < CARD_PURCHASES) {
    const a = accounts[rng.weighted(pool)];
    const [start, end] = activityWindow(a)!;
    const bookedOn = rng.dateBetween(start, end);
    const cardIdx = validCardOn(a.idx, bookedOn);
    if (cardIdx === null) continue;
    const { category, amount } = cardPurchaseAmount();
    push({ accountIdx: a.idx, cardIdx, bookedOn, type: 'CARD_PURCHASE', channel: 'CARD', status: drawStatus('CARD_PURCHASE', bookedOn), amount, merchantCategory: category, counterpartyIdx: null, pairId: null });
    made++;
  }
}

// TEST TRAFFIC: generated apart so the March 2025 count is exact by construction.
const TEST_AMOUNTS = [100, 500, 1000, 1234, 9999, 10000, 25000];
function pushTestTxn(a: AccountRow, bookedOn: string): void {
  let type = rng.weighted([['DEPOSIT', 0.4], ['WITHDRAWAL', 0.25], ['CARD_PURCHASE', 0.2], ['FEE', 0.15]] as const) as TxnType;
  let cardIdx: number | null = null;
  if (type === 'CARD_PURCHASE') {
    cardIdx = a.typeCode === 'CHK' ? validCardOn(a.idx, bookedOn) : null;
    if (cardIdx === null) type = 'DEPOSIT';
  }
  const channel =
    type === 'CARD_PURCHASE' ? 'CARD' : type === 'FEE' ? 'SYSTEM' : type === 'WITHDRAWAL' ? 'ATM' : rng.pick(['ONLINE', 'MOBILE']);
  push({
    accountIdx: a.idx,
    cardIdx,
    bookedOn,
    type,
    channel,
    status: rng.chance(0.9) ? 'POSTED' : 'REVERSED',
    amount: rng.pick(TEST_AMOUNTS),
    merchantCategory: type === 'CARD_PURCHASE' ? 'ONLINE_RETAIL' : null,
    counterpartyIdx: null,
    pairId: null,
  });
}
{
  const testAccounts = testAccountIdx.map((idx) => accounts[idx]);
  for (let k = 0; k < MARCH_2025_TEST_TRANSACTIONS; k++) {
    const a = testAccounts[k % testAccounts.length];
    pushTestTxn(a, rng.dateBetween(maxDate(a.openedOn, MARCH_2025_START), MARCH_2025_END));
  }
  let made = 0;
  while (made < OTHER_TEST_TRANSACTIONS) {
    const a = rng.pick(testAccounts);
    const bookedOn = rng.dateBetween(maxDate(a.openedOn, WINDOW_START), WINDOW_END);
    if (bookedOn >= MARCH_2025_START && bookedOn <= MARCH_2025_END) continue;
    pushTestTxn(a, bookedOn);
    made++;
  }
}

// DEPOSIT / WITHDRAWAL / FEE fill the rest, so the total is exact.
{
  const remaining = TOTAL_TRANSACTIONS - txns.length;
  assert(remaining > 1500, `transactions: only ${remaining} rows left for deposits/withdrawals/fees`);
  const deposits = Math.round(remaining * 0.45);
  const withdrawals = Math.round(remaining * 0.33);
  const fees = remaining - deposits - withdrawals;

  const weightedPool = (typeWeight: Partial<Record<TypeCode, number>>) =>
    realAccounts
      .map((a) => [a.idx, (typeWeight[a.typeCode] ?? 0) * a.activity * customers[a.customerIdx].activity * windowWeight(a)] as const)
      .filter(([, w]) => w > 0);

  const depositPool = weightedPool({ CHK: 3, SAV: 1.1, MMA: 0.7 });
  for (let k = 0; k < deposits; k++) {
    const a = accounts[rng.weighted(depositPool)];
    const [start, end] = activityWindow(a)!;
    const bookedOn = rng.dateBetween(start, end);
    const segment = customers[a.customerIdx].segment;
    const amount =
      a.typeCode === 'CHK'
        ? segment === 'PREMIER'
          ? rng.int(150_000, 900_000)
          : segment === 'BUSINESS'
            ? rng.int(200_000, 1_500_000)
            : rng.int(40_000, 320_000)
        : rng.int(20_000, 500_000) * (a.typeCode === 'MMA' ? 2 : 1);
    const channel = rng.weighted([['BRANCH', 0.3], ['ATM', 0.2], ['MOBILE', 0.3], ['ONLINE', 0.2]] as const);
    push({ accountIdx: a.idx, cardIdx: null, bookedOn, type: 'DEPOSIT', channel, status: drawStatus('DEPOSIT', bookedOn), amount, merchantCategory: null, counterpartyIdx: null, pairId: null });
  }

  const withdrawalPool = weightedPool({ CHK: 2.6, SAV: 0.5, MMA: 0.3, LOC: 0.8 });
  for (let k = 0; k < withdrawals; k++) {
    const a = accounts[rng.weighted(withdrawalPool)];
    const [start, end] = activityWindow(a)!;
    const bookedOn = rng.dateBetween(start, end);
    const atm = a.typeCode === 'CHK' && rng.chance(0.6);
    const amount = atm
      ? rng.int(2, 20) * 1000
      : a.typeCode === 'LOC'
        ? roundTo(rng.int(50_000, 400_000), 10_000)
        : roundTo(rng.int(10_000, 300_000), 100);
    push({ accountIdx: a.idx, cardIdx: null, bookedOn, type: 'WITHDRAWAL', channel: atm ? 'ATM' : 'BRANCH', status: drawStatus('WITHDRAWAL', bookedOn), amount, merchantCategory: null, counterpartyIdx: null, pairId: null });
  }

  const feePool = weightedPool({ CHK: 1.0, SAV: 0.15, MMA: 0.1, CC: 1.8, LOC: 1.0 });
  for (let k = 0; k < fees; k++) {
    const a = accounts[rng.weighted(feePool)];
    const [start, end] = activityWindow(a)!;
    const bookedOn = rng.dateBetween(start, end);
    const amount =
      a.typeCode === 'CHK'
        ? rng.weighted([[1200, 0.45], [3500, 0.25], [300, 0.2], [2500, 0.1]] as const)
        : a.typeCode === 'CC'
          ? rng.chance(0.8)
            ? rng.int(800, 12_000)
            : 2900
          : a.typeCode === 'LOC'
            ? rng.int(1000, 6000)
            : rng.pick([500, 1500]);
    push({ accountIdx: a.idx, cardIdx: null, bookedOn, type: 'FEE', channel: 'SYSTEM', status: drawStatus('FEE', bookedOn), amount, merchantCategory: null, counterpartyIdx: null, pairId: null });
  }
}
assert(txns.length === TOTAL_TRANSACTIONS, `expected ${TOTAL_TRANSACTIONS} transactions, got ${txns.length}`);

/* ---------------------------------------------------- analysis helpers */

const acct = (t: TxnRow) => accounts[t.accountIdx];
const isTestTxn = (t: TxnRow) => acct(t).isTest;
const usdOf = (t: TxnRow) => toUsdMinor(t.amount, acct(t).currency, t.bookedOn);
const in2025 = (t: TxnRow) => t.bookedOn >= '2025-01-01';
const isTransfer = (t: TxnRow) => t.type === 'TRANSFER_IN' || t.type === 'TRANSFER_OUT';
const signed = (t: TxnRow) => (CREDIT_TYPES.includes(t.type) ? usdOf(t) : -usdOf(t));

/* --------------- B15: December 2025 card purchases include unsettled ones */

{
  const dec = () =>
    txns.filter((t) => !isTestTxn(t) && t.type === 'CARD_PURCHASE' && t.bookedOn >= DEC_2025_START);
  const byLatest = dec().sort((a, b) => (a.bookedOn < b.bookedOn ? 1 : a.bookedOn > b.bookedOn ? -1 : b.seq - a.seq));
  let pending = dec().filter((t) => t.status === 'PENDING').length;
  for (const t of byLatest) {
    if (pending >= MIN_DEC_PENDING_CARD) break;
    if (t.status !== 'POSTED') continue;
    t.status = 'PENDING';
    pending++;
  }
  let reversed = dec().filter((t) => t.status === 'REVERSED').length;
  for (const t of [...byLatest].reverse()) {
    if (reversed >= MIN_DEC_REVERSED_CARD) break;
    if (t.status !== 'POSTED') continue;
    t.status = 'REVERSED';
    reversed++;
  }
}

/* ------ B9 (status half): every branch has an unsettled 2025 deposit/withdrawal */

for (let branchIdx = 0; branchIdx < BRANCHES.length; branchIdx++) {
  const slice = txns.filter(
    (t) => !isTestTxn(t) && in2025(t) && acct(t).branchIdx === branchIdx && (t.type === 'DEPOSIT' || t.type === 'WITHDRAWAL'),
  );
  if (slice.some((t) => t.status !== 'POSTED')) continue;
  const first = slice.find((t) => t.status === 'POSTED');
  assert(first !== undefined, `B9: ${BRANCHES[branchIdx].name} has no 2025 deposit or withdrawal`);
  first.status = 'REVERSED';
}

/* ----------------- B8: one customer made clearly the most 2025 card purchases */

function cardCounts(statuses: readonly string[], includeTest: boolean): number[] {
  const counts = customers.map(() => 0);
  for (const t of txns) {
    if (t.type !== 'CARD_PURCHASE' || !in2025(t) || !statuses.includes(t.status)) continue;
    if (!includeTest && isTestTxn(t)) continue;
    counts[acct(t).customerIdx] += 1;
  }
  return counts;
}

const cardCapable = (customerIdx: number) =>
  accounts.some(
    (a) =>
      a.customerIdx === customerIdx &&
      !a.isTest &&
      a.currency === 'USD' &&
      (a.typeCode === 'CHK' || a.typeCode === 'CC') &&
      a.status === 'ACTIVE' &&
      a.openedOn <= WINDOW_START,
  );

const cardWinner = (() => {
  const posted = cardCounts(['POSTED'], false);
  const ineligible = new Set(customers.map((c) => c.idx).filter((i) => testOwners.has(i) || !cardCapable(i)));
  const winner = argmaxExcept(posted, ineligible);
  const targets = accounts.filter(
    (a) => a.customerIdx === winner && !a.isTest && a.currency === 'USD' && (a.typeCode === 'CHK' || a.typeCode === 'CC') && a.status === 'ACTIVE',
  );
  const margin = () => {
    const p = cardCounts(['POSTED'], false);
    const all = cardCounts(TXN_STATUSES, true);
    const second = (values: number[]) => Math.max(...values.filter((_, i) => i !== winner));
    return Math.min(p[winner] - second(p), all[winner] - second(all));
  };
  let guard = 0;
  while (margin() < 3) {
    assert(guard++ < 200, 'B8: could not open a clear card-purchase lead');
    const all = cardCounts(TXN_STATUSES, true);
    const donorOrder = customers
      .map((c) => c.idx)
      .filter((i) => i !== winner)
      .sort((x, y) => all[y] - all[x] || x - y);
    let moved = false;
    for (const donor of donorOrder) {
      const movable = txns.filter(
        (t) =>
          t.type === 'CARD_PURCHASE' && in2025(t) && t.status === 'POSTED' && !isTestTxn(t) &&
          acct(t).customerIdx === donor && acct(t).currency === 'USD',
      );
      for (const t of movable) {
        const target = targets.find((a) => validCardOn(a.idx, t.bookedOn) !== null && activityWindow(a) !== null);
        if (!target) continue;
        t.accountIdx = target.idx;
        t.cardIdx = validCardOn(target.idx, t.bookedOn);
        moved = true;
        break;
      }
      if (moved) break;
    }
    assert(moved, 'B8: no card purchase could be moved');
  }
  return winner;
})();

/* ----------- B7 (transaction count): a third customer transacted the most */

function txnCounts2025(statuses: readonly string[], includeTest: boolean): number[] {
  const counts = customers.map(() => 0);
  for (const t of txns) {
    if (!in2025(t) || !statuses.includes(t.status) || (!includeTest && isTestTxn(t))) continue;
    counts[acct(t).customerIdx] += 1;
  }
  return counts;
}

const activityWinner = (() => {
  const counts = txnCounts2025(TXN_STATUSES, false);
  const hasFullYearChecking = (i: number) =>
    accounts.some((a) => a.customerIdx === i && !a.isTest && a.typeCode === 'CHK' && a.currency === 'USD' && a.status === 'ACTIVE' && a.openedOn <= '2025-01-01');
  const ineligible = new Set(
    customers.map((c) => c.idx).filter((i) => i === principalWinner || i === depositWinner || testOwners.has(i) || !hasFullYearChecking(i)),
  );
  const winner = argmaxExcept(counts, ineligible);
  const target = accounts.find(
    (a) => a.customerIdx === winner && !a.isTest && a.typeCode === 'CHK' && a.currency === 'USD' && a.status === 'ACTIVE' && a.openedOn <= '2025-01-01',
  )!;
  const clearOf = (statuses: readonly string[], factor: number) => {
    const c = txnCounts2025(statuses, true);
    return c[winner] >= Math.max(...c.filter((_, i) => i !== winner)) * factor;
  };
  let guard = 0;
  while (!clearOf(TXN_STATUSES, 1.15) || !clearOf(['POSTED'], 1.12)) {
    assert(guard++ < 400, 'B7: could not open a clear transaction-count lead');
    const all = txnCounts2025(TXN_STATUSES, true);
    const donorOrder = customers
      .map((c) => c.idx)
      .filter((i) => i !== winner)
      .sort((x, y) => all[y] - all[x] || x - y);
    let moved = false;
    for (const donor of donorOrder) {
      const t = txns.find(
        (x) =>
          in2025(x) && x.status === 'POSTED' && !isTestTxn(x) && acct(x).customerIdx === donor &&
          acct(x).currency === 'USD' &&
          ((x.type === 'FEE' && acct(x).typeCode === 'CHK') ||
            ((x.type === 'DEPOSIT' || x.type === 'WITHDRAWAL') && isDepositType(acct(x).typeCode))),
      );
      if (!t) continue;
      t.accountIdx = target.idx;
      moved = true;
      break;
    }
    assert(moved, 'B7: no transaction could be moved');
  }
  return winner;
})();

/* ------ B9 (transfer half): internal transfers do not net out at any branch */

function branchFlows(): { flow: number; transfers: number }[] {
  const out = BRANCHES.map(() => ({ flow: 0, transfers: 0 }));
  for (const t of txns) {
    if (isTestTxn(t) || !in2025(t) || t.status !== 'POSTED') continue;
    const row = out[acct(t).branchIdx];
    if (isTransfer(t)) row.transfers += signed(t);
    else row.flow += signed(t);
  }
  return out;
}

{
  const pairLegs = new Map<number, TxnRow[]>();
  for (const t of txns) {
    if (t.pairId === null) continue;
    pairLegs.set(t.pairId, [...(pairLegs.get(t.pairId) ?? []), t]);
  }
  let guard = 0;
  for (;;) {
    const flows = branchFlows();
    const failing = flows.findIndex((f) => Math.abs(f.transfers) < 0.05 * Math.abs(f.flow));
    if (failing < 0) break;
    assert(guard++ < 500, 'B9: transfer nets would not separate from zero');
    const need = flows[failing];
    const wantIn = need.transfers >= 0; // grow the net in the direction it already leans
    const delta = Math.ceil((0.06 * Math.abs(need.flow) - Math.abs(need.transfers)) / 100) * 100;
    const options = [...pairLegs.values()].filter((legs) => {
      const [out, into] = legs[0].type === 'TRANSFER_OUT' ? legs : [legs[1], legs[0]];
      if (!in2025(out) || out.status !== 'POSTED') return false;
      const mine = wantIn ? into : out;
      const other = wantIn ? out : into;
      return acct(mine).branchIdx === failing && acct(other).branchIdx !== failing;
    });
    assert(options.length > 0, `B9: no cross-branch transfer touches ${BRANCHES[failing].name}`);
    // Prefer a pair whose other branch already leans the way this change pushes it.
    options.sort((x, y) => {
      const score = (legs: TxnRow[]) => {
        const other = legs.find((l) => acct(l).branchIdx !== failing)!;
        const lean = flows[acct(other).branchIdx].transfers;
        return other.type === 'TRANSFER_OUT' ? -lean : lean;
      };
      return score(y) - score(x) || x[0].seq - y[0].seq;
    });
    for (const leg of options[0]) leg.amount += delta;
  }
}

/* --------------------------------------------------- ids, refs, final amounts */

// Accounts, cards and loans get chronological ids; transactions sort by date.
const accountOrder = [...accounts].sort((a, b) => (a.openedOn < b.openedOn ? -1 : a.openedOn > b.openedOn ? 1 : a.idx - b.idx));
const accountId = new Map<number, number>();
accountOrder.forEach((a, i) => {
  accountId.set(a.idx, i + 1);
  a.accountNumber = pad(4_100_000_000 + (i + 1) * 7919 + rng.int(0, 7000), 10);
});
assert(new Set(accounts.map((a) => a.accountNumber)).size === accounts.length, 'account numbers must be unique');

const cardOrder = cards
  .map((c, i) => ({ c, i }))
  .sort((x, y) => (x.c.issuedOn < y.c.issuedOn ? -1 : x.c.issuedOn > y.c.issuedOn ? 1 : x.i - y.i));
const cardId = new Map<number, number>();
cardOrder.forEach(({ i }, pos) => cardId.set(i, pos + 1));

const loanOrder = [...loans].sort((a, b) => (a.originatedOn < b.originatedOn ? -1 : a.originatedOn > b.originatedOn ? 1 : a.idx - b.idx));
const loanId = new Map<number, number>();
loanOrder.forEach((l, i) => loanId.set(l.idx, i + 1));

txns.sort((a, b) => (a.bookedOn < b.bookedOn ? -1 : a.bookedOn > b.bookedOn ? 1 : a.seq - b.seq));
payments.sort((a, b) =>
  a.paidOn < b.paidOn ? -1 : a.paidOn > b.paidOn ? 1 : loanId.get(a.loanIdx)! - loanId.get(b.loanIdx)!,
);

/* -------------------------------------------------------------- invariants */

// Row-level rules mirror the CHECK constraints in the DDL, plus the ones a
// CHECK cannot express (cross-table currency, card ownership, FX identity).
for (const a of accounts) {
  const category = TYPE_BY_CODE.get(a.typeCode)!.category;
  assert(a.openedOn >= PRODUCTS_FROM && a.openedOn <= WINDOW_END, `account ${a.idx}: opened outside 2019-2025`);
  assert((a.status === 'CLOSED') === (a.closedOn !== null), `account ${a.idx}: status/closed_on mismatch`);
  assert(a.closedOn === null || (a.closedOn >= a.openedOn && a.closedOn <= WINDOW_END), `account ${a.idx}: bad closed_on`);
  assert(a.status !== 'CLOSED' || a.balance === 0, `account ${a.idx}: CLOSED must carry a zero balance`);
  assert(a.balance >= 0, `account ${a.idx}: negative balance`);
  assert(category === 'DEPOSIT' || a.currency === 'USD', `account ${a.idx}: CREDIT accounts must be USD`);
  assert(a.openedOn >= customers[a.customerIdx].joinedOn, `account ${a.idx}: opened before the customer joined`);
}
for (const c of customers) {
  assert(c.joinedOn >= CUSTOMERS_FROM && c.joinedOn <= WINDOW_END, `${c.fullName}: joined_on outside 2015-2025`);
}
for (const card of cards) {
  const a = accounts[card.accountIdx];
  assert(
    (card.cardType === 'DEBIT' && a.typeCode === 'CHK') || (card.cardType === 'CREDIT' && a.typeCode === 'CC'),
    `card ${card.masked}: DEBIT cards belong on CHK, CREDIT cards on CC`,
  );
  assert(card.issuedOn >= a.openedOn && card.expiresOn > card.issuedOn, `card ${card.masked}: bad dates`);
}
{
  const eur = accounts.filter((a) => a.currency === 'EUR').length;
  const gbp = accounts.filter((a) => a.currency === 'GBP').length;
  assert(eur === 14 && gbp === 10, `currency mix must be EUR 14 / GBP 10, got ${eur}/${gbp}`);
}

const pairCheck = new Map<number, TxnRow[]>();
for (const t of txns) {
  const a = acct(t);
  assert(t.bookedOn >= WINDOW_START && t.bookedOn <= WINDOW_END, `txn ${t.seq}: booked outside 2024-2025`);
  assert(t.bookedOn >= a.openedOn && (a.closedOn === null || t.bookedOn <= a.closedOn), `txn ${t.seq}: booked outside the account's life`);
  assert(t.amount > 0 && usdOf(t) > 0, `txn ${t.seq}: amounts must be positive`);
  assert(a.currency !== 'USD' || usdOf(t) === t.amount, `txn ${t.seq}: USD amount_usd_minor must equal amount_minor`);
  assert((t.type === 'CARD_PURCHASE') === (t.merchantCategory !== null), `txn ${t.seq}: merchant_category iff CARD_PURCHASE`);
  assert((t.type === 'CARD_PURCHASE') === (t.cardIdx !== null), `txn ${t.seq}: card_id iff CARD_PURCHASE`);
  assert((t.type === 'CARD_PURCHASE') === (t.channel === 'CARD'), `txn ${t.seq}: CARD channel iff CARD_PURCHASE`);
  assert((t.type === 'FEE' || t.type === 'INTEREST') === (t.channel === 'SYSTEM'), `txn ${t.seq}: SYSTEM channel iff FEE/INTEREST`);
  assert(isTransfer(t) === (t.counterpartyIdx !== null), `txn ${t.seq}: counterparty iff transfer`);
  if (t.type === 'DEPOSIT' || t.type === 'INTEREST') assert(isDepositType(a.typeCode), `txn ${t.seq}: ${t.type} only on deposit accounts`);
  if (t.cardIdx !== null) {
    const card = cards[t.cardIdx];
    assert(card.accountIdx === t.accountIdx, `txn ${t.seq}: the card belongs to another account`);
    assert(card.issuedOn <= t.bookedOn && t.bookedOn <= card.expiresOn, `txn ${t.seq}: card not valid on the booking date`);
  }
  if (t.pairId !== null) pairCheck.set(t.pairId, [...(pairCheck.get(t.pairId) ?? []), t]);
}
// Transfer legs pair exactly: one OUT, one IN, same day/amount/currency/status,
// cross-linked counterparties, never touching a test account.
assert(pairCheck.size === TRANSFER_PAIRS, `expected ${TRANSFER_PAIRS} transfer pairs`);
for (const [pairId, legs] of pairCheck) {
  assert(legs.length === 2, `transfer ${pairId}: expected two legs`);
  const out = legs.find((l) => l.type === 'TRANSFER_OUT');
  const into = legs.find((l) => l.type === 'TRANSFER_IN');
  assert(out !== undefined && into !== undefined, `transfer ${pairId}: needs one OUT and one IN leg`);
  assert(out.counterpartyIdx === into.accountIdx && into.counterpartyIdx === out.accountIdx, `transfer ${pairId}: counterparties not cross-linked`);
  assert(out.bookedOn === into.bookedOn && out.amount === into.amount && out.status === into.status, `transfer ${pairId}: legs differ`);
  assert(acct(out).currency === acct(into).currency, `transfer ${pairId}: legs in different currencies`);
  assert(!acct(out).isTest && !acct(into).isTest, `transfer ${pairId}: touches a test account`);
}
{
  // The pairing must also be recoverable in SQL: (account, counterparty, day, amount) is unique per leg.
  const keys = txns.filter(isTransfer).map((t) => `${t.type}|${t.accountIdx}|${t.counterpartyIdx}|${t.bookedOn}|${t.amount}`);
  assert(new Set(keys).size === keys.length, 'transfer legs must be uniquely matchable in SQL');
  const unpaired = txns.filter(isTransfer).filter((t) => t.pairId === null);
  assert(unpaired.length === 0, 'every transfer leg must belong to a pair');
}
for (const loan of loans) {
  assert(loan.outstanding >= 0 && loan.outstanding <= loan.principal, `loan ${loan.idx}: outstanding out of range`);
  assert(
    (loan.status !== 'PAID_OFF' && loan.status !== 'CHARGED_OFF') || loan.outstanding === 0,
    `loan ${loan.idx}: PAID_OFF/CHARGED_OFF must carry zero outstanding`,
  );
  assert(
    loan.status === 'PAID_OFF' || loan.status === 'CHARGED_OFF' || loan.outstanding > 0,
    `loan ${loan.idx}: an open loan must still owe something`,
  );
}
for (const p of payments) {
  assert(p.principal + p.interest === p.amount && p.amount > 0 && p.principal >= 0 && p.interest >= 0, 'loan payment split');
  assert(p.paidOn >= WINDOW_START && p.paidOn <= WINDOW_END, 'loan payment outside 2024-2025');
  assert(p.paidOn > loans[p.loanIdx].originatedOn, 'loan payment before origination');
}

// FX rates drift inside their bands.
for (const [currency, lo, hi] of [['EUR', 1.05, 1.12], ['GBP', 1.22, 1.32]] as const) {
  const values = fxRates.filter((r) => r.currency === currency).map((r) => r.micro / 1e6);
  assert(values.length === 24, `${currency}: expected 24 monthly rates`);
  assert(Math.min(...values) >= lo && Math.max(...values) <= hi, `B14: ${currency} rates leave the ${lo}-${hi} band`);
  assert(Math.max(...values) - Math.min(...values) >= 0.02 && new Set(values).size >= 18, `B14: ${currency} rates barely drift`);
}

// B1 - both loan ratios separate the three products.
function productRatios(): { product: Product; interestShare: number; outstandingShare: number }[] {
  return (['MORTGAGE', 'AUTO', 'PERSONAL'] as const).map((product) => {
    const own = loans.filter((l) => l.product === product);
    const ownPayments = payments.filter((p) => loans[p.loanIdx].product === product);
    const interest = ownPayments.reduce((s, p) => s + p.interest, 0);
    const amount = ownPayments.reduce((s, p) => s + p.amount, 0);
    const outstanding = own.reduce((s, l) => s + l.outstanding, 0);
    const principal = own.reduce((s, l) => s + l.principal, 0);
    return { product, interestShare: interest / amount, outstandingShare: outstanding / principal };
  });
}
{
  const ratios = productRatios();
  for (const key of ['interestShare', 'outstandingShare'] as const) {
    const sorted = [...ratios].sort((a, b) => b[key] - a[key]);
    for (const row of sorted) {
      assert(row[key] > 0.1 && row[key] < 0.9, `B1: ${row.product} ${key} ${row[key].toFixed(4)} is degenerate`);
    }
    for (let i = 1; i < sorted.length; i++) {
      assert(sorted[i - 1][key] - sorted[i][key] >= 0.02, `B1: ${key} of ${sorted[i - 1].product} and ${sorted[i].product} too close`);
    }
  }
}

// B2 - loans are USD; some loan customers hold EUR/GBP accounts.
{
  const loanCustomers = new Set(loans.map((l) => l.customerIdx));
  const foreign = [...loanCustomers].filter((i) => holdsForeign(i, 'EUR') || holdsForeign(i, 'GBP'));
  assert(foreign.length >= 3, `B2: only ${foreign.length} loan customers hold a EUR/GBP account`);
  assert([...loanCustomers].some((i) => holdsForeign(i, 'EUR')), 'B2: need a loan customer with a EUR account');
  assert([...loanCustomers].some((i) => holdsForeign(i, 'GBP')), 'B2: need a loan customer with a GBP account');
}

// B3 - merchant category lives on card purchases only, 12-18% of rows.
{
  const share = txns.filter((t) => t.type === 'CARD_PURCHASE').length / txns.length;
  assert(share >= 0.12 && share <= 0.18, `B3: card purchases are ${(share * 100).toFixed(1)}% of rows`);
}

// B4 - exactly two branches opened exactly 12 accounts in 2024; 12 is the max.
const tieRows = BRANCHES.map((b, i) => ({ name: b.name, real: tieYearCount(i, false), all: tieYearCount(i, true) }));
{
  const at12 = tieRows.filter((r) => r.real === TIE_COUNT).map((r) => r.name).sort();
  assert(at12.join('|') === [...TIED_BRANCHES].sort().join('|'), `B4: tie drifted: ${JSON.stringify(tieRows)}`);
  for (const r of tieRows) {
    if (TIED_BRANCHES.includes(r.name)) {
      assert(r.all === TIE_COUNT, `B4: ${r.name} must open no test account in 2024`);
    } else {
      assert(r.real <= OTHER_BRANCH_CAP && r.all <= OTHER_BRANCH_CAP, `B4: ${r.name} must stay at or below ${OTHER_BRANCH_CAP}`);
    }
  }
}

// B5 - non-performing and closed-out loan statuses all present.
const loanStatusCounts = (['CURRENT', 'DELINQUENT', 'DEFAULTED', 'PAID_OFF', 'CHARGED_OFF'] as const).map((s) => ({
  status: s,
  count: loans.filter((l) => l.status === s).length,
}));
{
  const n = (s: LoanStatus) => loans.filter((l) => l.status === s).length;
  assert(n('DELINQUENT') >= 6 && n('DEFAULTED') >= 3 && n('CHARGED_OFF') >= 2 && n('PAID_OFF') >= 10, `B5: ${JSON.stringify(loanStatusCounts)}`);
}

// B6 - accounts predate the transaction history.
{
  const before2024 = accounts.filter((a) => a.openedOn < WINDOW_START).length;
  assert(before2024 >= 20, `B6: only ${before2024} accounts opened before 2024`);
  assert(accounts.some((a) => a.openedOn.startsWith('2021')), 'B6: need an account opened in 2021');
}

// B7 - three different customers top the three "value" measures.
function assertDistinctValueWinners(includeTest: boolean): number[] {
  const measures: number[][] = [
    txnCounts2025(TXN_STATUSES, includeTest),
    principalTotals(),
    depositTotals(includeTest),
  ];
  const winners = measures.map((values, m) => {
    const ranked = values.map((v, i) => ({ v, i })).sort((a, b) => b.v - a.v || a.i - b.i);
    assert(ranked[0].v >= ranked[1].v * 1.1, `B7: measure ${m} winner is not clear of the runner-up (includeTest=${includeTest})`);
    return ranked[0].i;
  });
  assert(new Set(winners).size === 3, `B7: the three measures must name three customers (includeTest=${includeTest})`);
  assert(
    winners[0] === activityWinner && winners[1] === principalWinner && winners[2] === depositWinner,
    'B7: winners moved after planting',
  );
  return winners;
}
assertDistinctValueWinners(false);
assertDistinctValueWinners(true);
{
  const posted = txnCounts2025(['POSTED'], false);
  const ranked = [...posted].sort((a, b) => b - a);
  assert(posted[activityWinner] === ranked[0] && ranked[0] >= ranked[1] * 1.1, 'B7: activity winner must also lead on POSTED only');
}

// B8 - the top card purchaser is unique and robust to status and test filters.
{
  for (const [statuses, includeTest] of [[['POSTED'], false], [TXN_STATUSES, false], [TXN_STATUSES, true], [['POSTED'], true]] as const) {
    const counts = cardCounts(statuses, includeTest);
    const ranked = counts.map((v, i) => ({ v, i })).sort((a, b) => b.v - a.v || a.i - b.i);
    assert(ranked[0].i === cardWinner && ranked[0].v - ranked[1].v >= 2, `B8: card-purchase leader drifted (${statuses.join('/')}, test=${includeTest})`);
  }
}

// B9 - per branch, transfer legs do not net out, and status matters.
for (const [branchIdx, f] of branchFlows().entries()) {
  assert(Math.abs(f.transfers) >= 0.05 * Math.abs(f.flow) && f.transfers !== 0, `B9: ${BRANCHES[branchIdx].name} transfers net to ~0`);
  const unsettled = txns.some(
    (t) => !isTestTxn(t) && in2025(t) && acct(t).branchIdx === branchIdx && (t.type === 'DEPOSIT' || t.type === 'WITHDRAWAL') && t.status !== 'POSTED',
  );
  assert(unsettled, `B9: ${BRANCHES[branchIdx].name} needs a PENDING or REVERSED 2025 deposit/withdrawal`);
}

// B10 - test traffic: exact March 2025 count, never on a tied branch or a winner.
const marchTxns = txns.filter((t) => t.bookedOn >= MARCH_2025_START && t.bookedOn <= MARCH_2025_END);
{
  const marchTest = marchTxns.filter(isTestTxn).length;
  assert(marchTest === MARCH_2025_TEST_TRANSACTIONS, `B10: March 2025 carries ${marchTest} test transactions`);
  for (const idx of testAccountIdx) {
    const a = accounts[idx];
    assert(!tiedBranchIdx.includes(a.branchIdx), 'B10: a test account sits at a tied branch');
    assert(![activityWinner, principalWinner, depositWinner, cardWinner].includes(a.customerIdx), 'B10: a winner owns a test account');
  }
  assert(testAccountIdx.some((idx) => accounts[idx].openedOn.startsWith('2024')), 'B10: need a test account opened in 2024');
  const rate = TEST_ACCOUNT_COUNT / accounts.length;
  assert(rate >= 0.025 && rate <= 0.035, `B10: test-account rate ${rate}`);
}

// B11 - the account's branch is not the customer's home branch often enough to matter.
const regionOf = (branchIdx: number) => BRANCHES[branchIdx].region;
const regionPaths = REGIONS.map((r) => {
  const opened = accounts.filter((a) => !a.isTest && a.openedOn.startsWith('2024'));
  return {
    region: r.name,
    viaAccountBranch: opened.filter((a) => regionOf(a.branchIdx) === r.code).length,
    viaHomeBranch: opened.filter((a) => regionOf(customers[a.customerIdx].homeBranchIdx) === r.code).length,
  };
});
{
  const away = accounts.filter((a) => a.branchIdx !== customers[a.customerIdx].homeBranchIdx).length / accounts.length;
  assert(away >= 0.1, `B11: only ${(away * 100).toFixed(1)}% of accounts sit away from the home branch`);
  const differing = regionPaths.filter((r) => r.viaAccountBranch !== r.viaHomeBranch).length;
  assert(differing >= 2, `B11: the two join paths differ in only ${differing} regions`);
}

// B13 - every branch has a real CREDIT account, so "deposit accounts" is a real filter.
for (let branchIdx = 0; branchIdx < BRANCHES.length; branchIdx++) {
  assert(
    accounts.some((a) => a.branchIdx === branchIdx && !a.isTest && !isDepositType(a.typeCode)),
    `B13: ${BRANCHES[branchIdx].name} has no credit account`,
  );
}

// B14 - EUR and GBP accounts carry real 2025 deposit volume.
for (const currency of ['EUR', 'GBP'] as const) {
  const n = txns.filter((t) => acct(t).currency === currency && t.type === 'DEPOSIT' && t.status === 'POSTED' && in2025(t) && !isTestTxn(t)).length;
  assert(n >= 20, `B14: only ${n} POSTED 2025 deposits on ${currency} accounts`);
}

// B15 - December 2025 card spend moves when unsettled purchases are counted.
{
  const dec = txns.filter((t) => !isTestTxn(t) && t.type === 'CARD_PURCHASE' && t.bookedOn >= DEC_2025_START);
  assert(dec.filter((t) => t.status === 'PENDING').length >= MIN_DEC_PENDING_CARD, 'B15: too few PENDING December card purchases');
  assert(dec.filter((t) => t.status === 'REVERSED').length >= MIN_DEC_REVERSED_CARD, 'B15: too few REVERSED December card purchases');
}

// Status mix stays near the planned 92/4/4.
const statusMix = TXN_STATUSES.map((s) => ({ status: s, count: txns.filter((t) => t.status === s).length }));
{
  const share = (s: string) => txns.filter((t) => t.status === s).length / txns.length;
  assert(share('POSTED') >= 0.88 && share('POSTED') <= 0.95, `status mix: POSTED ${share('POSTED')}`);
  assert(share('PENDING') >= 0.02 && share('PENDING') <= 0.07, `status mix: PENDING ${share('PENDING')}`);
  assert(share('REVERSED') >= 0.02 && share('REVERSED') <= 0.07, `status mix: REVERSED ${share('REVERSED')}`);
}

/* =================================================================== wealth */
// Everything from here to the DDL draws from its own Rng, so every banking row
// above stays byte-identical to the branch's banking fixture.

const WEALTH_SEED = 20261013;
const wrng = new Rng(WEALTH_SEED);

const QUARTER_ENDS = ['2024-03-31', '2024-06-30', '2024-09-30', '2024-12-31', '2025-03-31', '2025-06-30', '2025-09-30', '2025-12-31'];
const Q_FY2025_END = QUARTER_ENDS.indexOf('2025-06-30');
const Q_2025_END = QUARTER_ENDS.indexOf('2025-12-31');
/** The month no fee was charged: the billing platform cut-over (W1). */
const EMPTY_MONTH = '2025-08';
const TEST_PORTFOLIO_COUNT = 3;

/* ---------------------------------------------------------- fiscal periods */

interface FiscalPeriod {
  id: number;
  month: string;
  fiscalYear: number;
  fiscalQuarter: number;
  fiscalMonth: number;
  code: string;
  start: string;
  end: string;
}

// The fiscal year runs 1 July to 30 June and is named by the year it ends in.
const fiscalPeriods: FiscalPeriod[] = monthsBetween('2023-07', '2026-06').map((month, i) => {
  const year = Number(month.slice(0, 4));
  const calendarMonth = Number(month.slice(5, 7));
  const fiscalYear = calendarMonth >= 7 ? year + 1 : year;
  const fiscalMonth = ((calendarMonth + 5) % 12) + 1;
  return {
    id: i + 1,
    month,
    fiscalYear,
    fiscalQuarter: Math.ceil(fiscalMonth / 3),
    fiscalMonth,
    code: `FY${fiscalYear}-P${pad(fiscalMonth, 2)}`,
    start: `${month}-01`,
    end: monthEnd(`${month}-01`),
  };
});
const periodByMonth = new Map(fiscalPeriods.map((p) => [p.month, p]));
const periodOf = (month: string) => {
  const period = periodByMonth.get(month);
  assert(period !== undefined, `no fiscal period for ${month}`);
  return period;
};

/* -------------------------------------------------------------- securities */

type AssetClass = 'EQUITY' | 'BOND' | 'FUND' | 'CASH';
interface SecuritySeed {
  symbol: string;
  name: string;
  assetClass: AssetClass;
  sector: string | null;
  /** Price in cents at 2024-03-31, then a quarterly drift and noise. */
  price: number;
  drift: number;
  vol: number;
}

const SECURITIES: SecuritySeed[] = [
  { symbol: 'NWSC', name: 'Northwind Semiconductors', assetClass: 'EQUITY', sector: 'Technology', price: 18_450, drift: 0.035, vol: 0.08 },
  { symbol: 'CLRA', name: 'Clearwater Analytics Group', assetClass: 'EQUITY', sector: 'Technology', price: 9_220, drift: 0.025, vol: 0.07 },
  { symbol: 'HLXB', name: 'Helix Biotherapeutics', assetClass: 'EQUITY', sector: 'Health Care', price: 6_310, drift: 0.01, vol: 0.1 },
  { symbol: 'MDVC', name: 'Meadowvale Health Systems', assetClass: 'EQUITY', sector: 'Health Care', price: 14_275, drift: 0.015, vol: 0.04 },
  { symbol: 'GRNF', name: 'Granite Falls Energy', assetClass: 'EQUITY', sector: 'Energy', price: 5_480, drift: 0.005, vol: 0.07 },
  { symbol: 'SLRW', name: 'Solarwind Renewables', assetClass: 'EQUITY', sector: 'Energy', price: 3_195, drift: 0.02, vol: 0.09 },
  { symbol: 'BRKH', name: 'Birchwood Holdings', assetClass: 'EQUITY', sector: 'Financials', price: 11_840, drift: 0.012, vol: 0.04 },
  { symbol: 'CPTL', name: 'Capitol Ledger Bancorp', assetClass: 'EQUITY', sector: 'Financials', price: 4_765, drift: 0.01, vol: 0.05 },
  { symbol: 'HRTH', name: 'Hearthstone Consumer Brands', assetClass: 'EQUITY', sector: 'Consumer Staples', price: 7_630, drift: 0.008, vol: 0.03 },
  { symbol: 'TLMK', name: 'Tidemark Retail', assetClass: 'EQUITY', sector: 'Consumer Discretionary', price: 2_910, drift: 0.015, vol: 0.08 },
  { symbol: 'AXLM', name: 'Axle & Mast Industrials', assetClass: 'EQUITY', sector: 'Industrials', price: 13_360, drift: 0.014, vol: 0.05 },
  { symbol: 'PRLN', name: 'Pearline Logistics', assetClass: 'EQUITY', sector: 'Industrials', price: 8_805, drift: 0.011, vol: 0.06 },
  { symbol: 'VNTA', name: 'Ventara Communications', assetClass: 'EQUITY', sector: 'Communication Services', price: 5_120, drift: 0.006, vol: 0.05 },
  { symbol: 'QRYM', name: 'Quarry Mountain Materials', assetClass: 'EQUITY', sector: 'Materials', price: 6_985, drift: 0.009, vol: 0.06 },
  { symbol: 'LUMN', name: 'Lumen Ridge Utilities', assetClass: 'EQUITY', sector: 'Utilities', price: 4_150, drift: 0.006, vol: 0.02 },
  { symbol: 'OKRE', name: 'Oakridge Real Estate Trust', assetClass: 'EQUITY', sector: 'Real Estate', price: 3_740, drift: 0.004, vol: 0.05 },
  { symbol: 'UST-27', name: 'US Treasury Note 4.25% 2027', assetClass: 'BOND', sector: null, price: 9_960, drift: 0.002, vol: 0.004 },
  { symbol: 'UST-34', name: 'US Treasury Note 4.00% 2034', assetClass: 'BOND', sector: null, price: 9_710, drift: 0.003, vol: 0.015 },
  { symbol: 'NYDA-31', name: 'New York Dormitory Authority 3.50% 2031', assetClass: 'BOND', sector: null, price: 9_880, drift: 0.002, vol: 0.008 },
  { symbol: 'BRKH-29', name: 'Birchwood Holdings 5.10% 2029', assetClass: 'BOND', sector: null, price: 10_120, drift: 0.002, vol: 0.01 },
  { symbol: 'AXLM-30', name: 'Axle & Mast Industrials 5.60% 2030', assetClass: 'BOND', sector: null, price: 9_940, drift: 0.002, vol: 0.012 },
  { symbol: 'VNTA-28', name: 'Ventara Communications 6.25% 2028', assetClass: 'BOND', sector: null, price: 9_575, drift: 0.003, vol: 0.02 },
  { symbol: 'MTB-USEQ', name: 'Meridian US Equity Index Fund', assetClass: 'FUND', sector: null, price: 4_215, drift: 0.025, vol: 0.05 },
  { symbol: 'MTB-INTL', name: 'Meridian International Equity Fund', assetClass: 'FUND', sector: null, price: 2_870, drift: 0.015, vol: 0.06 },
  { symbol: 'MTB-BOND', name: 'Meridian Core Bond Fund', assetClass: 'FUND', sector: null, price: 1_010, drift: 0.004, vol: 0.01 },
  { symbol: 'MTB-BAL', name: 'Meridian Balanced Allocation Fund', assetClass: 'FUND', sector: null, price: 1_985, drift: 0.012, vol: 0.03 },
  { symbol: 'MTB-EM', name: 'Meridian Emerging Markets Fund', assetClass: 'FUND', sector: null, price: 1_540, drift: 0.01, vol: 0.08 },
  { symbol: 'MTB-CASH', name: 'Meridian Cash Sweep', assetClass: 'CASH', sector: null, price: 100, drift: 0, vol: 0 },
];
assert(new Set(SECURITIES.map((s) => s.symbol)).size === SECURITIES.length, 'security symbols must be unique');

/** prices[security][quarter], cents per unit at each quarter-end. */
const prices: number[][] = SECURITIES.map((s) => {
  const out: number[] = [];
  let price = s.price;
  for (let q = 0; q < QUARTER_ENDS.length; q++) {
    if (q > 0 && s.vol > 0) price = Math.max(1, Math.round(price * (1 + s.drift + wrng.float(-s.vol, s.vol, 4))));
    out.push(price);
  }
  return out;
});

/* -------------------------------------------------------------- portfolios */

type Mandate = 'DISCRETIONARY' | 'ADVISORY' | 'EXECUTION_ONLY';
type RiskProfile = 'CONSERVATIVE' | 'BALANCED' | 'GROWTH';

interface Position {
  securityIdx: number;
  units: number;
  /** Cents per unit paid; null for a position transferred in from another firm (W7). */
  costPerUnit: number | null;
}

interface PortfolioRow {
  idx: number;
  number: string;
  customerIdx: number;
  branchIdx: number;
  mandate: Mandate;
  risk: RiskProfile;
  feeBps: number;
  openedOn: string;
  closedOn: string | null;
  isTest: boolean;
  targetValue: number;
  positions: Position[];
}

const OWNER_CHANCE: Record<Segment, number> = { PREMIER: 1, BUSINESS: 0.6, RETAIL: 0.2 };
const CLASS_WEIGHTS: Record<RiskProfile, readonly (readonly [AssetClass, number])[]> = {
  CONSERVATIVE: [['BOND', 0.5], ['FUND', 0.25], ['EQUITY', 0.15], ['CASH', 0.1]],
  BALANCED: [['EQUITY', 0.4], ['BOND', 0.3], ['FUND', 0.2], ['CASH', 0.1]],
  GROWTH: [['EQUITY', 0.65], ['FUND', 0.2], ['BOND', 0.1], ['CASH', 0.05]],
};
const FEE_BPS: Record<Mandate, readonly number[]> = {
  DISCRETIONARY: [100, 100, 90, 85],
  ADVISORY: [75, 75, 65, 60],
  EXECUTION_ONLY: [0],
};

function wDateInYears(weights: readonly (readonly [number, number])[], min: string, max: string): string {
  const year = wrng.weighted(weights);
  return wrng.dateBetween(maxDate(`${year}-01-01`, min), minDate(`${year}-12-31`, max));
}

/** First quarter-end on or after the portfolio opened: its first snapshot. */
const firstQuarter = (p: PortfolioRow) => QUARTER_ENDS.findIndex((qe) => qe >= p.openedOn);
/** A portfolio has a snapshot at a quarter-end when it is open on that day. */
const heldAt = (p: PortfolioRow, q: number) =>
  p.openedOn <= QUARTER_ENDS[q] && (p.closedOn === null || p.closedOn > QUARTER_ENDS[q]);

function pickPositions(p: PortfolioRow): Position[] {
  const count = wrng.int(5, 9);
  const chosen: number[] = [];
  for (let attempt = 0; chosen.length < count && attempt < 200; attempt++) {
    const assetClass = wrng.weighted(CLASS_WEIGHTS[p.risk]);
    const pool = SECURITIES.map((s, i) => ({ s, i })).filter(({ s, i }) => s.assetClass === assetClass && !chosen.includes(i));
    if (pool.length === 0) continue;
    chosen.push(wrng.pick(pool).i);
  }
  const weights = chosen.map(() => wrng.float(0.5, 1.5, 4));
  const total = weights.reduce((sum, w) => sum + w, 0);
  const q0 = firstQuarter(p);
  return chosen.map((securityIdx, k) => {
    const price = prices[securityIdx][q0];
    const units = Math.max(1, Math.round(((p.targetValue * weights[k]) / total / price) * 10_000) / 10_000);
    const transferredIn = wrng.chance(0.22);
    const costFactor = p.openedOn < WINDOW_START ? wrng.float(0.7, 1.05, 4) : wrng.float(0.96, 1.03, 4);
    return { securityIdx, units, costPerUnit: transferredIn ? null : Math.max(1, Math.round(price * costFactor)) };
  });
}

const portfolios: PortfolioRow[] = [];

function newPortfolio(customerIdx: number, isTest: boolean): PortfolioRow {
  const customer = customers[customerIdx];
  const others = BRANCHES.map((_, i) => i).filter((i) => i !== customer.homeBranchIdx);
  const branchIdx = wrng.chance(0.75) ? customer.homeBranchIdx : wrng.pick(others);
  const mandate: Mandate = isTest
    ? 'DISCRETIONARY'
    : wrng.weighted([['DISCRETIONARY', 0.45], ['ADVISORY', 0.35], ['EXECUTION_ONLY', 0.2]] as const);
  const risk: RiskProfile = isTest
    ? 'GROWTH'
    : wrng.weighted([['CONSERVATIVE', 0.3], ['BALANCED', 0.45], ['GROWTH', 0.25]] as const);
  const openedOn = isTest
    ? wrng.dateBetween('2024-02-01', '2024-03-15')
    : maxDate(
        wDateInYears([[2019, 0.1], [2020, 0.1], [2021, 0.12], [2022, 0.13], [2023, 0.15], [2024, 0.22], [2025, 0.18]], '2019-01-01', '2025-11-30'),
        customer.joinedOn,
      );
  const targetValue = isTest
    ? wrng.int(900_000_000, 1_200_000_000)
    : customer.segment === 'PREMIER'
      ? wrng.int(80_000_000, 600_000_000)
      : customer.segment === 'BUSINESS'
        ? wrng.int(40_000_000, 350_000_000)
        : wrng.int(10_000_000, 90_000_000);
  const p: PortfolioRow = {
    idx: portfolios.length,
    number: '',
    customerIdx,
    branchIdx,
    mandate,
    risk,
    feeBps: wrng.pick(FEE_BPS[mandate]),
    openedOn,
    closedOn: null,
    isTest,
    targetValue,
    positions: [],
  };
  p.positions = pickPositions(p);
  return p;
}

for (const customer of customers) {
  if (testOwners.has(customer.idx)) continue;
  if (!wrng.chance(OWNER_CHANCE[customer.segment])) continue;
  portfolios.push(newPortfolio(customer.idx, false));
  if (wrng.chance(0.3)) portfolios.push(newPortfolio(customer.idx, false));
}
// W3: three sandbox portfolios, each owned by a customer with no real portfolio.
for (const owner of [...testOwners].sort((a, b) => a - b).slice(0, TEST_PORTFOLIO_COUNT)) {
  portfolios.push(newPortfolio(owner, true));
}
assert(portfolios.filter((p) => p.isTest).length === TEST_PORTFOLIO_COUNT, `W3: expected ${TEST_PORTFOLIO_COUNT} test portfolios`);

// A few real portfolios closed inside the window (their owners may hold another).
for (const p of wrng.shuffle(portfolios.filter((x) => !x.isTest && x.openedOn < '2023-06-30')).slice(0, 4)) {
  p.closedOn = wrng.dateBetween('2024-05-01', '2025-10-31');
}

const real = (p: PortfolioRow) => !p.isTest;
const valueAt = (p: PortfolioRow, q: number) =>
  heldAt(p, q) ? p.positions.reduce((sum, pos) => sum + Math.round(pos.units * prices[pos.securityIdx][q]), 0) : 0;
const clientValueAt = (q: number, includeTest: boolean) => {
  const totals = new Map<number, number>();
  for (const p of portfolios) {
    if (!includeTest && p.isTest) continue;
    totals.set(p.customerIdx, (totals.get(p.customerIdx) ?? 0) + valueAt(p, q));
  }
  return totals;
};

/* -------- W2: two securities tie at the top of portfolio counts, FY2025 end */

function holderCounts(q: number, includeTest: boolean): number[] {
  const counts = SECURITIES.map(() => 0);
  for (const p of portfolios) {
    if ((!includeTest && p.isTest) || !heldAt(p, q)) continue;
    for (const pos of p.positions) counts[pos.securityIdx] += 1;
  }
  return counts;
}

const tiedSecurities = (() => {
  const counts = holderCounts(Q_FY2025_END, false);
  const ranked = counts.map((c, i) => ({ c, i })).sort((a, b) => b.c - a.c || a.i - b.i);
  const [first, second] = [ranked[0].i, ranked[1].i];
  const add = (securityIdx: number, p: PortfolioRow) => {
    const q0 = firstQuarter(p);
    p.positions.push({
      securityIdx,
      units: Math.max(1, Math.round((p.targetValue * 0.08) / prices[securityIdx][q0] * 10_000) / 10_000),
      costPerUnit: Math.max(1, Math.round(prices[securityIdx][q0] * wrng.float(0.9, 1.02, 4))),
    });
  };
  // Lift the runner-up to the leader's count with real portfolios that lack it.
  let guard = 0;
  while (holderCounts(Q_FY2025_END, false)[second] < holderCounts(Q_FY2025_END, false)[first]) {
    assert(guard++ < 60, 'W2: could not lift the runner-up');
    const candidates = portfolios.filter(
      (p) => real(p) && heldAt(p, Q_FY2025_END) && !p.positions.some((pos) => pos.securityIdx === second),
    );
    assert(candidates.length > 0, 'W2: no portfolio left to take the runner-up');
    add(second, wrng.pick(candidates));
  }
  // The leader is in one test portfolio and the runner-up in none, so counting
  // the sandbox portfolios breaks the tie (W2 with W3).
  for (const p of portfolios.filter((x) => x.isTest)) {
    p.positions = p.positions.filter((pos) => pos.securityIdx !== second);
    if (!p.positions.some((pos) => pos.securityIdx === first)) add(first, p);
  }
  return [first, second];
})();

/* ---- W12: the client with the most assets pays no advisory fee at all ---- */

const topAumClient = (() => {
  const totals = clientValueAt(Q_2025_END, false);
  const ranked = [...totals.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0]);
  assert(ranked[0][1] >= ranked[1][1] * 1.1, 'W12: the client with the most assets must lead clearly');
  for (const p of portfolios.filter((x) => x.customerIdx === ranked[0][0])) {
    p.mandate = 'EXECUTION_ONLY';
    p.feeBps = 0;
  }
  return ranked[0][0];
})();

/* ------------------------------------------------------------------- fees */

type FeeType = 'ADVISORY' | 'CUSTODY' | 'PERFORMANCE' | 'TRADING';
type FeeStatus = 'ACCRUED' | 'SETTLED' | 'WAIVED' | 'REVERSED';

interface FeeRow {
  portfolioIdx: number;
  type: FeeType;
  /** The calendar month the fee covers (its fiscal period). */
  month: string;
  chargedOn: string | null;
  amount: number;
  status: FeeStatus;
  seq: number;
}

const fees: FeeRow[] = [];
const openInMonth = (p: PortfolioRow, month: string) =>
  p.openedOn <= monthEnd(`${month}-01`) && (p.closedOn === null || p.closedOn >= `${month}-01`);
/** The value an advisory fee is billed on: the last snapshot before the month, else the first. */
function feeBasis(p: PortfolioRow, month: string): number {
  let basis = 0;
  for (let q = 0; q < QUARTER_ENDS.length; q++) {
    if (QUARTER_ENDS[q] < `${month}-01` && heldAt(p, q)) basis = valueAt(p, q);
  }
  return basis > 0 ? basis : valueAt(p, firstQuarter(p));
}
function chargedStatus(chargedOn: string | null, waived: number, reversed: number): FeeStatus {
  if (chargedOn === null) return 'ACCRUED';
  return wrng.weighted([['SETTLED', 1 - waived - reversed], ['WAIVED', waived], ['REVERSED', reversed]] as const);
}
function pushFee(row: Omit<FeeRow, 'seq'>): void {
  assert(row.amount > 0, `fee for portfolio ${row.portfolioIdx}: amount must be positive`);
  fees.push({ ...row, seq: fees.length });
}

for (const p of portfolios) {
  for (const month of WINDOW_MONTHS) {
    if (!openInMonth(p, month)) continue;
    const next = addMonths(`${month}-01`, 1, 1);
    // ADVISORY: monthly in arrears on the 5th; July 2025's fees waited for September (W1).
    if (p.feeBps > 0) {
      let chargedOn: string | null = month === '2025-07' ? '2025-09-05' : `${next.slice(0, 7)}-05`;
      if (chargedOn > WINDOW_END) chargedOn = null;
      pushFee({
        portfolioIdx: p.idx,
        type: 'ADVISORY',
        month,
        chargedOn,
        amount: Math.max(100, Math.round((feeBasis(p, month) * p.feeBps) / 10_000 / 12)),
        status: chargedStatus(chargedOn, 0.035, 0.025),
      });
    }
    // CUSTODY: each quarter-end the portfolio is open, charged on the 10th after.
    const q = QUARTER_ENDS.indexOf(monthEnd(`${month}-01`));
    if (q >= 0 && heldAt(p, q)) {
      const chargedOn = `${next.slice(0, 7)}-10` > WINDOW_END ? null : `${next.slice(0, 7)}-10`;
      pushFee({
        portfolioIdx: p.idx,
        type: 'CUSTODY',
        month,
        chargedOn,
        amount: Math.max(2_500, Math.round(valueAt(p, q) * 0.0002)),
        status: chargedStatus(chargedOn, 0.02, 0.01),
      });
    }
    // TRADING: commissions on the trade day; the trading desk was frozen in August 2025 (W1).
    if ((p.mandate === 'ADVISORY' || p.mandate === 'EXECUTION_ONLY') && month !== EMPTY_MONTH) {
      const trades = wrng.int(0, p.mandate === 'EXECUTION_ONLY' ? 3 : 2);
      for (let t = 0; t < trades; t++) {
        const from = maxDate(`${month}-01`, p.openedOn);
        const to = minDate(monthEnd(`${month}-01`), p.closedOn ?? WINDOW_END);
        if (from > to) continue;
        const chargedOn = wrng.dateBetween(from, to);
        pushFee({
          portfolioIdx: p.idx,
          type: 'TRADING',
          month,
          chargedOn,
          amount: wrng.pick([995, 1_495, 1_995, 2_995, 4_995]),
          status: chargedStatus(chargedOn, 0, 0.03),
        });
      }
    }
  }
  // PERFORMANCE: 10% of a discretionary portfolio's gain over the fiscal year
  // (first to last quarter-end snapshot of the year), charged on 15 July.
  if (p.mandate === 'DISCRETIONARY') {
    for (const [fromQ, toQ, hurdle, chargedOn] of [[0, 1, 0, '2024-07-15'], [1, Q_FY2025_END, 0, '2025-07-15']] as const) {
      if (!heldAt(p, fromQ) || !heldAt(p, toQ)) continue;
      const start = valueAt(p, fromQ);
      const growth = valueAt(p, toQ) / start - 1;
      if (growth <= hurdle) continue;
      pushFee({
        portfolioIdx: p.idx,
        type: 'PERFORMANCE',
        month: QUARTER_ENDS[toQ].slice(0, 7),
        chargedOn,
        amount: Math.round(0.1 * (growth - hurdle) * start),
        status: chargedStatus(chargedOn, 0.05, 0),
      });
    }
  }
}

/* ------------------------------------------------------ ids and the snapshot */

const portfolioOrder = [...portfolios].sort((a, b) => (a.openedOn < b.openedOn ? -1 : a.openedOn > b.openedOn ? 1 : a.idx - b.idx));
const portfolioId = new Map<number, number>();
portfolioOrder.forEach((p, i) => {
  portfolioId.set(p.idx, i + 1);
  p.number = `PF-${pad(20_000 + (i + 1) * 131 + wrng.int(0, 120), 6)}`;
});
assert(new Set(portfolios.map((p) => p.number)).size === portfolios.length, 'portfolio numbers must be unique');

interface HoldingRow {
  portfolioIdx: number;
  securityIdx: number;
  q: number;
  units: number;
  marketValue: number;
  cost: number | null;
}
const holdings: HoldingRow[] = [];
for (let q = 0; q < QUARTER_ENDS.length; q++) {
  for (const p of portfolioOrder) {
    if (!heldAt(p, q)) continue;
    for (const pos of [...p.positions].sort((a, b) => a.securityIdx - b.securityIdx)) {
      holdings.push({
        portfolioIdx: p.idx,
        securityIdx: pos.securityIdx,
        q,
        units: pos.units,
        marketValue: Math.round(pos.units * prices[pos.securityIdx][q]),
        cost: pos.costPerUnit === null ? null : Math.round(pos.units * pos.costPerUnit),
      });
    }
  }
}

fees.sort((a, b) =>
  a.month < b.month ? -1 : a.month > b.month ? 1 : portfolioId.get(a.portfolioIdx)! - portfolioId.get(b.portfolioIdx)! || a.seq - b.seq,
);

/* ------------------------------------------------------- wealth invariants */

const pOf = (f: FeeRow) => portfolios[f.portfolioIdx];
const isRevenue = (f: FeeRow) => f.status === 'SETTLED' || f.status === 'ACCRUED';
const fiscalYearOfFee = (f: FeeRow) => periodOf(f.month).fiscalYear;
const toDollars = (value: number) => Number((value / 100).toFixed(2));

for (const p of portfolios) {
  assert(p.positions.length >= 5, `portfolio ${p.idx}: too few positions`);
  assert(new Set(p.positions.map((x) => x.securityIdx)).size === p.positions.length, `portfolio ${p.idx}: duplicate security`);
  assert(p.closedOn === null || p.closedOn > p.openedOn, `portfolio ${p.idx}: closed before it opened`);
  assert(p.openedOn >= customers[p.customerIdx].joinedOn, `portfolio ${p.idx}: opened before the customer joined`);
  assert(p.openedOn <= '2025-12-31' && firstQuarter(p) >= 0, `portfolio ${p.idx}: no snapshot`);
}
for (const f of fees) {
  assert((f.status === 'ACCRUED') === (f.chargedOn === null), `fee ${f.seq}: ACCRUED iff not yet charged`);
  assert(f.chargedOn === null || f.chargedOn <= WINDOW_END, `fee ${f.seq}: charged after the snapshot date`);
}

// W1 - no fee was charged in August 2025; the months either side were.
const feesChargedIn = (month: string, includeTest: boolean) =>
  fees.filter((f) => f.chargedOn !== null && f.chargedOn.startsWith(month) && (includeTest || real(pOf(f))));
assert(feesChargedIn(EMPTY_MONTH, true).length === 0, 'W1: a fee was charged in August 2025');
for (const month of monthsBetween('2024-02', '2025-12').filter((m) => m !== EMPTY_MONTH)) {
  assert(feesChargedIn(month, false).length > 0, `W1: no fee charged in ${month} besides the planted empty month`);
}

// W2 - exactly two securities share the top count at FY2025 end; the sandbox breaks the tie.
const tieCounts = holderCounts(Q_FY2025_END, false);
const tieCountsWithTest = holderCounts(Q_FY2025_END, true);
{
  const top = Math.max(...tieCounts);
  const atTop = tieCounts.map((c, i) => ({ c, i })).filter((x) => x.c === top).map((x) => x.i).sort((a, b) => a - b);
  assert(atTop.join(',') === [...tiedSecurities].sort((a, b) => a - b).join(','), `W2: tie drifted ${JSON.stringify(tieCounts)}`);
  assert(Math.max(...tieCounts.filter((_, i) => !tiedSecurities.includes(i))) < top, 'W2: a third security reaches the top');
  assert(tieCountsWithTest[tiedSecurities[0]] > tieCountsWithTest[tiedSecurities[1]], 'W2: the sandbox must break the tie');
}

// W3 - every sandbox portfolio is larger than every real one at 2025-12-31.
{
  const realMax = Math.max(...portfolios.filter(real).map((p) => valueAt(p, Q_2025_END)));
  for (const p of portfolios.filter((x) => x.isTest)) {
    assert(valueAt(p, Q_2025_END) > realMax, 'W3: a sandbox portfolio must be the largest');
    assert(!portfolios.some((o) => real(o) && o.customerIdx === p.customerIdx), 'W3: a sandbox owner holds a real portfolio');
  }
}

// W5 - the portfolio's branch and the owner's home branch give different regional totals.
const aumByRegion = (q: number, via: 'portfolio' | 'home') =>
  REGIONS.map((r) => ({
    region: r.name,
    value: portfolios
      .filter((p) => real(p) && regionOf(via === 'portfolio' ? p.branchIdx : customers[p.customerIdx].homeBranchIdx) === r.code)
      .reduce((sum, p) => sum + valueAt(p, q), 0),
  }));
{
  const viaPortfolio = aumByRegion(Q_FY2025_END, 'portfolio');
  const viaHome = aumByRegion(Q_FY2025_END, 'home');
  const differing = viaPortfolio.filter((r, i) => r.value !== viaHome[i].value).length;
  assert(differing >= 2, `W5: the two join paths differ in only ${differing} regions`);
}

// W7 - a fifth or so of positions carry no cost basis.
{
  const atEnd = holdings.filter((h) => h.q === Q_FY2025_END && real(portfolios[h.portfolioIdx]));
  const share = atEnd.filter((h) => h.cost === null).length / atEnd.length;
  assert(share >= 0.12 && share <= 0.35, `W7: ${(share * 100).toFixed(1)}% of positions lack a cost basis`);
}

// W9 - performance fees exist in both fiscal years, so a breakdown by type has four rows.
for (const fy of [2024, 2025]) {
  const n = fees.filter((f) => real(pOf(f)) && f.type === 'PERFORMANCE' && fiscalYearOfFee(f) === fy && isRevenue(f)).length;
  assert(n >= 3, `W9: only ${n} performance fees count as fiscal ${fy} revenue`);
}

// W8 - every fee status is present, and refunds and waivers are not rare noise.
for (const status of ['ACCRUED', 'SETTLED', 'WAIVED', 'REVERSED'] as const) {
  assert(fees.filter((f) => real(pOf(f)) && f.status === status).length >= 10, `W8: too few ${status} fees`);
}

// W12 - the most assets and the most fee revenue name two different clients.
const feeRevenueByClient = (fiscalYear: number, includeTest: boolean) => {
  const totals = new Map<number, number>();
  for (const f of fees) {
    if (!isRevenue(f) || fiscalYearOfFee(f) !== fiscalYear || (!includeTest && !real(pOf(f)))) continue;
    totals.set(pOf(f).customerIdx, (totals.get(pOf(f).customerIdx) ?? 0) + f.amount);
  }
  return [...totals.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0]);
};
{
  const byFees = feeRevenueByClient(2025, false);
  assert(byFees[0][0] !== topAumClient, 'W12: the top fee payer must not be the client with the most assets');
  assert(byFees[2][1] - byFees[3][1] >= 100, 'W12: third and fourth fee payers must not tie');
  const byAum = [...clientValueAt(Q_2025_END, false).entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0]);
  assert(byAum[0][0] === topAumClient, 'W12: the asset leader moved');
}

/* ------------------------------------------------------------------ facts */

const customerName = (idx: number) => customers[idx].fullName;
const securityName = (idx: number) => SECURITIES[idx].name;
const sumFees = (rows: FeeRow[]) => rows.reduce((sum, f) => sum + f.amount, 0);
const aumAt = (q: number, includeTest: boolean) =>
  portfolios.filter((p) => includeTest || real(p)).reduce((sum, p) => sum + valueAt(p, q), 0);
const inFiscalQuarter = (f: FeeRow, fy: number, fq: number) =>
  periodOf(f.month).fiscalYear === fy && periodOf(f.month).fiscalQuarter === fq;
const chargedBetween = (f: FeeRow, from: string, to: string) => f.chargedOn !== null && f.chargedOn >= from && f.chargedOn <= to;

const facts = {
  generator: 'docker/postgres/generate/finance.ts',
  seeds: { banking: SEED, wealth: WEALTH_SEED },
  asOf: WINDOW_END,
  fiscalYear: 'Runs 1 July to 30 June, named by the calendar year it ends in: fiscal 2025 = 2024-07-01..2025-06-30.',
  units: 'Every amount is in US cents unless named *Dollars.',
  banking: {
    B4_branchesOpening12Accounts2024: tieRows.filter((r) => r.real === TIE_COUNT).map((r) => r.name).sort(),
    B5_loanStatusCounts: Object.fromEntries(loanStatusCounts.map((r) => [r.status, r.count])),
    B5_nonPerformingLoans: loans.filter((l) => l.status === 'DELINQUENT' || l.status === 'DEFAULTED').length,
    B7_mostTransactions2025: customerName(activityWinner),
    B7_mostLoanPrincipal: customerName(principalWinner),
    B7_mostDepositBalances: customerName(depositWinner),
    B8_mostCardPurchases2025: customerName(cardWinner),
    B10_testAccounts: TEST_ACCOUNT_COUNT,
    B10_march2025Transactions: {
      excludingTest: marchTxns.filter((t) => !isTestTxn(t)).length,
      includingTest: marchTxns.length,
    },
    B11_accountsOpened2024ByRegion: regionPaths,
  },
  wealth: {
    tables: {
      fiscal_periods: fiscalPeriods.length,
      securities: SECURITIES.length,
      portfolios: portfolios.length,
      holdings: holdings.length,
      fees: fees.length,
    },
    W1_emptyMonth: {
      month: EMPTY_MONTH,
      feesChargedPerMonth2025: monthsBetween('2025-01', '2025-12').map((month) => ({
        month,
        fees: feesChargedIn(month, false).length,
        amountDollars: toDollars(sumFees(feesChargedIn(month, false))),
      })),
    },
    W2_mostHeldSecuritiesFy2025End: {
      asOf: QUARTER_ENDS[Q_FY2025_END],
      tied: tiedSecurities.map(securityName).sort(),
      portfolios: tieCounts[tiedSecurities[0]],
      withTestPortfolios: tiedSecurities.map((i) => ({ security: securityName(i), portfolios: tieCountsWithTest[i] })),
    },
    W3_testPortfolios: {
      count: TEST_PORTFOLIO_COUNT,
      owners: portfolios.filter((p) => p.isTest).map((p) => customerName(p.customerIdx)).sort(),
      aum2025EndDollars: toDollars(portfolios.filter((p) => p.isTest).reduce((sum, p) => sum + valueAt(p, Q_2025_END), 0)),
    },
    W3_portfoliosOpened2024: {
      excludingTest: portfolios.filter((p) => real(p) && p.openedOn.startsWith('2024')).length,
      includingTest: portfolios.filter((p) => p.openedOn.startsWith('2024')).length,
    },
    W3_largestPortfolio2025End: {
      excludingTest: (() => {
        const p = [...portfolios].filter(real).sort((a, b) => valueAt(b, Q_2025_END) - valueAt(a, Q_2025_END))[0];
        return { owner: customerName(p.customerIdx), number: p.number, valueDollars: toDollars(valueAt(p, Q_2025_END)) };
      })(),
    },
    W4_wealthClients2025End: {
      openRealPortfolioOwners: new Set(portfolios.filter((p) => real(p) && p.closedOn === null).map((p) => p.customerIdx)).size,
      anyPortfolioOwners: new Set(portfolios.map((p) => p.customerIdx)).size,
      premierCustomers: customers.filter((c) => c.segment === 'PREMIER').length,
    },
    W5_aumByQuarterEndDollars: QUARTER_ENDS.map((asOf, q) => ({
      asOf,
      excludingTest: toDollars(aumAt(q, false)),
      includingTest: toDollars(aumAt(q, true)),
    })),
    W5_aumByRegionFy2025EndDollars: {
      viaPortfolioBranch: aumByRegion(Q_FY2025_END, 'portfolio').map((r) => ({ region: r.region, dollars: toDollars(r.value) })),
      viaHomeBranch: aumByRegion(Q_FY2025_END, 'home').map((r) => ({ region: r.region, dollars: toDollars(r.value) })),
    },
    W6_constantBaseCurrency: { USD: portfolios.length },
    W7_costBasisFy2025End: (() => {
      const rows = holdings.filter((h) => h.q === Q_FY2025_END && real(portfolios[h.portfolioIdx]));
      const known = rows.filter((h) => h.cost !== null);
      return {
        positions: rows.length,
        withoutCost: rows.length - known.length,
        unrealizedGainDollars: toDollars(known.reduce((sum, h) => sum + h.marketValue - h.cost!, 0)),
        trapSumMinusSumDollars: toDollars(rows.reduce((sum, h) => sum + h.marketValue, 0) - known.reduce((sum, h) => sum + h.cost!, 0)),
      };
    })(),
    W8_feeStatus: {
      refundedChargedIn2025Dollars: toDollars(sumFees(fees.filter((f) => real(pOf(f)) && f.status === 'REVERSED' && chargedBetween(f, '2025-01-01', '2025-12-31')))),
      accruedAt2025EndDollars: toDollars(sumFees(fees.filter((f) => real(pOf(f)) && f.status === 'ACCRUED'))),
      collectedFy2026Q1Dollars: toDollars(sumFees(fees.filter((f) => real(pOf(f)) && f.status === 'SETTLED' && chargedBetween(f, '2025-07-01', '2025-09-30')))),
    },
    W9_feeRevenueFy2025ByTypeDollars: (['ADVISORY', 'CUSTODY', 'PERFORMANCE', 'TRADING'] as const).map((type) => ({
      type,
      dollars: toDollars(sumFees(fees.filter((f) => real(pOf(f)) && isRevenue(f) && f.type === type && fiscalYearOfFee(f) === 2025))),
    })),
    W9_feeRevenueFy2026Q2Dollars: toDollars(sumFees(fees.filter((f) => real(pOf(f)) && isRevenue(f) && inFiscalQuarter(f, 2026, 2)))),
    W10_feeRevenueFy2025ByRegionDollars: REGIONS.map((r) => ({
      region: r.name,
      dollars: toDollars(sumFees(fees.filter((f) => real(pOf(f)) && isRevenue(f) && fiscalYearOfFee(f) === 2025 && regionOf(pOf(f).branchIdx) === r.code))),
    })),
    W12_biggestClient: {
      mostAssets2025End: customerName(topAumClient),
      mostFeeRevenueFy2025: customerName(feeRevenueByClient(2025, false)[0][0]),
      topThreeFeeRevenueFy2025: feeRevenueByClient(2025, false).slice(0, 3).map(([idx, amount]) => ({ client: customerName(idx), dollars: toDollars(amount) })),
    },
  },
};

/* ----------------------------------------------------------------- DDL */

const list = (values: readonly string[]) => values.map((v) => literal(v)).join(', ');

const HEADER = `-- =============================================================================
-- finance -- synthetic fixture for the Questions to Insights eval set
--
-- GENERATED FILE. DO NOT EDIT BY HAND.
-- Edit the generator and regenerate; hand edits are lost on the next run.
--
--   generator : docker/postgres/generate/finance.ts
--   seeds     : ${SEED} (banking), ${WEALTH_SEED} (wealth) -- the output is
--               byte-identical on every run, so hand-verified eval SQL stays valid)
--   regenerate: cd backend && npm run fixtures:finance
--               (= npx ts-node -T -P tsconfig.json ../docker/postgres/generate/finance.ts)
--
-- A fictional US retail bank, "Meridian Trust Bank", with a few EUR and GBP
-- deposit accounts, that also manages investment portfolios for wealth
-- clients. Every customer, account, card, transaction, loan, portfolio,
-- security and fee is invented. Money is stored in MINOR units (cents / euro
-- cents / pence); every wealth amount is in US cents.
--
-- The fiscal year runs from 1 July to 30 June and is named by the calendar
-- year in which it ends: fiscal 2025 is 2024-07-01 to 2025-06-30.
--
-- Transactions and loan payments are booked in calendar 2024 and 2025 only.
-- Accounts and loans may have been opened or originated from 2019, and
-- customers may have joined from 2015, but no transaction history exists
-- before 2024-01-01. Balances and statuses are as of 2025-12-31. No value in
-- this file depends on the date it was generated. Portfolio holdings are
-- quarter-end snapshots from 2024-03-31 to 2025-12-31; wealth fees cover the
-- months January 2024 to December 2025.
-- =============================================================================

BEGIN;

CREATE SCHEMA finance;
SET search_path TO finance, public;

CREATE TABLE regions (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  code text NOT NULL UNIQUE,
  name text NOT NULL UNIQUE
);

CREATE TABLE branches (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  code text NOT NULL UNIQUE,
  name text NOT NULL UNIQUE,
  region_id bigint NOT NULL REFERENCES regions(id),
  city text NOT NULL,
  state_code char(2) NOT NULL,
  opened_on date NOT NULL
);

CREATE TABLE customers (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  customer_number text NOT NULL UNIQUE,
  full_name text NOT NULL UNIQUE,
  date_of_birth date NOT NULL,
  segment text NOT NULL CHECK (segment IN ('RETAIL', 'PREMIER', 'BUSINESS')),
  home_branch_id bigint NOT NULL REFERENCES branches(id),
  joined_on date NOT NULL CHECK (joined_on BETWEEN DATE '${CUSTOMERS_FROM}' AND DATE '${WINDOW_END}')
);

CREATE TABLE account_types (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  code text NOT NULL UNIQUE,
  name text NOT NULL UNIQUE,
  category text NOT NULL CHECK (category IN ('DEPOSIT', 'CREDIT')),
  annual_rate_bps integer NOT NULL CHECK (annual_rate_bps >= 0)
);

CREATE TABLE accounts (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  account_number text NOT NULL UNIQUE,
  customer_id bigint NOT NULL REFERENCES customers(id),
  account_type_id bigint NOT NULL REFERENCES account_types(id),
  branch_id bigint NOT NULL REFERENCES branches(id),
  currency text NOT NULL CHECK (currency IN ('USD', 'EUR', 'GBP')),
  opened_on date NOT NULL CHECK (opened_on BETWEEN DATE '${PRODUCTS_FROM}' AND DATE '${WINDOW_END}'),
  closed_on date,
  status text NOT NULL CHECK (status IN ('ACTIVE', 'DORMANT', 'FROZEN', 'CLOSED')),
  current_balance_minor bigint NOT NULL CHECK (current_balance_minor >= 0),
  is_test boolean NOT NULL DEFAULT false,
  CHECK (closed_on IS NULL OR closed_on BETWEEN opened_on AND DATE '${WINDOW_END}'),
  CHECK ((status = 'CLOSED') = (closed_on IS NOT NULL)),
  CHECK (status <> 'CLOSED' OR current_balance_minor = 0)
);

CREATE TABLE cards (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  card_number_masked text NOT NULL UNIQUE,
  account_id bigint NOT NULL REFERENCES accounts(id),
  network text NOT NULL CHECK (network IN ('VISA', 'MASTERCARD')),
  card_type text NOT NULL CHECK (card_type IN ('DEBIT', 'CREDIT')),
  issued_on date NOT NULL,
  expires_on date NOT NULL,
  status text NOT NULL CHECK (status IN ('ACTIVE', 'BLOCKED', 'EXPIRED', 'CANCELLED')),
  CHECK (expires_on > issued_on)
);

CREATE TABLE fx_rates (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  currency text NOT NULL CHECK (currency IN ('EUR', 'GBP')),
  rate_month date NOT NULL CHECK (EXTRACT(DAY FROM rate_month) = 1),
  usd_per_unit numeric(12,6) NOT NULL CHECK (usd_per_unit > 0),
  UNIQUE (currency, rate_month)
);

CREATE TABLE transactions (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  transaction_ref text NOT NULL UNIQUE,
  account_id bigint NOT NULL REFERENCES accounts(id),
  card_id bigint REFERENCES cards(id),
  booked_on date NOT NULL CHECK (booked_on BETWEEN DATE '${WINDOW_START}' AND DATE '${WINDOW_END}'),
  type text NOT NULL CHECK (type IN (${list(TXN_TYPES)})),
  direction text NOT NULL CHECK (direction IN ('CREDIT', 'DEBIT')),
  channel text NOT NULL CHECK (channel IN (${list(CHANNELS)})),
  status text NOT NULL CHECK (status IN (${list(TXN_STATUSES)})),
  currency text NOT NULL CHECK (currency IN ('USD', 'EUR', 'GBP')),
  amount_minor bigint NOT NULL CHECK (amount_minor > 0),
  amount_usd_minor bigint NOT NULL CHECK (amount_usd_minor > 0),
  merchant_category text CHECK (merchant_category IN (${list(MERCHANT_CATEGORIES.map((m) => m.name))})),
  counterparty_account_id bigint REFERENCES accounts(id),
  CHECK ((direction = 'CREDIT') = (type IN ('DEPOSIT', 'TRANSFER_IN', 'INTEREST'))),
  CHECK ((type = 'CARD_PURCHASE') = (merchant_category IS NOT NULL)),
  CHECK ((type = 'CARD_PURCHASE') = (card_id IS NOT NULL)),
  CHECK ((type = 'CARD_PURCHASE') = (channel = 'CARD')),
  CHECK ((type IN ('FEE', 'INTEREST')) = (channel = 'SYSTEM')),
  CHECK ((type IN ('TRANSFER_IN', 'TRANSFER_OUT')) = (counterparty_account_id IS NOT NULL)),
  CHECK (counterparty_account_id IS NULL OR counterparty_account_id <> account_id),
  CHECK (currency <> 'USD' OR amount_usd_minor = amount_minor)
);

CREATE TABLE loans (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  loan_number text NOT NULL UNIQUE,
  customer_id bigint NOT NULL REFERENCES customers(id),
  branch_id bigint NOT NULL REFERENCES branches(id),
  product text NOT NULL CHECK (product IN ('MORTGAGE', 'AUTO', 'PERSONAL')),
  currency text NOT NULL DEFAULT 'USD' CHECK (currency = 'USD'),
  principal_minor bigint NOT NULL CHECK (principal_minor > 0),
  interest_rate_bps integer NOT NULL CHECK (interest_rate_bps > 0),
  term_months integer NOT NULL CHECK (term_months > 0),
  originated_on date NOT NULL CHECK (originated_on BETWEEN DATE '${PRODUCTS_FROM}' AND DATE '${WINDOW_END}'),
  status text NOT NULL CHECK (status IN ('CURRENT', 'DELINQUENT', 'DEFAULTED', 'PAID_OFF', 'CHARGED_OFF')),
  outstanding_minor bigint NOT NULL CHECK (outstanding_minor >= 0),
  CHECK (outstanding_minor <= principal_minor),
  CHECK (status NOT IN ('PAID_OFF', 'CHARGED_OFF') OR outstanding_minor = 0),
  CHECK (status IN ('PAID_OFF', 'CHARGED_OFF') OR outstanding_minor > 0)
);

CREATE TABLE loan_payments (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  loan_id bigint NOT NULL REFERENCES loans(id) ON DELETE CASCADE,
  paid_on date NOT NULL CHECK (paid_on BETWEEN DATE '${WINDOW_START}' AND DATE '${WINDOW_END}'),
  amount_minor bigint NOT NULL CHECK (amount_minor > 0),
  principal_minor bigint NOT NULL CHECK (principal_minor >= 0),
  interest_minor bigint NOT NULL CHECK (interest_minor >= 0),
  CHECK (principal_minor + interest_minor = amount_minor)
);

CREATE INDEX branches_region_idx ON branches (region_id);
CREATE INDEX customers_home_branch_idx ON customers (home_branch_id);
CREATE INDEX accounts_customer_idx ON accounts (customer_id);
CREATE INDEX accounts_type_idx ON accounts (account_type_id);
CREATE INDEX accounts_branch_idx ON accounts (branch_id);
CREATE INDEX accounts_opened_on_idx ON accounts (opened_on);
CREATE INDEX cards_account_idx ON cards (account_id);
CREATE INDEX transactions_account_idx ON transactions (account_id);
CREATE INDEX transactions_card_idx ON transactions (card_id);
CREATE INDEX transactions_counterparty_idx ON transactions (counterparty_account_id);
CREATE INDEX transactions_booked_on_idx ON transactions (booked_on);
CREATE INDEX transactions_type_idx ON transactions (type);
CREATE INDEX loans_customer_idx ON loans (customer_id);
CREATE INDEX loans_branch_idx ON loans (branch_id);
CREATE INDEX loan_payments_loan_idx ON loan_payments (loan_id);

CREATE TABLE fiscal_periods (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  period_code text NOT NULL UNIQUE,
  fiscal_year integer NOT NULL,
  fiscal_quarter integer NOT NULL CHECK (fiscal_quarter BETWEEN 1 AND 4),
  fiscal_month integer NOT NULL CHECK (fiscal_month BETWEEN 1 AND 12),
  period_start date NOT NULL UNIQUE,
  period_end date NOT NULL,
  UNIQUE (fiscal_year, fiscal_month),
  CHECK (period_end >= period_start)
);

CREATE TABLE securities (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  symbol text NOT NULL UNIQUE,
  name text NOT NULL UNIQUE,
  asset_class text NOT NULL CHECK (asset_class IN ('EQUITY', 'BOND', 'FUND', 'CASH')),
  sector text
);

CREATE TABLE portfolios (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  portfolio_number text NOT NULL UNIQUE,
  customer_id bigint NOT NULL REFERENCES customers(id),
  branch_id bigint NOT NULL REFERENCES branches(id),
  mandate text NOT NULL CHECK (mandate IN ('DISCRETIONARY', 'ADVISORY', 'EXECUTION_ONLY')),
  risk_profile text NOT NULL CHECK (risk_profile IN ('CONSERVATIVE', 'BALANCED', 'GROWTH')),
  base_currency text NOT NULL,
  advisory_fee_bps integer NOT NULL CHECK (advisory_fee_bps >= 0),
  opened_on date NOT NULL,
  closed_on date,
  status text NOT NULL CHECK (status IN ('OPEN', 'CLOSED')),
  is_test boolean NOT NULL DEFAULT false,
  CHECK ((status = 'CLOSED') = (closed_on IS NOT NULL)),
  CHECK (closed_on IS NULL OR closed_on > opened_on)
);

CREATE TABLE holdings (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  portfolio_id bigint NOT NULL REFERENCES portfolios(id),
  security_id bigint NOT NULL REFERENCES securities(id),
  as_of date NOT NULL,
  quantity numeric(18,4) NOT NULL CHECK (quantity > 0),
  market_value_cents bigint NOT NULL CHECK (market_value_cents > 0),
  cost_basis_cents bigint CHECK (cost_basis_cents > 0),
  UNIQUE (portfolio_id, security_id, as_of)
);

CREATE TABLE fees (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  fee_ref text NOT NULL UNIQUE,
  portfolio_id bigint NOT NULL REFERENCES portfolios(id),
  fiscal_period_id bigint NOT NULL REFERENCES fiscal_periods(id),
  fee_type text NOT NULL CHECK (fee_type IN ('ADVISORY', 'CUSTODY', 'PERFORMANCE', 'TRADING')),
  amount_cents bigint NOT NULL CHECK (amount_cents > 0),
  charged_on date CHECK (charged_on BETWEEN DATE '${WINDOW_START}' AND DATE '${WINDOW_END}'),
  status text NOT NULL CHECK (status IN ('ACCRUED', 'SETTLED', 'WAIVED', 'REVERSED')),
  CHECK ((status = 'ACCRUED') = (charged_on IS NULL))
);

CREATE INDEX portfolios_customer_idx ON portfolios (customer_id);
CREATE INDEX portfolios_branch_idx ON portfolios (branch_id);
CREATE INDEX holdings_portfolio_idx ON holdings (portfolio_id);
CREATE INDEX holdings_security_idx ON holdings (security_id);
CREATE INDEX holdings_as_of_idx ON holdings (as_of);
CREATE INDEX fees_portfolio_idx ON fees (portfolio_id);
CREATE INDEX fees_period_idx ON fees (fiscal_period_id);
CREATE INDEX fees_charged_on_idx ON fees (charged_on);
`;

/* -------------------------------------------------------------- the views */

const VIEWS = `CREATE VIEW v_accounts AS
SELECT
  account.id AS account_id,
  account.account_number,
  account.customer_id,
  customer.full_name AS customer_name,
  customer.segment,
  account_type.code AS account_type_code,
  account_type.name AS account_type_name,
  account_type.category AS account_category,
  account.branch_id,
  branch.name AS branch_name,
  region.name AS region_name,
  account.currency,
  account.opened_on,
  account.closed_on,
  account.status,
  account.current_balance_minor,
  account.is_test
FROM accounts account
JOIN customers customer ON customer.id = account.customer_id
JOIN account_types account_type ON account_type.id = account.account_type_id
JOIN branches branch ON branch.id = account.branch_id
JOIN regions region ON region.id = branch.region_id;

CREATE VIEW v_transactions AS
SELECT
  txn.id AS transaction_id,
  txn.transaction_ref,
  txn.booked_on,
  txn.type,
  txn.direction,
  txn.channel,
  txn.status,
  txn.currency,
  txn.amount_minor,
  txn.amount_usd_minor,
  txn.merchant_category,
  txn.card_id,
  txn.counterparty_account_id,
  txn.account_id,
  account.account_number,
  account.currency AS account_currency,
  account_type.code AS account_type_code,
  account_type.name AS account_type_name,
  account_type.category AS account_category,
  account.is_test,
  customer.id AS customer_id,
  customer.full_name AS customer_name,
  customer.segment,
  branch.name AS branch_name,
  region.name AS region_name
FROM transactions txn
JOIN accounts account ON account.id = txn.account_id
JOIN account_types account_type ON account_type.id = account.account_type_id
JOIN customers customer ON customer.id = account.customer_id
JOIN branches branch ON branch.id = account.branch_id
JOIN regions region ON region.id = branch.region_id;

COMMENT ON SCHEMA finance IS
  ${literal('Synthetic eval fixture: a fictional US retail bank with some EUR/GBP deposit accounts and a wealth-management arm. Money is stored in minor units. Transactions cover calendar 2024 and 2025 only.')};
COMMENT ON COLUMN accounts.is_test IS
  ${literal('Synthetic sandbox account used for end-to-end testing. Its cards and transactions are excluded from reported figures by default.')};
COMMENT ON COLUMN transactions.amount_usd_minor IS
  ${literal('amount_minor converted to US cents at the fx_rates rate of the booking month; equal to amount_minor on USD accounts.')};
COMMENT ON COLUMN transactions.direction IS
  ${literal('CREDIT adds money to the account, DEBIT takes it out. amount_minor is always positive; direction carries the sign.')};
COMMENT ON COLUMN account_types.category IS
  ${literal('DEPOSIT accounts hold customer money; CREDIT accounts (cards, lines of credit) carry a balance the customer owes.')};
COMMENT ON VIEW v_transactions IS
  ${literal('One row per transaction. branch/region are the ACCOUNT branch, not the customer home branch.')};
COMMENT ON TABLE fiscal_periods IS
  ${literal('One row per fiscal month. The fiscal year runs from 1 July to 30 June and is named by the calendar year it ends in.')};
COMMENT ON COLUMN portfolios.is_test IS
  ${literal('Synthetic sandbox portfolio used for end-to-end testing. Its holdings and fees are excluded from reported figures by default.')};
COMMENT ON COLUMN portfolios.branch_id IS
  ${literal('The branch that books and services the portfolio; it can differ from the customer home branch.')};
COMMENT ON TABLE holdings IS
  ${literal('One row per position at each quarter-end (as_of): a point-in-time balance.')};
COMMENT ON COLUMN holdings.cost_basis_cents IS
  ${literal('What the client paid for the position, in US cents. NULL for positions transferred in from another firm.')};
COMMENT ON COLUMN fees.fiscal_period_id IS
  ${literal('The fiscal month the fee covers, which is not always the month it was charged.')};
COMMENT ON COLUMN fees.charged_on IS
  ${literal('The day the fee was charged to the client. NULL while the fee is accrued and not yet billed.')};

COMMIT;
`;

/* ------------------------------------------------------------ INSERT rows */

const regionIdByCode = new Map(REGIONS.map((r, i) => [r.code, i + 1]));
const customerId = (idx: number) => idx + 1;
const branchId = (idx: number) => idx + 1;

const blocks: string[] = [
  HEADER,
  section('regions'),
  insertRows('regions', ['code', 'name'], REGIONS.map((r) => [r.code, r.name])),
  section('branches'),
  insertRows(
    'branches',
    ['code', 'name', 'region_id', 'city', 'state_code', 'opened_on'],
    BRANCHES.map((b) => [b.code, b.name, regionIdByCode.get(b.region)!, b.city, b.state, b.openedOn]),
  ),
  section('customers'),
  insertRows(
    'customers',
    ['customer_number', 'full_name', 'date_of_birth', 'segment', 'home_branch_id', 'joined_on'],
    customers.map((c) => [c.customerNumber, c.fullName, c.dateOfBirth, c.segment, branchId(c.homeBranchIdx), c.joinedOn]),
  ),
  section('account_types'),
  insertRows(
    'account_types',
    ['code', 'name', 'category', 'annual_rate_bps'],
    ACCOUNT_TYPES.map((t) => [t.code, t.name, t.category, t.rateBps]),
  ),
  section('accounts'),
  insertRows(
    'accounts',
    ['account_number', 'customer_id', 'account_type_id', 'branch_id', 'currency', 'opened_on', 'closed_on', 'status', 'current_balance_minor', 'is_test'],
    accountOrder.map((a) => [
      a.accountNumber,
      customerId(a.customerIdx),
      TYPE_BY_CODE.get(a.typeCode)!.id,
      branchId(a.branchIdx),
      a.currency,
      a.openedOn,
      a.closedOn,
      a.status,
      a.balance,
      a.isTest,
    ]),
  ),
  section('cards'),
  insertRows(
    'cards',
    ['card_number_masked', 'account_id', 'network', 'card_type', 'issued_on', 'expires_on', 'status'],
    cardOrder.map(({ c }) => [c.masked, accountId.get(c.accountIdx)!, c.network, c.cardType, c.issuedOn, c.expiresOn, c.status]),
  ),
  section('fx_rates'),
  insertRows(
    'fx_rates',
    ['currency', 'rate_month', 'usd_per_unit'],
    fxRates.map((r) => [r.currency, r.rateMonth, Number((r.micro / 1e6).toFixed(6))]),
  ),
  section('transactions'),
  insertRows(
    'transactions',
    ['transaction_ref', 'account_id', 'card_id', 'booked_on', 'type', 'direction', 'channel', 'status', 'currency', 'amount_minor', 'amount_usd_minor', 'merchant_category', 'counterparty_account_id'],
    txns.map((t, i) => [
      `TXN-${t.bookedOn.slice(0, 4)}${t.bookedOn.slice(5, 7)}-${pad(i + 1, 6)}`,
      accountId.get(t.accountIdx)!,
      t.cardIdx === null ? null : cardId.get(t.cardIdx)!,
      t.bookedOn,
      t.type,
      CREDIT_TYPES.includes(t.type) ? 'CREDIT' : 'DEBIT',
      t.channel,
      t.status,
      acct(t).currency,
      t.amount,
      usdOf(t),
      t.merchantCategory,
      t.counterpartyIdx === null ? null : accountId.get(t.counterpartyIdx)!,
    ]),
  ),
  section('loans'),
  insertRows(
    'loans',
    ['loan_number', 'customer_id', 'branch_id', 'product', 'currency', 'principal_minor', 'interest_rate_bps', 'term_months', 'originated_on', 'status', 'outstanding_minor'],
    loanOrder.map((l, i) => [
      `LN-${l.originatedOn.slice(0, 4)}-${pad(i + 1, 5)}`,
      customerId(l.customerIdx),
      branchId(l.branchIdx),
      l.product,
      'USD',
      l.principal,
      l.rateBps,
      l.termMonths,
      l.originatedOn,
      l.status,
      l.outstanding,
    ]),
  ),
  section('loan_payments'),
  insertRows(
    'loan_payments',
    ['loan_id', 'paid_on', 'amount_minor', 'principal_minor', 'interest_minor'],
    payments.map((p) => [loanId.get(p.loanIdx)!, p.paidOn, p.amount, p.principal, p.interest]),
  ),
  section('fiscal_periods'),
  insertRows(
    'fiscal_periods',
    ['period_code', 'fiscal_year', 'fiscal_quarter', 'fiscal_month', 'period_start', 'period_end'],
    fiscalPeriods.map((fp) => [fp.code, fp.fiscalYear, fp.fiscalQuarter, fp.fiscalMonth, fp.start, fp.end]),
  ),
  section('securities'),
  insertRows(
    'securities',
    ['symbol', 'name', 'asset_class', 'sector'],
    SECURITIES.map((sec) => [sec.symbol, sec.name, sec.assetClass, sec.sector]),
  ),
  section('portfolios'),
  insertRows(
    'portfolios',
    ['portfolio_number', 'customer_id', 'branch_id', 'mandate', 'risk_profile', 'base_currency', 'advisory_fee_bps', 'opened_on', 'closed_on', 'status', 'is_test'],
    portfolioOrder.map((pf) => [
      pf.number,
      customerId(pf.customerIdx),
      branchId(pf.branchIdx),
      pf.mandate,
      pf.risk,
      'USD',
      pf.feeBps,
      pf.openedOn,
      pf.closedOn,
      pf.closedOn === null ? 'OPEN' : 'CLOSED',
      pf.isTest,
    ]),
  ),
  section('holdings'),
  insertRows(
    'holdings',
    ['portfolio_id', 'security_id', 'as_of', 'quantity', 'market_value_cents', 'cost_basis_cents'],
    holdings.map((h) => [portfolioId.get(h.portfolioIdx)!, h.securityIdx + 1, QUARTER_ENDS[h.q], h.units, h.marketValue, h.cost]),
  ),
  section('fees'),
  insertRows(
    'fees',
    ['fee_ref', 'portfolio_id', 'fiscal_period_id', 'fee_type', 'amount_cents', 'charged_on', 'status'],
    fees.map((f, i) => [
      `WF-${f.month.replace('-', '')}-${pad(i + 1, 5)}`,
      portfolioId.get(f.portfolioIdx)!,
      periodOf(f.month).id,
      f.type,
      f.amount,
      f.chargedOn,
      f.status,
    ]),
  ),
  section('analytics views'),
  VIEWS,
];

writeFileSync(OUTPUT_PATH, `${blocks.join('\n\n')}`, 'utf8');
mkdirSync(join(FACTS_PATH, '..'), { recursive: true });
writeFileSync(FACTS_PATH, `${JSON.stringify(facts, null, 2)}\n`, 'utf8');

/* -------------------------------------------------------------- stdout */

const counts: [string, number][] = [
  ['regions', REGIONS.length],
  ['branches', BRANCHES.length],
  ['customers', customers.length],
  ['account_types', ACCOUNT_TYPES.length],
  ['accounts', accounts.length],
  ['cards', cards.length],
  ['fx_rates', fxRates.length],
  ['transactions', txns.length],
  ['loans', loans.length],
  ['loan_payments', payments.length],
  ['fiscal_periods', fiscalPeriods.length],
  ['securities', SECURITIES.length],
  ['portfolios', portfolios.length],
  ['holdings', holdings.length],
  ['fees', fees.length],
];

console.log(`finance fixture written to ${OUTPUT_PATH} (seeds ${SEED}, ${WEALTH_SEED})`);
console.log(`planted facts written to ${FACTS_PATH}`);
for (const [table, count] of counts) {
  console.log(`  ${table.padEnd(16)} ${String(count).padStart(6)}`);
}

const nameOf = (idx: number) => customers[idx].fullName;
const dollars = (minor: number) => (minor / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

console.log('\n  planted answers');
console.log(`    B4 tie (${TIE_COUNT} accounts opened in 2024): ${tieRows.filter((r) => r.real === TIE_COUNT).map((r) => r.name).join(', ')}`);
console.log(`       2024 openings by branch (non-test / all): ${tieRows.map((r) => `${r.name} ${r.real}/${r.all}`).join(', ')}`);
{
  const counts2025 = txnCounts2025(TXN_STATUSES, false);
  const principal = principalTotals();
  const deposits = depositTotals(false);
  const runnerUp = (values: number[], winner: number) => Math.max(...values.filter((_, i) => i !== winner));
  console.log(`    B7 most 2025 transactions : ${nameOf(activityWinner)} (${counts2025[activityWinner]}; runner-up ${runnerUp(counts2025, activityWinner)})`);
  console.log(`    B7 most loan principal     : ${nameOf(principalWinner)} ($${dollars(principal[principalWinner])}; runner-up $${dollars(runnerUp(principal, principalWinner))})`);
  console.log(`    B7 most deposits (USD, Dec-2025 rate): ${nameOf(depositWinner)} ($${dollars(deposits[depositWinner])}; runner-up $${dollars(runnerUp(deposits, depositWinner))})`);
  const posted = cardCounts(['POSTED'], false);
  const allCard = cardCounts(TXN_STATUSES, false);
  console.log(`    B8 most 2025 POSTED card purchases: ${nameOf(cardWinner)} (${posted[cardWinner]} posted, ${allCard[cardWinner]} all statuses; runner-up ${runnerUp(posted, cardWinner)} / ${runnerUp(allCard, cardWinner)})`);
}
console.log(`    B10 March 2025: ${marchTxns.length} transactions, ${marchTxns.filter((t) => !isTestTxn(t)).length} excluding test accounts`);
console.log(`    B10 test accounts: ${TEST_ACCOUNT_COUNT} / ${accounts.length}, ${txns.filter(isTestTxn).length} test transactions`);
console.log(`    B3 merchant_category non-null: ${txns.filter((t) => t.merchantCategory !== null).length} / ${txns.length}`);
console.log(`    B5 loan statuses: ${loanStatusCounts.map((r) => `${r.status} ${r.count}`).join(', ')}`);
console.log(`    transaction status mix: ${statusMix.map((r) => `${r.status} ${r.count}`).join(', ')}`);
console.log('    B1 loan ratios by product (interest/amount, outstanding/principal)');
for (const row of productRatios()) {
  console.log(`      ${row.product.padEnd(10)} ${row.interestShare.toFixed(4)}  ${row.outstandingShare.toFixed(4)}`);
}
console.log('    B9 2025 per branch (net flow excl. transfers, transfer net), USD minor');
for (const [i, f] of branchFlows().entries()) {
  console.log(`      ${BRANCHES[i].name.padEnd(24)} ${String(f.flow).padStart(12)} ${String(f.transfers).padStart(10)}`);
}
console.log('    B11 2024 openings by region (account branch vs home branch)');
for (const r of regionPaths) {
  console.log(`      ${r.region.padEnd(10)} ${r.viaAccountBranch} vs ${r.viaHomeBranch}`);
}
for (const currency of ['EUR', 'GBP'] as const) {
  const rates = fxRates.filter((r) => r.currency === currency).map((r) => r.micro / 1e6);
  const deposits2025 = txns.filter(
    (t) => acct(t).currency === currency && t.type === 'DEPOSIT' && t.status === 'POSTED' && in2025(t) && !isTestTxn(t),
  ).length;
  console.log(
    `    B14 ${currency} usd_per_unit ${Math.min(...rates).toFixed(6)}..${Math.max(...rates).toFixed(6)}, ` +
      `Dec 2025 ${(fxMicro.get(`${currency}|2025-12`)! / 1e6).toFixed(6)}; ${deposits2025} POSTED 2025 deposits`,
  );
}
{
  const loanCustomers = new Set(loans.map((l) => l.customerIdx));
  const foreign = [...loanCustomers].filter((i) => holdsForeign(i, 'EUR') || holdsForeign(i, 'GBP')).length;
  console.log(`    B2 loans: all ${loans.length} USD; ${foreign} loan customers also hold a EUR/GBP account`);
  console.log(
    `    B6 accounts opened before 2024: ${accounts.filter((a) => a.openedOn < WINDOW_START).length}; ` +
      `opened in 2021: ${accounts.filter((a) => a.openedOn.startsWith('2021')).length}; ` +
      `loans originated in 2021: ${loans.filter((l) => l.originatedOn.startsWith('2021')).length}`,
  );
  const dec = txns.filter((t) => !isTestTxn(t) && t.type === 'CARD_PURCHASE' && t.bookedOn >= DEC_2025_START);
  console.log(
    `    B15 Dec 2025 card purchases (real accounts): ${TXN_STATUSES.map((s) => `${s} ${dec.filter((t) => t.status === s).length}`).join(', ')}`,
  );
  const credit = BRANCHES.map((b, i) => `${b.name} ${accounts.filter((a) => a.branchIdx === i && !a.isTest && !isDepositType(a.typeCode)).length}`);
  console.log(`    B13 real credit accounts per branch: ${credit.join(', ')}`);
  console.log(`    test-account owners: ${[...testOwners].map(nameOf).join(', ')}`);
}
