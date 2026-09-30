/**
 * Generator for the `retail` synthetic eval fixture.
 *
 * Writes `docker/postgres/init/005_retail.sql` from one hard-coded seed, so the
 * output is byte-identical on every run and every hand-verified `expectedSql`
 * in the eval set stays valid. Every random draw comes from the single `Rng`
 * below — never `Math.random()`.
 *
 * Run from `backend/` with:
 *
 *   npm run fixtures:retail
 *
 * or from the repo root with:
 *
 *   npx ts-node -T --compilerOptions '{"module":"commonjs","moduleResolution":"node"}' \
 *     docker/postgres/generate/retail.ts
 *
 * This fixture exists for one demonstration: learning from a reviewer's note.
 * The question "What was our net revenue in fiscal year 2025?" has exactly one
 * right answer here, and it rests on two facts that are *tribal knowledge* — a
 * fiscal year that runs February to January and is named for the year it
 * starts, and a net-revenue definition (merchandise net of line discounts,
 * completed orders only) that `orders.amount_charged` silently breaks, because
 * it is the amount charged and carries sales tax and web shipping.
 *
 * Neither fact is visible anywhere in the data: there is no tax or shipping
 * column, no fiscal-calendar table, and the column comment on `amount_charged`
 * says only what it is ("Amount charged to the customer at checkout"). The tax
 * rates and the shipping rule below exist in this script only, which is what
 * makes the trap land: the figure an engine computes before it is taught is
 * wrong, and the one it computes after is right. The traps R1-R10 are
 * described in `docs/evals/synthetic-domains.md` (Domain 4 — `retail`); this
 * script asserts every one of them and throws rather than emit a fixture with
 * a broken trap.
 */

import { writeFileSync } from 'fs';
import { join } from 'path';
import { Rng, literal, insertRows, section } from './lib/rng';

/* ------------------------------------------------------------------ knobs */

const SEED = 20260930;
const OUTPUT_PATH = join(__dirname, '..', 'init', '005_retail.sql');

/** Orders span 27 complete months; nothing is future-dated. */
const DATA_START = '2024-01-01';
const DATA_END = '2026-03-31';
const SIGNUP_START = '2023-06-01';

/** Half-open date windows `[from, to)`, the way every reference SQL writes them. */
interface Window {
  label: string;
  from: string;
  to: string;
}

/** The right reading: FY runs 1 Feb - 31 Jan and is named for the year it starts. */
const FY2025: Window = { label: 'FY2025 (Feb 2025-Jan 2026)', from: '2025-02-01', to: '2026-02-01' };
/** The default an engine reaches for when nobody told it otherwise. */
const CY2025: Window = { label: 'CY2025', from: '2025-01-01', to: '2026-01-01' };
/** The other retail convention: a fiscal year named for the year it ends. */
const FY2025_END_NAMED: Window = { label: 'FY named for its end year (Feb 2024-Jan 2025)', from: '2024-02-01', to: '2025-02-01' };
const MARCH_2025: Window = { label: 'March 2025', from: '2025-03-01', to: '2025-04-01' };

/**
 * Orders per month = round(base for the year x the month's weight). 2026 is
 * 320, not the 305 first planned: at 305 this seed's January 2025 orders ran
 * larger than January 2026's and the fiscal and calendar years differed by
 * only 2.2% of net revenue (R2 wants 2.5%). 320 gives 3.0% while keeping the
 * naive answer (calendar year, amount_charged) 5.5% off the right one (R3).
 */
const MONTHLY_BASE: Record<number, number> = { 2024: 180, 2025: 235, 2026: 320 };
const MONTH_WEIGHTS = [1.6, 0.8, 0.9, 0.9, 1.0, 1.0, 0.95, 1.0, 0.95, 1.05, 1.35, 1.5];

const CANCEL_RATE = 0.04;
const DISCOUNT_RATE = 0.2;
/** January sales and the holiday season discount more lines. */
const PROMO_DISCOUNT_RATE = 0.35;
const PROMO_MONTHS = [1, 11, 12];
/** A discount is a share of the line's gross, in whole percent. */
const DISCOUNT_PERCENTS = [10, 15, 20, 25];
const LINE_COUNT_WEIGHTS: readonly (readonly [number, number])[] = [
  [1, 35],
  [2, 30],
  [3, 20],
  [4, 10],
  [5, 5],
];
const QUANTITY_WEIGHTS: readonly (readonly [number, number])[] = [
  [1, 70],
  [2, 20],
  [3, 10],
];

/** Web orders under this merchandise net pay flat-rate shipping. Generator-only. */
const FREE_SHIPPING_FROM_CENTS = 7500;
const SHIPPING_CENTS = 599;

const CUSTOMER_COUNT = 1500;
const PRODUCTS_PER_CATEGORY = 15;

/** Thresholds the invariants below enforce. */
const MIN_FY_VS_CY_NET = 0.025;
const MIN_TOTAL_VS_NET = 0.08;
const MIN_NAIVE_VS_CORRECT = 0.05;
const MIN_CANCELLED_EFFECT = 0.015;
const MIN_DISCOUNT_EFFECT = 0.02;
const MIN_FY_VS_CY_COUNT = 0.025;
const MIN_FY_CANCELLED = 100;
const MIN_MARCH_WINNER_LEAD = 1.05;
const MIN_CY_SIGNUPS = 300;

