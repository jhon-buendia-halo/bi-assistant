-- World Cup Medallion sample fixture: the 2018 and 2022 World Cups as a
-- three-layer lakehouse, with deliberate gaps for the Consumption Gap Analysis.
--
--   wc_landing      raw text as delivered (Landing)
--   wc_normalized   typed and keyed tables built from Landing (Normalized)
--   wc_consumption  reporting tables built from Normalized (Consumption)
--
-- Known gaps (documented in specs/capabilities/testing-data/spec.md):
--   * wc_consumption.agg_team_tournament holds 2022 rows only (2018 is missing).
--   * possession and shots are in wc_normalized only; no Consumption table has them.
--   * attendance and stadium, and the xg text, live in wc_landing only.
--   * no table or column in any layer covers disciplinary sanctions.
--
-- The rows are generated here from a hash of the match and team, so every load
-- holds exactly the same data. No clock and no unseeded randomness are used.
--
-- Loader rules this file keeps (sql-statements.ts splits it): no dollar
-- quoting, no backslash-escaped quotes, every table qualified with its schema.
-- The loader drops the three schemas before it runs this and wraps it in one
-- transaction, so the temporary helpers below simply end with the session.

DROP SCHEMA IF EXISTS wc_landing CASCADE;
DROP SCHEMA IF EXISTS wc_normalized CASCADE;
DROP SCHEMA IF EXISTS wc_consumption CASCADE;

CREATE SCHEMA wc_landing;
CREATE SCHEMA wc_normalized;
CREATE SCHEMA wc_consumption;

-- ---------------------------------------------------------------------------
-- Landing: raw text as delivered
-- ---------------------------------------------------------------------------

CREATE TABLE wc_landing.raw_matches (
  match_id text,
  tournament text,
  home_team_name text,
  away_team_name text,
  score_str text,
  match_date_str text,
  stage_txt text,
  stadium text,
  attendance_str text
);

CREATE TABLE wc_landing.raw_goals (
  match_id text,
  player_name text,
  team text,
  minute_str text,
  penalty_flag text
);

CREATE TABLE wc_landing.raw_match_stats (
  match_id text,
  team text,
  possession_pct_str text,
  shots integer,
  xg text
);

CREATE TABLE wc_landing.raw_teams (
  team text,
  confed text
);

-- ---------------------------------------------------------------------------
-- Normalized: typed and keyed
-- ---------------------------------------------------------------------------

CREATE TABLE wc_normalized.teams (
  team_id integer PRIMARY KEY,
  team_name text NOT NULL,
  confederation text
);

CREATE TABLE wc_normalized.matches (
  match_id integer PRIMARY KEY,
  tournament_year integer NOT NULL,
  stage text NOT NULL,
  home_team_id integer NOT NULL REFERENCES wc_normalized.teams (team_id),
  away_team_id integer NOT NULL REFERENCES wc_normalized.teams (team_id),
  home_score integer NOT NULL,
  away_score integer NOT NULL,
  match_date date NOT NULL
);

CREATE TABLE wc_normalized.goals (
  goal_id integer PRIMARY KEY,
  match_id integer NOT NULL REFERENCES wc_normalized.matches (match_id),
  player_name text NOT NULL,
  team_id integer NOT NULL REFERENCES wc_normalized.teams (team_id),
  minute integer NOT NULL,
  is_penalty boolean NOT NULL
);

CREATE TABLE wc_normalized.match_team_statistics (
  match_id integer NOT NULL REFERENCES wc_normalized.matches (match_id),
  team_id integer NOT NULL REFERENCES wc_normalized.teams (team_id),
  possession numeric NOT NULL,
  shots integer NOT NULL,
  PRIMARY KEY (match_id, team_id)
);

-- ---------------------------------------------------------------------------
-- Consumption: reporting
-- ---------------------------------------------------------------------------

CREATE TABLE wc_consumption.fct_match_results (
  match_id integer PRIMARY KEY,
  tournament_year integer NOT NULL,
  stage text NOT NULL,
  home_team text NOT NULL,
  away_team text NOT NULL,
  home_score integer NOT NULL,
  away_score integer NOT NULL,
  total_goals integer NOT NULL,
  winner text NOT NULL
);

CREATE TABLE wc_consumption.agg_team_tournament (
  tournament_year integer NOT NULL,
  team text NOT NULL,
  matches_played integer NOT NULL,
  wins integer NOT NULL,
  draws integer NOT NULL,
  losses integer NOT NULL,
  goals_for integer NOT NULL,
  goals_against integer NOT NULL,
  PRIMARY KEY (tournament_year, team)
);

