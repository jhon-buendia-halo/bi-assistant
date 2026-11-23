import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Query,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { renderLiveDashboardBundle } from '../../mastra/workflows/live-dashboard';
import { sandboxedVisualizationDocument } from '../sessions/visualization-document';
import { ArtifactsService, versionParam } from './artifacts.service';
import type {
  ArtifactDetail,
  ArtifactSummary,
} from './entities/artifact.entity';

/**
 * The Artifacts area (api.md 2.6.4): the stored artifacts, read at a
 * version, downloaded, renamed and deleted. No route creates an artifact or
 * a version: a run of Dashboard Image to Artifact saves one (agents.md
 * 5.17), and a turn that builds a dashboard on the user's data saves each
 * version.
 */
@Controller('artifacts')
export class ArtifactsController {
  constructor(private readonly artifacts: ArtifactsService) {}

  /** Every artifact, newest first (api.md 144). */
  @Get()
  list(): Promise<ArtifactSummary[]> {
    return this.artifacts.list();
  }

  /**
   * One artifact at a version, the current one when `version` is absent,
   * with its dashboard drawn (api.md 145): on the version's rows when it
   * has them, else on invented values.
   */
  @Get(':id')
  async get(
    @Param('id') id: string,
    @Query('version') version?: unknown,
  ): Promise<ArtifactDetail> {
    const { artifact, rows } = await this.artifacts.detail(
      id,
      versionParam(version),
    );
    return {
      ...artifact,
      // No mapping: the dashboard as it was built, with no status badges.
      document: sandboxedVisualizationDocument(
        renderLiveDashboardBundle(artifact.blueprint, rows),
      ),
    };
  }

  /**
   * A version of an artifact's dashboard as a zip of plain HTML, JS and CSS
   * that opens from the file system (api.md 163).
   */
  @Get(':id/download')
  async download(
    @Param('id') id: string,
    @Res() res: Response,
    @Query('version') version?: unknown,
  ): Promise<void> {
    const { filename, archive } = await this.artifacts.download(
      id,
      versionParam(version),
    );
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Length', archive.length);
    res.setHeader('Cache-Control', 'no-store');
    res.send(archive);
  }

  /** The image an artifact's dashboard was read from (api.md 146). */
  @Get(':id/image')
  async image(@Param('id') id: string, @Res() res: Response): Promise<void> {
    const image = await this.artifacts.image(id);
    res.setHeader('Content-Type', image.mediaType);
    res.setHeader('Content-Length', image.data.length);
    // The file never changes: an artifact's image is written once.
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.send(image.data);
  }

  /** Rename an artifact (api.md 147). */
  @Patch(':id')
  rename(
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<ArtifactSummary> {
    return this.artifacts.rename(id, body);
  }

  /** Delete an artifact (api.md 148). */
  @Delete(':id')
  @HttpCode(204)
  delete(@Param('id') id: string): Promise<void> {
    return this.artifacts.delete(id);
  }
}
