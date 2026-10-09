import fs from 'node:fs';
import path from 'node:path';
import { test, expect, desktopOnly } from './fixtures/app.fixture';

test.describe('desktop shell', () => {
  desktopOnly('shell-side redaction and the native save dialog');

  test('captures live renderer failures, filters issues, and exports a redacted LLM-readable report', async ({
    appDataDir,
    app,
    page,
  }) => {
    const electronApp = app.electronApp!;
    await page.evaluate(() => {
      const diagnostics = (
        window as unknown as {
          systemDiagnostics?: {
            record(entry: {
              level: 'error';
              source: string;
              message: string;
              details?: unknown;
            }): void;
          };
        }
      ).systemDiagnostics;
      diagnostics?.record({
        level: 'error',
        source: 'renderer:e2e',
        message:
          'Controlled renderer failure password=super-secret token=token-value',
        details: { authorization: 'Bearer ultra-secret', operation: 'e2e' },
      });
      window.dispatchEvent(
        new ErrorEvent('error', {
          message: 'Controlled interface exception',
          filename: 'diagnostics.e2e.ts',
          lineno: 42,
        }),
      );
    });

    await page.getByLabel('Open system logs').click();
    await expect(
      page.getByRole('heading', { name: 'System logs' }),
    ).toBeVisible();
    await page.getByRole('button', { name: /^Issues/ }).click();
    await page.getByLabel('Search system logs').fill('Controlled renderer');
    await expect(page.getByText(/Controlled renderer failure/)).toBeVisible();
    await expect(page.locator('app-system-logs-panel')).toContainText(
      '[REDACTED]',
    );
    await expect(page.locator('app-system-logs-panel')).not.toContainText(
      'super-secret',
    );
    await expect(page.locator('app-system-logs-panel')).not.toContainText(
      'token-value',
    );

    await page.getByLabel('Search system logs').fill('Controlled interface');
    await expect(
      page.getByText('Controlled interface exception').first(),
    ).toBeVisible();

    const exportPath = path.join(appDataDir, 'diagnostics-export.md');
    await electronApp.evaluate(({ dialog }, filePath) => {
      (
        dialog as unknown as { showSaveDialog: () => Promise<unknown> }
      ).showSaveDialog = async () => ({ canceled: false, filePath });
    }, exportPath);
    await page.getByRole('button', { name: 'Export', exact: true }).click();
    await expect(
      page.getByText(/Exported \d+ diagnostic entries/),
    ).toBeVisible();
    await expect.poll(() => fs.existsSync(exportPath)).toBe(true);

    const report = fs.readFileSync(exportPath, 'utf8');
    expect(report).toContain('# Questions to Insights — Diagnostics Report');
    expect(report).toContain('## Instructions for the analyzing LLM');
    expect(report).toContain('## Errors and warnings with nearby context');
    expect(report).toContain('## Chronological log');
    expect(report).toContain('Controlled renderer failure');
    expect(report).toContain('[REDACTED]');
    expect(report).not.toContain('super-secret');
    expect(report).not.toContain('token-value');
    expect(report).not.toContain('ultra-secret');
  });
});

test('replaces the help icon and supports log refresh, follow mode, and dismissal', async ({
  page,
}) => {
  await expect(page.getByTitle('Help')).toHaveCount(0);
  await page.getByLabel('Open system logs').click();
  await expect(page.getByLabel('Search system logs')).toBeVisible();
  await expect(page.getByLabel('Refresh logs')).toBeVisible();

  const follow = page.getByRole('checkbox', { name: 'Follow' });
  await expect(follow).toBeChecked();
  await follow.uncheck();
  await expect(follow).not.toBeChecked();
  await page.getByLabel('Refresh logs').click();
  await page.getByLabel('Close system logs').last().click();
  await expect(page.getByRole('heading', { name: 'System logs' })).toBeHidden();
});
