/**
 * Generator for the `marketing_analytics` synthetic eval fixture (BA-185).
 *
 * Writes `backend/src/modules/testing-data/fixtures/007_marketing_analytics.sql`,
 * the Testing Data seed, and `backend/scripts/fixtures/marketing-analytics/facts.json`,
 * the planted truths, from one hard-coded seed. The output is byte-identical
 * on every run, so every hand-verified `expectedSql` in
 * `backend/src/mastra/evals/sets/marketing-analytics.json` stays valid. Every
 * random draw comes from the single `Rng` below: never `Math.random()`, never
 * `Date.now()`.
 *
 * The domain is a fictional market-insight product for personal-lines
 * insurance carriers: six carriers report their policy sales by quarter, the
 * product computes revenue by period and a market benchmark in which each
 * subscriber sees its competitors only as masked labels ("Competitor A"), and
 * three carriers also load their own marketing campaigns. The persona is an
 * analyst at Harborline Mutual. Brief, glossary and trap plan:
 * `docs/evals/domains/marketing-analytics.md`; business rules, including the
 * governance rule: `docs/evals/domains/marketing-analytics-policy.md`.
 *
 * Run with (the `fixtures:marketing-analytics` npm script runs the same):
 *
 *   cd backend && npx ts-node -T -P tsconfig.json ../docker/postgres/generate/marketing-analytics.ts
 *
 * The traps M1-M14 of the brief are planted here. The ones that must hold
 * exactly (the tie at the top, the test rows that flip a ranking, the empty
 * quarter, the competitor that grew fastest, the rankings whose plausible
 * wrong query must name a different winner) are enforced by deterministic
 * adjustment and then asserted: this script throws rather than emit a fixture
 * with a broken trap.
 */

import { mkdirSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { Rng, insertRows, section } from './lib/rng';

/* ------------------------------------------------------------------ knobs */

const SEED = 20261013;
const SCHEMA = 'marketing_analytics';
/** The constant column (M3): every sale is booked in US dollars. */
const CURRENCY = 'USD';
const SQL_PATH = join(
  __dirname,
  '..', '..', '..',
  'backend', 'src', 'modules', 'testing-data', 'fixtures',
  '007_marketing_analytics.sql',
);
const FACTS_PATH = join(
  __dirname,
  '..', '..', '..',
  'backend', 'scripts', 'fixtures', 'marketing-analytics', 'facts.json',
);

/** The persona's carrier: every "our" question is asked from here. */
const PERSONA_CARRIER = 'HBM';
/** The quarter Harborline paused every campaign (M7, the empty period). */
const FREEZE_PERIOD = '2024-Q3';
/** Harborline's sales dip in the freeze quarter (the reasoning question). */
const FREEZE_SALES_FACTOR = 0.86;
/** The competitor planted as the fastest grower in auto, 2025-Q1 to Q2. */
const GROWTH_CARRIER = 'TWG';
const GROWTH_FACTOR = 1.24;
/** The quarter whose test rows flip the top channel (M2). */
const TEST_PERIOD = '2025-Q2';
/** The quarter and line of the tie at the top (M6). */
const TIE_PERIOD = '2025-Q4';
const TIE_LINE = 'AUTO';

const rng = new Rng(SEED);

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(`marketing-analytics generator: ${message}`);
}

/* ------------------------------------------------------- reference tables */

const REGIONS = [
  { code: 'NE', name: 'Northeast' },
  { code: 'SE', name: 'Southeast' },
  { code: 'MW', name: 'Midwest' },
  { code: 'WE', name: 'West' },
] as const;

const STATES = [
  { code: 'NY', name: 'New York', region: 'NE', weight: 1.3 },
  { code: 'MA', name: 'Massachusetts', region: 'NE', weight: 0.9 },
  { code: 'PA', name: 'Pennsylvania', region: 'NE', weight: 1.0 },
  { code: 'FL', name: 'Florida', region: 'SE', weight: 1.25 },
  { code: 'GA', name: 'Georgia', region: 'SE', weight: 0.85 },
  { code: 'NC', name: 'North Carolina', region: 'SE', weight: 0.9 },
  { code: 'IL', name: 'Illinois', region: 'MW', weight: 1.0 },
  { code: 'OH', name: 'Ohio', region: 'MW', weight: 0.95 },
  { code: 'MI', name: 'Michigan', region: 'MW', weight: 0.8 },
  { code: 'CA', name: 'California', region: 'WE', weight: 1.45 },
  { code: 'WA', name: 'Washington', region: 'WE', weight: 0.8 },
  { code: 'AZ', name: 'Arizona', region: 'WE', weight: 0.75 },
] as const;
const ALL_STATES = STATES.map((s) => s.code);

const LINES = [
  { code: 'AUTO', name: 'Personal auto', family: 'Property & casualty', policies: 210, premium: 1450, fee: 18 },
  { code: 'HOME', name: 'Homeowners', family: 'Property & casualty', policies: 110, premium: 1820, fee: 12 },
  { code: 'RENT', name: 'Renters', family: 'Property & casualty', policies: 95, premium: 215, fee: 5 },
  { code: 'LIFE', name: 'Term life', family: 'Life', policies: 38, premium: 640, fee: 0 },
  { code: 'PET', name: 'Pet health', family: 'Specialty', policies: 34, premium: 530, fee: 8 },
] as const;
type LineCode = (typeof LINES)[number]['code'];

/**
 * `ntu` is the share of a channel's bound policies that are not taken up
 * (M5, the walk-away rate): highest on the app, but the web sells far more,
 * so the web has the most walk-aways by count.
 */
const CHANNELS = [
  { code: 'AGT', name: 'Independent agents', digital: false, weight: 1.0, ntu: 0.03 },
  { code: 'WEB', name: 'Direct online', digital: true, weight: 0.75, ntu: 0.065 },
  { code: 'APP', name: 'Mobile app', digital: true, weight: 0.5, ntu: 0.11 },
  { code: 'TEL', name: 'Call center', digital: false, weight: 0.36, ntu: 0.05 },
] as const;
type ChannelCode = (typeof CHANNELS)[number]['code'];

interface CarrierDef {
  code: string;
  name: string;
  segment: 'NATIONAL' | 'REGIONAL' | 'MUTUAL';
  hq: string;
  subscribedOn: string;
  scale: number;
  price: number;
  growth: number;
  states: readonly string[];
  lines: readonly LineCode[];
  channels: readonly ChannelCode[];
}

const CARRIERS: readonly CarrierDef[] = [
  {
    code: 'HBM', name: 'Harborline Mutual', segment: 'MUTUAL', hq: 'MA', subscribedOn: '2021-04-01',
    scale: 1.0, price: 1.0, growth: 0.02,
    states: ['NY', 'MA', 'PA', 'FL', 'NC', 'IL', 'OH', 'CA'],
    lines: ['AUTO', 'HOME', 'RENT', 'LIFE', 'PET'],
    channels: ['AGT', 'WEB', 'APP', 'TEL'],
  },
  {
    code: 'CRV', name: 'Crestview Insurance', segment: 'NATIONAL', hq: 'IL', subscribedOn: '2020-09-15',
    scale: 1.5, price: 0.97, growth: 0.01,
    states: ALL_STATES,
    lines: ['AUTO', 'HOME', 'RENT', 'LIFE', 'PET'],
    channels: ['AGT', 'WEB', 'APP', 'TEL'],
  },
  {
    code: 'NGA', name: 'Northgate Assurance', segment: 'NATIONAL', hq: 'NY', subscribedOn: '2020-01-06',
    scale: 1.3, price: 1.05, growth: 0.005,
    states: ALL_STATES,
    lines: ['AUTO', 'HOME', 'RENT', 'LIFE'],
    channels: ['AGT', 'WEB', 'TEL'],
  },
  {
    code: 'BFG', name: 'Bluefield General', segment: 'REGIONAL', hq: 'GA', subscribedOn: '2022-02-01',
    scale: 0.8, price: 0.93, growth: 0.015,
    states: ['FL', 'GA', 'NC', 'OH', 'MI'],
    lines: ['AUTO', 'HOME', 'RENT'],
    channels: ['AGT', 'TEL'],
  },
  {
    code: 'PCC', name: 'Pinecrest Casualty', segment: 'REGIONAL', hq: 'WA', subscribedOn: '2022-07-11',
    scale: 0.7, price: 1.02, growth: 0.03,
    states: ['CA', 'WA', 'AZ', 'IL'],
    lines: ['AUTO', 'RENT', 'PET'],
    channels: ['WEB', 'APP'],
  },
  {
    code: 'TWG', name: 'Tidewater Insurance Group', segment: 'NATIONAL', hq: 'FL', subscribedOn: '2021-01-04',
    scale: 1.2, price: 1.0, growth: 0.012,
    states: ALL_STATES,
    lines: ['AUTO', 'HOME', 'RENT', 'LIFE'],
    channels: ['AGT', 'WEB', 'APP', 'TEL'],
  },
];

