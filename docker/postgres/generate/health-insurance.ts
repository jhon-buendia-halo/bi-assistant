/**
 * Generator for the `health_insurance` synthetic eval fixture.
 *
 * Writes `backend/src/modules/testing-data/fixtures/004_health_insurance.sql`, the Testing Data
 * seed (`docker/postgres/init/002_health_insurance.sql` on feat/engine-eval-loop) from one hard-coded
 * seed, so the output is byte-identical on every run and every hand-verified
 * `expectedSql` in the eval set stays valid. Every random draw comes from the
 * single `Rng` below — never `Math.random()`.
 *
 * Run from the repo root with:
 *
 *   npx ts-node -T --compilerOptions '{"module":"commonjs","moduleResolution":"node"}' \
 *     docker/postgres/generate/health-insurance.ts
 *
 * (the explicit compiler options are only needed because the nearest tsconfig
 * in this repo targets NodeNext modules for NestJS).
 *
 * The traps H1-H14 in `docs/evals/synthetic-domains.md` are planted here, and
 * the ones that must hold exactly (the 48/48 specialty tie, the three distinct
 * "most expensive member" answers, the out-of-network billed/allowed
 * distractor) are enforced by deterministic post-generation adjustment and then
 * asserted — this script throws rather than emit a fixture with a broken trap.
 */

import { writeFileSync } from 'fs';
import { join } from 'path';
import { Rng, literal, insertRows, section } from './lib/rng';

/* ------------------------------------------------------------------ knobs */

const SEED = 20260922;
const OUTPUT_PATH = join(
  __dirname,
  '..', '..', '..',
  'backend', 'src', 'modules', 'testing-data', 'fixtures',
  '004_health_insurance.sql',
);

const TOTAL_CLAIMS = 1200;
const TIE_COUNT = 48;
const TIED_SPECIALTIES = ['Oncology', 'Emergency Medicine'];
const SINK_SPECIALTY = 'Family Medicine';
const DISTRACTOR_PROVIDER = 'Cascade Spine and Orthopedic Institute';
const ALLOWED_LEADER_PROVIDER = 'Granite Peak Oncology Center';

const WINDOW_START = '2024-01-01';
const WINDOW_END = '2025-12-31';
const MARCH_2024_START = '2024-03-01';
const MARCH_2024_END = '2024-03-31';
const MARCH_2024_TEST_CLAIMS = 14;

const TEST_CLAIM_RATE = 0.022;
const PREAUTH_RATE = 0.05;
const TERMINATED_RATE = 0.08;
const MIN_REVERSED_PER_REGION = 2;

const rng = new Rng(SEED);

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(`INVARIANT FAILED: ${message}`);
}

/* ------------------------------------------------------- reference tables */

const COUNTRIES = [
  { code: 'USA', name: 'United States' },
  { code: 'CAN', name: 'Canada' },
];

const STATES = [
  { code: 'CA', name: 'California', country: 'USA' },
  { code: 'TX', name: 'Texas', country: 'USA' },
  { code: 'NY', name: 'New York', country: 'USA' },
  { code: 'OH', name: 'Ohio', country: 'USA' },
  { code: 'ON', name: 'Ontario', country: 'CAN' },
  { code: 'BC', name: 'British Columbia', country: 'CAN' },
];

const REGIONS = [
  { code: 'R-NCA', name: 'Northern California', state: 'CA', weight: 0.16 },
  { code: 'R-SCA', name: 'Southern California', state: 'CA', weight: 0.18 },
  { code: 'R-GTX', name: 'Gulf Coast Texas', state: 'TX', weight: 0.13 },
  { code: 'R-NTX', name: 'North Texas', state: 'TX', weight: 0.12 },
  { code: 'R-HUD', name: 'Hudson Valley', state: 'NY', weight: 0.12 },
  { code: 'R-OHV', name: 'Ohio Valley', state: 'OH', weight: 0.11 },
  { code: 'R-GTA', name: 'Greater Toronto', state: 'ON', weight: 0.10 },
  { code: 'R-LML', name: 'Lower Mainland', state: 'BC', weight: 0.08 },
];

const PLANS = [
  {
    code: 'HIP-B100',
    name: 'Bronze Essential 6500',
    tier: 'BRONZE',
    premium: 31200,
    deductible: 650000,
    coinsurance: 0.4,
    weight: 0.2,
    memberShareFactor: 1.35,
  },
  {
    code: 'HIP-B200',
    name: 'Bronze Value HSA 7000',
    tier: 'BRONZE',
    premium: 28900,
    deductible: 700000,
    coinsurance: 0.4,
    weight: 0.15,
    memberShareFactor: 1.4,
  },
  {
    code: 'HIP-S300',
    name: 'Silver Standard 3500',
    tier: 'SILVER',
    premium: 44800,
    deductible: 350000,
    coinsurance: 0.3,
    weight: 0.22,
    memberShareFactor: 1.0,
  },
  {
    code: 'HIP-S400',
    name: 'Silver Select Network 3000',
    tier: 'SILVER',
    premium: 47250,
    deductible: 300000,
    coinsurance: 0.3,
    weight: 0.13,
    memberShareFactor: 0.95,
  },
  {
    code: 'HIP-G500',
    name: 'Gold Preferred 1500',
    tier: 'GOLD',
    premium: 61500,
    deductible: 150000,
    coinsurance: 0.2,
    weight: 0.2,
    memberShareFactor: 0.75,
  },
  {
    code: 'HIP-P700',
    name: 'Platinum Complete 500',
    tier: 'PLATINUM',
    premium: 82400,
    deductible: 50000,
    coinsurance: 0.1,
    weight: 0.1,
    memberShareFactor: 0.55,
  },
];

const DENIAL_REASONS = [
  { code: 'CO-16', description: 'Claim lacks information needed for adjudication', category: 'CODING', weight: 0.16 },
  { code: 'CO-11', description: 'Diagnosis inconsistent with the procedure billed', category: 'CODING', weight: 0.12 },
  { code: 'CO-197', description: 'Precertification or prior authorization absent', category: 'AUTHORIZATION', weight: 0.15 },
  { code: 'CO-198', description: 'Precertification exceeded the authorized units', category: 'AUTHORIZATION', weight: 0.06 },
  { code: 'CO-50', description: 'Service not deemed medically necessary by the payer', category: 'COVERAGE', weight: 0.14 },
  { code: 'CO-204', description: 'Service not covered under the member benefit plan', category: 'COVERAGE', weight: 0.11 },
  { code: 'CO-97', description: 'Benefit already included in another adjudicated service', category: 'COVERAGE', weight: 0.07 },
  { code: 'CO-18', description: 'Exact duplicate of a previously submitted claim', category: 'DUPLICATE', weight: 0.06 },
  { code: 'CO-29', description: 'Time limit for filing the claim has expired', category: 'TIMELY_FILING', weight: 0.05 },
  { code: 'CO-27', description: 'Expenses incurred after coverage terminated', category: 'ELIGIBILITY', weight: 0.08 },
];

const APPEAL_STATUSES: readonly (readonly [string, number])[] = [
  ['NONE', 0.62],
  ['FILED', 0.16],
  ['UPHELD', 0.14],
  ['OVERTURNED', 0.08],
];

const CLAIM_STATUSES: readonly (readonly [string, number])[] = [
  ['PAID', 0.70],
  ['DENIED', 0.16],
  ['PENDING', 0.10],
  ['REVERSED', 0.04],
];

const PLACES_OF_SERVICE = [
  'OFFICE',
  'OUTPATIENT_HOSPITAL',
  'INPATIENT_HOSPITAL',
  'EMERGENCY_ROOM',
  'URGENT_CARE',
  'TELEHEALTH',
];

const CLAIM_TYPES = ['PROFESSIONAL', 'INSTITUTIONAL', 'OUTPATIENT'];

const REVENUE_CODES = ['0250', '0300', '0320', '0360', '0450', '0636', '0762'];

/* -------------------------------------------------- specialties + procedures */

interface ProcedureCode {
  code: string;
  description: string;
  price: number;
  unitsMin: number;
  unitsMax: number;
  cutRate: number;
}

interface Specialty {
  name: string;
  /** Share of all claims, before the H4 tie adjustment. */
  share: number;
  /** allowed / billed, before per-provider and per-claim jitter. */
  allowedRatio: number;
  /** member_responsibility / allowed on adjudicated claims, before jitter. */
  memberShare: number;
  billedMin: number;
  billedMax: number;
  claimTypes: readonly (readonly [string, number])[];
  places: readonly (readonly [string, number])[];
  codes: ProcedureCode[];
}

