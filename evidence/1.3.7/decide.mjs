#!/usr/bin/env node
/**
 * ADR-0031 decision script for the memory eval (BA-81 / BA-190).
 *
 * Written and fixed on 2026-11-02, BEFORE the first Phase 3 run, so the
 * rule is applied as written here and not tuned on the results.
 *
 * Usage: node decide.mjs <runs.json>
 *   runs.json: { "model": "...", "runs": { "noneA": [file, ...], "noneB": [...],
 *                "mastraA": [...], "mastraB": [...] } }
 *   Each label is one A/A side: the EVAL_RUN_FILE of each memory set
 *   (memory-world-cup, memory-finance, memory-marketing-analytics), combined.
 *
 * Unit of measure: the question verdict pass^k of agents-evals R211 (a
 * question passes only when all its attempts pass), the same unit eval:diff
 * compares. The attempt pass rate is printed beside it for information.
 *
 * Rules (ADR-0031, "Decision rule, fixed before the first run"):
 *  1. Noise: for each arm, the A/A gap = |rate(A) - rate(B)| on the learning
 *     categories (memory-reuse, memory-correction, memory-update,
 *     memory-rejected; dev and held-out together, 24 questions per run).
 *     noise = the larger of the two arms' gaps.
 *  2. Memory may be on by default only if ALL hold:
 *     a. d = rate(mastra A+B) - rate(none A+B) on the learning categories
 *        is greater than noise ("beats no memory beyond the A/A noise");
 *     b. memory-abstain is not worse: rate(mastra A+B) >= rate(none A+B) - noise;
 *     c. the existing sets do not get worse: holds by construction (agents-evals
 *        R238, OD-8: a memory arm recalls nothing on a set without teach
 *        signals), printed as such, not measured;
 *     d. M1 (no row value retained) passes on 100% of mastra attempts
 *        (agents-evals R244: hard requirement).
 *     The Newcombe 95% interval of d (eval:diff's flag, R225) is printed for
 *     information; it does not change the verdict.
 *  3. The Hindsight + Mastra arm is built only if rate(mastra A+B) on the
 *     learning categories is below 80%.
 *  memory-vs-curated is printed and flagged when mastra is worse than none
 *  beyond the noise; ADR-0031 names abstain and the existing sets only.
 */
import fs from 'node:fs';

const LEARNING = [
  'memory-reuse',
  'memory-correction',
  'memory-update',
  'memory-rejected',
];
const ALL = [...LEARNING, 'memory-abstain', 'memory-vs-curated'];
const Z = 1.959964;

function wilson(x, n) {
  if (!n) return [NaN, NaN];
  const p = x / n;
  const denom = 1 + (Z * Z) / n;
  const centre = (p + (Z * Z) / (2 * n)) / denom;
  const half =
    (Z * Math.sqrt((p * (1 - p)) / n + (Z * Z) / (4 * n * n))) / denom;
  return [Math.max(0, centre - half), Math.min(1, centre + half)];
}

/** Newcombe (1998) method 10: interval of p2 - p1. */
function newcombe(x1, n1, x2, n2) {
  const p1 = x1 / n1;
  const p2 = x2 / n2;
  const [l1, u1] = wilson(x1, n1);
  const [l2, u2] = wilson(x2, n2);
  const d = p2 - p1;
  return [
    d - Math.sqrt((p2 - l2) ** 2 + (u1 - p1) ** 2),
    d + Math.sqrt((u2 - p2) ** 2 + (p1 - l1) ** 2),
  ];
}

const pts = (v) => `${v >= 0 ? '+' : ''}${(v * 100).toFixed(1)} pts`;
const pct = (x, n) => (n ? `${((100 * x) / n).toFixed(1)}%` : '—');

function attemptsOf(result) {
  return result.attempts?.length ? result.attempts : [result];
}

function loadSide(files) {
  const results = [];
  const meta = [];
  for (const file of files) {
    const run = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!Array.isArray(run.results)) throw new Error(`${file}: not a run file`);
    meta.push({
      file,
      jobId: run.jobId,
      arm: run.arm?.memory ?? 'none',
      model: run.model,
      repeats: run.repeats,
      status: run.status,
      costUsd: run.costUsd ?? 0,
    });
    results.push(...run.results);
  }
  const ids = results.map((r) => r.id);
  const dup = ids.find((id, i) => ids.indexOf(id) !== i);
  if (dup) throw new Error(`question ${dup} twice in one side`);
  return { results, meta };
}

function tally(results, categories, split) {
  let q = 0;
  let qPassed = 0;
  let a = 0;
  let aPassed = 0;
  for (const r of results) {
    if (!categories.includes(r.category)) continue;
    if (split && r.split !== split) continue;
    if (r.status === 'not-scored') continue;
    q += 1;
    if (r.status === 'passed') qPassed += 1;
    for (const at of attemptsOf(r)) {
      if (at.status === 'not-scored') continue;
      a += 1;
      if (at.status === 'passed') aPassed += 1;
    }
  }
  return { q, qPassed, a, aPassed, rate: q ? qPassed / q : NaN };
}

