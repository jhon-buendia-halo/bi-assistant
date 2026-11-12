import { Controller, Get } from '@nestjs/common';

/**
 * `GET /health` (api.md 2.19): the cheap readiness probe the desktop app polls.
 * It answers 200 once the backend is up and reads no store.
 */
@Controller('health')
export class HealthController {
  @Get()
  health(): { ok: true } {
    return { ok: true };
  }
}
