#!/usr/bin/env node
// Comparison report for the shared-context experiment.
// node scripts/compare-shared-context.mjs --baseline <dir> --shared <dir> --out <report.md> [--json <summary.json>] [--reads-path <dot.path>]
// Each dir holds round-1/, round-2/, ... with meter.jsonl (llm-meter-proxy log) and results.json (eval results array).
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const LABELS = ['plan', 'analyse', 'write-answer', 'sql-repair', 'judge', 'other'];
/** Labels outside the workflow's own cost (the eval judge and unknown callers). */
export const NOT_WORKFLOW = ['judge', 'other'];
export const DEFAULT_READS_PATHS = ['runContext.reads', 'details.reads', 'reads', 'evalDetails.reads', 'details.runContextReads'];

/** The proxy's label, with its `other` calls split by their system prompt's start. */
export function labelOf(rec) {
  if (LABELS.includes(rec.label) && rec.label !== 'other') return rec.label;
  const start = String(rec.systemStart ?? '');
  if (start.startsWith('You repair a single SQL statement')) return 'sql-repair';
  if (start.startsWith('You are a strict, impartial grader')) return 'judge';
  return 'other';
}

export const stripShared = (id) => String(id).replace(/^shared-/, '');

export function parseJsonl(text) {
  const out = [];
  for (const line of String(text).split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      out.push(JSON.parse(line));
    } catch {
      /* skip a torn line */
    }
  }
  return out;
}

/** Read a variant directory: [{ name, meter: [...], results: [...] }] sorted by round number. */
export function loadVariant(dir) {
  const rounds = fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && /^round-\d+$/.test(e.name))
    .map((e) => e.name)
    .sort((a, b) => Number(a.slice(6)) - Number(b.slice(6)));
  return rounds.map((name) => {
    const meterFile = path.join(dir, name, 'meter.jsonl');
    const resultsFile = path.join(dir, name, 'results.json');
    return {
      name,
      meter: fs.existsSync(meterFile) ? parseJsonl(fs.readFileSync(meterFile, 'utf8')) : [],
      results: fs.existsSync(resultsFile) ? JSON.parse(fs.readFileSync(resultsFile, 'utf8')) : [],
    };
  });
}