CREATE TABLE wc_consumption.agg_player_goals (
  tournament_year integer NOT NULL,
  player text NOT NULL,
  team text NOT NULL,
  goals integer NOT NULL,
  PRIMARY KEY (tournament_year, player, team)
);

-- ---------------------------------------------------------------------------
-- Generation helpers (temporary: they end with the session)
-- ---------------------------------------------------------------------------

-- Deterministic pseudo-random integer in [0, 2^28) from a text seed.
CREATE FUNCTION pg_temp.h(seed text) RETURNS integer
  LANGUAGE sql IMMUTABLE
  AS 'SELECT (''x'' || substr(md5(seed), 1, 7))::bit(28)::integer';

-- A plausible number of goals for one side of a match.
CREATE FUNCTION pg_temp.goals_for(seed text) RETURNS integer
  LANGUAGE sql IMMUTABLE
  AS 'SELECT CASE WHEN pg_temp.h(seed) % 100 < 28 THEN 0 WHEN pg_temp.h(seed) % 100 < 60 THEN 1 WHEN pg_temp.h(seed) % 100 < 83 THEN 2 WHEN pg_temp.h(seed) % 100 < 94 THEN 3 ELSE 4 END';

-- Sixteen teams with three scorers each.
CREATE TEMP TABLE wc_team_list AS
SELECT * FROM (VALUES
  (0, 'Argentina', 'CONMEBOL', ARRAY['Lionel Messi', 'Julian Alvarez', 'Angel Di Maria']),
  (1, 'France', 'UEFA', ARRAY['Kylian Mbappe', 'Olivier Giroud', 'Antoine Griezmann']),
  (2, 'Brazil', 'CONMEBOL', ARRAY['Neymar', 'Richarlison', 'Philippe Coutinho']),
  (3, 'Croatia', 'UEFA', ARRAY['Luka Modric', 'Ivan Perisic', 'Andrej Kramaric']),
  (4, 'England', 'UEFA', ARRAY['Harry Kane', 'Raheem Sterling', 'Marcus Rashford']),
  (5, 'Belgium', 'UEFA', ARRAY['Romelu Lukaku', 'Eden Hazard', 'Kevin De Bruyne']),
  (6, 'Spain', 'UEFA', ARRAY['Alvaro Morata', 'Pedri', 'Marco Asensio']),
  (7, 'Portugal', 'UEFA', ARRAY['Cristiano Ronaldo', 'Goncalo Ramos', 'Bruno Fernandes']),
  (8, 'Netherlands', 'UEFA', ARRAY['Cody Gakpo', 'Memphis Depay', 'Davy Klaassen']),
  (9, 'Germany', 'UEFA', ARRAY['Thomas Muller', 'Kai Havertz', 'Ilkay Gundogan']),
  (10, 'Uruguay', 'CONMEBOL', ARRAY['Luis Suarez', 'Edinson Cavani', 'Darwin Nunez']),
  (11, 'Mexico', 'CONCACAF', ARRAY['Hirving Lozano', 'Carlos Vela', 'Henry Martin']),
  (12, 'Japan', 'AFC', ARRAY['Takumi Minamino', 'Ritsu Doan', 'Shinji Kagawa']),
  (13, 'Morocco', 'CAF', ARRAY['Youssef En-Nesyri', 'Hakim Ziyech', 'Sofiane Boufal']),
  (14, 'Senegal', 'CAF', ARRAY['Sadio Mane', 'Ismaila Sarr', 'Boulaye Dia']),
  (15, 'United States', 'CONCACAF', ARRAY['Christian Pulisic', 'Timothy Weah', 'Josh Sargent'])
) AS t(ord, name, confed, players);

