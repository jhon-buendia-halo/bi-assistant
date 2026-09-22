import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

// Playwright lives in the Angular workspace, not here, so it is imported by
// path rather than by bare specifier.
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const { chromium } = await import(
  path.join(ROOT, 'frontend/node_modules/playwright/index.mjs')
);

const OUT = process.env.SHOTS_OUT ?? path.join(ROOT, '.context/shots');
fs.mkdirSync(OUT, { recursive: true });
const only = process.argv.slice(2);
const want = (n) => only.length === 0 || only.includes(n);

const browser = await chromium.launch();

async function open() {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2,
  });
  await page.goto('http://localhost:4200/', { waitUntil: 'networkidle' });
  await page.waitForTimeout(2500);
  return page;
}

/** Open the seeded session and wait for the visual panel to finish loading. */
async function openSession(page) {
  await page.getByText('Sessions', { exact: true }).first().click();
  await page.waitForTimeout(600);
  await page.getByText('Finishing quality at the World Cup').first().click();
  await page.waitForTimeout(3500);
  return page;
}

const shot = (page, name, opts = {}) =>
  page.screenshot({ path: `${OUT}/${name}.png`, ...opts });

/** Collapse the right panel — the views outside a session leave it empty. */
async function collapseRight(page) {
  const btn = page.locator('button[title="Collapse right panel"]');
  if (await btn.count()) {
    await btn.first().click();
    await page.waitForTimeout(700);
  }
}

// 01 — hero: the answer with the visual beside it
if (want('hero')) {
  const page = await open();
  await openSession(page);
  // Scroll the transcript so the answer's head is at the top of the column.
  await page.getByText('France finished best').first().scrollIntoViewIfNeeded();
  await page.waitForTimeout(400);
  await page.mouse.move(700, 450);
  await page.mouse.wheel(0, -120);
  await page.waitForTimeout(1200);
  await shot(page, '01-hero');
  await page.close();
}

// 02 — the clarifying question
if (want('clarify')) {
  const page = await open();
  await openSession(page);
  await page.getByText('How should finishing quality be measured?').first().scrollIntoViewIfNeeded();
  await page.waitForTimeout(400);
  await page.mouse.move(700, 450);
  await page.mouse.wheel(0, -200);
  await page.waitForTimeout(1000);
  await shot(page, '02-clarify');
  await page.close();
}

// 03 — provenance: reasoning trail + the SQL behind the answer
if (want('provenance')) {
  const page = await open();
  await openSession(page);
  for (const label of ['How I worked this out', 'Data used']) {
    const el = page.getByText(label, { exact: false }).first();
    await el.scrollIntoViewIfNeeded();
    await el.click();
    await page.waitForTimeout(700);
  }
  await page.getByText('How I worked this out', { exact: false }).first().scrollIntoViewIfNeeded();
  await page.mouse.move(700, 450);
  await page.mouse.wheel(0, -160);
  await page.waitForTimeout(1000);
  await shot(page, '03-provenance');
  await page.close();
}

// 03b — the SQL and rows behind the answer
if (want('sql')) {
  const page = await open();
  await openSession(page);
  const el = page.getByText('Data used', { exact: false }).first();
  await el.scrollIntoViewIfNeeded();
  await el.click();
  await page.waitForTimeout(900);
  await el.scrollIntoViewIfNeeded();
  await page.mouse.move(700, 450);
  await page.mouse.wheel(0, -60);
  await page.waitForTimeout(900);
  await shot(page, '03b-sql');
  await page.close();
}

// 04 — the visual on its own, full height
if (want('visual')) {
  const page = await open();
  await openSession(page);
  const panel = page.locator('iframe').first();
  await page.waitForTimeout(1500);
  await shot(page, '04-visual');
  await page.close();
}

// 04b — the version history: tailoring is versioned and revertible
if (want('versions')) {
  const page = await open();
  await openSession(page);
  await page.locator('button', { hasText: /^\s*v2\s*$/ }).first().click();
  await page.waitForTimeout(1200);
  await shot(page, '04b-versions');
  await page.close();
}

// 05 — knowledge
if (want('knowledge')) {
  const page = await open();
  await page.getByText('Knowledge', { exact: true }).first().click();
  await page.waitForTimeout(1500);
  await collapseRight(page);
  await shot(page, '05-knowledge');
  await page.close();
}

// 06 — dataset / catalog browser, drilled into an entity
if (want('datasets')) {
  const page = await open();
  await page.getByText('Datasets', { exact: true }).first().click();
  await page.waitForTimeout(1800);
  await page.getByText('9 entities', { exact: false }).first().click();
  await page.waitForTimeout(3000);
  // Expand catalog → schema, then select the table the analysis ran on.
  await page.getByText('world_cup', { exact: true }).first().click();
  await page.waitForTimeout(1200);
  const schema = page.getByText('world_cup', { exact: true }).nth(1);
  if (await schema.count()) {
    await schema.click();
    await page.waitForTimeout(1500);
  }
  const entity = page.getByText('match_team_statistics', { exact: false }).first();
  if (await entity.count()) {
    await entity.click();
    await page.waitForTimeout(2500);
  }
  await shot(page, '06-datasets');
  await page.close();
}

// 07 — settings: the datasource connection
if (want('settings')) {
  const page = await open();
  await page.locator('button[title="Settings"]').first().click();
  await page.waitForTimeout(1200);
  await page.getByText('Datasource Configuration').first().click();
  await page.waitForTimeout(2500);
  await collapseRight(page);
  await shot(page, '07-settings');
  await page.close();
}

// 07b — settings: the model provider
if (want('llm')) {
  const page = await open();
  await page.locator('button[title="Settings"]').first().click();
  await page.waitForTimeout(1200);
  await page.getByText('LLM Configuration').first().click();
  await page.waitForTimeout(2500);
  await collapseRight(page);
  await shot(page, '07b-llm');
  await page.close();
}

// 08 — agents / evals
if (want('agents')) {
  const page = await open();
  await page.getByText('Agents', { exact: true }).first().click();
  await page.waitForTimeout(2500);
  await collapseRight(page);
  await shot(page, '08-agents');
  await page.close();
}

await browser.close();
console.log('captured', only.length ? only.join(', ') : 'all');
