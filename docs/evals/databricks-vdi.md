# Databricks evals in the VDI (BA-186)

The Databricks samples, their reference queries and the loader are built and unit-tested outside the VDI, with no warehouse (decided 2026-10-13). This runbook is the part that needs one: load the three samples into Unity Catalog, validate every Databricks reference, run the sets, and bring the evidence back. Rules: [testing-data](../../specs/capabilities/testing-data/spec.md) R23 to R25, [agents-evals](../../specs/capabilities/agents-evals/spec.md) R184 to R192.

## What you need

- A copy of the repository at the commit to validate, Node 20 or later, and `npm ci` done in `backend/` and `frontend/`.
- A Databricks workspace, a **SQL warehouse** (not a cluster) and a personal access token.
- A catalog in which the token can create schemas and tables: `evals` by default, or any other one (a team sandbox catalog works). The reference queries are written with `` `evals` `` and run in the catalog of the dataset you select, so the name does not matter ([agents-evals](../../specs/capabilities/agents-evals/spec.md) R192). If you have no such catalog, ask a workspace admin for one:

  ```sql
  CREATE CATALOG IF NOT EXISTS <catalog>;
  GRANT USE CATALOG, CREATE SCHEMA ON CATALOG <catalog> TO `<you or your group>`;
  ```

- An LLM key, only for step 6 (the validator in step 5 calls no model).

## Steps

Commands run from the repository root unless they say `cd backend`. In PowerShell, set a variable with `$env:NAME = "value"` instead of `export NAME=value`.

**1. Build and start the app** (web mode, its own data directory):

```bash
npm --prefix backend run build:all
node backend/dist/cli.js --no-open --port 3000 --data-dir ~/q2i-dbx
```

Leave it running. It prints the URL to open; if port 3000 was busy it picks another, and then `export BACKEND_URL=http://127.0.0.1:<that port>` in step 2. Open the URL, go to Settings → LLM and save the key.

**2. Set the connection** in a second terminal. The host and HTTP path are on the warehouse's *Connection details* tab:

```bash
export DATABRICKS_HOST=adb-<workspace-id>.<n>.azuredatabricks.net
export DATABRICKS_HTTP_PATH=/sql/1.0/warehouses/<warehouse-id>
export DATABRICKS_TOKEN=<personal access token>
```

If the catalog is not `evals`, also `export DATABRICKS_CATALOG=<catalog>`. Leave `DATABRICKS_SCHEMA` unset: the eval sets need each sample in its own schema (`world_cup`, `finance`, `marketing_analytics`).

**3. Dry run, then load and register each sample** (each takes a minute or two on a running warehouse; the first one also waits for the warehouse to start):

```bash
npm --prefix backend run fixture:databricks -- --fixture world-cup --dry-run | head -20
npm --prefix backend run fixture:databricks -- --fixture world-cup           | tee loader-world-cup.txt
npm --prefix backend run fixture:databricks -- --fixture finance             | tee loader-finance.txt
npm --prefix backend run fixture:databricks -- --fixture marketing-analytics | tee loader-marketing-analytics.txt
```

The loader registers each sample by calling the app's HTTP API at `BACKEND_URL` directly: the app has one built-in user, so there is no sign-in and no token to pass. Each ends with `✔ row counts match the dump for all <n> relations`, then `Done.` with the datasource (`World Cup Databricks`, `Finance Databricks`, `Marketing Analytics Databricks`) and the dataset (`World Cup (Databricks)`, `Finance (Databricks)`, `Marketing Analytics (Databricks)`). Running it again is safe: it replaces the tables and updates the same records.

**4. Optional: the browse-only table** for `dbx-only-browse-only-player-contracts`. A workspace admin, not the eval principal, creates a table the eval token can see but not read:

```sql
CREATE SCHEMA IF NOT EXISTS <catalog>.world_cup_restricted;
CREATE OR REPLACE TABLE <catalog>.world_cup_restricted.player_contracts (player STRING, club STRING, annual_salary_eur BIGINT);
GRANT BROWSE ON CATALOG <catalog> TO `<eval principal>`;
SHOW GRANTS `<eval principal>` ON SCHEMA <catalog>.world_cup_restricted;
```

