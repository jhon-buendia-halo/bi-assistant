import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import type { Download, Locator, Page } from '@playwright/test';
import { test, expect } from './fixtures/app.fixture';
import { WORLD_CUP_DATASET } from './helpers/app-actions';
import {
  apiBase,
  deleteDataset,
  seedWorldCupDataset,
} from './helpers/agents-api';
import {
  WORLD_CUP_DB,
  worldCupKey,
  worldCupScalar,
} from './helpers/world-cup-db';
import { scenarioStep } from './support/demo-captions';

/**
 * Feature: Synthetic data (specs/capabilities/synthetic-data/spec.md,
 * roadmap 1.22.x; plan docs/plans/m1-22-synthetic-data.md 3.4).
 *
 * The World Cup dataset is seeded through the API over `teams`, `players`
 * and `matches`; `players` holds the real names the export scenarios look
 * for, and `matches` is small (read in full) with a six-value `stage`.
 */

const MATCHES = worldCupKey('matches');
const SLUG = 'world-cup-core';
const TABLES = ['teams', 'players', 'matches'];

const requireFromBackend = createRequire(
  path.resolve(__dirname, '../../backend/package.json'),
);

interface PgClient {
  connect(): Promise<void>;
  query(sql: string): Promise<{ rows: Record<string, unknown>[] }>;
  end(): Promise<void>;
}

interface Workbook {
  xlsx: { readFile(p: string): Promise<void> };
  worksheets: {
    name: string;
    eachRow(cb: (row: { values: unknown }) => void): void;
  }[];
}

function unzip(file: string): Record<string, Uint8Array> {
  const { unzipSync } = requireFromBackend('fflate') as {
    unzipSync(d: Uint8Array): Record<string, Uint8Array>;
  };
  return unzipSync(fs.readFileSync(file));
}

async function readWorkbook(file: string): Promise<Workbook> {
  const ExcelJS = requireFromBackend('exceljs') as {
    Workbook: new () => Workbook;
  };
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(file);
  return wb;
}

test.beforeEach(async ({ page }) => {
  const datasourceId = await seedWorldCupDataset(page);
  // Replace the one-table dataset by a three-table one.
  await deleteDataset(page, WORLD_CUP_DATASET);
  const response = await page.request.fetch(`${apiBase(page)}/datasets`, {
    method: 'POST',
    data: {
      name: WORLD_CUP_DATASET,
      tables: TABLES.map(worldCupKey),
      entities: TABLES.map((t) => ({
        key: worldCupKey(t),
        columns: [{ name: 'id', type: 'bigint', nullable: false }],
      })),
      datasourceId,
      datasourceKind: 'postgres',
    },
  });
  expect(response.ok()).toBe(true);
  // The dataset list is read when the app starts.
  await page.reload();
  await expect(page.getByTitle('Settings')).toBeVisible();
});

function rail(page: Page, name: string): Locator {
  return page
    .getByRole('complementary', { name: 'Navigation rail' })
    .getByRole('button', { name, exact: true });
}

/** Opens the dataset's Profile & synthesize tab and profiles the sample. */
async function openAndProfile(page: Page): Promise<void> {
  // Leave the area first so the rail lands on the dataset list.
  await rail(page, 'Context').click();
  await rail(page, 'Datasets').click();
  await page.getByTestId(`dataset-${WORLD_CUP_DATASET}`).click();
  await page.getByTestId('dataset-tab-synthesize').click();
  await page.getByTestId('synth-profile').click();
  await expect(page.getByTestId('synth-profile-view')).toBeVisible();
  await expect(page.getByTestId('synth-generate-form')).toBeVisible();
}

async function downloadOf(
  page: Page,
  trigger: () => Promise<void>,
): Promise<Download> {
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    trigger(),
  ]);
  return download;
}

