#!/usr/bin/env node
/**
 * Builds the files of the `world-cup-excel` sample (roadmap 1.31.7) from the
 * World Cup seed SQL next to it (`../001_world_cup.sql`):
 *
 *   world_cup.xlsx  sheets Matches, Teams, Goals
 *     - Matches: a title row and a blank row above the header (header on row 3)
 *     - Goals:   a trailing `Total` row, which the import excludes
 *   players.csv     one row per player
 *
 * The seed is Postgres SQL, so it is read as text and its tables are
 * rebuilt in a throwaway in-memory DuckDB (types only: constraints, indexes
 * and views are dropped; identity columns become sequences). No Postgres is
 * needed. The data is the seed's own (a few dozen matches), so the files
 * stay well under 100 KB together and nothing is trimmed.
 *
 *   cd backend && node src/modules/testing-data/fixtures/world-cup-excel/build.cjs
 *
 * The output is deterministic apart from the workbook's creation timestamp.
 * Regenerate and commit the files whenever the seed changes; never edit them
 * by hand. `build.spec.ts` checks the files against the seed.
 */
const { readFileSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');
const { DuckDBInstance } = require('@duckdb/node-api');
const { Workbook } = require('exceljs');

const HERE = __dirname;
const SEED = join(HERE, '..', '001_world_cup.sql');
const TITLE = 'FIFA World Cup 2018 and 2022 — match results';

/** The seed as DuckDB can read it: tables and rows only. */
function toDuckDb(sql) {
  const sequences = [];
  const out = sql
    .replace(/^(BEGIN|COMMIT);$/gm, '')
    .replace(/^SET search_path.*$/m, "SET schema='world_cup';")
    .replace(/^CREATE INDEX.*$/gm, '')
    .replace(/CREATE VIEW[\s\S]*$/m, '')
    .replace(/CREATE TABLE (\w+) \(([\s\S]*?)\n\);/g, (_m, table, body) => {
      const columns = [];
      for (const line of body.split('\n')) {
        const m = /^ {2}(\w+) (\w+(?:\(\d+(?:,\d+)?\))?)(.*)$/.exec(line);
        if (!m) continue;
        const [, name, type, rest] = m;
        if (/^(PRIMARY|UNIQUE|CHECK|CONSTRAINT|FOREIGN)$/i.test(name)) continue;
        if (/GENERATED ALWAYS AS IDENTITY/i.test(rest)) {
          sequences.push(`CREATE SEQUENCE ${table}_seq;`);
          columns.push(`${name} ${type} DEFAULT nextval('${table}_seq')`);
        } else {
          columns.push(`${name} ${type}`);
        }
      }
      return `CREATE TABLE ${table} (${columns.join(', ')});`;
    });
  return out.replace(
    "SET schema='world_cup';",
    `SET schema='world_cup';\n${sequences.join('\n')}`,
  );
}

const MATCHES_SQL = `
  SELECT m.id::INTEGER AS match_id,
         t.tournament_year::INTEGER AS tournament_year,
         m.match_number::INTEGER AS match_number,
         m.stage AS stage,
         m.group_letter AS group_letter,
         strftime(CAST(m.kicked_off_at AS DATE), '%Y-%m-%d') AS match_date,
         v.name AS stadium,
         v.city AS city,
         h.common_name AS home_team,
         a.common_name AS away_team,
         m.home_goals::INTEGER AS home_goals,
         m.away_goals::INTEGER AS away_goals,
         m.went_to_extra_time AS went_to_extra_time,
         m.home_penalties::INTEGER AS home_penalties,
         m.away_penalties::INTEGER AS away_penalties,
         w.common_name AS winner,
         m.attendance::INTEGER AS attendance
  FROM matches m
  JOIN tournaments t ON t.id = m.tournament_id
  JOIN venues v ON v.id = m.venue_id
  JOIN teams h ON h.id = m.home_team_id
  JOIN teams a ON a.id = m.away_team_id
  LEFT JOIN teams w ON w.id = m.winner_team_id
  ORDER BY t.tournament_year, m.match_number`;

const TEAMS_SQL = `
  SELECT te.id::INTEGER AS team_id,
         te.common_name AS team,
         te.fifa_code AS fifa_code,
         c.confederation_code AS confederation
  FROM teams te
  JOIN countries c ON c.code = te.country_code
  ORDER BY te.common_name`;

// The scoring team comes first: the `Total` label sits in the first column,
// and the import reads a numeric column as numbers, so that column is text.
const GOALS_SQL = `
  SELECT st.common_name AS scoring_team,
         sp.full_name AS scorer,
         ap.full_name AS assist,
         g.goal_type AS goal_type,
         g.minute::INTEGER AS minute,
         g.stoppage_minute::INTEGER AS stoppage_minute,
         g.id::INTEGER AS goal_id,
         g.match_id::INTEGER AS match_id,
         t.tournament_year::INTEGER AS tournament_year
  FROM goals g
  JOIN matches m ON m.id = g.match_id
  JOIN tournaments t ON t.id = m.tournament_id
  JOIN teams st ON st.id = g.scoring_team_id
  LEFT JOIN players sp ON sp.id = g.scorer_player_id
  LEFT JOIN players ap ON ap.id = g.assist_player_id
  ORDER BY g.id`;

const PLAYERS_SQL = `
  SELECT p.id::INTEGER AS player_id,
         te.common_name AS team,
         p.full_name AS full_name,
         p.position AS position,
         strftime(p.date_of_birth, '%Y-%m-%d') AS date_of_birth
  FROM players p
  JOIN teams te ON te.id = p.national_team_id
  ORDER BY p.id`;

async function rowsOf(connection, sql) {
  const reader = await connection.runAndReadAll(sql);
  return { columns: reader.columnNames(), rows: reader.getRowObjectsJson() };
}

const DATE_COLUMNS = new Set(['match_date', 'date_of_birth']);

function cell(column, value) {
  if (value === null || value === undefined) return null;
  if (DATE_COLUMNS.has(column)) return new Date(`${value}T00:00:00Z`);
  return value;
}

function addSheet(workbook, name, data, { titleRows = 0, total } = {}) {
  const sheet = workbook.addWorksheet(name);
  const header = titleRows + 1;
  if (titleRows) sheet.getCell('A1').value = TITLE;
  sheet.getRow(header).values = data.columns;
  sheet.getRow(header).font = { bold: true };
  data.rows.forEach((row, i) => {
    sheet.getRow(header + 1 + i).values = data.columns.map((c) =>
      cell(c, row[c]),
    );
  });
  data.columns.forEach((c, i) => {
    if (DATE_COLUMNS.has(c)) sheet.getColumn(i + 1).numFmt = 'yyyy-mm-dd';
    sheet.getColumn(i + 1).width = Math.max(12, c.length + 2);
  });
  if (total) {
    const last = header + data.rows.length + 1;
    sheet.getCell(last, 1).value = 'Total';
    sheet.getCell(last, data.columns.indexOf(total.column) + 1).value =
      total.value;
  }
}

function csvEscape(value) {
  const text = value === null || value === undefined ? '' : String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

async function main() {
  const instance = await DuckDBInstance.create(':memory:');
  const connection = await instance.connect();
  await connection.run(toDuckDb(readFileSync(SEED, 'utf8')));

  const matches = await rowsOf(connection, MATCHES_SQL);
  const teams = await rowsOf(connection, TEAMS_SQL);
  const goals = await rowsOf(connection, GOALS_SQL);
  const players = await rowsOf(connection, PLAYERS_SQL);

  const workbook = new Workbook();
  workbook.created = new Date('2026-01-01T00:00:00Z');
  workbook.modified = workbook.created;
  addSheet(workbook, 'Matches', matches, { titleRows: 2 });
  addSheet(workbook, 'Teams', teams);
  addSheet(workbook, 'Goals', goals, {
    total: {
      column: 'stoppage_minute',
      value: goals.rows.reduce((sum, r) => sum + Number(r.stoppage_minute), 0),
    },
  });
  await workbook.xlsx.writeFile(join(HERE, 'world_cup.xlsx'));

  const csv = [
    players.columns.join(','),
    ...players.rows.map((r) =>
      players.columns.map((c) => csvEscape(r[c])).join(','),
    ),
  ].join('\n');
  writeFileSync(join(HERE, 'players.csv'), `${csv}\n`);

  console.log(
    `world_cup.xlsx: Matches ${matches.rows.length}, Teams ${teams.rows.length}, ` +
      `Goals ${goals.rows.length} rows; players.csv: ${players.rows.length} rows`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
