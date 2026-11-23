import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { createZip } from '../../common/zip-archive';
import { DATA_DIR } from '../../infrastructure/database/database.module';
import { dashboardArchive } from '../../mastra/workflows/live-dashboard';
import { dashboardBlueprintSchema } from '../../mastra/workflows/recreate-dashboard.schemas';
import type { DashboardBlueprint } from '../../mastra/workflows/recreate-dashboard.steps';
import { IMAGE_EXTENSIONS } from '../../mastra/workflows/workflow-input';
import {
  ARTIFACT_NAME_MAX_LENGTH,
  type ArtifactDetail,
  type ArtifactDoc,
  type ArtifactSummary,
  type ArtifactVersion,
  type DashboardQuery,
  type DashboardRef,
  type DashboardRow,
  type DashboardVersionData,
} from './entities/artifact.entity';
import { ArtifactsRepository } from './repositories/artifacts.repository';

/**
 * The folder of the data dir that holds the artifacts' files: each image as
 * `<id>.<ext>`, each live version's rows as `<id>/v<N>/rows.json`.
 */
export const ARTIFACT_IMAGES_DIR = 'artifacts';

/** What a new artifact is made from. */
export interface NewArtifact {
  /** Its name; the dashboard's title when empty. */
  name?: string;
  /** The dashboard as data: checked against the blueprint's schema. */
  blueprint: unknown;
  /** The image the dashboard was read from, when there is one. */
  image?: { data: Buffer; mediaType: string };
  source?: { runId: string; workflowId: string };
}

/** A version a turn makes of a dashboard built on the user's data. */
export interface NewDashboardVersion {
  /** The dashboard as data: checked against the blueprint's schema. */
  blueprint: DashboardBlueprint;
  /** The query the rows came from. */
  query: DashboardQuery;
  /** The query's columns, in order. */
  columns: string[];
  /** The rows, numbers already numbers. */
  rows: DashboardRow[];
  /** What the user asked for that made this version. */
  instruction: string;
  source?: { runId: string; workflowId: string };
}

const VERSION_MESSAGE = 'Version must be a positive whole number';

/**
 * The `version` of a query string (api.md 145, 163): absent or empty for
 * the current version, else a positive whole number; 400 otherwise.
 */
export function versionParam(raw: unknown): number | undefined {
  if (raw === undefined || raw === null || raw === '') return undefined;
  if (typeof raw !== 'string' || !/^[1-9][0-9]*$/.test(raw)) {
    throw new BadRequestException(VERSION_MESSAGE);
  }
  const version = Number(raw);
  if (!Number.isSafeInteger(version)) {
    throw new BadRequestException(VERSION_MESSAGE);
  }
  return version;
}

/**
 * The artifacts (api.md 2.6.4; data-model 3.18): reusable context saved from
 * workflow runs, listed in the Artifacts area and taken by a later run in
 * place of what it would otherwise produce again. Today one kind,
 * `dashboard`: the blueprint of a recreated dashboard (agents.md 5.17), or a
 * dashboard a turn built on the user's data, with a version per change and
 * a row snapshot per version.
 */
@Injectable()
export class ArtifactsService {
  private readonly logger = new Logger(ArtifactsService.name);

  constructor(private readonly repository: ArtifactsRepository) {}

  /** Every artifact, newest first (api.md 144). */
  async list(): Promise<ArtifactSummary[]> {
    return (await this.repository.list()).map((doc) => summaryOf(doc));
  }

  /**
   * One artifact with its dashboard (api.md 145), at a version (the current
   * one when none is given); 404 when unknown.
   */
  async get(
    id: string,
    version?: number,
  ): Promise<Omit<ArtifactDetail, 'document'>> {
    return (await this.detail(id, version)).artifact;
  }