/** RFC 4180 reader: quotes, doubled quotes, CRLF or LF row ends. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') {
      row.push(cell);
      cell = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += c;
  }
  if (cell !== '' || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

test.describe('Feature: Synthetic data', () => {
  test(
    'Profile a sample of World Cup',
    { tag: ['@demo', '@story-1.22.1'] },
    async ({ page }) => {
      await scenarioStep(
        page,
        'Given I open the "World Cup Core" dataset',
        async () => {
          // Leave the area first so the rail lands on the dataset list.
          await rail(page, 'Context').click();
          await rail(page, 'Datasets').click();
          await page.getByTestId(`dataset-${WORLD_CUP_DATASET}`).click();
        },
      );
      await scenarioStep(
        page,
        'When I open the "Profile & synthesize" tab',
        async () => {
          await page.getByTestId('dataset-tab-synthesize').click();
          await expect(
            page.getByRole('heading', { name: 'Profile & synthesize' }),
          ).toBeVisible();
          await expect(page.getByTestId('synth-table-count')).toHaveText(
            `${TABLES.length} of ${TABLES.length} tables`,
          );
        },
      );
      await scenarioStep(page, 'And I click "Profile sample"', async () => {
        await page.getByTestId('synth-profile').click();
      });
      await scenarioStep(
        page,
        'Then I see a card for "matches" whose method reads "Read all … rows"',
        async () => {
          await expect(page.getByTestId('synth-profile-view')).toBeVisible();
          await expect(
            page.getByTestId(`synth-table-card-${MATCHES}`),
          ).toBeVisible();
          await expect(page.getByTestId(`synth-method-${MATCHES}`)).toHaveText(
            /^Read all [\d,]+ rows$/,
          );
        },
      );
      await scenarioStep(
        page,
        'And the "stage" column shows the chip "Reuses" followed by a number of values',
        async () => {
          await expect(
            page.getByTestId(`synth-col-${MATCHES}-stage`),
          ).toContainText(/Reuses \d+ values?/);
        },
      );
    },
  );

  test(
    'Generate a PostgreSQL script',
    { tag: ['@demo', '@story-1.22.2'] },
    async ({ page }) => {
      await scenarioStep(page, 'Given I profiled the "World Cup" dataset', () =>
        openAndProfile(page),
      );
      let download!: Download;
      await scenarioStep(
        page,
        'When I set "Rows per table" to 25 and click "Generate .sql"',
        async () => {
          await page.getByTestId('synth-rows-all').fill('25');
          await page.getByTestId('synth-rows-apply').click();
          await expect(
            page.getByTestId(`synth-rows-${worldCupKey('players')}`),
          ).toHaveValue('25');
          download = await downloadOf(page, () =>
            page.getByTestId('synth-generate').click(),
          );
        },
      );
      const file = `${SLUG}-synthetic-postgresql-seed1.sql`;
      await scenarioStep(
        page,
        `Then a file named "${file}" downloads`,
        async () => {
          expect(download.suggestedFilename()).toBe(file);
        },
      );
      await scenarioStep(
        page,
        'And its content starts with "-- Synthetic data for dataset "',
        async () => {
          const text = fs.readFileSync(await download.path(), 'utf8');
          expect(text).toContain('-- Synthetic data for dataset "');
          expect(text).toContain('CREATE TABLE');
          expect(text).not.toContain('\r');
        },
      );
      await scenarioStep(
        page,
        `And I see the toast "Downloaded ${file}"`,
        async () => {
          await expect(page.getByText(`Downloaded ${file}`)).toBeVisible();
        },
      );
    },
  );

  test('The script replays into an empty PostgreSQL database', async ({
    page,
  }) => {
    const base = apiBase(page);
    let profileId = '';
    const post = async (seed: number) => {
      const response = await page.request.fetch(
        `${base}/synthetic-data/scripts`,
        { method: 'POST', data: { profileId, defaultRowCount: 50, seed } },
      );
      expect(response.status()).toBe(200);
      return {
        text: await response.text(),
        sha: response.headers()['x-script-sha256'] ?? '',
        rows: response.headers()['x-script-rows'] ?? '',
      };
    };
    let first!: Awaited<ReturnType<typeof post>>;
    await scenarioStep(
      page,
      'Given I generated the World Cup script with seed 1 and 50 rows per table',
      async () => {
        const profile = await page.request.fetch(
          `${base}/synthetic-data/profiles`,
          { method: 'POST', data: { datasetName: WORLD_CUP_DATASET } },
        );
        expect(profile.status()).toBe(201);
        profileId = ((await profile.json()) as { profileId: string }).profileId;
        first = await post(1);
        expect(first.sha).toMatch(/^[0-9a-f]{64}$/);
      },
    );
    const { Client } = requireFromBackend('pg') as {
      Client: new (c: object) => PgClient;
    };
    const scratch = `synthetic_replay_${process.pid}_${Date.now() % 100000}`;
    const admin = new Client(WORLD_CUP_DB);
    await admin.connect();
    await admin.query(`CREATE DATABASE ${scratch}`);
    try {
      const db = new Client({ ...WORLD_CUP_DB, database: scratch });
      await db.connect();
      try {
        await scenarioStep(
          page,
          'When I run it in an empty scratch PostgreSQL database',
          async () => {
            await db.query(first.text);
          },
        );
        await scenarioStep(
          page,
          'Then every table holds the requested rows, or the clamp',
          async () => {
            const { rows: tables } = await db.query(
              `SELECT table_name FROM information_schema.tables
               WHERE table_schema = 'synthetic' ORDER BY 1`,
            );
            expect(tables.length).toBe(TABLES.length);
            let total = 0;
            for (const { table_name } of tables) {
              const { rows } = await db.query(
                `SELECT COUNT(*)::int AS n FROM synthetic."${String(table_name)}"`,
              );
              const n = rows[0]['n'] as number;
              expect(n, String(table_name)).toBeGreaterThan(0);
              expect(n, String(table_name)).toBeLessThanOrEqual(50);
              total += n;
            }
            if (/^\d+$/.test(first.rows)) {
              expect(total).toBe(Number(first.rows));
            }
            const names = (
              (await worldCupScalar(
                `SELECT string_agg(full_name, '|') FROM (SELECT full_name FROM world_cup.players ORDER BY id LIMIT 3) p`,
              )) as string
            ).split('|');
            expect(names).toHaveLength(3);
            for (const name of names) expect(first.text).not.toContain(name);
          },
        );
        await scenarioStep(
          page,
          'And every foreign-key constraint exists',
          async () => {
            const { rows } = await db.query(
              `SELECT COUNT(*)::int AS n FROM pg_constraint c
               JOIN pg_namespace n ON n.oid = c.connamespace
               WHERE c.contype = 'f' AND n.nspname = 'synthetic'`,
            );
            expect(rows[0]['n'] as number).toBeGreaterThanOrEqual(1);
          },
        );
      } finally {
        await db.end();
      }
    } finally {
      await admin.query(`DROP DATABASE IF EXISTS ${scratch} WITH (FORCE)`);
      await admin.end();
    }
    await scenarioStep(
      page,
      'And generating again with seed 1 gives the same SHA-256',
      async () => {
        expect((await post(1)).sha).toBe(first.sha);
        expect((await post(2)).sha).not.toBe(first.sha);
      },
    );
  });

  test(
    'Download the synthetic data as CSV and Excel',
    { tag: ['@demo', '@story-1.22.5'] },
    async ({ page }) => {
      await scenarioStep(page, 'Given I profiled the "World Cup" dataset', () =>
        openAndProfile(page),
      );
      let zip!: Download;
      await scenarioStep(
        page,
        'When I choose the format "CSV (zip)" and click "Generate .zip"',
        async () => {
          await page.getByTestId('synth-rows-all').fill('20');
          await page.getByTestId('synth-rows-apply').click();
          await page
            .getByTestId('synth-format')
            .selectOption({ label: 'CSV (zip)' });
          await expect(page.getByTestId('synth-generate')).toHaveText(
            /Generate \.zip/,
          );
          zip = await downloadOf(page, () =>
            page.getByTestId('synth-generate').click(),
          );
        },
      );
      let csvPlayers: string[][] = [];
      await scenarioStep(
        page,
        'Then a zip downloads with one CSV per table and a README.txt',
        async () => {
          expect(zip.suggestedFilename()).toMatch(/-csv\.zip$/);
          const files = unzip(await zip.path());
          const names = Object.keys(files);
          expect(names).toContain('README.txt');
          expect(names.filter((n) => n.endsWith('.csv'))).toHaveLength(
            TABLES.length,
          );
          for (const t of TABLES) expect(names).toContain(`${t}.csv`);
          csvPlayers = parseCsv(
            Buffer.from(files['players.csv']).toString('utf8'),
          );
        },
      );
      let xlsx!: Download;
      await scenarioStep(
        page,
        'When I choose the format "Excel (.xlsx)" and click "Generate .xlsx"',
        async () => {
          await page
            .getByTestId('synth-format')
            .selectOption({ label: 'Excel (.xlsx)' });
          await expect(page.getByTestId('synth-generate')).toHaveText(
            /Generate \.xlsx/,
          );
          xlsx = await downloadOf(page, () =>
            page.getByTestId('synth-generate').click(),
          );
        },
      );
      await scenarioStep(
        page,
        'Then a workbook downloads with one sheet per table and an "About" sheet',
        async () => {
          expect(xlsx.suggestedFilename()).toMatch(/\.xlsx$/);
          const wb = await readWorkbook(await xlsx.path());
          const sheets = wb.worksheets.map((w) => w.name);
          expect(sheets).toContain('About');
          for (const t of TABLES) expect(sheets).toContain(t);
        },
      );
      await scenarioStep(
        page,
        'And both hold the same values for the same seed',
        async () => {
          const wb = await readWorkbook(await xlsx.path());
          const sheet = wb.worksheets.find((w) => w.name === 'players')!;
          const rows: string[][] = [];
          sheet.eachRow((row) => {
            const v = (row.values as unknown[]).slice(1);
            rows.push(
              v.map((c) => (c === null || c === undefined ? '' : String(c))),
            );
          });
          expect(rows.length).toBe(csvPlayers.length);
          const col = csvPlayers[0].indexOf('full_name');
          expect(col).toBeGreaterThanOrEqual(0);
          expect(rows.map((r) => r[col])).toEqual(
            csvPlayers.map((r) => r[col]),
          );
        },
      );
    },
  );

  test('Export the profile', async ({ page }) => {
    await scenarioStep(page, 'Given I profiled the "World Cup" dataset', () =>
      openAndProfile(page),
    );
    let csv!: Download;
    await scenarioStep(
      page,
      'When I choose "Export profile" and then "CSV"',
      async () => {
        await page.getByTestId('synth-export-profile').click();
        csv = await downloadOf(page, () =>
          page.getByTestId('synth-export-profile-csv').click(),
        );
      },
    );
    await scenarioStep(
      page,
      `Then a file named "${SLUG}-profile.csv" downloads with one row per profiled column`,
      async () => {
        expect(csv.suggestedFilename()).toBe(`${SLUG}-profile.csv`);
        const rows = parseCsv(fs.readFileSync(await csv.path(), 'utf8'));
        const shown = await page.locator('[data-testid^="synth-col-"]').count();
        expect(shown).toBeGreaterThan(0);
        expect(rows.filter((r) => r.length > 1).length - 1).toBe(shown);
      },
    );
    let xlsx!: Download;
    await scenarioStep(
      page,
      'When I choose "Export profile" and then "Excel"',
      async () => {
        await page.getByTestId('synth-export-profile').click();
        xlsx = await downloadOf(page, () =>
          page.getByTestId('synth-export-profile-xlsx').click(),
        );
      },
    );
    await scenarioStep(
      page,
      'Then a workbook downloads with a "Tables" sheet and a "Columns" sheet',
      async () => {
        const wb = await readWorkbook(await xlsx.path());
        const names = wb.worksheets.map((w) => w.name);
        expect(names).toContain('Tables');
        expect(names).toContain('Columns');
      },
    );
  });

  test(
    'Export the real sample rows after confirming',
    { tag: ['@demo', '@story-1.22.6'] },
    async ({ page }) => {
      await scenarioStep(page, 'Given I profiled the "World Cup" dataset', () =>
        openAndProfile(page),
      );
      await scenarioStep(
        page,
        'When I choose "Export sample rows" and then "CSV (zip)"',
        async () => {
          await page.getByTestId('synth-export-sample').click();
          await page.getByTestId('synth-export-sample-csv').click();
        },
      );
      await scenarioStep(
        page,
        'Then I see a dialog saying the file contains real rows from the datasource',
        async () => {
          await expect(
            page.getByTestId('synth-confirm-real-data'),
          ).toContainText('This file contains real rows from');
        },
      );
      let zip!: Download;
      await scenarioStep(page, 'When I click "Export"', async () => {
        zip = await downloadOf(page, () =>
          page.getByTestId('synth-confirm-export').click(),
        );
      });
      await scenarioStep(
        page,
        `Then a file named "${SLUG}-sample-csv.zip" downloads`,
        async () => {
          expect(zip.suggestedFilename()).toBe(`${SLUG}-sample-csv.zip`);
        },
      );
      await scenarioStep(
        page,
        'And its "players.csv" holds the real player names',
        async () => {
          const files = unzip(await zip.path());
          const rows = parseCsv(
            Buffer.from(files['players.csv']).toString('utf8'),
          );
          const col = rows[0].indexOf('full_name');
          expect(col).toBeGreaterThanOrEqual(0);
          expect(rows.length).toBeGreaterThan(1);
          const name = rows[1][col].replace(/'/g, "''");
          expect(
            Number(
              await worldCupScalar(
                `SELECT COUNT(*)::int FROM world_cup.players WHERE full_name = '${name}'`,
              ),
            ),
          ).toBeGreaterThanOrEqual(1);
        },
      );
      await scenarioStep(
        page,
        'When I choose "Export sample rows", "SQL script" and confirm',
        async () => {
          await page.getByTestId('synth-export-sample').click();
          await page.getByTestId('synth-export-sample-sql').click();
          const sql = await downloadOf(page, () =>
            page.getByTestId('synth-confirm-export').click(),
          );
          expect(sql.suggestedFilename()).toBe(`${SLUG}-sample-postgresql.sql`);
          const text = fs.readFileSync(await sql.path(), 'utf8');
          expect(text).toContain('REAL DATA');
          expect(text).not.toContain('FOREIGN KEY');
        },
      );
    },
  );

  test('Cancelling the confirm downloads nothing', async ({ page }) => {
    await scenarioStep(page, 'Given I profiled the "World Cup" dataset', () =>
      openAndProfile(page),
    );
    let downloaded = false;
    page.on('download', () => (downloaded = true));
    await scenarioStep(
      page,
      'When I choose "Export sample rows" and then "Excel (.xlsx)"',
      async () => {
        await page.getByTestId('synth-export-sample').click();
        await page.getByTestId('synth-export-sample-xlsx').click();
        await expect(page.getByTestId('synth-confirm-real-data')).toBeVisible();
      },
    );
    await scenarioStep(page, 'And I click "Cancel" in the dialog', async () => {
      await page.getByTestId('synth-confirm-cancel').click();
    });
    await scenarioStep(
      page,
      'Then nothing downloads and the dialog closes',
      async () => {
        await expect(page.getByTestId('synth-confirm-real-data')).toBeHidden();
        await page.waitForTimeout(2000);
        expect(downloaded).toBe(false);
      },
    );
  });
});
