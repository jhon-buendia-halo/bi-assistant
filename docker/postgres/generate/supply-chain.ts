/**
 * Generator for the `supply_chain` synthetic eval fixture.
 *
 * Writes `backend/src/modules/testing-data/fixtures/006_supply_chain.sql`, the Testing Data
 * seed (`docker/postgres/init/006_supply_chain.sql` on feat/engine-eval-loop) from one hard-coded seed,
 * so the output is byte-identical on every run and every hand-verified
 * `expectedSql` in the eval set stays valid. Every random draw comes from the
 * single `Rng` below — never `Math.random()`, never `Date.now()`.
 *
 * The domain is a fictional industrial distributor, "Halden Industrial
 * Supply", seen from its inbound-purchasing side only: suppliers, a product
 * catalogue sold in case packs, warehouses by region, purchase orders and
 * their lines, shipments with carriers, inspection receipts and month-end
 * inventory snapshots.
 *
 * Run with (identical to the `fixtures:*` npm scripts):
 *
 *   cd backend && npx ts-node -T -P tsconfig.json ../docker/postgres/generate/supply-chain.ts
 *
 * The traps S1-S15 in `docs/evals/synthetic-domains.md` (Domain 3 —
 * `supply_chain`) are planted here. The ones that must hold exactly (the 41/41
 * supplier tie, the three distinct "biggest supplier" answers, the nine test
 * purchase orders in January 2025, the per-supplier acceptance ladder, the
 * per-mode freight shares) are enforced by deterministic post-generation
 * adjustment and then asserted — this script throws rather than emit a
 * fixture with a broken trap.
 */

import { writeFileSync } from 'fs';
import { join } from 'path';
import { Rng, literal, insertRows, section } from './lib/rng';

/* ------------------------------------------------------------------ knobs */

const SEED = 20260928;
const OUTPUT_PATH = join(
  __dirname,
  '..', '..', '..',
  'backend', 'src', 'modules', 'testing-data', 'fixtures',
  '006_supply_chain.sql',
);

const WINDOW_START = '2024-01-01';
const WINDOW_END = '2025-12-31';
const YEAR_2025_START = '2025-01-01';
const JAN_2025_START = '2025-01-01';
const JAN_2025_END = '2025-01-31';

const TOTAL_POS = 900;
const TIE_COUNT = 41;
const TIED_SUPPLIERS = ['Crescent Lab Chemicals', 'Northstar Hand Tools'];
const PO_COUNT_WINNER = 'Brightpath Packaging Co.';
const SPEND_WINNER = 'Voltmark Electronics Ltd.';
const UNITS_WINNER = 'Ironclad Fastener Works';
const PO_COUNT_WINNER_TOTAL = 70;
const OTHER_PO_FLOOR = 47;
const OTHER_PO_CEILING = 62;
const MIN_OTHER_NON_TEST_POS = 45;
const WINNER_MARGIN = 1.1;
const BOOST_MARGIN = 1.15;

const JAN_2025_TEST_POS = 9;
const TEST_PO_RATE = 0.02;
const TRACKING_RATE = 0.07;
const IN_TRANSIT_WINDOW_DAYS = 60;
const RECENT_PR_DAYS = 150;

const FEATURED_PRODUCT = 'Anti-Fog Safety Glasses';
const FEATURED_CASE_PACK = 24;
const FEATURED_MIN_LINES_2024 = 6;

const ACCEPTANCE_TOP = 0.99;
const ACCEPTANCE_STEP = 0.0125;

/** Planted freight / goods-value share per mode (S1, second column pair). */
const FREIGHT_SHARE: Record<Mode, number> = {
  SEA: 0.034,
  RAIL: 0.061,
  ROAD: 0.088,
  AIR: 0.187,
};

const rng = new Rng(SEED);

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(`INVARIANT FAILED: ${message}`);
}

/* ------------------------------------------------------- reference tables */

type Continent = 'NA' | 'EMEA' | 'APAC';
type Tier = 'STRATEGIC' | 'PREFERRED' | 'APPROVED' | 'CONDITIONAL';
type Incoterm = 'EXW' | 'FOB' | 'CIF' | 'DDP';
type Mode = 'ROAD' | 'RAIL' | 'SEA' | 'AIR';
type Route = 'ROAD' | 'RAIL' | 'SEA_SHORT' | 'SEA_LONG' | 'AIR';
type Reliability = 'high' | 'mid' | 'low';
type PoStatus =
  | 'DRAFT'
  | 'ISSUED'
  | 'PARTIALLY_RECEIVED'
  | 'RECEIVED'
  | 'CLOSED'
  | 'CANCELLED';
type ShipmentStatus = 'IN_TRANSIT' | 'DELIVERED' | 'EXCEPTION';
type QcStatus = 'PASSED' | 'FAILED' | 'PENDING';

const PO_STATUSES: PoStatus[] = [
  'DRAFT',
  'ISSUED',
  'PARTIALLY_RECEIVED',
  'RECEIVED',
  'CLOSED',
  'CANCELLED',
];
const TIERS: Tier[] = ['STRATEGIC', 'PREFERRED', 'APPROVED', 'CONDITIONAL'];
const MODES: Mode[] = ['ROAD', 'RAIL', 'SEA', 'AIR'];
const CASE_PACKS = [1, 6, 12, 24, 50, 100, 250, 500];

const REGIONS: { code: string; name: string; continent: Continent }[] = [
  { code: 'NA-WEST', name: 'North America West', continent: 'NA' },
  { code: 'NA-EAST', name: 'North America East', continent: 'NA' },
  { code: 'EMEA', name: 'Europe Middle East and Africa', continent: 'EMEA' },
  { code: 'APAC', name: 'Asia Pacific', continent: 'APAC' },
];

const WAREHOUSES = [
  { code: 'WH-RNO', name: 'Reno Distribution Center', region: 'NA-WEST', city: 'Reno', country: 'US', openedOn: '2014-05-12', weight: 0.17 },
  { code: 'WH-PDX', name: 'Portland Cross-Dock', region: 'NA-WEST', city: 'Portland', country: 'US', openedOn: '2019-09-03', weight: 0.12 },
  { code: 'WH-CMH', name: 'Columbus Fulfillment Center', region: 'NA-EAST', city: 'Columbus', country: 'US', openedOn: '2012-03-19', weight: 0.18 },
  { code: 'WH-CLT', name: 'Charlotte Regional Warehouse', region: 'NA-EAST', city: 'Charlotte', country: 'US', openedOn: '2017-11-06', weight: 0.13 },
  { code: 'WH-RTM', name: 'Rotterdam Logistics Hub', region: 'EMEA', city: 'Rotterdam', country: 'NL', openedOn: '2016-02-22', weight: 0.13 },
  { code: 'WH-LEJ', name: 'Leipzig Distribution Center', region: 'EMEA', city: 'Leipzig', country: 'DE', openedOn: '2021-06-14', weight: 0.1 },
  { code: 'WH-SIN', name: 'Singapore Gateway Warehouse', region: 'APAC', city: 'Singapore', country: 'SG', openedOn: '2018-08-27', weight: 0.17 },
];

const CATEGORIES = [
  { code: 'PKG', name: 'Packaging', lineValue: 0.7 },
  { code: 'FST', name: 'Fasteners', lineValue: 0.8 },
  { code: 'ELC', name: 'Electronic Components', lineValue: 2.2 },
  { code: 'SAF', name: 'Safety Equipment', lineValue: 1.0 },
  { code: 'CHM', name: 'Chemicals', lineValue: 1.3 },
  { code: 'HTL', name: 'Hand Tools', lineValue: 1.1 },
];

interface SupplierSeed {
  code: string;
  name: string;
  country: string;
  continent: Continent;
  tier: Tier;
  incoterm: Incoterm;
  category: string;
  /** Standard days from order to dispatch, before the per-PO slip. */
  processing: number;
  onboardedOn: string;
  priceFactor: number;
  reliability: Reliability;
}

const SUPPLIER_SEEDS: SupplierSeed[] = [
  { code: 'SUP-001', name: 'Brightpath Packaging Co.', country: 'US', continent: 'NA', tier: 'STRATEGIC', incoterm: 'FOB', category: 'PKG', processing: 3, onboardedOn: '2016-04-11', priceFactor: 0.96, reliability: 'high' },
  { code: 'SUP-002', name: 'Voltmark Electronics Ltd.', country: 'TW', continent: 'APAC', tier: 'STRATEGIC', incoterm: 'FOB', category: 'ELC', processing: 6, onboardedOn: '2017-09-25', priceFactor: 1.02, reliability: 'high' },
  { code: 'SUP-003', name: 'Ironclad Fastener Works', country: 'US', continent: 'NA', tier: 'STRATEGIC', incoterm: 'EXW', category: 'FST', processing: 4, onboardedOn: '2015-01-19', priceFactor: 0.95, reliability: 'mid' },
  { code: 'SUP-004', name: 'Sentinel Safety Supply', country: 'US', continent: 'NA', tier: 'STRATEGIC', incoterm: 'DDP', category: 'SAF', processing: 3, onboardedOn: '2018-06-04', priceFactor: 1.0, reliability: 'high' },
  { code: 'SUP-005', name: 'Nordhavn Industrial Chemicals', country: 'DE', continent: 'EMEA', tier: 'PREFERRED', incoterm: 'CIF', category: 'CHM', processing: 5, onboardedOn: '2019-03-18', priceFactor: 1.04, reliability: 'mid' },
  { code: 'SUP-006', name: 'Kestrel Tool & Die', country: 'US', continent: 'NA', tier: 'PREFERRED', incoterm: 'FOB', category: 'HTL', processing: 4, onboardedOn: '2020-10-05', priceFactor: 1.01, reliability: 'mid' },
  { code: 'SUP-007', name: 'Pacific Crest Components', country: 'CN', continent: 'APAC', tier: 'PREFERRED', incoterm: 'FOB', category: 'ELC', processing: 7, onboardedOn: '2021-02-08', priceFactor: 0.93, reliability: 'mid' },
  { code: 'SUP-008', name: 'Lakeshore Corrugated', country: 'CA', continent: 'NA', tier: 'PREFERRED', incoterm: 'DDP', category: 'PKG', processing: 3, onboardedOn: '2022-05-16', priceFactor: 1.03, reliability: 'high' },
  { code: 'SUP-009', name: 'Rheinfeld Befestigungstechnik GmbH', country: 'DE', continent: 'EMEA', tier: 'PREFERRED', incoterm: 'EXW', category: 'FST', processing: 5, onboardedOn: '2019-11-25', priceFactor: 1.05, reliability: 'high' },
  { code: 'SUP-010', name: 'Takumi Precision Tools', country: 'JP', continent: 'APAC', tier: 'PREFERRED', incoterm: 'CIF', category: 'HTL', processing: 6, onboardedOn: '2020-07-13', priceFactor: 1.08, reliability: 'high' },
  { code: 'SUP-011', name: 'Meseta Chemical Supply', country: 'MX', continent: 'NA', tier: 'APPROVED', incoterm: 'FOB', category: 'CHM', processing: 5, onboardedOn: '2021-08-30', priceFactor: 0.97, reliability: 'low' },
  { code: 'SUP-012', name: 'Guardline Protective Wear', country: 'VN', continent: 'APAC', tier: 'APPROVED', incoterm: 'FOB', category: 'SAF', processing: 8, onboardedOn: '2022-01-24', priceFactor: 0.91, reliability: 'low' },
  { code: 'SUP-013', name: 'Harborview Packaging Solutions', country: 'NL', continent: 'EMEA', tier: 'APPROVED', incoterm: 'DDP', category: 'PKG', processing: 4, onboardedOn: '2020-03-09', priceFactor: 1.02, reliability: 'mid' },
  { code: 'SUP-014', name: 'Silverline Electrical Supply', country: 'US', continent: 'NA', tier: 'APPROVED', incoterm: 'FOB', category: 'ELC', processing: 3, onboardedOn: '2022-09-12', priceFactor: 1.06, reliability: 'mid' },
  { code: 'SUP-015', name: 'Bolt & Anchor Trading', country: 'CN', continent: 'APAC', tier: 'APPROVED', incoterm: 'CIF', category: 'FST', processing: 8, onboardedOn: '2021-05-17', priceFactor: 0.9, reliability: 'low' },
  { code: 'SUP-016', name: 'Crescent Lab Chemicals', country: 'IN', continent: 'APAC', tier: 'CONDITIONAL', incoterm: 'CIF', category: 'CHM', processing: 9, onboardedOn: '2023-02-06', priceFactor: 0.94, reliability: 'low' },
  { code: 'SUP-017', name: 'Northstar Hand Tools', country: 'PL', continent: 'EMEA', tier: 'CONDITIONAL', incoterm: 'EXW', category: 'HTL', processing: 7, onboardedOn: '2023-04-24', priceFactor: 0.92, reliability: 'low' },
  { code: 'SUP-018', name: 'Evergreen Safety Products', country: 'MY', continent: 'APAC', tier: 'CONDITIONAL', incoterm: 'FOB', category: 'SAF', processing: 9, onboardedOn: '2023-07-10', priceFactor: 0.89, reliability: 'low' },
];

interface ProductSeed {
  sku: string;
  name: string;
  category: string;
  pack: number;
  unitCost: number;
  weight: number;
}