function checkTally(results, checkId) {
  let total = 0;
  let passed = 0;
  for (const r of results) {
    for (const at of attemptsOf(r)) {
      const c = (at.checkResults ?? []).find((k) => k.id === checkId);
      if (!c || c.status === 'not-scored') continue;
      total += 1;
      if (c.passed) passed += 1;
    }
  }
  return { passed, total };
}

function pool(...sides) {
  const out = { q: 0, qPassed: 0, a: 0, aPassed: 0 };
  for (const s of sides) {
    out.q += s.q;
    out.qPassed += s.qPassed;
    out.a += s.a;
    out.aPassed += s.aPassed;
  }
  out.rate = out.q ? out.qPassed / out.q : NaN;
  return out;
}

const config = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const sides = {};
for (const [label, files] of Object.entries(config.runs)) {
  sides[label] = loadSide(files);
}
const arms = { none: ['noneA', 'noneB'], mastra: ['mastraA', 'mastraB'] };

const lines = [];
const out = (s = '') => lines.push(s);

out(`# ADR-0031 memory eval — ${config.model ?? 'model not named'}`);
out();
out('## Runs');
out('| Side | Arm | Model | Repeats | Status | Cost USD | Run ids |');
out('|---|---|---|---|---|---|---|');
for (const [label, side] of Object.entries(sides)) {
  const m = side.meta;
  out(
    `| ${label} | ${[...new Set(m.map((x) => x.arm))].join(',')} | ${[...new Set(m.map((x) => x.model))].join(',')} | ${[...new Set(m.map((x) => x.repeats))].join(',')} | ${[...new Set(m.map((x) => x.status))].join(',')} | ${m.reduce((s, x) => s + x.costUsd, 0).toFixed(4)} | ${m.map((x) => String(x.jobId).slice(0, 8)).join(', ')} |`,
  );
}
out();

out('## Pass^k by category (questions passed / scored · attempt pass rate)');
out(`| Category | ${Object.keys(sides).join(' | ')} |`);
out(`|---|${Object.keys(sides).map(() => '---').join('|')}|`);
for (const cat of [...ALL, 'LEARNING (4)']) {
  const cats = cat === 'LEARNING (4)' ? LEARNING : [cat];
  const cells = Object.values(sides).map((s) => {
    const t = tally(s.results, cats);
    return `${t.qPassed}/${t.q} (${pct(t.qPassed, t.q)}) · ${pct(t.aPassed, t.a)}`;
  });
  out(`| ${cat} | ${cells.join(' | ')} |`);
}
out();
for (const split of ['dev', 'held-out']) {
  out(`### ${split}`);
  out(`| Category | ${Object.keys(sides).join(' | ')} |`);
  out(`|---|${Object.keys(sides).map(() => '---').join('|')}|`);
  for (const cat of [...ALL, 'LEARNING (4)']) {
    const cats = cat === 'LEARNING (4)' ? LEARNING : [cat];
    const cells = Object.values(sides).map((s) => {
      const t = tally(s.results, cats, split);
      return `${t.qPassed}/${t.q}`;
    });
    out(`| ${cat} | ${cells.join(' | ')} |`);
  }
  out();
}

// Rule 1: noise.
out('## Rule 1 — A/A noise (learning categories)');
const gaps = {};
for (const [arm, [a, b]] of Object.entries(arms)) {
  const ta = tally(sides[a].results, LEARNING);
  const tb = tally(sides[b].results, LEARNING);
  gaps[arm] = Math.abs(ta.rate - tb.rate);
  const [lo, hi] = newcombe(ta.qPassed, ta.q, tb.qPassed, tb.q);
  out(
    `- ${arm}: A ${ta.qPassed}/${ta.q}, B ${tb.qPassed}/${tb.q}, gap ${(gaps[arm] * 100).toFixed(1)} pts (B−A interval ${pts(lo)} to ${pts(hi)})`,
  );
  for (const cat of ALL) {
    const ca = tally(sides[a].results, [cat]);
    const cb = tally(sides[b].results, [cat]);
    out(`  - ${cat}: ${ca.qPassed}/${ca.q} vs ${cb.qPassed}/${cb.q}`);
  }
}
const noise = Math.max(gaps.none, gaps.mastra);
out(`- **noise = ${(noise * 100).toFixed(1)} pts** (the larger A/A gap)`);
out();

