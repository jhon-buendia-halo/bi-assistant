import { expect, test } from './fixtures/app.fixture';
import { builtBrand } from './helpers/brand';

/**
 * The Agentic Hub (Mercer) build (ADR-0045). The rest of the suite runs on the
 * default Halo Powered build; this spec runs only on a BRAND=mercer web build:
 *   BRAND=mercer npm run test:e2e -- e2e/brand-mercer.spec.ts
 * (then rebuild without BRAND before running anything else).
 */
test.skip(builtBrand() !== 'mercer', 'needs a BRAND=mercer web build (ADR-0045)');

test('@brand-mercer shows the Agentic Hub shell, names and badge', async ({ app, page }) => {
  test.skip(app.target !== 'web', 'the brand is checked on the web build');
  const rail = page.getByRole('complementary', { name: 'Navigation rail' });

  await expect(page.getByRole('heading', { level: 1 })).toHaveText('US Health Agentic Hub');
  await expect(page).toHaveTitle('Agentic Hub');
  await expect(page.getByRole('heading', { name: 'Welcome to Agentic Hub' })).toBeVisible();
  await expect(rail.getByText('Agentic Hub', { exact: true })).toBeVisible();
  await expect(rail.getByRole('img', { name: 'Powered by LenAI' })).toBeVisible();
  // The framed shell: no Halo header crumb, no HALO wordmark.
  await expect(page.getByTestId('header-area')).toHaveCount(0);
  await expect(page.getByRole('img', { name: 'Halo Powered' })).toHaveCount(0);

  await rail.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(page.getByTestId('app-version')).toHaveText(/^Agentic Hub v\d+\.\d+\.\d+$/);
});
