import {
  ArgumentsHost,
  Catch,
  INestApplication,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  BaseExceptionFilter,
  HttpAdapterHost,
  NestFactory,
} from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import type { Request, Response } from 'express';
import { existsSync } from 'node:fs';
import { AddressInfo } from 'node:net';
import { extname, join, resolve } from 'node:path';
import { AppModule } from './app.module';
import { startupDeveloperSettings } from './infrastructure/developer-settings/developer-settings.file';

export interface CreateAppOptions {
  port: number;
  /** Interface to bind; omitted = all interfaces (Node default). */
  host?: string;
  /** Directory holding the built web UI; defaults to `resolveWebRoot()`. */
  webRoot?: string;
  /** Allow cross-origin requests (Electron renderer runs from file://). */
  cors?: boolean;
}

export interface CreatedApp {
  app: INestApplication;
  url: string;
  port: number;
  /** Web root actually served, or null when only the API is available. */
  webRoot: string | null;
}

/** `WEB_ROOT` env, else `<package>/public` (next to `dist/`). */
export function resolveWebRoot(): string {
  return resolve(process.env.WEB_ROOT ?? join(__dirname, '..', 'public'));
}

export function hasWebUi(webRoot: string): boolean {
  return existsSync(join(webRoot, 'index.html'));
}

/**
 * SPA deep-link fallback. It hooks into Nest's own not-found path, so API
 * controllers always win: only requests that matched no route (and no static
 * file) and look like a browser navigation — GET, `Accept: text/html`, no file
 * extension — get `index.html`. Everything else keeps Nest's default 404.
 */
@Catch(NotFoundException)
class SpaFallbackFilter extends BaseExceptionFilter {
  constructor(
    adapterHost: HttpAdapterHost,
    private readonly indexHtml: string,
  ) {
    super(adapterHost.httpAdapter);
  }

  catch(exception: NotFoundException, host: ArgumentsHost) {
    if (host.getType() === 'http') {
      const http = host.switchToHttp();
      const req = http.getRequest<Request>();
      const res = http.getResponse<Response>();
      const unmatchedRoute = !req.route;
      if (
        unmatchedRoute &&
        !res.headersSent &&
        (req.method === 'GET' || req.method === 'HEAD') &&
        (req.headers.accept ?? '').includes('text/html') &&
        extname(req.path) === ''
      ) {
        res.sendFile(this.indexHtml);
        return;
      }
    }
    super.catch(exception, host);
  }
}

/**
 * With developer observability on, Nest log lines are also exported as
 * OpenTelemetry log records. The module (and the OpenTelemetry logs API under
 * it) is only required in that case.
 */
function installDeveloperLogExport(): void {
  if (!startupDeveloperSettings().observabilityEnabled) return;
  const { installNestLogExport } =
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('./infrastructure/telemetry/developer-nest-logger') as typeof import('./infrastructure/telemetry/developer-nest-logger');
  installNestLogExport();
}

export async function createApp(
  options: CreateAppOptions,
): Promise<CreatedApp> {
  const logger = new Logger('Bootstrap');
  installDeveloperLogExport();
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  if (options.cors) app.enableCors();

  const webRoot = options.webRoot ? resolve(options.webRoot) : resolveWebRoot();
  const serveWeb = hasWebUi(webRoot);
  if (serveWeb) {
    app.useStaticAssets(webRoot);
    app.useGlobalFilters(
      new SpaFallbackFilter(
        app.get(HttpAdapterHost),
        join(webRoot, 'index.html'),
      ),
    );
    logger.log(`Serving web UI from ${webRoot}`);
  } else {
    logger.log(
      `Web UI not found at ${webRoot} (no index.html) — serving API only`,
    );
  }

  await app.init();
  if (options.host) {
    await app.listen(options.port, options.host);
  } else {
    await app.listen(options.port);
  }

  const address = app.getHttpServer().address() as AddressInfo;
  const port = address.port;
  const displayHost =
    !options.host || options.host === '0.0.0.0' || options.host === '::'
      ? 'localhost'
      : options.host.includes(':')
        ? `[${options.host}]`
        : options.host;
  return {
    app,
    url: `http://${displayHost}:${port}`,
    port,
    webRoot: serveWeb ? webRoot : null,
  };
}