// Rule 2.
out('## Rule 2 — may memory be on by default?');
const noneL = pool(...arms.none.map((s) => tally(sides[s].results, LEARNING)));
const mastraL = pool(
  ...arms.mastra.map((s) => tally(sides[s].results, LEARNING)),
);
const d = mastraL.rate - noneL.rate;
const [dlo, dhi] = newcombe(noneL.qPassed, noneL.q, mastraL.qPassed, mastraL.q);
const flag = dlo > 0 ? 'up' : dhi < 0 ? 'down' : 'within';
const a2 = d > noise;
out(
  `- a. learning: none ${noneL.qPassed}/${noneL.q} (${pct(noneL.qPassed, noneL.q)}), mastra ${mastraL.qPassed}/${mastraL.q} (${pct(mastraL.qPassed, mastraL.q)}); d = ${pts(d)} vs noise ${(noise * 100).toFixed(1)} pts → **${a2 ? 'beats beyond noise' : 'does NOT beat beyond noise'}** (for information: Newcombe ${pts(dlo)} to ${pts(dhi)}, eval:diff flag \`${flag}\`)`,
);
for (const cat of LEARNING) {
  const n = pool(...arms.none.map((s) => tally(sides[s].results, [cat])));
  const m = pool(...arms.mastra.map((s) => tally(sides[s].results, [cat])));
  out(
    `  - ${cat}: none ${n.qPassed}/${n.q}, mastra ${m.qPassed}/${m.q} (${pts(m.rate - n.rate)})`,
  );
}
const noneAb = pool(
  ...arms.none.map((s) => tally(sides[s].results, ['memory-abstain'])),
);
const mastraAb = pool(
  ...arms.mastra.map((s) => tally(sides[s].results, ['memory-abstain'])),
);
const b2 = noneAb.q > 0 && mastraAb.q > 0 && mastraAb.rate >= noneAb.rate - noise;
const m3 = arms.mastra
  .map((s) => checkTally(sides[s].results, 'check-teach-not-recalled'))
  .reduce((acc, t) => ({ passed: acc.passed + t.passed, total: acc.total + t.total }), { passed: 0, total: 0 });
out(
  `- b. abstain: none ${noneAb.qPassed}/${noneAb.q}, mastra ${mastraAb.qPassed}/${mastraAb.q} (${pts(mastraAb.rate - noneAb.rate)}) → **${b2 ? 'not worse beyond noise' : 'WORSE beyond noise'}**; M3 teachNotRecalled under mastra ${m3.passed}/${m3.total} attempts`,
);
out(
  '- c. existing sets: not worse by construction (R238, OD-8: no teach signal, nothing recalled); not measured.',
);
const m1 = arms.mastra
  .map((s) => checkTally(sides[s].results, 'check-no-row-values-retained'))
  .reduce((acc, t) => ({ passed: acc.passed + t.passed, total: acc.total + t.total }), { passed: 0, total: 0 });
const d2 = m1.total > 0 && m1.passed === m1.total;
out(
  `- d. M1 under mastra: ${m1.passed}/${m1.total} attempts → **${d2 ? '100%' : 'BELOW 100% (hard requirement fails)'}**`,
);
const noneVc = pool(
  ...arms.none.map((s) => tally(sides[s].results, ['memory-vs-curated'])),
);
const mastraVc = pool(
  ...arms.mastra.map((s) => tally(sides[s].results, ['memory-vs-curated'])),
);
out(
  `- vs-curated (information): none ${noneVc.qPassed}/${noneVc.q}, mastra ${mastraVc.qPassed}/${mastraVc.q} (${pts(mastraVc.rate - noneVc.rate)})${mastraVc.rate < noneVc.rate - noise ? ' — WORSE beyond noise' : ''}`,
);
const m2 = arms.mastra
  .map((s) => checkTally(sides[s].results, 'check-not-rejected-sql'))
  .reduce((acc, t) => ({ passed: acc.passed + t.passed, total: acc.total + t.total }), { passed: 0, total: 0 });
out(`- M2 notRejectedSql under mastra (information): ${m2.passed}/${m2.total} attempts`);
const rule2 = a2 && b2 && d2;
out(`- **Rule 2 verdict: ${rule2 ? 'memory MAY be on by default' : 'memory may NOT be on by default'}**`);
out();

// Rule 3.
out('## Rule 3 — build the Hindsight + Mastra arm?');
const below80 = mastraL.rate < 0.8;
out(
  `- mastra on the learning categories: ${pct(mastraL.qPassed, mastraL.q)} (A+B) → **${below80 ? 'below 80%: the Hindsight arm is a candidate (ask the user)' : 'at or above 80%: no Hindsight arm; this set cannot show a gain from it'}**`,
);
out();

// Cost and recall.
out('## Cost and recall');
for (const [label, side] of Object.entries(sides)) {
  const cost = side.meta.reduce((s, x) => s + x.costUsd, 0);
  const q = side.results.length;
  const recall = side.results
    .flatMap((r) => attemptsOf(r))
    .map((at) => at.memory?.recallMs)
    .filter((v) => typeof v === 'number')
    .sort((x, y) => x - y);
  const at = (p) => {
    if (!recall.length) return '—';
    const i = (recall.length - 1) * p;
    const lo = Math.floor(i);
    const hi = Math.ceil(i);
    return Math.round(recall[lo] + (recall[hi] - recall[lo]) * (i - lo));
  };
  out(
    `- ${label}: ${cost.toFixed(4)} USD, ${(cost / q).toFixed(4)} USD per case (${q} cases)${recall.length ? `, recall p50 ${at(0.5)} ms · p90 ${at(0.9)} ms over ${recall.length} attempts` : ''}`,
  );
}

const report = lines.join('\n');
process.stdout.write(`${report}\n`);
if (config.out) fs.writeFileSync(config.out, `${report}\n`);