const rng = new Rng(SEED);

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(`INVARIANT FAILED: ${message}`);
}

/* ------------------------------------------------------- reference tables */

const REGIONS = ['Northeast', 'Midwest', 'South', 'West'] as const;
const STORE_REGIONS = [...REGIONS, 'Online'] as const;
const STATUSES = ['completed', 'cancelled'] as const;
const LOYALTY_TIERS = ['bronze', 'silver', 'gold'] as const;
const LOYALTY_WEIGHTS: readonly (readonly [(typeof LOYALTY_TIERS)[number], number])[] = [
  ['bronze', 60],
  ['silver', 30],
  ['gold', 10],
];

type Status = (typeof STATUSES)[number];

interface StoreSeed {
  name: string;
  /** NULL for the web store. */
  city: string | null;
  region: (typeof STORE_REGIONS)[number];
  openedOn: string;
  /** Share of orders, by relative weight. */
  weight: number;
  /** Generator-only: sales tax in basis points, never emitted. */
  taxBp: number;
  /** Generator-only: the web store charges shipping on small orders. */
  ships: boolean;
}

const STORES: StoreSeed[] = [
  { name: 'Austin South Congress', city: 'Austin', region: 'South', openedOn: '2017-04-08', weight: 12, taxBp: 825, ships: false },
  { name: 'Denver Union Station', city: 'Denver', region: 'West', openedOn: '2018-09-15', weight: 12, taxBp: 800, ships: false },
  { name: 'Chicago Wicker Park', city: 'Chicago', region: 'Midwest', openedOn: '2016-11-05', weight: 12, taxBp: 1025, ships: false },
  { name: 'Boston Back Bay', city: 'Boston', region: 'Northeast', openedOn: '2019-05-18', weight: 12, taxBp: 625, ships: false },
  { name: 'Seattle Capitol Hill', city: 'Seattle', region: 'West', openedOn: '2021-03-27', weight: 12, taxBp: 1010, ships: false },
  { name: 'Web Store', city: null, region: 'Online', openedOn: '2018-06-12', weight: 40, taxBp: 700, ships: true },
];

interface CategorySeed {
  name: string;
  skuPrefix: string;
  /**
   * Whole-dollar list-price range; prices end in .99. Kept moderate on
   * purpose: a typical order lands near $130, so a real share of web orders
   * falls under the free-shipping line and shipping is a visible part of
   * amount_charged (R3), not a rounding error.
   */
  price: [number, number];
  nouns: [string, string, string];
}

const CATEGORIES: CategorySeed[] = [
  { name: 'Apparel', skuPrefix: 'APP', price: [10, 45], nouns: ['Tee', 'Hoodie', 'Chino'] },
  { name: 'Footwear', skuPrefix: 'FTW', price: [25, 85], nouns: ['Runner', 'Boot', 'Sandal'] },
  { name: 'Accessories', skuPrefix: 'ACC', price: [6, 35], nouns: ['Backpack', 'Cap', 'Wallet'] },
  { name: 'Home', skuPrefix: 'HOM', price: [8, 60], nouns: ['Throw Blanket', 'Candle', 'Mug Set'] },
  { name: 'Beauty', skuPrefix: 'BEA', price: [5, 30], nouns: ['Face Serum', 'Lip Balm', 'Body Lotion'] },
  { name: 'Outdoor', skuPrefix: 'OUT', price: [12, 110], nouns: ['Tent', 'Sleeping Bag', 'Trekking Poles'] },
  { name: 'Electronics', skuPrefix: 'ELE', price: [15, 150], nouns: ['Earbuds', 'Speaker', 'Power Bank'] },
  { name: 'Toys', skuPrefix: 'TOY', price: [6, 35], nouns: ['Building Set', 'Puzzle', 'Plush Bear'] },
];

/**
 * R7 — spring is camping season: Outdoor lines are picked this much more often
 * in March-May, which gives the March 2025 units control a clear winner. Every
 * other category, and Outdoor the rest of the year, weighs 1.
 */
const SEASONAL_CATEGORY = { name: 'Outdoor', months: [3, 4, 5], weight: 1.5 };

/** Five product lines x three nouns = the 15 products of a category. */
const PRODUCT_LINES = ['Classic', 'Everyday', 'Heritage', 'Coastal', 'Summit'];

const FIRST_NAMES = [
  'Avery', 'Blake', 'Camila', 'Dante', 'Elena', 'Fiona', 'Gavin', 'Harper',
  'Isaac', 'Jasmine', 'Kai', 'Layla', 'Marcus', 'Nora', 'Owen', 'Paige',
  'Quentin', 'Rosa', 'Sienna', 'Theo', 'Uriel', 'Valerie', 'Wyatt', 'Xavier',
  'Yvette', 'Zane', 'Adrian', 'Bianca', 'Caleb', 'Delia', 'Elliot', 'Frances',
  'Grayson', 'Hazel', 'Ivan', 'Julia', 'Kendall', 'Logan', 'Maya', 'Nolan',
  'Olivia', 'Preston', 'Rachel', 'Samuel', 'Tessa', 'Uma', 'Vince', 'Willa',
  'Yasmin', 'Zoe', 'Aria', 'Brooks', 'Clara', 'Declan', 'Eva', 'Felipe',
  'Gemma', 'Hector', 'Ingrid', 'Jonah', 'Kiara', 'Leon', 'Mira', 'Nathan',
];

