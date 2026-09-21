-- World Cup sample fixture.
--
-- KEEP IN SYNC with docker/postgres/init/001_world_cup.sql at the repo root.
-- That copy is what Docker runs on first boot of the compose container; this
-- copy is shipped inside the backend bundle (see the `assets` entry in
-- nest-cli.json) and is what TestingDataService executes when the Testing Data
-- panel seeds a user-supplied PostgreSQL database. Edit both or neither.

BEGIN;

CREATE SCHEMA world_cup;
SET search_path TO world_cup, public;

CREATE TABLE confederations (
  code text PRIMARY KEY,
  name text NOT NULL UNIQUE
);

CREATE TABLE countries (
  code char(3) PRIMARY KEY,
  name text NOT NULL UNIQUE,
  confederation_code text NOT NULL REFERENCES confederations(code)
);

CREATE TABLE teams (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  country_code char(3) NOT NULL UNIQUE REFERENCES countries(code),
  common_name text NOT NULL UNIQUE,
  fifa_code char(3) NOT NULL UNIQUE
);

CREATE TABLE tournaments (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name text NOT NULL,
  tournament_year integer NOT NULL UNIQUE CHECK (tournament_year BETWEEN 1930 AND 2100),
  host_country_code char(3) NOT NULL REFERENCES countries(code),
  starts_on date NOT NULL,
  ends_on date NOT NULL,
  champion_team_id bigint REFERENCES teams(id),
  runner_up_team_id bigint REFERENCES teams(id),
  CHECK (starts_on <= ends_on),
  CHECK (champion_team_id IS NULL OR champion_team_id <> runner_up_team_id)
);

CREATE TABLE tournament_teams (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tournament_id bigint NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  team_id bigint NOT NULL REFERENCES teams(id),
  group_letter char(1),
  final_rank integer CHECK (final_rank > 0),
  qualified_for_knockout boolean NOT NULL DEFAULT false,
  UNIQUE (tournament_id, team_id)
);

CREATE TABLE venues (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tournament_id bigint NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  name text NOT NULL,
  city text NOT NULL,
  capacity integer CHECK (capacity > 0),
  UNIQUE (tournament_id, name)
);

CREATE TABLE players (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  national_team_id bigint NOT NULL REFERENCES teams(id),
  full_name text NOT NULL,
  position text NOT NULL CHECK (position IN ('GK', 'DF', 'MF', 'FW')),
  date_of_birth date,
  UNIQUE (national_team_id, full_name)
);

CREATE TABLE squad_members (
  tournament_team_id bigint NOT NULL REFERENCES tournament_teams(id) ON DELETE CASCADE,
  player_id bigint NOT NULL REFERENCES players(id),
  shirt_number integer NOT NULL CHECK (shirt_number BETWEEN 1 AND 99),
  squad_position text NOT NULL CHECK (squad_position IN ('GK', 'DF', 'MF', 'FW')),
  PRIMARY KEY (tournament_team_id, player_id),
  UNIQUE (tournament_team_id, shirt_number)
);

CREATE TABLE matches (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tournament_id bigint NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  match_number integer NOT NULL CHECK (match_number > 0),
  stage text NOT NULL CHECK (stage IN ('group', 'round_of_16', 'quarter_final', 'semi_final', 'third_place', 'final')),
  group_letter char(1),
  kicked_off_at timestamptz NOT NULL,
  venue_id bigint NOT NULL REFERENCES venues(id),
  home_team_id bigint NOT NULL REFERENCES teams(id),
  away_team_id bigint NOT NULL REFERENCES teams(id),
  home_goals integer NOT NULL CHECK (home_goals >= 0),
  away_goals integer NOT NULL CHECK (away_goals >= 0),
  went_to_extra_time boolean NOT NULL DEFAULT false,
  home_penalties integer CHECK (home_penalties >= 0),
  away_penalties integer CHECK (away_penalties >= 0),
  winner_team_id bigint REFERENCES teams(id),
  attendance integer CHECK (attendance >= 0),
  UNIQUE (tournament_id, match_number),
  CHECK (home_team_id <> away_team_id),
  CHECK ((home_penalties IS NULL) = (away_penalties IS NULL)),
  CHECK (winner_team_id IS NULL OR winner_team_id IN (home_team_id, away_team_id))
);

