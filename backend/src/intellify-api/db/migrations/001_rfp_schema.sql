CREATE SCHEMA IF NOT EXISTS rfp;
CREATE TABLE IF NOT EXISTS rfp.schema_migrations (
  version     integer PRIMARY KEY,
  applied_at  timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS rfp.rfps (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_one_code  text NOT NULL,          -- intellify.clients.one_code; checked by the API, no cross-schema FK
  client_name      text NOT NULL,
  title            text NOT NULL,
  plan_year        integer NOT NULL CHECK (plan_year BETWEEN 2024 AND 2035),
  effective_date   date NOT NULL,
  status           text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','ready','issued','closed')),
  stage            smallint NOT NULL DEFAULT 1 CHECK (stage BETWEEN 0 AND 7),
  sections         jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by       text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS rfps_client_idx ON rfp.rfps (client_one_code, status);
CREATE TABLE IF NOT EXISTS rfp.rfp_lines (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rfp_id              uuid NOT NULL REFERENCES rfp.rfps(id) ON DELETE CASCADE,
  position            integer NOT NULL,
  line                text NOT NULL,          -- intellify.products.name
  product_id          char(24) NOT NULL,
  plan_design_ids     char(24)[] NOT NULL DEFAULT '{}',
  market_basis        text NOT NULL CHECK (market_basis IN ('as-is','alternate')),
  alternate_funding   text,
  alternate_plan_type text,
  notes               text,
  UNIQUE (rfp_id, position)
);
CREATE TABLE IF NOT EXISTS rfp.rfp_carriers (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rfp_id        uuid NOT NULL REFERENCES rfp.rfps(id) ON DELETE CASCADE,
  position      integer NOT NULL,
  insurer_id    char(24) NOT NULL,
  insurer_name  text NOT NULL,
  lines         text[] NOT NULL,
  incumbent     boolean NOT NULL DEFAULT false,
  contact_email text,
  notes         text,
  UNIQUE (rfp_id, position)
);
CREATE TABLE IF NOT EXISTS rfp.rfp_requirements (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rfp_id      uuid NOT NULL REFERENCES rfp.rfps(id) ON DELETE CASCADE,
  position    integer NOT NULL,
  section     text NOT NULL,
  question    text NOT NULL,
  required    boolean NOT NULL DEFAULT true,
  answer_type text NOT NULL DEFAULT 'text' CHECK (answer_type IN ('text','yes_no','number','table','attachment')),
  UNIQUE (rfp_id, position)
);
CREATE TABLE IF NOT EXISTS rfp.rfp_timeline (
  id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rfp_id    uuid NOT NULL REFERENCES rfp.rfps(id) ON DELETE CASCADE,
  position  integer NOT NULL,
  milestone text NOT NULL,
  due_date  date NOT NULL,
  owner     text,
  notes     text,
  UNIQUE (rfp_id, position)
);
INSERT INTO rfp.schema_migrations (version) VALUES (1) ON CONFLICT DO NOTHING;
