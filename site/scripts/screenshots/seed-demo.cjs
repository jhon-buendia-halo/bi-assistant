/**
 * Seeds the demo app data used for the product-page screenshots.
 *
 * Everything here is real except the model's prose: the SQL below was run
 * against the local world_cup Postgres and the rows are its actual output, the
 * visuals are written through the app's own spec renderer, and the session is
 * created by the running backend.
 */
const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '../../..');
const DATA = process.env.APP_DATA_DIR ?? path.join(ROOT, '.context/demo-data');
const DIST = path.join(ROOT, 'backend/dist/modules/sessions');
const DB = path.join(DATA, 'app.sqlite');

const Database = require(path.join(ROOT, 'backend/node_modules/better-sqlite3'));
const { storedVisualizationDocument } = require(path.join(DIST, 'visualization-document.js'));
const {
  SPEC_BODY_HTML,
  SPEC_BOOTSTRAP_SCRIPT,
  SPEC_FILENAME,
  visualSpecSchema,
} = require(path.join(DIST, 'visual-spec.js'));
const { VISUAL_RUNTIME_SCRIPT, VISUAL_RUNTIME_FILENAME } = require(path.join(DIST, 'visual-runtime.js'));
const { FRAME_SELECT_SCRIPT, FRAME_SCRIPT_FILENAME } = require(path.join(DIST, 'visualization-document.js'));

const db = new Database(DB);
const row = db.prepare('select rid, doc from sessions').get();
if (!row) throw new Error('no session to seed — create one first');
const session = JSON.parse(row.doc);
const SID = session.id;
const WS = path.join(DATA, 'workspaces', `session-${SID}`);

// ── the rows, as the warehouse actually returned them ───────────────────────
const COVERAGE_SQL = `SELECT t.tournament_year,
       t.name AS tournament,
       COUNT(DISTINCT m.id) AS matches,
       COUNT(DISTINCT s.team_id) AS teams_with_stats
FROM world_cup.tournaments t
JOIN world_cup.matches m ON m.tournament_id = t.id
LEFT JOIN world_cup.match_team_statistics s ON s.match_id = m.id
GROUP BY t.tournament_year, t.name
ORDER BY t.tournament_year`;

const COVERAGE_ROWS = [
  { tournament_year: 2018, tournament: '2018 FIFA World Cup', matches: 8, teams_with_stats: 8 },
  { tournament_year: 2022, tournament: '2022 FIFA World Cup', matches: 8, teams_with_stats: 8 },
];

const FINISHING_SQL = `SELECT t.common_name AS team,
       COUNT(DISTINCT s.match_id) AS matches,
       g.goals,
       ROUND(SUM(s.expected_goals), 2) AS expected_goals,
       ROUND(g.goals - SUM(s.expected_goals), 2) AS goals_above_expected
FROM world_cup.match_team_statistics s
JOIN world_cup.teams t ON t.id = s.team_id
JOIN LATERAL (
  SELECT COUNT(*) AS goals
  FROM world_cup.goals gg
  WHERE gg.scoring_team_id = t.id
) g ON TRUE
GROUP BY t.common_name, g.goals
ORDER BY goals_above_expected DESC`;

const FINISHING_ROWS = [
  { team: 'France', matches: 6, goals: 14, expected_goals: 10.75, goals_above_expected: 3.25 },
  { team: 'Netherlands', matches: 1, goals: 2, expected_goals: 0.8, goals_above_expected: 1.2 },
  { team: 'Russia', matches: 1, goals: 2, expected_goals: 1.25, goals_above_expected: 0.75 },
  { team: 'Argentina', matches: 3, goals: 8, expected_goals: 7.4, goals_above_expected: 0.6 },
  { team: 'Croatia', matches: 6, goals: 9, expected_goals: 8.55, goals_above_expected: 0.45 },
  { team: 'Belgium', matches: 3, goals: 4, expected_goals: 3.75, goals_above_expected: 0.25 },
  { team: 'Uruguay', matches: 1, goals: 0, expected_goals: 0.75, goals_above_expected: -0.75 },
  { team: 'Sweden', matches: 1, goals: 0, expected_goals: 0.8, goals_above_expected: -0.8 },
  { team: 'Morocco', matches: 3, goals: 2, expected_goals: 2.9, goals_above_expected: -0.9 },
  { team: 'Portugal', matches: 1, goals: 0, expected_goals: 1.15, goals_above_expected: -1.15 },
  { team: 'England', matches: 4, goals: 4, expected_goals: 6.15, goals_above_expected: -2.15 },
  { team: 'Brazil', matches: 2, goals: 2, expected_goals: 4.45, goals_above_expected: -2.45 },
];