/** Product names never contain a carrier name (the governance check reads names). */
const PRODUCT_NAMES: Readonly<Record<string, Partial<Record<LineCode, string>>>> = {
  HBM: { AUTO: 'Anchor Auto', HOME: 'Anchor Home', RENT: 'First Key Renters', LIFE: 'Steady Term 20', PET: 'Paws Plus' },
  CRV: { AUTO: 'DriveWell Select', HOME: 'HomeWise Classic', RENT: 'RentReady', LIFE: 'LifeLine Term', PET: 'Happy Tails' },
  NGA: { AUTO: 'RoadMaster Auto', HOME: 'Keystone Home', RENT: 'Studio Cover', LIFE: 'Legacy Term' },
  BFG: { AUTO: 'Southern Drive', HOME: 'Porch & Roof', RENT: 'Lease Shield' },
  PCC: { AUTO: 'Evergreen Auto', RENT: 'Cascade Renters', PET: 'Trail Buddy' },
  TWG: { AUTO: 'Coastal Auto Plus', HOME: 'Shoreline Home', RENT: 'Seaside Renters', LIFE: 'Lighthouse Term' },
};
/** Harborline launched pet health on 2024-05-13, so it has no pet sales in 2024-Q1. */
const LAUNCHES: Readonly<Record<string, string>> = { 'HBM:PET': '2024-05-13' };

interface PeriodDef {
  code: string;
  year: number;
  quarter: number;
  fiscalYear: number;
  fiscalQuarter: number;
  startsOn: string;
  endsOn: string;
  status: 'FINAL' | 'PRELIMINARY' | 'NOT_REPORTED';
}

/**
 * Calendar quarters 2024-Q1 to 2026-Q1. The fiscal year starts on 1 July and
 * is named for the calendar year it ends in (FY2025 = July 2024 to June 2025).
 * 2025-Q4 is preliminary; 2026-Q1 is listed but not reported, so no table
 * holds a row for it.
 */
const PERIODS: readonly PeriodDef[] = (() => {
  const bounds = [
    ['01-01', '03-31'],
    ['04-01', '06-30'],
    ['07-01', '09-30'],
    ['10-01', '12-31'],
  ];
  const list: PeriodDef[] = [];
  for (const [year, quarter] of [
    [2024, 1], [2024, 2], [2024, 3], [2024, 4],
    [2025, 1], [2025, 2], [2025, 3], [2025, 4],
    [2026, 1],
  ] as const) {
    const fiscalYear = quarter >= 3 ? year + 1 : year;
    const fiscalQuarter = quarter >= 3 ? quarter - 2 : quarter + 2;
    const code = `${year}-Q${quarter}`;
    list.push({
      code,
      year,
      quarter,
      fiscalYear,
      fiscalQuarter,
      startsOn: `${year}-${bounds[quarter - 1][0]}`,
      endsOn: `${year}-${bounds[quarter - 1][1]}`,
      status: code === '2026-Q1' ? 'NOT_REPORTED' : code === '2025-Q4' ? 'PRELIMINARY' : 'FINAL',
    });
  }
  return list;
})();
const DATA_PERIODS = PERIODS.filter((p) => p.status !== 'NOT_REPORTED');

const SEASON: Readonly<Record<number, number>> = { 1: 0.92, 2: 1.06, 3: 1.04, 4: 0.98 };

/* ------------------------------------------------------------- id lookups */

const regionId = (code: string) => REGIONS.findIndex((r) => r.code === code) + 1;
const stateId = (code: string) => STATES.findIndex((s) => s.code === code) + 1;
const carrierId = (code: string) => CARRIERS.findIndex((c) => c.code === code) + 1;
const lineId = (code: string) => LINES.findIndex((l) => l.code === code) + 1;
const channelId = (code: string) => CHANNELS.findIndex((c) => c.code === code) + 1;
const periodId = (code: string) => PERIODS.findIndex((p) => p.code === code) + 1;
const periodIndex = (code: string) => DATA_PERIODS.findIndex((p) => p.code === code);

const carrierByCode = (code: string) => CARRIERS[carrierId(code) - 1];
const channelByCode = (code: string) => CHANNELS[channelId(code) - 1];
const lineByCode = (code: string) => LINES[lineId(code) - 1];
const stateByCode = (code: string) => STATES[stateId(code) - 1];

/* --------------------------------------------------------------- products */

interface ProductRow {
  code: string;
  name: string;
  carrier: string;
  line: LineCode;
  launchedOn: string;
}

const products: ProductRow[] = [];
for (const carrier of CARRIERS) {
  for (const line of carrier.lines) {
    const name = PRODUCT_NAMES[carrier.code][line];
    assert(name !== undefined, `no product name for ${carrier.code} ${line}`);
    products.push({
      code: `${carrier.code}-${line}-01`,
      name,
      carrier: carrier.code,
      line,
      launchedOn:
        LAUNCHES[`${carrier.code}:${line}`] ??
        rng.dateBetween('2016-01-01', '2021-12-31'),
    });
  }
}
const productId = (carrier: string, line: string) =>
  products.findIndex((p) => p.carrier === carrier && p.line === line) + 1;

/* ------------------------------------------------------------ policy sales */

type SaleStatus = 'BOUND' | 'NTU' | 'PENDING';

interface SaleRow {
  carrier: string;
  line: LineCode;
  channel: ChannelCode;
  state: string;
  period: string;
  status: SaleStatus;
  policies: number;
  premiumCents: number;
  isTest: boolean;
}

const sales: SaleRow[] = [];

for (const carrier of CARRIERS) {
  for (const line of carrier.lines) {
    const lineDef = lineByCode(line);
    const product = products[productId(carrier.code, line) - 1];
    for (const state of carrier.states) {
      for (const channel of carrier.channels) {
        const channelDef = channelByCode(channel);
        for (const period of DATA_PERIODS) {
          if (period.endsOn < product.launchedOn) continue;
          if (rng.chance(0.05)) continue;
          const i = periodIndex(period.code);
          let factor =
            carrier.scale *
            channelDef.weight *
            stateByCode(state).weight *
            SEASON[period.quarter] *
            (1 + carrier.growth * i) *
            (line === 'PET' ? 1 + 0.06 * i : 1);
          if (carrier.code === PERSONA_CARRIER && period.code === FREEZE_PERIOD) {
            factor *= FREEZE_SALES_FACTOR;
          }
          if (carrier.code === GROWTH_CARRIER && line === 'AUTO' && period.code === '2025-Q2') {
            factor *= GROWTH_FACTOR;
          }
          // Harborline sells digitally far more in the West, and less in the
          // Northeast (M12: digital share by region).
          if (carrier.code === PERSONA_CARRIER && channelDef.digital) {
            const region = stateByCode(state).region;
            if (region === 'WE') factor *= 1.35;
            if (region === 'NE') factor *= 0.85;
          }
          const policies = Math.round(lineDef.policies * factor * rng.float(0.85, 1.15, 4));
          if (policies < 1) continue;
          const perPolicy = lineDef.premium * carrier.price * rng.float(0.94, 1.06, 4);
          sales.push({
            carrier: carrier.code,
            line,
            channel,
            state,
            period: period.code,
            status: 'BOUND',
            policies,
            premiumCents: Math.round(policies * perPolicy * 100),
            isTest: false,
          });
          if (rng.chance(0.75)) {
            const ntu = Math.max(1, Math.round(policies * channelDef.ntu * rng.float(0.6, 1.4, 4)));
            sales.push({
              carrier: carrier.code,
              line,
              channel,
              state,
              period: period.code,
              status: 'NTU',
              policies: ntu,
              premiumCents: Math.round(ntu * perPolicy * rng.float(0.97, 1.03, 4) * 100),
              isTest: false,
            });
          }
          if (period.status === 'PRELIMINARY' && rng.chance(0.6)) {
            const pending = Math.max(1, Math.round(policies * 0.05 * rng.float(0.6, 1.4, 4)));
            sales.push({
              carrier: carrier.code,
              line,
              channel,
              state,
              period: period.code,
              status: 'PENDING',
              policies: pending,
              premiumCents: Math.round(pending * perPolicy * 100),
              isTest: false,
            });
          }
        }
      }
    }
  }
}