CREATE TABLE match_team_statistics (
  match_id bigint NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  team_id bigint NOT NULL REFERENCES teams(id),
  possession_pct numeric(5,2) NOT NULL CHECK (possession_pct BETWEEN 0 AND 100),
  shots integer NOT NULL CHECK (shots >= 0),
  shots_on_target integer NOT NULL CHECK (shots_on_target BETWEEN 0 AND shots),
  corners integer NOT NULL CHECK (corners >= 0),
  fouls_committed integer NOT NULL CHECK (fouls_committed >= 0),
  offsides integer NOT NULL CHECK (offsides >= 0),
  passes_completed integer NOT NULL CHECK (passes_completed >= 0),
  passes_attempted integer NOT NULL CHECK (passes_attempted >= passes_completed),
  expected_goals numeric(5,2) NOT NULL CHECK (expected_goals >= 0),
  PRIMARY KEY (match_id, team_id)
);

CREATE TABLE goals (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  match_id bigint NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  scoring_team_id bigint NOT NULL REFERENCES teams(id),
  scorer_player_id bigint REFERENCES players(id),
  assist_player_id bigint REFERENCES players(id),
  minute integer NOT NULL CHECK (minute BETWEEN 1 AND 120),
  stoppage_minute integer NOT NULL DEFAULT 0 CHECK (stoppage_minute BETWEEN 0 AND 20),
  goal_type text NOT NULL DEFAULT 'open_play' CHECK (goal_type IN ('open_play', 'penalty', 'free_kick', 'own_goal', 'header')),
  home_score_after integer NOT NULL CHECK (home_score_after >= 0),
  away_score_after integer NOT NULL CHECK (away_score_after >= 0),
  CHECK (scorer_player_id IS NULL OR scorer_player_id <> assist_player_id)
);

CREATE TABLE disciplinary_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  match_id bigint NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  team_id bigint NOT NULL REFERENCES teams(id),
  player_id bigint REFERENCES players(id),
  minute integer NOT NULL CHECK (minute BETWEEN 1 AND 120),
  stoppage_minute integer NOT NULL DEFAULT 0 CHECK (stoppage_minute BETWEEN 0 AND 20),
  card_type text NOT NULL CHECK (card_type IN ('yellow', 'second_yellow', 'red')),
  reason text
);

CREATE INDEX matches_tournament_stage_idx ON matches (tournament_id, stage);
CREATE INDEX matches_team_idx ON matches (home_team_id, away_team_id);
CREATE INDEX goals_match_idx ON goals (match_id, minute, stoppage_minute);
CREATE INDEX goals_scorer_idx ON goals (scorer_player_id);
CREATE INDEX cards_player_idx ON disciplinary_events (player_id);

INSERT INTO confederations (code, name) VALUES
  ('AFC', 'Asian Football Confederation'),
  ('CAF', 'Confederation of African Football'),
  ('CONCACAF', 'Confederation of North, Central America and Caribbean Association Football'),
  ('CONMEBOL', 'South American Football Confederation'),
  ('UEFA', 'Union of European Football Associations');

INSERT INTO countries (code, name, confederation_code) VALUES
  ('ARG', 'Argentina', 'CONMEBOL'),
  ('BEL', 'Belgium', 'UEFA'),
  ('BRA', 'Brazil', 'CONMEBOL'),
  ('CRO', 'Croatia', 'UEFA'),
  ('ENG', 'England', 'UEFA'),
  ('FRA', 'France', 'UEFA'),
  ('MAR', 'Morocco', 'CAF'),
  ('NED', 'Netherlands', 'UEFA'),
  ('POR', 'Portugal', 'UEFA'),
  ('QAT', 'Qatar', 'AFC'),
  ('RUS', 'Russia', 'UEFA'),
  ('SWE', 'Sweden', 'UEFA'),
  ('URU', 'Uruguay', 'CONMEBOL');

INSERT INTO teams (country_code, common_name, fifa_code)
SELECT code, name, code FROM countries WHERE code <> 'QAT';

INSERT INTO tournaments (
  name, tournament_year, host_country_code, starts_on, ends_on,
  champion_team_id, runner_up_team_id
) VALUES
  (
    '2018 FIFA World Cup', 2018, 'RUS', DATE '2018-06-14', DATE '2018-07-15',
    (SELECT id FROM teams WHERE fifa_code = 'FRA'),
    (SELECT id FROM teams WHERE fifa_code = 'CRO')
  ),
  (
    '2022 FIFA World Cup', 2022, 'QAT', DATE '2022-11-20', DATE '2022-12-18',
    (SELECT id FROM teams WHERE fifa_code = 'ARG'),
    (SELECT id FROM teams WHERE fifa_code = 'FRA')
  );

