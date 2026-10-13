/**
 * Generator for the synthetic clinical-genomics fixture (`genomics` schema).
 *
 * Writes `backend/src/modules/testing-data/fixtures/004_genomics.sql`, the Testing Data
 * seed (`docker/postgres/init/003_genomics.sql` on feat/engine-eval-loop). Every random draw comes from a
 * single seeded `Rng`, so the SQL is byte-identical on every run and a
 * hand-verified `expectedSql` in the eval set stays valid across regenerations.
 *
 * The domain is designed around the trap catalogue in
 * `docs/evals/synthetic-domains.md` (Domain 2 — `genomics`, traps G1-G15). The
 * planted facts are asserted here, in the generator, so a future edit that
 * breaks a trap fails loudly instead of quietly invalidating the eval set.
 *
 * Run with (the compiler-options override is only needed because the backend
 * tsconfig this ts-node install reads is NodeNext; this script is CommonJS):
 *   cd backend && TS_NODE_COMPILER_OPTIONS='{"module":"commonjs","moduleResolution":"node"}' \
 *     ./node_modules/.bin/ts-node -T ../docker/postgres/generate/genomics.ts
 */

import { writeFileSync } from 'fs';
import { join } from 'path';

import { Rng, literal, insertRows, section } from './lib/rng';

/** The one knob. Change it and every hand-verified answer must be re-checked. */
const SEED = 20240815;

const OUTPUT_PATH = join(
  __dirname,
  '..', '..', '..',
  'backend', 'src', 'modules', 'testing-data', 'fixtures',
  '004_genomics.sql',
);

const SUBJECT_TOTAL = 120;
const SAMPLE_TOTAL = 140;
const VARIANT_TOTAL = 450;
const EXPRESSION_SAMPLE_TOTAL = 75;

const rng = new Rng(SEED);

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`genomics generator: ${message}`);
}

