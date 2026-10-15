import {
  Controller,
  Get,
  Header,
  Param,
  Query,
  Res,
  StreamableFile,
} from '@nestjs/common';
import {
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiProduces,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { EXHIBIT_NAMES } from './exhibits';
import { PackageService } from './package.service';

/** A file name safe for Content-Disposition: `rfp-<title>`. */
export function packageFileName(title: string, extension: string): string {
  const slug = title
    .normalize('NFKD')
    .replace(/[^\x20-\x7e]/g, '')
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase()
    .slice(0, 80);
  return `rfp-${slug || 'package'}.${extension}`;
}

/** The RFP package routes (api.md 2.16.5, I30-I34). */
@ApiTags('rfp package')
@Controller('v1/rfps')
export class PackageController {
  constructor(private readonly packages: PackageService) {}

  @Get(':id/document.md')
  @ApiOperation({ summary: 'The RFP document in Markdown' })
  @ApiProduces('text/markdown')
  @ApiOkResponse({ schema: { type: 'string' } })
  @Header('Content-Type', 'text/markdown; charset=utf-8')
  documentMarkdown(@Param('id') id: string): Promise<string> {
    return this.packages.markdown(id);
  }

  @Get(':id/document.pdf')
  @ApiOperation({ summary: 'The RFP document as PDF' })
  @ApiProduces('application/pdf')
  @ApiOkResponse({ schema: { type: 'string', format: 'binary' } })
  async documentPdf(@Param('id') id: string): Promise<StreamableFile> {
    const { rfp, pdf } = await this.packages.pdf(id);
    return new StreamableFile(pdf, {
      type: 'application/pdf',
      disposition: `inline; filename="${packageFileName(rfp.title, 'pdf')}"`,
    });
  }

  @Get(':id/exhibits')
  @ApiOperation({ summary: 'The four exhibits as JSON rows' })
  @ApiOkResponse({
    schema: {
      type: 'object',
      properties: {
        exhibits: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string', enum: [...EXHIBIT_NAMES] },
              title: { type: 'string' },
              rows: { type: 'array', items: { type: 'object' } },
            },
          },
        },
      },
    },
  })
  async exhibits(@Param('id') id: string) {
    const exhibits = await this.packages.exhibits(id);
    return {
      exhibits: exhibits.map(({ name, title, rows }) => ({
        name,
        title,
        rows,
      })),
    };
  }

  @Get(':id/exhibits/:name.csv')
  @ApiOperation({ summary: 'One exhibit as CSV (RFC 4180, header row)' })
  @ApiProduces('text/csv')
  @ApiOkResponse({ schema: { type: 'string' } })
  @ApiNotFoundResponse({ description: 'Unknown RFP or exhibit name' })
  async exhibitCsv(
    @Param('id') id: string,
    @Param('name') name: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<string> {
    const csv = await this.packages.exhibitCsv(id, name);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${name}.csv"`);
    return csv;
  }

  @Get(':id/package.zip')
  @ApiOperation({
    summary: 'The RFP package: document, PDF, exhibits, manifest',
  })
  @ApiProduces('application/zip')
  @ApiQuery({
    name: 'draft',
    required: false,
    description:
      'true: a DRAFT package (marked DRAFT, manifest carries draft and stage)',
  })
  @ApiOkResponse({ schema: { type: 'string', format: 'binary' } })
  async packageZip(
    @Param('id') id: string,
    @Query('draft') draft?: string,
  ): Promise<StreamableFile> {
    const { rfp, zip } = await this.packages.zip(id, {
      draft: draft === 'true',
    });
    return new StreamableFile(zip, {
      type: 'application/zip',
      disposition: `attachment; filename="${packageFileName(rfp.title, 'zip')}"`,
    });
  }
}