WITH seed(tournament_year, team_code, group_letter, final_rank) AS (
  VALUES
    (2018, 'URU', 'A', 5), (2018, 'FRA', 'C', 1),
    (2018, 'BRA', 'E', 6), (2018, 'BEL', 'G', 3),
    (2018, 'SWE', 'F', 7), (2018, 'ENG', 'G', 4),
    (2018, 'RUS', 'A', 8), (2018, 'CRO', 'D', 2),
    (2022, 'NED', 'A', 5), (2022, 'ARG', 'C', 1),
    (2022, 'CRO', 'F', 3), (2022, 'BRA', 'G', 7),
    (2022, 'ENG', 'B', 6), (2022, 'FRA', 'D', 2),
    (2022, 'MAR', 'F', 4), (2022, 'POR', 'H', 8)
)
INSERT INTO tournament_teams (
  tournament_id, team_id, group_letter, final_rank, qualified_for_knockout
)
SELECT tournament.id, team.id, seed.group_letter, seed.final_rank, true
FROM seed
JOIN tournaments tournament USING (tournament_year)
JOIN teams team ON team.fifa_code = seed.team_code;

WITH seed(tournament_year, name, city, capacity) AS (
  VALUES
    (2018, 'Luzhniki Stadium', 'Moscow', 78011),
    (2018, 'Saint Petersburg Stadium', 'Saint Petersburg', 64468),
    (2018, 'Fisht Stadium', 'Sochi', 44287),
    (2018, 'Nizhny Novgorod Stadium', 'Nizhny Novgorod', 43319),
    (2022, 'Lusail Stadium', 'Lusail', 88966),
    (2022, 'Al Bayt Stadium', 'Al Khor', 68895),
    (2022, 'Education City Stadium', 'Al Rayyan', 44667),
    (2022, 'Al Thumama Stadium', 'Doha', 44400),
    (2022, 'Khalifa International Stadium', 'Al Rayyan', 45857)
)
INSERT INTO venues (tournament_id, name, city, capacity)
SELECT tournament.id, seed.name, seed.city, seed.capacity
FROM seed JOIN tournaments tournament USING (tournament_year);

WITH seed(team_code, full_name, position, date_of_birth) AS (
  VALUES
    ('ARG', 'Emiliano Martinez', 'GK', DATE '1992-09-02'),
    ('ARG', 'Nahuel Molina', 'DF', DATE '1998-04-06'),
    ('ARG', 'Lionel Messi', 'FW', DATE '1987-06-24'),
    ('ARG', 'Julian Alvarez', 'FW', DATE '2000-01-31'),
    ('ARG', 'Angel Di Maria', 'MF', DATE '1988-02-14'),
    ('BEL', 'Thibaut Courtois', 'GK', DATE '1992-05-11'),
    ('BEL', 'Kevin De Bruyne', 'MF', DATE '1991-06-28'),
    ('BEL', 'Eden Hazard', 'FW', DATE '1991-01-07'),
    ('BEL', 'Thomas Meunier', 'DF', DATE '1991-09-12'),
    ('BRA', 'Alisson Becker', 'GK', DATE '1992-10-02'),
    ('BRA', 'Fernandinho', 'MF', DATE '1985-05-04'),
    ('BRA', 'Neymar', 'FW', DATE '1992-02-05'),
    ('BRA', 'Renato Augusto', 'MF', DATE '1988-02-08'),
    ('CRO', 'Danijel Subasic', 'GK', DATE '1984-10-27'),
    ('CRO', 'Dominik Livakovic', 'GK', DATE '1995-01-09'),
    ('CRO', 'Luka Modric', 'MF', DATE '1985-09-09'),
    ('CRO', 'Andrej Kramaric', 'FW', DATE '1991-06-19'),
    ('CRO', 'Domagoj Vida', 'DF', DATE '1989-04-29'),
    ('CRO', 'Ivan Perisic', 'MF', DATE '1989-02-02'),
    ('CRO', 'Mario Mandzukic', 'FW', DATE '1986-05-21'),
    ('CRO', 'Bruno Petkovic', 'FW', DATE '1994-09-16'),
    ('CRO', 'Josko Gvardiol', 'DF', DATE '2002-01-23'),
    ('CRO', 'Mislav Orsic', 'FW', DATE '1992-12-29'),
    ('ENG', 'Jordan Pickford', 'GK', DATE '1994-03-07'),
    ('ENG', 'Harry Maguire', 'DF', DATE '1993-03-05'),
    ('ENG', 'Dele Alli', 'MF', DATE '1996-04-11'),
    ('ENG', 'Kieran Trippier', 'DF', DATE '1990-09-19'),
    ('ENG', 'Harry Kane', 'FW', DATE '1993-07-28'),
    ('FRA', 'Hugo Lloris', 'GK', DATE '1986-12-26'),
    ('FRA', 'Raphael Varane', 'DF', DATE '1993-04-25'),
    ('FRA', 'Samuel Umtiti', 'DF', DATE '1993-11-14'),
    ('FRA', 'Antoine Griezmann', 'FW', DATE '1991-03-21'),
    ('FRA', 'Paul Pogba', 'MF', DATE '1993-03-15'),
    ('FRA', 'Kylian Mbappe', 'FW', DATE '1998-12-20'),
    ('FRA', 'Aurelien Tchouameni', 'MF', DATE '2000-01-27'),
    ('FRA', 'Olivier Giroud', 'FW', DATE '1986-09-30'),
    ('FRA', 'Theo Hernandez', 'DF', DATE '1997-10-06'),
    ('FRA', 'Randal Kolo Muani', 'FW', DATE '1998-12-05'),
    ('MAR', 'Yassine Bounou', 'GK', DATE '1991-04-05'),
    ('MAR', 'Youssef En-Nesyri', 'FW', DATE '1997-06-01'),
    ('MAR', 'Achraf Dari', 'DF', DATE '1999-05-06'),
    ('NED', 'Andries Noppert', 'GK', DATE '1994-04-07'),
    ('NED', 'Wout Weghorst', 'FW', DATE '1992-08-07'),
    ('POR', 'Diogo Costa', 'GK', DATE '1999-09-19'),
    ('POR', 'Cristiano Ronaldo', 'FW', DATE '1985-02-05'),
    ('RUS', 'Igor Akinfeev', 'GK', DATE '1986-04-08'),
    ('RUS', 'Denis Cheryshev', 'MF', DATE '1990-12-26'),
    ('RUS', 'Mario Fernandes', 'DF', DATE '1990-09-19'),
    ('SWE', 'Robin Olsen', 'GK', DATE '1990-01-08'),
    ('URU', 'Fernando Muslera', 'GK', DATE '1986-06-16')
)
INSERT INTO players (national_team_id, full_name, position, date_of_birth)
SELECT team.id, seed.full_name, seed.position, seed.date_of_birth
FROM seed JOIN teams team ON team.fifa_code = seed.team_code;