const LAST_NAMES = [
  'Alvarez', 'Bishop', 'Carver', 'Dawson', 'Ellison', 'Foster', 'Garrison', 'Holloway',
  'Ingram', 'Jennings', 'Kessler', 'Lambert', 'Mercer', 'Norris', 'Osborne', 'Prescott',
  'Quinlan', 'Ramsey', 'Sheridan', 'Talbot', 'Underwood', 'Vaughn', 'Whitaker', 'Yates',
  'Zimmerman', 'Abbott', 'Barlow', 'Crane', 'Delgado', 'Eaton', 'Fleming', 'Gaines',
  'Hendricks', 'Irwin', 'Jacobs', 'Kerr', 'Lucero', 'Maddox', 'Navarro', 'Ortiz',
  'Pruitt', 'Rhodes', 'Sutton', 'Tran', 'Villanueva', 'Walsh', 'Young', 'Ashford',
  'Benson', 'Castillo', 'Dunn', 'Everett', 'Fuentes', 'Griffin', 'Hayes', 'Keller',
  'Lowry', 'Monroe', 'Nguyen', 'Oakley', 'Pierce', 'Reyes', 'Stanton', 'Tate',
];

/* --------------------------------------------------------------- helpers */

function pad(value: number, width: number): string {
  return String(value).padStart(width, '0');
}

/** Integer cents to a 2-decimal literal, exact (no float formatting). */
function money(cents: number): string {
  assert(Number.isSafeInteger(cents), `money(): ${cents} is not whole cents`);
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  return `${sign}${Math.floor(abs / 100)}.${pad(abs % 100, 2)}`;
}

/**
 * Integer cents as the number a numeric(…,2) literal should carry. `n / 100`
 * prints as its shortest round-tripping decimal, which for whole cents is the
 * exact two-place value (17.99, 0.5, 120), so Postgres stores it exactly.
 */
function numeric(cents: number): number {
  assert(Number.isSafeInteger(cents), `numeric(): ${cents} is not whole cents`);
  return cents / 100;
}

/** The same figure with thousands separators, the way a person would write it. */
function dollars(cents: number): string {
  const [whole, fraction] = money(cents).split('.');
  return `$${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${fraction}`;
}

/** Half-up integer division, exact for non-negative safe integers. */
function divRound(numerator: number, denominator: number): number {
  assert(Number.isSafeInteger(numerator) && numerator >= 0, 'divRound(): numerator must be a non-negative safe integer');
  return Math.floor((numerator + denominator / 2) / denominator);
}

function sum(values: readonly number[]): number {
  return values.reduce((total, v) => total + v, 0);
}

const pctDiff = (a: number, b: number) => Math.abs(a - b) / Math.abs(b);
const pct = (value: number) => `${(100 * value).toFixed(2)}%`;

function inWindow(date: string, window: Window): boolean {
  return date >= window.from && date < window.to;
}

/** 6 significant digits — the rule the eval harness compares numbers by. */
function sig6(value: number): string {
  return Number(value.toPrecision(6)).toString();
}

