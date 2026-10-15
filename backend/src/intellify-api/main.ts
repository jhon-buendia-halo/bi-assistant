/**
 * Standalone entry (`npm run intellify-api`): runs the Intellify RFP API alone,
 * configured from the environment only (api.md 2.16, 6.1).
 */
import { createIntellifyApi } from './bootstrap';
import { intellifyApiConfig } from './config';

async function main(): Promise<void> {
  const config = intellifyApiConfig();
  if (!config.apiKeys.length) {
    console.error(
      'intellify-api: INTELLIFY_API_KEY is required (one key, or several separated by commas).',
    );
    process.exit(1);
  }
  const api = await createIntellifyApi({
    port: config.port,
    host: config.host,
    db: config.db,
    apiKeys: config.apiKeys,
  });
  console.log(`Intellify API listening on ${api.url}`);

  let closing = false;
  const shutdown = () => {
    if (closing) return;
    closing = true;
    api
      .close()
      .catch(() => undefined)
      .finally(() => process.exit(0));
    setTimeout(() => process.exit(0), 5000).unref();
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((error: unknown) => {
  console.error(`intellify-api: ${(error as Error).message ?? error}`);
  process.exit(1);
});