const SPECIALTIES: Specialty[] = [
  {
    name: 'Family Medicine',
    share: 0.26,
    allowedRatio: 0.78,
    memberShare: 0.11,
    billedMin: 8000,
    billedMax: 46000,
    claimTypes: [['PROFESSIONAL', 0.86], ['OUTPATIENT', 0.14]],
    places: [['OFFICE', 0.72], ['TELEHEALTH', 0.18], ['URGENT_CARE', 0.10]],
    codes: [
      { code: '99213', description: 'Office visit, established patient, 20 minutes', price: 12400, unitsMin: 1, unitsMax: 1, cutRate: 0.02 },
      { code: '99214', description: 'Office visit, established patient, 30 minutes', price: 18300, unitsMin: 1, unitsMax: 1, cutRate: 0.03 },
      { code: '36415', description: 'Collection of venous blood by venipuncture', price: 1500, unitsMin: 1, unitsMax: 2, cutRate: 0.10 },
      { code: '80053', description: 'Comprehensive metabolic panel', price: 4800, unitsMin: 1, unitsMax: 1, cutRate: 0.05 },
      { code: '90686', description: 'Influenza vaccine, quadrivalent, intramuscular', price: 3200, unitsMin: 1, unitsMax: 1, cutRate: 0.02 },
    ],
  },
  {
    name: 'Cardiology',
    share: 0.155,
    allowedRatio: 0.62,
    memberShare: 0.20,
    billedMin: 40000,
    billedMax: 380000,
    claimTypes: [['PROFESSIONAL', 0.55], ['OUTPATIENT', 0.28], ['INSTITUTIONAL', 0.17]],
    places: [['OFFICE', 0.48], ['OUTPATIENT_HOSPITAL', 0.38], ['INPATIENT_HOSPITAL', 0.14]],
    codes: [
      { code: '93000', description: 'Electrocardiogram, routine, with interpretation', price: 8900, unitsMin: 1, unitsMax: 1, cutRate: 0.05 },
      { code: '93306', description: 'Echocardiography, transthoracic, complete with Doppler', price: 64500, unitsMin: 1, unitsMax: 1, cutRate: 0.06 },
      { code: '93880', description: 'Duplex scan of extracranial arteries, complete', price: 38700, unitsMin: 1, unitsMax: 1, cutRate: 0.05 },
      { code: '33249', description: 'Insertion of pacing cardioverter-defibrillator electrode', price: 412000, unitsMin: 1, unitsMax: 1, cutRate: 0.08 },
    ],
  },
  {
    name: 'Orthopedics',
    share: 0.13,
    allowedRatio: 0.52,
    memberShare: 0.22,
    billedMin: 60000,
    billedMax: 650000,
    claimTypes: [['PROFESSIONAL', 0.42], ['OUTPATIENT', 0.33], ['INSTITUTIONAL', 0.25]],
    places: [['OFFICE', 0.36], ['OUTPATIENT_HOSPITAL', 0.44], ['INPATIENT_HOSPITAL', 0.20]],
    codes: [
      { code: '20610', description: 'Arthrocentesis, aspiration or injection, major joint', price: 14700, unitsMin: 1, unitsMax: 3, cutRate: 0.25 },
      { code: '29881', description: 'Arthroscopy, knee, surgical, with meniscectomy', price: 386000, unitsMin: 1, unitsMax: 1, cutRate: 0.06 },
      { code: '97110', description: 'Therapeutic exercise, each 15 minutes', price: 4300, unitsMin: 2, unitsMax: 8, cutRate: 0.45 },
      { code: '97140', description: 'Manual therapy techniques, each 15 minutes', price: 3900, unitsMin: 1, unitsMax: 6, cutRate: 0.40 },
      { code: '73721', description: 'MRI, lower extremity joint, without contrast', price: 98500, unitsMin: 1, unitsMax: 1, cutRate: 0.05 },
    ],
  },
  {
    name: 'Radiology',
    share: 0.125,
    allowedRatio: 0.48,
    memberShare: 0.26,
    billedMin: 25000,
    billedMax: 220000,
    claimTypes: [['OUTPATIENT', 0.58], ['PROFESSIONAL', 0.26], ['INSTITUTIONAL', 0.16]],
    places: [['OUTPATIENT_HOSPITAL', 0.66], ['OFFICE', 0.22], ['INPATIENT_HOSPITAL', 0.12]],
    codes: [
      { code: '70553', description: 'MRI brain, with and without contrast', price: 148000, unitsMin: 1, unitsMax: 1, cutRate: 0.06 },
      { code: '71046', description: 'Radiologic examination, chest, 2 views', price: 9600, unitsMin: 1, unitsMax: 2, cutRate: 0.12 },
      { code: '74177', description: 'CT abdomen and pelvis with contrast', price: 112000, unitsMin: 1, unitsMax: 1, cutRate: 0.05 },
      { code: '76700', description: 'Ultrasound, abdominal, complete', price: 27400, unitsMin: 1, unitsMax: 2, cutRate: 0.10 },
    ],
  },
  {
    name: 'Dermatology',
    share: 0.115,
    allowedRatio: 0.67,
    memberShare: 0.18,
    billedMin: 15000,
    billedMax: 90000,
    claimTypes: [['PROFESSIONAL', 0.82], ['OUTPATIENT', 0.18]],
    places: [['OFFICE', 0.84], ['OUTPATIENT_HOSPITAL', 0.09], ['TELEHEALTH', 0.07]],
    codes: [
      { code: '11042', description: 'Debridement, subcutaneous tissue, first 20 sq cm', price: 16200, unitsMin: 1, unitsMax: 3, cutRate: 0.22 },
      { code: '17110', description: 'Destruction of benign lesions, up to 14 lesions', price: 4100, unitsMin: 1, unitsMax: 14, cutRate: 0.38 },
      { code: '11102', description: 'Tangential biopsy of skin, single lesion', price: 9800, unitsMin: 1, unitsMax: 4, cutRate: 0.20 },
      { code: '96910', description: 'Photochemotherapy, tar and ultraviolet B', price: 11300, unitsMin: 1, unitsMax: 2, cutRate: 0.15 },
    ],
  },
  {
    name: 'Behavioral Health',
    share: 0.135,
    allowedRatio: 0.62,
    memberShare: 0.33,
    billedMin: 12000,
    billedMax: 42000,
    claimTypes: [['PROFESSIONAL', 0.91], ['OUTPATIENT', 0.09]],
    places: [['OFFICE', 0.52], ['TELEHEALTH', 0.43], ['OUTPATIENT_HOSPITAL', 0.05]],
    codes: [
      { code: '90837', description: 'Psychotherapy, 60 minutes with patient', price: 21500, unitsMin: 1, unitsMax: 2, cutRate: 0.14 },
      { code: '90834', description: 'Psychotherapy, 45 minutes with patient', price: 16800, unitsMin: 1, unitsMax: 2, cutRate: 0.12 },
      { code: '90853', description: 'Group psychotherapy, other than family group', price: 6400, unitsMin: 1, unitsMax: 4, cutRate: 0.30 },
      { code: '96130', description: 'Psychological testing evaluation, first hour', price: 18900, unitsMin: 1, unitsMax: 3, cutRate: 0.25 },
    ],
  },
  {
    name: 'Oncology',
    share: 0.04,
    allowedRatio: 0.58,
    memberShare: 0.09,
    billedMin: 150000,
    billedMax: 1400000,
    claimTypes: [['OUTPATIENT', 0.46], ['INSTITUTIONAL', 0.38], ['PROFESSIONAL', 0.16]],
    places: [['OUTPATIENT_HOSPITAL', 0.61], ['INPATIENT_HOSPITAL', 0.27], ['OFFICE', 0.12]],
    codes: [
      { code: '96413', description: 'Chemotherapy administration, intravenous infusion, first hour', price: 39800, unitsMin: 1, unitsMax: 1, cutRate: 0.08 },
      { code: '96415', description: 'Chemotherapy infusion, each additional hour', price: 12600, unitsMin: 1, unitsMax: 6, cutRate: 0.35 },
      { code: 'J9299', description: 'Injection, nivolumab, 1 mg', price: 2900, unitsMin: 10, unitsMax: 90, cutRate: 0.30 },
      { code: '77427', description: 'Radiation treatment management, 5 treatments', price: 52300, unitsMin: 1, unitsMax: 5, cutRate: 0.20 },
    ],
  },
  {
    name: 'Emergency Medicine',
    share: 0.04,
    allowedRatio: 0.38,
    memberShare: 0.34,
    billedMin: 90000,
    billedMax: 900000,
    claimTypes: [['INSTITUTIONAL', 0.54], ['PROFESSIONAL', 0.31], ['OUTPATIENT', 0.15]],
    places: [['EMERGENCY_ROOM', 0.78], ['URGENT_CARE', 0.22]],
    codes: [
      { code: '99283', description: 'Emergency department visit, moderate severity', price: 42700, unitsMin: 1, unitsMax: 1, cutRate: 0.04 },
      { code: '99285', description: 'Emergency department visit, high severity', price: 89400, unitsMin: 1, unitsMax: 1, cutRate: 0.05 },
      { code: 'J1885', description: 'Injection, ketorolac tromethamine, 15 mg', price: 1900, unitsMin: 1, unitsMax: 30, cutRate: 0.35 },
      { code: '99291', description: 'Critical care, first 30-74 minutes', price: 128500, unitsMin: 1, unitsMax: 1, cutRate: 0.07 },
    ],
  },
];

