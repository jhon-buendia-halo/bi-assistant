import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { DataReadinessService } from './data-readiness.service';
import type { AssessDto } from './dto/assess.dto';
import type { ReadinessReport, ReadinessReportSummary } from './engine/types';

/** Data readiness assessments (api.md; unit 8, BA-259). */
@Controller('data-readiness/assessments')
export class DataReadinessController {
  constructor(private readonly service: DataReadinessService) {}

  @Post()
  assess(@Body() body: AssessDto): Promise<ReadinessReport> {
    return this.service.assess(body);
  }

  @Get()
  list(
    @Query('datasourceId') datasourceId: string,
  ): Promise<{ reports: ReadinessReportSummary[] }> {
    return this.service.list(datasourceId);
  }

  @Get(':id')
  get(@Param('id') id: string): Promise<ReadinessReport> {
    return this.service.get(id);
  }
}
