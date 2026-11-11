import { Body, Controller, Post, Res } from '@nestjs/common';
import type { Response } from 'express';
import type { ProfileRequest } from './synthetic-data.service';
import { SyntheticDataService } from './synthetic-data.service';
import type { SampledProfile } from './types';

/** Sampled profiles and synthetic scripts (api.md 2.18). Style B errors. */
@Controller('synthetic-data')
export class SyntheticDataController {
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
}
