// Captures the product-page screenshots from a running Halo Workbench (web
// mode) that has the World Cup fixture loaded and a stored run of Answer a
// Business Question (Avery + Michael) on "World Cup".
// See site/README.md, "Screenshots", for how to get there.
//
//   APP_URL=http://127.0.0.1:3210/ node site/scripts/screenshots/capture.mjs [shot ...]
//
// Shots: hero, inspector, evidence, workflows, agents (all by default).
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

// Playwright lives in the Angular workspace, not here, so it is imported by
// path rather than by bare specifier.
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const { chromium } = await import(
  path.join(ROOT, 'frontend/node_modules/playwright/index.mjs')
);

const APP_URL = process.env.APP_URL ?? 'http://127.0.0.1:3000/';
const OUT = process.env.SHOTS_OUT ?? path.join(ROOT, '.context/shots');
fs.mkdirSync(OUT, { recursive: true });
const only = process.argv.slice(2);
const want = (n) => only.length === 0 || only.includes(n);

// The question the Answer a Business Question run was started with; its run
// row in Runs starts with these words.
const QUESTION_START = 'Which teams finished their chances best';

const browser = await chromium.launch();

async function open() {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2,
  });
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto(APP_URL, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  return page;
}

const rail = (page, name) =>
  page
    .getByRole('complementary', { name: 'Navigation rail' })
    .getByText(name, { exact: true })
    .first();

/** Open a stored run from Runs: its workflow page with the Run panel beside the graph. */
async function openRun(page, title) {
  await rail(page, 'Runs').click();
  await page.waitForTimeout(800);
  await page.getByText(title, { exact: false }).first().click();
  await page.waitForTimeout(3000);
}

const shot = async (page, name) => {
  await page.mouse.move(1, 1);
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${OUT}/${name}.png` });
};

// The workflow graph with the finished run: the answer, each figure linked to its query.
if (want('hero')) {
  const page = await open();
  await openRun(page, QUESTION_START);
  await shot(page, 'hero');
  await page.close();
}

// The query inspector: one query explained step by step in business words.
if (want('inspector')) {
  const page = await open();
  await openRun(page, QUESTION_START);
  await page.getByRole('button', { name: /^Open query Q\d+, the source of / }).first().click();
  // The step-by-step explanation is written by a model; wait for its steps.
  await page.getByText('Show all', { exact: false }).first().waitFor({ timeout: 90_000 });
  await shot(page, 'inspector');
  await page.close();
}

// The coverage line and the queries behind the answer.
if (want('evidence')) {
  const page = await open();
  await openRun(page, QUESTION_START);
  const coverage = page.getByText('Inspect the', { exact: false }).first();
  await coverage.scrollIntoViewIfNeeded();
  await page.mouse.move(1240, 500);
  await page.mouse.wheel(0, 260);
  await page.waitForTimeout(800);
  await shot(page, 'evidence');
  await page.close();
}

// The workflow catalogue.
if (want('workflows')) {
  const page = await open();
  await rail(page, 'Workflows').click();
  await page.waitForTimeout(1500);
  await shot(page, 'workflows');
  await page.close();
}

// The agent library.
if (want('agents')) {
  const page = await open();
  await rail(page, 'Agents').click();
  await page.waitForTimeout(1500);
  await shot(page, 'agents');
  await page.close();
}

await browser.close();
console.log('captured', only.length ? only.join(', ') : 'all', 'into', OUT);
