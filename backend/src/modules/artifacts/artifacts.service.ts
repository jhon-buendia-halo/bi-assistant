import {
  BadRequestException,
  ConflictException,
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
import {
  dashboardBlueprintSchema,
  type DashboardBlueprint,
} from '../../mastra/workflows/dashboard-blueprint.schemas';
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
  isDraft,
  isSavedVersion,
} from './entities/artifact.entity';
import { ArtifactsRepository } from './repositories/artifacts.repository';

/**
 * The folder of the data dir that holds the artifacts' files: each image as
 * `<id>.<ext>`, each live version's rows as `<id>/v<N>/rows.json`.
 */
export const ARTIFACT_IMAGES_DIR = 'artifacts';

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

/** Why a version that is not saved to Artifacts is not downloaded (api.md 165). */
export const DOWNLOAD_DRAFT_MESSAGE =
  'Save the dashboard to Artifacts before downloading it';

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
 * `dashboard`: a dashboard a turn built on the user's data, with a version
 * per change and a row snapshot per version, or a blueprint stored by an
 * earlier version of the app, with no versions and maybe an image.
 */
@Injectable()
export class ArtifactsService {
  private readonly logger = new Logger(ArtifactsService.name);

  constructor(private readonly repository: ArtifactsRepository) {}

  /**
   * Every artifact with a saved version, newest first, each as its latest
   * saved version (api.md 144): a draft stays out of the list.
   */
  async list(): Promise<ArtifactSummary[]> {
    return (await this.repository.list())
      .filter((doc) => !isDraft(doc))
      .map((doc) => summaryOf(doc));
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
   * One artifact at a version, the latest one (saved or a draft) when none
   * is given, with that version's rows (null when it has none, or its file
   * is gone): 404 when the artifact or the version is unknown. A draft is
   * read too: the run's dashboard panel draws it. The controller draws the dashboard: the document builder is
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
    const savedVersions = savedVersionsOf(doc);
    return {
      artifact: {
        ...summaryOf(doc),
        description: shown.blueprint.summary,
        widgetCount: shown.blueprint.widgets.length,
        filterCount: shown.blueprint.filters.length,
        hasData: rows !== null,
        version: shown.version,
        status: savedVersions.length ? 'saved' : 'draft',
        savedVersions,
        versions: versionsOf(doc).map((entry) => ({
          version: entry.version,
          createdAt: entry.createdAt,
          ...(entry.instruction ? { instruction: entry.instruction } : {}),
          ...(entry.rowCount !== undefined ? { rowCount: entry.rowCount } : {}),
          widgetCount: entry.blueprint.widgets.length,
          filterCount: entry.blueprint.filters.length,
          saved: isSavedVersion(doc, entry.version),
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
   * A saved dashboard version as a zip of plain HTML, JS and CSS (api.md
   * 163), the latest saved one when none is given: 404 when the artifact or
   * the version is unknown, 409 when the version is not saved (or none is).
   */
  async download(
    id: string,
    version?: number,
  ): Promise<{ filename: string; archive: Buffer }> {
    const doc = await this.stored(id);
    const wanted =
      version === undefined
        ? savedVersionsOf(doc).at(-1)
        : versionOf(doc, version).version;
    if (wanted === undefined || !isSavedVersion(doc, wanted)) {
      throw new ConflictException(DOWNLOAD_DRAFT_MESSAGE);
    }
    const shown = await this.dashboardVersion(id, wanted);
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

  /**
   * Save a version to Artifacts (api.md 166), the latest one when the body
   * names none: from then on the artifact is listed and the version can be
   * downloaded. Saving a saved version changes nothing. 400 for a bad
   * version, 404 when the artifact or the version is unknown. Answers the
   * artifact at that version, as `detail` does.
   */
  async save(
    id: string,
    body: unknown,
  ): Promise<Awaited<ReturnType<ArtifactsService['detail']>>> {
    const version = savedVersionParam(body);
    const doc = await this.stored(id);
    const shown = versionOf(doc, version);
    if (!isSavedVersion(doc, shown.version)) {
      const savedVersions = [...(doc.savedVersions ?? []), shown.version].sort(
        (a, b) => a - b,
      );
      const updated = await this.repository.update(id, { savedVersions });
      if (!updated) throw notFound(id);
    }
    return this.detail(id, shown.version);
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
   * Store a dashboard a turn built on the user's data as version 1 of a new
   * artifact, a draft until the user saves it: 400 when the blueprint is
   * not a dashboard's or the name is too long. Its rows go to a file of the
   * data dir first.
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
        savedVersions: [],
      });
    } catch (error) {
      await this.removeFolder(id);
      throw error;
    }
    return refOf(id, version, 'created');
  }

  /**
   * Add the next version to a dashboard artifact; it becomes the current
   * one, a draft until the user saves it, and the saved versions stay
   * saved. 404 when unknown, 400 when the blueprint is not a dashboard's. A
   * dashboard saved before versions keeps what it held as version 1, saved.
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
      // A doc without versions had every version saved: it keeps version 1.
      ...(Array.isArray(doc.versions)
        ? {}
        : { savedVersions: versions.map((entry) => entry.version) }),
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

  /**
   * Whether a version of an artifact is saved to Artifacts now (a run's
   * dashboard card reads it: its stored ref is a snapshot from the run);
   * null when the artifact is gone.
   */
  async isVersionSaved(id: string, version: number): Promise<boolean | null> {
    const doc = await this.repository.get(id);
    return doc ? isSavedVersion(doc, version) : null;
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

/**
 * The saved versions of an artifact, oldest first: every version of a doc
 * without versions, else those of `savedVersions` that exist.
 */
function savedVersionsOf(doc: ArtifactDoc): number[] {
  return versionsOf(doc)
    .map((entry) => entry.version)
    .filter((version) => isSavedVersion(doc, version))
    .sort((a, b) => a - b);
}

/**
 * The `version` of a save's body (api.md 166): absent for the latest
 * version, else a positive whole number; 400 otherwise.
 */
function savedVersionParam(body: unknown): number | undefined {
  if (body === undefined || body === null) return undefined;
  if (typeof body !== 'object' || Array.isArray(body)) {
    throw new BadRequestException(VERSION_MESSAGE);
  }
  const version = (body as { version?: unknown }).version;
  if (version === undefined) return undefined;
  if (
    typeof version !== 'number' ||
    !Number.isSafeInteger(version) ||
    version < 1
  ) {
    throw new BadRequestException(VERSION_MESSAGE);
  }
  return version;
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
    // A turn's version is never saved: the user saves it to Artifacts.
    saved: false,
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

/**
 * An artifact as the list shows it (api.md 144): its latest saved version,
 * with that version's counts and the number of saved versions. A draft,
 * which has none, shows its current version and every version.
 */
export function summaryOf(doc: ArtifactDoc): ArtifactSummary {
  const now = new Date().toISOString();
  const versions = versionsOf(doc);
  const saved = versions.filter((entry) => isSavedVersion(doc, entry.version));
  const counted = saved.length ? saved : versions;
  const currentVersion = saved.length
    ? Math.max(...saved.map((entry) => entry.version))
    : currentOf(doc, versions);
  const current =
    versions.find((entry) => entry.version === currentVersion) ??
    versions[versions.length - 1];
  return {
    id: doc.id,
    kind: doc.kind,
    name: doc.name,
    // The top-level description is the current version's.
    description:
      current.version === currentOf(doc, versions)
        ? doc.description
        : current.blueprint.summary,
    widgetCount: current.blueprint.widgets.length,
    filterCount: current.blueprint.filters.length,
    hasImage: doc.image !== undefined,
    ...(doc.source ? { source: doc.source } : {}),
    currentVersion,
    versionCount: counted.length,
    hasData: current.dataFile !== undefined,
    createdAt: doc.createdAt ?? now,
    updatedAt: doc.updatedAt ?? doc.createdAt ?? now,
  };
}
