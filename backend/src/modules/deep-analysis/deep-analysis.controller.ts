import { Controller, Get, Param, Res } from '@nestjs/common';
import type { Response } from 'express';
import { DeepAnalysisService } from './deep-analysis.service';

/**
 * The report a past chat holds (api.md 2.7 #48). Starting and polling a job
 * (46, 47) were removed in 1.23.27: a deep analysis is a run of the
 * `deep-analysis` workflow.
 */
@Controller('sessions')
export class DeepAnalysisController {
  constructor(private readonly deepAnalysis: DeepAnalysisService) {}

  @Get(':id/deep-analysis/:jobId/download')
  async download(
    @Param('id') id: string,
    @Param('jobId') jobId: string,
    @Res() res: Response,
  ): Promise<void> {
    const { filename, markdown } = await this.deepAnalysis.download(id, jobId);
    const body = Buffer.from(markdown, 'utf8');
    res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
    res.setHeader('Content-Length', body.length);
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(body);
  }
}