const sum = (xs) => xs.reduce((a, b) => a + b, 0);
export const mean = (xs) => (xs.length ? sum(xs) / xs.length : 0);
export function median(xs) {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Percent change from base to value; null when base is 0. */
export function pctChange(base, value) {
  if (!base) return null;
  return ((value - base) / base) * 100;
}

export function countCases(rounds) {
  return sum(rounds.map((r) => r.results.length));
}

/** Pass rate overall and per case (ids paired by stripping the `shared-` prefix). */
export function passStats(rounds) {
  const perCase = new Map();
  let passed = 0;
  let total = 0;
  for (const r of rounds) {
    for (const c of r.results) {
      const id = stripShared(c.id);
      const e = perCase.get(id) ?? { passed: 0, total: 0 };
      e.total += 1;
      total += 1;
      if (c.passed) {
        e.passed += 1;
        passed += 1;
      }
      perCase.set(id, e);
    }
  }
  return { passed, total, perCase };
}

export function durationStats(rounds) {
  const ds = rounds.flatMap((r) => r.results.map((c) => Number(c.durationMs) || 0));
  return { mean: mean(ds), median: median(ds), count: ds.length };
}

/** Failed checks per case id, for the paired table. */
export function failedChecks(rounds) {
  const out = new Map();
  for (const r of rounds) {
    for (const c of r.results) {
      for (const k of c.checkResults ?? []) {
        if (k.passed) continue;
        const id = stripShared(c.id);
        const list = out.get(id) ?? [];
        list.push(k.id);
        out.set(id, list);
      }
    }
  }
  return out;
}

const emptyBucket = () => ({ calls: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0, totalInputTokens: 0, requestChars: 0, toolUses: 0, durationMs: 0, costUnits: 0 });

/**
 * A call's cost in input-token units at Anthropic's relative prices: input
 * 1, cache write 1.25, cache read 0.1, output 5.
 */
export function costUnits(rec) {
  return (rec.inputTokens ?? 0) + 1.25 * (rec.cacheCreationTokens ?? 0) + 0.1 * (rec.cacheReadTokens ?? 0) + 5 * (rec.outputTokens ?? 0);
}

function addRecord(b, rec) {
  b.calls += 1;
  b.costUnits += costUnits(rec);
  b.inputTokens += rec.inputTokens ?? 0;
  b.outputTokens += rec.outputTokens ?? 0;
  b.cacheReadTokens += rec.cacheReadTokens ?? 0;
  b.cacheCreationTokens += rec.cacheCreationTokens ?? 0;
  b.totalInputTokens += rec.totalInputTokens ?? 0;
  b.requestChars += rec.requestChars ?? 0;
  b.toolUses += rec.toolUses ?? 0;
  b.durationMs += rec.durationMs ?? 0;
}

/** Totals per label, and all / without 'other', with per-case means (total / cases over all rounds). */
export function tokenStats(rounds) {
  const cases = countCases(rounds);
  const byLabel = Object.fromEntries(LABELS.map((l) => [l, emptyBucket()]));
  for (const r of rounds) {
    for (const rec of r.meter) {
      addRecord(byLabel[labelOf(rec)], rec);
    }
  }
  const all = emptyBucket();
  const withoutOther = emptyBucket();
  for (const l of LABELS) {
    for (const k of Object.keys(all)) {
      all[k] += byLabel[l][k];
      if (!NOT_WORKFLOW.includes(l)) withoutOther[k] += byLabel[l][k];
    }
  }
  const perCase = (b) => {
    const out = {};
    for (const k of Object.keys(b)) out[k] = cases ? b[k] / cases : 0;
    return out;
  };
  return {
    cases,
    byLabel,
    all,
    withoutOther,
    perCase: {
      byLabel: Object.fromEntries(LABELS.map((l) => [l, perCase(byLabel[l])])),
      all: perCase(all),
      withoutOther: perCase(withoutOther),
    },
  };
}

export function resolvePath(obj, dotPath) {
  let cur = obj;
  for (const part of String(dotPath).split('.')) {
    if (cur === null || cur === undefined) return undefined;
    cur = cur[part];
  }
  return cur;
}

/** Board reads per case: count and summed chars. `readsPath` null tries DEFAULT_READS_PATHS. Null when none resolves. */
export function readsStats(rounds, readsPath) {
  const paths = readsPath ? [readsPath] : DEFAULT_READS_PATHS;
  let found = false;
  let reads = 0;
  let chars = 0;
  for (const r of rounds) {
    for (const c of r.results) {
      for (const p of paths) {
        const v = resolvePath(c, p);
        if (Array.isArray(v)) {
          found = true;
          reads += v.length;
          chars += sum(v.map((x) => Number(x && x.chars) || 0));
          break;
        }
      }
    }
  }
  if (!found) return null;
  const cases = countCases(rounds);
  return { reads, chars, readsPerCase: cases ? reads / cases : 0, charsPerCase: cases ? chars / cases : 0 };
}

export function summarizeVariant(rounds, readsPath = null) {
  return {
    rounds: rounds.length,
    cases: countCases(rounds),
    pass: (() => {
      const p = passStats(rounds);
      return { passed: p.passed, total: p.total, perCase: Object.fromEntries(p.perCase) };
    })(),
    duration: durationStats(rounds),
    tokens: tokenStats(rounds),
    reads: readsStats(rounds, readsPath),
    failedChecks: Object.fromEntries(failedChecks(rounds)),
  };
}

const fmt = (n, d = 0) => (Number.isFinite(n) ? n.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d }) : '-');
export const fmtPct = (p) => (p === null || p === undefined ? 'n/a' : `${p > 0 ? '+' : p < 0 ? '−' : ''}${Math.abs(p).toFixed(1)} %`);
const secs = (ms) => `${(ms / 1000).toFixed(1)} s`;

export function buildSummary(baseline, shared, readsPath = null) {
  const b = summarizeVariant(baseline, readsPath);
  const s = summarizeVariant(shared, readsPath);
  const change = (bv, sv) => pctChange(bv, sv);
  return {
    baseline: b,
    shared: s,
    changes: {
      inputTokensPerCase: change(b.tokens.perCase.all.totalInputTokens, s.tokens.perCase.all.totalInputTokens),
      inputTokensPerCaseWithoutOther: change(b.tokens.perCase.withoutOther.totalInputTokens, s.tokens.perCase.withoutOther.totalInputTokens),
      costUnitsPerCaseWithoutOther: change(b.tokens.perCase.withoutOther.costUnits, s.tokens.perCase.withoutOther.costUnits),
      outputTokensPerCase: change(b.tokens.perCase.all.outputTokens, s.tokens.perCase.all.outputTokens),
      outputTokensPerCaseWithoutOther: change(b.tokens.perCase.withoutOther.outputTokens, s.tokens.perCase.withoutOther.outputTokens),
      requestCharsPerCase: change(b.tokens.perCase.withoutOther.requestChars, s.tokens.perCase.withoutOther.requestChars),
      llmCallsPerCaseWithoutOther: change(b.tokens.perCase.withoutOther.calls, s.tokens.perCase.withoutOther.calls),
      meanDuration: change(b.duration.mean, s.duration.mean),
      medianDuration: change(b.duration.median, s.duration.median),
    },
  };
}

