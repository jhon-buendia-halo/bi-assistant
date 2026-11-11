import { Controller, Get, Param, Query } from '@nestjs/common';
import { MonitoringService } from './monitoring.service';
import type { LlmCallsQuery } from './dto/llm-calls-query';
import type { SessionsQuery } from './dto/sessions-query';
import type { LlmCallDetail, LlmCallsPage } from './entities/llm-call.entity';
import type {
  SessionDetail,
  SessionsPage,
  TraceDetail,
} from './entities/session-flow.entity';

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

  @Get('sessions')
  async listSessions(@Query() query: SessionsQuery): Promise<SessionsPage> {
    return this.monitoring.listSessions(query);
  }

  @Get('sessions/:id')
  async getSession(@Param('id') id: string): Promise<SessionDetail> {
    return this.monitoring.getSession(id);
  }

  @Get('traces/:traceId')
  async getTrace(
    @Param('traceId') traceId: string,
    @Query('framework') framework?: string,
  ): Promise<TraceDetail> {
    return this.monitoring.getTrace(traceId, framework);
  }
}
