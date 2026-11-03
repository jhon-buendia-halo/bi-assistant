/* eslint-disable */
// Data readiness API smoke (BA-259). Drives a running app against the Postgres
// seeded with seed.sql and checks the reports against hand-computed values.
//   node smoke.mjs <appBaseUrl> <pgPort> [outDir]
// Exit code 0 when every check passes. No dependencies (Node 22 fetch).
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const [base, pgPort, outDir] = process.argv.slice(2);
if (!base || !pgPort) {
  console.error('usage: node smoke.mjs <appBaseUrl> <pgPort> [outDir]');
  process.exit(2);
}

let failures = 0;
const check = (label, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(
    `${ok ? 'PASS' : 'FAIL'} ${label}: ${JSON.stringify(actual)}${ok ? '' : ` (expected ${JSON.stringify(expected)})`}`,
  );
};

async function call(method, path, body) {
  const res = await fetch(base + path, {
    method,
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = text;
  }
  return { status: res.status, body: json };
}

const DIMENSIONS = [
  'completeness',
  'validity',
  'consistency',
  'uniqueness',
  'integrity',
  'accessibility',
  'timeliness',
  'reasonability',
];

/** score, checksRun, findingCount, worst severity per dimension. */
function dims(report) {
  const out = {};
  for (const d of report.dimensionScores) {
    out[d.dimension] = [d.score, d.totalChecks, d.findingCount, d.maxSeverity ?? null];
  }
  return out;
}

function findingKeys(report) {
  return report.findings
    .map((f) => `${f.dimension}|${f.entity ?? ''}|${f.field ?? ''}|${f.severity}`)
    .sort();
}

// Hand-computed from the spec formulas (data-readiness R12–R22) for seed.sql.
// [score, checksRun, findingCount, worst]
const EXPECTED_WHOLE = {
  dims: {
    completeness: [63, 6, 4, 'high'], // 1 - (1 + .4 + .4 + .4)/6
    validity: [60, 1, 1, 'medium'],
    consistency: [97, 3, 1, 'low'], // 1 - .1/3
    uniqueness: [87, 6, 2, 'medium'], // 1 - .8/6 (secrets' declared key counts, unmeasured)
    integrity: [30, 2, 2, 'high'], // 1 - 1.4/2
    accessibility: [92, 5, 1, 'medium'], // 1 - .4/5 (audit_log and secrets, one finding per namespace)
    timeliness: [73, 3, 2, 'medium'], // 1 - .8/3
    reasonability: [92, 13, 4, 'medium'], // 1 - 1.0/13 (secrets.id is numeric)
  },
  overall: 74, // (63+60+97+87+30+92+73+92)/8 = 74.25
  maturity: 'Defined',
  entityCount: 5,
  findings: [
    'accessibility|||medium',
    'completeness|customers|nickname|high',
    'completeness|customers|region|medium',
    'completeness|events|customer_id|medium',
    'completeness|events|event_id|medium',
    'consistency|customers|segment|low',
    'integrity|events|customer_id|medium',
    'integrity|orders|customer_id|high',
    'reasonability|customers|created_at|low',
    'reasonability|orders|amount|low',
    'reasonability|orders|discount_pct|medium',
    'reasonability|orders|ordered_at|medium',
    'timeliness|customers|created_at|medium',
    'timeliness|events|event_year|medium',
    'uniqueness|events|customer_id|medium',
    'uniqueness|events|event_id|medium',
    'validity|customers|email|medium',
  ],
};

const EXPECTED_ORDERS = {
  dims: {
    completeness: [100, 1, 0, null],
    validity: [100, 0, 0, null],
    consistency: [100, 0, 0, null],
    uniqueness: [100, 1, 0, null],
    integrity: [0, 1, 1, 'high'],
    accessibility: [100, 1, 0, null],
    timeliness: [100, 1, 0, null],
    reasonability: [85, 6, 3, 'medium'], // 1 - .9/6
  },
  overall: 86, // 685/8 = 85.625
  maturity: 'Managed',
  entityCount: 1,
};

const EXPECTED_PAIR = {
  dims: {
    completeness: [56, 5, 4, 'high'], // 1 - 2.2/5
    validity: [60, 1, 1, 'medium'],
    consistency: [97, 3, 1, 'low'],
    uniqueness: [73, 3, 2, 'medium'], // 1 - .8/3
    integrity: [60, 1, 1, 'medium'],
    accessibility: [100, 2, 0, null],
    timeliness: [60, 2, 2, 'medium'],
    reasonability: [98, 5, 1, 'low'], // 1 - .1/5
  },
  overall: 76, // 604/8 = 75.5
  maturity: 'Defined',
  entityCount: 2,
};

function compare(label, report, expected) {
  const actual = dims(report);
  for (const d of DIMENSIONS) check(`${label} ${d}`, actual[d], expected.dims[d]);
  for (const d of ['accuracy', 'currency']) {
    const s = report.dimensionScores.find((x) => x.dimension === d);
    check(`${label} ${d} not assessed`, [s?.score, s?.assessed, s?.totalChecks], [100, false, 0]);
  }
  check(`${label} overall`, [report.overallScore, report.maturity], [expected.overall, expected.maturity]);
  check(`${label} entityCount`, report.entityCount, expected.entityCount);
  if (expected.findings) check(`${label} findings`, findingKeys(report), expected.findings);
}

const saved = {};
const ds = await call('POST', '/datasources', {
  kind: 'postgres',
  name: 'Readiness smoke',
  config: {
    host: '127.0.0.1',
    port: Number(pgPort),
    database: 'smokedb',
    user: 'smoke_reader',
    password: 'smoke_reader',
    ssl: false,
  },
});
check('create datasource ok', ds.body?.ok, true);
const dsId = ds.body?.datasource?.id;

const whole = await call('POST', '/data-readiness/assessments', { datasourceId: dsId, sessionId: 'smoke-session' });
check('whole: status', whole.status, 201);
saved.whole = whole.body;
if (whole.status === 201) {
  compare('whole', whole.body, EXPECTED_WHOLE);
  check('whole: sessionId', whole.body.sessionId, 'smoke-session');
  // R23: same profile, same order — severity-agnostic check that entity checks
  // come in profile order then integrity then accessibility.
  const dimsInOrder = whole.body.findings.map((f) => f.dimension);
  check('whole: accessibility last', dimsInOrder.at(-1), 'accessibility');
}

const one = await call('POST', '/data-readiness/assessments', {
  datasourceId: dsId,
  entities: ['smokedb.smoke.orders'],
});
check('orders scope: status', one.status, 201);
saved.orders = one.body;
if (one.status === 201) compare('orders scope', one.body, EXPECTED_ORDERS);

const pair = await call('POST', '/data-readiness/assessments', {
  datasourceId: dsId,
  entities: ['smokedb.smoke.customers', 'smokedb.smoke.events', 'smokedb.smoke.gone'],
});
check('pair scope: status', pair.status, 201);
saved.pair = pair.body;
if (pair.status === 201) compare('pair scope', pair.body, EXPECTED_PAIR);

const none = await call('POST', '/data-readiness/assessments', {
  datasourceId: dsId,
  entities: ['smokedb.smoke.gone'],
});
check('missing entity', [none.status, none.body?.message], [400, 'None of the entities to assess exist']);

const noId = await call('POST', '/data-readiness/assessments', {});
check('missing id', [noId.status, noId.body?.message], [400, 'datasourceId is required']);

const badId = await call('POST', '/data-readiness/assessments', { datasourceId: 'nope' });
check('unknown datasource', [badId.status, badId.body?.message], [404, 'Datasource "nope" not found']);

const rest = await call('POST', '/datasources', {
  kind: 'rest',
  name: 'Readiness smoke REST',
  config: {
    baseUrl: 'http://127.0.0.1:9',
    auth: { type: 'none' },
    endpoints: [{ name: 'things', path: '/things' }],
  },
});
const restId = rest.body?.datasource?.id;
if (restId) {
  const r = await call('POST', '/data-readiness/assessments', { datasourceId: restId });
  check('rest kind', [r.status, r.body?.message], [400, 'Data readiness supports PostgreSQL and Databricks datasources only']);
} else {
  console.log(`SKIP rest kind: could not create a rest datasource (${JSON.stringify(rest.body)})`);
}

const list = await call('GET', `/data-readiness/assessments?datasourceId=${dsId}`);
check('list: status', list.status, 200);
const ids = (list.body?.reports ?? []).map((r) => r.id);
check('list: newest first', ids, [pair.body?.id, one.body?.id, whole.body?.id]);
const sorted = [...(list.body?.reports ?? [])].map((r) => r.generatedAt);
check('list: generatedAt descending', sorted, [...sorted].sort().reverse());
check('list: summary keys', Object.keys(list.body?.reports?.[2] ?? {}).sort(), [
  'datasourceId', 'datasourceKind', 'datasourceName', 'entityCount', 'generatedAt', 'id', 'maturity', 'overallScore', 'sessionId',
]);

const listNoId = await call('GET', '/data-readiness/assessments');
check('list missing id', [listNoId.status, listNoId.body?.message], [400, 'datasourceId is required']);
const listUnknown = await call('GET', '/data-readiness/assessments?datasourceId=nope');
check('list unknown', [listUnknown.status, listUnknown.body], [200, { reports: [] }]);

const got = await call('GET', `/data-readiness/assessments/${whole.body?.id}`);
check('get by id', [got.status, JSON.stringify(got.body) === JSON.stringify(whole.body)], [200, true]);
const missing = await call('GET', '/data-readiness/assessments/nope');
check('get unknown', [missing.status, missing.body?.message], [404, 'Readiness report "nope" not found']);

if (outDir) {
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, 'reports.json'), JSON.stringify(saved, null, 2));
}
console.log(failures ? `\n${failures} check(s) FAILED` : '\nALL CHECKS PASSED');
process.exit(failures ? 1 : 0);