const FINISHING_COLUMNS = ['team', 'matches', 'goals', 'expected_goals', 'goals_above_expected'];
const QUALIFIED_ROWS = FINISHING_ROWS.filter((r) => r.matches >= 3);

const ENTITIES = [
  'world_cup.world_cup.match_team_statistics',
  'world_cup.world_cup.teams',
  'world_cup.world_cup.goals',
  'world_cup.world_cup.tournaments',
  'world_cup.world_cup.matches',
];

// ── transcript ──────────────────────────────────────────────────────────────
const t = (min, sec = 0) =>
  new Date(Date.UTC(2026, 8, 22, 9, 14 + min, sec)).toISOString();

const ANSWER_AT = t(3, 51);

const messages = [
  {
    role: 'user',
    content: 'Which teams got the most out of their chances at the World Cup?',
    at: t(0),
  },
  {
    role: 'assistant',
    content:
      '"Got the most out of their chances" can mean a few different things in this data, and they do not rank the same. Which one do you want?',
    at: t(0, 6),
    clarification: {
      question: 'How should finishing quality be measured?',
      options: [
        {
          label: 'Goals versus expected goals',
          description:
            'Goals scored minus the expected goals the same shots generated — who beat the chance quality they created.',
        },
        {
          label: 'Conversion of shots on target',
          description: 'Goals as a share of shots on target, from match_team_statistics.',
        },
        {
          label: 'Goals per match played',
          description: 'Raw scoring rate, which favours teams that went deeper in the tournament.',
        },
      ],
    },
  },
  {
    role: 'user',
    content: 'Goals versus expected goals. Both tournaments together.',
    at: t(1, 12),
  },
  {
    role: 'assistant',
    content:
      '**France finished best by a clear margin: 14 goals from 10.75 expected, +3.25 above the chances they created.** Brazil sit at the other end — 2 goals from 4.45 expected, **−2.45**, the widest shortfall in the dataset.\n\nAcross the 2018 and 2022 tournaments, six teams out-finished their expected goals and six fell short:\n\n| Team | Goals | Expected | Gap |\n| --- | ---: | ---: | ---: |\n| France | 14 | 10.75 | **+3.25** |\n| Netherlands | 2 | 0.80 | +1.20 |\n| Russia | 2 | 1.25 | +0.75 |\n| Argentina | 8 | 7.40 | +0.60 |\n| Croatia | 9 | 8.55 | +0.45 |\n| Belgium | 4 | 3.75 | +0.25 |\n| England | 4 | 6.15 | −2.15 |\n| Brazil | 2 | 4.45 | **−2.45** |\n\nTwo cautions before this gets quoted. The gaps at the top of the list are not all equally solid: Netherlands and Russia each appear in a single match, so +1.20 and +0.75 are one good afternoon rather than a pattern. Only France, Croatia, England, Argentina, Belgium and Morocco played three matches or more with statistics recorded. And the *Finals-stage only* default filter is applied — this covers the 16 knockout matches held in the dataset, not the full group stage.',
    at: ANSWER_AT,
    entities: ENTITIES,
    interpretation:
      'Finishing quality = goals scored minus summed expected_goals per team, across both tournaments.',
    reasoning: [
      {
        step: 1,
        rationale:
          'Check what the dataset actually covers before ranking anything — which tournaments, how many matches, and whether every team has statistics recorded.',
        tool: 'run_readonly_sql',
        input: COVERAGE_SQL,
        rowCount: 2,
      },
      {
        step: 2,
        rationale:
          'Sum expected goals per team from match_team_statistics and count actual goals from the goals table, then take the difference. Goals are counted from the goals table rather than match scores so own goals stay with the team credited in the data.',
        tool: 'run_readonly_sql',
        input: FINISHING_SQL,
        rowCount: 12,
      },
    ],
    knowledge: [
      {
        id: 'k-finishing',
        kind: 'term',
        title: 'Finishing quality',
        body: 'Goals scored minus expected goals over the same matches. Positive means the team out-finished the chances it created.',
      },
      {
        id: 'k-finals',
        kind: 'default_filter',
        title: 'Finals-stage matches only',
        body: 'Unless the question says otherwise, restrict to matches held in the tournament dataset (knockout stage) and state that the filter was applied.',
      },
    ],
    data: [
      {
        tool: 'run_readonly_sql',
        input: COVERAGE_SQL,
        columns: ['tournament_year', 'tournament', 'matches', 'teams_with_stats'],
        rows: COVERAGE_ROWS,
        rowCount: 2,
        rationale: 'Confirm the dataset covers both tournaments and every team has statistics.',
      },
      {
        tool: 'run_readonly_sql',
        input: FINISHING_SQL,
        columns: FINISHING_COLUMNS,
        rows: FINISHING_ROWS,
        rowCount: 12,
        rationale: 'Goals scored against expected goals, per team, across both tournaments.',
      },
    ],
    crossCheck: {
      status: 'agree',
      note: 'Re-derived the top and bottom rows with a second query grouped on team id; France +3.25 and Brazil −2.45 both reproduce.',
    },
  },
  {
    role: 'user',
    content: 'Chart it, and make the teams who under-performed obvious.',
    at: t(5, 20),
  },
  {
    role: 'assistant',
    content:
      'Built it as a diverging bar chart of goals above expected, so over- and under-performers separate around zero, with goals and expected goals kept in the table underneath.',
    at: t(5, 44),
    visual: { visualId: '', version: 1, title: 'Finishing quality: goals above expected', action: 'created' },
  },
  {
    role: 'user',
    content:
      'Drop the one- and two-match teams — they are noise. Only teams with three matches or more.',
    at: t(7, 2),
  },
  {
    role: 'assistant',
    content:
      'Filtered to the six teams with three or more matches recorded. The shape holds: France still leads at +3.25 and England is now the worst at −2.15, with Brazil dropping out on the two-match rule.',
    at: t(7, 26),
    visual: { visualId: '', version: 2, title: 'Finishing quality: teams with 3+ matches', action: 'updated' },
  },
];