const SPECIALTY_BY_NAME = new Map(SPECIALTIES.map((s) => [s.name, s]));
const SPECIALTY_NAMES = SPECIALTIES.map((s) => s.name);

/* ------------------------------------------------------------- providers */

interface ProviderSeed {
  name: string;
  specialty: string;
  network: 'IN_NETWORK' | 'OUT_OF_NETWORK';
  /** Relative volume inside the specialty. */
  volume: number;
  /** Multiplies the specialty's billed range. */
  billedLevel: number;
  /** Multiplies the specialty's allowed ratio. */
  allowedMul: number;
}

const PROVIDER_SEEDS: ProviderSeed[] = [
  { name: 'Cedar Hollow Family Practice', specialty: 'Family Medicine', network: 'IN_NETWORK', volume: 0.26, billedLevel: 1.0, allowedMul: 1.02 },
  { name: 'Riverbend Primary Care Group', specialty: 'Family Medicine', network: 'IN_NETWORK', volume: 0.24, billedLevel: 0.94, allowedMul: 1.05 },
  { name: 'Northgate Family Health Clinic', specialty: 'Family Medicine', network: 'IN_NETWORK', volume: 0.2, billedLevel: 1.08, allowedMul: 0.98 },
  { name: 'Willowmere Family Medicine', specialty: 'Family Medicine', network: 'IN_NETWORK', volume: 0.18, billedLevel: 1.03, allowedMul: 1.0 },
  { name: 'Harbourview Community Physicians', specialty: 'Family Medicine', network: 'OUT_OF_NETWORK', volume: 0.12, billedLevel: 1.22, allowedMul: 0.74 },

  { name: 'Summit Ridge Cardiology', specialty: 'Cardiology', network: 'IN_NETWORK', volume: 0.32, billedLevel: 1.05, allowedMul: 1.03 },
  { name: 'Bayshore Heart Institute', specialty: 'Cardiology', network: 'IN_NETWORK', volume: 0.28, billedLevel: 1.12, allowedMul: 0.99 },
  { name: 'Kestrel Cardiovascular Partners', specialty: 'Cardiology', network: 'IN_NETWORK', volume: 0.26, billedLevel: 0.9, allowedMul: 1.04 },
  { name: 'Vantage Heart Specialists', specialty: 'Cardiology', network: 'OUT_OF_NETWORK', volume: 0.14, billedLevel: 1.35, allowedMul: 0.71 },

  { name: 'Ironwood Orthopedic Associates', specialty: 'Orthopedics', network: 'IN_NETWORK', volume: 0.45, billedLevel: 1.02, allowedMul: 1.04 },
  { name: 'Meridian Bone and Joint Center', specialty: 'Orthopedics', network: 'IN_NETWORK', volume: 0.3, billedLevel: 1.1, allowedMul: 0.98 },
  { name: DISTRACTOR_PROVIDER, specialty: 'Orthopedics', network: 'OUT_OF_NETWORK', volume: 0.25, billedLevel: 4.2, allowedMul: 0.48 },

  { name: 'Clearview Diagnostic Imaging', specialty: 'Radiology', network: 'IN_NETWORK', volume: 0.42, billedLevel: 1.0, allowedMul: 1.03 },
  { name: 'Pinnacle Radiology Services', specialty: 'Radiology', network: 'IN_NETWORK', volume: 0.36, billedLevel: 1.07, allowedMul: 0.99 },
  { name: 'Lantern Bay Imaging Center', specialty: 'Radiology', network: 'OUT_OF_NETWORK', volume: 0.22, billedLevel: 1.28, allowedMul: 0.77 },

  { name: 'Aspenwood Dermatology', specialty: 'Dermatology', network: 'IN_NETWORK', volume: 0.4, billedLevel: 1.01, allowedMul: 1.02 },
  { name: 'Coastline Skin Institute', specialty: 'Dermatology', network: 'IN_NETWORK', volume: 0.34, billedLevel: 1.09, allowedMul: 0.98 },
  { name: 'Fairhaven Dermatology Partners', specialty: 'Dermatology', network: 'IN_NETWORK', volume: 0.26, billedLevel: 0.93, allowedMul: 1.01 },

  { name: 'Stillwater Behavioral Health', specialty: 'Behavioral Health', network: 'IN_NETWORK', volume: 0.41, billedLevel: 1.0, allowedMul: 1.02 },
  { name: 'Brookfield Counseling Collective', specialty: 'Behavioral Health', network: 'IN_NETWORK', volume: 0.35, billedLevel: 0.96, allowedMul: 1.04 },
  { name: 'Northern Lights Psychiatry', specialty: 'Behavioral Health', network: 'OUT_OF_NETWORK', volume: 0.24, billedLevel: 1.21, allowedMul: 0.79 },

  { name: ALLOWED_LEADER_PROVIDER, specialty: 'Oncology', network: 'IN_NETWORK', volume: 0.55, billedLevel: 1.35, allowedMul: 1.1 },
  { name: 'Silverbrook Cancer Institute', specialty: 'Oncology', network: 'IN_NETWORK', volume: 0.45, billedLevel: 1.0, allowedMul: 1.0 },

  { name: 'Metro Central Emergency Physicians', specialty: 'Emergency Medicine', network: 'IN_NETWORK', volume: 0.58, billedLevel: 1.04, allowedMul: 1.02 },
  { name: 'Eastgate Urgent and Emergency Care', specialty: 'Emergency Medicine', network: 'OUT_OF_NETWORK', volume: 0.42, billedLevel: 1.26, allowedMul: 0.8 },
];

/* --------------------------------------------------------------- members */

const MEMBER_NAMES = [
  'Marisol Trevanion', 'Desmond Kilbraith', 'Anneke Vorstell', 'Teodoro Marchesi',
  'Priya Ramchandani', 'Callum Ashgrove', 'Yvette Dunmore', 'Rashid Almeyda',
  'Ingrid Falkenrath', 'Nolan Whitcombe', 'Sunita Balakrishnan', 'Emeka Oduya',
  'Bettina Lorquist', 'Hugo Sandoval-Reyes', 'Marguerite Okonjo', 'Tobias Fenwright',
  'Larissa Petrakis', 'Corwin Blakeney', 'Delphine Auclair', 'Malik Rasheed',
  'Imogen Starling', 'Bartholomew Quist', 'Naomi Sedgewick', 'Felix Oyelaran',
  'Rosalind Vachon', 'Jarrod Pennington', 'Amara Diallo', 'Sylvie Bergeron',
  'Otis Kranzler', 'Freya Lindqvist', 'Duncan Moriarty', 'Ines Calderon',
  'Wendell Broussard', 'Saoirse Galloway', 'Kofi Antwi', 'Lorena Bustamante',
  'Graham Thistlewood', 'Nadia Farouk', 'Percival Hargrove', 'Elodie Chastain',
  'Milos Radovic', 'Harriet Winslowe', 'Ravi Chandrasekar', 'Beatrix Hallowell',
  'Simeon Draycott', 'Oksana Meltzer', 'Julian Escobedo', 'Camille Fontaine',
  'Terrence Ashby-Cole', 'Wilhelmina Grote', 'Antoine Beaulieu', 'Sofia Karpova',
  'Marcus Idowu', 'Genevieve Pomeroy', 'Hassan Bourgiba', 'Clementine Drury',
  'Osvaldo Ferrante', 'Petra Nyquist', 'Roland Cavendish', 'Aisling Kerrigan',
];

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