const PRODUCT_SEEDS: ProductSeed[] = [
  // Packaging
  { sku: 'PKG-CRT-0120', name: 'Corrugated Shipping Carton, 12 x 10 x 8 in', category: 'PKG', pack: 50, unitCost: 118, weight: 410 },
  { sku: 'PKG-CRT-0180', name: 'Corrugated Shipping Carton, 18 x 18 x 16 in', category: 'PKG', pack: 50, unitCost: 246, weight: 960 },
  { sku: 'PKG-CRT-0240', name: 'Double-Wall Carton, 24 x 20 x 20 in', category: 'PKG', pack: 12, unitCost: 612, weight: 1850 },
  { sku: 'PKG-TAP-0048', name: 'Packing Tape, Clear, 48 mm x 100 m', category: 'PKG', pack: 24, unitCost: 289, weight: 320 },
  { sku: 'PKG-TAP-0072', name: 'Packing Tape, Brown, 72 mm x 100 m', category: 'PKG', pack: 24, unitCost: 412, weight: 460 },
  { sku: 'PKG-STR-1500', name: 'Stretch Wrap Film, 18 in x 1500 ft', category: 'PKG', pack: 6, unitCost: 2140, weight: 2700 },
  { sku: 'PKG-BUB-0175', name: 'Bubble Wrap Roll, 12 in x 175 ft', category: 'PKG', pack: 6, unitCost: 1875, weight: 1600 },
  { sku: 'PKG-PLT-4840', name: 'Wooden Pallet, 48 x 40 in', category: 'PKG', pack: 1, unitCost: 1450, weight: 22000 },
  { sku: 'PKG-FOM-0014', name: 'Loose-Fill Packing Peanuts, 14 cu ft', category: 'PKG', pack: 1, unitCost: 1890, weight: 1200 },
  { sku: 'PKG-MLR-1015', name: 'Poly Mailer, 10 x 15 in', category: 'PKG', pack: 500, unitCost: 14, weight: 18 },
  { sku: 'PKG-LBL-0406', name: 'Thermal Shipping Label Roll, 4 x 6 in', category: 'PKG', pack: 12, unitCost: 690, weight: 520 },
  { sku: 'PKG-DIV-1200', name: 'Corrugated Cell Divider Insert', category: 'PKG', pack: 100, unitCost: 64, weight: 150 },
  { sku: 'PKG-STP-0012', name: 'Polypropylene Strapping Coil, 1/2 in', category: 'PKG', pack: 1, unitCost: 3875, weight: 12000 },
  { sku: 'PKG-VCI-2436', name: 'VCI Anti-Corrosion Bag, 24 x 36 in', category: 'PKG', pack: 250, unitCost: 38, weight: 30 },
  // Fasteners
  { sku: 'FST-HXB-0816', name: 'Hex Bolt, Grade 8, 1/2-13 x 2 in', category: 'FST', pack: 100, unitCost: 42, weight: 60 },
  { sku: 'FST-HXB-0620', name: 'Hex Bolt, Grade 5, 3/8-16 x 1-1/2 in', category: 'FST', pack: 250, unitCost: 17, weight: 32 },
  { sku: 'FST-NUT-0813', name: 'Hex Nut, Grade 8, 1/2-13', category: 'FST', pack: 500, unitCost: 6, weight: 18 },
  { sku: 'FST-WSH-0850', name: 'Flat Washer, Zinc, 1/2 in', category: 'FST', pack: 500, unitCost: 3, weight: 9 },
  { sku: 'FST-LWS-0625', name: 'Split Lock Washer, 3/8 in', category: 'FST', pack: 500, unitCost: 2, weight: 4 },
  { sku: 'FST-SMS-1034', name: 'Sheet Metal Screw, #10 x 3/4 in', category: 'FST', pack: 500, unitCost: 3, weight: 3 },
  { sku: 'FST-WDS-0815', name: 'Wood Screw, #8 x 1-1/2 in', category: 'FST', pack: 500, unitCost: 2, weight: 3 },
  { sku: 'FST-MCS-0832', name: 'Machine Screw, Stainless, 8-32 x 1/2 in', category: 'FST', pack: 500, unitCost: 5, weight: 2 },
  { sku: 'FST-ANC-0375', name: 'Wedge Anchor, 3/8 x 3 in', category: 'FST', pack: 50, unitCost: 78, weight: 70 },
  { sku: 'FST-RVT-0187', name: 'Blind Rivet, Aluminum, 3/16 in', category: 'FST', pack: 500, unitCost: 4, weight: 2 },
  { sku: 'FST-THR-0038', name: 'Threaded Rod, 3/8-16 x 6 ft', category: 'FST', pack: 12, unitCost: 684, weight: 1500 },
  { sku: 'FST-SHC-1024', name: 'Socket Head Cap Screw, 10-24 x 1 in', category: 'FST', pack: 100, unitCost: 11, weight: 6 },
  { sku: 'FST-EYB-0050', name: 'Forged Eye Bolt, 1/2 in', category: 'FST', pack: 24, unitCost: 395, weight: 180 },
  { sku: 'FST-CTP-0125', name: 'Cotter Pin, Zinc, 1/8 x 1-1/2 in', category: 'FST', pack: 500, unitCost: 2, weight: 2 },
  // Electronic Components
  { sku: 'ELC-PLC-0024', name: 'Programmable Logic Controller, 24 I/O', category: 'ELC', pack: 1, unitCost: 48900, weight: 900 },
  { sku: 'ELC-HMI-0007', name: 'Touchscreen Operator Panel, 7 in', category: 'ELC', pack: 1, unitCost: 62500, weight: 1400 },
  { sku: 'ELC-VFD-0002', name: 'Variable Frequency Drive, 2 HP', category: 'ELC', pack: 1, unitCost: 38400, weight: 3200 },
  { sku: 'ELC-PSU-2410', name: 'DIN-Rail Power Supply, 24 V 10 A', category: 'ELC', pack: 6, unitCost: 11800, weight: 850 },
  { sku: 'ELC-REL-2404', name: 'Industrial Relay, 24 VDC, 4PDT', category: 'ELC', pack: 12, unitCost: 1420, weight: 60 },
  { sku: 'ELC-PRX-1812', name: 'Inductive Proximity Sensor, M18', category: 'ELC', pack: 12, unitCost: 3150, weight: 90 },
  { sku: 'ELC-PHE-0500', name: 'Photoelectric Sensor, Diffuse, 500 mm', category: 'ELC', pack: 6, unitCost: 4875, weight: 110 },
  { sku: 'ELC-CBL-1650', name: 'Shielded Control Cable, 16 AWG, 50 m', category: 'ELC', pack: 6, unitCost: 8900, weight: 4200 },
  { sku: 'ELC-TRM-0425', name: 'DIN-Rail Terminal Block, 4 mm', category: 'ELC', pack: 100, unitCost: 185, weight: 12 },
  { sku: 'ELC-MCB-1620', name: 'Miniature Circuit Breaker, 1-Pole 20 A', category: 'ELC', pack: 12, unitCost: 1640, weight: 120 },
  { sku: 'ELC-CNT-3224', name: 'Motor Contactor, 32 A, 24 VAC Coil', category: 'ELC', pack: 6, unitCost: 6650, weight: 420 },
  { sku: 'ELC-ENC-1024', name: 'Rotary Encoder, 1024 PPR', category: 'ELC', pack: 1, unitCost: 21900, weight: 300 },
  { sku: 'ELC-FUS-0010', name: 'Cartridge Fuse, 10 A, Time-Delay', category: 'ELC', pack: 100, unitCost: 245, weight: 8 },
  // Safety Equipment
  { sku: 'SAF-GLS-0024', name: FEATURED_PRODUCT, category: 'SAF', pack: FEATURED_CASE_PACK, unitCost: 385, weight: 45 },
  { sku: 'SAF-GLV-0100', name: 'Nitrile Exam Gloves, Large, Box of 100', category: 'SAF', pack: 12, unitCost: 1190, weight: 700 },
  { sku: 'SAF-HHT-0002', name: 'Hard Hat, Type II, White', category: 'SAF', pack: 12, unitCost: 1840, weight: 450 },
  { sku: 'SAF-VST-0302', name: 'Hi-Visibility Safety Vest, Class 2', category: 'SAF', pack: 50, unitCost: 520, weight: 150 },
  { sku: 'SAF-EAR-0200', name: 'Corded Foam Ear Plugs, Dispenser Pack', category: 'SAF', pack: 12, unitCost: 2350, weight: 400 },
  { sku: 'SAF-RSP-0095', name: 'N95 Particulate Respirator, Box of 20', category: 'SAF', pack: 12, unitCost: 2680, weight: 300 },
  { sku: 'SAF-HRN-0500', name: 'Full-Body Safety Harness, Universal', category: 'SAF', pack: 1, unitCost: 11900, weight: 1900 },
  { sku: 'SAF-LYD-0006', name: 'Shock-Absorbing Lanyard, 6 ft', category: 'SAF', pack: 6, unitCost: 5450, weight: 1100 },
  { sku: 'SAF-BTS-0010', name: 'Steel-Toe Work Boots, Size 10', category: 'SAF', pack: 6, unitCost: 8900, weight: 1600 },
  { sku: 'SAF-FAK-0050', name: 'Industrial First Aid Kit, 50 Person', category: 'SAF', pack: 1, unitCost: 7400, weight: 2600 },
  { sku: 'SAF-EYW-0016', name: 'Portable Eyewash Station, 16 gal', category: 'SAF', pack: 1, unitCost: 42500, weight: 9000 },
  { sku: 'SAF-FSH-0080', name: 'Face Shield, Clear Polycarbonate', category: 'SAF', pack: 24, unitCost: 845, weight: 220 },
  { sku: 'SAF-KNE-0001', name: 'Gel Knee Pads, Pair', category: 'SAF', pack: 12, unitCost: 1790, weight: 600 },
  // Chemicals
  { sku: 'CHM-IPA-0005', name: 'Isopropyl Alcohol 99%, 5 gal Pail', category: 'CHM', pack: 1, unitCost: 6850, weight: 17000 },
  { sku: 'CHM-DGR-0001', name: 'Citrus Degreaser, 1 gal', category: 'CHM', pack: 6, unitCost: 1840, weight: 4100 },
  { sku: 'CHM-LUB-0011', name: 'Penetrating Lubricant, 11 oz Aerosol', category: 'CHM', pack: 12, unitCost: 695, weight: 380 },
  { sku: 'CHM-TLC-0250', name: 'Thread-Locking Compound, 250 ml', category: 'CHM', pack: 12, unitCost: 3480, weight: 300 },
  { sku: 'CHM-CUT-0005', name: 'Water-Soluble Cutting Fluid, 5 gal', category: 'CHM', pack: 1, unitCost: 9900, weight: 19000 },
  { sku: 'CHM-HYD-0055', name: 'Hydraulic Oil ISO 46, 55 gal Drum', category: 'CHM', pack: 1, unitCost: 64800, weight: 190000 },
  { sku: 'CHM-GRS-0014', name: 'Lithium Grease, 14 oz Cartridge', category: 'CHM', pack: 12, unitCost: 540, weight: 450 },
  { sku: 'CHM-ACT-0001', name: 'Acetone, Technical Grade, 1 gal', category: 'CHM', pack: 6, unitCost: 2150, weight: 3200 },
  { sku: 'CHM-EPX-0050', name: 'Two-Part Epoxy Adhesive, 50 ml', category: 'CHM', pack: 24, unitCost: 1290, weight: 90 },
  { sku: 'CHM-ABS-0040', name: 'Absorbent Granules, 40 lb Bag', category: 'CHM', pack: 1, unitCost: 1990, weight: 18000 },
  { sku: 'CHM-CLN-0011', name: 'Electrical Contact Cleaner, 11 oz Aerosol', category: 'CHM', pack: 12, unitCost: 785, weight: 350 },
  { sku: 'CHM-PNT-0012', name: 'Fluorescent Marking Paint, Orange', category: 'CHM', pack: 12, unitCost: 610, weight: 480 },
  { sku: 'CHM-RST-0001', name: 'Rust Converter, 1 gal', category: 'CHM', pack: 6, unitCost: 3350, weight: 4300 },
  // Hand Tools
  { sku: 'HTL-WRN-0010', name: 'Combination Wrench Set, 10 pc', category: 'HTL', pack: 6, unitCost: 5890, weight: 1900 },
  { sku: 'HTL-TRQ-0080', name: 'Torque Wrench, 3/8 in Drive', category: 'HTL', pack: 1, unitCost: 14500, weight: 1400 },
  { sku: 'HTL-SCR-0006', name: 'Screwdriver Set, 6 pc', category: 'HTL', pack: 12, unitCost: 2450, weight: 700 },
  { sku: 'HTL-PLR-0009', name: "Lineman's Pliers, 9 in", category: 'HTL', pack: 12, unitCost: 2380, weight: 450 },
  { sku: 'HTL-HMR-0016', name: 'Claw Hammer, 16 oz', category: 'HTL', pack: 12, unitCost: 1690, weight: 700 },
  { sku: 'HTL-UTK-0001', name: 'Retractable Utility Knife', category: 'HTL', pack: 24, unitCost: 690, weight: 180 },
  { sku: 'HTL-BLD-0100', name: 'Utility Knife Blade Dispenser', category: 'HTL', pack: 24, unitCost: 1190, weight: 250 },
  { sku: 'HTL-TPM-0025', name: 'Tape Measure, 25 ft', category: 'HTL', pack: 24, unitCost: 1050, weight: 350 },
  { sku: 'HTL-LVL-0024', name: 'Aluminum Level, 24 in', category: 'HTL', pack: 6, unitCost: 2890, weight: 800 },
  { sku: 'HTL-SKT-0040', name: 'Socket Set, 1/2 in Drive, 40 pc', category: 'HTL', pack: 1, unitCost: 18900, weight: 5200 },
  { sku: 'HTL-HEX-0013', name: 'Hex Key Set, Metric, 13 pc', category: 'HTL', pack: 24, unitCost: 1350, weight: 300 },
  { sku: 'HTL-CLP-0012', name: 'Bar Clamp, 12 in', category: 'HTL', pack: 12, unitCost: 1580, weight: 900 },
  { sku: 'HTL-FIL-0008', name: 'Mill File, 8 in', category: 'HTL', pack: 12, unitCost: 890, weight: 250 },
];

interface CarrierSeed {
  code: string;
  name: string;
  mode: Mode;
  delay: Reliability;
}

const CARRIERS: CarrierSeed[] = [
  { code: 'RDL', name: 'Redline Freight', mode: 'ROAD', delay: 'mid' },
  { code: 'SMH', name: 'Summit Haulage', mode: 'ROAD', delay: 'high' },
  { code: 'TCR', name: 'Transcontinental Rail Services', mode: 'RAIL', delay: 'mid' },
  { code: 'BWO', name: 'Bluewater Ocean Lines', mode: 'SEA', delay: 'low' },
  { code: 'HLS', name: 'Harborlink Shipping', mode: 'SEA', delay: 'mid' },
  { code: 'SKB', name: 'Skybridge Air Cargo', mode: 'AIR', delay: 'high' },
];

