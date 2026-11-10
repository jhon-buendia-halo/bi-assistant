import { Controller, Get, Param, Query } from '@nestjs/common';
import { MonitoringService } from './monitoring.service';
import type { LlmCallsQuery } from './dto/llm-calls-query';
import type { LlmCallDetail, LlmCallsPage } from './entities/llm-call.entity';

@Controller('monitoring')
export class MonitoringController {
  constructor(private readonly monitoring: MonitoringService) {}

  @Get('llm-calls')
  async listCalls(@Query() query: LlmCallsQuery): Promise<LlmCallsPage> {
    return this.monitoring.listCalls(query);
  }

  @Get('llm-calls/:id')
  async getCall(@Param('id') id: string): Promise<LlmCallDetail> {
    return this.monitoring.getCall(id);
  }
}