export function renderVerdict(summary) {
  const { baseline: b, shared: s, changes: c } = summary;
  return [
    `- Coste por caso (sin juez, precios relativos de Anthropic con caché): ${fmtPct(c.costUnitsPerCaseWithoutOther)} (${fmt(b.tokens.perCase.withoutOther.costUnits)} -> ${fmt(s.tokens.perCase.withoutOther.costUnits)} unidades)`,
    `- Input tokens por caso (sin juez): ${fmtPct(c.inputTokensPerCaseWithoutOther)} (${fmt(b.tokens.perCase.withoutOther.totalInputTokens)} -> ${fmt(s.tokens.perCase.withoutOther.totalInputTokens)})`,
    `- Input tokens por caso (con juez): ${fmtPct(c.inputTokensPerCase)}`,
    `- Output tokens por caso (sin juez): ${fmtPct(c.outputTokensPerCaseWithoutOther)}`,
    `- Llamadas LLM por caso (sin juez): ${fmt(b.tokens.perCase.withoutOther.calls, 2)} -> ${fmt(s.tokens.perCase.withoutOther.calls, 2)} (${fmtPct(c.llmCallsPerCaseWithoutOther)})`,
    `- Latencia media: ${fmtPct(c.meanDuration)} (${secs(b.duration.mean)} -> ${secs(s.duration.mean)}); mediana: ${fmtPct(c.medianDuration)}`,
    `- Pass rate: ${s.pass.passed}/${s.pass.total} (shared) vs ${b.pass.passed}/${b.pass.total} (baseline)`,
  ].join('\n');
}

function table(headers, rows) {
  const line = (cells) => `| ${cells.join(' | ')} |`;
  return [line(headers), line(headers.map(() => '---')), ...rows.map(line)].join('\n');
}