WITH ranked AS (
  SELECT
    tournament_team.id AS tournament_team_id,
    player.id AS player_id,
    player.position,
    row_number() OVER (
      PARTITION BY tournament_team.id
      ORDER BY CASE player.position WHEN 'GK' THEN 1 WHEN 'DF' THEN 2 WHEN 'MF' THEN 3 ELSE 4 END,
               player.full_name
    ) AS shirt_number
  FROM tournament_teams tournament_team
  JOIN players player ON player.national_team_id = tournament_team.team_id
)
INSERT INTO squad_members (tournament_team_id, player_id, shirt_number, squad_position)
SELECT tournament_team_id, player_id, shirt_number, position FROM ranked;

WITH seed(
  tournament_year, match_number, stage, kicked_off_at, venue_name,
  home_code, away_code, home_goals, away_goals, extra_time,
  home_penalties, away_penalties, winner_code, attendance
) AS (
  VALUES
    (2018, 57, 'quarter_final', TIMESTAMPTZ '2018-07-06 17:00:00+03', 'Nizhny Novgorod Stadium', 'URU', 'FRA', 0, 2, false, NULL, NULL, 'FRA', 43319),
    (2018, 58, 'quarter_final', TIMESTAMPTZ '2018-07-06 21:00:00+03', 'Saint Petersburg Stadium', 'BRA', 'BEL', 1, 2, false, NULL, NULL, 'BEL', 64406),
    (2018, 59, 'quarter_final', TIMESTAMPTZ '2018-07-07 18:00:00+03', 'Fisht Stadium', 'SWE', 'ENG', 0, 2, false, NULL, NULL, 'ENG', 39991),
    (2018, 60, 'quarter_final', TIMESTAMPTZ '2018-07-07 21:00:00+03', 'Fisht Stadium', 'RUS', 'CRO', 2, 2, true, 3, 4, 'CRO', 44287),
    (2018, 61, 'semi_final', TIMESTAMPTZ '2018-07-10 21:00:00+03', 'Saint Petersburg Stadium', 'FRA', 'BEL', 1, 0, false, NULL, NULL, 'FRA', 64286),
    (2018, 62, 'semi_final', TIMESTAMPTZ '2018-07-11 21:00:00+03', 'Luzhniki Stadium', 'CRO', 'ENG', 2, 1, true, NULL, NULL, 'CRO', 78011),
    (2018, 63, 'third_place', TIMESTAMPTZ '2018-07-14 17:00:00+03', 'Saint Petersburg Stadium', 'BEL', 'ENG', 2, 0, false, NULL, NULL, 'BEL', 64406),
    (2018, 64, 'final', TIMESTAMPTZ '2018-07-15 18:00:00+03', 'Luzhniki Stadium', 'FRA', 'CRO', 4, 2, false, NULL, NULL, 'FRA', 78011),
    (2022, 57, 'quarter_final', TIMESTAMPTZ '2022-12-09 18:00:00+03', 'Education City Stadium', 'CRO', 'BRA', 1, 1, true, 4, 2, 'CRO', 43893),
    (2022, 58, 'quarter_final', TIMESTAMPTZ '2022-12-09 22:00:00+03', 'Lusail Stadium', 'NED', 'ARG', 2, 2, true, 3, 4, 'ARG', 88235),
    (2022, 59, 'quarter_final', TIMESTAMPTZ '2022-12-10 18:00:00+03', 'Al Thumama Stadium', 'MAR', 'POR', 1, 0, false, NULL, NULL, 'MAR', 44198),
    (2022, 60, 'quarter_final', TIMESTAMPTZ '2022-12-10 22:00:00+03', 'Al Bayt Stadium', 'ENG', 'FRA', 1, 2, false, NULL, NULL, 'FRA', 68895),
    (2022, 61, 'semi_final', TIMESTAMPTZ '2022-12-13 22:00:00+03', 'Lusail Stadium', 'ARG', 'CRO', 3, 0, false, NULL, NULL, 'ARG', 88966),
    (2022, 62, 'semi_final', TIMESTAMPTZ '2022-12-14 22:00:00+03', 'Al Bayt Stadium', 'FRA', 'MAR', 2, 0, false, NULL, NULL, 'FRA', 68294),
    (2022, 63, 'third_place', TIMESTAMPTZ '2022-12-17 18:00:00+03', 'Khalifa International Stadium', 'CRO', 'MAR', 2, 1, false, NULL, NULL, 'CRO', 44137),
    (2022, 64, 'final', TIMESTAMPTZ '2022-12-18 18:00:00+03', 'Lusail Stadium', 'ARG', 'FRA', 3, 3, true, 4, 2, 'ARG', 88966)
)
INSERT INTO matches (
  tournament_id, match_number, stage, kicked_off_at, venue_id,
  home_team_id, away_team_id, home_goals, away_goals, went_to_extra_time,
  home_penalties, away_penalties, winner_team_id, attendance
)
SELECT
  tournament.id, seed.match_number, seed.stage, seed.kicked_off_at, venue.id,
  home_team.id, away_team.id, seed.home_goals, seed.away_goals, seed.extra_time,
  seed.home_penalties, seed.away_penalties, winner.id, seed.attendance
