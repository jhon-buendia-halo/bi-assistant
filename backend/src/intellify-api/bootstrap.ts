import {
  INestApplication,
  Logger,
  LoggerService,
  LogLevel,
  ValidationPipe,
} from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { readFileSync } from 'node:fs';
import { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { HttpErrorFilter } from './http-error.filter';
import type { IntellifyDbConfig } from './config';
import { DbService } from './db/db.service';
import { IntellifyApiModule } from './intellify-api.module';
import { mountOpenApi } from './openapi';

export interface CreateIntellifyApiOptions {
  /** 0 = a port the OS picks. */
  port: number;
  host: string;
  db: IntellifyDbConfig;
  /** One or more keys accepted in `X-API-Key`. */
  apiKeys: string[];
  /** Nest logger or levels; default errors, warnings and log lines. */
  logger?: LoggerService | LogLevel[] | false;
}

export interface CreatedIntellifyApi {
  app: INestApplication;
  /** Base URL without a trailing slash. */
  url: string;
  port: number;
  /** Resolves when the start-up migrations finished (rejects if they failed). */
  migrated: Promise<void>;
  close(): Promise<void>;
}

/** `version` of the backend package (`dist/intellify-api` → `../../package.json`). */
export function readPackageVersion(): string {
  try {
    const pkg = JSON.parse(
      readFileSync(join(__dirname, '..', '..', 'package.json'), 'utf8'),
    ) as { version?: string };
    return pkg.version ?? 'unknown';
  } catch {
    return 'unknown';
  }
}

/** Global pipe and filter of the API; shared with tests. */
export function configureIntellifyApp(app: INestApplication): void {
  app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));
  app.useGlobalFilters(new HttpErrorFilter());
}

/**
 * Starts the Intellify RFP API (ADR-0027) as its own NestJS application. A
 * missing database does not stop it: migrations run once in the background
 * (`migrated`), a failure is logged, and `/health` reports the database down.
 */
export async function createIntellifyApi(
  options: CreateIntellifyApiOptions,
): Promise<CreatedIntellifyApi> {
  const version = readPackageVersion();
  const app = await NestFactory.create<NestExpressApplication>(
    IntellifyApiModule.register({
      db: options.db,
      apiKeys: options.apiKeys,
      version,
    }),
    { logger: options.logger ?? ['log', 'warn', 'error'] },
  );
  configureIntellifyApp(app);
  // PUT bodies carry whole RFP sections and requirement lists.
  app.useBodyParser('json', { limit: '2mb' });
  mountOpenApi(app, version);
  await app.init();
  await app.listen(options.port, options.host);

  const port = (app.getHttpServer().address() as AddressInfo).port;
  const shown =
    options.host === '0.0.0.0' || options.host === '::'
      ? 'localhost'
      : options.host.includes(':')
        ? `[${options.host}]`
        : options.host;
  const logger = new Logger('IntellifyApi');
  const migrated = app
    .get(DbService)
    .migrate()
    .then(
      (applied) => {
        if (applied.length) {
          logger.log(`Applied rfp migrations: ${applied.join(', ')}`);
        }
      },
      (error: Error) => {
        logger.warn(`rfp migrations not applied: ${error.message}`);
        throw error;
      },
    );
  migrated.catch(() => undefined); // logged above; callers may still await it

  return {
    app,
    url: `http://${shown}:${port}`,
    port,
    migrated,
    close: () => app.close(),
  };
}
