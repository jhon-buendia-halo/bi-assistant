import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { renderDashboardBundle } from '../../mastra/workflows/recreate-dashboard.steps';
import { sandboxedVisualizationDocument } from '../sessions/visualization-document';
import { ArtifactsService } from './artifacts.service';
import type {
  ArtifactDetail,
  ArtifactSummary,
} from './entities/artifact.entity';

/**
 * The Artifacts area (api.md 2.6.4): the stored artifacts, read, renamed
 * and deleted. An artifact is created from a run
 * (`POST /workflow-runs/:id/artifact`, api.md 144).
 */
@Controller('artifacts')
export class ArtifactsController {
  constructor(private readonly artifacts: ArtifactsService) {}

  /** Every artifact, newest first (api.md 139). */
  @Get()
  list(): Promise<ArtifactSummary[]> {
    return this.artifacts.list();
  }

  /** One artifact with its dashboard drawn (api.md 140). */
  @Get(':id')
  async get(@Param('id') id: string): Promise<ArtifactDetail> {
    const artifact = await this.artifacts.get(id);
    return {
      ...artifact,
      // No mapping: the dashboard as it was read, with no status badges.
      document: sandboxedVisualizationDocument(
        renderDashboardBundle(artifact.blueprint, null),
      ),
    };
  }

  /** The image an artifact's dashboard was read from (api.md 141). */
  @Get(':id/image')
  async image(@Param('id') id: string, @Res() res: Response): Promise<void> {
    const image = await this.artifacts.image(id);
    res.setHeader('Content-Type', image.mediaType);
    res.setHeader('Content-Length', image.data.length);
    // The file never changes: an artifact's image is written once.
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.send(image.data);
  }

  /** Rename an artifact (api.md 142). */
  @Patch(':id')
  rename(
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<ArtifactSummary> {
    return this.artifacts.rename(id, body);
  }

  /** Delete an artifact (api.md 143). */
  @Delete(':id')
  @HttpCode(204)
  delete(@Param('id') id: string): Promise<void> {
    return this.artifacts.delete(id);
  }
}