// ── visuals ─────────────────────────────────────────────────────────────────
const VISUAL_ID = 'a1f3c7e2-5b4d-4d8a-9f61-2c7e18d40b93';

const v1Spec = visualSpecSchema.parse({
  spec: 1,
  kpis: [
    { label: 'Best finisher', select: FINISHING_COLUMNS, column: 'goals_above_expected', agg: 'max' },
    { label: 'Widest shortfall', select: FINISHING_COLUMNS, column: 'goals_above_expected', agg: 'min' },
    { label: 'Goals scored', select: FINISHING_COLUMNS, column: 'goals', agg: 'sum' },
    { label: 'Teams compared', select: FINISHING_COLUMNS, column: 'team', agg: 'count' },
  ],
  chart: {
    form: 'bar',
    select: FINISHING_COLUMNS,
    x: 'team',
    y: 'goals_above_expected',
    sort: { by: 'y', dir: 'desc' },
    labels: true,
    xLabel: 'Team',
    yLabel: 'Goals above expected',
  },
  table: { select: FINISHING_COLUMNS, columns: FINISHING_COLUMNS, collapsed: false },
});

const v2Spec = visualSpecSchema.parse({
  spec: 1,
  kpis: [
    { label: 'Best finisher', select: FINISHING_COLUMNS, column: 'goals_above_expected', agg: 'max' },
    { label: 'Widest shortfall', select: FINISHING_COLUMNS, column: 'goals_above_expected', agg: 'min' },
    { label: 'Matches covered', select: FINISHING_COLUMNS, column: 'matches', agg: 'sum' },
    { label: 'Teams compared', select: FINISHING_COLUMNS, column: 'team', agg: 'count' },
  ],
  chart: {
    form: 'bar',
    select: FINISHING_COLUMNS,
    x: 'team',
    y: 'goals_above_expected',
    sort: { by: 'y', dir: 'desc' },
    labels: true,
    xLabel: 'Team',
    yLabel: 'Goals above expected',
  },
  table: { select: FINISHING_COLUMNS, columns: FINISHING_COLUMNS, collapsed: false },
});