The last statement must list no `USE SCHEMA` or `SELECT`, direct or inherited: a catalog-level `ALL PRIVILEGES` would give both, and Unity Catalog cannot revoke an inherited privilege on one schema.

Then, in the app, edit the dataset `World Cup (Databricks)`, refresh the inventory, tick `world_cup_restricted.player_contracts` (shown greyed with a lock) and save. Without this step the question still runs and guards against invented salaries, but does not exercise a browse-only object; say which in the evidence.

**5. Validate every Databricks reference** (no model; `node` on the build of step 1, so the running app is not rebuilt under it):

```bash
cd backend
export APP_DATA_DIR=~/q2i-dbx
for set in world-cup-databricks world-cup-databricks-only; do
  EVAL_SET=$set EVAL_DATASETS="World Cup (Databricks)" node dist/mastra/evals/validate-eval-sets.js | tee validate-$set.txt
done
EVAL_SET=finance-databricks EVAL_DATASETS="Finance (Databricks)" node dist/mastra/evals/validate-eval-sets.js | tee validate-finance-databricks.txt
EVAL_SET=marketing-analytics-databricks EVAL_DATASETS="Marketing Analytics (Databricks)" node dist/mastra/evals/validate-eval-sets.js | tee validate-marketing-analytics-databricks.txt
```

Every line should read `✓ <case id>  databricks  <n> rows`. Each reference runs with `` `evals`. `` rewritten to the dataset's catalog; datasets spread over several catalogs are refused before any query. A `✗` line names the case and the warehouse's error; bring it back as it is, do not fix it in the VDI.

Then break one reference on purpose and check that it fails. The validator reads the set files from `dist`, so edit the built copy and restore it from `src` afterwards (no rebuild under the running app):

```bash
node -e "const fs=require('fs'),f='dist/mastra/evals/sets/world-cup.json',d=JSON.parse(fs.readFileSync(f));const c=d.cases.find(c=>c.id==='champion-2022');c.expectedSql.databricks=c.expectedSql.databricks.replace('common_name AS','common_nme AS');fs.writeFileSync(f,JSON.stringify(d))"
EVAL_SET=world-cup-databricks EVAL_DATASETS="World Cup (Databricks)" node dist/mastra/evals/validate-eval-sets.js | tee validate-broken.txt; echo "exit ${PIPESTATUS[0]}" >> validate-broken.txt
cp src/mastra/evals/sets/world-cup.json dist/mastra/evals/sets/world-cup.json
```

Expect `✗ dbx-champion-2022  databricks` with the warehouse's unresolved-column error, the other cases still `✓`, and `exit 1`.

**6. Run the sets with the model.** From the app: Agents → assistant → Evals, pick the datasource `World Cup Databricks`, open the set `world-cup-databricks`, select every question and run; then `world-cup-databricks-only`, then `finance-databricks` on `Finance Databricks` and `marketing-analytics-databricks` on `Marketing Analytics Databricks`. Download each finished run's report from Executions. From the command line (still in `backend/`), one family:

```bash
APP_DATA_DIR=~/q2i-dbx EVAL_SET=world-cup-databricks EVAL_DATASETS="World Cup (Databricks)" node dist/mastra/evals/run-assistant-evals.js | tee cli-world-cup-databricks.txt
```

**7. Cold and warm timing.** Stop the warehouse (SQL Warehouses → Stop, or leave it idle past its auto-stop), run `world-cup-databricks-only` from the Evals tab, then run it again at once. The first question, `dbx-only-matches-per-tournament`, is the timing: note its duration in both runs. A pro or classic warehouse can take longer to start than the connector's 120 s query budget; if the cold run's first question fails with `Databricks query timed out after 120s`, that is the cold result to record.

## Evidence to bring back

Into `evidence/1.1.8/vdi/` of the branch: the commit hash of the copy (`git log -1 --format=%H`), the catalog used, the warehouse type (serverless, pro or classic) and size, every `loader-*.txt`, `validate-*.txt` (with `validate-broken.txt`), `cli-*.txt`, the downloaded reports, one screenshot of the Evals tab with a finished Databricks run, a `timing.txt` with the cold and warm durations, and whether step 4 was done. Never bring back the token or a file that contains it; the host may stay.