export function renderReport(summary, meta = {}) {
  const { baseline: b, shared: s } = summary;
  const out = [];
  out.push('# Shared context vs baseline');
  out.push('');
  out.push(`Rondas: baseline ${b.rounds}, shared ${s.rounds}. Casos: baseline ${b.cases}, shared ${s.cases}.${meta.generatedAt ? ` Generado: ${meta.generatedAt}.` : ''}`);
  out.push('');
  out.push('## Veredicto (solo cifras)');
  out.push('');
  out.push(renderVerdict(summary));
  out.push('');

  out.push('## Calidad y latencia');
  out.push('');
  out.push(
    table(
      ['Variante', 'Pass rate', 'Duración media', 'Duración mediana'],
      [
        ['baseline', `${b.pass.passed}/${b.pass.total}`, secs(b.duration.mean), secs(b.duration.median)],
        ['shared', `${s.pass.passed}/${s.pass.total}`, secs(s.duration.mean), secs(s.duration.median)],
      ],
    ),
  );
  out.push('');
  const ids = [...new Set([...Object.keys(b.pass.perCase), ...Object.keys(s.pass.perCase)])].sort();
  out.push('### Pases por caso');
  out.push('');
  out.push(
    table(
      ['Caso', 'baseline', 'shared', 'Checks fallidos (baseline)', 'Checks fallidos (shared)'],
      ids.map((id) => {
        const bp = b.pass.perCase[id];
        const sp = s.pass.perCase[id];
        return [
          id,
          bp ? `${bp.passed}/${bp.total}` : '-',
          sp ? `${sp.passed}/${sp.total}` : '-',
          (b.failedChecks[id] ?? []).join(', ') || '-',
          (s.failedChecks[id] ?? []).join(', ') || '-',
        ];
      }),
    ),
  );
  out.push('');

  out.push('## Tokens');
  out.push('');
  out.push('Media por caso = total / casos de todas las rondas. "Input" = input + cache read + cache creation.');
  out.push('');
  const rowsFor = (name, key, which) => {
    const bt = which === 'label' ? b.tokens.byLabel[key] : b.tokens[key];
    const st = which === 'label' ? s.tokens.byLabel[key] : s.tokens[key];
    const bp = which === 'label' ? b.tokens.perCase.byLabel[key] : b.tokens.perCase[key];
    const sp = which === 'label' ? s.tokens.perCase.byLabel[key] : s.tokens.perCase[key];
    return [
      [name, 'baseline', fmt(bt.calls), fmt(bt.totalInputTokens), fmt(bt.outputTokens), fmt(bp.totalInputTokens), fmt(bp.outputTokens), fmt(bp.requestChars), ''],
      ['', 'shared', fmt(st.calls), fmt(st.totalInputTokens), fmt(st.outputTokens), fmt(sp.totalInputTokens), fmt(sp.outputTokens), fmt(sp.requestChars), fmtPct(pctChange(bp.totalInputTokens, sp.totalInputTokens))],
    ];
  };
  const tokenRows = [
    ...LABELS.flatMap((l) => rowsFor(l, l, 'label')),
    ...rowsFor('total', 'all', 'all'),
    ...rowsFor('total workflow (sin juez)', 'withoutOther', 'all'),
  ];
  out.push(
    table(
      ['Etiqueta', 'Variante', 'Llamadas', 'Input total', 'Output total', 'Input/caso', 'Output/caso', 'requestChars/caso', 'Δ input/caso'],
      tokenRows,
    ),
  );
  out.push('');
  out.push(
    table(
      ['Métrica (workflow, sin juez)', 'baseline', 'shared', 'Cambio'],
      [
        ['Input/caso', fmt(b.tokens.perCase.withoutOther.totalInputTokens), fmt(s.tokens.perCase.withoutOther.totalInputTokens), fmtPct(summary.changes.inputTokensPerCaseWithoutOther)],
        ['Output/caso', fmt(b.tokens.perCase.withoutOther.outputTokens), fmt(s.tokens.perCase.withoutOther.outputTokens), fmtPct(summary.changes.outputTokensPerCaseWithoutOther)],
        ['requestChars/caso', fmt(b.tokens.perCase.withoutOther.requestChars), fmt(s.tokens.perCase.withoutOther.requestChars), fmtPct(summary.changes.requestCharsPerCase)],
      ],
    ),
  );
  out.push('');

  out.push('## Llamadas LLM y tool_use por caso');
  out.push('');
  out.push(
    table(
      ['Etiqueta', 'Llamadas/caso baseline', 'Llamadas/caso shared', 'tool_use/caso baseline', 'tool_use/caso shared'],
      [
        ...LABELS.map((l) => [
          l,
          fmt(b.tokens.perCase.byLabel[l].calls, 2),
          fmt(s.tokens.perCase.byLabel[l].calls, 2),
          fmt(b.tokens.perCase.byLabel[l].toolUses, 2),
          fmt(s.tokens.perCase.byLabel[l].toolUses, 2),
        ]),
        [
          'total workflow (sin juez)',
          fmt(b.tokens.perCase.withoutOther.calls, 2),
          fmt(s.tokens.perCase.withoutOther.calls, 2),
          fmt(b.tokens.perCase.withoutOther.toolUses, 2),
          fmt(s.tokens.perCase.withoutOther.toolUses, 2),
        ],
      ],
    ),
  );
  out.push('');

  out.push('## Lecturas del board (shared)');
  out.push('');
  if (s.reads) {
    out.push(
      table(
        ['Lecturas', 'Lecturas/caso', 'Chars leídos', 'Chars/caso'],
        [[fmt(s.reads.reads), fmt(s.reads.readsPerCase, 2), fmt(s.reads.chars), fmt(s.reads.charsPerCase)]],
      ),
    );
  } else {
    out.push('No disponible: los resultados no traen lecturas (usa --reads-path <dot.path>).');
  }
  out.push('');
  return out.join('\n');
}

export function parseCliArgs(argv) {
  const out = { baseline: null, shared: null, out: null, json: null, readsPath: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--baseline') out.baseline = argv[++i];
    else if (a === '--shared') out.shared = argv[++i];
    else if (a === '--out') out.out = argv[++i];
    else if (a === '--json') out.json = argv[++i];
    else if (a === '--reads-path') out.readsPath = argv[++i];
  }
  return out;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = parseCliArgs(process.argv.slice(2));
  if (!args.baseline || !args.shared || !args.out) {
    console.error('usage: node scripts/compare-shared-context.mjs --baseline <dir> --shared <dir> --out <report.md> [--json <summary.json>] [--reads-path <dot.path>]');
    process.exit(2);
  }
  const summary = buildSummary(loadVariant(args.baseline), loadVariant(args.shared), args.readsPath);
  fs.mkdirSync(path.dirname(path.resolve(args.out)), { recursive: true });
  fs.writeFileSync(args.out, renderReport(summary, { generatedAt: new Date().toISOString() }));
  if (args.json) fs.writeFileSync(args.json, JSON.stringify(summary, null, 2));
  console.log(`report written to ${args.out}`);
}