/* --------------------------------------------------------- build entities */

interface MemberRow {
  idx: number;
  id: number;
  memberNumber: string;
  fullName: string;
  dateOfBirth: string;
  sex: string;
  planIdx: number;
  regionIdx: number;
  enrolledOn: string;
  terminatedOn: string | null;
  weight: number;
}

const regionWeights = REGIONS.map((r, i) => [i, r.weight] as const);
const planWeights = PLANS.map((p, i) => [i, p.weight] as const);

const members: MemberRow[] = MEMBER_NAMES.map((fullName, idx) => {
  const enrolledOn = rng.chance(0.7)
    ? WINDOW_START
    : rng.dateBetween('2024-01-15', '2024-08-31');
  const terminatedOn = rng.chance(TERMINATED_RATE)
    ? rng.dateBetween(rng.dateAfter(enrolledOn, 230), '2025-11-30')
    : null;
  return {
    idx,
    id: idx + 1,
    memberNumber: `M-${pad(100000 + idx * 7 + 3, 6)}`,
    fullName,
    dateOfBirth: `${rng.int(1946, 2006)}-${pad(rng.int(1, 12), 2)}-${pad(rng.int(1, 28), 2)}`,
    sex: rng.weighted([['F', 0.49], ['M', 0.49], ['X', 0.02]]),
    planIdx: rng.weighted(planWeights),
    regionIdx: rng.weighted(regionWeights),
    enrolledOn,
    terminatedOn,
    weight: rng.float(0.4, 2.2, 4),
  };
});

interface ProviderRow extends ProviderSeed {
  idx: number;
  id: number;
  npi: string;
  credentialedOn: string;
}

const providers: ProviderRow[] = PROVIDER_SEEDS.map((seed, idx) => ({
  ...seed,
  idx,
  id: idx + 1,
  npi: String(1_300_000_000 + idx * 8171 + rng.int(0, 800)),
  credentialedOn: rng.dateBetween('2024-01-01', '2024-06-30'),
}));

// `terminated_on` carries the "active members" filter, so top the population up
// to the planted rate deterministically instead of leaving it to the coin flips.
const TERMINATED_TARGET = Math.round(members.length * TERMINATED_RATE);
for (const idx of rng.shuffle(members.map((m) => m.idx))) {
  if (members.filter((m) => m.terminatedOn !== null).length >= TERMINATED_TARGET) break;
  const member = members[idx];
  if (member.terminatedOn !== null) continue;
  member.terminatedOn = rng.dateBetween(rng.dateAfter(member.enrolledOn, 230), '2025-11-30');
}
assert(
  members.filter((m) => m.terminatedOn !== null).length === TERMINATED_TARGET,
  `expected ${TERMINATED_TARGET} terminated members`,
);

assert(new Set(providers.map((p) => p.npi)).size === providers.length, 'NPIs must be unique');
assert(new Set(members.map((m) => m.fullName)).size === members.length, 'member names must be unique');

const providerIdxBySpecialty = new Map<string, number[]>();
for (const provider of providers) {
  const list = providerIdxBySpecialty.get(provider.specialty) ?? [];
  list.push(provider.idx);
  providerIdxBySpecialty.set(provider.specialty, list);
}
for (const name of SPECIALTY_NAMES) {
  assert((providerIdxBySpecialty.get(name) ?? []).length > 0, `${name} needs a provider`);
}

/* ----------------------------------------------------------- claim skeleton */

interface ClaimRow {
  id: number;
  claimNumber: string;
  memberIdx: number;
  providerIdx: number;
  planIdx: number;
  claimType: string;
  placeOfService: string;
  serviceDate: string;
  receivedOn: string;
  adjudicatedOn: string | null;
  status: string;
  billed: number;
  allowed: number;
  paid: number;
  responsibility: number;
  preauthCode: string | null;
  isTest: boolean;
}

const memberWeights = members.map((m) => [m.idx, m.weight] as const);
const specialtyWeights = SPECIALTIES.map((s) => [s.name, s.share] as const);

function pickProviderIdx(specialtyName: string): number {
  const pool = providerIdxBySpecialty.get(specialtyName) ?? [];
  return rng.weighted(pool.map((i) => [i, providers[i].volume] as const));
}

function specialtyOf(claim: ClaimRow): string {
  return providers[claim.providerIdx].specialty;
}

const claims: ClaimRow[] = [];
for (let i = 0; i < TOTAL_CLAIMS; i++) {
  const memberIdx = rng.weighted(memberWeights);
  const member = members[memberIdx];
  const specialtyName = rng.weighted(specialtyWeights);
  const specialty = SPECIALTY_BY_NAME.get(specialtyName)!;
  const providerIdx = pickProviderIdx(specialtyName);

  const coverageStart = maxDate(member.enrolledOn, WINDOW_START);
  const coverageEnd = minDate(member.terminatedOn ?? WINDOW_END, WINDOW_END);
  const serviceDate = rng.dateBetween(coverageStart, maxDate(coverageStart, coverageEnd));

  const receivedOn = minDate(rng.dateAfter(serviceDate, rng.int(1, 24)), WINDOW_END);
  const status = rng.weighted(CLAIM_STATUSES);
  const adjudicatedOn =
    status === 'PENDING' ? null : minDate(rng.dateAfter(receivedOn, rng.int(3, 41)), WINDOW_END);

  claims.push({
    id: 0,
    claimNumber: '',
    memberIdx,
    providerIdx,
    planIdx: member.planIdx,
    claimType: rng.weighted(specialty.claimTypes),
    placeOfService: rng.weighted(specialty.places),
    serviceDate,
    receivedOn,
    adjudicatedOn,
    status,
    billed: 0,
    allowed: 0,
    paid: 0,
    responsibility: 0,
    preauthCode: null,
    isTest: false,
  });
}

// Chronological ids make the generated SQL readable and the fixture stable.
claims.sort((a, b) =>
  a.serviceDate < b.serviceDate ? -1 : a.serviceDate > b.serviceDate ? 1 : 0,
);
claims.forEach((claim, i) => {
  claim.id = i + 1;
  claim.claimNumber = `CLM-${claim.serviceDate.slice(0, 4)}-${pad(i + 1, 6)}`;
});

/* ------------------------------------------------ H4: the exact 48/48 tie */

function countBySpecialty(name: string): ClaimRow[] {
  return claims.filter((claim) => specialtyOf(claim) === name);
}

for (const tied of TIED_SPECIALTIES) {
  let list = countBySpecialty(tied);
  while (list.length > TIE_COUNT) {
    list[list.length - 1].providerIdx = pickProviderIdx(SINK_SPECIALTY);
    list = countBySpecialty(tied);
  }
  while (list.length < TIE_COUNT) {
    const donors = countBySpecialty(SINK_SPECIALTY);
    donors[donors.length - 1].providerIdx = pickProviderIdx(tied);
    list = countBySpecialty(tied);
  }
}

// No third specialty may land on exactly 48.
for (const name of SPECIALTY_NAMES) {
  if (TIED_SPECIALTIES.includes(name)) continue;
  while (countBySpecialty(name).length === TIE_COUNT) {
    const list = countBySpecialty(name);
    list[list.length - 1].providerIdx = pickProviderIdx(SINK_SPECIALTY);
  }
}

// Claim type and place of service follow the specialty, so re-draw the ones we moved.
for (const claim of claims) {
  const specialty = SPECIALTY_BY_NAME.get(specialtyOf(claim))!;
  if (!specialty.claimTypes.some(([value]) => value === claim.claimType)) {
    claim.claimType = rng.weighted(specialty.claimTypes);
  }
  if (!specialty.places.some(([value]) => value === claim.placeOfService)) {
    claim.placeOfService = rng.weighted(specialty.places);
  }
}

/* -------------------------- H9: every region needs visible reversal volume */

// Net paid must differ from gross paid in every region in EITHER year, because
// the question the trap answers ("net paid by region in 2024") is year-scoped.
for (let regionIdx = 0; regionIdx < REGIONS.length; regionIdx++) {
  for (const year of ['2024', '2025']) {
    const slice = claims.filter(
      (claim) =>
        members[claim.memberIdx].regionIdx === regionIdx &&
        claim.serviceDate.startsWith(year),
    );
    let reversed = slice.filter((claim) => claim.status === 'REVERSED').length;
    for (const claim of slice) {
      if (reversed >= MIN_REVERSED_PER_REGION) break;
      if (claim.status !== 'PAID') continue;
      claim.status = 'REVERSED';
      reversed++;
    }
    assert(
      reversed >= MIN_REVERSED_PER_REGION,
      `region ${REGIONS[regionIdx].name} needs ${MIN_REVERSED_PER_REGION} reversed claims in ${year}`,
    );
  }
}