const versions = [
  {
    version: 1,
    createdAt: t(5, 44),
    sourceMessageAt: ANSWER_AT,
    instruction: 'Chart it, and make the teams who under-performed obvious.',
  },
  {
    version: 2,
    createdAt: t(7, 26),
    sourceMessageAt: ANSWER_AT,
    instruction: 'Only teams with three matches or more.',
  },
];

const metadata = {
  id: VISUAL_ID,
  title: 'Finishing quality: teams with 3+ matches',
  description:
    'Goals above expected for every team with three or more recorded matches. France out-finishes its chances by 3.25 goals; England falls 2.15 short.',
  path: `visuals/${VISUAL_ID}`,
  sourceMessageAt: ANSWER_AT,
  createdAt: t(5, 44),
  currentVersion: 2,
  versions,
};

function writeVersion(version, spec, title, description, rows) {
  const dir = path.join(WS, `visuals/${VISUAL_ID}/v${version}`);
  fs.mkdirSync(dir, { recursive: true });
  const data = [
    {
      tool: 'run_readonly_sql',
      input: version === 2 ? `${FINISHING_SQL}\n-- filtered to teams with 3+ recorded matches` : FINISHING_SQL,
      columns: FINISHING_COLUMNS,
      rows,
      rowCount: rows.length,
      rationale: 'Goals scored against expected goals, per team.',
    },
  ];
  const bundle = {
    title,
    description,
    html: SPEC_BODY_HTML,
    css: '',
    javascript: SPEC_BOOTSTRAP_SCRIPT,
    spec,
  };
  const context = {
    question: 'Which teams got the most out of their chances at the World Cup?',
    answer: messages[3].content,
    data,
    chartData: [{ tool: 'run_readonly_sql', input: FINISHING_SQL, columns: FINISHING_COLUMNS, rowCount: rows.length, rows }],
    entities: ENTITIES,
    reasoning: messages[3].reasoning,
    sessionName: session.name,
    version,
    generatedAt: versions[version - 1].createdAt,
  };
  const write = (name, body) => fs.writeFileSync(path.join(dir, name), body);
  write('index.html', storedVisualizationDocument(bundle, context));
  write('body.html', SPEC_BODY_HTML);
  write('styles.css', '');
  write('script.js', SPEC_BOOTSTRAP_SCRIPT);
  write(FRAME_SCRIPT_FILENAME, FRAME_SELECT_SCRIPT);
  write(VISUAL_RUNTIME_FILENAME, VISUAL_RUNTIME_SCRIPT);
  write(SPEC_FILENAME, JSON.stringify(spec, null, 2));
  write('data.json', JSON.stringify(data, null, 2));
  write('description.md', `# ${title}\n\n${description}\n`);
  write(
    'manifest.json',
    JSON.stringify({ ...metadata, version, title, description, renderer: 'spec' }, null, 2),
  );
}

writeVersion(1, v1Spec, 'Finishing quality: goals above expected',
  'Goals above expected for every team in the dataset, over and under the line they created.',
  FINISHING_ROWS);
writeVersion(2, v2Spec, metadata.title, metadata.description, QUALIFIED_ROWS);

// ── persist ─────────────────────────────────────────────────────────────────
messages[5].visual.visualId = VISUAL_ID;
messages[7].visual.visualId = VISUAL_ID;

session.messages = messages;
session.visualizations = [metadata];
session.updatedAt = t(7, 26);
db.prepare('update sessions set doc = ? where rid = ?').run(JSON.stringify(session), row.rid);