-- One row per match: four groups of four (24 matches), two semi-finals, the
-- third-place match and the final, in each of the two tournaments (56 in all).
-- The groups are drawn by rotating the team list, so 2018 and 2022 differ.
CREATE TEMP TABLE wc_plan AS
WITH yrs(yr, shift) AS (
  VALUES (2018, 0), (2022, 5)
),
fx(num, stage, hg, hk, ag, ak) AS (
  SELECT g * 6 + p.n, 'Group ' || chr(65 + g), g, p.hk, g, p.ak
  FROM generate_series(0, 3) AS g
  CROSS JOIN (VALUES (1, 0, 1), (2, 2, 3), (3, 0, 2), (4, 1, 3), (5, 0, 3), (6, 1, 2)) AS p(n, hk, ak)
  UNION ALL
  SELECT * FROM (VALUES
    (25, 'Semi-final', 0, 0, 1, 0),
    (26, 'Semi-final', 2, 0, 3, 0),
    (27, 'Third place', 1, 0, 3, 0),
    (28, 'Final', 0, 0, 2, 0)
  ) AS k(num, stage, hg, hk, ag, ak)
),
base AS (
  SELECT yrs.yr,
         (yrs.yr - 2018) / 4 * 100 + fx.num AS match_id,
         fx.num,
         fx.stage,
         (fx.hg * 4 + fx.hk - yrs.shift + 16) % 16 AS home_ord,
         (fx.ag * 4 + fx.ak - yrs.shift + 16) % 16 AS away_ord
  FROM yrs CROSS JOIN fx
),
scored AS (
  SELECT b.*,
         pg_temp.goals_for(b.match_id || '-home') AS hs,
         pg_temp.goals_for(b.match_id || '-away') AS aws
  FROM base AS b
)
SELECT s.yr,
       s.match_id,
       s.num,
       s.stage,
       th.name AS home_name,
       ta.name AS away_name,
       CASE WHEN s.num > 24 AND s.hs = s.aws THEN s.hs + 1 ELSE s.hs END AS home_goals,
       s.aws AS away_goals,
       (CASE WHEN s.yr = 2018 THEN DATE '2018-06-14' ELSE DATE '2022-11-20' END)
         + (CASE WHEN s.num <= 24 THEN (s.num - 1) / 2 WHEN s.num = 25 THEN 22 WHEN s.num = 26 THEN 23 WHEN s.num = 27 THEN 26 ELSE 27 END) AS match_date,
       (CASE WHEN s.yr = 2018
          THEN (ARRAY['Luzhniki Stadium', 'Saint Petersburg Stadium', 'Fisht Stadium', 'Kazan Arena', 'Spartak Stadium', 'Rostov Arena'])[1 + s.num % 6]
          ELSE (ARRAY['Lusail Stadium', 'Al Bayt Stadium', 'Khalifa International Stadium', 'Education City Stadium', 'Stadium 974', 'Al Janoub Stadium'])[1 + s.num % 6]
        END) AS stadium,
       35000 + pg_temp.h(s.match_id || '-att') % 43000 AS attendance,
       (s.yr, s.num) IN ((2018, 7), (2018, 19), (2022, 4), (2022, 13)) AS attendance_missing,
       35 + pg_temp.h(s.match_id || '-poss') % 31 AS home_possession
FROM scored AS s
JOIN wc_team_list AS th ON th.ord = s.home_ord
JOIN wc_team_list AS ta ON ta.ord = s.away_ord;

-- ---------------------------------------------------------------------------
-- Landing rows
-- ---------------------------------------------------------------------------

INSERT INTO wc_landing.raw_teams (team, confed)
SELECT name, confed FROM wc_team_list;

INSERT INTO wc_landing.raw_matches
SELECT match_id::text,
       'World Cup ' || yr,
       home_name,
       away_name,
       home_goals || '-' || away_goals,
       to_char(match_date, 'YYYY-MM-DD'),
       stage,
       stadium,
       CASE WHEN attendance_missing THEN 'N/D' ELSE to_char(attendance, 'FM999,999') END
FROM wc_plan;

INSERT INTO wc_landing.raw_goals
SELECT g.match_id,
       g.players[1 + CASE WHEN g.r % 7 < 3 THEN 0 WHEN g.r % 7 < 5 THEN 1 ELSE 2 END],
       g.team,
       CASE WHEN g.m = 45 THEN '45+' || (1 + g.r % 4)
            WHEN g.m = 90 THEN '90+' || (1 + g.r % 6)
            ELSE g.m::text END,
       CASE WHEN g.r % 100 < 7 THEN 'Y' ELSE 'N' END
FROM (
  SELECT p.match_id::text AS match_id,
         side.team,
         tl.players,
         pg_temp.h(p.match_id || '-' || side.team || '-' || k.i) AS r,
         1 + pg_temp.h(p.match_id || '-' || side.team || '-' || k.i || '-min') % 90 AS m
  FROM wc_plan AS p
  CROSS JOIN LATERAL (VALUES (p.home_name, p.home_goals), (p.away_name, p.away_goals)) AS side(team, n)
  CROSS JOIN LATERAL generate_series(1, side.n) AS k(i)
  JOIN wc_team_list AS tl ON tl.name = side.team
) AS g;