const isTiedSpecialty = (claim: ClaimRow) => TIED_SPECIALTIES.includes(specialtyOf(claim));

/* ---------------------------------- H3: prior authorisation on ~5% of claims */

// Exactly 5% carry a code, so the planted null rate is a stated number rather
// than a sampling accident.
const preauthTarget = Math.round(claims.length * PREAUTH_RATE);
let preauthGiven = 0;
for (const claim of rng.shuffle(claims)) {
  if (preauthGiven >= preauthTarget) break;
  claim.preauthCode = `PA-${claim.serviceDate.slice(0, 4)}-${pad(rng.int(1, 999999), 6)}`;
  preauthGiven++;
}
assert(
  claims.filter((claim) => claim.preauthCode !== null).length === preauthTarget,
  `H3: expected ${preauthTarget} claims with a prior authorisation`,
);

/* ------------------------------------------------------ amounts, in cents */

for (const claim of claims) {
  const provider = providers[claim.providerIdx];
  const specialty = SPECIALTY_BY_NAME.get(provider.specialty)!;
  const plan = PLANS[claim.planIdx];

  // Billed is a whole number of dollars, the way a charge master emits it.
  const base = rng.int(specialty.billedMin, specialty.billedMax) * provider.billedLevel;
  claim.billed = Math.max(500, Math.round(base / 100) * 100);

  if (claim.status === 'DENIED' || claim.status === 'PENDING') {
    claim.allowed = 0;
    claim.paid = 0;
    claim.responsibility = 0;
    continue;
  }

  const ratio = clamp(
    specialty.allowedRatio * provider.allowedMul * rng.float(0.88, 1.12, 4),
    0.15,
    0.95,
  );
  claim.allowed = clamp(Math.round(claim.billed * ratio), 500, claim.billed);

  const share = clamp(
    specialty.memberShare * plan.memberShareFactor * rng.float(0.7, 1.35, 4),
    0.02,
    0.85,
  );
  claim.responsibility = Math.round(claim.allowed * share);
  claim.paid = claim.allowed - claim.responsibility;
}

/* ---------- distractor: an out-of-network provider tops average BILLED only */

const distractor = providers.find((p) => p.name === DISTRACTOR_PROVIDER)!;
assert(distractor.network === 'OUT_OF_NETWORK', 'the distractor provider must be out of network');

function providerAverages(column: 'billed' | 'allowed'): { idx: number; avg: number }[] {
  return providers
    .map((provider) => {
      const own = claims.filter((claim) => claim.providerIdx === provider.idx);
      const total = own.reduce((sum, claim) => sum + claim[column], 0);
      return { idx: provider.idx, avg: own.length === 0 ? 0 : total / own.length };
    })
    .sort((a, b) => b.avg - a.avg);
}

function enforceDistractor(): void {
  const byBilled = providerAverages('billed');
  const mine = byBilled.find((row) => row.idx === distractor.idx)!;
  const best = byBilled.filter((row) => row.idx !== distractor.idx)[0];
  if (mine.avg >= best.avg * 1.2) return;
  const factor = (best.avg * 1.25) / mine.avg;
  for (const claim of claims) {
    if (claim.providerIdx !== distractor.idx) continue;
    claim.billed = Math.max(claim.billed, Math.round((claim.billed * factor) / 100) * 100);
  }
}

enforceDistractor();

/* ------- H7: billed / paid / member-responsibility name three different members */

interface MemberTotals {
  idx: number;
  billed: number;
  allowed: number;
  paid: number;
  responsibility: number;
  claimCount: number;
}

function memberTotals(includeTest = true): MemberTotals[] {
  const totals: MemberTotals[] = members.map((m) => ({
    idx: m.idx,
    billed: 0,
    allowed: 0,
    paid: 0,
    responsibility: 0,
    claimCount: 0,
  }));
  for (const claim of claims) {
    if (!includeTest && claim.isTest) continue;
    const row = totals[claim.memberIdx];
    row.billed += claim.billed;
    row.allowed += claim.allowed;
    row.paid += claim.paid;
    row.responsibility += claim.responsibility;
    row.claimCount += 1;
  }
  return totals;
}

function argmax(totals: MemberTotals[], key: keyof MemberTotals, exclude: number[] = []): MemberTotals {
  return totals
    .filter((row) => !exclude.includes(row.idx))
    .reduce((best, row) => ((row[key] as number) > (best[key] as number) ? row : best));
}

function largestClaimOf(memberIdx: number, predicate: (claim: ClaimRow) => boolean): ClaimRow {
  const own = claims
    .filter((claim) => claim.memberIdx === memberIdx && !claim.isTest && predicate(claim))
    .sort((a, b) => b.billed - a.billed || a.id - b.id);
  assert(own.length > 0, `member ${memberIdx} has no claim matching the H7 boost predicate`);
  return own[0];
}

const baseTotals = memberTotals();
const topBilledMember = argmax(baseTotals, 'billed');

// Paid: the runner-up on paid gets lifted clear of everyone else.
const paidMember = argmax(baseTotals, 'paid', [topBilledMember.idx]);
{
  const others = baseTotals.filter((row) => row.idx !== paidMember.idx);
  const target = Math.ceil(Math.max(...others.map((row) => row.paid)) * 1.15);
  const delta = target - paidMember.paid;
  if (delta > 0) {
    const claim = largestClaimOf(paidMember.idx, (c) => c.status === 'PAID');
    claim.paid += delta;
    claim.allowed = claim.paid + claim.responsibility;
    claim.billed = Math.max(claim.billed, Math.ceil(claim.allowed / 0.95 / 100) * 100);
  }
}

// Member responsibility: a third member, lifted the same way.
const afterPaid = memberTotals();
const responsibilityMember = argmax(afterPaid, 'responsibility', [
  topBilledMember.idx,
  paidMember.idx,
]);
{
  const others = afterPaid.filter((row) => row.idx !== responsibilityMember.idx);
  const target = Math.ceil(Math.max(...others.map((row) => row.responsibility)) * 1.15);
  const delta = target - responsibilityMember.responsibility;
  if (delta > 0) {
    const claim = largestClaimOf(responsibilityMember.idx, (c) => c.status === 'PAID');
    claim.responsibility += delta;
    claim.allowed = claim.paid + claim.responsibility;
    claim.billed = Math.max(claim.billed, Math.ceil(claim.allowed / 0.95 / 100) * 100);
  }
}

// Billed last, so it clears the two claims we just grew.
{
  const totals = memberTotals();
  const others = totals.filter((row) => row.idx !== topBilledMember.idx);
  const target = Math.ceil(Math.max(...others.map((row) => row.billed)) * 1.15);
  const mine = totals[topBilledMember.idx];
  const delta = target - mine.billed;
  if (delta > 0) {
    const claim = largestClaimOf(topBilledMember.idx, () => true);
    claim.billed = Math.ceil((claim.billed + delta) / 100) * 100;
  }
}

/* --------------------- H10: test claims, concentrated in March 2024 */

// Flagged last, and never on the claims that carry H4 or H7, so those two
// answers are the same whether or not the default `is_test = false` filter is
// applied. Only the March 2024 volume is meant to move.
const H7_MEMBERS = [topBilledMember.idx, paidMember.idx, responsibilityMember.idx];
const testable = (claim: ClaimRow) =>
  !isTiedSpecialty(claim) && !H7_MEMBERS.includes(claim.memberIdx);

for (const claim of claims) {
  claim.isTest = testable(claim) && rng.chance(TEST_CLAIM_RATE);
}

const marchClaims = claims.filter(
  (claim) => claim.serviceDate >= MARCH_2024_START && claim.serviceDate <= MARCH_2024_END,
);
let marchTests = marchClaims.filter((claim) => claim.isTest).length;
for (const claim of marchClaims) {
  if (marchTests >= MARCH_2024_TEST_CLAIMS) break;
  if (claim.isTest || !testable(claim)) continue;
  claim.isTest = true;
  marchTests++;
}
assert(
  marchTests === MARCH_2024_TEST_CLAIMS,
  `March 2024 should carry exactly ${MARCH_2024_TEST_CLAIMS} test claims, got ${marchTests}`,
);

/* ------------------------------------------------------------ claim lines */