  /**
   * One artifact at a version with that version's rows (null when it has
   * none, or its file is gone): 404 when the artifact or the version is
   * unknown. The controller draws the dashboard: the document builder is
   * not loaded here, so the services that use this one stay light.
   */
  async detail(
    id: string,
    version?: number,
  ): Promise<{
    artifact: Omit<ArtifactDetail, 'document'>;
    rows: DashboardRow[] | null;
  }> {
    const doc = await this.stored(id);
    const shown = versionOf(doc, version);
    const rows = await this.rowsOf(id, shown);
    return {
      artifact: {
        ...summaryOf(doc),
        description: shown.blueprint.summary,
        widgetCount: shown.blueprint.widgets.length,
        filterCount: shown.blueprint.filters.length,
        hasData: rows !== null,
        version: shown.version,
        versions: versionsOf(doc).map((entry) => ({
          version: entry.version,
          createdAt: entry.createdAt,
          ...(entry.instruction ? { instruction: entry.instruction } : {}),
          ...(entry.rowCount !== undefined ? { rowCount: entry.rowCount } : {}),
          widgetCount: entry.blueprint.widgets.length,
          filterCount: entry.blueprint.filters.length,
        })),
        ...(shown.query ? { query: shown.query } : {}),
        ...(shown.dataFile && rows === null
          ? { dataMissing: true as const }
          : {}),
        blueprint: shown.blueprint,
      },
      rows,
    };
  }

  /**
   * A dashboard version with its rows, for a turn that changes it and for
   * the download: 404 when the artifact or the version is unknown.
   */
  async dashboardVersion(
    id: string,
    version?: number,
  ): Promise<DashboardVersionData> {
    const doc = await this.stored(id);
    const shown = versionOf(doc, version);
    return {
      artifactId: id,
      version: shown.version,
      title: shown.blueprint.title,
      name: doc.name,
      blueprint: shown.blueprint,
      ...(shown.query ? { query: shown.query } : {}),
      columns:
        shown.columns ?? shown.blueprint.columns.map((column) => column.name),
      rowCount: shown.rowCount ?? 0,
      widgetCount: shown.blueprint.widgets.length,
      filterCount: shown.blueprint.filters.length,
      ...(shown.instruction ? { instruction: shown.instruction } : {}),
      createdAt: shown.createdAt,
      rows: await this.rowsOf(id, shown),
    };
  }

  /**
   * A dashboard version as a zip of plain HTML, JS and CSS (api.md 163):
   * 404 when the artifact or the version is unknown.
   */
  async download(
    id: string,
    version?: number,
  ): Promise<{ filename: string; archive: Buffer }> {
    const shown = await this.dashboardVersion(id, version);
    const { filename, entries } = dashboardArchive({
      id,
      name: shown.name,
      version: shown.version,
      blueprint: shown.blueprint,
      rows: shown.rows,
      ...(shown.query ? { query: shown.query } : {}),
      createdAt: shown.createdAt,
    });
    const made = new Date(shown.createdAt);
    return {
      filename,
      archive: createZip(
        entries,
        Number.isNaN(made.getTime()) ? new Date() : made,
      ),
    };
  }

  /** The image an artifact's dashboard was read from (api.md 146); 404. */
  async image(id: string): Promise<{ data: Buffer; mediaType: string }> {
    const doc = await this.stored(id);
    const missing = () =>
      new NotFoundException(`Artifact "${id}" has no image`);
    if (!doc.image) throw missing();
    try {
      return {
        data: await readFile(imagePath(doc.image.file)),
        mediaType: doc.image.mediaType,
      };
    } catch {
      throw missing();
    }
  }