FROM seed
JOIN tournaments tournament USING (tournament_year)
JOIN venues venue ON venue.tournament_id = tournament.id AND venue.name = seed.venue_name
JOIN teams home_team ON home_team.fifa_code = seed.home_code
JOIN teams away_team ON away_team.fifa_code = seed.away_code
JOIN teams winner ON winner.fifa_code = seed.winner_code;

WITH seed(
  tournament_year, match_number, home_possession, home_shots, home_on_target,
  home_corners, home_fouls, home_offsides, home_completed, home_attempted, home_xg,
  away_shots, away_on_target, away_corners, away_fouls, away_offsides,
  away_completed, away_attempted, away_xg
) AS (
  VALUES
    (2018, 57, 39.0, 11, 4, 4, 17, 0, 296, 386, 0.75, 11, 2, 3, 15, 0, 524, 617, 1.35),
    (2018, 58, 57.0, 26, 9, 8, 14, 1, 493, 559, 2.20, 8, 3, 4, 16, 0, 354, 422, 1.25),
    (2018, 59, 43.0, 7, 3, 1, 10, 2, 377, 466, 0.80, 12, 2, 6, 7, 1, 526, 603, 1.65),
    (2018, 60, 36.0, 13, 7, 6, 25, 1, 319, 427, 1.25, 17, 3, 8, 18, 0, 653, 746, 1.70),
    (2018, 61, 40.0, 19, 5, 4, 6, 1, 341, 403, 1.45, 9, 3, 5, 16, 1, 594, 651, 0.95),
    (2018, 62, 54.0, 22, 7, 8, 23, 1, 542, 638, 2.10, 11, 2, 4, 14, 3, 440, 526, 1.15),
    (2018, 63, 43.0, 12, 4, 4, 11, 1, 408, 493, 1.55, 15, 5, 5, 5, 0, 576, 653, 1.30),
    (2018, 64, 34.0, 8, 6, 2, 14, 1, 272, 377, 2.15, 15, 3, 6, 13, 1, 635, 724, 1.85),
    (2022, 57, 51.0, 9, 1, 3, 22, 3, 597, 685, 0.95, 21, 11, 7, 24, 3, 589, 684, 2.25),
    (2022, 58, 48.0, 6, 2, 2, 30, 1, 501, 612, 0.80, 15, 6, 8, 18, 2, 548, 659, 1.95),
    (2022, 59, 27.0, 9, 3, 3, 15, 2, 180, 271, 0.85, 12, 3, 9, 9, 2, 605, 706, 1.15),
    (2022, 60, 58.0, 16, 8, 5, 10, 1, 463, 526, 2.05, 8, 5, 2, 14, 2, 321, 391, 1.30),
    (2022, 61, 39.0, 9, 7, 2, 15, 1, 344, 408, 2.35, 12, 2, 4, 8, 0, 597, 670, 0.55),
    (2022, 62, 38.0, 14, 3, 2, 11, 4, 313, 389, 1.75, 13, 3, 3, 11, 3, 568, 634, 1.10),
    (2022, 63, 49.0, 12, 4, 6, 13, 2, 436, 508, 1.40, 9, 2, 3, 11, 0, 455, 529, 0.95),
    (2022, 64, 46.0, 21, 10, 6, 26, 4, 524, 648, 3.10, 10, 5, 5, 19, 4, 642, 733, 2.75)
), resolved AS (
  SELECT seed.*, match.id AS match_id, match.home_team_id, match.away_team_id
  FROM seed
  JOIN tournaments tournament USING (tournament_year)
  JOIN matches match ON match.tournament_id = tournament.id AND match.match_number = seed.match_number
)
INSERT INTO match_team_statistics (
  match_id, team_id, possession_pct, shots, shots_on_target, corners,
  fouls_committed, offsides, passes_completed, passes_attempted, expected_goals
)
SELECT match_id, home_team_id, home_possession, home_shots, home_on_target,
       home_corners, home_fouls, home_offsides, home_completed, home_attempted, home_xg
