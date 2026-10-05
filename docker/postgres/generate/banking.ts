/**
 * Generator for the `banking` synthetic eval fixture.
 *
 * Writes `docker/postgres/init/007_banking.sql` from one hard-coded seed, so
 * the output is byte-identical on every run and every hand-verified
 * `expectedSql` in the eval set stays valid. Every random draw comes from the
 * single `Rng` below — never `Math.random()`, never `Date.now()`.
 *
 * Run with (identical to the `fixtures:banking` npm script):
 *
 *   cd backend && npx ts-node -T -P tsconfig.json ../docker/postgres/generate/banking.ts
 *
 * The domain is a fictional US retail bank, "Meridian Trust Bank", with a few
 * EUR and GBP deposit accounts. The traps B1-B15 in
 * `docs/evals/synthetic-domains.md` (Domain 4 — `banking`) are planted here.
 * The ones that must hold exactly — the 12/12 branch tie, the three distinct
 * "most valuable customer" answers, the 14 test-account transactions in March
 * 2025, the exact FX conversion, the paired transfer legs — are enforced by
 * deterministic post-generation adjustment and then asserted: this script
 * throws rather than emit a fixture with a broken trap.
 */

import { writeFileSync } from 'fs';
import { join } from 'path';
import { Rng, literal, insertRows, section } from './lib/rng';

/* ------------------------------------------------------------------ knobs */

/** The one knob. Change it and every hand-verified answer must be re-checked. */
const SEED = 20260929;
const OUTPUT_PATH = join(__dirname, '..', 'init', '007_banking.sql');

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

/* ----------------------------------------------------------------- DDL */

const list = (values: readonly string[]) => values.map((v) => literal(v)).join(', ');

const HEADER = `-- =============================================================================
-- banking -- synthetic fixture for the Questions to Insights eval set
--
-- GENERATED FILE. DO NOT EDIT BY HAND.
-- Edit the generator and regenerate; hand edits are lost on the next run.
--
--   generator : docker/postgres/generate/banking.ts
--   seed      : ${SEED}   (single hard-coded constant -- the output is
--               byte-identical on every run, so hand-verified eval SQL stays valid)
--   regenerate: cd backend && npm run fixtures:banking
--               (= npx ts-node -T -P tsconfig.json ../docker/postgres/generate/banking.ts)
--
-- A fictional US retail bank, "Meridian Trust Bank", with a few EUR and GBP
-- deposit accounts. Every customer, account, card, transaction and loan is
-- invented. Money is stored in MINOR units (cents / euro cents / pence).
--
-- Transactions and loan payments are booked in calendar 2024 and 2025 only.
-- Accounts and loans may have been opened or originated from 2019, and
-- customers may have joined from 2015, but no transaction history exists
-- before 2024-01-01. Balances and statuses are as of 2025-12-31. No value in
-- this file depends on the date it was generated.
-- =============================================================================

BEGIN;

CREATE SCHEMA banking;
SET search_path TO banking, public;

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

COMMENT ON SCHEMA banking IS
  ${literal('Synthetic eval fixture: a fictional US retail bank with some EUR/GBP deposit accounts. Money is stored in minor units. Transactions cover calendar 2024 and 2025 only.')};
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
  section('analytics views'),
  VIEWS,
];

writeFileSync(OUTPUT_PATH, `${blocks.join('\n\n')}`, 'utf8');

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
];

console.log(`banking fixture written to ${OUTPUT_PATH} (seed ${SEED})`);
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
