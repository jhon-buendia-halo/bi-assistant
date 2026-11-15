import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { DATA_DIR } from '../../infrastructure/database/database.module';
import { dashboardBlueprintSchema } from '../../mastra/workflows/recreate-dashboard.schemas';
import type { DashboardBlueprint } from '../../mastra/workflows/recreate-dashboard.steps';
import { IMAGE_EXTENSIONS } from '../../mastra/workflows/workflow-input';
import {
  ARTIFACT_NAME_MAX_LENGTH,
  type ArtifactDetail,
  type ArtifactDoc,
  type ArtifactSummary,
} from './entities/artifact.entity';
import { ArtifactsRepository } from './repositories/artifacts.repository';

/** The folder of the data dir that holds the artifacts' images. */
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

/**
 * The artifacts (api.md 2.6.4; data-model 3.18): reusable context saved from
 * workflow runs, listed in the Artifacts area and taken by a later run in
 * place of what it would otherwise produce again. Today one kind,
 * `dashboard`: the blueprint of a recreated dashboard (agents.md 5.17).
 */
@Injectable()
export class ArtifactsService {
  private readonly logger = new Logger(ArtifactsService.name);

  constructor(private readonly repository: ArtifactsRepository) {}

  /** Every artifact, newest first (api.md 139). */
  async list(): Promise<ArtifactSummary[]> {
    return (await this.repository.list()).map((doc) => summaryOf(doc));
  }

  /**
   * One artifact with its dashboard (api.md 140); 404 when unknown. The
   * controller draws the dashboard: the document builder is not loaded
   * here, so the services that use this one stay light.
   */
  async get(id: string): Promise<Omit<ArtifactDetail, 'document'>> {
    const doc = await this.stored(id);
    return { ...summaryOf(doc), blueprint: doc.blueprint };
  }

  /** The dashboard a run takes from an artifact (agents.md 5.17); 404. */
  async blueprintOf(id: string): Promise<DashboardBlueprint> {
    return (await this.stored(id)).blueprint;
  }

  /** The image an artifact's dashboard was read from (api.md 141); 404. */
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
   * Store a new artifact (api.md 144): 400 when the blueprint is not a
   * dashboard's or the name is too long. Its image is written to the data
   * dir first; a failure to write it stores the artifact without it.
   */
  async create(input: NewArtifact): Promise<ArtifactSummary> {
    const parsed = dashboardBlueprintSchema.safeParse(input.blueprint);
    if (!parsed.success || !parsed.data.widgets.length) {
      throw new BadRequestException('The dashboard to save is not valid');
    }
    const blueprint = parsed.data;
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

  /** Rename an artifact (api.md 142): 400 for a bad name, 404 when unknown. */
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

  /** Delete an artifact and its image (api.md 143); 404 when unknown. */
  async delete(id: string): Promise<void> {
    const doc = await this.stored(id);
    await this.repository.delete(id);
    if (!doc.image) return;
    try {
      await rm(imagePath(doc.image.file), { force: true });
    } catch (error) {
      this.logger.warn(
        `Could not delete the image of artifact ${id}: ${error instanceof Error ? error.message : String(error)}`,
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

/** An artifact as the list shows it. */
export function summaryOf(doc: ArtifactDoc): ArtifactSummary {
  const now = new Date().toISOString();
  return {
    id: doc.id,
    kind: doc.kind,
    name: doc.name,
    description: doc.description,
    widgetCount: doc.blueprint.widgets.length,
    filterCount: doc.blueprint.filters.length,
    hasImage: doc.image !== undefined,
    ...(doc.source ? { source: doc.source } : {}),
    createdAt: doc.createdAt ?? now,
    updatedAt: doc.updatedAt ?? doc.createdAt ?? now,
  };
}