FROM resolved
UNION ALL
SELECT match_id, away_team_id, 100 - home_possession, away_shots, away_on_target,
       away_corners, away_fouls, away_offsides, away_completed, away_attempted, away_xg
FROM resolved;

WITH seed(
  tournament_year, match_number, scoring_code, scorer_name, assist_name,
  minute, stoppage, goal_type, home_after, away_after
) AS (
  VALUES
    (2018, 57, 'FRA', 'Raphael Varane', NULL, 40, 0, 'header', 0, 1),
    (2018, 57, 'FRA', 'Antoine Griezmann', NULL, 61, 0, 'open_play', 0, 2),
    (2018, 58, 'BEL', 'Fernandinho', NULL, 13, 0, 'own_goal', 0, 1),
    (2018, 58, 'BEL', 'Kevin De Bruyne', NULL, 31, 0, 'open_play', 0, 2),
    (2018, 58, 'BRA', 'Renato Augusto', NULL, 76, 0, 'header', 1, 2),
    (2018, 59, 'ENG', 'Harry Maguire', NULL, 30, 0, 'header', 0, 1),
    (2018, 59, 'ENG', 'Dele Alli', NULL, 58, 0, 'header', 0, 2),
    (2018, 60, 'RUS', 'Denis Cheryshev', NULL, 31, 0, 'open_play', 1, 0),
    (2018, 60, 'CRO', 'Andrej Kramaric', NULL, 39, 0, 'header', 1, 1),
    (2018, 60, 'CRO', 'Domagoj Vida', NULL, 101, 0, 'header', 1, 2),
    (2018, 60, 'RUS', 'Mario Fernandes', NULL, 115, 0, 'header', 2, 2),
    (2018, 61, 'FRA', 'Samuel Umtiti', NULL, 51, 0, 'header', 1, 0),
    (2018, 62, 'ENG', 'Kieran Trippier', NULL, 5, 0, 'free_kick', 0, 1),
    (2018, 62, 'CRO', 'Ivan Perisic', NULL, 68, 0, 'open_play', 1, 1),
    (2018, 62, 'CRO', 'Mario Mandzukic', NULL, 109, 0, 'open_play', 2, 1),
    (2018, 63, 'BEL', 'Thomas Meunier', NULL, 4, 0, 'open_play', 1, 0),
    (2018, 63, 'BEL', 'Eden Hazard', NULL, 82, 0, 'open_play', 2, 0),
    (2018, 64, 'FRA', 'Mario Mandzukic', NULL, 18, 0, 'own_goal', 1, 0),
    (2018, 64, 'CRO', 'Ivan Perisic', NULL, 28, 0, 'open_play', 1, 1),
    (2018, 64, 'FRA', 'Antoine Griezmann', NULL, 38, 0, 'penalty', 2, 1),
    (2018, 64, 'FRA', 'Paul Pogba', NULL, 59, 0, 'open_play', 3, 1),
    (2018, 64, 'FRA', 'Kylian Mbappe', NULL, 65, 0, 'open_play', 4, 1),
    (2018, 64, 'CRO', 'Mario Mandzukic', NULL, 69, 0, 'open_play', 4, 2),
    (2022, 57, 'BRA', 'Neymar', NULL, 105, 1, 'open_play', 0, 1),
    (2022, 57, 'CRO', 'Bruno Petkovic', NULL, 117, 0, 'open_play', 1, 1),
    (2022, 58, 'ARG', 'Nahuel Molina', 'Lionel Messi', 35, 0, 'open_play', 0, 1),
    (2022, 58, 'ARG', 'Lionel Messi', NULL, 73, 0, 'penalty', 0, 2),
    (2022, 58, 'NED', 'Wout Weghorst', NULL, 83, 0, 'header', 1, 2),
    (2022, 58, 'NED', 'Wout Weghorst', NULL, 90, 11, 'open_play', 2, 2),
    (2022, 59, 'MAR', 'Youssef En-Nesyri', NULL, 42, 0, 'header', 1, 0),
    (2022, 60, 'FRA', 'Aurelien Tchouameni', NULL, 17, 0, 'open_play', 0, 1),
    (2022, 60, 'ENG', 'Harry Kane', NULL, 54, 0, 'penalty', 1, 1),
    (2022, 60, 'FRA', 'Olivier Giroud', NULL, 78, 0, 'header', 1, 2),
    (2022, 61, 'ARG', 'Lionel Messi', NULL, 34, 0, 'penalty', 1, 0),
    (2022, 61, 'ARG', 'Julian Alvarez', NULL, 39, 0, 'open_play', 2, 0),
    (2022, 61, 'ARG', 'Julian Alvarez', 'Lionel Messi', 69, 0, 'open_play', 3, 0),
    (2022, 62, 'FRA', 'Theo Hernandez', NULL, 5, 0, 'open_play', 1, 0),
    (2022, 62, 'FRA', 'Randal Kolo Muani', NULL, 79, 0, 'open_play', 2, 0),
    (2022, 63, 'CRO', 'Josko Gvardiol', NULL, 7, 0, 'header', 1, 0),
    (2022, 63, 'MAR', 'Achraf Dari', NULL, 9, 0, 'header', 1, 1),
    (2022, 63, 'CRO', 'Mislav Orsic', NULL, 42, 0, 'open_play', 2, 1),
    (2022, 64, 'ARG', 'Lionel Messi', NULL, 23, 0, 'penalty', 1, 0),
    (2022, 64, 'ARG', 'Angel Di Maria', NULL, 36, 0, 'open_play', 2, 0),
    (2022, 64, 'FRA', 'Kylian Mbappe', NULL, 80, 0, 'penalty', 2, 1),
    (2022, 64, 'FRA', 'Kylian Mbappe', NULL, 81, 0, 'open_play', 2, 2),
    (2022, 64, 'ARG', 'Lionel Messi', NULL, 108, 0, 'open_play', 3, 2),
    (2022, 64, 'FRA', 'Kylian Mbappe', NULL, 118, 0, 'penalty', 3, 3)
)
INSERT INTO goals (
  match_id, scoring_team_id, scorer_player_id, assist_player_id,
  minute, stoppage_minute, goal_type, home_score_after, away_score_after
)
SELECT
  match.id, scoring_team.id, scorer.id, assist.id,
  seed.minute, seed.stoppage, seed.goal_type, seed.home_after, seed.away_after
