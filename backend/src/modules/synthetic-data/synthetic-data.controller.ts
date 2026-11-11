import { Body, Controller, Logger, Post, Res } from '@nestjs/common';
import type { Response } from 'express';
import type { Download } from './http-stream';
import type { ProfileRequest } from './synthetic-data.service';
import { SyntheticDataService } from './synthetic-data.service';
import type { SampledProfile } from './types';

/** Sampled profiles and synthetic scripts (api.md 2.18). Style B errors. */
@Controller('synthetic-data')
export class SyntheticDataController {
  private readonly logger = new Logger(SyntheticDataController.name);

  constructor(private readonly service: SyntheticDataService) {}

  /** 111. A client that disconnects before the answer aborts the sampling. */
  @Post('profiles')
  profile(
    @Body() body: ProfileRequest,
    @Res({ passthrough: true }) res: Response,
  ): Promise<SampledProfile> {
    const abort = new AbortController();
    // `res` closes without finishing only when the client went away. (The
    // request's own `close` also fires once the body is read.)
    res.on('close', () => {
      if (!res.writableFinished) abort.abort();
    });
    return this.service.profile(body, { signal: abort.signal });
  }

  /** 112. Validated before any header; streamed as an attachment. */
  @Post('scripts')
  async scripts(
    @Body() body: Record<string, unknown>,
    @Res() res: Response,
  ): Promise<void> {
    await this.send(res, this.service.synthetic(body));
  }

  /** 113. */
  @Post('profile-exports')
  async profileExports(
    @Body() body: Record<string, unknown>,
    @Res() res: Response,
  ): Promise<void> {
    await this.send(res, this.service.profileExport(body));
  }

  /** 114. Real rows; a client that disconnects aborts the re-read. */
  @Post('sample-exports')
  async sampleExports(
    @Body() body: Record<string, unknown>,
    @Res() res: Response,
  ): Promise<void> {
    const abort = new AbortController();
    const onClose = () => {
      if (!res.writableFinished) abort.abort();
    };
    res.on('close', onClose);
    const download = await this.service.sampleExport(body, {
      signal: abort.signal,
    });
    await this.send(res, download);
  }

  /** Headers first, then the body. After the headers an error destroys the response. */
  private async send(res: Response, download: Download): Promise<void> {
    res.status(200);
    res.setHeader('Content-Type', download.contentType);
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${download.fileName}"`,
    );
    for (const [k, v] of Object.entries(download.headers)) res.setHeader(k, v);
    try {
      await download.write(res);
    } catch (err) {
      // Never a JSON error mid-body, and never row data in the log.
      this.logger.error(
        `Export failed: ${err instanceof Error ? err.name : 'error'}`,
      );
      res.destroy(err instanceof Error ? err : new Error(String(err)));
    }
  }
}