interface LineRow {
  claimId: number;
  lineNumber: number;
  procedureCode: string;
  procedureDescription: string;
  revenueCode: string | null;
  unitsBilled: number;
  unitsAllowed: number;
  billed: number;
  allowed: number;
}

const LINE_COUNTS: readonly (readonly [number, number])[] = [
  [1, 0.35],
  [2, 0.30],
  [3, 0.22],
  [4, 0.13],
];

const lines: LineRow[] = [];
for (const claim of claims) {
  const specialty = SPECIALTY_BY_NAME.get(specialtyOf(claim))!;
  const lineCount = Math.min(rng.weighted(LINE_COUNTS), specialty.codes.length);
  const picked = rng.shuffle(specialty.codes).slice(0, lineCount);

  const units = picked.map((code) => rng.int(code.unitsMin, code.unitsMax));
  const weights = picked.map((code, i) => Math.max(1, code.price * units[i]));
  const billedSplit = allocate(claim.billed, weights);
  const allowedSplit = allocate(claim.allowed, billedSplit);

  picked.forEach((code, i) => {
    const unitsBilled = units[i];
    let unitsAllowed = unitsBilled;
    if (claim.allowed === 0) {
      unitsAllowed = 0;
    } else if (rng.chance(code.cutRate)) {
      unitsAllowed = unitsBilled - rng.int(1, Math.max(1, Math.floor(unitsBilled * 0.5)));
    }
    assert(unitsAllowed <= unitsBilled && unitsAllowed >= 0, 'units_allowed out of range');
    assert(billedSplit[i] > 0, `claim ${claim.id} produced a zero-value line`);
    assert(allowedSplit[i] <= billedSplit[i], `claim ${claim.id} line allowed exceeds billed`);

    lines.push({
      claimId: claim.id,
      lineNumber: i + 1,
      procedureCode: code.code,
      procedureDescription: code.description,
      revenueCode: claim.claimType === 'INSTITUTIONAL' ? rng.pick(REVENUE_CODES) : null,
      unitsBilled,
      unitsAllowed,
      billed: billedSplit[i],
      allowed: allowedSplit[i],
    });
  });
}

/* ---------------------------------------------------------- claim denials */

interface DenialRow {
  claimId: number;
  reasonId: number;
  deniedOn: string;
  appealStatus: string;
}

const reasonWeights = DENIAL_REASONS.map((r, i) => [i + 1, r.weight] as const);
const denials: DenialRow[] = [];
for (const claim of claims) {
  if (claim.status !== 'DENIED') continue;
  const count = rng.chance(0.15) ? 2 : 1;
  const used = new Set<number>();
  for (let k = 0; k < count; k++) {
    let reasonId = rng.weighted(reasonWeights);
    let guard = 0;
    while (used.has(reasonId) && guard++ < 20) reasonId = rng.weighted(reasonWeights);
    if (used.has(reasonId)) continue;
    used.add(reasonId);
    denials.push({
      claimId: claim.id,
      reasonId,
      deniedOn: claim.adjudicatedOn ?? claim.receivedOn,
      appealStatus: rng.weighted(APPEAL_STATUSES),
    });
  }
}

/* -------------------------------------------------------------- invariants */

// Row-level money and date rules mirror the CHECK constraints in the DDL.
for (const claim of claims) {
  assert(claim.allowed <= claim.billed, `claim ${claim.id}: allowed exceeds billed`);
  assert(claim.billed > 0, `claim ${claim.id}: billed must be positive`);
  assert(claim.serviceDate >= WINDOW_START && claim.serviceDate <= WINDOW_END, `claim ${claim.id}: service date outside 2024-2025`);
  assert(claim.receivedOn >= claim.serviceDate && claim.receivedOn <= WINDOW_END, `claim ${claim.id}: bad received date`);
  if (claim.status === 'PAID') {
    assert(claim.paid + claim.responsibility === claim.allowed, `claim ${claim.id}: PAID must balance`);
    assert(claim.paid > 0, `claim ${claim.id}: PAID needs a positive payment`);
  }
  if (claim.status === 'DENIED') assert(claim.paid === 0, `claim ${claim.id}: DENIED must pay 0`);
  if (claim.status === 'PENDING') {
    assert(claim.paid === 0 && claim.adjudicatedOn === null, `claim ${claim.id}: PENDING must be unadjudicated`);
  }
  if (claim.status === 'REVERSED') assert(claim.paid > 0, `claim ${claim.id}: REVERSED must carry a positive payment`);
  if (claim.status !== 'PENDING') assert(claim.adjudicatedOn !== null, `claim ${claim.id}: needs an adjudication date`);
}

// H4 - exactly two specialties on exactly 48 claims, and nobody else.
const specialtyCounts = SPECIALTY_NAMES.map((name) => ({ name, count: countBySpecialty(name).length }));
const at48 = specialtyCounts.filter((row) => row.count === TIE_COUNT).map((row) => row.name).sort();
assert(
  at48.length === 2 && at48.join('|') === [...TIED_SPECIALTIES].sort().join('|'),
  `H4: exactly ${TIED_SPECIALTIES.join(' and ')} must sit on ${TIE_COUNT} claims, got ${JSON.stringify(specialtyCounts)}`,
);
for (const tied of TIED_SPECIALTIES) {
  assert(
    countBySpecialty(tied).every((claim) => !claim.isTest),
    `H4: ${tied} must contain no test claims, so the tie survives the default filter`,
  );
}

// H1 - the paid/billed ratio must separate the specialties, and never equal 1.
function specialtyRatios(includeTest = true): { name: string; ratio: number; billed: number; paid: number }[] {
  return SPECIALTY_NAMES.map((name) => {
    const own = claims.filter((claim) => specialtyOf(claim) === name && (includeTest || !claim.isTest));
    const billed = own.reduce((sum, claim) => sum + claim.billed, 0);
    const paid = own.reduce((sum, claim) => sum + claim.paid, 0);
    return { name, billed, paid, ratio: paid / billed };
  }).sort((a, b) => b.ratio - a.ratio);
}

for (const includeTest of [true, false]) {
  const ratios = specialtyRatios(includeTest);
  for (const row of ratios) {
    assert(row.ratio > 0 && row.ratio < 0.99, `H1: ${row.name} ratio ${row.ratio} is degenerate`);
  }
  for (let i = 1; i < ratios.length; i++) {
    assert(
      ratios[i - 1].ratio - ratios[i].ratio >= 0.02,
      `H1: ${ratios[i - 1].name} and ${ratios[i].name} are too close -- ${ratios
        .map((r) => `${r.name}=${r.ratio.toFixed(4)}`)
        .join(', ')}`,
    );
  }
}

// H7 - three different members top the three money columns, with clear margins.
function assertDistinctTopMembers(includeTest: boolean): void {
  const totals = memberTotals(includeTest);
  const keys: (keyof MemberTotals)[] = ['billed', 'paid', 'responsibility'];
  const winners: number[] = [];
  for (const key of keys) {
    const ranked = [...totals].sort((a, b) => (b[key] as number) - (a[key] as number));
    assert(
      (ranked[0][key] as number) >= (ranked[1][key] as number) * 1.1,
      `H7: the top member on ${key} is not clear of the runner-up`,
    );
    winners.push(ranked[0].idx);
  }
  assert(new Set(winners).size === 3, `H7: billed/paid/responsibility must name three different members (includeTest=${includeTest})`);
}
assertDistinctTopMembers(true);
assertDistinctTopMembers(false);

// H8 - "which member had the most claims" must have a single answer.
{
  const ranked = [...memberTotals()].sort((a, b) => b.claimCount - a.claimCount);
  assert(ranked[0].claimCount > ranked[1].claimCount, 'H8: the busiest member must be unique');
}

// H9 - reversals are big enough to move net paid in every region, in each year.
for (let regionIdx = 0; regionIdx < REGIONS.length; regionIdx++) {
  for (const year of ['2024', '2025']) {
    const slice = claims.filter(
      (claim) =>
        members[claim.memberIdx].regionIdx === regionIdx && claim.serviceDate.startsWith(year),
    );
    const reversedPaid = slice
      .filter((claim) => claim.status === 'REVERSED')
      .reduce((sum, claim) => sum + claim.paid, 0);
    assert(
      reversedPaid > 0,
      `H9: ${REGIONS[regionIdx].name} has no reversed payment to subtract in ${year}`,
    );
  }
}

// H10 - including test claims changes the March 2024 count.
{
  const all = marchClaims.length;
  const real = marchClaims.filter((claim) => !claim.isTest).length;
  assert(all - real === MARCH_2024_TEST_CLAIMS && real > 0, 'H10: March 2024 must differ with and without test claims');
}