FROM seed
JOIN tournaments tournament USING (tournament_year)
JOIN matches match ON match.tournament_id = tournament.id AND match.match_number = seed.match_number
JOIN teams scoring_team ON scoring_team.fifa_code = seed.scoring_code
LEFT JOIN players scorer ON scorer.full_name = seed.scorer_name
LEFT JOIN players assist ON assist.full_name = seed.assist_name;

WITH seed(tournament_year, match_number, team_code, player_name, minute, card_type, reason) AS (
  VALUES
    (2018, 58, 'BRA', 'Fernandinho', 47, 'yellow', 'Unsporting behaviour'),
    (2018, 60, 'CRO', 'Domagoj Vida', 38, 'yellow', 'Reckless challenge'),
    (2018, 62, 'CRO', 'Mario Mandzukic', 48, 'yellow', 'Persistent infringement'),
    (2022, 57, 'BRA', 'Neymar', 68, 'yellow', 'Reckless challenge'),
    (2022, 58, 'ARG', 'Lionel Messi', 90, 'yellow', 'Unsporting behaviour'),
    (2022, 58, 'NED', 'Wout Weghorst', 45, 'yellow', 'Dissent'),
    (2022, 60, 'ENG', 'Harry Maguire', 90, 'yellow', 'Reckless challenge'),
    (2022, 64, 'ARG', 'Emiliano Martinez', 116, 'yellow', 'Time wasting')
)
INSERT INTO disciplinary_events (
  match_id, team_id, player_id, minute, card_type, reason
)
SELECT match.id, team.id, player.id, seed.minute, seed.card_type, seed.reason
FROM seed
JOIN tournaments tournament USING (tournament_year)
JOIN matches match ON match.tournament_id = tournament.id AND match.match_number = seed.match_number
JOIN teams team ON team.fifa_code = seed.team_code
LEFT JOIN players player ON player.full_name = seed.player_name AND player.national_team_id = team.id;

