import { execFileSync } from 'node:child_process';
import path from 'node:path';

const repositoryRoot = path.resolve(__dirname, '../..');

export default async function globalSetup(): Promise<void> {
  if (process.env['E2E_SKIP_DOCKER'] === '1') return;
  // An external World Cup database (E2E_WORLD_CUP_DB_HOST) needs no Docker.
  if (process.env['E2E_WORLD_CUP_DB_HOST']) return;

  try {
    execFileSync('docker', ['compose', 'up', '-d', '--wait', 'postgres'], {
      cwd: repositoryRoot,
      stdio: 'inherit',
    });
  } catch (error) {
    throw new Error(
      'Could not start the seeded World Cup PostgreSQL service. Start Docker and retry, or set E2E_SKIP_DOCKER=1 when an equivalent database is already running.',
      { cause: error },
    );
  }
}
