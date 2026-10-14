import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { mkdir, readFile, readdir, rm, stat, writeFile } from 'fs/promises';
import { dirname, isAbsolute, join, posix, relative, resolve, sep } from 'path';
import { sessionWorkspacePath } from '../../mastra/session-workspaces';
import { DatasourcesService } from '../datasources/datasources.service';
import { buildHeaders } from '../datasources/connectors/rest.connector';
import type { RestApiConfig } from '../datasources/entities/datasource.entity';
import type { RestTarget, RfpPackageResult } from '../../mastra/tool-services';
import { createZip } from '../sessions/zip-archive';
import { readZip } from './zip-reader';

/** A file served by the package download route (api.md #105). */
export interface RfpPackageDownload {
  filename: string;
  contentType: string;
  body: Buffer;
}

/** Same budget as the RFP tools' calls (agents.md 3.10). */
const REQUEST_TIMEOUT_MS = 20_000;
/** Workspace folder holding one package per RFP (data-model 4.1). */
const PACKAGES_DIR = 'rfp';
/** RFP ids are UUIDs; anything else never names a package folder. */
const RFP_ID = /^[A-Za-z0-9_-]+$/;

const CONTENT_TYPES: Record<string, string> = {
  '.md': 'text/markdown',
  '.pdf': 'application/pdf',
  '.csv': 'text/csv',
  '.json': 'application/json',
};

/**
 * The app's side of the Intellify RFP API for the RFP Builder (ADR-0028):
 * the REST target the RFP tools call, the package export into the session
 * workspace, and the package download (api.md #105). The download never
 * calls the API: it serves what the export stored.
 */
@Injectable()
export class RfpPackagesService {
  constructor(private readonly datasources: DatasourcesService) {}

  /**
   * The base URL and headers of a REST datasource, secrets resolved on the
   * server and headers built as the REST connector builds them (agents.md
   * 3.10), so the API key goes in `X-API-Key`.
   */
  async restTarget(datasourceId: string): Promise<RestTarget> {
    const datasource = await this.datasources.get(datasourceId);
    if (datasource.kind !== 'rest') {
      throw new BadRequestException(
        `Datasource "${datasource.name}" is not a REST datasource`,
      );
    }
    const config = datasource.config as RestApiConfig;
    return {
      baseUrl: (config.baseUrl ?? '').trim().replace(/\/+$/, ''),
      headers: buildHeaders(config),
    };
  }

  /** `GET <path>` on the datasource's API as JSON; throws the API's error. */
  async getJson(datasourceId: string, path: string): Promise<unknown> {
    const target = await this.restTarget(datasourceId);
    const response = await this.call(target, path, 'application/json');
    return response.json();
  }

