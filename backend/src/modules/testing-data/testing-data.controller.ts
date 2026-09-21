import {
  Body,
  Controller,
  Delete,
  Get,
  Logger,
  Param,
  Post,
} from '@nestjs/common';
import {
  TestingDataService,
  type LoadTestingDataResult,
  type TestingDataStatus,
} from './testing-data.service';
import type { LoadTestingDataDto } from './dto/testing-data.dto';

@Controller('testing-data')
export class TestingDataController {
  private readonly logger = new Logger(TestingDataController.name);

  constructor(private readonly testingData: TestingDataService) {}

  /** Never fails the caller: an unreadable store simply means "not loaded". */
  @Get()
  async status(): Promise<TestingDataStatus> {
    try {
      return await this.testingData.status();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Testing-data status unavailable: ${message}`);
      return this.testingData.describe();
    }
  }

  @Post(':fixtureId/load')
  async load(
    @Param('fixtureId') fixtureId: string,
    @Body() dto: LoadTestingDataDto,
  ): Promise<LoadTestingDataResult> {
    try {
      return await this.testingData.load(fixtureId, dto ?? {});
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { ok: false, message };
    }
  }

  /** Forgets one sample app-side only — the database is never touched. */
  @Delete(':fixtureId')
  async remove(
    @Param('fixtureId') fixtureId: string,
  ): Promise<{ ok: boolean; message: string }> {
    try {
      return await this.testingData.clear(fixtureId);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { ok: false, message };
    }
  }
}
