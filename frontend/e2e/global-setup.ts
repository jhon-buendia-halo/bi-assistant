import { execFileSync } from 'node:child_process';
import { createConnection } from 'node:net';
import path from 'node:path';

const repositoryRoot = path.resolve(__dirname, '../..');

function portIsOpen(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection({ host: '127.0.0.1', port });
    socket.setTimeout(500);
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    const unavailable = () => {
      socket.destroy();
      resolve(false);
    };
    socket.once('error', unavailable);
    socket.once('timeout', unavailable);
  });
}

export default async function globalSetup(): Promise<void> {
  if (await portIsOpen(3000)) {
    throw new Error(
      'Port 3000 is already in use. Close the running Questions to Insights app before running the Electron integration suite.',
    );
  }

  if (process.env['E2E_SKIP_DOCKER'] === '1') return;

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
