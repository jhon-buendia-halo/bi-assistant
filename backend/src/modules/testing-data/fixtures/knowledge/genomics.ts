/**
 * Knowledge seed of the Genomics sample (schema `genomics`, seed
 * `005_genomics.sql`), testing-data R26.
 *
 * Ported from `feat/engine-eval-loop` (`backend/scripts/fixture-semantics.ts`,
 * written 2026-09-23). Every non-obvious fact was checked again on 2026-10-16
 * against the seed loaded into its own database (`genomics` on an isolated
 * PostgreSQL server, `psql`); the query and its result sit in a `Verified:`
 * comment next to the fact. Rules from types.ts.
 *
 * Nothing here settles which gene "matters most", which sample has the "best"
 * quality or which superpopulation is "most affected" (the bank's ambiguous
 * questions), and no entry mentions methylation or copy-number variants
 * (out-of-scope questions).
 */
import type { KnowledgeSeed } from './types';

export const GENOMICS_KNOWLEDGE: KnowledgeSeed = {
  knowledge: [
    {
      kind: 'term',
      title: 'Read-count columns on variant_calls',
      // Verified: CHECK (alt_read_count <= total_read_count) on variant_calls;
      // `SELECT count(*) FROM genomics.variant_calls WHERE read_depth <>
      // total_read_count` → 0; `col_description` of variant_calls.read_depth →
      // "Total depth at the site; identical to total_read_count in this
      // fixture."
      body:
        'variant_calls.alt_read_count counts reads supporting the alternate ' +
        'allele; total_read_count is the total reads at the site, and ' +
        'alt_read_count is always less than or equal to it. read_depth ' +
        'duplicates total_read_count exactly in this dataset. Allele ' +
        'fraction is alt_read_count / total_read_count over PASS calls with ' +
        'at least 20 total reads — see the allele_fraction metric; do not ' +
        'divide either count by itself.',
      entities: ['genomics.variant_calls'],
    },
    {
      kind: 'term',
      title: 'Genome assembly is always GRCh38',
      // Verified: `SELECT DISTINCT assembly FROM genomics.variants` → GRCh38;
      // CHECK (assembly = 'GRCh38').
      body:
        "variants.assembly is always 'GRCh38' (CHECK constraint) — do not " +
        'group or filter by it.',
      entities: ['genomics.variants'],
    },
    {
      kind: 'term',
      title: 'dbSNP id (rsid) coverage is low',
      // Verified: `SELECT count(*) FILTER (WHERE rsid IS NOT NULL), count(*)
      // FROM genomics.variants` → 46 of 450 (10.2%) non-null.
      body:
        'variants.rsid (its dbSNP identifier) is null on most variants — ' +
        'about 90% have no rsid in this dataset, because most are too novel ' +
        'or too rare to carry one. Counting non-null rsid measures dbSNP ' +
        'cross-reference coverage, not variant quality or significance.',
      entities: ['genomics.variants'],
    },
    {
      kind: 'term',
      title: 'Clinical significance vocabulary',
      // Verified: `SELECT clinical_significance, count(*) FROM
      // genomics.variants GROUP BY 1` → BENIGN 68, LIKELY_BENIGN 74,
      // LIKELY_PATHOGENIC 53, PATHOGENIC 96, VUS 159 (450); CHECK pins the
      // five values.
      body:
        'variants.clinical_significance is one of PATHOGENIC, ' +
        'LIKELY_PATHOGENIC, VUS, LIKELY_BENIGN, BENIGN — five separate ACMG ' +
        "classes. 'Pathogenic' on its own names the PATHOGENIC class; " +
        'LIKELY_PATHOGENIC is a distinct, weaker class that is not part of ' +
        "it. 'Damaging' or 'harmful' variants means PATHOGENIC or " +
        'LIKELY_PATHOGENIC together; ' +
        "VUS ('variant of uncertain significance') is neither damaging nor " +
        'benign and should not be counted as either unless the question ' +
        'explicitly asks about uncertain variants.',
      synonyms: ['damaging', 'harmful', 'pathogenic'],
      entities: ['genomics.variants'],
    },
    {
      kind: 'term',
      title: 'Coverage: subjects and samples from 2023–2024 only',
      // Verified: `SELECT min(enrolled_on), max(enrolled_on) FROM
      // genomics.subjects` → 2023-01-01 .. 2024-09-19; `SELECT
      // min(collected_on), max(collected_on) FROM genomics.samples` →
      // 2023-02-02 .. 2024-12-11; both columns CHECK BETWEEN 2023-01-01 AND
      // 2024-12-31.
      body:
        'subjects.enrolled_on and samples.collected_on only cover ' +
        '2023-01-01 through 2024-12-31 (CHECK constraint on both) — there is ' +
        'no earlier or later subject or sample data in this dataset.',
      entities: ['genomics.subjects', 'genomics.samples'],
    },
    {
      kind: 'instruction',
      title: 'Report genes by symbol, not by id',
      // Verified: information_schema.columns — variant_calls has sample_id and
      // variant_id and no gene column; variants.gene_id and
      // genes.hgnc_symbol exist.
      body:
        'variant_calls references variants by id, and variants reference ' +
        'genes by id — variant_calls has no direct gene_id column. Join ' +
        'variant_calls → variants → genes and report genes.hgnc_symbol, not ' +
        'a numeric gene_id or variant_id.',
      entities: [
        'genomics.variant_calls',
        'genomics.variants',
        'genomics.genes',
      ],
    },
    {
      kind: 'default_filter',
      title: 'Exclude control samples',
      // Verified: `SELECT count(*) FILTER (WHERE is_control), count(*) FROM
      // genomics.samples` → 15 of 140 (10.7%). `SELECT count(*) FROM
      // genomics.subjects` → 120, none without a sample; the flag is per
      // sample, and `SELECT subject_id FROM genomics.samples GROUP BY 1 HAVING
      // bool_and(is_control)` → 8 subjects (4, 7, 12, 13, 69, 70, 83, 120)
      // whose only sample is a control — why a subject count must not be
      // routed through samples to apply this filter.
      body:
        'is_control is a property of a sample, not of a subject. Unless ' +
        'the question explicitly asks about controls, exclude samples where ' +
        'is_control = true from sample counts, variant-call aggregates and ' +
        'expression aggregates — control samples are QC material (about 11% ' +
        'of samples). The filter applies to queries that read samples, ' +
        'variant_calls, gene_expression or the views built on them. Counts ' +
        'of subjects, phenotypes, ancestry groups, variants or genes that do ' +
        'not read sample rows are not affected by it: every subject is an ' +
        'enrolled cohort member, so do not join to samples just to apply ' +
        'this filter.',
      entities: ['genomics.samples'],
    },
    {
      kind: 'instruction',
      title: 'Join subjects to superpopulation via ancestry group',
      // Verified: information_schema.columns — subjects has ancestry_group_id
      // and no superpopulation column; ancestry_groups has
      // superpopulation_id.
      body:
        'subjects has no superpopulation column. The path from a subject to ' +
        'their superpopulation is subjects → ancestry_groups ' +
        '(subjects.ancestry_group_id = ancestry_groups.id) → ' +
        'superpopulations (ancestry_groups.superpopulation_id = ' +
        'superpopulations.id).',
      entities: [
        'genomics.subjects',
        'genomics.ancestry_groups',
        'genomics.superpopulations',
      ],
    },
    {
      kind: 'term',
      title: 'Genotype 0/0 is not a carrier',
      // Verified: `SELECT genotype, count(*) FROM genomics.variant_calls GROUP
      // BY 1` → 0/0 1838, 0/1 2418, 1/1 1007 (5263); `col_description` of
      // variant_calls.genotype states the same three meanings.
      body:
        'variant_calls.genotype is one of 0/0 (homozygous reference — the ' +
        'sample does NOT carry the alternate allele), 0/1 (heterozygous — ' +
        'carries one copy), 1/1 (homozygous alternate — carries two copies). ' +
        'Only 0/1 and 1/1 count as "carrying" the variant.',
      synonyms: ['carrier', 'homozygous reference', 'heterozygous'],
      entities: ['genomics.variant_calls'],
    },
    {
      kind: 'term',
      title: 'A TPM of zero is a real measurement',
      // Verified: `SELECT count(*) FILTER (WHERE tpm = 0), count(*) FROM
      // genomics.gene_expression` → 1172 of 3000 (39.1%); `col_description` of
      // gene_expression.tpm → "A value of 0 is a measured zero, not a missing
      // value."
      body:
        'gene_expression.tpm (transcripts per million) of 0 is a real ' +
        'measured value — the gene was not expressed in that sample — not a ' +
        'missing or null value. About 39% of gene/sample pairs have tpm = 0. ' +
        'Do not filter out or exclude tpm = 0 rows when computing an average ' +
        'or median expression level; that biases the result upward.',
      entities: ['genomics.gene_expression'],
    },
    {
      kind: 'term',
      title: 'Expression measures: tpm and raw_count',
      // Verified: gene_expression has exactly two measures, raw_count bigint
      // and tpm numeric; `SELECT count(*), count(DISTINCT (sample_id,
      // gene_id)) FROM genomics.gene_expression` → 3000, 3000 (one row per
      // gene per sample); `SELECT count(*) FILTER (WHERE (raw_count = 0) <>
      // (tpm = 0)) FROM genomics.gene_expression` → 0.
      body:
        'gene_expression holds two measures per gene per sample: tpm ' +
        '(transcripts per million — the normalised expression level, ' +
        'comparable across samples and genes) and raw_count (the ' +
        'unnormalised read count, which scales with sequencing depth and is ' +
        'not comparable across samples). Expression level means tpm.',
      synonyms: ['expression level', 'TPM', 'raw count'],
      entities: ['genomics.gene_expression'],
    },
    {
      kind: 'term',
      title: 'Filter status and call confidence',
      // Verified: `SELECT filter_status, count(*) FROM genomics.variant_calls
      // GROUP BY 1` → LOW_QUAL 809, PASS 4454 (5263; 15.4% LOW_QUAL);
      // `SELECT genotype, filter_status, count(*) ... GROUP BY 1, 2` → all six
      // genotype/status pairs occur.
      body:
        "variant_calls.filter_status is PASS or LOW_QUAL. 'High-confidence' " +
        "calls means filter_status = 'PASS'; about 15% of calls are " +
        'LOW_QUAL and should be excluded from a high-confidence count or ' +
        'aggregate unless the question asks about call quality directly. ' +
        'filter_status grades the call, not the genotype: 0/0, 0/1 and 1/1 ' +
        'calls can each be PASS or LOW_QUAL.',
      entities: ['genomics.variant_calls'],
    },
  ],
  metrics: [
    {
      // Verified: `SELECT <expression> FROM genomics.variant_calls` → 0.4159.
      name: 'allele_fraction',
      label: 'Allele fraction',
      description:
        'Mean fraction of reads supporting the alternate allele, over calls ' +
        "with filter_status='PASS' and total_read_count >= 20. The 20-read " +
        'floor belongs to this metric only; it is not the definition of a ' +
        "high-confidence call, which is filter_status = 'PASS' alone.",
      entity: 'genomics.variant_calls',
      expression:
        "AVG(alt_read_count::numeric / NULLIF(total_read_count, 0)) FILTER (WHERE filter_status = 'PASS' AND total_read_count >= 20)",
    },
    {
      // Verified: `SELECT <expression> FROM genomics.variant_calls` → 84.63
      // (4454 of 5263 calls PASS).
      name: 'high_confidence_call_rate',
      label: 'High-confidence call rate',
      description:
        'Share of variant calls that passed quality filtering ' +
        "(filter_status = 'PASS'), as a percentage.",
      entity: 'genomics.variant_calls',
      expression:
        "ROUND(100.0 * COUNT(*) FILTER (WHERE filter_status = 'PASS') / NULLIF(COUNT(*), 0), 2)",
    },
  ],
};