// H2/H3/H6 - constant currency, mostly-null preauth, nothing outside the window.
{
  const withPreauth = claims.filter((claim) => claim.preauthCode !== null).length;
  const nullRate = 1 - withPreauth / claims.length;
  assert(nullRate > 0.92 && nullRate < 0.98, `H3: preauth null rate ${nullRate} is outside the planted band`);
}

// Distractor - out-of-network provider tops average billed but not average allowed.
{
  const byBilled = providerAverages('billed');
  const byAllowed = providerAverages('allowed');
  assert(byBilled[0].idx === distractor.idx, 'distractor: the out-of-network provider must top average billed');
  assert(byBilled[0].avg >= byBilled[1].avg * 1.15, 'distractor: the average-billed lead is too narrow');
  assert(byAllowed[0].idx !== distractor.idx, 'distractor: it must NOT top average allowed');
  assert(byAllowed[0].avg >= byAllowed[1].avg * 1.05, 'distractor: the average-allowed winner is ambiguous');
}

/* ----------------------------------------------------------------- DDL */

const HEADER = `-- =============================================================================
-- health_insurance -- synthetic fixture for the Questions to Insights eval set
--
-- GENERATED FILE. DO NOT EDIT BY HAND.
-- Edit the generator and regenerate; hand edits are lost on the next run.
--
--   generator : docker/postgres/generate/health-insurance.ts
--   seed      : ${SEED}   (single hard-coded constant -- the output is
--               byte-identical on every run, so hand-verified eval SQL stays valid)
--   regenerate: npx ts-node -T \\
--                 --compilerOptions '{"module":"commonjs","moduleResolution":"node"}' \\
--                 docker/postgres/generate/health-insurance.ts
--
-- Surrogate keys are left to the identity columns: rows are inserted in the
-- order the generator emits them, so id 1..N follows that order and the foreign
-- keys below are the matching literals.
--
-- Every claim service date falls inside calendar 2024 or 2025, and no value in
-- this file depends on the date it was generated. Member dates of birth are the
-- only dates outside that window, by nature.
-- =============================================================================

BEGIN;

CREATE SCHEMA health_insurance;
SET search_path TO health_insurance, public;

CREATE TABLE countries (
  code char(3) PRIMARY KEY,
  name text NOT NULL UNIQUE
);

CREATE TABLE states (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  country_code char(3) NOT NULL REFERENCES countries(code),
  code text NOT NULL,
  name text NOT NULL UNIQUE,
  UNIQUE (country_code, code)
);

CREATE TABLE regions (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  state_id bigint NOT NULL REFERENCES states(id),
  code text NOT NULL UNIQUE,
  name text NOT NULL UNIQUE
);

CREATE TABLE plans (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  plan_code text NOT NULL UNIQUE,
  name text NOT NULL UNIQUE,
  tier text NOT NULL CHECK (tier IN ('BRONZE', 'SILVER', 'GOLD', 'PLATINUM')),
  monthly_premium_cents bigint NOT NULL CHECK (monthly_premium_cents > 0),
  annual_deductible_cents bigint NOT NULL CHECK (annual_deductible_cents >= 0),
  coinsurance_rate numeric(4,3) NOT NULL CHECK (coinsurance_rate BETWEEN 0 AND 1)
);

CREATE TABLE members (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  member_number text NOT NULL UNIQUE,
  full_name text NOT NULL UNIQUE,
  date_of_birth date NOT NULL,
  sex text NOT NULL CHECK (sex IN ('F', 'M', 'X')),
  plan_id bigint NOT NULL REFERENCES plans(id),
  region_id bigint NOT NULL REFERENCES regions(id),
  enrolled_on date NOT NULL,
  terminated_on date,
  CHECK (terminated_on IS NULL OR terminated_on > enrolled_on)
);

CREATE TABLE providers (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  npi char(10) NOT NULL UNIQUE,
  name text NOT NULL UNIQUE,
  specialty text NOT NULL CHECK (specialty IN (${SPECIALTY_NAMES.map((n) => literal(n)).join(', ')})),
  network_status text NOT NULL CHECK (network_status IN ('IN_NETWORK', 'OUT_OF_NETWORK')),
  credentialed_on date NOT NULL
);

CREATE TABLE denial_reasons (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  code text NOT NULL UNIQUE,
  description text NOT NULL,
  category text NOT NULL CHECK (category IN ('ELIGIBILITY', 'AUTHORIZATION', 'CODING', 'COVERAGE', 'DUPLICATE', 'TIMELY_FILING'))
);

CREATE TABLE claims (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  claim_number text NOT NULL UNIQUE,
  member_id bigint NOT NULL REFERENCES members(id),
  provider_id bigint NOT NULL REFERENCES providers(id),
  plan_id bigint NOT NULL REFERENCES plans(id),
  claim_type text NOT NULL CHECK (claim_type IN (${CLAIM_TYPES.map((t) => literal(t)).join(', ')})),
  place_of_service text NOT NULL CHECK (place_of_service IN (${PLACES_OF_SERVICE.map((p) => literal(p)).join(', ')})),
  service_date date NOT NULL CHECK (service_date BETWEEN DATE '${WINDOW_START}' AND DATE '${WINDOW_END}'),
  received_on date NOT NULL,
  adjudicated_on date,
  status text NOT NULL CHECK (status IN ('PAID', 'DENIED', 'PENDING', 'REVERSED')),
  currency text NOT NULL DEFAULT 'USD' CHECK (currency = 'USD'),
  billed_amount_cents bigint NOT NULL CHECK (billed_amount_cents > 0),
  allowed_amount_cents bigint NOT NULL CHECK (allowed_amount_cents >= 0),
  paid_amount_cents bigint NOT NULL CHECK (paid_amount_cents >= 0),
  member_responsibility_cents bigint NOT NULL CHECK (member_responsibility_cents >= 0),
  preauth_code text,
  is_test boolean NOT NULL DEFAULT false,
  CHECK (allowed_amount_cents <= billed_amount_cents),
  CHECK (received_on >= service_date),
  CHECK (adjudicated_on IS NULL OR adjudicated_on >= received_on),
  CHECK ((status = 'PENDING') = (adjudicated_on IS NULL)),
  CHECK (status <> 'PENDING' OR paid_amount_cents = 0),
  CHECK (status <> 'DENIED' OR paid_amount_cents = 0),
  CHECK (status <> 'PAID' OR paid_amount_cents + member_responsibility_cents = allowed_amount_cents)
);

CREATE TABLE claim_lines (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  claim_id bigint NOT NULL REFERENCES claims(id) ON DELETE CASCADE,
  line_number integer NOT NULL CHECK (line_number > 0),
  procedure_code text NOT NULL,
  procedure_description text NOT NULL,
  revenue_code text,
  units_billed integer NOT NULL CHECK (units_billed > 0),
  units_allowed integer NOT NULL CHECK (units_allowed >= 0),
  line_billed_amount_cents bigint NOT NULL CHECK (line_billed_amount_cents > 0),
  line_allowed_amount_cents bigint NOT NULL CHECK (line_allowed_amount_cents >= 0),
  UNIQUE (claim_id, line_number),
  CHECK (units_allowed <= units_billed),
  CHECK (line_allowed_amount_cents <= line_billed_amount_cents)
);

CREATE TABLE claim_denials (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  claim_id bigint NOT NULL REFERENCES claims(id) ON DELETE CASCADE,
  denial_reason_id bigint NOT NULL REFERENCES denial_reasons(id),
  denied_on date NOT NULL,
  appeal_status text NOT NULL DEFAULT 'NONE' CHECK (appeal_status IN ('NONE', 'FILED', 'UPHELD', 'OVERTURNED')),
  UNIQUE (claim_id, denial_reason_id)
);

CREATE INDEX claims_member_idx ON claims (member_id);
CREATE INDEX claims_provider_idx ON claims (provider_id);
CREATE INDEX claims_service_date_idx ON claims (service_date);
CREATE INDEX claims_status_idx ON claims (status);
CREATE INDEX claim_lines_claim_idx ON claim_lines (claim_id);
CREATE INDEX claim_lines_procedure_idx ON claim_lines (procedure_code);
CREATE INDEX claim_denials_claim_idx ON claim_denials (claim_id);
CREATE INDEX members_region_idx ON members (region_id);
`;

/* -------------------------------------------------------------- the views */

