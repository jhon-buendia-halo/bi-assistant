import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  Inject,
  Optional,
  Param,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import {
  FILE_UPLOAD_MAX_BYTES,
  UPLOAD_MAX_BYTES,
} from './connectors/file-storage';
import { DatasourcesService } from './datasources.service';
import type {
  DiscoverRestEndpointsDto,
  PreviewFileDto,
  SaveDatasourceDto,
  TestDatasourceDto,
} from './dto/datasource.dto';
import type {
  CatalogInfo,
  DatasourceView,
  RestDiscovery,
  SheetPreview,
  SourceFile,
} from './entities/datasource.entity';

@Controller('datasources')
export class DatasourcesController {
  constructor(
    private readonly datasources: DatasourcesService,
    @Optional()
    @Inject(FILE_UPLOAD_MAX_BYTES)
    private readonly uploadMaxBytes: number = UPLOAD_MAX_BYTES,
  ) {}

  @Get()
  async list(): Promise<{ datasources: DatasourceView[] }> {
    return { datasources: await this.datasources.list() };
  }

  @Post('test-connection')
  async testConnection(
    @Body() dto: TestDatasourceDto,
  ): Promise<{ ok: boolean; message: string }> {
    try {
      const message = await this.datasources.testConnection(
        dto.kind,
        dto.config,
        dto.id,
      );
      return { ok: true, message: message ?? 'Connection successful' };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { ok: false, message };
    }
  }

  /**
   * Upload one file (api.md 156, Style B). The raw body is streamed to
   * disk: `application/octet-stream` matches none of the app's body
   * parsers, so the JSON parser and its limit never see it.
   */
  @Post('files/uploads')
  async uploadFile(
    @Req() req: Request,
    @Headers('x-file-name') fileName?: string,
  ): Promise<{ uploadId: string; file: SourceFile }> {
    if ((req as Request & { _body?: boolean })._body) {
      throw new BadRequestException(
        'Send the file as the raw body (application/octet-stream)',
      );
    }
    const declared = Number(req.headers['content-length']);
    return this.datasources.uploadFile(
      req,
      fileName,
      Number.isFinite(declared) ? declared : undefined,
      this.uploadMaxBytes,
    );
  }

  /** Preview one sheet under import options (api.md 157, Style B). */
  @Post('files/preview')
  @HttpCode(200)
  previewFile(@Body() dto: PreviewFileDto): Promise<SheetPreview> {
    return this.datasources.previewFile(dto);
  }

  /** Drop an unsaved upload (api.md 158, Style B). */
  @Delete('files/uploads/:uploadId')
  @HttpCode(204)
  async deleteUpload(@Param('uploadId') uploadId: string): Promise<void> {
    await this.datasources.deleteUpload(uploadId);
  }

  @Post('rest/discover')
  async discoverRestEndpoints(
    @Body() dto: DiscoverRestEndpointsDto,
  ): Promise<{ ok: boolean; message: string } & Partial<RestDiscovery>> {
    try {
      const result = await this.datasources.discoverRestEndpoints(
        dto.config,
        dto.specUrl,
        dto.id,
      );
      const count = result.endpoints.length;
      const source = result.title ? ` in "${result.title}"` : '';
      return {
        ok: true,
        message: `Found ${count} endpoint${count === 1 ? '' : 's'}${source}`,
        ...result,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { ok: false, message };
    }
  }

  @Post()
  async save(
    @Body() dto: SaveDatasourceDto,
  ): Promise<{ ok: boolean; message: string; datasource?: DatasourceView }> {
    try {
      const datasource = await this.datasources.save(dto);
      return {
        ok: true,
        message: `Datasource "${datasource.name}" saved`,
        datasource,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { ok: false, message };
    }
  }

  @Delete(':id')
  async remove(
    @Param('id') id: string,
  ): Promise<{ ok: boolean; message: string }> {
    try {
      const removed = await this.datasources.delete(id);
      return { ok: true, message: `Datasource "${removed.name}" deleted` };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { ok: false, message };
    }
  }

  @Get(':id/inventory')
  async inventory(
    @Param('id') id: string,
    @Query('refresh') refresh?: string,
    @Query('cachedOnly') cachedOnly?: string,
  ): Promise<{
    ok: boolean;
    message?: string;
    catalogs?: CatalogInfo[];
    fetchedAt?: string;
    cached?: boolean;
  }> {
    try {
      if (cachedOnly === 'true') {
        // Snapshot-or-nothing: the caller decides whether to pay for a live walk.
        const snapshot = await this.datasources.cachedInventory(id);
        return snapshot
          ? { ok: true, ...snapshot }
          : { ok: true, cached: false };
      }
      const result = await this.datasources.inventory(id, refresh === 'true');
      return { ok: true, ...result };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { ok: false, message };
    }
  }
}