// A second, finished session so the list does not look like a first run.
const others = [
  { name: 'Attendance by venue, 2022', at: '2026-09-19T15:40:00.000Z' },
  { name: 'Which squads leaned on their substitutes?', at: '2026-09-17T11:05:00.000Z' },
  { name: 'Discipline: cards per foul by team', at: '2026-09-11T08:22:00.000Z' },
];
for (const o of others) {
  const id = require('crypto').randomUUID();
  db.prepare('insert into sessions (doc) values (?)').run(
    JSON.stringify({
      id,
      name: o.name,
      workspaceId: `session-${id}`,
      datasets: ['World Cup'],
      messages: [],
      visualizations: [],
      createdAt: o.at,
      updatedAt: o.at,
    }),
  );
}

// ── knowledge + metrics ─────────────────────────────────────────────────────
// The two screens that show curated input rather than a conversation. Written
// straight in rather than through the API so one run of this script leaves the
// app in the exact state the page's screenshots were taken from.
const now = new Date().toISOString();
const uuid = () => require('crypto').randomUUID();

const snippets = [
  {
    kind: 'term',
    title: 'Finishing quality',
    body: 'Goals scored minus expected goals over the same matches. Positive means the team out-finished the chances it created. Never use raw goals as a proxy — it rewards the teams that played more matches.',
    synonyms: ['finishing', 'conversion', 'clinical', 'chance quality'],
    entities: [
      'world_cup.world_cup.match_team_statistics',
      'world_cup.world_cup.goals',
    ],
  },
  {
    kind: 'default_filter',
    title: 'Finals-stage matches only',
    body: 'Unless the question names the group stage, restrict to the matches held in the dataset (the knockout rounds) and say in the answer that the filter was applied.',
  },
  {
    kind: 'instruction',
    title: 'Name the sample size when it is small',
    body: 'Any team ranking must state how many matches each team contributed. A team with fewer than three recorded matches is one result, not a trend — flag it rather than letting it top a league table.',
  },
  {
    kind: 'term',
    title: 'Qualified team',
    body: 'A team with three or more matches carrying recorded statistics. Rankings default to qualified teams; include the rest only when asked.',
    synonyms: ['qualified', 'eligible'],
  },
  {
    kind: 'instruction',
    title: 'Aggregate before you return rows',
    body: 'Return grouped results, not raw match rows. If an answer needs more than a few hundred rows to make its point, it is the wrong query.',
  },
];

db.prepare('delete from knowledge_snippets').run();
for (const s of snippets) {
  db.prepare('insert into knowledge_snippets (doc) values (?)').run(
    JSON.stringify({
      id: uuid(),
      scope: null,
      enabled: true,
      source: 'user',
      createdAt: now,
      updatedAt: now,
      ...s,
    }),
  );
}

const datasourceId = JSON.parse(
  db.prepare('select doc from connections limit 1').get()?.doc ?? '{}',
).id;

const metrics = [
  {
    name: 'goals_above_expected',
    label: 'Goals above expected',
    description:
      'Finishing quality: goals scored minus the expected goals the same shots generated. Positive means the team out-finished its chances. Only meaningful over three or more matches.',
    expression: 'COUNT(DISTINCT g.id) - SUM(s.expected_goals)',
    dimensions: ['team', 'tournament_year', 'stage'],
  },
  {
    name: 'shot_accuracy',
    label: 'Shot accuracy',
    description:
      'Share of shots that were on target. Guards against division by zero when a team registered no shots.',
    expression: 'SUM(shots_on_target)::numeric / NULLIF(SUM(shots), 0)',
    dimensions: ['team', 'tournament_year'],
  },
  {
    name: 'pass_completion',
    label: 'Pass completion',
    description:
      'Completed passes as a share of attempted. Reported as a rate, never as a per-match average of rates.',
    expression: 'SUM(passes_completed)::numeric / NULLIF(SUM(passes_attempted), 0)',
    dimensions: ['team', 'stage'],
  },
];

db.prepare('delete from metrics').run();
for (const m of metrics) {
  db.prepare('insert into metrics (doc) values (?)').run(
    JSON.stringify({
      id: uuid(),
      entity: 'world_cup.world_cup.match_team_statistics',
      datasourceId,
      createdAt: now,
      updatedAt: now,
      ...m,
    }),
  );
}

console.log('seeded session', SID, 'visual', VISUAL_ID);
db.close();