/** Days in a month, from the calendar rather than a table. */
function daysIn(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/* ------------------------------------------------------------- products */

interface Product {
  id: number;
  sku: string;
  name: string;
  categoryIdx: number;
  listPriceCents: number;
  unitCostCents: number;
}

const products: Product[] = [];
CATEGORIES.forEach((category, categoryIdx) => {
  let n = 0;
  for (const noun of category.nouns) {
    for (const line of PRODUCT_LINES) {
      n++;
      const listPriceCents = rng.int(category.price[0], category.price[1]) * 100 - 1;
      const costPercent = rng.int(45, 65);
      products.push({
        id: products.length + 1,
        sku: `${category.skuPrefix}-${pad(n, 3)}`,
        name: `${line} ${noun}`,
        categoryIdx,
        listPriceCents,
        unitCostCents: divRound(listPriceCents * costPercent, 100),
      });
    }
  }
  assert(n === PRODUCTS_PER_CATEGORY, `${category.name}: expected ${PRODUCTS_PER_CATEGORY} products, built ${n}`);
});
// Order lines pick a category, then a product inside it, by position.
products.forEach((p, i) => assert(p.categoryIdx === Math.floor(i / PRODUCTS_PER_CATEGORY), `${p.sku}: products must be laid out by category`));

/* ------------------------------------------------------------ customers */

interface Customer {
  id: number;
  customerNumber: string;
  fullName: string;
  region: (typeof REGIONS)[number];
  signedUpOn: string;
  tier: (typeof LOYALTY_TIERS)[number];
}

const customers: Customer[] = [];
{
  const draws = Array.from({ length: CUSTOMER_COUNT }, (_, idx) => ({
    idx,
    signedUpOn: rng.dateBetween(SIGNUP_START, DATA_END),
    region: rng.pick(REGIONS),
    tier: rng.weighted(LOYALTY_WEIGHTS),
  }));
  // Ids follow sign-up date, the way a CRM assigns customer numbers.
  draws.sort((a, b) => (a.signedUpOn < b.signedUpOn ? -1 : a.signedUpOn > b.signedUpOn ? 1 : a.idx - b.idx));
  const used = new Set<string>();
  draws.forEach((draw, i) => {
    let name: string;
    do {
      name = `${rng.pick(FIRST_NAMES)} ${rng.pick(LAST_NAMES)}`;
    } while (used.has(name));
    used.add(name);
    customers.push({
      id: i + 1,
      customerNumber: `C-${pad(10000 + i + 1, 5)}`,
      fullName: name,
      region: draw.region,
      signedUpOn: draw.signedUpOn,
      tier: draw.tier,
    });
  });
}

/** How many customers had signed up on or before `date` (customers are date-sorted). */
function customersBy(date: string): number {
  let lo = 0;
  let hi = customers.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (customers[mid].signedUpOn <= date) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/* --------------------------------------------------------------- orders */

interface Line {
  productIdx: number;
  quantity: number;
  unitPriceCents: number;
  discountCents: number;
}

interface Order {
  /** Creation order — the tie-break when two order dates match. */
  idx: number;
  id: number;
  orderNumber: string;
  customerIdx: number;
  storeIdx: number;
  orderedAt: string;
  status: Status;
  lines: Line[];
  /** Σ(quantity x unit_price) — gross merchandise. */
  grossCents: number;
  /** Σ(quantity x unit_price - discount_amount) — net merchandise. */
  netCents: number;
  /** Generator-only parts of the charged amount. */
  taxCents: number;
  shippingCents: number;
  /** orders.amount_charged = net + tax + shipping. */
  totalCents: number;
}

const draftOrders: Order[] = [];
const storeWeights = STORES.map((store, i) => [i, store.weight] as const);

for (let year = 2024; year <= 2026; year++) {
  for (let month = 1; month <= 12; month++) {
    const first = `${year}-${pad(month, 2)}-01`;
    if (first > DATA_END) break;
    const count = Math.round(MONTHLY_BASE[year] * MONTH_WEIGHTS[month - 1]);
    const last = `${year}-${pad(month, 2)}-${pad(daysIn(year, month), 2)}`;
    const discountRate = PROMO_MONTHS.includes(month) ? PROMO_DISCOUNT_RATE : DISCOUNT_RATE;
    const categoryWeights = CATEGORIES.map(
      (c, i) =>
        [i, c.name === SEASONAL_CATEGORY.name && SEASONAL_CATEGORY.months.includes(month) ? SEASONAL_CATEGORY.weight : 1] as const,
    );
    for (let k = 0; k < count; k++) {
      const orderedAt = rng.dateBetween(first, last);
      const eligible = customersBy(orderedAt);
      assert(eligible > 0, `no customer had signed up by ${orderedAt}`);
      const customerIdx = rng.int(0, eligible - 1);
      const storeIdx = rng.weighted(storeWeights);
      const status: Status = rng.chance(CANCEL_RATE) ? 'cancelled' : 'completed';

      const lineCount = rng.weighted(LINE_COUNT_WEIGHTS);
      const chosen = new Set<number>();
      const lines: Line[] = [];
      while (lines.length < lineCount) {
        const categoryIdx = rng.weighted(categoryWeights);
        const productIdx = categoryIdx * PRODUCTS_PER_CATEGORY + rng.int(0, PRODUCTS_PER_CATEGORY - 1);
        if (chosen.has(productIdx)) continue;
        chosen.add(productIdx);
        const quantity = rng.weighted(QUANTITY_WEIGHTS);
        const unitPriceCents = products[productIdx].listPriceCents;
        const discountCents = rng.chance(discountRate)
          ? divRound(quantity * unitPriceCents * rng.pick(DISCOUNT_PERCENTS), 100)
          : 0;
        lines.push({ productIdx, quantity, unitPriceCents, discountCents });
      }

      const grossCents = sum(lines.map((l) => l.quantity * l.unitPriceCents));
      const netCents = sum(lines.map((l) => l.quantity * l.unitPriceCents - l.discountCents));
      const store = STORES[storeIdx];
      const taxCents = divRound(netCents * (10000 + store.taxBp), 10000) - netCents;
      const shippingCents = store.ships && netCents < FREE_SHIPPING_FROM_CENTS ? SHIPPING_CENTS : 0;
      draftOrders.push({
        idx: draftOrders.length,
        id: 0,
        orderNumber: '',
        customerIdx,
        storeIdx,
        orderedAt,
        status,
        lines,
        grossCents,
        netCents,
        taxCents,
        shippingCents,
        totalCents: netCents + taxCents + shippingCents,
      });
    }
  }
}

// Ids follow order date, the way an order system numbers them.
const orders = [...draftOrders].sort((a, b) =>
  a.orderedAt < b.orderedAt ? -1 : a.orderedAt > b.orderedAt ? 1 : a.idx - b.idx,
);
orders.forEach((order, i) => {
  order.id = i + 1;
  order.orderNumber = `SO-${pad(100000 + i + 1, 6)}`;
});

interface LineRow extends Line {
  orderId: number;
}

const lineRows: LineRow[] = orders.flatMap((order) => order.lines.map((line) => ({ ...line, orderId: order.id })));

/* ------------------------------------------- the measures the traps probe */

type OrderFilter = (order: Order) => boolean;

const COMPLETED: OrderFilter = (o) => o.status === 'completed';
const ANY_STATUS: OrderFilter = () => true;
const CANCELLED: OrderFilter = (o) => o.status === 'cancelled';

function ordersIn(window: Window, filter: OrderFilter): Order[] {
  return orders.filter((o) => inWindow(o.orderedAt, window) && filter(o));
}

const netOf = (list: Order[]) => sum(list.map((o) => o.netCents));
const grossOf = (list: Order[]) => sum(list.map((o) => o.grossCents));
const totalOf = (list: Order[]) => sum(list.map((o) => o.totalCents));

const fyCompleted = ordersIn(FY2025, COMPLETED);
const cyCompleted = ordersIn(CY2025, COMPLETED);

const fyNet = netOf(fyCompleted);
const cyNet = netOf(cyCompleted);
const fyTotal = totalOf(fyCompleted);
const cyTotal = totalOf(cyCompleted);
const fyNetAll = netOf(ordersIn(FY2025, ANY_STATUS));
const fyGross = grossOf(fyCompleted);
const fyEndNamedNet = netOf(ordersIn(FY2025_END_NAMED, COMPLETED));
const cyTotalAll = totalOf(ordersIn(CY2025, ANY_STATUS));
const fyTax = sum(fyCompleted.map((o) => o.taxCents));
const fyShipping = sum(fyCompleted.map((o) => o.shippingCents));

const fyCount = fyCompleted.length;
const cyCount = cyCompleted.length;
const fyCountAll = ordersIn(FY2025, ANY_STATUS).length;
const fyCancelled = ordersIn(FY2025, CANCELLED).length;
const fyEndNamedCount = ordersIn(FY2025_END_NAMED, COMPLETED).length;

function unitsByCategory(window: Window, filter: OrderFilter): { category: string; units: number }[] {
  const units = CATEGORIES.map(() => 0);
  for (const order of ordersIn(window, filter)) {
    for (const line of order.lines) units[products[line.productIdx].categoryIdx] += line.quantity;
  }
  return CATEGORIES.map((c, i) => ({ category: c.name, units: units[i] })).sort(
    (a, b) => b.units - a.units || a.category.localeCompare(b.category),
  );
}

const marchUnits = unitsByCategory(MARCH_2025, COMPLETED);
const marchUnitsAll = unitsByCategory(MARCH_2025, ANY_STATUS);
const marchLines = ordersIn(MARCH_2025, COMPLETED).flatMap((o) => o.lines);
const marchRevenueByCategory = CATEGORIES.map((c, i) => ({
  category: c.name,
  net: sum(marchLines.filter((l) => products[l.productIdx].categoryIdx === i).map((l) => l.quantity * l.unitPriceCents - l.discountCents)),
})).sort((a, b) => b.net - a.net);

const signups = (window: Window) => customers.filter((c) => inWindow(c.signedUpOn, window)).length;
const cySignups = signups(CY2025);
const fySignups = signups(FY2025);

function byStore(list: Order[], measure: (o: Order) => number): { store: string; cents: number }[] {
  return STORES.map((store, i) => ({
    store: store.name,
    cents: sum(list.filter((o) => o.storeIdx === i).map(measure)),
  })).sort((a, b) => b.cents - a.cents);
}

const fyNetByStore = byStore(fyCompleted, (o) => o.netCents);
const fyTotalByStore = byStore(fyCompleted, (o) => o.totalCents);
const cyNetByStore = byStore(cyCompleted, (o) => o.netCents);

/* -------------------------------------------------------------- invariants */

// Row-level rules, mirroring the CHECK constraints.
{
  for (const store of STORES) assert(store.openedOn < DATA_START, `${store.name} must open before the data starts`);
  for (const product of products) {
    assert(product.unitCostCents > 0 && product.unitCostCents < product.listPriceCents, `${product.sku}: unit_cost must be below list_price`);
  }
  for (const customer of customers) {
    assert(customer.signedUpOn >= SIGNUP_START && customer.signedUpOn <= DATA_END, `${customer.customerNumber}: sign-up outside the window`);
  }
  for (const order of orders) {
    assert(order.orderedAt >= DATA_START && order.orderedAt <= DATA_END, `${order.orderNumber}: order date outside the window`);
    assert(customers[order.customerIdx].signedUpOn <= order.orderedAt, `${order.orderNumber}: ordered before the customer signed up`);
    assert(order.totalCents > 0, `${order.orderNumber}: amount_charged must be positive`);
    for (const line of order.lines) {
      assert(line.quantity >= 1 && line.quantity <= 10, `${order.orderNumber}: quantity out of range`);
      assert(line.discountCents >= 0 && line.discountCents < line.quantity * line.unitPriceCents, `${order.orderNumber}: discount out of range`);
    }
  }
}

// R1 - every order has a line, and amount_charged recomputes exactly from the
// emitted lines, the store's tax rate and the shipping rule.
{
  const linesByOrder = new Map<number, LineRow[]>();
  for (const row of lineRows) {
    const list = linesByOrder.get(row.orderId) ?? [];
    list.push(row);
    linesByOrder.set(row.orderId, list);
  }
  for (const order of orders) {
    const rows = linesByOrder.get(order.id) ?? [];
    assert(rows.length >= 1, `R1: ${order.orderNumber} has no order lines`);
    const net = sum(rows.map((r) => r.quantity * r.unitPriceCents - r.discountCents));
    const store = STORES[order.storeIdx];
    const recomputed =
      divRound(net * (10000 + store.taxBp), 10000) + (store.ships && net < FREE_SHIPPING_FROM_CENTS ? SHIPPING_CENTS : 0);
    assert(recomputed === order.totalCents, `R1: ${order.orderNumber} amount_charged ${money(order.totalCents)} does not recompute (${money(recomputed)})`);
    const products = new Set(rows.map((r) => r.productIdx));
    assert(products.size === rows.length, `R1: ${order.orderNumber} repeats a product`);
  }
}

// R2 - the fiscal year is not the calendar year.
assert(pctDiff(fyNet, cyNet) >= MIN_FY_VS_CY_NET, `R2: FY2025 vs CY2025 net revenue differ by ${pct(pctDiff(fyNet, cyNet))}, need ${pct(MIN_FY_VS_CY_NET)}`);

// R3 - amount_charged is not revenue, and the naive answer (calendar year,
// amount_charged) does not land near the right one by cancellation.
assert(pctDiff(fyTotal, fyNet) >= MIN_TOTAL_VS_NET, `R3: FY2025 amount_charged vs net revenue differ by ${pct(pctDiff(fyTotal, fyNet))}, need ${pct(MIN_TOTAL_VS_NET)}`);
assert(pctDiff(cyTotal, fyNet) >= MIN_NAIVE_VS_CORRECT, `R3: CY2025 amount_charged vs FY2025 net revenue differ by ${pct(pctDiff(cyTotal, fyNet))}, need ${pct(MIN_NAIVE_VS_CORRECT)}`);

// R4 - cancelled orders move the figure.
assert(pctDiff(fyNetAll, fyNet) >= MIN_CANCELLED_EFFECT, `R4: cancelled orders move FY2025 net revenue by ${pct(pctDiff(fyNetAll, fyNet))}, need ${pct(MIN_CANCELLED_EFFECT)}`);

// R5 - discounts move the figure.
assert(pctDiff(fyGross, fyNet) >= MIN_DISCOUNT_EFFECT, `R5: FY2025 gross vs net merchandise differ by ${pct(pctDiff(fyGross, fyNet))}, need ${pct(MIN_DISCOUNT_EFFECT)}`);

// R6 - the fiscal year moves the order count too, and there are enough
// cancellations for the default filter to matter.
assert(pctDiff(fyCount, cyCount) >= MIN_FY_VS_CY_COUNT, `R6: FY2025 vs CY2025 completed orders differ by ${pct(pctDiff(fyCount, cyCount))}, need ${pct(MIN_FY_VS_CY_COUNT)}`);
assert(fyCancelled >= MIN_FY_CANCELLED, `R6: only ${fyCancelled} cancelled orders in FY2025, need ${MIN_FY_CANCELLED}`);

// R7 - the March 2025 control has a clear winner that survives the status filter.
assert(
  marchUnits[0].units >= MIN_MARCH_WINNER_LEAD * marchUnits[1].units,
  `R7: March 2025 top category ${marchUnits[0].category} (${marchUnits[0].units}) must lead ${marchUnits[1].category} (${marchUnits[1].units}) by ${MIN_MARCH_WINNER_LEAD}x`,
);
assert(marchUnitsAll[0].category === marchUnits[0].category, `R7: the March 2025 winner changes when cancelled orders are included (${marchUnitsAll[0].category})`);
assert(marchUnitsAll[0].units > marchUnitsAll[1].units, 'R7: the March 2025 winner must be unique with cancelled orders included');

// R8 - enough 2025 sign-ups, and the fiscal year gives a different count.
assert(cySignups >= MIN_CY_SIGNUPS, `R8: only ${cySignups} sign-ups in 2025, need ${MIN_CY_SIGNUPS}`);
assert(cySignups !== fySignups, `R8: CY2025 and FY2025 sign-ups must differ (both ${cySignups})`);

// R9 - unique names, SKUs, order and customer numbers.
{
  const unique = (label: string, values: string[]) =>
    assert(new Set(values).size === values.length, `R9: duplicate ${label}`);
  unique('store name', STORES.map((s) => s.name));
  unique('product name', products.map((p) => p.name));
  unique('SKU', products.map((p) => p.sku));
  unique('customer name', customers.map((c) => c.fullName));
  unique('customer number', customers.map((c) => c.customerNumber));
  unique('order number', orders.map((o) => o.orderNumber));
}

// R10 - the five candidate answers to the trap question are pairwise distinct
// at the precision the harness compares by.
const CANDIDATES: [string, number][] = [
  ['correct: FY2025 net revenue, completed', fyNet],
  ['CY2025 amount_charged, completed', cyTotal],
  ['FY2025 amount_charged, completed', fyTotal],
  ['CY2025 net revenue, completed', cyNet],
  ['FY2025 net revenue, cancelled included', fyNetAll],
];
for (let i = 0; i < CANDIDATES.length; i++) {
  for (let j = i + 1; j < CANDIDATES.length; j++) {
    assert(
      sig6(CANDIDATES[i][1] / 100) !== sig6(CANDIDATES[j][1] / 100),
      `R10: "${CANDIDATES[i][0]}" and "${CANDIDATES[j][0]}" agree at 6 significant digits`,
    );
  }
}

/* ----------------------------------------------------------------- DDL */

const list = (values: readonly string[]) => values.map((v) => literal(v)).join(', ');

const HEADER = `-- =============================================================================
-- retail -- synthetic fixture for the Questions to Insights eval set
--
-- GENERATED FILE. DO NOT EDIT BY HAND.
-- Edit the generator and regenerate; hand edits are lost on the next run.
--
--   generator : docker/postgres/generate/retail.ts
--   seed      : ${SEED}   (single hard-coded constant -- the output is
--               byte-identical on every run, so hand-verified eval SQL stays valid)
--   regenerate: cd backend && npm run fixtures:retail
--
-- Surrogate keys are left to the identity columns: rows are inserted in the
-- order the generator emits them, so id 1..N follows that order and the foreign
-- keys below are the matching literals. customers are inserted by sign-up date
-- and orders by order date.
--
-- Orders run from ${DATA_START} to ${DATA_END}: nothing is future-dated and no
-- value depends on the date this file was generated.
-- =============================================================================

BEGIN;

CREATE SCHEMA retail;
SET search_path TO retail, public;

CREATE TABLE stores (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name text NOT NULL UNIQUE,
  city text,
  region text NOT NULL CHECK (region IN (${list(STORE_REGIONS)})),
  opened_on date NOT NULL
);

CREATE TABLE products (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  sku text NOT NULL UNIQUE,
  name text NOT NULL UNIQUE,
  category text NOT NULL CHECK (category IN (${list(CATEGORIES.map((c) => c.name))})),
  unit_cost numeric(10,2) NOT NULL CHECK (unit_cost > 0),
  list_price numeric(10,2) NOT NULL CHECK (list_price > 0),
  CHECK (unit_cost < list_price)
);

CREATE TABLE customers (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  customer_number text NOT NULL UNIQUE,
  full_name text NOT NULL UNIQUE,
  region text NOT NULL CHECK (region IN (${list(REGIONS)})),
  signed_up_on date NOT NULL CHECK (signed_up_on BETWEEN DATE '${SIGNUP_START}' AND DATE '${DATA_END}'),
  loyalty_tier text NOT NULL CHECK (loyalty_tier IN (${list(LOYALTY_TIERS)}))
);

CREATE TABLE orders (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  order_number text NOT NULL UNIQUE,
  customer_id bigint NOT NULL REFERENCES customers(id),
  store_id bigint NOT NULL REFERENCES stores(id),
  ordered_at date NOT NULL CHECK (ordered_at BETWEEN DATE '${DATA_START}' AND DATE '${DATA_END}'),
  status text NOT NULL CHECK (status IN (${list(STATUSES)})),
  amount_charged numeric(12,2) NOT NULL CHECK (amount_charged > 0)
);

CREATE TABLE order_lines (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  order_id bigint NOT NULL REFERENCES orders(id),
  product_id bigint NOT NULL REFERENCES products(id),
  quantity integer NOT NULL CHECK (quantity BETWEEN 1 AND 10),
  unit_price numeric(10,2) NOT NULL CHECK (unit_price > 0),
  discount_amount numeric(10,2) NOT NULL CHECK (discount_amount >= 0),
  UNIQUE (order_id, product_id),
  CHECK (discount_amount <= quantity * unit_price)
);

CREATE INDEX orders_customer_idx ON orders (customer_id);
CREATE INDEX orders_store_idx ON orders (store_id);
CREATE INDEX orders_ordered_at_idx ON orders (ordered_at);
CREATE INDEX order_lines_order_idx ON order_lines (order_id);
CREATE INDEX order_lines_product_idx ON order_lines (product_id);
`;

// Deliberately silent about tax, shipping and the fiscal calendar: the
// assistant reads column descriptions and the verifier does not, so a hint
// here would split careful mode's cross-check instead of testing learning.
const FOOTER = `COMMENT ON SCHEMA retail IS
  ${literal(`Synthetic eval fixture: a US specialty retailer with five stores and a web store, ${DATA_START} to ${DATA_END}. Amounts are in USD.`)};
COMMENT ON COLUMN orders.status IS
  ${literal('completed or cancelled.')};
COMMENT ON COLUMN orders.ordered_at IS
  ${literal('Date the order was placed')};
COMMENT ON COLUMN orders.amount_charged IS
  ${literal('Amount charged to the customer at checkout.')};
COMMENT ON COLUMN order_lines.discount_amount IS
  ${literal('Money off this line at checkout; 0 when none')};

COMMIT;
`;

/* ------------------------------------------------------------ INSERT rows */

const blocks: string[] = [
  HEADER,
  section('stores'),
  insertRows('stores', ['name', 'city', 'region', 'opened_on'], STORES.map((s) => [s.name, s.city, s.region, s.openedOn])),
  section('products'),
  insertRows(
    'products',
    ['sku', 'name', 'category', 'unit_cost', 'list_price'],
    products.map((p) => [p.sku, p.name, CATEGORIES[p.categoryIdx].name, numeric(p.unitCostCents), numeric(p.listPriceCents)]),
  ),
  section('customers'),
  insertRows(
    'customers',
    ['customer_number', 'full_name', 'region', 'signed_up_on', 'loyalty_tier'],
    customers.map((c) => [c.customerNumber, c.fullName, c.region, c.signedUpOn, c.tier]),
    500,
  ),
  section('orders'),
  insertRows(
    'orders',
    ['order_number', 'customer_id', 'store_id', 'ordered_at', 'status', 'amount_charged'],
    orders.map((o) => [o.orderNumber, customers[o.customerIdx].id, o.storeIdx + 1, o.orderedAt, o.status, numeric(o.totalCents)]),
    500,
  ),
  section('order_lines'),
  insertRows(
    'order_lines',
    ['order_id', 'product_id', 'quantity', 'unit_price', 'discount_amount'],
    lineRows.map((l) => [l.orderId, products[l.productIdx].id, l.quantity, numeric(l.unitPriceCents), numeric(l.discountCents)]),
    500,
  ),
  section('descriptions'),
  FOOTER,
];

writeFileSync(OUTPUT_PATH, blocks.join('\n\n'), 'utf8');

/* -------------------------------------------------------------- stdout */

const counts: [string, number][] = [
  ['stores', STORES.length],
  ['products', products.length],
  ['customers', customers.length],
  ['orders', orders.length],
  ['order_lines', lineRows.length],
];

console.log(`retail fixture written to ${OUTPUT_PATH} (seed ${SEED})`);
for (const [table, count] of counts) {
  console.log(`  ${table.padEnd(20)} ${String(count).padStart(6)}`);
}

const row = (label: string, value: string) => console.log(`    ${label.padEnd(34)}: ${value}`);
const vs = (cents: number) => `${dollars(cents)} (${cents >= fyNet ? '+' : ''}${pct((cents - fyNet) / fyNet)} vs correct)`;

console.log('\n  planted answers (completed orders unless stated; FY2025 = 2025-02-01..2026-01-31)');
console.log('  net-revenue-fy2025');
row('correct: FY2025 net revenue', dollars(fyNet));
row('trap: CY2025 amount_charged (naive)', vs(cyTotal));
row('trap: FY2025 amount_charged', vs(fyTotal));
row('trap: CY2025 net revenue', vs(cyNet));
row('trap: FY2025 net, cancelled incl.', vs(fyNetAll));
row('trap: FY2025 gross (no discounts)', vs(fyGross));
row('trap: FY named for its end year', vs(fyEndNamedNet));
row('trap: CY2025 amount_charged, all', vs(cyTotalAll));
row('FY2025 tax + shipping inside total', `${dollars(fyTax)} tax + ${dollars(fyShipping)} shipping`);
console.log('  orders-fy2025');
row('correct: FY2025 completed orders', String(fyCount));
row('trap: CY2025 completed orders', String(cyCount));
row('trap: FY2025 cancelled included', `${fyCountAll} (${fyCancelled} cancelled)`);
row('trap: FY named for its end year', String(fyEndNamedCount));
console.log('  top-category-units-march-2025');
row('units by category (completed)', marchUnits.map((r) => `${r.category} ${r.units}`).join(', '));
row('units by category (all statuses)', marchUnitsAll.map((r) => `${r.category} ${r.units}`).join(', '));
row('net revenue by category (completed)', marchRevenueByCategory.map((r) => `${r.category} ${dollars(r.net)}`).join(', '));
console.log('  gross-charged-cy2025');
row('correct: CY2025 amount_charged', dollars(cyTotal));
row('trap: cancelled included', dollars(cyTotalAll));
row('trap: FY2025 amount_charged', dollars(fyTotal));
row('trap: CY2025 net revenue', dollars(cyNet));
console.log('  new-customers-2025');
row('correct: CY2025 sign-ups', String(cySignups));
row('trap: FY2025 sign-ups', String(fySignups));
console.log('  net-revenue-by-store-fy2025');
row('correct: FY2025 net by store', fyNetByStore.map((r) => `${r.store} ${dollars(r.cents)}`).join(', '));
row('trap: FY2025 amount_charged by store', fyTotalByStore.map((r) => `${r.store} ${dollars(r.cents)}`).join(', '));
row('trap: CY2025 net by store', cyNetByStore.map((r) => `${r.store} ${dollars(r.cents)}`).join(', '));
console.log('  margins');
row('R2 FY vs CY net', pct(pctDiff(fyNet, cyNet)));
row('R3 FY total vs net', pct(pctDiff(fyTotal, fyNet)));
row('R3 CY total vs FY net', pct(pctDiff(cyTotal, fyNet)));
row('R4 cancelled effect', pct(pctDiff(fyNetAll, fyNet)));
row('R5 discount effect', pct(pctDiff(fyGross, fyNet)));
row('R6 FY vs CY count', pct(pctDiff(fyCount, cyCount)));
row('R7 March lead', `${(marchUnits[0].units / marchUnits[1].units).toFixed(3)}x`);