CREATE VIEW v_match_results AS
SELECT
  tournament.tournament_year,
  match.match_number,
  match.stage,
  match.kicked_off_at,
  venue.name AS venue,
  venue.city,
  home.common_name AS home_team,
  away.common_name AS away_team,
  match.home_goals,
  match.away_goals,
  match.home_penalties,
  match.away_penalties,
  winner.common_name AS winner,
  match.attendance
FROM matches match
JOIN tournaments tournament ON tournament.id = match.tournament_id
JOIN venues venue ON venue.id = match.venue_id
JOIN teams home ON home.id = match.home_team_id
JOIN teams away ON away.id = match.away_team_id
LEFT JOIN teams winner ON winner.id = match.winner_team_id;

CREATE VIEW v_seeded_team_performance AS
WITH team_matches AS (
  SELECT tournament_id, id AS match_id, home_team_id AS team_id,
         home_goals AS goals_for, away_goals AS goals_against,
         winner_team_id, attendance
  FROM matches
  UNION ALL
  SELECT tournament_id, id, away_team_id,
         away_goals, home_goals, winner_team_id, attendance
  FROM matches
)
SELECT
  tournament.tournament_year,
  team.common_name AS team,
  confederation.code AS confederation,
  count(*) AS matches_played,
  count(*) FILTER (WHERE team_matches.winner_team_id = team_matches.team_id) AS wins,
  count(*) FILTER (WHERE team_matches.goals_for = team_matches.goals_against) AS draws_after_extra_time,
  sum(team_matches.goals_for) AS goals_for,
  sum(team_matches.goals_against) AS goals_against,
  round(avg(stat.possession_pct), 2) AS average_possession_pct,
  sum(stat.shots) AS total_shots,
  sum(stat.shots_on_target) AS shots_on_target,
  round(sum(stat.expected_goals), 2) AS total_expected_goals,
  round(avg(team_matches.attendance), 0) AS average_attendance
FROM team_matches
JOIN tournaments tournament ON tournament.id = team_matches.tournament_id
JOIN teams team ON team.id = team_matches.team_id
JOIN countries country ON country.code = team.country_code
JOIN confederations confederation ON confederation.code = country.confederation_code
JOIN match_team_statistics stat
  ON stat.match_id = team_matches.match_id AND stat.team_id = team_matches.team_id
GROUP BY tournament.tournament_year, team.common_name, confederation.code;

CREATE VIEW v_player_goal_totals AS
SELECT
  tournament.tournament_year,
  player.full_name AS player,
  player_team.common_name AS national_team,
  count(*) FILTER (WHERE goal.goal_type <> 'own_goal') AS goals,
  count(*) FILTER (WHERE goal.goal_type = 'penalty') AS penalties,
  count(*) FILTER (WHERE goal.goal_type = 'own_goal') AS own_goals,
  min(goal.minute) FILTER (WHERE goal.goal_type <> 'own_goal') AS first_goal_minute
FROM goals goal
JOIN matches match ON match.id = goal.match_id
JOIN tournaments tournament ON tournament.id = match.tournament_id
JOIN players player ON player.id = goal.scorer_player_id
JOIN teams player_team ON player_team.id = player.national_team_id
GROUP BY tournament.tournament_year, player.full_name, player_team.common_name;

COMMENT ON SCHEMA world_cup IS
  'Development sample: real 2018/2022 knockout scores with illustrative detailed match metrics.';
COMMENT ON VIEW v_seeded_team_performance IS
  'Aggregates only the quarter-finals through final included in this sample.';

COMMIT;