/* M6: the tie at the top. Harborline's top two states for auto policies in
 * 2025-Q4 are made exactly equal by moving the gap onto the runner-up's agent
 * row (premium scaled with it). */
function boundTotals(
  rows: readonly SaleRow[],
  key: (row: SaleRow) => string,
  filter: (row: SaleRow) => boolean,
  measure: (row: SaleRow) => number = (row) => row.policies,
): Map<string, number> {
  const totals = new Map<string, number>();
  for (const row of rows) {
    if (row.status !== 'BOUND' || row.isTest || !filter(row)) continue;
    totals.set(key(row), (totals.get(key(row)) ?? 0) + measure(row));
  }
  return totals;
}

function ranked(totals: Map<string, number>): [string, number][] {
  return [...totals.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

{
  const isTieScope = (row: SaleRow) =>
    row.carrier === PERSONA_CARRIER && row.line === TIE_LINE && row.period === TIE_PERIOD;
  const order = ranked(boundTotals(sales, (row) => row.state, isTieScope));
  const [leader, runnerUp] = order;
  const gap = leader[1] - runnerUp[1];
  const target = sales.find(
    (row) => isTieScope(row) && row.status === 'BOUND' && row.state === runnerUp[0] && row.channel === 'AGT',
  );
  assert(target !== undefined, 'the tie needs an agent row in the runner-up state');
  const perPolicy = target.premiumCents / target.policies;
  target.policies += gap;
  target.premiumCents = Math.round(target.policies * perPolicy);
}

/* M2: test rows. The feed's QA loads stay in the table, flagged is_test. The
 * Harborline ones land on the app in 2025-Q2 and are large enough to make the
 * app look like Harborline's top channel that quarter. */
const TEST_ROWS: readonly Omit<SaleRow, 'status' | 'isTest'>[] = [
  { carrier: 'HBM', line: 'AUTO', channel: 'APP', state: 'MA', period: TEST_PERIOD, policies: 2400, premiumCents: 240000 },
  { carrier: 'HBM', line: 'AUTO', channel: 'APP', state: 'NY', period: TEST_PERIOD, policies: 2600, premiumCents: 260000 },
  { carrier: 'HBM', line: 'HOME', channel: 'APP', state: 'PA', period: TEST_PERIOD, policies: 2500, premiumCents: 250000 },
  { carrier: 'CRV', line: 'HOME', channel: 'WEB', state: 'CA', period: '2024-Q4', policies: 1800, premiumCents: 180000 },
  { carrier: 'CRV', line: 'RENT', channel: 'WEB', state: 'CA', period: '2024-Q4', policies: 1800, premiumCents: 180000 },
  { carrier: 'TWG', line: 'AUTO', channel: 'WEB', state: 'FL', period: '2025-Q3', policies: 3000, premiumCents: 300000 },
];
for (const row of TEST_ROWS) sales.push({ ...row, status: 'BOUND', isTest: true });

/* ------------------------------------------------------- revenue by period */

interface RevenueRow {
  carrier: string;
  line: LineCode;
  period: string;
  earnedCents: number;
  feeCents: number;
}

const revenue: RevenueRow[] = [];
for (const carrier of CARRIERS) {
  for (const line of carrier.lines) {
    const written = DATA_PERIODS.map((p) =>
      sumBound((row) => row.carrier === carrier.code && row.line === line && row.period === p.code, 'premium'),
    );
    const bound = DATA_PERIODS.map((p) =>
      sumBound((row) => row.carrier === carrier.code && row.line === line && row.period === p.code, 'policies'),
    );
    const prior = written[0] * 0.95;
    DATA_PERIODS.forEach((period, i) => {
      if (written[i] === 0 && bound[i] === 0) return;
      const window = [0, 1, 2, 3].map((back) => (i - back >= 0 ? written[i - back] : prior));
      const earned = Math.round((window.reduce((a, b) => a + b, 0) / 4) * 0.97 * rng.float(0.98, 1.02, 4));
      const fee = Math.round(bound[i] * lineByCode(line).fee * 100 * rng.float(0.95, 1.05, 4));
      revenue.push({ carrier: carrier.code, line, period: period.code, earnedCents: earned, feeCents: fee });
    });
  }
}

function sumBound(filter: (row: SaleRow) => boolean, measure: 'premium' | 'policies'): number {
  let total = 0;
  for (const row of sales) {
    if (row.status !== 'BOUND' || row.isTest || !filter(row)) continue;
    total += measure === 'premium' ? row.premiumCents : row.policies;
  }
  return total;
}

/* -------------------------------------------------------------- campaigns */

interface CampaignDef {
  code: string;
  name: string;
  carrier: string;
  line: LineCode;
  channel: ChannelCode;
  objective: 'ACQUISITION' | 'RETENTION' | 'BRAND';
  startsOn: string;
  endsOn: string;
  promo: string | null;
  /** Quarterly budget in dollars, before any proration. */
  budget: number;
  /** Click-through rate the campaign runs at. */
  ctr: number;
  /** Spend over budget the campaign runs at (above 1 overspends; M10). */
  pacing: number;
}

/**
 * Harborline's campaigns are written out: the questions name them. The promo
 * code is the sparse column (M4): five of fourteen carry one, and PETPAL and
 * NEST10 are each used twice.
 */
const HBM_CAMPAIGNS: readonly Omit<CampaignDef, 'carrier'>[] = [
  { code: 'HBM-24-01', name: 'New Year Auto Switch', line: 'AUTO', channel: 'WEB', objective: 'ACQUISITION', startsOn: '2024-01-08', endsOn: '2024-03-31', promo: null, budget: 90000, ctr: 0.018, pacing: 0.95 },
  { code: 'HBM-24-02', name: 'Renters Starter Pack', line: 'RENT', channel: 'APP', objective: 'ACQUISITION', startsOn: '2024-02-01', endsOn: '2024-06-30', promo: 'NEST10', budget: 45000, ctr: 0.024, pacing: 0.92 },
  { code: 'HBM-24-03', name: 'Pet Launch Spotlight', line: 'PET', channel: 'WEB', objective: 'ACQUISITION', startsOn: '2024-05-13', endsOn: '2024-06-30', promo: 'PETPAL', budget: 70000, ctr: 0.021, pacing: 1.01 },
  { code: 'HBM-24-04', name: 'Agent Bundle Days', line: 'HOME', channel: 'AGT', objective: 'ACQUISITION', startsOn: '2024-04-15', endsOn: '2024-12-31', promo: null, budget: 60000, ctr: 0.011, pacing: 0.88 },
  { code: 'HBM-24-05', name: 'Loyalty Renewal Reminder', line: 'AUTO', channel: 'TEL', objective: 'RETENTION', startsOn: '2024-01-15', endsOn: '2024-12-31', promo: null, budget: 40000, ctr: 0.009, pacing: 0.97 },
  { code: 'HBM-24-06', name: 'Holiday Home Check', line: 'HOME', channel: 'WEB', objective: 'BRAND', startsOn: '2024-10-01', endsOn: '2024-12-31', promo: null, budget: 80000, ctr: 0.012, pacing: 1.03 },
  { code: 'HBM-24-07', name: 'Term Life Tuesdays', line: 'LIFE', channel: 'TEL', objective: 'ACQUISITION', startsOn: '2024-10-01', endsOn: '2025-03-31', promo: null, budget: 35000, ctr: 0.014, pacing: 0.99 },
  { code: 'HBM-25-01', name: 'Spring Home Refresh', line: 'HOME', channel: 'WEB', objective: 'ACQUISITION', startsOn: '2025-03-01', endsOn: '2025-05-31', promo: 'HOME15', budget: 85000, ctr: 0.019, pacing: 1.05 },
  { code: 'HBM-25-02', name: 'Drive Smart Rewards', line: 'AUTO', channel: 'APP', objective: 'ACQUISITION', startsOn: '2025-01-06', endsOn: '2025-06-30', promo: null, budget: 75000, ctr: 0.029, pacing: 0.93 },
  { code: 'HBM-25-03', name: 'Pet Parents Week', line: 'PET', channel: 'APP', objective: 'ACQUISITION', startsOn: '2025-04-01', endsOn: '2025-09-30', promo: 'PETPAL', budget: 50000, ctr: 0.027, pacing: 0.96 },
  { code: 'HBM-25-04', name: 'Agent Referral Drive', line: 'AUTO', channel: 'AGT', objective: 'ACQUISITION', startsOn: '2025-04-01', endsOn: '2025-12-31', promo: null, budget: 65000, ctr: 0.010, pacing: 0.9 },
  { code: 'HBM-25-05', name: 'Renters Campus Push', line: 'RENT', channel: 'WEB', objective: 'ACQUISITION', startsOn: '2025-07-01', endsOn: '2025-09-30', promo: 'NEST10', budget: 40000, ctr: 0.032, pacing: 1.12 },
  { code: 'HBM-25-06', name: 'Year-End Life Check', line: 'LIFE', channel: 'TEL', objective: 'ACQUISITION', startsOn: '2025-10-01', endsOn: '2025-12-31', promo: null, budget: 30000, ctr: 0.016, pacing: 1.08 },
  { code: 'HBM-25-07', name: 'Winter Auto Safety', line: 'AUTO', channel: 'WEB', objective: 'BRAND', startsOn: '2025-10-15', endsOn: '2025-12-31', promo: null, budget: 95000, ctr: 0.008, pacing: 0.86 },
];

/** Two other subscribers bought the campaign module; their campaigns are generated. */
const OTHER_CAMPAIGN_CARRIERS = ['CRV', 'PCC'] as const;
const CAMPAIGN_THEMES = ['Momentum', 'Fresh Start', 'Smart Saver', 'Open Road', 'Safe Harbor', 'Summer Push', 'Bright Path'];

const campaigns: CampaignDef[] = HBM_CAMPAIGNS.map((c) => ({ ...c, carrier: PERSONA_CARRIER }));
for (const carrierCode of OTHER_CAMPAIGN_CARRIERS) {
  const carrier = carrierByCode(carrierCode);
  const themes = rng.shuffle(CAMPAIGN_THEMES);
  for (let n = 0; n < 6; n++) {
    const line = rng.pick(carrier.lines);
    const channel = rng.pick(carrier.channels);
    const start = rng.dateBetween('2024-01-01', '2025-09-30');
    const end = rng.dateAfter(start, rng.int(45, 200));
    campaigns.push({
      code: `${carrierCode}-${start.slice(2, 4)}-${String(n + 1).padStart(2, '0')}`,
      name: `${themes[n]} ${lineByCode(line).name}`,
      carrier: carrierCode,
      line,
      channel,
      objective: rng.weighted([['ACQUISITION', 0.7], ['RETENTION', 0.15], ['BRAND', 0.15]] as const),
      startsOn: start,
      endsOn: end > '2025-12-31' ? '2025-12-31' : end,
      promo: rng.chance(0.3) ? rng.pick(['WELCOME5', 'SWITCH20', 'BUNDLE10']) : null,
      budget: rng.int(30, 120) * 1000,
      ctr: rng.float(0.008, 0.03, 4),
      pacing: rng.float(0.8, 1.1, 4),
    });
  }
}

/** Cost per click, leads per click, quotes per lead, binds per quote, by channel (M9, M13). */
const FUNNEL: Readonly<Record<ChannelCode, { cpc: number; leadRate: number; quoteRate: number; bindRate: number }>> = {
  AGT: { cpc: 6.0, leadRate: 0.12, quoteRate: 0.45, bindRate: 0.48 },
  WEB: { cpc: 3.5, leadRate: 0.08, quoteRate: 0.6, bindRate: 0.25 },
  APP: { cpc: 2.2, leadRate: 0.1, quoteRate: 0.55, bindRate: 0.22 },
  TEL: { cpc: 4.0, leadRate: 0.09, quoteRate: 0.72, bindRate: 0.4 },
};

interface ResultRow {
  campaign: string;
  period: string;
  budgetCents: number;
  spendCents: number;
  impressions: number;
  clicks: number;
  leads: number;
  quotes: number;
  bound: number;
}

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1;
}

const results: ResultRow[] = [];
for (const campaign of campaigns) {
  for (const period of DATA_PERIODS) {
    const from = campaign.startsOn > period.startsOn ? campaign.startsOn : period.startsOn;
    const to = campaign.endsOn < period.endsOn ? campaign.endsOn : period.endsOn;
    if (from > to) continue;
    // M7: Harborline paused every campaign in the freeze quarter.
    if (campaign.carrier === PERSONA_CARRIER && period.code === FREEZE_PERIOD) continue;
    const share = daysBetween(from, to) / daysBetween(period.startsOn, period.endsOn);
    const funnel = FUNNEL[campaign.channel];
    const budgetDollars = Math.round(campaign.budget * share);
    const spendDollars = budgetDollars * campaign.pacing * rng.float(0.98, 1.02, 4);
    const clicks = Math.max(1, Math.round((spendDollars / funnel.cpc) * rng.float(0.92, 1.08, 4)));
    const impressions = Math.round(clicks / (campaign.ctr * rng.float(0.95, 1.05, 4)));
    const leads = Math.round(clicks * funnel.leadRate * rng.float(0.92, 1.08, 4));
    const quotes = Math.round(leads * funnel.quoteRate * rng.float(0.94, 1.06, 4));
    const bound = Math.round(quotes * funnel.bindRate * rng.float(0.92, 1.08, 4));
    results.push({
      campaign: campaign.code,
      period: period.code,
      budgetCents: budgetDollars * 100,
      spendCents: Math.round(spendDollars * 100),
      impressions,
      clicks,
      leads,
      quotes,
      bound,
    });
  }
}
const campaignId = (code: string) => campaigns.findIndex((c) => c.code === code) + 1;
const campaignByCode = (code: string) => campaigns[campaignId(code) - 1];

/* ------------------------------------------- market benchmark and masks */

/**
 * Each subscriber sees every other carrier under a label of its own
 * ("Competitor A" to "Competitor E"), drawn per viewer, so the same label
 * names a different carrier for each viewer. The benchmark is built from the
 * bound, non-test sales, so it agrees with policy_sales by construction.
 */
const LABELS = ['Competitor A', 'Competitor B', 'Competitor C', 'Competitor D', 'Competitor E'];

interface MaskRow {
  viewer: string;
  label: string;
  competitor: string;
}
interface BenchmarkRow {
  viewer: string;
  period: string;
  line: LineCode;
  label: string;
  policies: number;
  premiumCents: number;
}

const masks: MaskRow[] = [];
for (const viewer of CARRIERS) {
  const others = rng.shuffle(CARRIERS.filter((c) => c.code !== viewer.code));
  others.forEach((competitor, i) => masks.push({ viewer: viewer.code, label: LABELS[i], competitor: competitor.code }));
}
const labelFor = (viewer: string, competitor: string) =>
  masks.find((m) => m.viewer === viewer && m.competitor === competitor)?.label as string;

const benchmarks: BenchmarkRow[] = [];
for (const viewer of CARRIERS) {
  for (const period of DATA_PERIODS) {
    for (const line of LINES) {
      const rows = masks
        .filter((m) => m.viewer === viewer.code)
        .map((m) => ({
          label: m.label,
          policies: sumBound((r) => r.carrier === m.competitor && r.line === line.code && r.period === period.code, 'policies'),
          premiumCents: sumBound((r) => r.carrier === m.competitor && r.line === line.code && r.period === period.code, 'premium'),
        }))
        .filter((r) => r.policies > 0);
      for (const row of rows) {
        benchmarks.push({ viewer: viewer.code, period: period.code, line: line.code, ...row });
      }
    }
  }
}

/* -------------------------------------------------------- analyst access */

const ANALYSTS = [
  { email: 'dana.whitfield@harborline.example', name: 'Dana Whitfield', carrier: 'HBM', role: 'ANALYST', visibility: 'MASKED' },
  { email: 'marcus.oyelaran@harborline.example', name: 'Marcus Oyelaran', carrier: 'HBM', role: 'MANAGER', visibility: 'MASKED' },
  { email: 'priya.natarajan@harborline.example', name: 'Priya Natarajan', carrier: 'HBM', role: 'ANALYST', visibility: 'MASKED' },
  { email: 'l.ferreira@crestview.example', name: 'Lucia Ferreira', carrier: 'CRV', role: 'MANAGER', visibility: 'MASKED' },
  { email: 'j.okafor@crestview.example', name: 'James Okafor', carrier: 'CRV', role: 'ANALYST', visibility: 'MASKED' },
  { email: 'h.lindqvist@northgate.example', name: 'Hanna Lindqvist', carrier: 'NGA', role: 'ANALYST', visibility: 'MASKED' },
  { email: 'r.castillo@northgate.example', name: 'Rafael Castillo', carrier: 'NGA', role: 'MANAGER', visibility: 'MASKED' },
  { email: 'e.brandt@bluefield.example', name: 'Ellen Brandt', carrier: 'BFG', role: 'ANALYST', visibility: 'AGGREGATE_ONLY' },
  { email: 'k.nguyen@pinecrest.example', name: 'Kim Nguyen', carrier: 'PCC', role: 'ANALYST', visibility: 'AGGREGATE_ONLY' },
  { email: 's.mbeki@pinecrest.example', name: 'Sipho Mbeki', carrier: 'PCC', role: 'MANAGER', visibility: 'AGGREGATE_ONLY' },
  { email: 't.harrow@tidewater.example', name: 'Tom Harrow', carrier: 'TWG', role: 'ANALYST', visibility: 'MASKED' },
  { email: 'a.rossi@tidewater.example', name: 'Alessia Rossi', carrier: 'TWG', role: 'ANALYST', visibility: 'MASKED' },
] as const;

/* ---------------------------------------------------------- planted facts */

const dollars = (cents: number) => Math.round(cents) / 100;
const share = (a: number, b: number) => Number((a / b).toFixed(6));
const isHbm = (row: SaleRow) => row.carrier === PERSONA_CARRIER;
const in2025 = (row: SaleRow) => row.period.startsWith('2025-');
const in2024 = (row: SaleRow) => row.period.startsWith('2024-');
const fiscal = (code: string) => PERIODS[periodId(code) - 1].fiscalYear;

const hbmResults = (filter: (r: ResultRow) => boolean) =>
  results.filter((r) => campaignByCode(r.campaign).carrier === PERSONA_CARRIER && filter(r));

function sumBy<T>(rows: readonly T[], key: (row: T) => string, value: (row: T) => number): Map<string, number> {
  const out = new Map<string, number>();
  for (const row of rows) out.set(key(row), (out.get(key(row)) ?? 0) + value(row));
  return out;
}

function ratioRank<T>(
  rows: readonly T[],
  key: (row: T) => string,
  numerator: (row: T) => number,
  denominator: (row: T) => number,
): [string, number][] {
  const num = sumBy(rows, key, numerator);
  const den = sumBy(rows, key, denominator);
  return [...num.keys()]
    .map((k) => [k, num.get(k)! / den.get(k)!] as [string, number])
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

const facts: Record<string, unknown> = {};

// M1, M2, M5: Harborline's policies sold in 2025-Q2, and what the traps add.
{
  const scope = (row: SaleRow) => isHbm(row) && row.period === TEST_PERIOD;
  const bound = sales.filter((r) => scope(r) && r.status === 'BOUND' && !r.isTest).reduce((s, r) => s + r.policies, 0);
  const withTests = sales.filter((r) => scope(r) && r.status === 'BOUND').reduce((s, r) => s + r.policies, 0);
  const allStatuses = sales.filter((r) => scope(r) && !r.isTest).reduce((s, r) => s + r.policies, 0);
  facts.harborlinePoliciesSold2025Q2 = { bound, withTestRows: withTests, withNtuAndPending: allStatuses };
  assert(withTests !== bound && allStatuses !== bound, 'the 2025-Q2 traps must change the count');
}

// M2: the test rows flip Harborline's top channel in 2025-Q2.
{
  const clean = ranked(boundTotals(sales, (r) => r.channel, (r) => isHbm(r) && r.period === TEST_PERIOD));
  const dirty = ranked(
    sumBy(
      sales.filter((r) => isHbm(r) && r.period === TEST_PERIOD && r.status === 'BOUND'),
      (r) => r.channel,
      (r) => r.policies,
    ),
  );
  assert(clean[0][0] === 'AGT', `expected agents to lead 2025-Q2 without test rows, got ${clean[0][0]}`);
  assert(dirty[0][0] === 'APP', `expected the app to lead 2025-Q2 with test rows, got ${dirty[0][0]}`);
  facts.topChannel2025Q2 = {
    withoutTestRows: { channel: channelByCode(clean[0][0]).name, policies: clean[0][1] },
    withTestRows: { channel: channelByCode(dirty[0][0]).name, policies: dirty[0][1] },
    testRows: TEST_ROWS.length,
  };
}

// M6: the tie at the top.
{
  const order = ranked(
    boundTotals(sales, (r) => r.state, (r) => isHbm(r) && r.line === TIE_LINE && r.period === TIE_PERIOD),
  );
  assert(order[0][1] === order[1][1], 'the top two states must tie');
  assert(order[2][1] < order[1][1], 'the third state must be below the tie');
  facts.autoTopStateTie2025Q4 = {
    states: [stateByCode(order[0][0]).name, stateByCode(order[1][0]).name].sort(),
    policies: order[0][1],
    next: { state: stateByCode(order[2][0]).name, policies: order[2][1] },
  };
}

// M3: the constant column.
facts.currencyCodes = [CURRENCY];

// M5: walk-aways (NTU) in 2025, the rate leader differs from the count leader.
{
  const hbm2025 = sales.filter((r) => isHbm(r) && in2025(r) && !r.isTest);
  const ntuTotal = hbm2025.filter((r) => r.status === 'NTU').reduce((s, r) => s + r.policies, 0);
  const ntuByChannel = sumBy(hbm2025.filter((r) => r.status === 'NTU'), (r) => r.channel, (r) => r.policies);
  const decided = hbm2025.filter((r) => r.status !== 'PENDING');
  const rate = ratioRank(decided, (r) => r.channel, (r) => (r.status === 'NTU' ? r.policies : 0), (r) => r.policies);
  const byCount = ranked(ntuByChannel);
  assert(rate[0][0] !== byCount[0][0], 'walk-away rate leader must differ from the count leader');
  assert(rate[0][1] - rate[1][1] > 0.005, 'walk-away rate leader must be clear');
  facts.walkAways2025 = {
    harborlineNtuPolicies: ntuTotal,
    highestRateChannel: channelByCode(rate[0][0]).name,
    highestRate: share(rate[0][1], 1),
    mostByCountChannel: channelByCode(byCount[0][0]).name,
  };
}

// M8: fiscal year 2025 (July 2024 to June 2025) against calendar 2025.
{
  const fy = sumBound((r) => isHbm(r) && fiscal(r.period) === 2025, 'premium');
  const cal = sumBound((r) => isHbm(r) && in2025(r), 'premium');
  assert(fy !== cal, 'fiscal and calendar 2025 must differ');
  facts.harborlineWrittenPremiumFy2025 = { fiscalYear2025Dollars: dollars(fy), calendar2025Dollars: dollars(cal) };
}

// M7: the empty quarter, and the dip in sales that quarter (reasoning).
{
  const spendQuarters = new Set(hbmResults(() => true).map((r) => r.period));
  const empty = DATA_PERIODS.filter((p) => !spendQuarters.has(p.code)).map((p) => p.code);
  assert(empty.length === 1 && empty[0] === FREEZE_PERIOD, `expected one empty quarter, got ${empty.join(', ')}`);
  const policies = (code: string) => sumBound((r) => isHbm(r) && r.period === code, 'policies');
  const [q2, q3, q4] = ['2024-Q2', '2024-Q3', '2024-Q4'].map(policies);
  assert(q3 < q2 && q3 < q4, 'Harborline sales must dip in the freeze quarter');
  facts.campaignFreeze = { quarterWithoutSpend: FREEZE_PERIOD, harborlinePolicies: { '2024-Q2': q2, '2024-Q3': q3, '2024-Q4': q4 } };
  facts.notReportedPeriod = '2026-Q1';
}

// M4: the sparse promo code.
{
  const hbmCampaigns = campaigns.filter((c) => c.carrier === PERSONA_CARRIER);
  const withPromo = hbmCampaigns.filter((c) => c.promo !== null).length;
  const leadsByPromo = sumBy(hbmResults(() => true), (r) => campaignByCode(r.campaign).promo ?? '(none)', (r) => r.leads);
  const order = ranked(leadsByPromo);
  const named = order.filter(([code]) => code !== '(none)');
  assert(order[0][0] === '(none)', 'the blank promo code must hold the most leads');
  assert(named[0][1] > named[1][1], 'the top promo code must be unique');
  facts.promoCodes = {
    harborlineCampaigns: hbmCampaigns.length,
    withPromoCode: withPromo,
    topPromoCode: named[0][0],
    topPromoLeads: named[0][1],
    leadsWithoutPromoCode: leadsByPromo.get('(none)'),
  };
}

// M9: click-through rate, the top three differ from the top three by clicks.
{
  const rows2025 = hbmResults((r) => r.period.startsWith('2025-'));
  const ctr = ratioRank(rows2025, (r) => r.campaign, (r) => r.clicks, (r) => r.impressions);
  const clicks = ranked(sumBy(rows2025, (r) => r.campaign, (r) => r.clicks));
  const top = ctr.slice(0, 3).map(([c]) => c);
  assert(ctr[2][1] - ctr[3][1] > 0.0005, 'third and fourth CTR must not be close');
  assert(top.join() !== clicks.slice(0, 3).map(([c]) => c).join(), 'CTR top three must differ from clicks top three');
  facts.topCtrCampaigns2025 = ctr.slice(0, 3).map(([c, v]) => ({ campaign: campaignByCode(c).name, ctr: share(v, 1) }));
}

// M10: share of budget spent, the top three differ from the biggest spenders.
{
  const rows2025 = hbmResults((r) => r.period.startsWith('2025-'));
  const used = ratioRank(rows2025, (r) => r.campaign, (r) => r.spendCents, (r) => r.budgetCents);
  const spend = ranked(sumBy(rows2025, (r) => r.campaign, (r) => r.spendCents));
  assert(used[2][1] - used[3][1] > 0.002, 'third and fourth budget share must not be close');
  assert(
    used.slice(0, 3).map(([c]) => c).join() !== spend.slice(0, 3).map(([c]) => c).join(),
    'budget-share top three must differ from the top spenders',
  );
  facts.topBudgetShareCampaigns2025 = used.slice(0, 3).map(([c, v]) => ({ campaign: campaignByCode(c).name, spentShareOfBudget: share(v, 1) }));
  facts.harborlineCampaignSpend2025Dollars = dollars(rows2025.reduce((s, r) => s + r.spendCents, 0));
}

// M13: lead-to-policy conversion and cost per acquisition by channel, 2025.
{
  const rows2025 = hbmResults((r) => r.period.startsWith('2025-'));
  const channelOf = (r: ResultRow) => campaignByCode(r.campaign).channel;
  const leadToPolicy = ratioRank(rows2025, channelOf, (r) => r.bound, (r) => r.leads);
  const quoteToPolicy = ratioRank(rows2025, channelOf, (r) => r.bound, (r) => r.quotes);
  const rawBound = ranked(sumBy(rows2025, channelOf, (r) => r.bound));
  assert(leadToPolicy[0][0] !== quoteToPolicy[0][0], 'leads and quotes as denominators must name different leaders');
  assert(leadToPolicy[0][0] !== rawBound[0][0], 'the conversion leader must not be the volume leader');
  // Lowest cost per acquisition (spend per policy) against lowest cost per lead.
  const cpa = ratioRank(rows2025, channelOf, (r) => r.spendCents, (r) => r.bound).reverse();
  const cpl = ratioRank(rows2025, channelOf, (r) => r.spendCents, (r) => r.leads).reverse();
  assert(cpa[0][0] !== cpl[0][0], 'cost per acquisition and cost per lead must name different channels');
  assert(cpa[1][1] / cpa[0][1] > 1.05, 'the lowest cost per acquisition must be clear');
  facts.channelFunnel2025 = {
    highestLeadToPolicy: channelByCode(leadToPolicy[0][0]).name,
    highestQuoteToPolicy: channelByCode(quoteToPolicy[0][0]).name,
    mostPoliciesBound: channelByCode(rawBound[0][0]).name,
    lowestCostPerAcquisition: channelByCode(cpa[0][0]).name,
    lowestCostPerAcquisitionDollars: dollars(cpa[0][1]),
    lowestCostPerLead: channelByCode(cpl[0][0]).name,
  };
}

// M11: share of market by line, 2025: the share leader is not Harborline's biggest line.
{
  const ours = sumBy(sales.filter((r) => isHbm(r) && in2025(r) && r.status === 'BOUND' && !r.isTest), (r) => r.line, (r) => r.premiumCents);
  const market = sumBy(sales.filter((r) => in2025(r) && r.status === 'BOUND' && !r.isTest), (r) => r.line, (r) => r.premiumCents);
  const shares = [...ours.keys()].map((l) => [l, ours.get(l)! / market.get(l)!] as [string, number]).sort((a, b) => b[1] - a[1]);
  const biggest = ranked(ours);
  assert(shares[0][0] !== biggest[0][0], 'share-of-market leader must differ from the biggest line');
  assert(shares[0][1] - shares[1][1] > 0.02, 'share-of-market leader must be clear');
  facts.shareOfMarket2025 = {
    largestShareLine: lineByCode(shares[0][0]).name,
    largestShare: share(shares[0][1], 1),
    biggestLineByPremium: lineByCode(biggest[0][0]).name,
    byLine: Object.fromEntries(shares.map(([l, v]) => [lineByCode(l).name, share(v, 1)])),
  };
}

// Premium per policy by line, 2025: SUM/SUM against the average of the aggregated rows.
{
  const rows = sales.filter((r) => isHbm(r) && in2025(r) && r.status === 'BOUND' && !r.isTest);
  const perPolicy = ratioRank(rows, (r) => r.line, (r) => r.premiumCents, (r) => r.policies);
  const avgRow = ratioRank(rows, (r) => r.line, (r) => r.premiumCents, () => 1);
  assert(perPolicy[0][0] !== avgRow[0][0], 'average of rows must name a different line than premium per policy');
  facts.premiumPerPolicy2025 = {
    highestLine: lineByCode(perPolicy[0][0]).name,
    highestDollars: dollars(perPolicy[0][1]),
    highestByRowAverage: lineByCode(avgRow[0][0]).name,
  };
}

// M12: digital share by region, 2025: the share leader is not the volume leader.
{
  const rows = sales.filter((r) => isHbm(r) && in2025(r) && r.status === 'BOUND' && !r.isTest);
  const regionOf = (r: SaleRow) => stateByCode(r.state).region;
  const digital = (r: SaleRow) => (channelByCode(r.channel).digital ? r.policies : 0);
  const rate = ratioRank(rows, regionOf, digital, (r) => r.policies);
  const volume = ranked(sumBy(rows, regionOf, digital));
  assert(rate[0][0] !== volume[0][0], 'digital share leader must differ from the digital volume leader');
  assert(rate[0][1] - rate[1][1] > 0.02, 'digital share leader must be clear');
  facts.digitalShare2025 = {
    highestShareRegion: REGIONS[regionId(rate[0][0]) - 1].name,
    highestShare: share(rate[0][1], 1),
    mostDigitalPoliciesRegion: REGIONS[regionId(volume[0][0]) - 1].name,
  };
}

// Market growth by line, 2024 to 2025: the percentage leader is not the dollar leader.
{
  const y24 = sumBy(sales.filter((r) => in2024(r) && r.status === 'BOUND' && !r.isTest), (r) => r.line, (r) => r.premiumCents);
  const y25 = sumBy(sales.filter((r) => in2025(r) && r.status === 'BOUND' && !r.isTest), (r) => r.line, (r) => r.premiumCents);
  const pct = [...y25.keys()].map((l) => [l, y25.get(l)! / y24.get(l)! - 1] as [string, number]).sort((a, b) => b[1] - a[1]);
  const abs = [...y25.keys()].map((l) => [l, y25.get(l)! - y24.get(l)!] as [string, number]).sort((a, b) => b[1] - a[1]);
  assert(pct[0][0] !== abs[0][0], 'percentage and dollar growth must name different lines');
  assert(pct[0][1] - pct[1][1] > 0.02, 'the percentage growth leader must be clear');
  facts.marketGrowth2024To2025 = {
    highestPercentLine: lineByCode(pct[0][0]).name,
    highestPercent: share(pct[0][1], 1),
    highestDollarLine: lineByCode(abs[0][0]).name,
  };
}

// The five states with the most policies sold in 2025 (no tie at the cut).
{
  const order = ranked(boundTotals(sales, (r) => r.state, in2025));
  assert(order[4][1] > order[5][1], 'fifth and sixth states must not tie');
  facts.topFiveStates2025 = order.slice(0, 5).map(([s, v]) => ({ state: stateByCode(s).name, policies: v }));
}

// Harborline's lowest-premium channel in 2025.
{
  const order = ranked(boundTotals(sales, (r) => r.channel, (r) => isHbm(r) && in2025(r), (r) => r.premiumCents));
  const last = order[order.length - 1];
  const prev = order[order.length - 2];
  assert(prev[1] / last[1] > 1.05, 'the lowest-premium channel must be clear');
  facts.harborlineLowestPremiumChannel2025 = { channel: channelByCode(last[0]).name, dollars: dollars(last[1]) };
}

// Harborline's top three campaigns by leads in 2025.
{
  const order = ranked(sumBy(hbmResults((r) => r.period.startsWith('2025-')), (r) => r.campaign, (r) => r.leads));
  assert(order[2][1] > order[3][1], 'third and fourth campaigns by leads must not tie');
  facts.topLeadCampaigns2025 = order.slice(0, 3).map(([c, v]) => ({ campaign: campaignByCode(c).name, leads: v }));
}

// Revenue (earned premium plus fee income) against written premium, Harborline 2025.
{
  const rows = revenue.filter((r) => r.carrier === PERSONA_CARRIER && r.period.startsWith('2025-'));
  const earned = rows.reduce((s, r) => s + r.earnedCents, 0);
  const fees = rows.reduce((s, r) => s + r.feeCents, 0);
  facts.harborlineRevenue2025 = {
    revenueDollars: dollars(earned + fees),
    earnedPremiumDollars: dollars(earned),
    feeIncomeDollars: dollars(fees),
    writtenPremiumDollars: dollars(sumBound((r) => isHbm(r) && in2025(r), 'premium')),
  };
}

// G2: the competitor that grew fastest in auto from 2025-Q1 to 2025-Q2, as Harborline sees it.
{
  const growth = masks
    .filter((m) => m.viewer === PERSONA_CARRIER)
    .map((m) => {
      const q1 = sumBound((r) => r.carrier === m.competitor && r.line === 'AUTO' && r.period === '2025-Q1', 'premium');
      const q2 = sumBound((r) => r.carrier === m.competitor && r.line === 'AUTO' && r.period === '2025-Q2', 'premium');
      return { label: m.label, competitor: m.competitor, abs: q2 - q1, pct: q2 / q1 - 1 };
    });
  const byAbs = [...growth].sort((a, b) => b.abs - a.abs);
  const byPct = [...growth].sort((a, b) => b.pct - a.pct);
  assert(byAbs[0].competitor === GROWTH_CARRIER && byPct[0].competitor === GROWTH_CARRIER, 'the planted competitor must lead growth both ways');
  assert(byPct[0].pct - byPct[1].pct > 0.05, 'the growth leader must be clear');
  facts.fastestAutoGrowthCompetitor2025Q1ToQ2 = {
    viewer: carrierByCode(PERSONA_CARRIER).name,
    label: byAbs[0].label,
    carrier: carrierByCode(GROWTH_CARRIER).name,
    growth: share(byPct[0].pct, 1),
  };
  facts.harborlineMasks = Object.fromEntries(
    masks.filter((m) => m.viewer === PERSONA_CARRIER).map((m) => [m.label, carrierByCode(m.competitor).name]),
  );
}

// G1: Harborline's auto premium against the whole market, 2025-Q2.
{
  const ours = sumBound((r) => isHbm(r) && r.line === 'AUTO' && r.period === '2025-Q2', 'premium');
  const market = sumBound((r) => r.line === 'AUTO' && r.period === '2025-Q2', 'premium');
  const viaBenchmark =
    ours +
    benchmarks
      .filter((b) => b.viewer === PERSONA_CARRIER && b.line === 'AUTO' && b.period === '2025-Q2')
      .reduce((s, b) => s + b.premiumCents, 0);
  assert(market === viaBenchmark, 'the benchmark must agree with policy_sales');
  facts.harborlineAutoVsMarket2025Q2 = { harborlineDollars: dollars(ours), marketDollars: dollars(market), share: share(ours / market, 1) };
}

// G4: Pinecrest's pet premium against the rest of the market, 2025.
{
  const ours = sumBound((r) => r.carrier === 'PCC' && r.line === 'PET' && in2025(r), 'premium');
  const rest = sumBound((r) => r.carrier !== 'PCC' && r.line === 'PET' && in2025(r), 'premium');
  const sellers = [...new Set(sales.filter((r) => r.line === 'PET').map((r) => carrierByCode(r.carrier).name))].sort();
  facts.pinecrestPetVsRest2025 = { pinecrestDollars: dollars(ours), restOfMarketDollars: dollars(rest), petSellers: sellers };
}

// Fuzzy scope: every policy Harborline sold in the data.
facts.harborlinePoliciesAllPeriods = sumBound(isHbm, 'policies');

/* -------------------------------------------------------------------- DDL */

const DDL = `CREATE SCHEMA ${SCHEMA};
SET search_path TO ${SCHEMA}, public;

CREATE TABLE regions (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  region_code text NOT NULL UNIQUE,
  name text NOT NULL UNIQUE
);

CREATE TABLE states (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  state_code text NOT NULL UNIQUE,
  name text NOT NULL UNIQUE,
  region_id bigint NOT NULL REFERENCES regions(id)
);

CREATE TABLE carriers (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  carrier_code text NOT NULL UNIQUE,
  name text NOT NULL UNIQUE,
  segment text NOT NULL CHECK (segment IN ('NATIONAL', 'REGIONAL', 'MUTUAL')),
  hq_state_id bigint NOT NULL REFERENCES states(id),
  subscribed_on date NOT NULL
);

CREATE TABLE lines_of_business (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  line_code text NOT NULL UNIQUE,
  name text NOT NULL UNIQUE,
  product_family text NOT NULL
);

CREATE TABLE products (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  product_code text NOT NULL UNIQUE,
  name text NOT NULL UNIQUE,
  carrier_id bigint NOT NULL REFERENCES carriers(id),
  line_id bigint NOT NULL REFERENCES lines_of_business(id),
  launched_on date NOT NULL,
  UNIQUE (carrier_id, line_id)
);

CREATE TABLE channels (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  channel_code text NOT NULL UNIQUE,
  name text NOT NULL UNIQUE,
  is_digital boolean NOT NULL
);

CREATE TABLE periods (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  period_code text NOT NULL UNIQUE,
  calendar_year integer NOT NULL,
  calendar_quarter integer NOT NULL CHECK (calendar_quarter BETWEEN 1 AND 4),
  fiscal_year integer NOT NULL,
  fiscal_quarter integer NOT NULL CHECK (fiscal_quarter BETWEEN 1 AND 4),
  starts_on date NOT NULL,
  ends_on date NOT NULL,
  reporting_status text NOT NULL CHECK (reporting_status IN ('FINAL', 'PRELIMINARY', 'NOT_REPORTED'))
);

CREATE TABLE policy_sales (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  carrier_id bigint NOT NULL REFERENCES carriers(id),
  product_id bigint NOT NULL REFERENCES products(id),
  channel_id bigint NOT NULL REFERENCES channels(id),
  state_id bigint NOT NULL REFERENCES states(id),
  period_id bigint NOT NULL REFERENCES periods(id),
  sale_status text NOT NULL CHECK (sale_status IN ('BOUND', 'NTU', 'PENDING')),
  policy_count integer NOT NULL CHECK (policy_count > 0),
  written_premium_cents bigint NOT NULL CHECK (written_premium_cents >= 0),
  currency_code text NOT NULL,
  is_test boolean NOT NULL
);

CREATE TABLE revenue_by_period (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  carrier_id bigint NOT NULL REFERENCES carriers(id),
  line_id bigint NOT NULL REFERENCES lines_of_business(id),
  period_id bigint NOT NULL REFERENCES periods(id),
  earned_premium_cents bigint NOT NULL CHECK (earned_premium_cents >= 0),
  fee_income_cents bigint NOT NULL CHECK (fee_income_cents >= 0),
  UNIQUE (carrier_id, line_id, period_id)
);

CREATE TABLE campaigns (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  campaign_code text NOT NULL UNIQUE,
  name text NOT NULL UNIQUE,
  carrier_id bigint NOT NULL REFERENCES carriers(id),
  line_id bigint NOT NULL REFERENCES lines_of_business(id),
  channel_id bigint NOT NULL REFERENCES channels(id),
  objective text NOT NULL CHECK (objective IN ('ACQUISITION', 'RETENTION', 'BRAND')),
  starts_on date NOT NULL,
  ends_on date NOT NULL,
  promo_code text
);

CREATE TABLE campaign_results (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  campaign_id bigint NOT NULL REFERENCES campaigns(id),
  period_id bigint NOT NULL REFERENCES periods(id),
  budget_cents bigint NOT NULL CHECK (budget_cents >= 0),
  spend_cents bigint NOT NULL CHECK (spend_cents >= 0),
  impressions integer NOT NULL,
  clicks integer NOT NULL,
  leads integer NOT NULL,
  quotes integer NOT NULL,
  policies_bound integer NOT NULL,
  UNIQUE (campaign_id, period_id)
);

CREATE TABLE market_benchmarks (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  viewer_carrier_id bigint NOT NULL REFERENCES carriers(id),
  period_id bigint NOT NULL REFERENCES periods(id),
  line_id bigint NOT NULL REFERENCES lines_of_business(id),
  competitor_label text NOT NULL,
  policy_count integer NOT NULL,
  written_premium_cents bigint NOT NULL,
  UNIQUE (viewer_carrier_id, period_id, line_id, competitor_label)
);

CREATE TABLE competitor_masks (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  viewer_carrier_id bigint NOT NULL REFERENCES carriers(id),
  competitor_label text NOT NULL,
  competitor_carrier_id bigint NOT NULL REFERENCES carriers(id),
  UNIQUE (viewer_carrier_id, competitor_label),
  UNIQUE (viewer_carrier_id, competitor_carrier_id)
);

CREATE TABLE analyst_access (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  email text NOT NULL UNIQUE,
  full_name text NOT NULL,
  carrier_id bigint NOT NULL REFERENCES carriers(id),
  access_role text NOT NULL CHECK (access_role IN ('ANALYST', 'MANAGER')),
  competitor_visibility text NOT NULL CHECK (competitor_visibility IN ('MASKED', 'AGGREGATE_ONLY'))
);

CREATE INDEX policy_sales_carrier_period_idx ON policy_sales (carrier_id, period_id);
CREATE INDEX policy_sales_product_idx ON policy_sales (product_id);
CREATE INDEX policy_sales_state_idx ON policy_sales (state_id);
CREATE INDEX campaign_results_campaign_idx ON campaign_results (campaign_id);
CREATE INDEX market_benchmarks_viewer_idx ON market_benchmarks (viewer_carrier_id, period_id);`;

/* ------------------------------------------------------------------- emit */

const HEADER = `-- Generated by docker/postgres/generate/marketing-analytics.ts (seed ${SEED}). Do not edit by hand.
-- Regenerate with:
--   cd backend && npx ts-node -T -P tsconfig.json ../docker/postgres/generate/marketing-analytics.ts
--
-- SYNTHETIC DATA. Every carrier, product, campaign, analyst and figure in this
-- file is invented by a seeded random generator for evaluating the
-- text-to-SQL assistant; none describes a real company or person.
--
-- A market-insight product for personal-lines insurance carriers: policy
-- sales by quarter, revenue by period, the carriers' own campaigns, and a
-- market benchmark in which each subscriber sees its competitors only as
-- masked labels. Quarters run 2024-Q1 to 2025-Q4 (2025-Q4 preliminary);
-- 2026-Q1 is listed but not reported. No value depends on today's date.
-- Brief: docs/evals/domains/marketing-analytics.md. Policy:
-- docs/evals/domains/marketing-analytics-policy.md.`;

const blocks = [
  HEADER,
  'BEGIN;',
  DDL,
  section('regions'),
  insertRows('regions', ['region_code', 'name'], REGIONS.map((r) => [r.code, r.name])),
  section('states'),
  insertRows('states', ['state_code', 'name', 'region_id'], STATES.map((s) => [s.code, s.name, regionId(s.region)])),
  section('carriers'),
  insertRows(
    'carriers',
    ['carrier_code', 'name', 'segment', 'hq_state_id', 'subscribed_on'],
    CARRIERS.map((c) => [c.code, c.name, c.segment, stateId(c.hq), c.subscribedOn]),
  ),
  section('lines_of_business'),
  insertRows('lines_of_business', ['line_code', 'name', 'product_family'], LINES.map((l) => [l.code, l.name, l.family])),
  section('products'),
  insertRows(
    'products',
    ['product_code', 'name', 'carrier_id', 'line_id', 'launched_on'],
    products.map((p) => [p.code, p.name, carrierId(p.carrier), lineId(p.line), p.launchedOn]),
  ),
  section('channels'),
  insertRows('channels', ['channel_code', 'name', 'is_digital'], CHANNELS.map((c) => [c.code, c.name, c.digital])),
  section('periods'),
  insertRows(
    'periods',
    ['period_code', 'calendar_year', 'calendar_quarter', 'fiscal_year', 'fiscal_quarter', 'starts_on', 'ends_on', 'reporting_status'],
    PERIODS.map((p) => [p.code, p.year, p.quarter, p.fiscalYear, p.fiscalQuarter, p.startsOn, p.endsOn, p.status]),
  ),
  section('policy_sales'),
  insertRows(
    'policy_sales',
    ['carrier_id', 'product_id', 'channel_id', 'state_id', 'period_id', 'sale_status', 'policy_count', 'written_premium_cents', 'currency_code', 'is_test'],
    sales.map((r) => [
      carrierId(r.carrier),
      productId(r.carrier, r.line),
      channelId(r.channel),
      stateId(r.state),
      periodId(r.period),
      r.status,
      r.policies,
      r.premiumCents,
      CURRENCY,
      r.isTest,
    ]),
    500,
  ),
  section('revenue_by_period'),
  insertRows(
    'revenue_by_period',
    ['carrier_id', 'line_id', 'period_id', 'earned_premium_cents', 'fee_income_cents'],
    revenue.map((r) => [carrierId(r.carrier), lineId(r.line), periodId(r.period), r.earnedCents, r.feeCents]),
  ),
  section('campaigns'),
  insertRows(
    'campaigns',
    ['campaign_code', 'name', 'carrier_id', 'line_id', 'channel_id', 'objective', 'starts_on', 'ends_on', 'promo_code'],
    campaigns.map((c) => [c.code, c.name, carrierId(c.carrier), lineId(c.line), channelId(c.channel), c.objective, c.startsOn, c.endsOn, c.promo]),
  ),
  section('campaign_results'),
  insertRows(
    'campaign_results',
    ['campaign_id', 'period_id', 'budget_cents', 'spend_cents', 'impressions', 'clicks', 'leads', 'quotes', 'policies_bound'],
    results.map((r) => [campaignId(r.campaign), periodId(r.period), r.budgetCents, r.spendCents, r.impressions, r.clicks, r.leads, r.quotes, r.bound]),
  ),
  section('market_benchmarks'),
  insertRows(
    'market_benchmarks',
    ['viewer_carrier_id', 'period_id', 'line_id', 'competitor_label', 'policy_count', 'written_premium_cents'],
    benchmarks.map((b) => [carrierId(b.viewer), periodId(b.period), lineId(b.line), b.label, b.policies, b.premiumCents]),
  ),
  section('competitor_masks'),
  insertRows(
    'competitor_masks',
    ['viewer_carrier_id', 'competitor_label', 'competitor_carrier_id'],
    masks.map((m) => [carrierId(m.viewer), m.label, carrierId(m.competitor)]),
  ),
  section('analyst_access'),
  insertRows(
    'analyst_access',
    ['email', 'full_name', 'carrier_id', 'access_role', 'competitor_visibility'],
    ANALYSTS.map((a) => [a.email, a.name, carrierId(a.carrier), a.role, a.visibility]),
  ),
  'COMMIT;',
];

const sqlText = `${blocks.join('\n\n')}\n`;
assert(sqlText.length < 2_000_000, `the seed must stay under 2 MB (got ${sqlText.length} bytes)`);
writeFileSync(SQL_PATH, sqlText, 'utf8');

const counts: Record<string, number> = {
  regions: REGIONS.length,
  states: STATES.length,
  carriers: CARRIERS.length,
  lines_of_business: LINES.length,
  products: products.length,
  channels: CHANNELS.length,
  periods: PERIODS.length,
  policy_sales: sales.length,
  revenue_by_period: revenue.length,
  campaigns: campaigns.length,
  campaign_results: results.length,
  market_benchmarks: benchmarks.length,
  competitor_masks: masks.length,
  analyst_access: ANALYSTS.length,
};

const factsFile = {
  fixture: 'marketing-analytics',
  schema: SCHEMA,
  generator: 'docker/postgres/generate/marketing-analytics.ts',
  seed: SEED,
  note: 'Planted truths, computed by the generator from the rows it wrote. Money in dollars (the tables store cents). Every figure excludes test rows and counts only BOUND sales unless its name says otherwise.',
  rowCounts: counts,
  facts,
};
mkdirSync(dirname(FACTS_PATH), { recursive: true });
writeFileSync(FACTS_PATH, `${JSON.stringify(factsFile, null, 2)}\n`, 'utf8');

process.stdout.write(`Wrote ${SQL_PATH} (${sqlText.length} bytes, seed ${SEED})\n`);
process.stdout.write(`Wrote ${FACTS_PATH}\n\n`);
for (const [table, count] of Object.entries(counts)) {
  process.stdout.write(`  ${table.padEnd(20)} ${String(count).padStart(6)}\n`);
}
process.stdout.write(`\nPlanted facts:\n${JSON.stringify(facts, null, 2)}\n`);