const VIEWS = `CREATE VIEW v_claim_financials AS
SELECT
  claim.id AS claim_id,
  claim.claim_number,
  claim.service_date,
  claim.received_on,
  claim.adjudicated_on,
  claim.status,
  claim.claim_type,
  claim.place_of_service,
  claim.currency,
  claim.preauth_code,
  claim.is_test,
  member.id AS member_id,
  member.member_number,
  member.full_name AS member_name,
  provider.id AS provider_id,
  provider.name AS provider_name,
  provider.specialty,
  provider.network_status,
  plan.name AS plan_name,
  plan.tier AS plan_tier,
  region.name AS region_name,
  state.name AS state_name,
  country.name AS country_name,
  claim.billed_amount_cents,
  claim.allowed_amount_cents,
  claim.paid_amount_cents,
  claim.member_responsibility_cents
FROM claims claim
JOIN members member ON member.id = claim.member_id
JOIN providers provider ON provider.id = claim.provider_id
JOIN plans plan ON plan.id = claim.plan_id
JOIN regions region ON region.id = member.region_id
JOIN states state ON state.id = region.state_id
JOIN countries country ON country.code = state.country_code;

CREATE VIEW v_member_claim_totals AS
SELECT
  member.id AS member_id,
  member.member_number,
  member.full_name AS member_name,
  plan.name AS plan_name,
  region.name AS region_name,
  member.terminated_on,
  count(claim.id) AS claim_count,
  coalesce(sum(claim.billed_amount_cents), 0) AS billed_amount_cents,
  coalesce(sum(claim.allowed_amount_cents), 0) AS allowed_amount_cents,
  coalesce(sum(claim.paid_amount_cents), 0) AS paid_amount_cents,
  coalesce(sum(claim.member_responsibility_cents), 0) AS member_responsibility_cents
FROM members member
JOIN plans plan ON plan.id = member.plan_id
JOIN regions region ON region.id = member.region_id
LEFT JOIN claims claim ON claim.member_id = member.id
GROUP BY member.id, member.member_number, member.full_name, plan.name, region.name, member.terminated_on;

COMMENT ON SCHEMA health_insurance IS
  ${literal('Synthetic eval fixture: a mid-size regional health plan. Money is stored in cents. Claims cover calendar 2024 and 2025 only.')};
COMMENT ON COLUMN claims.is_test IS
  ${literal('Synthetic end-to-end test traffic. Excluded from reported volumes by default.')};
COMMENT ON COLUMN claims.paid_amount_cents IS
  ${literal('Gross payment. REVERSED claims carry a positive value that must be subtracted for net paid.')};
COMMENT ON VIEW v_claim_financials IS
  ${literal('One row per claim. region/state/country are the MEMBER location.')};

COMMIT;
`;

/* ------------------------------------------------------------ INSERT rows */

const stateIdByCode = new Map(STATES.map((state, i) => [state.code, i + 1]));

const blocks: string[] = [
  HEADER,
  section('countries'),
  insertRows('countries', ['code', 'name'], COUNTRIES.map((c) => [c.code, c.name])),
  section('states'),
  insertRows(
    'states',
    ['country_code', 'code', 'name'],
    STATES.map((s) => [s.country, s.code, s.name]),
  ),
  section('regions'),
  insertRows(
    'regions',
    ['state_id', 'code', 'name'],
    REGIONS.map((r) => [stateIdByCode.get(r.state)!, r.code, r.name]),
  ),
  section('plans'),
  insertRows(
    'plans',
    ['plan_code', 'name', 'tier', 'monthly_premium_cents', 'annual_deductible_cents', 'coinsurance_rate'],
    PLANS.map((p) => [p.code, p.name, p.tier, p.premium, p.deductible, p.coinsurance]),
  ),
  section('members'),
  insertRows(
    'members',
    ['member_number', 'full_name', 'date_of_birth', 'sex', 'plan_id', 'region_id', 'enrolled_on', 'terminated_on'],
    members.map((m) => [
      m.memberNumber,
      m.fullName,
      m.dateOfBirth,
      m.sex,
      m.planIdx + 1,
      m.regionIdx + 1,
      m.enrolledOn,
      m.terminatedOn,
    ]),
  ),
  section('providers'),
  insertRows(
    'providers',
    ['npi', 'name', 'specialty', 'network_status', 'credentialed_on'],
    providers.map((p) => [p.npi, p.name, p.specialty, p.network, p.credentialedOn]),
  ),
  section('denial_reasons'),
  insertRows(
    'denial_reasons',
    ['code', 'description', 'category'],
    DENIAL_REASONS.map((r) => [r.code, r.description, r.category]),
  ),
  section('claims'),
  insertRows(
    'claims',
    [
      'claim_number', 'member_id', 'provider_id', 'plan_id', 'claim_type', 'place_of_service',
      'service_date', 'received_on', 'adjudicated_on', 'status', 'currency',
      'billed_amount_cents', 'allowed_amount_cents', 'paid_amount_cents',
      'member_responsibility_cents', 'preauth_code', 'is_test',
    ],
    claims.map((c) => [
      c.claimNumber,
      c.memberIdx + 1,
      c.providerIdx + 1,
      c.planIdx + 1,
      c.claimType,
      c.placeOfService,
      c.serviceDate,
      c.receivedOn,
      c.adjudicatedOn,
      c.status,
      'USD',
      c.billed,
      c.allowed,
      c.paid,
      c.responsibility,
      c.preauthCode,
      c.isTest,
    ]),
  ),
  section('claim_lines'),
  insertRows(
    'claim_lines',
    [
      'claim_id', 'line_number', 'procedure_code', 'procedure_description', 'revenue_code',
      'units_billed', 'units_allowed', 'line_billed_amount_cents', 'line_allowed_amount_cents',
    ],
    lines.map((l) => [
      l.claimId, l.lineNumber, l.procedureCode, l.procedureDescription, l.revenueCode,
      l.unitsBilled, l.unitsAllowed, l.billed, l.allowed,
    ]),
  ),
  section('claim_denials'),
  insertRows(
    'claim_denials',
    ['claim_id', 'denial_reason_id', 'denied_on', 'appeal_status'],
    denials.map((d) => [d.claimId, d.reasonId, d.deniedOn, d.appealStatus]),
  ),
  section('analytics views'),
  VIEWS,
];

writeFileSync(OUTPUT_PATH, `${blocks.join('\n\n')}`, 'utf8');

/* -------------------------------------------------------------- stdout */

const counts: [string, number][] = [
  ['countries', COUNTRIES.length],
  ['states', STATES.length],
  ['regions', REGIONS.length],
  ['plans', PLANS.length],
  ['members', members.length],
  ['providers', providers.length],
  ['denial_reasons', DENIAL_REASONS.length],
  ['claims', claims.length],
  ['claim_lines', lines.length],
  ['claim_denials', denials.length],
];

console.log(`health_insurance fixture written to ${OUTPUT_PATH} (seed ${SEED})`);
for (const [table, count] of counts) {
  console.log(`  ${table.padEnd(16)} ${String(count).padStart(6)}`);
}

const finalTotals = memberTotals();
const nameOf = (idx: number) => members[idx].fullName;
const topBilled = [...finalTotals].sort((a, b) => b.billed - a.billed)[0];
const topPaid = [...finalTotals].sort((a, b) => b.paid - a.paid)[0];
const topResp = [...finalTotals].sort((a, b) => b.responsibility - a.responsibility)[0];
const topClaims = [...finalTotals].sort((a, b) => b.claimCount - a.claimCount)[0];

console.log('\n  planted answers');
console.log(`    H4 tie (${TIE_COUNT} claims each): ${at48.join(', ')}`);
console.log(`    H7 top billed          : ${nameOf(topBilled.idx)} (${topBilled.billed} cents)`);
console.log(`    H7 top paid            : ${nameOf(topPaid.idx)} (${topPaid.paid} cents)`);
console.log(`    H7 top responsibility  : ${nameOf(topResp.idx)} (${topResp.responsibility} cents)`);
console.log(`    H8 most claims         : ${nameOf(topClaims.idx)} (${topClaims.claimCount})`);
console.log(`    H10 March 2024         : ${marchClaims.length} claims, ${marchClaims.filter((c) => !c.isTest).length} excluding is_test`);
console.log(`    H3 preauth non-null    : ${claims.filter((c) => c.preauthCode !== null).length} / ${claims.length}`);
console.log('    H1 paid/billed by specialty');
for (const row of specialtyRatios()) {
  console.log(`      ${row.name.padEnd(20)} ${row.ratio.toFixed(4)}`);
}
