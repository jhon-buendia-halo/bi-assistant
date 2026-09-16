import { Body, Controller, Get, Param, Post, Res } from '@nestjs/common';
import type { Response } from 'express';
import { DeepAnalysisService } from './deep-analysis.service';
import type { DeepAnalysisView } from './entities/deep-analysis-job.entity';

@Controller('projects')
export class DeepAnalysisController {
  constructor(private readonly deepAnalysis: DeepAnalysisService) {}

  /** Start the slow path. One running job per project. */
  @Post(':id/deep-analysis')
  async start(
    @Param('id') id: string,
    @Body() body: { question?: string },
  ): Promise<{ ok: boolean; message: string; jobId?: string }> {
    try {
      const result = await this.deepAnalysis.start(id, body?.question ?? '');
      if ('conflictWith' in result) {
        return {
          ok: false,
          message: 'A deep analysis is already running for this project',
          jobId: result.conflictWith,
        };
      }
      return {
        ok: true,
        message: 'Deep analysis started',
        jobId: result.jobId,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { ok: false, message };
    }
  }

  @Get(':id/deep-analysis/:jobId')
  status(
    @Param('id') id: string,
    @Param('jobId') jobId: string,
  ): { ok: boolean; message: string } & Partial<DeepAnalysisView> {
    try {
      const view = this.deepAnalysis.status(id, jobId);
      return { ok: true, message: view.progress ?? view.status, ...view };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { ok: false, message };
    }
  }

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