INSERT INTO wc_landing.raw_match_stats
SELECT s.match_id,
       s.team,
       s.possession || '%',
       s.shots,
       CASE WHEN s.yr = 2022
            THEN round((0.2 + s.shots * 0.09 + (pg_temp.h(s.match_id || s.team || '-xg') % 30) / 100.0)::numeric, 2)::text
       END
FROM (
  SELECT p.match_id::text AS match_id,
         p.yr,
         side.team,
         side.possession,
         4 + pg_temp.h(p.match_id || '-' || side.team || '-shots') % 15 AS shots
  FROM wc_plan AS p
  CROSS JOIN LATERAL (VALUES (p.home_name, p.home_possession), (p.away_name, 100 - p.home_possession)) AS side(team, possession)
) AS s;

-- ---------------------------------------------------------------------------
-- Normalized rows: Landing, typed and keyed
-- ---------------------------------------------------------------------------

INSERT INTO wc_normalized.teams (team_id, team_name, confederation)
SELECT row_number() OVER (ORDER BY team)::integer, team, confed
FROM wc_landing.raw_teams;

INSERT INTO wc_normalized.matches
SELECT m.match_id::integer,
       right(m.tournament, 4)::integer,
       initcap(trim(m.stage_txt)),
       ht.team_id,
       at.team_id,
       split_part(m.score_str, '-', 1)::integer,
       split_part(m.score_str, '-', 2)::integer,
       m.match_date_str::date
FROM wc_landing.raw_matches AS m
JOIN wc_normalized.teams AS ht ON ht.team_name = m.home_team_name
JOIN wc_normalized.teams AS at ON at.team_name = m.away_team_name;

INSERT INTO wc_normalized.goals
SELECT row_number() OVER (ORDER BY g.match_id::integer, g.minute, t.team_id, g.player_name)::integer,
       g.match_id::integer,
       g.player_name,
       t.team_id,
       g.minute,
       g.penalty_flag = 'Y'
FROM (
  SELECT match_id, player_name, team, penalty_flag,
         split_part(minute_str, '+', 1)::integer AS minute
  FROM wc_landing.raw_goals
) AS g
JOIN wc_normalized.teams AS t ON t.team_name = g.team;

INSERT INTO wc_normalized.match_team_statistics
SELECT s.match_id::integer,
       t.team_id,
       replace(s.possession_pct_str, '%', '')::numeric,
       s.shots
FROM wc_landing.raw_match_stats AS s
JOIN wc_normalized.teams AS t ON t.team_name = s.team;

-- ---------------------------------------------------------------------------
-- Consumption rows: built from Normalized
-- ---------------------------------------------------------------------------

INSERT INTO wc_consumption.fct_match_results
SELECT m.match_id,
       m.tournament_year,
       m.stage,
       ht.team_name,
       at.team_name,
       m.home_score,
       m.away_score,
       m.home_score + m.away_score,
       CASE WHEN m.home_score > m.away_score THEN ht.team_name
            WHEN m.home_score < m.away_score THEN at.team_name
            ELSE 'Draw' END
FROM wc_normalized.matches AS m
JOIN wc_normalized.teams AS ht ON ht.team_id = m.home_team_id
JOIN wc_normalized.teams AS at ON at.team_id = m.away_team_id;

-- The coverage gap: only the 2022 tournament is aggregated.
INSERT INTO wc_consumption.agg_team_tournament
SELECT per.tournament_year,
       per.team,
       count(*),
       count(*) FILTER (WHERE per.gf > per.ga),
       count(*) FILTER (WHERE per.gf = per.ga),
       count(*) FILTER (WHERE per.gf < per.ga),
       sum(per.gf),
       sum(per.ga)
FROM (
  SELECT tournament_year, home_team AS team, home_score AS gf, away_score AS ga
  FROM wc_consumption.fct_match_results
  UNION ALL
  SELECT tournament_year, away_team, away_score, home_score
  FROM wc_consumption.fct_match_results
) AS per
WHERE per.tournament_year = 2022
GROUP BY per.tournament_year, per.team;

INSERT INTO wc_consumption.agg_player_goals
SELECT m.tournament_year,
       g.player_name,
       t.team_name,
       count(*)
FROM wc_normalized.goals AS g
JOIN wc_normalized.matches AS m ON m.match_id = g.match_id
JOIN wc_normalized.teams AS t ON t.team_id = g.team_id
GROUP BY m.tournament_year, g.player_name, t.team_name;

DROP TABLE wc_plan;
DROP TABLE wc_team_list;