function pad(value: number, width: number): string {
  return String(value).padStart(width, '0');
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** ISO dates compare correctly as strings, so the cap is a plain comparison. */
function clampDate(value: string, max: string): string {
  return value > max ? max : value;
}

/* ------------------------------------------------ ancestry reference data */

type SuperpopulationSeed = { code: string; name: string };

const SUPERPOPULATIONS: readonly SuperpopulationSeed[] = [
  { code: 'AFR', name: 'African' },
  { code: 'AMR', name: 'Admixed American' },
  { code: 'EAS', name: 'East Asian' },
  { code: 'EUR', name: 'European' },
  { code: 'SAS', name: 'South Asian' },
  { code: 'MID', name: 'Middle Eastern' },
  { code: 'OCE', name: 'Oceanian' },
  { code: 'OTH', name: 'Other or Unassigned' },
];

type AncestryGroupSeed = { code: string; name: string; superpopulation: string };

const ANCESTRY_GROUPS: readonly AncestryGroupSeed[] = [
  { code: 'ACB', name: 'African Caribbean in Barbados', superpopulation: 'AFR' },
  { code: 'ASW', name: 'African Ancestry in Southwest USA', superpopulation: 'AFR' },
  { code: 'ESN', name: 'Esan in Nigeria', superpopulation: 'AFR' },
  { code: 'LWK', name: 'Luhya in Webuye, Kenya', superpopulation: 'AFR' },
  { code: 'YRI', name: 'Yoruba in Ibadan, Nigeria', superpopulation: 'AFR' },
  { code: 'CLM', name: 'Colombian in Medellin, Colombia', superpopulation: 'AMR' },
  { code: 'MXL', name: 'Mexican Ancestry in Los Angeles', superpopulation: 'AMR' },
  { code: 'PEL', name: 'Peruvian in Lima, Peru', superpopulation: 'AMR' },
  { code: 'PUR', name: 'Puerto Rican in Puerto Rico', superpopulation: 'AMR' },
  { code: 'CHB', name: 'Han Chinese in Beijing, China', superpopulation: 'EAS' },
  { code: 'CHS', name: 'Southern Han Chinese', superpopulation: 'EAS' },
  { code: 'JPT', name: 'Japanese in Tokyo, Japan', superpopulation: 'EAS' },
  { code: 'CEU', name: 'Utah Residents with Northern European Ancestry', superpopulation: 'EUR' },
  { code: 'FIN', name: 'Finnish in Finland', superpopulation: 'EUR' },
  { code: 'GBR', name: 'British in England and Scotland', superpopulation: 'EUR' },
  { code: 'TSI', name: 'Toscani in Italia', superpopulation: 'EUR' },
  { code: 'BEB', name: 'Bengali in Bangladesh', superpopulation: 'SAS' },
  { code: 'GIH', name: 'Gujarati Indian in Houston', superpopulation: 'SAS' },
  { code: 'PJL', name: 'Punjabi in Lahore, Pakistan', superpopulation: 'SAS' },
  { code: 'LBN', name: 'Lebanese in Beirut', superpopulation: 'MID' },
  { code: 'PNG', name: 'Papuan Highlanders', superpopulation: 'OCE' },
  { code: 'UNA', name: 'Unassigned or Declined to State', superpopulation: 'OTH' },
];

/* --------------------------------------------------------- gene reference */

type GeneSeed = {
  symbol: string;
  name: string;
  ensembl: string;
  chromosome: string;
  start: number;
  end: number;
  strand: number;
  biotype: string;
};

/**
 * Real HGNC symbols with plausible GRCh38 coordinates. Everything downstream of
 * this list -- variants, calls, expression -- is invented.
 */
const GENES: readonly GeneSeed[] = [
  { symbol: 'BRCA1', name: 'BRCA1 DNA repair associated', ensembl: 'ENSG00000012048', chromosome: '17', start: 43044295, end: 43170245, strand: -1, biotype: 'protein_coding' },
  { symbol: 'BRCA2', name: 'BRCA2 DNA repair associated', ensembl: 'ENSG00000139618', chromosome: '13', start: 32315474, end: 32400266, strand: 1, biotype: 'protein_coding' },
  { symbol: 'TP53', name: 'tumor protein p53', ensembl: 'ENSG00000141510', chromosome: '17', start: 7668402, end: 7687550, strand: -1, biotype: 'protein_coding' },
  { symbol: 'EGFR', name: 'epidermal growth factor receptor', ensembl: 'ENSG00000146648', chromosome: '7', start: 55019017, end: 55211628, strand: 1, biotype: 'protein_coding' },
  { symbol: 'KRAS', name: 'KRAS proto-oncogene, GTPase', ensembl: 'ENSG00000133703', chromosome: '12', start: 25205246, end: 25250929, strand: -1, biotype: 'protein_coding' },
  { symbol: 'CFTR', name: 'CF transmembrane conductance regulator', ensembl: 'ENSG00000001626', chromosome: '7', start: 117287120, end: 117715971, strand: 1, biotype: 'protein_coding' },
  { symbol: 'MLH1', name: 'mutL homolog 1', ensembl: 'ENSG00000076242', chromosome: '3', start: 36993466, end: 37050846, strand: 1, biotype: 'protein_coding' },
  { symbol: 'MSH2', name: 'mutS homolog 2', ensembl: 'ENSG00000095002', chromosome: '2', start: 47403067, end: 47709830, strand: 1, biotype: 'protein_coding' },
  { symbol: 'MSH6', name: 'mutS homolog 6', ensembl: 'ENSG00000116062', chromosome: '2', start: 47783145, end: 47810101, strand: 1, biotype: 'protein_coding' },
  { symbol: 'PMS2', name: 'PMS1 homolog 2, mismatch repair system component', ensembl: 'ENSG00000122512', chromosome: '7', start: 5970925, end: 6009106, strand: -1, biotype: 'protein_coding' },
  { symbol: 'APC', name: 'APC regulator of WNT signaling pathway', ensembl: 'ENSG00000134982', chromosome: '5', start: 112707498, end: 112846239, strand: 1, biotype: 'protein_coding' },
  { symbol: 'PTEN', name: 'phosphatase and tensin homolog', ensembl: 'ENSG00000171862', chromosome: '10', start: 87863113, end: 87971930, strand: 1, biotype: 'protein_coding' },
  { symbol: 'RB1', name: 'RB transcriptional corepressor 1', ensembl: 'ENSG00000139687', chromosome: '13', start: 48303748, end: 48481890, strand: 1, biotype: 'protein_coding' },
  { symbol: 'VHL', name: 'von Hippel-Lindau tumor suppressor', ensembl: 'ENSG00000134086', chromosome: '3', start: 10141778, end: 10153667, strand: 1, biotype: 'protein_coding' },
  { symbol: 'NF1', name: 'neurofibromin 1', ensembl: 'ENSG00000196712', chromosome: '17', start: 31094927, end: 31377677, strand: 1, biotype: 'protein_coding' },
  { symbol: 'NF2', name: 'NF2 moesin-ezrin-radixin like tumor suppressor', ensembl: 'ENSG00000186575', chromosome: '22', start: 29603556, end: 29698598, strand: 1, biotype: 'protein_coding' },
  { symbol: 'RET', name: 'ret proto-oncogene', ensembl: 'ENSG00000165731', chromosome: '10', start: 43077069, end: 43130351, strand: 1, biotype: 'protein_coding' },
  { symbol: 'ATM', name: 'ATM serine/threonine kinase', ensembl: 'ENSG00000149311', chromosome: '11', start: 108222484, end: 108369102, strand: 1, biotype: 'protein_coding' },
  { symbol: 'CHEK2', name: 'checkpoint kinase 2', ensembl: 'ENSG00000183765', chromosome: '22', start: 28687743, end: 28742422, strand: -1, biotype: 'protein_coding' },
  { symbol: 'PALB2', name: 'partner and localizer of BRCA2', ensembl: 'ENSG00000083093', chromosome: '16', start: 23603160, end: 23641310, strand: -1, biotype: 'protein_coding' },
  { symbol: 'STK11', name: 'serine/threonine kinase 11', ensembl: 'ENSG00000118046', chromosome: '19', start: 1205778, end: 1228431, strand: 1, biotype: 'protein_coding' },
  { symbol: 'CDH1', name: 'cadherin 1', ensembl: 'ENSG00000039068', chromosome: '16', start: 68737225, end: 68835548, strand: 1, biotype: 'protein_coding' },
  { symbol: 'SMAD4', name: 'SMAD family member 4', ensembl: 'ENSG00000141646', chromosome: '18', start: 51030213, end: 51085042, strand: 1, biotype: 'protein_coding' },
  { symbol: 'BMPR1A', name: 'bone morphogenetic protein receptor type 1A', ensembl: 'ENSG00000107779', chromosome: '10', start: 86755786, end: 86927411, strand: 1, biotype: 'protein_coding' },
  { symbol: 'MUTYH', name: 'mutY DNA glycosylase', ensembl: 'ENSG00000132781', chromosome: '1', start: 45329242, end: 45340470, strand: -1, biotype: 'protein_coding' },
  { symbol: 'TSC1', name: 'TSC complex subunit 1', ensembl: 'ENSG00000165699', chromosome: '9', start: 132891349, end: 132945370, strand: -1, biotype: 'protein_coding' },
  { symbol: 'TSC2', name: 'TSC complex subunit 2', ensembl: 'ENSG00000103197', chromosome: '16', start: 2047802, end: 2089491, strand: 1, biotype: 'protein_coding' },
  { symbol: 'FBN1', name: 'fibrillin 1', ensembl: 'ENSG00000166147', chromosome: '15', start: 48408313, end: 48645709, strand: -1, biotype: 'protein_coding' },
  { symbol: 'LDLR', name: 'low density lipoprotein receptor', ensembl: 'ENSG00000130164', chromosome: '19', start: 11089362, end: 11133830, strand: 1, biotype: 'protein_coding' },
  { symbol: 'APOB', name: 'apolipoprotein B', ensembl: 'ENSG00000084674', chromosome: '2', start: 21001429, end: 21044073, strand: -1, biotype: 'protein_coding' },
  { symbol: 'PCSK9', name: 'proprotein convertase subtilisin/kexin type 9', ensembl: 'ENSG00000169174', chromosome: '1', start: 55039548, end: 55064852, strand: 1, biotype: 'protein_coding' },
  { symbol: 'HBB', name: 'hemoglobin subunit beta', ensembl: 'ENSG00000244734', chromosome: '11', start: 5225464, end: 5229395, strand: -1, biotype: 'protein_coding' },
  { symbol: 'F8', name: 'coagulation factor VIII', ensembl: 'ENSG00000185010', chromosome: 'X', start: 154835788, end: 155026940, strand: -1, biotype: 'protein_coding' },
  { symbol: 'DMD', name: 'dystrophin', ensembl: 'ENSG00000198947', chromosome: 'X', start: 31097677, end: 33339441, strand: -1, biotype: 'protein_coding' },
  { symbol: 'SCN5A', name: 'sodium voltage-gated channel alpha subunit 5', ensembl: 'ENSG00000183873', chromosome: '3', start: 38548062, end: 38649687, strand: -1, biotype: 'protein_coding' },
  { symbol: 'MYH7', name: 'myosin heavy chain 7', ensembl: 'ENSG00000092054', chromosome: '14', start: 23412740, end: 23435660, strand: -1, biotype: 'protein_coding' },
  { symbol: 'MYBPC3', name: 'myosin binding protein C3', ensembl: 'ENSG00000134571', chromosome: '11', start: 47331406, end: 47352702, strand: -1, biotype: 'protein_coding' },
  { symbol: 'XIST', name: 'X inactive specific transcript', ensembl: 'ENSG00000229807', chromosome: 'X', start: 73820651, end: 73852753, strand: -1, biotype: 'lncRNA' },
  { symbol: 'MALAT1', name: 'metastasis associated lung adenocarcinoma transcript 1', ensembl: 'ENSG00000251562', chromosome: '11', start: 65497688, end: 65506516, strand: 1, biotype: 'lncRNA' },
  { symbol: 'NEAT1', name: 'nuclear paraspeckle assembly transcript 1', ensembl: 'ENSG00000245532', chromosome: '11', start: 65422798, end: 65445540, strand: 1, biotype: 'lncRNA' },
];

const GENE_INDEX = new Map<string, number>(GENES.map((gene, index) => [gene.symbol, index]));

/* ------------------------------------------------------ phenotype reference */

type PhenotypeSeed = { hpo: string; name: string; category: string };

const PHENOTYPES: readonly PhenotypeSeed[] = [
  { hpo: 'HP:0000006', name: 'Autosomal dominant inheritance', category: 'INHERITANCE' },
  { hpo: 'HP:0000007', name: 'Autosomal recessive inheritance', category: 'INHERITANCE' },
  { hpo: 'HP:0001417', name: 'X-linked inheritance', category: 'INHERITANCE' },
  { hpo: 'HP:0002664', name: 'Neoplasm', category: 'NEOPLASM' },
  { hpo: 'HP:0003002', name: 'Breast carcinoma', category: 'NEOPLASM' },
  { hpo: 'HP:0100273', name: 'Neoplasm of the colon', category: 'NEOPLASM' },
  { hpo: 'HP:0002896', name: 'Neoplasm of the liver', category: 'NEOPLASM' },
  { hpo: 'HP:0001250', name: 'Seizure', category: 'NEUROLOGIC' },
  { hpo: 'HP:0001263', name: 'Global developmental delay', category: 'NEUROLOGIC' },
  { hpo: 'HP:0001249', name: 'Intellectual disability', category: 'NEUROLOGIC' },
  { hpo: 'HP:0002072', name: 'Chorea', category: 'NEUROLOGIC' },
  { hpo: 'HP:0001631', name: 'Atrial septal defect', category: 'CARDIOVASCULAR' },
  { hpo: 'HP:0001635', name: 'Congestive heart failure', category: 'CARDIOVASCULAR' },
  { hpo: 'HP:0001644', name: 'Dilated cardiomyopathy', category: 'CARDIOVASCULAR' },
  { hpo: 'HP:0001639', name: 'Hypertrophic cardiomyopathy', category: 'CARDIOVASCULAR' },
  { hpo: 'HP:0002205', name: 'Recurrent respiratory infections', category: 'RESPIRATORY' },
  { hpo: 'HP:0002093', name: 'Respiratory insufficiency', category: 'RESPIRATORY' },
  { hpo: 'HP:0006528', name: 'Chronic lung disease', category: 'RESPIRATORY' },
  { hpo: 'HP:0003124', name: 'Hypercholesterolemia', category: 'METABOLIC' },
  { hpo: 'HP:0002240', name: 'Hepatomegaly', category: 'METABOLIC' },
  { hpo: 'HP:0001903', name: 'Anemia', category: 'HEMATOLOGIC' },
  { hpo: 'HP:0000978', name: 'Bruising susceptibility', category: 'HEMATOLOGIC' },
  { hpo: 'HP:0000939', name: 'Osteoporosis', category: 'SKELETAL' },
  { hpo: 'HP:0004322', name: 'Short stature', category: 'GROWTH' },
  { hpo: 'HP:0000098', name: 'Tall stature', category: 'GROWTH' },
];

/* ------------------------------------------------------------- small pools */

const BASES = ['A', 'C', 'G', 'T'] as const;
const SEQUENCERS = ['NovaSeq 6000', 'NovaSeq X Plus', 'NextSeq 2000', 'HiSeq 4000'] as const;
const CHROMOSOMES = [
  '1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12',
  '13', '14', '15', '16', '17', '18', '19', '20', '21', '22', 'X', 'Y', 'MT',
];
const CONSEQUENCES = [
  'missense_variant',
  'synonymous_variant',
  'stop_gained',
  'frameshift_variant',
  'splice_donor_variant',
  'splice_acceptor_variant',
  'intron_variant',
  'inframe_deletion',
  'inframe_insertion',
  '5_prime_UTR_variant',
  '3_prime_UTR_variant',
  'non_coding_transcript_exon_variant',
];
const SIGNIFICANCES = ['PATHOGENIC', 'LIKELY_PATHOGENIC', 'VUS', 'LIKELY_BENIGN', 'BENIGN'];
const TRANSCRIPT_BIOTYPES = [
  'protein_coding',
  'retained_intron',
  'processed_transcript',
  'nonsense_mediated_decay',
  'lncRNA',
];
const TISSUES = ['BLOOD', 'SALIVA', 'BUCCAL', 'TUMOR'];
const ASSAYS = ['WGS', 'WES', 'PANEL'];
const PHENOTYPE_CATEGORIES = [
  'INHERITANCE', 'NEOPLASM', 'NEUROLOGIC', 'CARDIOVASCULAR',
  'RESPIRATORY', 'METABOLIC', 'HEMATOLOGIC', 'SKELETAL', 'GROWTH',
];

function randomBases(count: number): string {
  let out = '';
  for (let i = 0; i < count; i += 1) out += rng.pick(BASES);
  return out;
}

/* ============================================================ transcripts */

type TranscriptRow = {
  id: number;
  geneId: number;
  ensemblTranscriptId: string;
  transcriptName: string;
  isCanonical: boolean;
  exonCount: number;
  lengthBp: number;
  transcriptBiotype: string;
};

const transcripts: TranscriptRow[] = [];
let transcriptSerial = 0;

GENES.forEach((gene, geneIndex) => {
  const geneId = geneIndex + 1;
  const extra = rng.weighted<number>([
    [0, 0.25],
    [1, 0.35],
    [2, 0.25],
    [3, 0.15],
  ]);
  const count = 1 + extra;
  for (let i = 0; i < count; i += 1) {
    transcriptSerial += 1;
    const isCanonical = i === 0;
    const biotype = gene.biotype === 'lncRNA'
      ? 'lncRNA'
      : isCanonical
        ? 'protein_coding'
        : rng.weighted<string>([
          ['protein_coding', 0.4],
          ['retained_intron', 0.25],
          ['processed_transcript', 0.2],
          ['nonsense_mediated_decay', 0.15],
        ]);
    transcripts.push({
      id: transcripts.length + 1,
      geneId,
      ensemblTranscriptId: `ENST${pad(200000 + transcriptSerial * 1373, 11)}`,
      transcriptName: `${gene.symbol}-2${pad(i + 1, 2)}`,
      isCanonical,
      exonCount: isCanonical ? rng.int(4, 62) : rng.int(2, 28),
      lengthBp: isCanonical ? rng.int(1200, 11800) : rng.int(400, 5200),
      transcriptBiotype: biotype,
    });
  }
});

/* =============================================================== subjects */

type SubjectRow = {
  id: number;
  subjectCode: string;
  ancestryGroupId: number;
  sex: string;
  affectedStatus: string;
  ageAtEnrollment: number;
  enrolledOn: string;
};

const subjects: SubjectRow[] = [];
const ancestryRotation = rng.shuffle(ANCESTRY_GROUPS.map((_, index) => index + 1));

for (let i = 0; i < SUBJECT_TOTAL; i += 1) {
  // The first pass walks every ancestry group once, so every superpopulation is
  // represented and the G11 rollup can never collapse to a single row.
  const ancestryGroupId = i < ancestryRotation.length
    ? ancestryRotation[i]
    : rng.int(1, ANCESTRY_GROUPS.length);
  subjects.push({
    id: i + 1,
    subjectCode: `SUBJ-${pad(i + 1, 3)}`,
    ancestryGroupId,
    sex: rng.weighted<string>([['FEMALE', 0.48], ['MALE', 0.48], ['UNKNOWN', 0.04]]),
    affectedStatus: rng.weighted<string>([
      ['AFFECTED', 0.45],
      ['UNAFFECTED', 0.45],
      ['UNKNOWN', 0.1],
    ]),
    ageAtEnrollment: rng.int(1, 86),
    enrolledOn: rng.dateBetween('2023-01-01', '2024-09-30'),
  });
}

/* ================================================================ samples */

type SampleRow = {
  id: number;
  sampleCode: string;
  subjectId: number;
  assay: string;
  tissue: string;
  sequencer: string;
  collectedOn: string;
  meanCoverage: number;
  isControl: boolean;
};

const extraSampleSubjects = new Set(
  rng.shuffle(subjects.map((subject) => subject.id)).slice(0, SAMPLE_TOTAL - SUBJECT_TOTAL),
);

const samples: SampleRow[] = [];
for (const subject of subjects) {
  const sampleCount = extraSampleSubjects.has(subject.id) ? 2 : 1;
  for (let i = 0; i < sampleCount; i += 1) {
    const assay = rng.weighted<string>([['WGS', 0.4], ['WES', 0.4], ['PANEL', 0.2]]);
    const meanCoverage = assay === 'WGS'
      ? rng.float(24.5, 49.9, 1)
      : assay === 'WES'
        ? rng.float(58.2, 168.4, 1)
        : rng.float(184.6, 612.3, 1);
    samples.push({
      id: samples.length + 1,
      sampleCode: `SMP-${pad(samples.length + 1, 4)}`,
      subjectId: subject.id,
      assay,
      tissue: rng.weighted<string>([
        ['BLOOD', 0.6],
        ['SALIVA', 0.18],
        ['BUCCAL', 0.12],
        ['TUMOR', 0.1],
      ]),
      sequencer: rng.pick(SEQUENCERS),
      // Sequenced within three months of enrolment, and never past the end of
      // the fixture window -- G6 depends on nothing leaking outside 2023-2024.
      collectedOn: clampDate(rng.dateAfter(subject.enrolledOn, rng.int(0, 92)), '2024-12-31'),
      meanCoverage,
      isControl: rng.chance(0.12),
    });
  }
}

assert(samples.length === SAMPLE_TOTAL, `expected ${SAMPLE_TOTAL} samples, built ${samples.length}`);

const controlSamples = samples.filter((sample) => sample.isControl);
assert(
  controlSamples.length >= 12 && controlSamples.length <= 24,
  `G10: control share off target (${controlSamples.length} of ${samples.length})`,
);
assert(
  new Set(controlSamples.map((sample) => sample.assay)).size >= 2,
  'G10: controls must span at least two assays so the per-assay breakdown moves',
);

/* ========================================================== gene profiles */

/**
 * Per-gene knobs. The pinned values are what make G4 and G7 true by
 * construction rather than by luck:
 *   BRCA1 -- most total variants, middling pathogenic count, deliberately low
 *            call rate so it does not also lead on calls.
 *   TP53  -- the single gene with the most pathogenic variants.
 *   MLH1/PTEN -- the tie at exactly 7 pathogenic variants.
 *   CFTR  -- few variants but common ones, so it leads on call volume.
 */
const PINNED_VARIANT_COUNTS: Record<string, number> = {
  BRCA1: 34,
  TP53: 24,
  MLH1: 18,
  PTEN: 16,
  CFTR: 15,
};
const PINNED_PATHOGENIC_COUNTS: Record<string, number> = {
  BRCA1: 5,
  TP53: 11,
  MLH1: 7,
  PTEN: 7,
};
const TIED_PATHOGENIC_GENES = ['MLH1', 'PTEN'];
const TIED_PATHOGENIC_COUNT = 7;
const PINNED_CALL_RATES: Record<string, number> = {
  BRCA1: 6,
  CFTR: 46,
};

const variantCounts = GENES.map((gene) => PINNED_VARIANT_COUNTS[gene.symbol] ?? rng.int(5, 15));
const adjustable = GENES
  .map((gene, index) => (PINNED_VARIANT_COUNTS[gene.symbol] === undefined ? index : -1))
  .filter((index) => index >= 0);

let drift = VARIANT_TOTAL - variantCounts.reduce((sum, value) => sum + value, 0);
let cursor = 0;
let guard = 0;
while (drift !== 0) {
  const index = adjustable[cursor % adjustable.length];
  const step = drift > 0 ? 1 : -1;
  const next = variantCounts[index] + step;
  if (next >= 4 && next <= 28) {
    variantCounts[index] = next;
    drift -= step;
  }
  cursor += 1;
  guard += 1;
  assert(guard < 100000, 'could not balance the per-gene variant counts');
}
assert(
  variantCounts.reduce((sum, value) => sum + value, 0) === VARIANT_TOTAL,
  'per-gene variant counts do not sum to the target',
);

const pathogenicCounts = GENES.map((gene, index) => {
  const pinned = PINNED_PATHOGENIC_COUNTS[gene.symbol];
  if (pinned !== undefined) return pinned;
  if (gene.biotype === 'lncRNA') return 0;
  const drawn = rng.weighted<number>([
    [0, 0.14],
    [1, 0.24],
    [2, 0.24],
    [3, 0.16],
    [4, 0.1],
    [5, 0.07],
    [6, 0.05],
  ]);
  return Math.min(drawn, variantCounts[index] - 1);
});

// G4: exactly two genes at exactly 7, and nobody else.
const sevens = GENES.filter((gene, index) => pathogenicCounts[index] === TIED_PATHOGENIC_COUNT)
  .map((gene) => gene.symbol);
assert(
  sevens.length === 2 && TIED_PATHOGENIC_GENES.every((symbol) => sevens.includes(symbol)),
  `G4: expected exactly ${TIED_PATHOGENIC_GENES.join(' + ')} at 7 pathogenic variants, got ${sevens.join(', ') || 'none'}`,
);

const callRates = GENES.map((gene) => PINNED_CALL_RATES[gene.symbol] ?? rng.int(6, 20));
const alleleFractionCentres = GENES.map(() => rng.float(0.36, 0.63, 4));

/* =============================================================== variants */

type VariantRow = {
  id: number;
  geneIndex: number;
  geneId: number;
  chromosome: string;
  position: number;
  referenceAllele: string;
  alternateAllele: string;
  variantType: string;
  consequence: string;
  hgvsC: string;
  clinicalSignificance: string;
  rsid: string | null;
};

const variants: VariantRow[] = [];
const variantKeys = new Set<string>();
const rsids = new Set<string>();

GENES.forEach((gene, geneIndex) => {
  const total = variantCounts[geneIndex];
  const pathogenic = pathogenicCounts[geneIndex];
  const usedPositions = new Set<number>();
  const span = gene.end - gene.start;

  for (let i = 0; i < total; i += 1) {
    let position = 0;
    do {
      position = gene.start + rng.int(0, span);
    } while (usedPositions.has(position));
    usedPositions.add(position);

    const variantType = rng.weighted<string>([
      ['SNV', 0.82],
      ['DELETION', 0.08],
      ['INSERTION', 0.07],
      ['INDEL', 0.03],
    ]);

    let referenceAllele: string;
    let alternateAllele: string;
    if (variantType === 'SNV') {
      referenceAllele = rng.pick(BASES);
      alternateAllele = rng.pick(BASES.filter((base) => base !== referenceAllele));
    } else if (variantType === 'DELETION') {
      referenceAllele = randomBases(rng.int(2, 6));
      alternateAllele = referenceAllele.slice(0, 1);
    } else if (variantType === 'INSERTION') {
      referenceAllele = rng.pick(BASES);
      alternateAllele = referenceAllele + randomBases(rng.int(1, 5));
    } else {
      referenceAllele = randomBases(rng.int(2, 4));
      do {
        alternateAllele = randomBases(rng.int(2, 4));
      } while (alternateAllele === referenceAllele);
    }

    const isPathogenic = i < pathogenic;
    const clinicalSignificance = isPathogenic
      ? 'PATHOGENIC'
      : rng.weighted<string>([
        ['VUS', 0.45],
        ['LIKELY_BENIGN', 0.2],
        ['BENIGN', 0.2],
        ['LIKELY_PATHOGENIC', 0.15],
      ]);

    const consequence = gene.biotype === 'lncRNA'
      ? rng.weighted<string>([
        ['non_coding_transcript_exon_variant', 0.7],
        ['intron_variant', 0.3],
      ])
      : isPathogenic
        ? rng.weighted<string>([
          ['stop_gained', 0.28],
          ['frameshift_variant', 0.28],
          ['splice_donor_variant', 0.14],
          ['splice_acceptor_variant', 0.12],
          ['missense_variant', 0.18],
        ])
        : rng.weighted<string>([
          ['missense_variant', 0.34],
          ['synonymous_variant', 0.2],
          ['intron_variant', 0.18],
          ['5_prime_UTR_variant', 0.08],
          ['3_prime_UTR_variant', 0.08],
          ['inframe_deletion', 0.06],
          ['inframe_insertion', 0.06],
        ]);

    const codingPosition = rng.int(12, 9400);
    const prefix = gene.biotype === 'lncRNA' ? 'n.' : 'c.';
    const hgvsC = variantType === 'SNV'
      ? `${prefix}${codingPosition}${referenceAllele}>${alternateAllele}`
      : variantType === 'DELETION'
        ? `${prefix}${codingPosition}_${codingPosition + referenceAllele.length - 1}del`
        : variantType === 'INSERTION'
          ? `${prefix}${codingPosition}_${codingPosition + 1}ins${alternateAllele.slice(1)}`
          : `${prefix}${codingPosition}_${codingPosition + referenceAllele.length - 1}delins${alternateAllele}`;

    // G3: a dbSNP identifier on roughly one variant in ten.
    let rsid: string | null = null;
    if (rng.chance(0.1)) {
      do {
        rsid = `rs${rng.int(1000000, 99999999)}`;
      } while (rsids.has(rsid));
      rsids.add(rsid);
    }

    const key = `${gene.chromosome}:${position}:${referenceAllele}:${alternateAllele}`;
    assert(!variantKeys.has(key), `duplicate variant key ${key}`);
    variantKeys.add(key);

    variants.push({
      id: variants.length + 1,
      geneIndex,
      geneId: geneIndex + 1,
      chromosome: gene.chromosome,
      position,
      referenceAllele,
      alternateAllele,
      variantType,
      consequence,
      hgvsC,
      clinicalSignificance,
      rsid,
    });
  }
});

assert(variants.length === VARIANT_TOTAL, `expected ${VARIANT_TOTAL} variants, built ${variants.length}`);

/* ========================================================== variant calls */

type CallRow = {
  id: number;
  sampleId: number;
  variantId: number;
  geneIndex: number;
  genotype: string;
  altReadCount: number;
  totalReadCount: number;
  readDepth: number;
  genotypeQuality: number;
  filterStatus: string;
};

const sampleById = new Map<number, SampleRow>(samples.map((sample) => [sample.id, sample]));
const sampleIds = samples.map((sample) => sample.id);
const calls: CallRow[] = [];

for (const variant of variants) {
  const isPathogenic = variant.clinicalSignificance === 'PATHOGENIC';
  // Pathogenic variants are rare in the cohort. That is what keeps the G13
  // carrier counts (all calls vs non-reference calls) visibly apart.
  const wanted = isPathogenic
    ? rng.int(1, 4)
    : clamp(Math.round(callRates[variant.geneIndex] * rng.float(0.55, 1.45, 3)), 1, samples.length);
  const chosen = rng.shuffle(sampleIds).slice(0, wanted).sort((a, b) => a - b);

  for (const sampleId of chosen) {
    const sample = sampleById.get(sampleId)!;

    // G13: '0/0' is homozygous REFERENCE -- the sample does not carry the variant.
    const genotype = isPathogenic
      ? rng.weighted<string>([['0/0', 0.55], ['0/1', 0.38], ['1/1', 0.07]])
      : rng.weighted<string>([['0/0', 0.34], ['0/1', 0.46], ['1/1', 0.2]]);

    // G9: a real slice of the calls sits under the depth-20 threshold, and the
    // LOW_QUAL flag is only correlated with it -- neither filter implies the other.
    const shallow = rng.chance(0.12);
    const totalReadCount = shallow
      ? rng.int(6, 19)
      : sample.assay === 'WGS'
        ? rng.int(20, 72)
        : sample.assay === 'WES'
          ? rng.int(24, 152)
          : rng.int(60, 404);
    const filterStatus = rng.chance(shallow ? 0.45 : 0.11) ? 'LOW_QUAL' : 'PASS';

    let alleleFraction = genotype === '0/0'
      ? rng.float(0, 0.045, 4)
      : genotype === '0/1'
        ? clamp(alleleFractionCentres[variant.geneIndex] + rng.float(-0.09, 0.09, 4), 0.14, 0.86)
        : rng.float(0.9, 0.999, 4);
    // G9: shallow and low-quality calls carry a noisy, deflated alternate
    // fraction -- which is exactly why the metric is only defined on PASS calls
    // at depth >= 20. Answering without the filter lands on a different number.
    if (shallow || filterStatus === 'LOW_QUAL') {
      alleleFraction = genotype === '0/0'
        ? clamp(alleleFraction + rng.float(0, 0.1, 4), 0, 0.99)
        : clamp(alleleFraction * rng.float(0.35, 0.85, 4), 0.02, 0.99);
    }
    const altReadCount = clamp(Math.round(totalReadCount * alleleFraction), 0, totalReadCount);

    calls.push({
      id: calls.length + 1,
      sampleId,
      variantId: variant.id,
      geneIndex: variant.geneIndex,
      genotype,
      altReadCount,
      totalReadCount,
      // G1 / distractor: read_depth is a second name for the same number.
      readDepth: totalReadCount,
      genotypeQuality: filterStatus === 'LOW_QUAL' ? rng.int(3, 34) : rng.int(35, 99),
      filterStatus,
    });
  }
}

/* --------------------------------------------------- call-level assertions */

assert(calls.every((call) => call.readDepth === call.totalReadCount), 'G1: read_depth must equal total_read_count');
assert(calls.every((call) => call.altReadCount <= call.totalReadCount), 'G1: alt_read_count exceeded total_read_count');

const homRefShare = calls.filter((call) => call.genotype === '0/0').length / calls.length;
assert(
  homRefShare >= 0.3 && homRefShare <= 0.4,
  `G13: 0/0 share off target (${(homRefShare * 100).toFixed(1)}%)`,
);

const lowQualShare = calls.filter((call) => call.filterStatus === 'LOW_QUAL').length / calls.length;
assert(
  lowQualShare >= 0.11 && lowQualShare <= 0.19,
  `G15: LOW_QUAL share off target (${(lowQualShare * 100).toFixed(1)}%)`,
);

const shallowCalls = calls.filter((call) => call.totalReadCount < 20);
assert(shallowCalls.length >= 300, `G9: too few calls below depth 20 (${shallowCalls.length})`);
assert(
  shallowCalls.some((call) => call.filterStatus === 'PASS'),
  'G9: need PASS calls under depth 20 so the two filter clauses are independent',
);
assert(
  calls.some((call) => call.filterStatus === 'LOW_QUAL' && call.totalReadCount >= 20),
  'G9: need LOW_QUAL calls at depth >= 20 so the two filter clauses are independent',
);

// G1/G9: per-gene mean allele fraction, on the calls the metric definition allows.
const meanAlleleFractionByGene = new Map<number, number>();
GENES.forEach((_, geneIndex) => {
  const eligible = calls.filter(
    (call) => call.geneIndex === geneIndex && call.filterStatus === 'PASS' && call.totalReadCount >= 20,
  );
  if (eligible.length === 0) return;
  const mean = eligible.reduce((sum, call) => sum + call.altReadCount / call.totalReadCount, 0) / eligible.length;
  meanAlleleFractionByGene.set(geneIndex, mean);
});
assert(meanAlleleFractionByGene.size === GENES.length, 'G1: every gene needs at least one eligible call');
assert(
  Math.max(...meanAlleleFractionByGene.values()) < 0.95,
  'G1: no gene may sit at an allele fraction of 1.0',
);
assert(
  new Set([...meanAlleleFractionByGene.values()].map((value) => value.toFixed(4))).size === GENES.length,
  'G1: per-gene allele fractions must be distinguishable',
);

const meanAlleleFractionAll = calls.reduce((sum, call) => sum + call.altReadCount / call.totalReadCount, 0) / calls.length;
const eligibleCalls = calls.filter((call) => call.filterStatus === 'PASS' && call.totalReadCount >= 20);
const meanAlleleFractionEligible = eligibleCalls.reduce(
  (sum, call) => sum + call.altReadCount / call.totalReadCount, 0,
) / eligibleCalls.length;
assert(
  Math.abs(meanAlleleFractionAll - meanAlleleFractionEligible) > 0.005,
  'G9: filtered and unfiltered allele fractions must differ',
);

// G13: the carrier gap, at both the call grain and the sample grain.
const pathogenicVariantIds = new Set(
  variants.filter((variant) => variant.clinicalSignificance === 'PATHOGENIC').map((variant) => variant.id),
);
const pathogenicCalls = calls.filter((call) => pathogenicVariantIds.has(call.variantId));
const pathogenicCarrierCalls = pathogenicCalls.filter((call) => call.genotype !== '0/0');
const samplesTouchingPathogenic = new Set(pathogenicCalls.map((call) => call.sampleId));
const samplesCarryingPathogenic = new Set(pathogenicCarrierCalls.map((call) => call.sampleId));
assert(
  samplesTouchingPathogenic.size - samplesCarryingPathogenic.size >= 20,
  `G13: carrier gap too small (${samplesTouchingPathogenic.size} vs ${samplesCarryingPathogenic.size})`,
);

// G7: BRCA1 leads on total variants only.
const brca1Index = GENE_INDEX.get('BRCA1')!;
const callsByGene = GENES.map((_, geneIndex) => calls.filter((call) => call.geneIndex === geneIndex).length);
const maxVariantCount = Math.max(...variantCounts);
assert(
  variantCounts[brca1Index] === maxVariantCount
  && variantCounts.filter((value) => value === maxVariantCount).length === 1,
  'G7: BRCA1 must be the sole leader on total variants',
);
assert(
  pathogenicCounts[brca1Index] < Math.max(...pathogenicCounts),
  'G7: BRCA1 must not lead on pathogenic variants',
);
assert(
  callsByGene[brca1Index] < Math.max(...callsByGene),
  'G7: BRCA1 must not lead on call volume',
);
const topPathogenicIndex = pathogenicCounts.indexOf(Math.max(...pathogenicCounts));
assert(
  pathogenicCounts.filter((value) => value === pathogenicCounts[topPathogenicIndex]).length === 1,
  'G7: the pathogenic leader must be unique',
);
const topCallIndex = callsByGene.indexOf(Math.max(...callsByGene));
assert(
  callsByGene.filter((value) => value === callsByGene[topCallIndex]).length === 1,
  'G8: the most-called gene must be unique',
);

/* ========================================================= gene expression */

type ExpressionRow = {
  id: number;
  sampleId: number;
  geneId: number;
  rawCount: number;
  tpm: number;
};

const expressionSampleIds = rng
  .shuffle(sampleIds)
  .slice(0, EXPRESSION_SAMPLE_TOTAL)
  .sort((a, b) => a - b);

// Per-gene zero rate averaging ~0.4, so G14 bites on nearly every gene rather
// than on the cohort as a whole.
const zeroRates = GENES.map(() => rng.float(0.2, 0.6, 4));
const baseExpression = GENES.map((gene) => (gene.biotype === 'lncRNA' ? rng.float(4, 90, 3) : rng.float(1.5, 260, 3)));

const expression: ExpressionRow[] = [];
for (const sampleId of expressionSampleIds) {
  const libraryFactor = rng.float(0.75, 1.35, 3);
  GENES.forEach((gene, geneIndex) => {
    const lengthKb = clamp((gene.end - gene.start) / 1000, 0.6, 14);
    // G14: a measured zero, not a missing value -- raw_count is zero on exactly
    // the same rows.
    const isZero = rng.chance(zeroRates[geneIndex]);
    const tpm = isZero
      ? 0
      : Math.max(0.001, Number((baseExpression[geneIndex] * rng.float(0.3, 2.3, 4)).toFixed(3)));
    const rawCount = isZero ? 0 : Math.max(1, Math.round(tpm * lengthKb * libraryFactor * 1.7));
    expression.push({
      id: expression.length + 1,
      sampleId,
      geneId: geneIndex + 1,
      rawCount,
      tpm,
    });
  });
}

const zeroExpression = expression.filter((row) => row.tpm === 0);
const zeroShare = zeroExpression.length / expression.length;
assert(
  zeroShare >= 0.35 && zeroShare <= 0.45,
  `G14: tpm=0 share off target (${(zeroShare * 100).toFixed(1)}%)`,
);
assert(
  zeroExpression.every((row) => row.rawCount === 0),
  'G14: raw_count must be zero on exactly the tpm=0 rows',
);
assert(
  expression.filter((row) => row.tpm > 0).every((row) => row.rawCount > 0),
  'G14: raw_count must be positive wherever tpm is positive',
);

let genesWhereZerosMatter = 0;
GENES.forEach((_, geneIndex) => {
  const geneId = geneIndex + 1;
  const rows = expression.filter((row) => row.geneId === geneId);
  const nonZero = rows.filter((row) => row.tpm > 0);
  assert(nonZero.length > 0 && nonZero.length < rows.length, `G14: gene ${GENES[geneIndex].symbol} needs both zero and non-zero rows`);
  const meanAll = rows.reduce((sum, row) => sum + row.tpm, 0) / rows.length;
  const meanNonZero = nonZero.reduce((sum, row) => sum + row.tpm, 0) / nonZero.length;
  if (meanNonZero - meanAll > 0.15 * meanNonZero) genesWhereZerosMatter += 1;
});
assert(
  genesWhereZerosMatter >= GENES.length - 2,
  `G14: zeros must move the mean for nearly every gene (${genesWhereZerosMatter}/${GENES.length})`,
);

/* ====================================================== subject phenotypes */

type SubjectPhenotypeRow = {
  subjectId: number;
  phenotypeId: number;
  onsetAgeYears: number | null;
  isPrimary: boolean;
};

const phenotypeIds = PHENOTYPES.map((_, index) => index + 1);
const subjectPhenotypes: SubjectPhenotypeRow[] = [];

for (const subject of subjects) {
  const count = subject.affectedStatus === 'AFFECTED'
    ? rng.int(1, 4)
    : subject.affectedStatus === 'UNKNOWN'
      ? (rng.chance(0.4) ? 1 : 0)
      : (rng.chance(0.25) ? 1 : 0);
  const chosen = rng.shuffle(phenotypeIds).slice(0, count).sort((a, b) => a - b);
  chosen.forEach((phenotypeId, index) => {
    subjectPhenotypes.push({
      subjectId: subject.id,
      phenotypeId,
      onsetAgeYears: rng.chance(0.75) ? rng.int(0, subject.ageAtEnrollment) : null,
      isPrimary: index === 0,
    });
  });
}

/* ==================================================================== SQL */

const ddl = `CREATE SCHEMA genomics;
SET search_path TO genomics, public;

CREATE TABLE superpopulations (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  code text NOT NULL UNIQUE,
  name text NOT NULL UNIQUE
);

CREATE TABLE ancestry_groups (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  superpopulation_id bigint NOT NULL REFERENCES superpopulations(id),
  code text NOT NULL UNIQUE,
  name text NOT NULL UNIQUE
);

CREATE TABLE genes (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  hgnc_symbol text NOT NULL UNIQUE,
  gene_name text NOT NULL,
  ensembl_id text NOT NULL UNIQUE,
  chromosome text NOT NULL CHECK (chromosome IN (${CHROMOSOMES.map(literal).join(', ')})),
  start_position integer NOT NULL CHECK (start_position > 0),
  end_position integer NOT NULL CHECK (end_position > 0),
  strand smallint NOT NULL CHECK (strand IN (1, -1)),
  biotype text NOT NULL CHECK (biotype IN ('protein_coding', 'lncRNA', 'pseudogene')),
  CHECK (start_position < end_position)
);

CREATE TABLE transcripts (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  gene_id bigint NOT NULL REFERENCES genes(id) ON DELETE CASCADE,
  ensembl_transcript_id text NOT NULL UNIQUE,
  transcript_name text NOT NULL,
  is_canonical boolean NOT NULL DEFAULT false,
  exon_count integer NOT NULL CHECK (exon_count > 0),
  length_bp integer NOT NULL CHECK (length_bp > 0),
  transcript_biotype text NOT NULL CHECK (transcript_biotype IN (${TRANSCRIPT_BIOTYPES.map(literal).join(', ')})),
  UNIQUE (gene_id, transcript_name)
);

CREATE TABLE subjects (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  subject_code text NOT NULL UNIQUE,
  ancestry_group_id bigint NOT NULL REFERENCES ancestry_groups(id),
  sex text NOT NULL CHECK (sex IN ('MALE', 'FEMALE', 'UNKNOWN')),
  affected_status text NOT NULL CHECK (affected_status IN ('AFFECTED', 'UNAFFECTED', 'UNKNOWN')),
  age_at_enrollment integer NOT NULL CHECK (age_at_enrollment BETWEEN 0 AND 120),
  enrolled_on date NOT NULL CHECK (enrolled_on BETWEEN DATE '2023-01-01' AND DATE '2024-12-31')
);

CREATE TABLE samples (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  sample_code text NOT NULL UNIQUE,
  subject_id bigint NOT NULL REFERENCES subjects(id),
  assay text NOT NULL CHECK (assay IN (${ASSAYS.map(literal).join(', ')})),
  tissue text NOT NULL CHECK (tissue IN (${TISSUES.map(literal).join(', ')})),
  sequencer text NOT NULL,
  collected_on date NOT NULL CHECK (collected_on BETWEEN DATE '2023-01-01' AND DATE '2024-12-31'),
  mean_coverage numeric(6,1) NOT NULL CHECK (mean_coverage > 0),
  is_control boolean NOT NULL DEFAULT false
);

CREATE TABLE variants (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  gene_id bigint NOT NULL REFERENCES genes(id),
  chromosome text NOT NULL CHECK (chromosome IN (${CHROMOSOMES.map(literal).join(', ')})),
  position integer NOT NULL CHECK (position > 0),
  reference_allele text NOT NULL CHECK (reference_allele ~ '^[ACGT]+$'),
  alternate_allele text NOT NULL CHECK (alternate_allele ~ '^[ACGT]+$'),
  variant_type text NOT NULL CHECK (variant_type IN ('SNV', 'INSERTION', 'DELETION', 'INDEL')),
  consequence text NOT NULL CHECK (consequence IN (${CONSEQUENCES.map(literal).join(', ')})),
  hgvs_c text NOT NULL,
  clinical_significance text NOT NULL CHECK (clinical_significance IN (${SIGNIFICANCES.map(literal).join(', ')})),
  assembly text NOT NULL DEFAULT 'GRCh38' CHECK (assembly = 'GRCh38'),
  rsid text UNIQUE CHECK (rsid ~ '^rs[0-9]+$'),
  UNIQUE (chromosome, position, reference_allele, alternate_allele),
  CHECK (reference_allele <> alternate_allele)
);

CREATE TABLE variant_calls (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  sample_id bigint NOT NULL REFERENCES samples(id) ON DELETE CASCADE,
  variant_id bigint NOT NULL REFERENCES variants(id) ON DELETE CASCADE,
  genotype text NOT NULL CHECK (genotype IN ('0/0', '0/1', '1/1')),
  alt_read_count integer NOT NULL CHECK (alt_read_count >= 0),
  total_read_count integer NOT NULL CHECK (total_read_count > 0),
  read_depth integer NOT NULL CHECK (read_depth >= 0),
  genotype_quality integer NOT NULL CHECK (genotype_quality BETWEEN 0 AND 99),
  filter_status text NOT NULL CHECK (filter_status IN ('PASS', 'LOW_QUAL')),
  UNIQUE (sample_id, variant_id),
  CHECK (alt_read_count <= total_read_count)
);

CREATE TABLE gene_expression (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  sample_id bigint NOT NULL REFERENCES samples(id) ON DELETE CASCADE,
  gene_id bigint NOT NULL REFERENCES genes(id),
  raw_count bigint NOT NULL CHECK (raw_count >= 0),
  tpm numeric(10,3) NOT NULL CHECK (tpm >= 0),
  UNIQUE (sample_id, gene_id)
);

CREATE TABLE phenotypes (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  hpo_code text NOT NULL UNIQUE CHECK (hpo_code ~ '^HP:[0-9]{7}$'),
  name text NOT NULL UNIQUE,
  category text NOT NULL CHECK (category IN (${PHENOTYPE_CATEGORIES.map(literal).join(', ')}))
);

CREATE TABLE subject_phenotypes (
  subject_id bigint NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
  phenotype_id bigint NOT NULL REFERENCES phenotypes(id),
  onset_age_years integer CHECK (onset_age_years BETWEEN 0 AND 120),
  is_primary boolean NOT NULL DEFAULT false,
  PRIMARY KEY (subject_id, phenotype_id)
);

CREATE UNIQUE INDEX transcripts_one_canonical_idx ON transcripts (gene_id) WHERE is_canonical;
CREATE INDEX samples_subject_idx ON samples (subject_id);
CREATE INDEX variants_gene_idx ON variants (gene_id);
CREATE INDEX variants_significance_idx ON variants (clinical_significance);
CREATE INDEX variant_calls_sample_idx ON variant_calls (sample_id);
CREATE INDEX variant_calls_variant_idx ON variant_calls (variant_id);
CREATE INDEX gene_expression_gene_idx ON gene_expression (gene_id);`;

const views = `CREATE VIEW v_variant_calls AS
SELECT
  sample.sample_code,
  subject.subject_code,
  gene.hgnc_symbol AS gene_symbol,
  variant.chromosome,
  variant.position,
  variant.reference_allele,
  variant.alternate_allele,
  variant.clinical_significance,
  call.genotype,
  call.alt_read_count,
  call.total_read_count,
  call.filter_status
FROM variant_calls call
JOIN samples sample ON sample.id = call.sample_id
JOIN subjects subject ON subject.id = sample.subject_id
JOIN variants variant ON variant.id = call.variant_id
JOIN genes gene ON gene.id = variant.gene_id;

CREATE VIEW v_sample_qc AS
SELECT
  sample.sample_code,
  sample.assay,
  sample.mean_coverage,
  sample.is_control,
  count(call.id) FILTER (WHERE call.filter_status = 'PASS') AS pass_call_count,
  count(call.id) FILTER (WHERE call.genotype <> '0/0') AS non_reference_call_count
FROM samples sample
LEFT JOIN variant_calls call ON call.sample_id = sample.id
GROUP BY sample.id, sample.sample_code, sample.assay, sample.mean_coverage, sample.is_control;`;

const header = `-- Generated by docker/postgres/generate/genomics.ts (seed ${SEED}). Do not edit by hand.
-- Regenerate with:
--   cd backend && TS_NODE_COMPILER_OPTIONS='{"module":"commonjs","moduleResolution":"node"}' \\
--     ./node_modules/.bin/ts-node -T ../docker/postgres/generate/genomics.ts
--
-- SYNTHETIC DATA. The gene symbols are real HGNC symbols and the gene
-- coordinates are plausible GRCh38 intervals, but every subject, sample,
-- variant, genotype, read count and expression value in this file is invented
-- by a seeded random generator. Nothing here describes a real person or a real
-- clinical variant. It MUST NOT be used for any clinical, diagnostic or
-- research purpose -- it exists only as a fixture for evaluating the
-- text-to-SQL pipeline.
--
-- Samples are collected in 2023 and 2024 only; no value depends on today's date.`;

const superpopulationIds = new Map<string, number>(
  SUPERPOPULATIONS.map((superpopulation, index) => [superpopulation.code, index + 1]),
);

const sqlParts: string[] = [
  header,
  'BEGIN;',
  ddl,
  section('superpopulations'),
  insertRows(
    'superpopulations',
    ['code', 'name'],
    SUPERPOPULATIONS.map((row) => [row.code, row.name]),
  ),
  section('ancestry_groups'),
  insertRows(
    'ancestry_groups',
    ['superpopulation_id', 'code', 'name'],
    ANCESTRY_GROUPS.map((row) => [superpopulationIds.get(row.superpopulation)!, row.code, row.name]),
  ),
  section('genes'),
  insertRows(
    'genes',
    ['hgnc_symbol', 'gene_name', 'ensembl_id', 'chromosome', 'start_position', 'end_position', 'strand', 'biotype'],
    GENES.map((gene) => [
      gene.symbol, gene.name, gene.ensembl, gene.chromosome, gene.start, gene.end, gene.strand, gene.biotype,
    ]),
  ),
  section('transcripts'),
  insertRows(
    'transcripts',
    ['gene_id', 'ensembl_transcript_id', 'transcript_name', 'is_canonical', 'exon_count', 'length_bp', 'transcript_biotype'],
    transcripts.map((row) => [
      row.geneId, row.ensemblTranscriptId, row.transcriptName, row.isCanonical,
      row.exonCount, row.lengthBp, row.transcriptBiotype,
    ]),
  ),
  section('subjects'),
  insertRows(
    'subjects',
    ['subject_code', 'ancestry_group_id', 'sex', 'affected_status', 'age_at_enrollment', 'enrolled_on'],
    subjects.map((row) => [
      row.subjectCode, row.ancestryGroupId, row.sex, row.affectedStatus, row.ageAtEnrollment, row.enrolledOn,
    ]),
  ),
  section('samples'),
  insertRows(
    'samples',
    ['sample_code', 'subject_id', 'assay', 'tissue', 'sequencer', 'collected_on', 'mean_coverage', 'is_control'],
    samples.map((row) => [
      row.sampleCode, row.subjectId, row.assay, row.tissue, row.sequencer,
      row.collectedOn, row.meanCoverage, row.isControl,
    ]),
  ),
  section('variants'),
  insertRows(
    'variants',
    [
      'gene_id', 'chromosome', 'position', 'reference_allele', 'alternate_allele',
      'variant_type', 'consequence', 'hgvs_c', 'clinical_significance', 'assembly', 'rsid',
    ],
    variants.map((row) => [
      row.geneId, row.chromosome, row.position, row.referenceAllele, row.alternateAllele,
      row.variantType, row.consequence, row.hgvsC, row.clinicalSignificance, 'GRCh38', row.rsid,
    ]),
  ),
  section('variant_calls'),
  insertRows(
    'variant_calls',
    [
      'sample_id', 'variant_id', 'genotype', 'alt_read_count', 'total_read_count',
      'read_depth', 'genotype_quality', 'filter_status',
    ],
    calls.map((row) => [
      row.sampleId, row.variantId, row.genotype, row.altReadCount, row.totalReadCount,
      row.readDepth, row.genotypeQuality, row.filterStatus,
    ]),
  ),
  section('gene_expression'),
  insertRows(
    'gene_expression',
    ['sample_id', 'gene_id', 'raw_count', 'tpm'],
    expression.map((row) => [row.sampleId, row.geneId, row.rawCount, row.tpm]),
  ),
  section('phenotypes'),
  insertRows(
    'phenotypes',
    ['hpo_code', 'name', 'category'],
    PHENOTYPES.map((row) => [row.hpo, row.name, row.category]),
  ),
  section('subject_phenotypes'),
  insertRows(
    'subject_phenotypes',
    ['subject_id', 'phenotype_id', 'onset_age_years', 'is_primary'],
    subjectPhenotypes.map((row) => [row.subjectId, row.phenotypeId, row.onsetAgeYears, row.isPrimary]),
  ),
  section('analytics views'),
  views,
  `COMMENT ON SCHEMA genomics IS ${literal(
    'Synthetic clinical-genomics cohort for text-to-SQL evaluation. Real HGNC gene symbols, invented subjects, samples, variants and measurements. Not clinical data.',
  )};
COMMENT ON COLUMN variant_calls.genotype IS ${literal(
    "VCF genotype: 0/0 is homozygous reference (the sample does NOT carry the variant), 0/1 heterozygous, 1/1 homozygous alternate.",
  )};
COMMENT ON COLUMN gene_expression.tpm IS ${literal(
    'Transcripts per million. A value of 0 is a measured zero, not a missing value.',
  )};
COMMENT ON COLUMN variant_calls.read_depth IS ${literal(
    'Total depth at the site; identical to total_read_count in this fixture.',
  )};`,
  'COMMIT;',
];

writeFileSync(OUTPUT_PATH, `${sqlParts.filter((part) => part.length > 0).join('\n\n')}\n`, 'utf8');

/* ============================================================== summary */

const tiedGenes = GENES
  .filter((_, index) => pathogenicCounts[index] === TIED_PATHOGENIC_COUNT)
  .map((gene) => gene.symbol);
const nonReferenceCalls = calls.filter((call) => call.genotype !== '0/0').length;
const meanTpmAll = expression.reduce((sum, row) => sum + row.tpm, 0) / expression.length;
const nonZeroExpression = expression.filter((row) => row.tpm > 0);
const meanTpmNonZero = nonZeroExpression.reduce((sum, row) => sum + row.tpm, 0) / nonZeroExpression.length;

const counts: readonly (readonly [string, number])[] = [
  ['superpopulations', SUPERPOPULATIONS.length],
  ['ancestry_groups', ANCESTRY_GROUPS.length],
  ['genes', GENES.length],
  ['transcripts', transcripts.length],
  ['subjects', subjects.length],
  ['samples', samples.length],
  ['variants', variants.length],
  ['variant_calls', calls.length],
  ['gene_expression', expression.length],
  ['phenotypes', PHENOTYPES.length],
  ['subject_phenotypes', subjectPhenotypes.length],
];

process.stdout.write(`Wrote ${OUTPUT_PATH} (seed ${SEED})\n\n`);
for (const [table, count] of counts) {
  process.stdout.write(`  ${table.padEnd(20)} ${String(count).padStart(6)}\n`);
}
process.stdout.write('\nPlanted facts:\n');
process.stdout.write(`  G1  read_depth = total_read_count on all ${calls.length} calls\n`);
process.stdout.write(`  G1  per-gene mean allele fraction (PASS, depth>=20) spans ${Math.min(...meanAlleleFractionByGene.values()).toFixed(4)}..${Math.max(...meanAlleleFractionByGene.values()).toFixed(4)}\n`);
process.stdout.write(`  G3  rsid present on ${variants.filter((v) => v.rsid !== null).length} of ${variants.length} variants\n`);
process.stdout.write(`  G4  tied at ${TIED_PATHOGENIC_COUNT} pathogenic variants: ${tiedGenes.join(', ')}\n`);
process.stdout.write(`  G7  BRCA1 ${variantCounts[brca1Index]} variants / ${pathogenicCounts[brca1Index]} pathogenic / ${callsByGene[brca1Index]} calls; most pathogenic = ${GENES[topPathogenicIndex].symbol} (${pathogenicCounts[topPathogenicIndex]}); most calls = ${GENES[topCallIndex].symbol} (${callsByGene[topCallIndex]})\n`);
process.stdout.write(`  G9  mean allele fraction: ${meanAlleleFractionAll.toFixed(4)} over all calls vs ${meanAlleleFractionEligible.toFixed(4)} over PASS & depth>=20 (${eligibleCalls.length} calls)\n`);
process.stdout.write(`  G10 control samples: ${controlSamples.length} of ${samples.length}\n`);
process.stdout.write(`  G13 genotype 0/0 on ${(homRefShare * 100).toFixed(1)}% of calls; non-reference calls ${nonReferenceCalls}\n`);
process.stdout.write(`  G13 samples with a pathogenic call ${samplesTouchingPathogenic.size} vs actual carriers ${samplesCarryingPathogenic.size}\n`);
process.stdout.write(`  G14 tpm = 0 on ${(zeroShare * 100).toFixed(1)}% of rows; mean tpm ${meanTpmAll.toFixed(3)} with zeros vs ${meanTpmNonZero.toFixed(3)} without\n`);
process.stdout.write(`  G15 LOW_QUAL on ${(lowQualShare * 100).toFixed(1)}% of calls\n`);
