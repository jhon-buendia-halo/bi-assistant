import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { DatasetsService, toDatasetSummary } from './datasets.service';
import type { DatasetSummary } from './datasets.service';
import type { DatasetDoc } from './repositories/datasets.repository';
import type { DatasetEntitySnapshot } from './repositories/datasets.repository';

@Controller('datasets')
export class DatasetsController {
  constructor(private readonly datasets: DatasetsService) {}

  /** Every dataset; `?view=summary` drops the entity snapshots and schema notes. */
  @Get()
  async list(
    @Query('view') view?: string,
  ): Promise<{ datasets: DatasetDoc[] | DatasetSummary[] }> {
    const datasets = await this.datasets.list();
    return {
      datasets: view === 'summary' ? datasets.map(toDatasetSummary) : datasets,
    };
  }

  @Post()
  async create(
    @Body()
    body: {
      name?: unknown;
      tables?: unknown;
      entities?: unknown;
      datasourceId?: unknown;
      datasourceKind?: unknown;
      schemas?: unknown;
    },
  ): Promise<{ ok: boolean; message: string }> {
    try {
      const name = typeof body?.name === 'string' ? body.name.trim() : '';
      const tables = Array.isArray(body?.tables)
        ? body.tables.map((t) => String(t))
        : [];
      const saved = await this.datasets.save({
        name,
        tables,
        entities: Array.isArray(body?.entities)
          ? (body.entities as DatasetEntitySnapshot[])
          : [],
        datasourceId:
          typeof body?.datasourceId === 'string'
            ? body.datasourceId.trim()
            : '',
        datasourceKind: body?.datasourceKind,
        // Only an array replaces the notes; anything else keeps them.
        schemas: Array.isArray(body?.schemas)
          ? (body.schemas as unknown[])
          : undefined,
      });
      return {
        ok: true,
        message: `Dataset "${saved?.name ?? name}" saved — ${tables.length} entities`,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { ok: false, message };
    }
  }

  @Delete(':name')
  async remove(
    @Param('name') name: string,
  ): Promise<{ ok: boolean; message: string }> {
    const removed = await this.datasets.delete(name);
    if (removed === 0) {
      return { ok: false, message: `Dataset "${name}" not found` };
    }
    return { ok: true, message: `Dataset "${name}" deleted` };
  }
}