  /**
   * Store a new artifact (agents.md 5.17): 400 when the blueprint is not a
   * dashboard's or the name is too long. Its image is written to the data
   * dir first; a failure to write it stores the artifact without it.
   */
  async create(input: NewArtifact): Promise<ArtifactSummary> {
    const blueprint = checkedBlueprint(input.blueprint);
    const id = randomUUID();
    const name = checkedName(input.name?.trim() || blueprint.title);
    let image: ArtifactDoc['image'];
    const extension = input.image
      ? IMAGE_EXTENSIONS[input.image.mediaType]
      : undefined;
    if (input.image && extension) {
      const file = `${id}.${extension}`;
      try {
        await mkdir(join(DATA_DIR, ARTIFACT_IMAGES_DIR), { recursive: true });
        await writeFile(imagePath(file), input.image.data);
        image = { file, mediaType: input.image.mediaType };
      } catch (error) {
        this.logger.warn(
          `Could not store the image of artifact ${id}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
    const stored = await this.repository.insert({
      id,
      kind: 'dashboard',
      name,
      description: blueprint.summary,
      blueprint,
      ...(image ? { image } : {}),
      ...(input.source ? { source: input.source } : {}),
    });
    return summaryOf(stored);
  }

  /**
   * Store a dashboard a turn built on the user's data as version 1 of a new
   * artifact: 400 when the blueprint is not a dashboard's or the name is
   * too long. Its rows go to a file of the data dir first.
   */
  async createDashboard(
    input: NewDashboardVersion & { name?: string },
  ): Promise<DashboardRef> {
    const blueprint = checkedBlueprint(input.blueprint);
    const id = randomUUID();
    const name = checkedName(input.name?.trim() || blueprint.title);
    const version = await this.writeVersion(id, 1, blueprint, input);
    try {
      await this.repository.insert({
        id,
        kind: 'dashboard',
        name,
        description: blueprint.summary,
        blueprint,
        ...(input.source ? { source: input.source } : {}),
        currentVersion: 1,
        versions: [version],
      });
    } catch (error) {
      await this.removeFolder(id);
      throw error;
    }
    return refOf(id, version, 'created');
  }

  /**
   * Add the next version to a dashboard artifact; it becomes the current
   * one. 404 when unknown, 400 when the blueprint is not a dashboard's. A
   * dashboard saved before versions keeps what it held as version 1.
   */
  async addDashboardVersion(
    id: string,
    input: NewDashboardVersion,
  ): Promise<DashboardRef> {
    const blueprint = checkedBlueprint(input.blueprint);
    const doc = await this.stored(id);
    const versions = versionsOf(doc);
    const next = Math.max(0, ...versions.map((entry) => entry.version)) + 1;
    const version = await this.writeVersion(id, next, blueprint, input);
    const updated = await this.repository.update(id, {
      blueprint,
      description: blueprint.summary,
      currentVersion: next,
      versions: [...versions, version],
    });
    if (!updated) throw notFound(id);
    return refOf(id, version, 'updated');
  }

  /** Rename an artifact (api.md 147): 400 for a bad name, 404 when unknown. */
  async rename(id: string, body: unknown): Promise<ArtifactSummary> {
    const raw =
      body && typeof body === 'object'
        ? (body as { name?: unknown }).name
        : undefined;
    const name = checkedName(typeof raw === 'string' ? raw.trim() : '');
    await this.stored(id);
    const updated = await this.repository.update(id, { name });
    if (!updated) throw notFound(id);
    return summaryOf(updated);
  }

  /**
   * Delete an artifact, its image and its versions' rows (api.md 148); 404
   * when unknown.
   */
  async delete(id: string): Promise<void> {
    const doc = await this.stored(id);
    await this.repository.delete(id);
    await this.removeFolder(id);
    if (!doc.image) return;
    try {
      await rm(imagePath(doc.image.file), { force: true });
    } catch (error) {
      this.logger.warn(
        `Could not delete the image of artifact ${id}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /** Write a version's rows to its file and describe the version. */
  private async writeVersion(
    id: string,
    version: number,
    blueprint: DashboardBlueprint,
    input: NewDashboardVersion,
  ): Promise<ArtifactVersion> {
    const dataFile = `${ARTIFACT_IMAGES_DIR}/${id}/v${version}/rows.json`;
    const path = join(DATA_DIR, dataFile);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(
      path,
      JSON.stringify({ columns: input.columns, rows: input.rows }),
    );
    return {
      version,
      blueprint,
      query: input.query,
      columns: [...input.columns],
      rowCount: input.rows.length,
      dataFile,
      instruction: input.instruction,
      ...(input.source ? { source: input.source } : {}),
      createdAt: new Date().toISOString(),
    };
  }

  /** A version's rows, or null when it has none or its file is unreadable. */
  private async rowsOf(
    id: string,
    version: ArtifactVersion,
  ): Promise<DashboardRow[] | null> {
    if (!version.dataFile || !isDataFile(id, version.dataFile)) return null;
    try {
      const parsed = JSON.parse(
        await readFile(join(DATA_DIR, version.dataFile), 'utf8'),
      ) as { rows?: unknown };
      return Array.isArray(parsed.rows)
        ? (parsed.rows as DashboardRow[])
        : null;
    } catch {
      return null;
    }
  }

  /** Remove the folder of an artifact's versions' rows. */
  private async removeFolder(id: string): Promise<void> {
    try {
      await rm(join(DATA_DIR, ARTIFACT_IMAGES_DIR, id), {
        recursive: true,
        force: true,
      });
    } catch (error) {
      this.logger.warn(
        `Could not delete the data of artifact ${id}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private async stored(id: string): Promise<ArtifactDoc> {
    const doc = await this.repository.get(id);
    if (!doc) throw notFound(id);
    return doc;
  }
}

function notFound(id: string): NotFoundException {
  return new NotFoundException(`Artifact "${id}" not found`);
}

/**
 * Every version of an artifact, oldest first. A doc saved before versions
 * reads as one version: what it holds, without data.
 */
function versionsOf(doc: ArtifactDoc): ArtifactVersion[] {
  if (doc.versions?.length) return doc.versions;
  return [
    {
      version: 1,
      blueprint: doc.blueprint,
      ...(doc.source ? { source: doc.source } : {}),
      createdAt: doc.createdAt ?? new Date().toISOString(),
    },
  ];
}

function currentOf(doc: ArtifactDoc, versions: ArtifactVersion[]): number {
  return doc.currentVersion ?? versions[versions.length - 1].version;
}

/** The version asked for, or the current one; 404 when there is none. */
function versionOf(doc: ArtifactDoc, version?: number): ArtifactVersion {
  const versions = versionsOf(doc);
  const wanted = version ?? currentOf(doc, versions);
  const found = versions.find((entry) => entry.version === wanted);
  if (!found) {
    throw new NotFoundException(
      `Artifact "${doc.id}" has no version ${wanted}`,
    );
  }
  return found;
}

/** Only a rows file of this artifact's own folder is read. */
function isDataFile(id: string, file: string): boolean {
  const folder = `${ARTIFACT_IMAGES_DIR}/${id}/`;
  return (
    file.startsWith(folder) &&
    /^v[0-9]+\/rows\.json$/.test(file.slice(folder.length))
  );
}

/** A dashboard's blueprint, or the 400 that says it is not one. */
function checkedBlueprint(value: unknown): DashboardBlueprint {
  const parsed = dashboardBlueprintSchema.safeParse(value);
  if (!parsed.success || !parsed.data.widgets.length) {
    throw new BadRequestException('The dashboard to save is not valid');
  }
  return parsed.data;
}

/** A version as the answer card shows it. */
function refOf(
  artifactId: string,
  version: ArtifactVersion,
  action: DashboardRef['action'],
): DashboardRef {
  return {
    artifactId,
    version: version.version,
    title: version.blueprint.title,
    action,
    widgetCount: version.blueprint.widgets.length,
    filterCount: version.blueprint.filters.length,
    rowCount: version.rowCount ?? 0,
  };
}

/** Where an artifact's image is: a plain file name under the images dir. */
function imagePath(file: string): string {
  return join(DATA_DIR, ARTIFACT_IMAGES_DIR, file);
}

/** A name of 1 to 80 characters, or the 400 that says why not. */
function checkedName(name: string): string {
  if (!name) throw new BadRequestException('Name is required');
  if (name.length > ARTIFACT_NAME_MAX_LENGTH) {
    throw new BadRequestException(
      `Name must be at most ${ARTIFACT_NAME_MAX_LENGTH} characters`,
    );
  }
  return name;
}

/** An artifact as the list shows it: the counts are the current version's. */
export function summaryOf(doc: ArtifactDoc): ArtifactSummary {
  const now = new Date().toISOString();
  const versions = versionsOf(doc);
  const currentVersion = currentOf(doc, versions);
  const current = versions.find((entry) => entry.version === currentVersion);
  return {
    id: doc.id,
    kind: doc.kind,
    name: doc.name,
    description: doc.description,
    widgetCount: doc.blueprint.widgets.length,
    filterCount: doc.blueprint.filters.length,
    hasImage: doc.image !== undefined,
    ...(doc.source ? { source: doc.source } : {}),
    currentVersion,
    versionCount: versions.length,
    hasData: current?.dataFile !== undefined,
    createdAt: doc.createdAt ?? now,
    updatedAt: doc.updatedAt ?? doc.createdAt ?? now,
  };
}