const BUYERS: Record<Continent, string[]> = {
  NA: ['Dana Whitfield', 'Marcus Delgado', 'Priya Natarajan'],
  EMEA: ['Elena Brandt', 'Tomasz Kowalczyk'],
  APAC: ['Kenji Morita', 'Mei Ling Tan'],
};

const TIER_TERMS: Record<Tier, string> = {
  STRATEGIC: 'NET60',
  PREFERRED: 'NET45',
  APPROVED: 'NET30',
  CONDITIONAL: 'NET30',
};

const TIER_VOLUME: Record<Tier, number> = {
  STRATEGIC: 1.2,
  PREFERRED: 1.05,
  APPROVED: 0.95,
  CONDITIONAL: 0.9,
};

/** Days of dispatch slip past the supplier's standard processing time. */
const SLIP: Record<Reliability, readonly (readonly [number, number])[]> = {
  high: [[-1, 0.2], [0, 0.55], [1, 0.15], [3, 0.1]],
  mid: [[-1, 0.12], [0, 0.45], [1, 0.18], [3, 0.15], [6, 0.1]],
  low: [[0, 0.35], [1, 0.2], [3, 0.2], [6, 0.15], [10, 0.1]],
};
const MAX_SLIP = 10;

/** Days a carrier delivers after its own ETA (negative = early). */
const DELAY: Record<Reliability, readonly (readonly [number, number])[]> = {
  high: [[-1, 0.15], [0, 0.6], [1, 0.15], [2, 0.07], [3, 0.03]],
  mid: [[-1, 0.1], [0, 0.5], [1, 0.18], [2, 0.1], [3, 0.07], [5, 0.05]],
  low: [[-2, 0.08], [0, 0.4], [1, 0.15], [2, 0.12], [4, 0.13], [7, 0.12]],
};
const MAX_DELAY = 7;

const TRANSIT_RANGE: Record<Route, readonly [number, number]> = {
  ROAD: [2, 5],
  RAIL: [5, 9],
  SEA_SHORT: [6, 11],
  SEA_LONG: [18, 34],
  AIR: [2, 4],
};

/** The transit time a buyer plans with when promising a delivery date. */
const STD_TRANSIT: Record<Route, number> = {
  ROAD: 4,
  RAIL: 8,
  SEA_SHORT: 9,
  SEA_LONG: 27,
  AIR: 3,
};

const INCOTERM_FREIGHT: Record<Incoterm, number> = {
  EXW: 1.15,
  FOB: 1.0,
  CIF: 0.45,
  DDP: 0,
};

/* --------------------------------------------------------------- helpers */