  /**
   * Fetch `GET /v1/rfps/:id/package.zip` and unzip it into the session
   * workspace `rfp/<rfpId>/`, replacing what an earlier export stored there
   * (the record is the source of truth; data-model 4.1).
   */
  async exportRfpPackage(
    sessionId: string,
    datasourceId: string,
    rfpId: string,
  ): Promise<RfpPackageResult> {
    if (!RFP_ID.test(rfpId ?? '')) {
      throw new BadRequestException(`Invalid RFP id "${rfpId}"`);
    }
    const target = await this.restTarget(datasourceId);
    const response = await this.call(
      target,
      `/v1/rfps/${encodeURIComponent(rfpId)}/package.zip`,
      'application/zip',
    );
    const files = readZip(Buffer.from(await response.arrayBuffer()));
    for (const file of files) {
      if (!safeRelativePath(file.name)) {
        throw new Error(`The RFP package holds an unsafe path "${file.name}"`);
      }
    }
    const folder = packageFolder(sessionId, rfpId);
    await rm(folder, { recursive: true, force: true });
    await mkdir(folder, { recursive: true });
    for (const file of files) {
      const path = join(folder, file.name);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, file.data);
    }
    return {
      rfpId,
      title: manifestTitle(files.find((f) => f.name === 'manifest.json')?.data),
      files: files.map((file) => ({
        name: file.name,
        bytes: file.data.length,
      })),
      exportedAt: new Date().toISOString(),
    };
  }

  /**
   * The stored package as a zip, or one of its files (api.md #105). The
   * caller has already checked the session belongs to the current user.
   */
  async download(
    sessionId: string,
    rfpId: string,
    file?: string,
  ): Promise<RfpPackageDownload> {
    const notFound = () =>
      new NotFoundException(`RFP package "${rfpId}" not found`);
    if (!RFP_ID.test(rfpId ?? '')) throw notFound();
    const folder = packageFolder(sessionId, rfpId);
    if (!(await isDirectory(folder))) throw notFound();

    if (file) {
      const name = safeRelativePath(file);
      if (!name) throw new BadRequestException(`Invalid file name "${file}"`);
      const path = resolve(folder, name);
      const inside = relative(folder, path);
      if (!inside || inside.startsWith('..') || isAbsolute(inside)) {
        throw new BadRequestException(`Invalid file name "${file}"`);
      }
      if (!(await isFile(path))) {
        throw new NotFoundException(
          `RFP package "${rfpId}" has no file "${file}"`,
        );
      }
      return {
        filename: posix.basename(name),
        contentType: contentTypeOf(name),
        body: await readFile(path),
      };
    }

    const names = await listFiles(folder);
    if (!names.length) throw notFound();
    const entries = await Promise.all(
      names.map(async (name) => ({
        name,
        data: await readFile(join(folder, name)),
      })),
    );
    const manifest = entries.find((e) => e.name === 'manifest.json')?.data;
    const title = manifest ? manifestTitle(manifest, '') : '';
    return {
      filename: `rfp-${slug(title) || rfpId.slice(0, 8)}.zip`,
      contentType: 'application/zip',
      body: createZip(entries),
    };
  }

  /** One HTTP call to the API, errors shaped as the RFP tools shape them. */
  private async call(
    target: RestTarget,
    path: string,
    accept: string,
  ): Promise<Response> {
    let response: Response;
    try {
      response = await fetch(`${target.baseUrl}${path}`, {
        headers: { ...target.headers, Accept: accept },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (error) {
      const cause = error instanceof Error ? error.message : String(error);
      throw new Error(
        `Intellify API unreachable at ${target.baseUrl}: ${cause}`,
      );
    }
    if (!response.ok) throw new Error(await apiError(response));
    return response;
  }
}

/** `rfp/<rfpId>/` in the session workspace (data-model 4.1). */
function packageFolder(sessionId: string, rfpId: string): string {
  return join(sessionWorkspacePath(sessionId), PACKAGES_DIR, rfpId);
}

/**
 * A package-relative path in `/` form, or undefined for an absolute path, a
 * `..` segment or an empty name.
 */
function safeRelativePath(name: string): string | undefined {
  const normalized = name.replace(/\\/g, '/');
  if (
    !normalized ||
    normalized.startsWith('/') ||
    /^[a-zA-Z]:/.test(normalized)
  ) {
    return undefined;
  }
  const segments = normalized.split('/');
  if (segments.some((s) => s === '..' || s === '.' || s === '')) {
    return undefined;
  }
  return segments.join('/');
}

/** `<status> <code>: <message>[; <details>]` from the API's error shape. */
async function apiError(response: Response): Promise<string> {
  let body: {
    code?: unknown;
    error?: unknown;
    message?: unknown;
    details?: unknown;
  } = {};
  try {
    body = (await response.json()) as typeof body;
  } catch {
    body = {};
  }
  const code =
    typeof body.code === 'string'
      ? body.code
      : typeof body.error === 'string'
        ? body.error
        : response.statusText || 'error';
  const message =
    typeof body.message === 'string' ? body.message : 'request failed';
  const details =
    body.details === undefined
      ? ''
      : `; ${typeof body.details === 'string' ? body.details : JSON.stringify(body.details)}`;
  return `${response.status} ${code}: ${message}${details}`;
}

function manifestTitle(
  manifest: Buffer | undefined,
  fallback = 'RFP package',
): string {
  if (!manifest) return fallback;
  try {
    const parsed = JSON.parse(manifest.toString('utf8')) as { title?: unknown };
    return typeof parsed.title === 'string' && parsed.title.trim()
      ? parsed.title
      : fallback;
  } catch {
    return fallback;
  }
}

/** As the visual download's slug (api.md #14). */
function slug(title: string): string {
  return title
    .normalize('NFKD')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase()
    .slice(0, 64);
}

function contentTypeOf(name: string): string {
  const extension = posix.extname(name).toLowerCase();
  return CONTENT_TYPES[extension] ?? 'application/octet-stream';
}

async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

async function isFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

/** Every file under `folder`, as sorted `/`-separated relative paths. */
async function listFiles(folder: string): Promise<string[]> {
  const entries = await readdir(folder, {
    recursive: true,
    withFileTypes: true,
  });
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) =>
      relative(folder, join(entry.parentPath, entry.name)).split(sep).join('/'),
    )
    .sort();
}