/** Largest-remainder split of `total` over `weights`; sums back to `total`. */
function allocate(total: number, weights: readonly number[]): number[] {
  const n = weights.length;
  const sum = weights.reduce((a, b) => a + b, 0);
  if (n === 0) return [];
  if (total === 0) return weights.map(() => 0);
  if (sum <= 0) {
    const out = weights.map(() => 0);
    out[0] = total;
    return out;
  }
  const exact = weights.map((w) => (total * w) / sum);
  const base = exact.map((e) => Math.floor(e));
  const remainder = total - base.reduce((a, b) => a + b, 0);
  const order = exact
    .map((e, i) => ({ i, frac: e - Math.floor(e) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (let k = 0; k < remainder; k++) base[order[k % n].i] += 1;
  return base;
}

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
  return Math.round(
    (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000,
  );
}

function sum(values: readonly number[]): number {
  return values.reduce((a, b) => a + b, 0);
}

function modeOf(route: Route): Mode {
  if (route === 'SEA_SHORT' || route === 'SEA_LONG') return 'SEA';
  return route;
}

const in2024 = (date: string) => date >= '2024-01-01' && date <= '2024-12-31';
const in2025 = (date: string) => date >= '2025-01-01' && date <= '2025-12-31';

/* --------------------------------------------------------- build entities */

interface Supplier extends SupplierSeed {
  idx: number;
  id: number;
  leadTime: number;
  /** Target units-weighted acceptance ratio on inspected receipts (S1). */
  acceptanceTarget: number;
  /** Chance an inspected lot fails, before the S1 tuning. */
  failRate: number;
}

const regionIdxByCode = new Map(REGIONS.map((r, i) => [r.code, i]));
const categoryIdxByCode = new Map(CATEGORIES.map((c, i) => [c.code, i]));
const continentOfWarehouse = (w: number) =>
  REGIONS[regionIdxByCode.get(WAREHOUSES[w].region)!].continent;

// S1: an evenly spaced acceptance ladder, best tier first, shuffled within tier.
const acceptanceRank = new Map<number, number>();
{
  let rank = 0;
  for (const tier of TIERS) {
    const inTier = SUPPLIER_SEEDS.map((s, i) => ({ s, i })).filter((x) => x.s.tier === tier);
    for (const { i } of rng.shuffle(inTier)) acceptanceRank.set(i, rank++);
  }
}

const suppliers: Supplier[] = SUPPLIER_SEEDS.map((seed, idx) => {
  const homeRoute: Route = seed.continent === 'APAC' ? 'SEA_LONG' : 'ROAD';
  const acceptanceTarget = Number(
    (ACCEPTANCE_TOP - ACCEPTANCE_STEP * acceptanceRank.get(idx)!).toFixed(4),
  );
  return {
    ...seed,
    idx,
    id: idx + 1,
    leadTime: seed.processing + STD_TRANSIT[homeRoute] + rng.int(2, 5),
    acceptanceTarget,
    failRate: clamp(((1 - acceptanceTarget) / 0.65) * 0.9, 0.03, 0.4),
  };
});

const supplierIdxByName = new Map(suppliers.map((s) => [s.name, s.idx]));
const TIED_IDX = TIED_SUPPLIERS.map((name) => supplierIdxByName.get(name)!);
const W1 = supplierIdxByName.get(PO_COUNT_WINNER)!;
const W2 = supplierIdxByName.get(SPEND_WINNER)!;
const W3 = supplierIdxByName.get(UNITS_WINNER)!;
const WINNERS = [W1, W2, W3];
assert(TIED_IDX.every((i) => i !== undefined) && WINNERS.every((i) => i !== undefined), 'planted supplier names must exist');
assert(new Set([...TIED_IDX, ...WINNERS]).size === 5, 'tied suppliers and the three winners must be five different suppliers');

interface Product extends ProductSeed {
  idx: number;
  id: number;
  categoryIdx: number;
}

const products: Product[] = PRODUCT_SEEDS.map((seed, idx) => ({
  ...seed,
  idx,
  id: idx + 1,
  categoryIdx: categoryIdxByCode.get(seed.category)!,
}));
const FEATURED_IDX = products.findIndex((p) => p.name === FEATURED_PRODUCT);

assert(products.length === 80, 'the catalogue must hold 80 products');
assert(new Set(products.map((p) => p.sku)).size === products.length, 'SKUs must be unique');
assert(new Set(products.map((p) => p.name)).size === products.length, 'product names must be unique');
assert(products.every((p) => CASE_PACKS.includes(p.pack)), 'every case pack must be one of the standard pack sizes');
assert(suppliers.length === 18, 'there must be 18 suppliers');
assert(new Set(suppliers.map((s) => s.name)).size === suppliers.length, 'supplier names must be unique');

const productsByCategory = new Map<string, number[]>();
for (const p of products) {
  const list = productsByCategory.get(p.category) ?? [];
  list.push(p.idx);
  productsByCategory.set(p.category, list);
}

/* ------------------------------------ S4 + S7: purchase orders per supplier */

// PO counts are allocated, not sampled, so the 41/41 tie and the PO-count
// winner are exact by construction; the others land in a band well clear of
// both (every other supplier keeps >= 45 POs even after its test POs go).
const poCountBySupplier = new Array<number>(suppliers.length).fill(0);
{
  for (const idx of TIED_IDX) poCountBySupplier[idx] = TIE_COUNT;
  poCountBySupplier[W1] = PO_COUNT_WINNER_TOTAL;
  const others = suppliers.filter((s) => !TIED_IDX.includes(s.idx) && s.idx !== W1);
  const remaining = TOTAL_POS - TIE_COUNT * TIED_IDX.length - PO_COUNT_WINNER_TOTAL;
  const weights = others.map((s) => TIER_VOLUME[s.tier] * rng.float(0.92, 1.08, 4));
  const split = allocate(remaining, weights);
  others.forEach((s, i) => (poCountBySupplier[s.idx] = split[i]));
  // Squeeze into [floor, ceiling] one PO at a time, deterministically.
  for (let guard = 0; guard < 1000; guard++) {
    const low = others.find((s) => poCountBySupplier[s.idx] < OTHER_PO_FLOOR);
    const high = others.find((s) => poCountBySupplier[s.idx] > OTHER_PO_CEILING);
    if (!low && !high) break;
    const byCount = [...others].sort(
      (a, b) => poCountBySupplier[b.idx] - poCountBySupplier[a.idx] || a.idx - b.idx,
    );
    if (low) {
      poCountBySupplier[byCount[0].idx] -= 1;
      poCountBySupplier[low.idx] += 1;
    } else if (high) {
      poCountBySupplier[high.idx] -= 1;
      poCountBySupplier[byCount[byCount.length - 1].idx] += 1;
    }
  }
}
assert(sum(poCountBySupplier) === TOTAL_POS, `PO counts must sum to ${TOTAL_POS}`);

/* --------------------------------------------------------- PO skeleton */

interface PoRow {
  key: number;
  id: number;
  poNumber: string;
  supplierIdx: number;
  warehouseIdx: number;
  orderedOn: string;
  promisedOn: string;
  route: Route;
  status: PoStatus;
  paymentTerms: string;
  buyer: string;
  isTest: boolean;
  /** Carries a planted fact that must survive the default filter. */
  protected: boolean;
  /** Its undelivered shipment must be IN_TRANSIT (S9). */
  forceInTransit: boolean;
}

function drawRoute(from: Continent, to: Continent): Route {
  if (from === to && from !== 'APAC') return rng.weighted([['ROAD', 0.8], ['RAIL', 0.2]] as const);
  if (from === to) return rng.weighted([['SEA_SHORT', 0.85], ['AIR', 0.15]] as const);
  return rng.weighted([['SEA_LONG', 0.85], ['AIR', 0.15]] as const);
}

function maxTransit(route: Route): number {
  return Math.max(TRANSIT_RANGE[route][1], TRANSIT_RANGE.AIR[1]);
}

/** Days from order to the last receipt when every shipment arrives. */
function horizonFull(po: PoRow): number {
  const s = suppliers[po.supplierIdx];
  return s.processing + MAX_SLIP + 2 * 15 + maxTransit(po.route) + MAX_DELAY + 2;
}

/** Days from order to the first receipt. */
function horizonFirst(po: PoRow): number {
  const s = suppliers[po.supplierIdx];
  return s.processing + MAX_SLIP + maxTransit(po.route) + MAX_DELAY + 2;
}

function statusWeights(age: number): readonly (readonly [PoStatus, number])[] {
  if (age < 45) return [['ISSUED', 0.55], ['PARTIALLY_RECEIVED', 0.35], ['RECEIVED', 0.1]];
  if (age < 120) return [['ISSUED', 0.22], ['PARTIALLY_RECEIVED', 0.33], ['RECEIVED', 0.38], ['CLOSED', 0.07]];
  if (age < 365) return [['ISSUED', 0.12], ['PARTIALLY_RECEIVED', 0.11], ['RECEIVED', 0.47], ['CLOSED', 0.3]];
  return [['ISSUED', 0.09], ['PARTIALLY_RECEIVED', 0.06], ['RECEIVED', 0.44], ['CLOSED', 0.41]];
}

/** Downgrade a status the calendar cannot support by 2025-12-31. */
function feasibleStatus(po: PoRow, wanted: PoStatus): PoStatus {
  const age = daysBetween(po.orderedOn, WINDOW_END);
  if ((wanted === 'RECEIVED' || wanted === 'CLOSED') && age < horizonFull(po)) {
    return age >= horizonFirst(po) ? 'PARTIALLY_RECEIVED' : 'ISSUED';
  }
  if (wanted === 'PARTIALLY_RECEIVED' && age < horizonFirst(po)) return 'ISSUED';
  return wanted;
}

const pos: PoRow[] = [];
{
  let key = 0;
  for (const supplier of suppliers) {
    const warehouseWeights = WAREHOUSES.map(
      (w, i) => [i, w.weight * (continentOfWarehouse(i) === supplier.continent ? 1.6 : 1)] as const,
    );
    for (let n = 0; n < poCountBySupplier[supplier.idx]; n++) {
      const warehouseIdx = rng.weighted(warehouseWeights);
      const orderedOn = rng.dateBetween(WINDOW_START, WINDOW_END);
      const route = drawRoute(supplier.continent, continentOfWarehouse(warehouseIdx));
      const promisedOn = addDays(
        orderedOn,
        supplier.processing + STD_TRANSIT[route] + rng.int(1, 5),
      );
      const otherTerms = ['NET30', 'NET45', 'NET60'].filter((t) => t !== TIER_TERMS[supplier.tier]);
      const po: PoRow = {
        key: key++,
        id: 0,
        poNumber: '',
        supplierIdx: supplier.idx,
        warehouseIdx,
        orderedOn,
        promisedOn,
        route,
        status: 'ISSUED',
        paymentTerms: rng.chance(0.85) ? TIER_TERMS[supplier.tier] : rng.pick(otherTerms),
        buyer: rng.pick(BUYERS[continentOfWarehouse(warehouseIdx)]),
        isTest: false,
        protected: false,
        forceInTransit: false,
      };
      const roll = rng.next();
      const wanted: PoStatus =
        roll < 0.04
          ? 'DRAFT'
          : roll < 0.12
            ? 'CANCELLED'
            : rng.weighted(statusWeights(daysBetween(orderedOn, WINDOW_END)));
      po.status = feasibleStatus(po, wanted);
      pos.push(po);
    }
  }
}

// Chronological ids make the generated SQL readable and the fixture stable.
pos.sort((a, b) => (a.orderedOn < b.orderedOn ? -1 : a.orderedOn > b.orderedOn ? 1 : a.key - b.key));
pos.forEach((po, i) => {
  po.id = i + 1;
  po.poNumber = `PO-${po.orderedOn.slice(0, 4)}-${pad(i + 1, 6)}`;
});

/* ---------------- S12: every tier has a 2024 DRAFT and a 2024 CANCELLED PO */

for (const tier of TIERS) {
  for (const status of ['DRAFT', 'CANCELLED'] as const) {
    const tierPos = pos.filter((po) => suppliers[po.supplierIdx].tier === tier && in2024(po.orderedOn));
    let target = tierPos.find((po) => po.status === status);
    if (!target) {
      target = rng.shuffle(tierPos.filter((po) => po.status === 'RECEIVED' || po.status === 'CLOSED'))[0];
      assert(target !== undefined, `S12: tier ${tier} has no 2024 PO to turn ${status}`);
      target.status = status;
    }
    target.protected = true;
  }
}

/* ------------- S9: every supplier has a recent PO with a shipment in transit */

for (const supplier of suppliers) {
  const own = pos.filter((po) => po.supplierIdx === supplier.idx);
  const recentWindow = (po: PoRow) => {
    const age = daysBetween(po.orderedOn, WINDOW_END);
    return age <= RECENT_PR_DAYS && age >= horizonFirst(po);
  };
  let target = own.find((po) => po.status === 'PARTIALLY_RECEIVED' && recentWindow(po));
  if (!target) {
    target = own
      .filter((po) => recentWindow(po) && po.status !== 'DRAFT' && po.status !== 'CANCELLED' && !po.protected)
      .sort((a, b) => (a.orderedOn > b.orderedOn ? -1 : a.orderedOn < b.orderedOn ? 1 : a.id - b.id))[0];
    assert(target !== undefined, `S9: ${supplier.name} has no recent PO to hold an in-transit shipment`);
    target.status = 'PARTIALLY_RECEIVED';
  }
  target.protected = true;
  target.forceInTransit = true;
}

/* ------------------------------------------------------------ PO lines */

interface LineRow {
  id: number;
  poIdx: number;
  lineNumber: number;
  productIdx: number;
  cases: number;
  unitPrice: number;
  total: number;
}

const LINE_COUNTS: readonly (readonly [number, number])[] = [
  [1, 0.15],
  [2, 0.3],
  [3, 0.3],
  [4, 0.25],
];

function priceFor(productIdx: number, supplierIdx: number): number {
  const product = products[productIdx];
  return Math.max(
    1,
    Math.round(product.unitCost * suppliers[supplierIdx].priceFactor * rng.float(0.96, 1.04, 4)),
  );
}

function casesFor(productIdx: number, supplierIdx: number, unitPrice: number): number {
  const product = products[productIdx];
  const category = CATEGORIES[product.categoryIdx];
  const dollars = Math.exp(rng.float(Math.log(300), Math.log(6000), 6));
  const target = dollars * 100 * category.lineValue * TIER_VOLUME[suppliers[supplierIdx].tier];
  return clamp(Math.round(target / (product.pack * unitPrice)), 1, 240);
}

function refreshTotal(line: LineRow): void {
  line.total = line.cases * products[line.productIdx].pack * line.unitPrice;
}

/** Point a line at another product, re-pricing it the way a buyer would. */
function repoint(line: LineRow, productIdx: number): void {
  const supplierIdx = pos[line.poIdx].supplierIdx;
  line.productIdx = productIdx;
  line.unitPrice = priceFor(productIdx, supplierIdx);
  line.cases = casesFor(productIdx, supplierIdx, line.unitPrice);
  refreshTotal(line);
}

const lines: LineRow[] = [];
const linesByPo: number[][] = pos.map(() => []);
pos.forEach((po, poIdx) => {
  const supplier = suppliers[po.supplierIdx];
  const pool = productsByCategory.get(supplier.category)!;
  let count = rng.weighted(LINE_COUNTS);
  if (po.status === 'PARTIALLY_RECEIVED') count = Math.max(2, count);
  const picked = rng.shuffle(pool).slice(0, count);
  picked.forEach((productIdx, i) => {
    const unitPrice = priceFor(productIdx, po.supplierIdx);
    const line: LineRow = {
      id: lines.length + 1,
      poIdx,
      lineNumber: i + 1,
      productIdx,
      cases: casesFor(productIdx, po.supplierIdx, unitPrice),
      unitPrice,
      total: 0,
    };
    refreshTotal(line);
    lines.push(line);
    linesByPo[poIdx].push(line.id - 1);
  });
});

const lineOf = (lineIdx: number) => lines[lineIdx];
const poHasProduct = (poIdx: number, productIdx: number) =>
  linesByPo[poIdx].some((l) => lines[l].productIdx === productIdx);
const isCommitted = (po: PoRow) => po.status !== 'DRAFT' && po.status !== 'CANCELLED';

/* ------------- S14: the featured product, ordered in cases of 24, in 2024 */

{
  const safPool = productsByCategory.get('SAF')!;
  // Never on a DRAFT or CANCELLED 2024 PO, so "units ordered" has one answer.
  for (const line of lines) {
    const po = pos[line.poIdx];
    if (line.productIdx !== FEATURED_IDX || !in2024(po.orderedOn) || isCommitted(po)) continue;
    const replacement = safPool.find((p) => p !== FEATURED_IDX && !poHasProduct(line.poIdx, p))!;
    repoint(line, replacement);
  }
  let featured = lines.filter((l) => l.productIdx === FEATURED_IDX && in2024(pos[l.poIdx].orderedOn));
  if (featured.length < FEATURED_MIN_LINES_2024) {
    const candidates = rng.shuffle(
      pos
        .map((po, poIdx) => ({ po, poIdx }))
        .filter(
          ({ po, poIdx }) =>
            suppliers[po.supplierIdx].category === 'SAF' &&
            in2024(po.orderedOn) &&
            isCommitted(po) &&
            !poHasProduct(poIdx, FEATURED_IDX),
        ),
    );
    for (const { poIdx } of candidates) {
      if (featured.length >= FEATURED_MIN_LINES_2024) break;
      repoint(lines[linesByPo[poIdx][linesByPo[poIdx].length - 1]], FEATURED_IDX);
      featured = lines.filter((l) => l.productIdx === FEATURED_IDX && in2024(pos[l.poIdx].orderedOn));
    }
  }
  for (const line of featured) pos[line.poIdx].protected = true;
}

/* -------------- S8: one product clearly on the most 2024 purchase-order lines */

function lines2024ByProduct(includeTest: boolean, committedOnly = false): Map<number, number> {
  const counts = new Map<number, number>(products.map((p) => [p.idx, 0]));
  for (const line of lines) {
    const po = pos[line.poIdx];
    if (!in2024(po.orderedOn) || (!includeTest && po.isTest)) continue;
    if (committedOnly && !isCommitted(po)) continue;
    counts.set(line.productIdx, counts.get(line.productIdx)! + 1);
  }
  return counts;
}

function rankProducts(counts: Map<number, number>): { idx: number; count: number }[] {
  return [...counts.entries()]
    .map(([idx, count]) => ({ idx, count }))
    .sort((a, b) => b.count - a.count || products[a.idx].name.localeCompare(products[b.idx].name));
}

const S8_TOP = (() => {
  const ranked = rankProducts(lines2024ByProduct(true)).filter((r) => r.idx !== FEATURED_IDX);
  return ranked[0].idx;
})();
{
  const topCategory = products[S8_TOP].category;
  const candidates = rng.shuffle(
    lines.filter((line) => {
      const po = pos[line.poIdx];
      return (
        in2024(po.orderedOn) &&
        isCommitted(po) &&
        suppliers[po.supplierIdx].category === topCategory &&
        line.productIdx !== S8_TOP &&
        line.productIdx !== FEATURED_IDX
      );
    }),
  );
  // The lead must hold whether or not DRAFT/CANCELLED lines are counted, so
  // only lines on committed POs are moved (each move lifts both counts).
  for (let guard = 0; guard < 200; guard++) {
    const clear = (ranked: { idx: number; count: number }[]) =>
      ranked[0].idx === S8_TOP && ranked[0].count - ranked[1].count >= 2;
    const all = rankProducts(lines2024ByProduct(true));
    const committed = rankProducts(lines2024ByProduct(true, true));
    if (clear(all) && clear(committed)) break;
    const ranked = clear(all) ? committed : all;
    const lead = ranked[0];
    const second = ranked[1];
    const rival = lead.idx === S8_TOP ? second.idx : lead.idx;
    const line =
      candidates.find((l) => l.productIdx === rival && !poHasProduct(l.poIdx, S8_TOP)) ??
      candidates.find((l) => l.productIdx !== S8_TOP && !poHasProduct(l.poIdx, S8_TOP));
    assert(line !== undefined, 'S8: ran out of lines to move onto the top product');
    repoint(line, S8_TOP);
  }
  for (const line of lines) {
    if (line.productIdx === S8_TOP && in2024(pos[line.poIdx].orderedOn)) pos[line.poIdx].protected = true;
  }
}

/* ---------------------------------------------------- shipment skeleton */

interface ShipmentRow {
  key: number;
  id: number;
  shipmentNumber: string;
  poIdx: number;
  seq: number;
  carrierIdx: number;
  mode: Mode;
  shippedOn: string;
  expectedOn: string;
  deliveredOn: string | null;
  status: ShipmentStatus;
  freight: number;
  goods: number;
  tracking: string | null;
  lineIdxs: number[];
}

const carriersByMode = new Map<Mode, number[]>();
CARRIERS.forEach((c, i) => {
  const list = carriersByMode.get(c.mode) ?? [];
  list.push(i);
  carriersByMode.set(c.mode, list);
});

let deliveryClamps = 0;
const shipmentsDraft: ShipmentRow[] = [];
pos.forEach((po, poIdx) => {
  if (po.status !== 'PARTIALLY_RECEIVED' && po.status !== 'RECEIVED' && po.status !== 'CLOSED') return;
  const supplier = suppliers[po.supplierIdx];
  const poLines = linesByPo[poIdx];
  const partial = po.status === 'PARTIALLY_RECEIVED';
  const wanted = partial
    ? rng.weighted([[2, 0.75], [3, 0.25]] as const)
    : rng.weighted([[1, 0.68], [2, 0.26], [3, 0.06]] as const);
  const count = Math.min(wanted, poLines.length);
  assert(!partial || count >= 2, `PO ${po.poNumber}: a partial receipt needs two shipments`);

  // Lines are shipped whole; the first `count` go one per shipment.
  const shuffled = rng.shuffle(poLines);
  const assignment: number[][] = Array.from({ length: count }, () => []);
  shuffled.forEach((lineIdx, i) => {
    assignment[i < count ? i : rng.int(0, count - 1)].push(lineIdx);
  });

  const delivered = assignment.map((_, k) => {
    if (!partial) return true;
    if (k === 0) return true;
    if (k === count - 1) return false;
    // A middle shipment may only have arrived if the calendar allows it.
    return rng.chance(0.5) && daysBetween(po.orderedOn, WINDOW_END) >= horizonFull(po);
  });

  const recent = daysBetween(po.orderedOn, WINDOW_END) <= RECENT_PR_DAYS;
  let previousShipped = '';
  for (let k = 0; k < count; k++) {
    const mode: Mode = k === 0 ? modeOf(po.route) : rng.chance(0.3) ? 'AIR' : modeOf(po.route);
    const transitRoute: Route = mode === 'AIR' ? 'AIR' : po.route;
    let shippedOn =
      k === 0
        ? addDays(po.orderedOn, supplier.processing + rng.weighted(SLIP[supplier.reliability]))
        : addDays(previousShipped, rng.int(4, 15));
    const transit = rng.int(TRANSIT_RANGE[transitRoute][0], TRANSIT_RANGE[transitRoute][1]);
    if (!delivered[k] && recent) {
      // Still on the water / road at the end of 2025: dispatched recently.
      shippedOn = addDays(WINDOW_END, -transit + rng.int(-3, 10));
      shippedOn = maxDate(shippedOn, addDays(previousShipped, 1));
    }
    shippedOn = minDate(maxDate(shippedOn, po.orderedOn), WINDOW_END);
    const carrierIdx = rng.pick(carriersByMode.get(mode)!);
    const expectedOn = addDays(shippedOn, transit);
    let deliveredOn: string | null = null;
    let status: ShipmentStatus;
    if (delivered[k]) {
      deliveredOn = maxDate(shippedOn, addDays(expectedOn, rng.weighted(DELAY[CARRIERS[carrierIdx].delay])));
      if (deliveredOn > WINDOW_END) {
        deliveredOn = WINDOW_END;
        deliveryClamps++;
      }
      status = 'DELIVERED';
    } else {
      const fresh = daysBetween(shippedOn, WINDOW_END) <= IN_TRANSIT_WINDOW_DAYS;
      status = fresh && (po.forceInTransit || !rng.chance(0.08)) ? 'IN_TRANSIT' : 'EXCEPTION';
    }
    shipmentsDraft.push({
      key: shipmentsDraft.length,
      id: 0,
      shipmentNumber: '',
      poIdx,
      seq: k,
      carrierIdx,
      mode,
      shippedOn,
      expectedOn,
      deliveredOn,
      status,
      freight: 0,
      goods: 0,
      tracking: null,
      lineIdxs: assignment[k],
    });
    previousShipped = shippedOn;
  }
});

// Shipments are numbered in dispatch order.
const shipments = [...shipmentsDraft].sort((a, b) =>
  a.shippedOn < b.shippedOn ? -1 : a.shippedOn > b.shippedOn ? 1 : a.key - b.key,
);
shipments.forEach((sh, i) => {
  sh.id = i + 1;
  sh.shipmentNumber = `SHP-${sh.shippedOn.slice(0, 4)}-${pad(i + 1, 6)}`;
});

const shipmentsByPo: number[][] = pos.map(() => []);
shipments.forEach((sh, i) => shipmentsByPo[sh.poIdx].push(i));
const deliveredLine = new Set<number>();
for (const sh of shipments) {
  if (sh.status === 'DELIVERED') for (const l of sh.lineIdxs) deliveredLine.add(l);
}

/* ----- S7: PO count, committed spend and units received pick three suppliers */

function spendBySupplier(includeTest: boolean): number[] {
  const totals = suppliers.map(() => 0);
  for (const line of lines) {
    const po = pos[line.poIdx];
    if (!isCommitted(po) || (!includeTest && po.isTest)) continue;
    totals[po.supplierIdx] += line.total;
  }
  return totals;
}

function unitsReceivedBySupplier(includeTest: boolean): number[] {
  const totals = suppliers.map(() => 0);
  lines.forEach((line, lineIdx) => {
    const po = pos[line.poIdx];
    if (!deliveredLine.has(lineIdx) || (!includeTest && po.isTest)) return;
    totals[po.supplierIdx] += line.cases * products[line.productIdx].pack;
  });
  return totals;
}

function poCounts(includeTest: boolean): number[] {
  const totals = suppliers.map(() => 0);
  for (const po of pos) if (includeTest || !po.isTest) totals[po.supplierIdx] += 1;
  return totals;
}

/** Spread `delta` (in the measure's own unit) over a supplier's best lines. */
function boost(lineIdxs: number[], delta: number, perCase: (line: LineRow) => number): void {
  const chosen = lineIdxs.slice(0, 12);
  let remaining = delta;
  chosen.forEach((lineIdx, i) => {
    const line = lines[lineIdx];
    const share = Math.ceil(remaining / (chosen.length - i));
    const extraCases = Math.ceil(share / perCase(line));
    line.cases += extraCases;
    refreshTotal(line);
    remaining -= extraCases * perCase(line);
  });
}

const boostLog: string[] = [];
for (let round = 0; round < 6; round++) {
  let changed = false;
  {
    const spend = spendBySupplier(true);
    const others = spend.filter((_, i) => i !== W2);
    const target = Math.ceil(Math.max(...others) * BOOST_MARGIN);
    if (spend[W2] < target) {
      const candidates = lines
        .map((l, i) => ({ l, i }))
        .filter(({ l }) => pos[l.poIdx].supplierIdx === W2 && isCommitted(pos[l.poIdx]))
        .sort((a, b) => b.l.unitPrice * products[b.l.productIdx].pack - a.l.unitPrice * products[a.l.productIdx].pack || a.i - b.i)
        .map(({ i }) => i);
      boost(candidates, target - spend[W2], (line) => line.unitPrice * products[line.productIdx].pack);
      boostLog.push(`spend +${target - spend[W2]} cents on ${SPEND_WINNER}`);
      changed = true;
    }
  }
  {
    const units = unitsReceivedBySupplier(true);
    const others = units.filter((_, i) => i !== W3);
    const target = Math.ceil(Math.max(...others) * BOOST_MARGIN);
    if (units[W3] < target) {
      const candidates = lines
        .map((l, i) => ({ l, i }))
        .filter(({ l, i }) => pos[l.poIdx].supplierIdx === W3 && deliveredLine.has(i))
        .sort(
          (a, b) =>
            products[b.l.productIdx].pack / b.l.unitPrice - products[a.l.productIdx].pack / a.l.unitPrice || a.i - b.i,
        )
        .map(({ i }) => i);
      boost(candidates, target - units[W3], (line) => products[line.productIdx].pack);
      boostLog.push(`units +${target - units[W3]} on ${UNITS_WINNER}`);
      changed = true;
    }
  }
  if (!changed) break;
}

/* --------------------- S10: test purchase orders, concentrated in Jan 2025 */

// Flagged after every planted answer is in place, and never on a PO that
// carries one, so the tie, the three winners and the featured product read
// the same whether or not the default `is_test = false` filter is applied.
// Only the January 2025 volume (and the per-region delivery counts) move.
const nonTestCount = poCounts(true);
function testable(po: PoRow): boolean {
  if (po.isTest || po.protected) return false;
  if (TIED_IDX.includes(po.supplierIdx) || WINNERS.includes(po.supplierIdx)) return false;
  return nonTestCount[po.supplierIdx] - 1 >= MIN_OTHER_NON_TEST_POS;
}
function flag(po: PoRow): void {
  po.isTest = true;
  nonTestCount[po.supplierIdx] -= 1;
}
const inJan2025 = (po: PoRow) => po.orderedOn >= JAN_2025_START && po.orderedOn <= JAN_2025_END;

for (const po of pos) {
  if (!inJan2025(po) && testable(po) && rng.chance(TEST_PO_RATE)) flag(po);
}
for (const po of rng.shuffle(pos.filter(inJan2025))) {
  if (pos.filter((p) => inJan2025(p) && p.isTest).length >= JAN_2025_TEST_POS) break;
  if (testable(po)) flag(po);
}

// S11: every region needs a delivered-in-2025 shipment on a test PO.
for (let regionIdx = 0; regionIdx < REGIONS.length; regionIdx++) {
  const regionPo = (poIdx: number) => regionIdxByCode.get(WAREHOUSES[pos[poIdx].warehouseIdx].region) === regionIdx;
  const covered = () =>
    shipments.some((sh) => sh.status === 'DELIVERED' && in2025(sh.deliveredOn!) && pos[sh.poIdx].isTest && regionPo(sh.poIdx));
  if (covered()) continue;
  const candidate = rng
    .shuffle(shipments.filter((sh) => sh.status === 'DELIVERED' && in2025(sh.deliveredOn!) && regionPo(sh.poIdx)))
    .map((sh) => pos[sh.poIdx])
    .find((po) => !inJan2025(po) && testable(po));
  assert(candidate !== undefined, `S11: no testable PO with a 2025 delivery in ${REGIONS[regionIdx].name}`);
  flag(candidate);
}

// S3: at least one tracked (air) shipment must sit on a test PO.
if (!shipments.some((sh) => sh.mode === 'AIR' && pos[sh.poIdx].isTest)) {
  const candidate = rng
    .shuffle(shipments.filter((sh) => sh.mode === 'AIR'))
    .map((sh) => pos[sh.poIdx])
    .find((po) => !inJan2025(po) && testable(po));
  assert(candidate !== undefined, 'S3: no testable PO with an air shipment');
  flag(candidate);
}

/* ------------------------------------------------ goods value and freight */

for (const sh of shipments) {
  sh.goods = sum(sh.lineIdxs.map((l) => lines[l].total));
  const incoterm = suppliers[pos[sh.poIdx].supplierIdx].incoterm;
  sh.freight = sh.goods * FREIGHT_SHARE[sh.mode] * INCOTERM_FREIGHT[incoterm] * rng.float(0.8, 1.2, 4);
}
// Scale each mode onto its planted share exactly (DDP stays at zero freight).
for (const mode of MODES) {
  const own = shipments.filter((sh) => sh.mode === mode);
  const factor = (FREIGHT_SHARE[mode] * sum(own.map((sh) => sh.goods))) / sum(own.map((sh) => sh.freight));
  for (const sh of own) sh.freight = Math.round(sh.freight * factor);
}

/* ---------------------------------------------------------------- receipts */

interface ReceiptRow {
  key: number;
  shipmentIdx: number;
  lineIdx: number;
  receivedOn: string;
  units: number;
  accepted: number;
  qc: QcStatus;
}

const receiptsDraft: ReceiptRow[] = [];
shipments.forEach((sh, shipmentIdx) => {
  if (sh.status !== 'DELIVERED') return;
  const supplier = suppliers[pos[sh.poIdx].supplierIdx];
  for (const lineIdx of [...sh.lineIdxs].sort((a, b) => a - b)) {
    const line = lines[lineIdx];
    const pack = products[line.productIdx].pack;
    const lots = line.cases >= 2 && rng.chance(0.45) ? 2 : 1;
    const first = lots === 2 ? rng.int(1, line.cases - 1) : line.cases;
    const lotCases = lots === 2 ? [first, line.cases - first] : [first];
    let receivedOn = minDate(addDays(sh.deliveredOn!, rng.weighted([[0, 0.6], [1, 0.3], [2, 0.1]] as const)), WINDOW_END);
    for (const cases of lotCases) {
      const units = cases * pack;
      const pendingChance =
        daysBetween(receivedOn, WINDOW_END) <= 45 ? 0.55 : receivedOn >= YEAR_2025_START ? 0.13 : 0.08;
      let qc: QcStatus = 'PASSED';
      let accepted = units;
      if (rng.chance(pendingChance)) {
        qc = 'PENDING';
        accepted = 0;
      } else if (rng.chance(supplier.failRate)) {
        qc = 'FAILED';
        accepted = units - clamp(Math.round(units * rng.float(0.3, 1.0, 4)), 1, units);
      }
      receiptsDraft.push({ key: receiptsDraft.length, shipmentIdx, lineIdx, receivedOn, units, accepted, qc });
      receivedOn = minDate(addDays(receivedOn, rng.int(0, 1)), WINDOW_END);
    }
  }
});

/* ------------------ S1: tune each supplier onto its planted acceptance ratio */

function isTestReceipt(r: ReceiptRow): boolean {
  return pos[shipments[r.shipmentIdx].poIdx].isTest;
}
function supplierOfReceipt(r: ReceiptRow): number {
  return pos[shipments[r.shipmentIdx].poIdx].supplierIdx;
}

/** Move a set of inspected receipts to exactly `desiredRejected` rejected units. */
function tuneRejected(set: ReceiptRow[], desiredRejected: number): void {
  const inspected = rng.shuffle(set.filter((r) => r.qc !== 'PENDING'));
  let rejected = sum(inspected.map((r) => r.units - r.accepted));
  if (rejected < desiredRejected) {
    for (const r of inspected) {
      if (rejected >= desiredRejected) break;
      if (r.qc !== 'FAILED') continue;
      const take = Math.min(r.accepted, desiredRejected - rejected);
      r.accepted -= take;
      rejected += take;
    }
    for (const r of inspected) {
      if (rejected >= desiredRejected) break;
      if (r.qc !== 'PASSED') continue;
      const take = Math.min(r.units, desiredRejected - rejected);
      r.qc = 'FAILED';
      r.accepted = r.units - take;
      rejected += take;
    }
  } else if (rejected > desiredRejected) {
    for (const r of inspected) {
      if (rejected <= desiredRejected) break;
      if (r.qc !== 'FAILED') continue;
      const give = Math.min(r.units - r.accepted - 1, rejected - desiredRejected);
      r.accepted += give;
      rejected -= give;
    }
    for (const r of inspected) {
      if (rejected <= desiredRejected) break;
      if (r.qc !== 'FAILED') continue;
      r.qc = 'PASSED';
      rejected -= r.units - r.accepted;
      r.accepted = r.units;
    }
  }
}

for (const supplier of suppliers) {
  const own = receiptsDraft.filter((r) => supplierOfReceipt(r) === supplier.idx);
  const real = own.filter((r) => !isTestReceipt(r));
  const test = own.filter((r) => isTestReceipt(r));
  const realReceived = sum(real.filter((r) => r.qc !== 'PENDING').map((r) => r.units));
  tuneRejected(real, realReceived - Math.round(supplier.acceptanceTarget * realReceived));
  // Test receipts are tuned so the ratio WITH test traffic lands on the same target.
  const allReceived = sum(own.filter((r) => r.qc !== 'PENDING').map((r) => r.units));
  const realRejected = sum(real.filter((r) => r.qc !== 'PENDING').map((r) => r.units - r.accepted));
  const wantedAll = allReceived - Math.round(supplier.acceptanceTarget * allReceived);
  if (test.length) tuneRejected(test, Math.max(0, wantedAll - realRejected));
}

/* ------- S15: pending inspections must visibly move the 2025 failure rate */

function failureStats2025(includeTest: boolean): { total: number; pending: number; failed: number } {
  const slice = receiptsDraft.filter((r) => in2025(r.receivedOn) && (includeTest || !isTestReceipt(r)));
  return {
    total: slice.length,
    pending: slice.filter((r) => r.qc === 'PENDING').length,
    failed: slice.filter((r) => r.qc === 'FAILED').length,
  };
}

// Receipts are numbered in the order they were booked in.
const receipts = [...receiptsDraft].sort((a, b) =>
  a.receivedOn < b.receivedOn ? -1 : a.receivedOn > b.receivedOn ? 1 : a.key - b.key,
);

/* ------ S9: promise-based and ETA-based on-time rates must disagree per supplier */

interface OnTime {
  n: number;
  promise: number;
  eta: number;
}

function onTime2025(supplierIdx: number, includeTest: boolean): OnTime {
  const slice = shipments.filter(
    (sh) =>
      sh.status === 'DELIVERED' &&
      in2025(sh.deliveredOn!) &&
      pos[sh.poIdx].supplierIdx === supplierIdx &&
      (includeTest || !pos[sh.poIdx].isTest),
  );
  const promise = slice.filter((sh) => sh.deliveredOn! <= pos[sh.poIdx].promisedOn).length;
  const eta = slice.filter((sh) => sh.deliveredOn! <= sh.expectedOn).length;
  return { n: slice.length, promise: slice.length ? promise / slice.length : 0, eta: slice.length ? eta / slice.length : 0 };
}

const S9_TARGET_GAP = 0.035;
for (const supplier of suppliers) {
  const base = onTime2025(supplier.idx, false);
  if (base.n === 0) continue;
  const lowerEta = base.promise >= base.eta;
  const candidates = rng.shuffle(
    shipments.filter(
      (sh) =>
        sh.status === 'DELIVERED' &&
        in2025(sh.deliveredOn!) &&
        pos[sh.poIdx].supplierIdx === supplier.idx &&
        !pos[sh.poIdx].isTest,
    ),
  );
  for (const sh of candidates) {
    const real = onTime2025(supplier.idx, false);
    const all = onTime2025(supplier.idx, true);
    const gap = (r: OnTime) => (lowerEta ? r.promise - r.eta : r.eta - r.promise);
    if (gap(real) >= S9_TARGET_GAP && gap(all) >= S9_TARGET_GAP) break;
    const onPromise = sh.deliveredOn! <= pos[sh.poIdx].promisedOn;
    const onEta = sh.deliveredOn! <= sh.expectedOn;
    if (lowerEta && onPromise && onEta && addDays(sh.deliveredOn!, -1) >= sh.shippedOn) {
      // The carrier had quoted an earlier arrival than it managed.
      sh.expectedOn = maxDate(sh.shippedOn, addDays(sh.deliveredOn!, -rng.int(1, 2)));
    } else if (!lowerEta && !onPromise && !onEta) {
      // The carrier's ETA had already slipped past the supplier's promise.
      sh.expectedOn = addDays(sh.deliveredOn!, rng.int(0, 2));
    }
  }
}

/* ------------------------------------ S3: tracking numbers, air freight only */

const TRACKING_TARGET = Math.round(shipments.length * TRACKING_RATE);
{
  const air = rng.shuffle(shipments.filter((sh) => sh.mode === 'AIR'));
  const ordered = [
    ...air.filter((sh) => pos[sh.poIdx].isTest).slice(0, 1),
    ...air.filter((sh) => !pos[sh.poIdx].isTest),
    ...air.filter((sh) => pos[sh.poIdx].isTest).slice(1),
  ];
  const issued = new Set<string>();
  for (const sh of ordered.slice(0, TRACKING_TARGET)) {
    let number = '';
    do {
      number = `176-${pad(rng.int(0, 99_999_999), 8)}`;
    } while (issued.has(number));
    issued.add(number);
    sh.tracking = number;
  }
}

/* ------------------------------------------------- inventory snapshots */

interface SnapshotRow {
  warehouseIdx: number;
  productIdx: number;
  date: string;
  onHand: number;
  allocated: number;
}

const MONTH_ENDS: string[] = [];
for (let year = 2024; year <= 2025; year++) {
  for (let month = 1; month <= 12; month++) {
    const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
    MONTH_ENDS.push(`${year}-${pad(month, 2)}-${pad(last, 2)}`);
  }
}

const STOCKED: number[] = [];
{
  const perCategory = [5, 5, 5, 5, 4, 4];
  CATEGORIES.forEach((category, i) => {
    const pool = productsByCategory.get(category.code)!;
    STOCKED.push(...rng.shuffle(pool).slice(0, perCategory[i]));
  });
  STOCKED.sort((a, b) => a - b);
}

const snapshots: SnapshotRow[] = [];
{
  const levels = new Map<string, number>();
  for (let w = 0; w < WAREHOUSES.length; w++) {
    const scale = WAREHOUSES[w].weight / 0.14;
    for (const p of STOCKED) {
      const pack = products[p].pack;
      levels.set(`${w}:${p}`, Math.round(pack * rng.int(8, 60) * scale));
    }
  }
  for (const date of MONTH_ENDS) {
    for (let w = 0; w < WAREHOUSES.length; w++) {
      for (const p of STOCKED) {
        const k = `${w}:${p}`;
        const pack = products[p].pack;
        let onHand = levels.get(k)!;
        if (rng.chance(0.03)) {
          onHand = 0;
        } else {
          const restock = onHand < pack * 5 ? pack * rng.int(10, 40) : 0;
          onHand = Math.max(0, Math.round(onHand * rng.float(0.78, 1.22, 4)) + restock);
        }
        levels.set(k, onHand);
        const allocated = Math.floor(onHand * rng.float(0, 0.4, 4));
        snapshots.push({ warehouseIdx: w, productIdx: p, date, onHand, allocated });
      }
    }
  }
}

/* -------------------------------------------------------------- invariants */

const WINDOW_OK = (date: string) => date >= WINDOW_START && date <= WINDOW_END;

// Row-level rules mirror the CHECK constraints in the DDL.
for (const po of pos) {
  assert(WINDOW_OK(po.orderedOn), `${po.poNumber}: ordered_on outside 2024-2025`);
  assert(po.promisedOn >= po.orderedOn, `${po.poNumber}: promised before ordered`);
  assert(PO_STATUSES.includes(po.status), `${po.poNumber}: bad status`);
  assert(linesByPo[po.id - 1].length >= 1, `${po.poNumber}: every PO has at least one line`);
}
for (const line of lines) {
  const product = products[line.productIdx];
  assert(line.cases > 0 && line.unitPrice > 0, `line ${line.id}: quantities must be positive`);
  assert(line.total === line.cases * product.pack * line.unitPrice, `line ${line.id}: line_total_cents identity`);
  assert(line.total > 0 && Number.isSafeInteger(line.total), `line ${line.id}: line total out of range`);
  assert(product.category === suppliers[pos[line.poIdx].supplierIdx].category, `line ${line.id}: product outside the supplier's category`);
}
pos.forEach((po, poIdx) => {
  const own = linesByPo[poIdx].map(lineOf);
  assert(new Set(own.map((l) => l.productIdx)).size === own.length, `${po.poNumber}: a product appears twice`);
  assert(own.every((l, i) => l.lineNumber === i + 1), `${po.poNumber}: line numbers must run 1..n`);
  const ships = shipmentsByPo[poIdx].map((i) => shipments[i]);
  if (po.status === 'DRAFT' || po.status === 'CANCELLED' || po.status === 'ISSUED') {
    assert(ships.length === 0, `${po.poNumber}: ${po.status} must have no shipments`);
  }
  if (po.status === 'PARTIALLY_RECEIVED') {
    assert(ships.some((s) => s.status === 'DELIVERED'), `${po.poNumber}: partial receipt needs a delivered shipment`);
    assert(ships.some((s) => s.status !== 'DELIVERED'), `${po.poNumber}: partial receipt needs an undelivered shipment`);
  }
  if (po.status === 'RECEIVED' || po.status === 'CLOSED') {
    assert(ships.length > 0 && ships.every((s) => s.status === 'DELIVERED'), `${po.poNumber}: ${po.status} must be fully delivered`);
  }
  if (ships.length) {
    const shipped = new Set(ships.flatMap((s) => s.lineIdxs));
    assert(linesByPo[poIdx].every((l) => shipped.has(l)), `${po.poNumber}: every line must be on a shipment`);
    assert(shipped.size === linesByPo[poIdx].length, `${po.poNumber}: a line is on two shipments`);
  }
});
for (const sh of shipments) {
  const po = pos[sh.poIdx];
  assert(sh.shippedOn >= po.orderedOn && WINDOW_OK(sh.shippedOn), `${sh.shipmentNumber}: bad shipped_on`);
  assert(sh.expectedOn >= sh.shippedOn, `${sh.shipmentNumber}: ETA before dispatch`);
  assert((sh.status === 'DELIVERED') === (sh.deliveredOn !== null), `${sh.shipmentNumber}: status/delivered_on mismatch`);
  if (sh.deliveredOn !== null) {
    assert(sh.deliveredOn >= sh.shippedOn && sh.deliveredOn <= WINDOW_END, `${sh.shipmentNumber}: bad delivered_on`);
  }
  assert(sh.goods > 0 && sh.freight >= 0, `${sh.shipmentNumber}: bad money`);
  assert(sh.tracking === null || sh.mode === 'AIR', `${sh.shipmentNumber}: tracking number off an air shipment`);
  assert(carriersByMode.get(sh.mode)!.includes(sh.carrierIdx), `${sh.shipmentNumber}: carrier does not run ${sh.mode}`);
}
assert(deliveryClamps === 0, `${deliveryClamps} deliveries had to be clamped to 2025-12-31 — widen the status horizon`);
{
  const receivedByLine = new Map<number, number>();
  for (const r of receipts) {
    const sh = shipments[r.shipmentIdx];
    assert(sh.status === 'DELIVERED' && sh.lineIdxs.includes(r.lineIdx), `receipt on an undelivered shipment or foreign line`);
    assert(r.receivedOn >= sh.deliveredOn! && r.receivedOn <= WINDOW_END, 'receipt date outside delivery..2025-12-31');
    assert(r.units > 0 && r.accepted >= 0 && r.accepted <= r.units, 'receipt units out of range');
    if (r.qc === 'PENDING') assert(r.accepted === 0, 'PENDING receipts accept nothing');
    if (r.qc === 'PASSED') assert(r.accepted === r.units, 'PASSED receipts accept everything');
    if (r.qc === 'FAILED') assert(r.accepted < r.units, 'FAILED receipts reject something');
    receivedByLine.set(r.lineIdx, (receivedByLine.get(r.lineIdx) ?? 0) + r.units);
  }
  lines.forEach((line, lineIdx) => {
    const expected = deliveredLine.has(lineIdx) ? line.cases * products[line.productIdx].pack : 0;
    assert((receivedByLine.get(lineIdx) ?? 0) === expected, `line ${line.id}: receipts must add up to the delivered units`);
  });
}
for (const s of snapshots) {
  assert(s.onHand >= 0 && s.allocated >= 0 && s.allocated <= s.onHand, 'inventory: allocated must sit within on hand');
}

// S1 — acceptance ratio per supplier, and freight share per mode.
function acceptanceBySupplier(includeTest: boolean): { idx: number; received: number; accepted: number; ratio: number }[] {
  return suppliers
    .map((s) => {
      const own = receipts.filter(
        (r) => supplierOfReceipt(r) === s.idx && r.qc !== 'PENDING' && (includeTest || !isTestReceipt(r)),
      );
      const received = sum(own.map((r) => r.units));
      const accepted = sum(own.map((r) => r.accepted));
      return { idx: s.idx, received, accepted, ratio: accepted / received };
    })
    .sort((a, b) => b.ratio - a.ratio);
}
function freightByMode(includeTest: boolean): { mode: Mode; ratio: number; freight: number; goods: number }[] {
  return MODES.map((mode) => {
    const own = shipments.filter((sh) => sh.mode === mode && (includeTest || !pos[sh.poIdx].isTest));
    const freight = sum(own.map((sh) => sh.freight));
    const goods = sum(own.map((sh) => sh.goods));
    return { mode, freight, goods, ratio: freight / goods };
  }).sort((a, b) => b.ratio - a.ratio);
}
for (const includeTest of [false, true]) {
  const acc = acceptanceBySupplier(includeTest);
  assert(acc.length === 18 && acc.every((r) => r.received > 0), 'S1: every supplier needs inspected receipts');
  for (const row of acc) {
    assert(row.ratio > 0.55 && row.ratio < 0.995, `S1: ${suppliers[row.idx].name} acceptance ${row.ratio} out of band`);
  }
  for (let i = 1; i < acc.length; i++) {
    assert(
      acc[i - 1].ratio - acc[i].ratio >= 0.01,
      `S1: ${suppliers[acc[i - 1].idx].name} and ${suppliers[acc[i].idx].name} too close (includeTest=${includeTest}) -- ${acc
        .map((r) => `${suppliers[r.idx].code}=${r.ratio.toFixed(4)}`)
        .join(', ')}`,
    );
  }
  const fr = freightByMode(includeTest);
  for (const row of fr) assert(row.ratio > 0.01 && row.ratio < 0.6, `S1: ${row.mode} freight share ${row.ratio} out of band`);
  for (let i = 1; i < fr.length; i++) {
    assert(fr[i - 1].ratio - fr[i].ratio >= 0.02, `S1: ${fr[i - 1].mode} and ${fr[i].mode} freight shares too close`);
  }
}

// S2 — one unit of measure, a real mix of case packs.
assert(products.filter((p) => p.pack === 1).length >= 10, 'S2: need >= 10 products sold singly');
assert(products.filter((p) => p.pack > 1).length >= 50, 'S2: need >= 50 products sold in multi-unit cases');

// S3 — tracking numbers on exactly 7% of shipments.
{
  const tracked = shipments.filter((sh) => sh.tracking !== null);
  assert(tracked.length === TRACKING_TARGET, `S3: expected ${TRACKING_TARGET} tracked shipments, got ${tracked.length}`);
  assert(tracked.some((sh) => pos[sh.poIdx].isTest), 'S3: a tracked shipment must sit on a test PO');
  assert(new Set(tracked.map((sh) => sh.tracking)).size === tracked.length, 'S3: tracking numbers must be unique');
}

// S4 — exactly two suppliers on exactly 41 POs, and 41 is the minimum.
for (const includeTest of [false, true]) {
  const counts = poCounts(includeTest);
  const at41 = counts.map((c, i) => ({ c, i })).filter((x) => x.c === TIE_COUNT).map((x) => suppliers[x.i].name).sort();
  assert(at41.join('|') === [...TIED_SUPPLIERS].sort().join('|'), `S4: suppliers on ${TIE_COUNT} POs are ${at41.join(', ')} (includeTest=${includeTest})`);
  const others = counts.filter((_, i) => !TIED_IDX.includes(i));
  assert(Math.min(...others) >= MIN_OTHER_NON_TEST_POS, `S4: next-lowest supplier has ${Math.min(...others)} POs (includeTest=${includeTest})`);
}
assert(pos.every((po) => !(po.isTest && TIED_IDX.includes(po.supplierIdx))), 'S4: tied suppliers carry no test POs');

// S5 — the status vocabulary is fully populated.
for (const status of PO_STATUSES) assert(pos.some((po) => po.status === status), `S5: status ${status} missing`);
assert(pos.filter((po) => po.status === 'PARTIALLY_RECEIVED' && !po.isTest).length >= 40, 'S5: need >= 40 non-test PARTIALLY_RECEIVED POs');

// S7 — three measures of "biggest", three suppliers, clear margins.
function topTwo(values: number[]): { idx: number; value: number; runnerUp: number } {
  const ranked = values.map((value, idx) => ({ idx, value })).sort((a, b) => b.value - a.value || a.idx - b.idx);
  return { idx: ranked[0].idx, value: ranked[0].value, runnerUp: ranked[1].value };
}
for (const includeTest of [false, true]) {
  const byCount = topTwo(poCounts(includeTest));
  const bySpend = topTwo(spendBySupplier(includeTest));
  const byUnits = topTwo(unitsReceivedBySupplier(includeTest));
  assert(byCount.idx === W1 && byCount.value >= byCount.runnerUp * WINNER_MARGIN, `S7: PO-count winner (includeTest=${includeTest})`);
  assert(bySpend.idx === W2 && bySpend.value >= bySpend.runnerUp * WINNER_MARGIN, `S7: committed-spend winner (includeTest=${includeTest})`);
  assert(byUnits.idx === W3 && byUnits.value >= byUnits.runnerUp * WINNER_MARGIN, `S7: units-received winner (includeTest=${includeTest})`);
}

// S8 — a unique product on the most 2024 lines, with or without DRAFT/CANCELLED lines.
for (const includeTest of [false, true]) {
  for (const committedOnly of [false, true]) {
    const ranked = rankProducts(lines2024ByProduct(includeTest, committedOnly));
    assert(
      ranked[0].idx === S8_TOP && ranked[0].count - ranked[1].count >= 2,
      `S8: top 2024 product not clear (includeTest=${includeTest}, committedOnly=${committedOnly})`,
    );
  }
}

// S9 — promise-based and ETA-based rates differ for every supplier; each has cargo in transit.
for (const supplier of suppliers) {
  for (const includeTest of [false, true]) {
    const r = onTime2025(supplier.idx, includeTest);
    if (r.n === 0) continue;
    assert(Math.abs(r.promise - r.eta) >= 0.03, `S9: ${supplier.name} promise ${r.promise} vs ETA ${r.eta} (includeTest=${includeTest})`);
  }
  assert(
    shipments.some(
      (sh) => sh.status === 'IN_TRANSIT' && in2025(sh.shippedOn) && pos[sh.poIdx].supplierIdx === supplier.idx && !pos[sh.poIdx].isTest,
    ),
    `S9: ${supplier.name} needs an in-transit 2025 shipment on a non-test PO`,
  );
}

// S10 — test POs: nine in January 2025, never on a planted answer.
{
  const jan = pos.filter(inJan2025);
  assert(jan.filter((po) => po.isTest).length === JAN_2025_TEST_POS, `S10: January 2025 must carry exactly ${JAN_2025_TEST_POS} test POs`);
  assert(pos.every((po) => !po.isTest || !WINNERS.includes(po.supplierIdx)), 'S10: no test PO on an S7 winner');
  assert(
    lines.every((l) => !(l.productIdx === FEATURED_IDX && in2024(pos[l.poIdx].orderedOn) && pos[l.poIdx].isTest)),
    'S10: no test PO on the featured product in 2024',
  );
  const share = pos.filter((po) => po.isTest).length / pos.length;
  assert(share > 0.015 && share < 0.035, `S10: test PO share ${share} is outside ~2.5%`);
}

// S11 — every region has 2025 deliveries on both real and test POs.
for (let regionIdx = 0; regionIdx < REGIONS.length; regionIdx++) {
  const slice = shipments.filter(
    (sh) => sh.status === 'DELIVERED' && in2025(sh.deliveredOn!) && regionIdxByCode.get(WAREHOUSES[pos[sh.poIdx].warehouseIdx].region) === regionIdx,
  );
  assert(slice.some((sh) => !pos[sh.poIdx].isTest), `S11: ${REGIONS[regionIdx].name} needs a real 2025 delivery`);
  assert(slice.some((sh) => pos[sh.poIdx].isTest), `S11: ${REGIONS[regionIdx].name} needs a test 2025 delivery`);
}

// S12 — committed spend has something to exclude in every tier.
for (const tier of TIERS) {
  for (const status of ['DRAFT', 'CANCELLED'] as const) {
    assert(
      pos.some((po, i) => suppliers[po.supplierIdx].tier === tier && po.status === status && in2024(po.orderedOn) && !po.isTest && linesByPo[i].length > 0),
      `S12: tier ${tier} needs a non-test ${status} PO raised in 2024`,
    );
  }
}

// S13 — month-end snapshots: one row per stocked pair per month; summing months is wrong.
{
  assert(snapshots.length === WAREHOUSES.length * STOCKED.length * MONTH_ENDS.length, 'S13: snapshot grid incomplete');
  assert(STOCKED.length === 28, 'S13: 28 stocked products');
  for (let w = 0; w < WAREHOUSES.length; w++) {
    const yearEnd = snapshots.filter((s) => s.warehouseIdx === w && s.date === '2024-12-31');
    assert(yearEnd.length === STOCKED.length, `S13: ${WAREHOUSES[w].name} lacks a 2024-12-31 row per product`);
    const summed = sum(snapshots.filter((s) => s.warehouseIdx === w && in2024(s.date)).map((s) => s.onHand));
    assert(summed !== sum(yearEnd.map((s) => s.onHand)), `S13: ${WAREHOUSES[w].name} sum over 2024 equals the year-end balance`);
  }
}

// S14 — the featured product: cases of 24, enough 2024 lines, none on a DRAFT/CANCELLED PO.
{
  assert(products[FEATURED_IDX].pack === FEATURED_CASE_PACK, 'S14: featured product must come in cases of 24');
  const featured = lines.filter((l) => l.productIdx === FEATURED_IDX && in2024(pos[l.poIdx].orderedOn));
  assert(featured.filter((l) => !pos[l.poIdx].isTest).length >= FEATURED_MIN_LINES_2024, 'S14: too few 2024 lines');
  assert(featured.every((l) => isCommitted(pos[l.poIdx])), 'S14: a 2024 line sits on a DRAFT or CANCELLED PO');
  assert(S8_TOP !== FEATURED_IDX, 'S8 and S14 must be different products');
}

// S15 — enough pending and failed inspections in 2025 to move the rate.
{
  const stats = failureStats2025(false);
  const pendingShare = stats.pending / stats.total;
  const failedShare = stats.failed / stats.total;
  const withPending = stats.failed / stats.total;
  const withoutPending = stats.failed / (stats.total - stats.pending);
  assert(pendingShare >= 0.08, `S15: 2025 pending share ${pendingShare} < 8%`);
  assert(failedShare >= 0.06, `S15: 2025 failed share ${failedShare} < 6%`);
  assert(withoutPending - withPending >= 0.01, `S15: failure rate moves only ${withoutPending - withPending} with pending in the denominator`);
}

/* ----------------------------------------------------------------- DDL */

const HEADER = `-- =============================================================================
-- supply_chain -- synthetic fixture for the Questions to Insights eval set
--
-- GENERATED FILE. DO NOT EDIT BY HAND.
-- Edit the generator and regenerate; hand edits are lost on the next run.
--
--   generator : docker/postgres/generate/supply-chain.ts
--   seed      : ${SEED}   (single hard-coded constant -- the output is
--               byte-identical on every run, so hand-verified eval SQL stays valid)
--   regenerate: cd backend && npm run fixtures:supply-chain
--               (= npx ts-node -T -P tsconfig.json ../docker/postgres/generate/supply-chain.ts)
--
-- A fictional industrial distributor, "Halden Industrial Supply", seen from
-- its inbound-purchasing side: suppliers, a case-pack catalogue, warehouses by
-- region, purchase orders and lines, shipments, inspection receipts and
-- month-end inventory snapshots. Every company, product and person is invented.
--
-- Surrogate keys are left to the identity columns: rows are inserted in the
-- order the generator emits them, so id 1..N follows that order and the foreign
-- keys below are the matching literals.
--
-- Every purchase order was raised in calendar 2024 or 2025, and no value in
-- this file depends on the date it was generated: the data is as of
-- 2025-12-31. Supplier onboarding and warehouse opening dates are the only
-- dates outside that window, by nature.
-- =============================================================================

BEGIN;

CREATE SCHEMA supply_chain;
SET search_path TO supply_chain, public;

CREATE TABLE regions (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  code text NOT NULL UNIQUE,
  name text NOT NULL UNIQUE
);

CREATE TABLE warehouses (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  code text NOT NULL UNIQUE,
  name text NOT NULL UNIQUE,
  region_id bigint NOT NULL REFERENCES regions(id),
  city text NOT NULL,
  country_code char(2) NOT NULL,
  opened_on date NOT NULL,
  is_active boolean NOT NULL DEFAULT true
);

CREATE TABLE suppliers (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  code text NOT NULL UNIQUE,
  name text NOT NULL UNIQUE,
  country_code char(2) NOT NULL,
  tier text NOT NULL CHECK (tier IN ('STRATEGIC', 'PREFERRED', 'APPROVED', 'CONDITIONAL')),
  incoterm text NOT NULL CHECK (incoterm IN ('EXW', 'FOB', 'CIF', 'DDP')),
  standard_lead_time_days integer NOT NULL CHECK (standard_lead_time_days > 0),
  onboarded_on date NOT NULL,
  is_active boolean NOT NULL DEFAULT true
);

CREATE TABLE product_categories (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  code text NOT NULL UNIQUE,
  name text NOT NULL UNIQUE
);

CREATE TABLE products (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  sku text NOT NULL UNIQUE,
  name text NOT NULL UNIQUE,
  category_id bigint NOT NULL REFERENCES product_categories(id),
  unit_of_measure text NOT NULL DEFAULT 'EA' CHECK (unit_of_measure = 'EA'),
  case_pack_qty integer NOT NULL CHECK (case_pack_qty > 0),
  unit_cost_cents bigint NOT NULL CHECK (unit_cost_cents > 0),
  weight_grams integer NOT NULL CHECK (weight_grams > 0),
  is_discontinued boolean NOT NULL DEFAULT false
);

CREATE TABLE carriers (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  code text NOT NULL UNIQUE,
  name text NOT NULL UNIQUE
);

CREATE TABLE purchase_orders (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  po_number text NOT NULL UNIQUE,
  supplier_id bigint NOT NULL REFERENCES suppliers(id),
  warehouse_id bigint NOT NULL REFERENCES warehouses(id),
  ordered_on date NOT NULL CHECK (ordered_on BETWEEN DATE '${WINDOW_START}' AND DATE '${WINDOW_END}'),
  promised_on date NOT NULL,
  status text NOT NULL CHECK (status IN ('DRAFT', 'ISSUED', 'PARTIALLY_RECEIVED', 'RECEIVED', 'CLOSED', 'CANCELLED')),
  currency text NOT NULL DEFAULT 'USD' CHECK (currency = 'USD'),
  payment_terms text NOT NULL CHECK (payment_terms IN ('NET30', 'NET45', 'NET60')),
  buyer_name text NOT NULL,
  is_test boolean NOT NULL DEFAULT false,
  CHECK (promised_on >= ordered_on)
);

CREATE TABLE purchase_order_lines (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  po_id bigint NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
  line_number integer NOT NULL CHECK (line_number > 0),
  product_id bigint NOT NULL REFERENCES products(id),
  cases_ordered integer NOT NULL CHECK (cases_ordered > 0),
  unit_price_cents bigint NOT NULL CHECK (unit_price_cents > 0),
  line_total_cents bigint NOT NULL CHECK (line_total_cents > 0),
  UNIQUE (po_id, line_number)
);

CREATE TABLE shipments (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  shipment_number text NOT NULL UNIQUE,
  po_id bigint NOT NULL REFERENCES purchase_orders(id),
  carrier_id bigint NOT NULL REFERENCES carriers(id),
  mode text NOT NULL CHECK (mode IN ('ROAD', 'RAIL', 'SEA', 'AIR')),
  shipped_on date NOT NULL CHECK (shipped_on BETWEEN DATE '${WINDOW_START}' AND DATE '${WINDOW_END}'),
  expected_on date NOT NULL,
  delivered_on date,
  status text NOT NULL CHECK (status IN ('IN_TRANSIT', 'DELIVERED', 'EXCEPTION')),
  freight_cost_cents bigint NOT NULL CHECK (freight_cost_cents >= 0),
  goods_value_cents bigint NOT NULL CHECK (goods_value_cents > 0),
  tracking_number text,
  CHECK ((status = 'DELIVERED') = (delivered_on IS NOT NULL)),
  CHECK (expected_on >= shipped_on),
  CHECK (delivered_on IS NULL OR delivered_on BETWEEN shipped_on AND DATE '${WINDOW_END}')
);

CREATE TABLE receipts (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  shipment_id bigint NOT NULL REFERENCES shipments(id),
  po_line_id bigint NOT NULL REFERENCES purchase_order_lines(id),
  received_on date NOT NULL CHECK (received_on BETWEEN DATE '${WINDOW_START}' AND DATE '${WINDOW_END}'),
  units_received integer NOT NULL CHECK (units_received > 0),
  units_accepted integer NOT NULL CHECK (units_accepted >= 0),
  qc_status text NOT NULL CHECK (qc_status IN ('PASSED', 'FAILED', 'PENDING')),
  CHECK (units_accepted <= units_received),
  CHECK (qc_status <> 'PENDING' OR units_accepted = 0),
  CHECK (qc_status <> 'PASSED' OR units_accepted = units_received),
  CHECK (qc_status <> 'FAILED' OR units_accepted < units_received)
);

CREATE TABLE inventory_snapshots (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  warehouse_id bigint NOT NULL REFERENCES warehouses(id),
  product_id bigint NOT NULL REFERENCES products(id),
  snapshot_date date NOT NULL CHECK (snapshot_date BETWEEN DATE '2024-01-31' AND DATE '${WINDOW_END}'),
  on_hand_units integer NOT NULL CHECK (on_hand_units >= 0),
  allocated_units integer NOT NULL CHECK (allocated_units >= 0),
  CHECK (allocated_units <= on_hand_units),
  UNIQUE (warehouse_id, product_id, snapshot_date)
);

CREATE INDEX warehouses_region_idx ON warehouses (region_id);
CREATE INDEX products_category_idx ON products (category_id);
CREATE INDEX purchase_orders_supplier_idx ON purchase_orders (supplier_id);
CREATE INDEX purchase_orders_warehouse_idx ON purchase_orders (warehouse_id);
CREATE INDEX purchase_orders_ordered_on_idx ON purchase_orders (ordered_on);
CREATE INDEX purchase_orders_status_idx ON purchase_orders (status);
CREATE INDEX purchase_order_lines_po_idx ON purchase_order_lines (po_id);
CREATE INDEX purchase_order_lines_product_idx ON purchase_order_lines (product_id);
CREATE INDEX shipments_po_idx ON shipments (po_id);
CREATE INDEX shipments_carrier_idx ON shipments (carrier_id);
CREATE INDEX shipments_delivered_on_idx ON shipments (delivered_on);
CREATE INDEX receipts_shipment_idx ON receipts (shipment_id);
CREATE INDEX receipts_po_line_idx ON receipts (po_line_id);
CREATE INDEX receipts_received_on_idx ON receipts (received_on);
CREATE INDEX inventory_snapshots_warehouse_idx ON inventory_snapshots (warehouse_id);
CREATE INDEX inventory_snapshots_product_idx ON inventory_snapshots (product_id);
CREATE INDEX inventory_snapshots_date_idx ON inventory_snapshots (snapshot_date);
`;

/* -------------------------------------------------------------- the views */

const VIEWS = `CREATE VIEW v_purchase_order_lines AS
SELECT
  line.id AS po_line_id,
  line.po_id,
  line.line_number,
  line.product_id,
  line.cases_ordered,
  line.unit_price_cents,
  line.line_total_cents,
  po.po_number,
  po.ordered_on,
  po.promised_on,
  po.status AS po_status,
  po.is_test,
  supplier.id AS supplier_id,
  supplier.name AS supplier_name,
  supplier.tier AS supplier_tier,
  warehouse.name AS warehouse_name,
  region.name AS region_name,
  product.sku,
  product.name AS product_name,
  product.case_pack_qty
FROM purchase_order_lines line
JOIN purchase_orders po ON po.id = line.po_id
JOIN suppliers supplier ON supplier.id = po.supplier_id
JOIN warehouses warehouse ON warehouse.id = po.warehouse_id
JOIN regions region ON region.id = warehouse.region_id
JOIN products product ON product.id = line.product_id;

CREATE VIEW v_shipments AS
SELECT
  shipment.id AS shipment_id,
  shipment.shipment_number,
  shipment.po_id,
  shipment.mode,
  shipment.shipped_on,
  shipment.expected_on,
  shipment.delivered_on,
  shipment.status,
  shipment.freight_cost_cents,
  shipment.goods_value_cents,
  shipment.tracking_number,
  po.po_number,
  po.ordered_on,
  po.promised_on,
  po.status AS po_status,
  po.is_test,
  supplier.id AS supplier_id,
  supplier.name AS supplier_name,
  supplier.tier AS supplier_tier,
  warehouse.name AS warehouse_name,
  region.name AS region_name,
  carrier.name AS carrier_name
FROM shipments shipment
JOIN purchase_orders po ON po.id = shipment.po_id
JOIN suppliers supplier ON supplier.id = po.supplier_id
JOIN warehouses warehouse ON warehouse.id = po.warehouse_id
JOIN regions region ON region.id = warehouse.region_id
JOIN carriers carrier ON carrier.id = shipment.carrier_id;

CREATE VIEW v_receipts AS
SELECT
  receipt.id AS receipt_id,
  receipt.shipment_id,
  receipt.po_line_id,
  receipt.received_on,
  receipt.units_received,
  receipt.units_accepted,
  receipt.qc_status,
  shipment.shipment_number,
  po.po_number,
  po.is_test,
  supplier.id AS supplier_id,
  supplier.name AS supplier_name,
  product.sku,
  product.name AS product_name,
  product.case_pack_qty,
  warehouse.name AS warehouse_name
FROM receipts receipt
JOIN shipments shipment ON shipment.id = receipt.shipment_id
JOIN purchase_orders po ON po.id = shipment.po_id
JOIN suppliers supplier ON supplier.id = po.supplier_id
JOIN purchase_order_lines line ON line.id = receipt.po_line_id
JOIN products product ON product.id = line.product_id
JOIN warehouses warehouse ON warehouse.id = po.warehouse_id;

COMMENT ON SCHEMA supply_chain IS
  ${literal('Synthetic eval fixture: inbound purchasing for an industrial distributor. Money is stored in cents (USD). Purchase orders were raised in calendar 2024 and 2025 only; the data is as of 2025-12-31.')};
COMMENT ON COLUMN purchase_orders.is_test IS
  ${literal('Sandbox purchase orders raised to test the procurement integration. Excluded from reported volumes by default, together with their lines, shipments and receipts.')};
COMMENT ON COLUMN products.case_pack_qty IS
  ${literal('Units (eaches) per case. Purchase-order lines order whole cases; receipts and inventory count units.')};
COMMENT ON COLUMN shipments.expected_on IS
  ${literal('The carrier ETA quoted at dispatch. Not the delivery date promised on the purchase order (purchase_orders.promised_on).')};
COMMENT ON COLUMN inventory_snapshots.snapshot_date IS
  ${literal('Month-end date of a point-in-time balance. Balances at different dates must not be added together.')};
COMMENT ON COLUMN receipts.qc_status IS
  ${literal('Inspection outcome. PENDING receipts have not been inspected yet and accept 0 units until they are.')};
COMMENT ON VIEW v_shipments IS
  ${literal('One row per shipment. warehouse_name/region_name are the receiving warehouse of the purchase order.')};

COMMIT;
`;

/* ------------------------------------------------------------ INSERT rows */

const blocks: string[] = [
  HEADER,
  section('regions'),
  insertRows('regions', ['code', 'name'], REGIONS.map((r) => [r.code, r.name])),
  section('warehouses'),
  insertRows(
    'warehouses',
    ['code', 'name', 'region_id', 'city', 'country_code', 'opened_on', 'is_active'],
    WAREHOUSES.map((w) => [w.code, w.name, regionIdxByCode.get(w.region)! + 1, w.city, w.country, w.openedOn, true]),
  ),
  section('suppliers'),
  insertRows(
    'suppliers',
    ['code', 'name', 'country_code', 'tier', 'incoterm', 'standard_lead_time_days', 'onboarded_on', 'is_active'],
    suppliers.map((s) => [s.code, s.name, s.country, s.tier, s.incoterm, s.leadTime, s.onboardedOn, true]),
  ),
  section('product_categories'),
  insertRows('product_categories', ['code', 'name'], CATEGORIES.map((c) => [c.code, c.name])),
  section('products'),
  insertRows(
    'products',
    ['sku', 'name', 'category_id', 'unit_of_measure', 'case_pack_qty', 'unit_cost_cents', 'weight_grams', 'is_discontinued'],
    products.map((p) => [p.sku, p.name, p.categoryIdx + 1, 'EA', p.pack, p.unitCost, p.weight, false]),
  ),
  section('carriers'),
  insertRows('carriers', ['code', 'name'], CARRIERS.map((c) => [c.code, c.name])),
  section('purchase_orders'),
  insertRows(
    'purchase_orders',
    ['po_number', 'supplier_id', 'warehouse_id', 'ordered_on', 'promised_on', 'status', 'currency', 'payment_terms', 'buyer_name', 'is_test'],
    pos.map((po) => [
      po.poNumber,
      po.supplierIdx + 1,
      po.warehouseIdx + 1,
      po.orderedOn,
      po.promisedOn,
      po.status,
      'USD',
      po.paymentTerms,
      po.buyer,
      po.isTest,
    ]),
  ),
  section('purchase_order_lines'),
  insertRows(
    'purchase_order_lines',
    ['po_id', 'line_number', 'product_id', 'cases_ordered', 'unit_price_cents', 'line_total_cents'],
    lines.map((l) => [l.poIdx + 1, l.lineNumber, l.productIdx + 1, l.cases, l.unitPrice, l.total]),
  ),
  section('shipments'),
  insertRows(
    'shipments',
    [
      'shipment_number', 'po_id', 'carrier_id', 'mode', 'shipped_on', 'expected_on', 'delivered_on',
      'status', 'freight_cost_cents', 'goods_value_cents', 'tracking_number',
    ],
    shipments.map((sh) => [
      sh.shipmentNumber,
      sh.poIdx + 1,
      sh.carrierIdx + 1,
      sh.mode,
      sh.shippedOn,
      sh.expectedOn,
      sh.deliveredOn,
      sh.status,
      sh.freight,
      sh.goods,
      sh.tracking,
    ]),
  ),
  section('receipts'),
  insertRows(
    'receipts',
    ['shipment_id', 'po_line_id', 'received_on', 'units_received', 'units_accepted', 'qc_status'],
    receipts.map((r) => [shipments[r.shipmentIdx].id, lines[r.lineIdx].id, r.receivedOn, r.units, r.accepted, r.qc]),
  ),
  section('inventory_snapshots'),
  insertRows(
    'inventory_snapshots',
    ['warehouse_id', 'product_id', 'snapshot_date', 'on_hand_units', 'allocated_units'],
    snapshots.map((s) => [s.warehouseIdx + 1, s.productIdx + 1, s.date, s.onHand, s.allocated]),
  ),
  section('analytics views'),
  VIEWS,
];

writeFileSync(OUTPUT_PATH, `${blocks.join('\n\n')}`, 'utf8');

/* -------------------------------------------------------------- stdout */

const counts: [string, number][] = [
  ['regions', REGIONS.length],
  ['warehouses', WAREHOUSES.length],
  ['suppliers', suppliers.length],
  ['product_categories', CATEGORIES.length],
  ['products', products.length],
  ['carriers', CARRIERS.length],
  ['purchase_orders', pos.length],
  ['purchase_order_lines', lines.length],
  ['shipments', shipments.length],
  ['receipts', receipts.length],
  ['inventory_snapshots', snapshots.length],
];

const nameOf = (idx: number) => suppliers[idx].name;
const pct = (x: number) => `${(100 * x).toFixed(2)}%`;

console.log(`supply_chain fixture written to ${OUTPUT_PATH} (seed ${SEED})`);
for (const [table, count] of counts) {
  console.log(`  ${table.padEnd(22)} ${String(count).padStart(6)}`);
}

console.log('\n  planted answers');
console.log(`    S4 tie (${TIE_COUNT} POs each)      : ${[...TIED_SUPPLIERS].sort().join(', ')}`);
{
  const next = poCounts(false)
    .map((c, i) => ({ c, i }))
    .filter((x) => !TIED_IDX.includes(x.i))
    .sort((a, b) => a.c - b.c)[0];
  console.log(`    S4 next-lowest (non-test)   : ${nameOf(next.i)} (${next.c})`);
}
for (const includeTest of [false, true]) {
  const label = includeTest ? 'with test' : 'non-test';
  const c = topTwo(poCounts(includeTest));
  const s = topTwo(spendBySupplier(includeTest));
  const u = topTwo(unitsReceivedBySupplier(includeTest));
  console.log(`    S7 most POs (${label})     : ${nameOf(c.idx)} ${c.value} (runner-up ${c.runnerUp})`);
  console.log(`    S7 committed spend (${label}): ${nameOf(s.idx)} ${s.value} cents (runner-up ${s.runnerUp})`);
  console.log(`    S7 units received (${label}): ${nameOf(u.idx)} ${u.value} (runner-up ${u.runnerUp})`);
}
console.log(`    S7 boosts applied           : ${boostLog.length ? boostLog.join('; ') : 'none'}`);
{
  const ranked = rankProducts(lines2024ByProduct(false));
  console.log(`    S8 most 2024 lines          : ${products[ranked[0].idx].name} (${ranked[0].count}), runner-up ${products[ranked[1].idx].name} (${ranked[1].count})`);
  const featured = lines.filter((l) => l.productIdx === FEATURED_IDX && in2024(pos[l.poIdx].orderedOn) && !pos[l.poIdx].isTest);
  console.log(
    `    S14 featured product        : ${FEATURED_PRODUCT} — ${featured.length} lines, ${sum(featured.map((l) => l.cases))} cases = ${sum(
      featured.map((l) => l.cases * FEATURED_CASE_PACK),
    )} units`,
  );
}
{
  const jan = pos.filter(inJan2025);
  console.log(`    S10 January 2025 POs        : ${jan.length} total, ${jan.filter((p) => !p.isTest).length} excluding is_test`);
  console.log(`    S10 test POs overall        : ${pos.filter((p) => p.isTest).length} / ${pos.length}`);
  const open = pos.filter((p) => !p.isTest && (p.status === 'ISSUED' || p.status === 'PARTIALLY_RECEIVED'));
  console.log(`    S5 open POs (non-test)      : ${open.length} (ISSUED ${open.filter((p) => p.status === 'ISSUED').length})`);
  const statusMix = PO_STATUSES.map((st) => `${st} ${pos.filter((p) => p.status === st).length}`).join(', ');
  console.log(`    S5 status mix (all)         : ${statusMix}`);
  const tracked = shipments.filter((sh) => sh.tracking !== null);
  console.log(`    S3 tracked shipments        : ${tracked.length} / ${shipments.length} (non-test ${tracked.filter((sh) => !pos[sh.poIdx].isTest).length})`);
  const qcMix = (['PASSED', 'FAILED', 'PENDING'] as const).map((q) => `${q} ${receipts.filter((r) => r.qc === q).length}`).join(', ');
  console.log(`    receipts qc mix (all)       : ${qcMix}`);
  const stats = failureStats2025(false);
  console.log(
    `    S15 2025 failure rate       : ${pct(stats.failed / (stats.total - stats.pending))} excluding pending, ${pct(stats.failed / stats.total)} over all ${stats.total} (pending ${stats.pending}, failed ${stats.failed})`,
  );
}
console.log('    S1 acceptance by supplier (non-test, inspected)');
for (const row of acceptanceBySupplier(false)) {
  console.log(`      ${nameOf(row.idx).padEnd(36)} ${row.ratio.toFixed(4)}`);
}
console.log('    S1 freight share by mode (non-test)');
for (const row of freightByMode(false)) {
  console.log(`      ${row.mode.padEnd(6)} ${row.ratio.toFixed(4)}`);
}
console.log('    S9 on-time 2025 by supplier (non-test): promise vs ETA');
for (const s of suppliers) {
  const r = onTime2025(s.idx, false);
  console.log(`      ${s.name.padEnd(36)} n=${String(r.n).padStart(3)} promise ${pct(r.promise)} eta ${pct(r.eta)}`);
}
console.log('    S11 deliveries in 2025 by region: non-test / with test');
for (let regionIdx = 0; regionIdx < REGIONS.length; regionIdx++) {
  const slice = shipments.filter(
    (sh) => sh.status === 'DELIVERED' && in2025(sh.deliveredOn!) && regionIdxByCode.get(WAREHOUSES[pos[sh.poIdx].warehouseIdx].region) === regionIdx,
  );
  console.log(`      ${REGIONS[regionIdx].name.padEnd(32)} ${slice.filter((sh) => !pos[sh.poIdx].isTest).length} / ${slice.length}`);
}
console.log('    S13 on hand at 2024-12-31 by warehouse');
for (let w = 0; w < WAREHOUSES.length; w++) {
  const yearEnd = sum(snapshots.filter((s) => s.warehouseIdx === w && s.date === '2024-12-31').map((s) => s.onHand));
  console.log(`      ${WAREHOUSES[w].name.padEnd(32)} ${yearEnd}`);
}
